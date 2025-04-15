import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { ethers } from "ethers";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { createMetaTxRequest } from "../wallet/helpers/CreateMetaTx";
import { createGaslessApproval } from "../wallet/helpers/GaslessApproval"

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("missing encryption key");
}

function hashMilestone(data: any) {
  // Only include fields that are hashed
  const hashableData = {
    id: data.id,
    description: data.description,
    milestone_date: data.milestone_date,
    image: data.image,
    owner: data.owner,
    participants: data.participants,
    taggedFriendIds: data.taggedFriendIds,
    createdAt: data.createdAt,
  };
  return crypto.createHash("sha256").update(JSON.stringify(hashableData)).digest("hex");
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

function createErrorResponse(code: string, message: string, status: number) {
  console.error(`${code}: ${message}`);
  return new Response(
    JSON.stringify({
      success: false,
      error: { code, message },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let uploadedFile: string | null = null; // Track uploaded file for cleanup
  let storage
  try {
    // Parse multipart form data
    const formData = await request.formData();

    // Extract form fields
    const description = formData.get("description")?.toString();
    const milestone_date = formData.get("milestone_date")?.toString();
    const fee = formData.get("fee")?.toString();
    const taggedFriendIdsRaw = formData.get("taggedFriendIds")?.toString();
    const taggedFriendIds = taggedFriendIdsRaw ? JSON.parse(taggedFriendIdsRaw) : [];
    const imageFile = formData.get("image");

    // Validate required fields
    if (!description || !milestone_date) {
      return createErrorResponse("VALIDATION_ERROR", "Missing required fields.", 400);
    }

    // Load blockchain configuration
    const tracker_adr = import.meta.env.MILESTONE_TRACKER_ADDRESS;
    const token_adr = import.meta.env.MST_TOKEN_ADDRESS;
    const relayer_adr = import.meta.env.MILESTONE_RELAYER_ADDRESS;
    const forwarder_adr = import.meta.env.FORWARDER_ADDRESS;

    if (!tracker_adr || !relayer_adr || !forwarder_adr || !token_adr) {
      return createErrorResponse(
        "CONFIG_ERROR",
        "Missing tracker, token, forwarder or relayer address, SERVER ERROR",
        500
      );
    }

    const ADMIN_PRIV = import.meta.env.ADMIN_PRIV_KEY;
    if (!ADMIN_PRIV) {
      return createErrorResponse(
        "SERVER_ERROR",
        "Admin unavailable to sign transaction, try again later",
        500
      );
    }

    const trackerABI = import.meta.env.MILESTONE_TRACKER_ABI;
    const relayerABI = import.meta.env.MILESTONE_RELAYER_ABI;
    const tokenABI = import.meta.env.MST_TOKEN_ABI;
    const forwarderABI = import.meta.env.FORWARDER_ABI;
    let tracker_abi, relayer_abi, forwarder_abi, token_abi;

    if (!trackerABI || !relayerABI || !forwarderABI || !tokenABI) {
      return createErrorResponse(
        "CONFIG_ERROR",
        "Missing tracker, token, forwarder or relayer ABI, SERVER ERROR",
        500
      );
    }

    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = join(__dirname, "../../../../blockchain");
      const trackerArtifact = JSON.parse(readFileSync(join(projectRoot, trackerABI), "utf8"));
      const relayerArtifact = JSON.parse(readFileSync(join(projectRoot, relayerABI), "utf8"));
      const forwarderArtifact = JSON.parse(readFileSync(join(projectRoot, forwarderABI), "utf8"));
      const tokenArtifact = JSON.parse(readFileSync(join(projectRoot, tokenABI), "utf8"));
      tracker_abi = trackerArtifact.abi;
      relayer_abi = relayerArtifact.abi;
      forwarder_abi = forwarderArtifact.abi;
      token_abi = tokenArtifact.abi;
    } catch (error) {
      console.error("ABI loading error:", error);
      return createErrorResponse(
        "BLOCKCHAIN_ERROR",
        "Failed to load tracker, token, relayer or forwarder ABI",
        500
      );
    }

    const provider = new ethers.JsonRpcProvider(
      import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
    );

    const auth = getAuth(app);
    const db = getFirestore(app);
    storage = getStorage(app);

    // Authenticate user
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return createErrorResponse("AUTH_ERROR", "Unauthorized", 401);
    }

    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch (err) {
      return createErrorResponse("AUTH_ERROR", "Invalid session", 401);
    }

    const uid = decodedCookie.uid;

    const milestoneId = uuidv4();
    let imageUrl = "";

    // Upload image to Firebase Storage if provided
    if (imageFile instanceof File) {
      // Validate file type
      if (!imageFile.type.startsWith("image/")) {
        return createErrorResponse("VALIDATION_ERROR", "Invalid file type. Only images are allowed.", 400);
      }
      // Validate file size (5MB limit)
      if (imageFile.size > 5 * 1024 * 1024) {
        return createErrorResponse("VALIDATION_ERROR", "File size exceeds 5MB limit.", 400);
      }

      const bucket = storage.bucket("nft-images");
      const fileName = `milestones/${milestoneId}/${imageFile.name || "image"}`;
      const file = bucket.file(fileName);
      uploadedFile = fileName; // Track for cleanup

      // Read file buffer
      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Upload to Firebase Storage
      await file.save(buffer, {
        metadata: {
          contentType: imageFile.type,
        },
      });

      // Get signed URL
      const [url] = await file.getSignedUrl({
        action: "read",
        expires: "03-01-2500", // Long expiration
      });
      imageUrl = url;
    }

    // Prepare milestone data for hashing
    const milestoneDataForHash = {
      id: milestoneId,
      description,
      milestone_date,
      image: imageUrl, // Include image URL in hash
      owner: uid,
      participants: [] as string[],
      taggedFriendIds: taggedFriendIds || [],
      isPending: taggedFriendIds?.length > 0,
      createdAt: new Date().toISOString(),
      hash: "",
    };

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
      // Cleanup image if wallet is missing
      if (uploadedFile) {
        await storage.bucket().file(uploadedFile).delete().catch((err) => {
          console.error("Failed to clean up image:", err);
        });
      }
      return createErrorResponse("WALLET_ERROR", "User wallet not found.", 400);
    }

    // Populate participants with public keys for group milestones
    let isGroupMs = false;
    if (taggedFriendIds && taggedFriendIds.length > 0) {
      isGroupMs = true;
      for (const friendId of taggedFriendIds) {
        const walletRef = db
          .collection("users")
          .doc(friendId)
          .collection("wallet")
          .doc("wallet_info");
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
          // Cleanup image if friend wallet is missing
          if (uploadedFile) {
            storage.bucket().file(uploadedFile).delete().catch((err) => {
              console.error("Failed to clean up image:", err);
            });
          }
          return createErrorResponse(
            "WALLET_ERROR",
            `${email} is missing a private/public key. Tell them to generate one in settings.`,
            500
          );
        }
      }
    }

    // Calculate hash with image URL
    const milestoneHash = hashMilestone(milestoneDataForHash);
    milestoneDataForHash.hash = milestoneHash;

    const adminWallet = new ethers.Wallet(ADMIN_PRIV, provider);
    const userWallet = new ethers.Wallet(decryptPrivateKey(encryptedPrivKey), provider);

    // Check if user has balance for this transaction
    const token_contract = new ethers.Contract(token_adr, token_abi, provider);
    const relayerContract = new ethers.Contract(relayer_adr, relayer_abi, adminWallet);
    const forwarderContract = new ethers.Contract(forwarder_adr, forwarder_abi, provider)


    const bal = await token_contract.balanceOf(await userWallet.getAddress());
    const [
      addMilestoneFee,
      addGroupMilestoneFee,
      signMilestoneFee,
      tier1DiscountPercent,
      tier2DiscountPercent,
    ] = await relayerContract.getMilestoneFees();


    if (isGroupMs) {
      if (addGroupMilestoneFee > bal) {
        // Cleanup image on insufficient funds
        if (uploadedFile) {
          await storage.bucket().file(uploadedFile).delete().catch((err) => {
            console.error("Failed to clean up image:", err);
          });
        }
        return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient funds", 400);
      }
      //gasless approval here

      const { success, error } = await createGaslessApproval({
        signer: userWallet,
        tokenContract: token_contract,
        forwarder: forwarderContract,
        relayer: relayerContract,
        spender: await relayerContract.getAddress(),
        amount: addGroupMilestoneFee
      })

      if(!success){
        return createErrorResponse("BLOCKCHAIN_ERROR", "Error in gasless approval" + error?.message, 501)
      }

      
    } else {
      if (addMilestoneFee > bal) {
        // Cleanup image on insufficient funds
        if (uploadedFile) {
          await storage.bucket().file(uploadedFile).delete().catch((err) => {
            console.error("Failed to clean up image:", err);
          });
        }
        return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient Funds", 400);
      }

      const { success, error } = await createGaslessApproval({
        signer: userWallet,
        tokenContract: token_contract,
        forwarder: forwarderContract,
        relayer: relayerContract,
        spender: await relayerContract.getAddress(),
        amount: addMilestoneFee
      })

      if(!success){
        return createErrorResponse("BLOCKCHAIN_ERROR", "Error in gasless approval" + error?.message, 501)
      }
    }

    let query, tx;
    let isGroup = false;
    if (!taggedFriendIds || taggedFriendIds.length === 0) {
      query = await createMetaTxRequest(
        userWallet,
        forwarder_adr,
        forwarder_abi,
        tracker_adr,
        tracker_abi,
        "addMilestone",
        [milestoneDataForHash.description, milestoneHash, milestoneId]
      );
      tx = await relayerContract.relayAddMilestone(query);
    } else {
      isGroup = true;
      query = await createMetaTxRequest(
        userWallet,
        forwarder_adr,
        forwarder_abi,
        tracker_adr,
        tracker_abi,
        "addGroupMilestone",
        [milestoneDataForHash.description, milestoneDataForHash.participants, milestoneHash, milestoneId]
      );
      tx = await relayerContract.relayAddGroupMilestone(query);
    }

    console.log("Waiting for transaction to be mined...");
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt);

    if (receipt.status !== 1) {
      // Cleanup image on blockchain failure
      if (uploadedFile) {
        await storage.bucket().file(uploadedFile).delete().catch((err) => {
          console.error("Failed to clean up image:", err);
        });
      }
      return createErrorResponse(
        "BLOCKCHAIN_TRANSACTION_FAILED",
        "Blockchain transaction failed. Milestone not created.",
        500
      );
    }

    let milestoneData = { ...milestoneDataForHash };
    const milestoneRef = db.collection("milestones").doc(milestoneId);
    const ownerRef = db.collection("users").doc(uid).collection("milestones");

    try {
      if (isGroup) {
        const milestoneForParticipant = {
          ...milestoneData,
          signatureCount: 0,
        };
        await milestoneRef.set(milestoneForParticipant);
        const pendingRef = ownerRef.doc("pending");

        if (!(await pendingRef.get()).exists) {
          await pendingRef.set({ milestoneRefs: [milestoneRef] });
        } else {
          await pendingRef.update({
            milestoneRefs: FieldValue.arrayUnion(milestoneRef),
          });
        }

        for (const friendId of taggedFriendIds) {
          const friendPendingRef = db
            .collection("users")
            .doc(friendId)
            .collection("milestones")
            .doc("pending");
          if (!(await friendPendingRef.get()).exists) {
            await friendPendingRef.set({ milestoneRefs: [milestoneRef] });
          } else {
            await friendPendingRef.update({
              milestoneRefs: FieldValue.arrayUnion(milestoneRef),
            });
          }
        }
      } else {
        await milestoneRef.set(milestoneData);
        const acceptedRef = ownerRef.doc("accepted");

        if (!(await acceptedRef.get()).exists) {
          await acceptedRef.set({ milestoneRefs: [milestoneRef] });
        } else {
          await acceptedRef.update({
            milestoneRefs: FieldValue.arrayUnion(milestoneRef),
          });
        }
      }
    } catch (firestoreError) {
      // Cleanup image on Firestore failure
      if (uploadedFile) {
        await storage.bucket().file(uploadedFile).delete().catch((err) => {
          console.error("Failed to clean up image:", err);
        });
      }
      throw firestoreError;
    }

    // Clear uploadedFile since we succeeded
    uploadedFile = null;

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
  } catch (error: any) {
    // Cleanup image on any unhandled error
    if (uploadedFile) {
      await storage.bucket().file(uploadedFile).delete().catch((err) => {
        console.error("Failed to clean up image:", err);
      });
    }
    console.error("Error:", error);
    return createErrorResponse(
      "SERVER_ERROR",
      error.message || "An error occurred while processing the request.",
      500
    );
  }
};