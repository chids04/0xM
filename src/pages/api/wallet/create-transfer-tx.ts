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
    const { fromAddress, toAddress, amount } = data;
    
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
    const walletDoc = await db.collection("users").doc(currentUserUid).collection("wallet").doc("wallet_info").get();
    if (!walletDoc.exists) {
      return createErrorResponse("NOT_FOUND", "Wallet not found", 404);
    }
    const walletDocData = walletDoc.data();
    if (!walletDocData) {
      return createErrorResponse("NOT_FOUND", "Wallet data not found", 404);
    }
    const currentUserAddress = walletDocData.address;
    if(fromAddress.toLowerCase() !== currentUserAddress.toLowerCase()){
      return createErrorResponse("INVALID_ACTION", "Wallet address mismatch, please select the correct wallet", 403)
    }

    const transferFee = await relayerContract.getTransferFee();
    const bal = await tokenContract.balanceOf(fromAddress);

    if(bal < ethers.parseEther(amount) + transferFee){
      return createErrorResponse("INSUFFICIENT_BALANCE", "Insufficient balance to decline milestone", 403)
    }

    const callData = tokenContract.interface.encodeFunctionData("transfer", [
      toAddress,
      ethers.parseEther(amount),
    ]); 

    const gasEstimate = await tokenContract.transfer.estimateGas(
        toAddress,
        ethers.parseEther(amount),
        { from: await adminWallet.getAddress() }
    );

    const gasEstimateWithBuffer = (gasEstimate * 15n) / 10n;
    const nonce = await forwarderContract.nonces(fromAddress);

    const metaTxRequest = {
      from: currentUserAddress,
      to: await tokenContract.getAddress(),
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