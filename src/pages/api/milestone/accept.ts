import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";

import milestoneTrackerABI from "../../../contracts/MilestonTrackerABI.json";
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

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json();
    const { milestoneId, ownerUid, participants } = data;
    
    if (!milestoneId || !ownerUid || !participants || !Array.isArray(participants)) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields or invalid format",
          details: "Request must include milestoneId, ownerUid, and participants array"  
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
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
      const wallet = new ethers.Wallet(
        decryptPrivateKey(encryptedPrivKey), 
        provider
      );

      // Make sure wallet has ETH for transaction
      const balance = await provider.getBalance(wallet.address);
      if (balance < ethers.parseEther("0.01")) {
        // Send some ETH from test wallet for gas fees if needed
        const testWallet = new ethers.Wallet(
          import.meta.env.ETHEREUM_PRIVATE_KEY,
          provider
        );
        const sendMoney = await testWallet.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("0.1")
        });
        await sendMoney.wait();
      }

      // Get the milestone contract
      const contractAddress = import.meta.env.MILESTONE_TRACKER_ADDRESS;
      const milestoneContract = new ethers.Contract(
        contractAddress,
        milestoneTrackerABI.abi,
        wallet
      );

      // Call the signMilestone function on the smart contract
      const tx = await milestoneContract.signMilestone(
        ownerAddress, // Owner's Ethereum address
        milestoneId   // Milestone ID
      );

      // Wait for the transaction to be confirmed
      console.log("Waiting for signature transaction to be mined...");
      const receipt = await tx.wait();
      console.log("Transaction confirmed:", receipt);

      if (receipt.status !== 1) {
        throw new Error("Blockchain transaction failed");
      }

      // Check for MilestoneSigned event
      const signedEvents = await milestoneContract.queryFilter(
        milestoneContract.filters.MilestoneSigned(null, wallet.address),
        receipt.blockNumber,
        receipt.blockNumber
      );

      // Find event matching our transaction
      const signedEvent = signedEvents.find(e => e.transactionHash === receipt.hash);
      if (!signedEvent) {
        throw new Error("MilestoneSigned event not found");
      }

      const parsedSignedEvent = milestoneContract.interface.parseLog(signedEvent);
      console.log("Milestone signature recorded:", parsedSignedEvent.args);
      
      // Check if milestone was finalized (all signatures collected)
      const finalizedEvents = await milestoneContract.queryFilter(
        milestoneContract.filters.MilestoneFinalized(),
        receipt.blockNumber,
        receipt.blockNumber
      );
      
      const finalizedEvent = finalizedEvents.find(e => e.transactionHash === receipt.hash);
      const isFinalized = !!finalizedEvent;

      // Update Firestore - current user's document
      const currentUserMilestonesRef = db.collection("users").doc(currentUserUid).collection("milestones").doc("milestoneData");
      const currentUserSnapshot = await currentUserMilestonesRef.get();

      if (currentUserSnapshot.exists) {
        const data = currentUserSnapshot.data();
        const pendingMilestones = data.pendingMilestones || [];
        const acceptedMilestones = data.acceptedMilestones || [];
        
        // Find the pending milestone
        const milestoneIndex = pendingMilestones.findIndex((m: any) => m.id === milestoneId);
        
        if (milestoneIndex !== -1) {
          // Move from pending to accepted
          const milestone = {...pendingMilestones[milestoneIndex]};
          
          // Update signature status
          if (isFinalized) {
            milestone.isPending = false;
          }
          
          // Add to accepted list and remove from pending
          acceptedMilestones.push(milestone);
          pendingMilestones.splice(milestoneIndex, 1);
          
          await currentUserMilestonesRef.update({
            pendingMilestones,
            acceptedMilestones
          });
        }
      }

      // Update the owner's milestone document to record the signature
      const ownerMilestonesRef = db.collection("users").doc(ownerUid).collection("milestones").doc("milestoneData");
      const ownerSnapshot = await ownerMilestonesRef.get();

      if (ownerSnapshot.exists) {
        const ownerData = ownerSnapshot.data();
        const pendingMilestones = ownerData.pendingMilestones || [];
        const acceptedMilestones = ownerData.acceptedMilestones || [];
        
        // Find the milestone
        const milestoneIndex = pendingMilestones.findIndex((m: any) => m.id === milestoneId);
        
        if (milestoneIndex !== -1) {
          const milestone = pendingMilestones[milestoneIndex];
          
          
          // If milestone is finalized, move it to accepted
          if (isFinalized) {
            milestone.isPending = false;
            acceptedMilestones.push({...milestone});
            pendingMilestones.splice(milestoneIndex, 1);
            
            await ownerMilestonesRef.update({
              pendingMilestones,
              acceptedMilestones
            });
          }
        }
      }

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