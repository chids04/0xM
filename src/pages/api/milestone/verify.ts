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

import { trackerContract } from "@/utils/contracts";

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

    // Get the user's wallet address from Firestore if not provided in the request

    const userWalletDoc = await db.collection("users").doc(userId).collection("wallet").doc("wallet_info").get();
    if (!userWalletDoc.exists) {
      return new Response(
        JSON.stringify({
          verified: false,
          message: "Please connect your wallet to verify the milestone"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    const walletAddress = userWalletDoc.data()?.address;
    if (!walletAddress) {
      return new Response(
        JSON.stringify({
          verified: false,
          message: "Please connect your wallet to verify the milestone"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }


    // Get the metadataCid from Firestore
    const milestoneData = milestoneDoc.data();
    const metadataCid = milestoneData?.ipfsCIDs?.metadataCid;
    if (!metadataCid) {
      return new Response(
        JSON.stringify({ 
          verified: false, 
          message: "No IPFS metadata CID found for this milestone" 
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const owner = milestoneData?.owner;
    if (owner !== userId) {
      return new Response(
        JSON.stringify({
          verified: false,
          message: "You are not the owner of this milestone"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const ipfsUrl = `https://ipfs.io/ipfs/${metadataCid}`;
    const ipfsResponse = await fetch(ipfsUrl);
    if (!ipfsResponse.ok) {
      return new Response(
        JSON.stringify({ 
          verified: false, 
          message: "Failed to fetch milestone data from IPFS" 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const ipfsMilestoneData = await ipfsResponse.json();

    if (
      !ipfsMilestoneData.owner ||
      !walletAddress ||
      ipfsMilestoneData.owner.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      return new Response(
        JSON.stringify({
          verified: false,
          message: "Wallet address does not match milestone owner"
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    
    try {
      const currentHash = hashMilestone(ipfsMilestoneData);
      const isVerified = await trackerContract.verifyMilestoneHash(walletAddress, milestoneId, currentHash);
      
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
          message: `Blockchain error: ${(error as Error).message}` 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error verifying milestone:", error);
    return new Response(
      JSON.stringify({ 
        verified: false, 
        message: "Internal server error: please try again later"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};