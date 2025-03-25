import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import milestoneTrackerABI from "../../../contracts/MilestonTrackerABI.json";

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;

// Function to hash milestone data for blockchain verification
function hashMilestone(data: any) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function decryptPrivateKey(encryptedData: string): string {
  const [iv, encrypted] = encryptedData.split(":");
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes.");
  }
  const ivBuffer = Buffer.from(iv, "hex");
  if (ivBuffer.length !== 16) {
    throw new Error("IV must be 16 bytes.");
  }
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, ivBuffer);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json();
    const auth = getAuth(app);
    const db = getFirestore(app);

    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch (err) {
      return new Response(
        JSON.stringify({ message: "Invalid session" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const uid = decodedCookie.uid;
    const { description, milestone_date, image, taggedFriendIds } = data;
    if (!description || !milestone_date) {
      return new Response(
        JSON.stringify({ error: "Missing required fields." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const milestoneId = uuidv4();
    const milestoneDataForHash = {
      id: milestoneId,
      description,
      milestone_date,
      image: image || "",
      owner: uid,
      participants: [] as string[],
      taggedFriendIds: taggedFriendIds || [],
      isPending: taggedFriendIds?.length > 0,
      createdAt: new Date().toISOString(),
      hash: "",
    };

    // Connect to Ethereum network
    const provider = new ethers.JsonRpcProvider(
      import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
    );

    // Get encrypted private key from Firebase
    let encryptedPrivKey;
    const walletDoc = await db
      .collection("users")
      .doc(uid)
      .collection("wallet")
      .doc("wallet_info")
      .get();

    if (walletDoc.exists) {
      const walletData = walletDoc.data();
      encryptedPrivKey = walletData?.encryptedPrivateKey;
    } else {
      return new Response(
        JSON.stringify({ message: "User wallet not found." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Temporary funding wallet (remove in production)
    const testWallet = new ethers.Wallet(import.meta.env.ETHEREUM_PRIVATE_KEY, provider);
    const wallet = new ethers.Wallet(decryptPrivateKey(encryptedPrivKey), provider);

    // Fund wallet if needed
    const sendMoneyTx = await testWallet.sendTransaction({
      to: wallet.address,
      value: ethers.parseEther("1.0"),
    });
    console.log("Sending funds...");
    await sendMoneyTx.wait();
    console.log("Funds sent.");

    const contractAddress = import.meta.env.MILESTONE_TRACKER_ADDRESS;

    // Populate participants with public keys for group milestones
    if (taggedFriendIds && taggedFriendIds.length > 0) {
      for (const friendId of taggedFriendIds) {
        const walletRef = db.collection("users").doc(friendId).collection("wallet").doc("wallet_info");
        const friendWalletDoc = await walletRef.get();
        const friendUser = await auth.getUser(friendId);
        const email = friendUser.email;
        if (friendWalletDoc.exists) {
          const friendWalletData = friendWalletDoc.data();
          const friendPublicKey = friendWalletData?.publicKey;
          if (friendPublicKey) {
            milestoneDataForHash.participants.push(friendPublicKey);
          }
        } else {
          return new Response(
            JSON.stringify({
              message: `${email} is missing a private/public key. Tell them to generate one in settings.`,
              errorCode: "BLOCKCHAIN_TRANSACTION_FAILED",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }

    // Calculate hash
    const milestoneHash = hashMilestone(milestoneDataForHash);
    milestoneDataForHash.hash = milestoneHash;

    // Create contract instance
    const milestoneContract = new ethers.Contract(
      contractAddress,
      milestoneTrackerABI.abi,
      wallet
    );

    let tx;
    let isGroup = false;
    if (!taggedFriendIds || taggedFriendIds.length === 0) {
      tx = await milestoneContract.addMilestone(
        milestoneDataForHash.description,
        milestoneHash,
        milestoneId
      );
    } else {
      isGroup = true;
      tx = await milestoneContract.addGroupMilestone(
        milestoneDataForHash.description,
        milestoneDataForHash.participants,
        milestoneHash,
        milestoneId
      );
    }

    console.log("Waiting for transaction to be mined...");
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt);

    if (receipt.status !== 1) {
      return new Response(
        JSON.stringify({
          message: "Blockchain transaction failed. Milestone not created.",
          errorCode: "BLOCKCHAIN_TRANSACTION_FAILED",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    let events;
    if (!isGroup) {
      events = await milestoneContract.queryFilter(
        milestoneContract.filters.MilestoneAdded(wallet.address),
        "latest"
      );
    } else {
      events = await milestoneContract.queryFilter(
        milestoneContract.filters.GroupMilestoneAdded(wallet.address),
        "latest"
      );
    }

    // Find event matching the transaction hash
    const matchingEvents = events.filter(e => e.transactionHash === receipt.hash);
    if (matchingEvents.length === 0) {
      console.error("No Milestone added event was received");
      return new Response(
        JSON.stringify({
          message: "No Milestone added event was received",
          errorCode: "NO_EVENT_RECEIVED",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Use the first event
    const event = matchingEvents[0];
    let milestoneData = { ...milestoneDataForHash};

    const parsedLog = milestoneContract.interface.parseLog(event);
    if (parsedLog && parsedLog.args) {
      if (!isGroup) {
        const { user, id, description, timeStamp } = parsedLog.args;
        console.log(`Milestone added by ${user}:`, { id, description, timeStamp });
      } else {
        const { user, id, description, timeStamp, particpantCount } = parsedLog.args;
        console.log(`Group milestone added by ${user}:`, { id, description, timeStamp, particpantCount });
        // Add to each participant's pending milestones
        const milestoneForParticipant = {
            ...milestoneData,
            signatureCount: 0,
          };

        for (const friendId of taggedFriendIds) {
          const friendMilestoneRef = db.collection("users").doc(friendId).collection("milestones").doc("milestoneData");
          const friendMilestonesDoc = await friendMilestoneRef.get();
          if (!friendMilestonesDoc.exists) {
            await friendMilestoneRef.set({
              acceptedMilestones: [],
              pendingMilestones: [milestoneForParticipant],
            });
          } else {
            await friendMilestoneRef.update({
              pendingMilestones: FieldValue.arrayUnion(milestoneForParticipant),
            });
          }
        }
      }
    } else {
      console.error("Parsed event log missing arguments.");
    }

    // Update owner’s milestone document
    const milestonesDocRef = db.collection("users").doc(uid).collection("milestones").doc("milestoneData");
    const milestonesDoc = await milestonesDocRef.get();

    if (!milestonesDoc.exists) {
      if (!taggedFriendIds || taggedFriendIds.length === 0) {
        await milestonesDocRef.set({
          acceptedMilestones: [milestoneData],
          pendingMilestones: [],
        });
      } else {
        await milestonesDocRef.set({
          acceptedMilestones: [],
          pendingMilestones: [milestoneData],
        });
      }
    } else {
      if (!taggedFriendIds || taggedFriendIds.length === 0) {
        await milestonesDocRef.update({
          acceptedMilestones: FieldValue.arrayUnion(milestoneData),
        });
      } else {
        await milestonesDocRef.update({
          pendingMilestones: FieldValue.arrayUnion(milestoneData),
        });
      }
    }

    return new Response(
      JSON.stringify({
        message: "Milestone created and added to blockchain.",
        id: milestoneId,
        transactionHash: receipt.transactionHash,
        blockchainData: {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (ethError: any) {

    console.error("Blockchain transaction failed:", ethError);
    return new Response(
      JSON.stringify({
        message: "Blockchain transaction failed. Milestone not created.",
        error: "Transaction error",
        errorCode: "BLOCKCHAIN_TRANSACTION_FAILED",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } 
};