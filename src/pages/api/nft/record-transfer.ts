import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Authenticate user with session cookie
    const auth = getAuth(app);
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "AUTH_ERROR", message: "Unauthorized" }
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify the session cookie
    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "AUTH_ERROR", message: "Invalid session" }
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const requesterId = decodedCookie.uid;
    const requestData = await request.json();
    
    const { tokenId, fromAddress, toAddress, txHash, userId } = requestData;

    // Validate request
    if (!tokenId || !fromAddress || !toAddress || !txHash) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_REQUEST", message: "Missing required fields" }
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify the requester is the owner of the account or an admin
    if (requesterId !== userId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "PERMISSION_DENIED", message: "You are not authorized to record transfers for this user" }
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = getFirestore(app);

    // 1. Remove token from sender's collection
    const userNftDoc = await db.collection("users").doc(userId).collection("nft").doc("tokenIDs").get();
    
    if (userNftDoc.exists) {
      const tokenIDs = userNftDoc.data()?.tokenIDs || [];
      // remove the transferred token ID from the user's list
      const updatedTokenIDs = tokenIDs.filter((id: string) => id !== tokenId.toString());
      
      await db.collection("users").doc(userId).collection("nft").doc("tokenIDs").set({
        tokenIDs: updatedTokenIDs
      });
    }
    
    // 2. Find recipient's userId by wallet address
    const recipientQuery = await db.collection("wallets")
      .where("address", "==", toAddress.toLowerCase())
      .limit(1)
      .get();
      
    let recipientUserId = null;
    if (!recipientQuery.empty) {
      recipientUserId = recipientQuery.docs[0].data().userId;
      console.log(`Found recipient user ID: ${recipientUserId}`);
      
      // 3. Add token to recipient's collection
      if (recipientUserId) {
        const recipientNftDoc = await db.collection("users").doc(recipientUserId).collection("nft").doc("tokenIDs").get();
        const recipientTokenIDs = recipientNftDoc.exists ? (recipientNftDoc.data()?.tokenIDs || []) : [];
        
        // Only add if it's not already in the array
        if (!recipientTokenIDs.includes(tokenId.toString())) {
          await db.collection("users").doc(recipientUserId).collection("nft").doc("tokenIDs").set({
            tokenIDs: [...recipientTokenIDs, tokenId.toString()]
          });
          console.log(`Added token ${tokenId} to recipient ${recipientUserId}'s collection`);
        }
      } else {
        console.warn(`Could not determine user ID for wallet address: ${toAddress}`);
      }
    }
    
    // 4. Add transfer record
    await db.collection("transfers").add({
      tokenId,
      fromAddress,
      toAddress,
      txHash,
      fromUserId: userId,
      toUserId: recipientUserId, // May be null if recipient not found
      timestamp: new Date()
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        recipientFound: !!recipientUserId
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error recording NFT transfer:", error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SERVER_ERROR", message: error.message || "Failed to record NFT transfer" }
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};