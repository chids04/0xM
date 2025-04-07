import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { createMetaTxRequest } from "../wallet/helpers/CreateMetaTx";

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if(!ENCRYPTION_KEY){
  throw new Error("missing encryption key");
}

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

function createErrorResponse(
  code: string, 
  message: string, 
  status: number
) {
  console.error(`${code}: ${message}`);
  return new Response(
      JSON.stringify({ 
          success: false, 
          error: { code, message } 
      }),
      { 
          status, 
          headers: { "Content-Type": "application/json" } 
      }
  );
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json()
    const { description, milestone_date, image, taggedFriendIds } = data.payload;
    const fee = data.fee
    if (!description || !milestone_date) {
      return new Response(
        JSON.stringify({ error: "Missing required fields." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const tracker_adr = import.meta.env.MILESTONE_TRACKER_ADDRESS;
    const token_adr = import.meta.env.MST_TOKEN_ADDRESS;
    const relayer_adr = import.meta.env.MILESTONE_RELAYER_ADDRESS
    const forwarder_adr = import.meta.env.FORWARDER_ADDRESS
        
    if (!tracker_adr || !relayer_adr || !forwarder_adr || !token_adr) {
        return createErrorResponse(
            "CONFIG_ERROR", 
            "Missing tracker, token, forwarder or relayer address, SERVER ERROR", 
            500
        );

    }

    const ADMIN_PRIV = import.meta.env.ADMIN_PRIV_KEY
    if(!ADMIN_PRIV){
        return createErrorResponse("SERVER_ERROR", "Admin unavailiable to sign transaction, try again later", 500)
    }

    const trackerABI = import.meta.env.MILESTONE_TRACKER_ABI;
    const relayerABI = import.meta.env.MILESTONE_RELAYER_ABI
    const tokenABI = import.meta.env.MST_TOKEN_ABI
    const forwarderABI = import.meta.env.FORWARDER_ABI
    let tracker_abi, relayer_abi, forwarder_abi, token_abi;
    
    if (!trackerABI || !relayerABI || !forwarderABI || !tokenABI) {
        return createErrorResponse(
            "CONFIG_ERROR", 
            "Missing tracker, token, forwader or relayer ABI, SERVER ERROR", 
            500
        );
    }
    
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const projectRoot = join(__dirname, '../../../../blockchain');
        const trackerArtifact = JSON.parse(readFileSync(join(projectRoot, trackerABI), 'utf8'));
        const relayerArtifact = JSON.parse(readFileSync(join(projectRoot, relayerABI), 'utf8'));
        const forwarderArtifact = JSON.parse(readFileSync(join(projectRoot, forwarderABI), 'utf8'));
        const tokenArtifact = JSON.parse(readFileSync(join(projectRoot, tokenABI), 'utf8'));
        tracker_abi = trackerArtifact.abi;
        relayer_abi = relayerArtifact.abi
        forwarder_abi = forwarderArtifact.abi
        token_abi = tokenArtifact.abi
        
    } catch (error) {
        console.error("ABI loading error:", error);
        return createErrorResponse(
            "BLOCKCHAIN_ERROR", 
            "Failed to load tracker, token, relayer or forwader ABI", 
            500
        );
    }
    const provider = new ethers.JsonRpcProvider(
      import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
    );

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

    // Populate participants with public keys for group milestones
    let isGroupMs
    if (taggedFriendIds && taggedFriendIds.length > 0) {
      isGroupMs = true
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

    const adminWallet = new ethers.Wallet(ADMIN_PRIV, provider) 
    const userWallet = new ethers.Wallet(decryptPrivateKey(encryptedPrivKey), provider)

    //check if user has balance for this transaction
    const token_contract = new ethers.Contract(
      token_adr,
      token_abi,
      userWallet
    )

    const relayerContract = new ethers.Contract(
      relayer_adr,
      relayer_abi,
      adminWallet
    )


    const bal = await token_contract.balanceOf(await userWallet.getAddress())
    const [
      addMilestoneFee, 
      addGroupMilestoneFee, 
      signMilestoneFee, 
      tier1DiscountPercent, 
      tier2DiscountPercent
    ] = await relayerContract.getMilestoneFees();

    
    if(isGroupMs){
      if( addGroupMilestoneFee > bal){
        return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient funds", 400);
      }

      await token_contract.approve(
        relayer_adr,
        addGroupMilestoneFee
      )
    }

    else{
      //approve the relayer to take the fee from the user
      if(addMilestoneFee > bal){

        return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient Funds", 400);
      }
      await token_contract.approve(
        relayer_adr,
        addMilestoneFee
      )
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
      )

      tx = await relayerContract.relayAddMilestone(query)

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
      )

      tx = await relayerContract.relayAddGroupMilestone(query)

    }

    console.log("Waiting for transaction to be mined...");
    const receipt = await tx.wait()
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


    //if here then transaction was succesful
    let milestoneData = { ...milestoneDataForHash};

    const milestoneRef = db.collection("milestones").doc(milestoneId);
    const ownerRef = db.collection("users").doc(uid).collection("milestones");

    if(isGroup){
      const milestoneForParticipant = {
        ...milestoneData,
        signatureCount: 0,
      };
      
      await milestoneRef.set(milestoneForParticipant);
      const pendingRef = ownerRef.doc("pending");
    
      if (!(await pendingRef.get()).exists) {
        await pendingRef.set({ milestoneRefs: [milestoneRef] });
      }else{
        await pendingRef.update({
          milestoneRefs: FieldValue.arrayUnion(milestoneRef)
        })
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
            milestoneRefs: FieldValue.arrayUnion(milestoneRef)
          });
        }
      }
    }else{
      milestoneRef.set(milestoneData)
      const acceptedRef = ownerRef.doc("accepted")

      if (!(await acceptedRef.get()).exists) {
        await acceptedRef.set({ milestoneRefs: [milestoneRef] });
      }else{
        await acceptedRef.update({
          milestoneRefs: FieldValue.arrayUnion(milestoneRef)
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