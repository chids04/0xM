import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { createMetaTxRequest } from "../wallet/helpers/CreateMetaTx";

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;

function decryptPrivateKey(encryptedData: string): string {
    const [iv, encrypted] = encryptedData.split(":");
    
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes.");
    }

    const ivBuffer = Buffer.from(iv, 'hex');
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
    const data = await request.json();
    const { milestoneId, ownerUid, participants, fee } = data;
    
    if (!milestoneId || !ownerUid || !participants || !Array.isArray(participants)) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields or invalid format",
          message: "Request must include milestoneId, ownerUid, and participants array"  
        }),
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


    // Set up auth and db
    const auth = getAuth(app);
    const db = getFirestore(app);

    // Verify session using the session cookie
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
    } catch (error) {
      return new Response(
        JSON.stringify({ message: "Invalid session" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const currentUserUid = decodedCookie.uid;

    // Get the current user's wallet information
    const walletDoc = await db.collection("users").doc(currentUserUid).collection("wallet").doc("wallet_info").get();

    if (!walletDoc.exists) {
      return new Response(
        JSON.stringify({ 
          message: "Wallet not found. Please create a wallet in settings.",
          errorCode: "WALLET_NOT_FOUND"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const walletData = walletDoc.data();
    const encryptedPrivKey = walletData?.encryptedPrivateKey;
    const currentUserAddress = walletData?.publicKey;

    // Verify that the current user's wallet is in the participants array
    if (!participants.includes(currentUserAddress)) {
      return new Response(
        JSON.stringify({ 
          message: "You are not authorized to sign this milestone",
          errorCode: "NOT_A_PARTICIPANT",
          details: "Your wallet address is not in the participants list for this milestone"
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the owner's wallet address (needed for the contract call)
    const ownerDoc = await db.collection("users").doc(ownerUid).collection("wallet").doc("wallet_info").get();
    if (!ownerDoc.exists) {
      return new Response(
        JSON.stringify({ 
          message: "Owner's wallet not found",
          errorCode: "OWNER_WALLET_NOT_FOUND"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    const ownerWalletData = ownerDoc.data();
    const ownerAddress = ownerWalletData?.publicKey;

    // Connect to Ethereum network
    try {
      const provider = new ethers.JsonRpcProvider(
        import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
      );

      // Connect wallet using decrypted private key
      const signerWallet = new ethers.Wallet(
        decryptPrivateKey(encryptedPrivKey), 
        provider
      );

      const adminWallet = new ethers.Wallet(
        ADMIN_PRIV,
        provider
      )

      const token_contract = new ethers.Contract(
        token_adr,
        token_abi,
        signerWallet
      )

      const relayer_contract = new ethers.Contract(
        relayer_adr,
        relayer_abi,
        adminWallet
      )

      const bal = await token_contract.balanceOf(await signerWallet.getAddress())
      const [
        addMilestoneFee, 
        addGroupMilestoneFee, 
        signMilestoneFee, 
        tier1DiscountPercent, 
        tier2DiscountPercent
    ] = await relayer_contract.getMilestoneFees();

      if(signMilestoneFee > bal){
        return createErrorResponse("TRANSACTION_ERROR", "Insufficient funds to sign milestone", 400)
      }
      else{
        await token_contract.approve(
          relayer_adr,
          signMilestoneFee
        )
      }

      const query = await createMetaTxRequest(
        signerWallet,
        forwarder_adr,
        forwarder_abi,
        tracker_adr,
        tracker_abi,
        "signMilestone",
        [ownerAddress, milestoneId]
      )

      

      const tracker_contract = new ethers.Contract(
        tracker_adr,
        tracker_abi,
        adminWallet
      )

      const tx = await relayer_contract.relaySignMilestone(query)
      const receipt = await tx.wait()

      if (receipt.status !== 1) {
        throw new Error("Blockchain transaction failed");
      }

     
      
      // Check if milestone was finalized (all signatures collected)
      const finalizedEvents = await tracker_contract.queryFilter(
        tracker_contract.filters.MilestoneFinalized(ownerAddress, milestoneId),
        receipt.blockNumber,
        receipt.blockNumber
      );
      const finalizedEvent = finalizedEvents.find(e => e.transactionHash === receipt.hash);
      const isFinalized = !!finalizedEvent;
      
      // Firestore operations
      const db = getFirestore(app);
      const milestoneRef = db.collection("milestones").doc(milestoneId);
      const batch = db.batch();
      
      // Helper function to update milestone refs
      const updateMilestoneRefs = async (userUid: string, fromDoc: string, toDoc: string, milestonePath: any) => {
      const fromRef = db.collection("users").doc(userUid).collection("milestones").doc(fromDoc);
      const toRef = db.collection("users").doc(userUid).collection("milestones").doc(toDoc);
    
      // Get the 'from' document (e.g., pending)
      const fromDocSnap = await fromRef.get();
      if (fromDocSnap.exists) {
        const fromData = fromDocSnap.data();
        if (fromData?.milestoneRefs) {
          const updatedRefs = fromData.milestoneRefs.filter(ref =>
            typeof ref === 'string' ? !ref.endsWith(`/${milestoneId}`) : !ref.path.endsWith(`/${milestoneId}`)
          );
          batch.update(fromRef, { milestoneRefs: updatedRefs });
        }
      }
    
      // Get or create the 'to' document (e.g., signed or accepted)
      const toDocSnap = await toRef.get();
      const milestoneDocRef = db.collection("milestones").doc(milestoneId);

      if (!toDocSnap.exists) {
        batch.set(toRef, { milestoneRefs: [milestoneDocRef] });
      } else {
        batch.update(toRef, { milestoneRefs: FieldValue.arrayUnion(milestoneDocRef) });
      }
    };

    // 3. Update the owner's documents if milestone is finalized
    if (isFinalized) {
      // Move from pending to accepted for both user and owner
      await updateMilestoneRefs(currentUserUid, "pending", "accepted", milestoneRef.path);
      await updateMilestoneRefs(ownerUid, "pending", "accepted", milestoneRef.path);
      batch.update(milestoneRef, {
        isPending: false,
        signatureCount: FieldValue.increment(1),
      });
    } else {
      // Move from pending to signed for current user only
      await updateMilestoneRefs(currentUserUid, "pending", "signed", milestoneRef.path);
      // Owner's pending stays unchanged
      batch.update(milestoneRef, {
        signatureCount: FieldValue.increment(1),
      });
    }
    
    // Commit all changes atomically
    await batch.commit();

    // Return the success response
    return new Response(
      JSON.stringify({ 
        message: "Milestone signature recorded successfully", 
        isFinalized,
        transactionHash: receipt.hash,
        blockchainData: {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString()
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

    } catch (ethError) {
      console.error("Blockchain transaction failed:", ethError);
      return new Response(
        JSON.stringify({ 
          message: "Blockchain transaction failed. Could not sign milestone.", 
          error: ethError.message,
          errorCode: "BLOCKCHAIN_TRANSACTION_FAILED"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error in milestone accept API:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error", message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};