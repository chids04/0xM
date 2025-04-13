import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Function to hash milestone data for blockchain verification
function hashMilestone(data: any) {
  // Remove fields that shouldn't be part of the hash calculation
  const hashableData = {
      id: data.id,
      description: data.description,
      milestone_date: data.milestone_date,
      image: data.image,
      owner: data.owner,
      participants: data.participants,
      taggedFriendIds: data.taggedFriendIds,
      createdAt: data.createdAt
  };
  
  console.log(hashableData)
  return crypto.createHash("sha256").update(JSON.stringify(hashableData)).digest("hex");
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { userId, milestoneId } = await request.json();

    // Validate required fields
    if (!userId || !milestoneId) {
      return new Response(
        JSON.stringify({ 
          verified: false, 
          message: "Missing required fields" 
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Authenticate the user with session cookie
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ 
          verified: false, 
          message: "Authentication required" 
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const auth = getAuth(app);
    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          verified: false, 
          message: "Invalid session" 
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get milestone data from Firestore
    const db = getFirestore(app);
    const milestoneDoc = await db.collection("milestones").doc(milestoneId).get();

    if (!milestoneDoc.exists) {
      return new Response(
        JSON.stringify({ 
          verified: false, 
          message: "Milestone not found" 
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const walletDoc = await db
      .collection("users")
      .doc(userId)
      .collection("wallet")
      .doc("wallet_info")
      .get();

    if (!walletDoc.exists) {
      return new Response(
        JSON.stringify({ 
        verified: false, 
        message: "Wallet not found for the user" 
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const walletData = walletDoc.data()
    if(!walletData){
        return new Response(
            JSON.stringify({
                verified: false,
                message: "Wallet address not found"
            }),
            {status: 404, headers: {"Content-Type" : "application/json"}}
        )
    }
    const walletAddress = walletData.publicKey

    console.log(walletAddress)

    const milestoneData = milestoneDoc.data();

    if(!milestoneData){
        throw new Error("Missing milestone in firebase")
    }
    
    // Get milestone hash from blockchain
    // Load contract ABIs
    const trackerABIPath = import.meta.env.MILESTONE_TRACKER_ABI;
    const trackerAddress = import.meta.env.MILESTONE_TRACKER_ADDRESS;
    const rpcUrl = import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545";

    if(!trackerABIPath || !trackerAddress){
        throw new Error("Missing tracker ABI path or tracker address")
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const projectRoot = join(__dirname, '../../../../blockchain');
    const artifact = JSON.parse(readFileSync(join(projectRoot, trackerABIPath), 'utf8'));
    const trackerABI = artifact.abi

    
    try {
      
      // Connect to the blockchain
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const milestoneTracker = new ethers.Contract(trackerAddress, trackerABI, provider);

      
      // Get milestone from blockchain
      const currentHash = hashMilestone(milestoneData);
      console.log(currentHash)

        const isVerified = await milestoneTracker.verifyMilestoneHash(walletAddress, milestoneId, currentHash);
      
      // Calculate hash from current data to compare
      
      
      return new Response(
        JSON.stringify({
          verified: isVerified,
          currentHash,
          message: isVerified ? "Milestone verified successfully" : "Verification failed: Hash mismatch"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Blockchain error:", error);
      return new Response(
        JSON.stringify({ 
          verified: false, 
          message: `Blockchain error: ${error.message}` 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error verifying milestone:", error);
    return new Response(
      JSON.stringify({ 
        verified: false, 
        message: `Server error: ${error.message}` 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};