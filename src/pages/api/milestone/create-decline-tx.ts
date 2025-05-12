import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";



import { createErrorResponse } from "@/utils/ErrorResponse";
import { trackerContract, tokenContract, 
  relayerContract, forwarderContract, adminWallet } from "@/utils/contracts";
import { create, create as createIpfsClient } from "ipfs-http-client";

const ipfs = createIpfsClient({ url: "http://127.0.0.1:5001" });

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json();
    const { milestoneId } = data;
    
    if (!milestoneId) {
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields or invalid format",
          message: "Request must include milestoneId"
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


    // fetch milestone data using milestoneId
    const milestoneDoc = await db.collection("milestones").doc(milestoneId).get();
    if (!milestoneDoc.exists) {
      return new Response(
        JSON.stringify({
          message: "Milestone not found",
          errorCode: "MILESTONE_NOT_FOUND"
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    const milestoneData = milestoneDoc.data();
    const ownerUid = milestoneData?.owner;
    if (!ownerUid) {
        return createErrorResponse("NOT_FOUND", "Owner UID not found in milestone data", 404);
    }

    // get the CID from milestone data
    const milestoneCids = milestoneData?.ipfsCIDs;
    if (!milestoneCids) {
      return createErrorResponse("NOT_FOUND", "IPFS CIDs not found in milestone data", 404);
    }


    let extraMilestoneData;
    try {
      // Use the IPFS client to fetch and decode the data
      const chunks: Uint8Array[] = [];
      for await (const chunk of ipfs.cat(milestoneCids.metadataCid)) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const buffer = Buffer.concat(chunks);
      const raw = buffer.toString("utf-8");
      extraMilestoneData = JSON.parse(raw);
    } catch (ipfsError) {
      return new Response(
        JSON.stringify({
          message: "Failed to fetch milestone data from IPFS",
          error: ipfsError.message,
          errorCode: "IPFS_FETCH_FAILED"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    //both contain owner field so rename here, hacky i know
    if (extraMilestoneData.owner) {
      extraMilestoneData.ownerAddress = extraMilestoneData.owner;
      delete extraMilestoneData.owner;
    }
    
    //firebases owner var overrides the one in the ipfs data
    const mergedMilestone = {
      ...extraMilestoneData,
      ...milestoneData,
    };


    // get the current user's wallet information
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
    const currentUserAddress = walletData?.address;

    // Verify that the current user's wallet is in the participants array
    if (!mergedMilestone.participants.includes(currentUserAddress)) {
      return new Response(
        JSON.stringify({ 
          message: "You are not authorized to decline this milestone",
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
    const ownerAddress = ownerWalletData?.address;
    const bal = await tokenContract.balanceOf(currentUserAddress);

    const [
      addMilestoneFee,
      addGroupMilestoneFee,
      signMilestoneFee,
      tier1DiscountPercent,
      tier2DiscountPercent,
    ] = await relayerContract.getMilestoneFees();

    if(bal < signMilestoneFee){
      return createErrorResponse("INSUFFICIENT_BALANCE", "Insufficient balance to decline milestone", 403)
    }

    const callData = trackerContract.interface.encodeFunctionData("removeMilestone", [
      ownerAddress,
      milestoneId,
    ]); 

    const gasEstimate = 1000000n; // 
    const gasEstimateWithBuffer = (gasEstimate * 15n) / 10n;
    const nonce = await forwarderContract.nonces(currentUserAddress);

    const metaTxRequest = {
      from: currentUserAddress,
      to: await trackerContract.getAddress(),
      value: "0", // No ETH value
      gas: gasEstimateWithBuffer.toString(), 
      nonce: nonce.toString(),
      deadline: (Math.floor(Date.now() / 1000) + 3600).toString(), // 1 hour from now
      data: callData,
    };
    
    const { name, version, chainId, verifyingContract } = await forwarderContract.eip712Domain();
    
    const domain = { 
        name, 
        version, 
        chainId: Number(chainId), 
        verifyingContract 
    };

    const types = {
        ForwardRequest: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "gas", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint48" },
            { name: "data", type: "bytes" },
        ],
    };

    return new Response(
      JSON.stringify({
        metaTxRequest,
        domain,
        types
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in milestone accept API:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error", message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};