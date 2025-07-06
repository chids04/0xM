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

    // Extract and validate request data
    const requesterId = decodedCookie.uid;
    const requestData = await request.json();
    
    const { tokenId, fromAddress, toAddress, txHash, userId, friendUID } = requestData;

    // Validate required fields
    if (!tokenId || !fromAddress || !toAddress || !txHash || !friendUID) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_REQUEST", message: "Missing required fields" }
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify authorization
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
    
    // Step 1: Remove token from sender's collection
    await removeTokenFromSender(db, userId, tokenId);
    
    // Step 2: Directly add token to recipient's collection using friendUID
    await addTokenToRecipient(db, friendUID, tokenId);
    
    // Step 3: Record the transfer in the transfers collection
    await recordTransfer(db, {
      tokenId,
      fromAddress, 
      toAddress,
      txHash,
      fromUserId: userId,
      toUserId: friendUID
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        recipientFound: true // Always true since we're using the direct UID
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

// Helper functions for cleaner code organization

/**
 * Removes a token from the sender's collection
 */
async function removeTokenFromSender(db: any, userId: string, tokenId: string) {
  const userNftDoc = await db.collection("users").doc(userId).collection("nft").doc("tokenIDs").get();
  
  if (userNftDoc.exists) {
    const tokenIDs = userNftDoc.data()?.tokenIDs || [];
    // remove the transferred token ID from the user's list
    const updatedTokenIDs = tokenIDs.filter((id: string) => id !== tokenId.toString());
    
    await db.collection("users").doc(userId).collection("nft").doc("tokenIDs").set({
      tokenIDs: updatedTokenIDs
    });
    console.log(`Removed token ${tokenId} from sender ${userId}'s collection`);
  } else {
    console.log(`Sender ${userId} has no NFT collection document`);
  }
}

/**
 * Adds the token to the recipient's collection directly using their userId
 */
async function addTokenToRecipient(db: any, userId: string, tokenId: string): Promise<void> {
  // Get recipient's existing NFT collection
  const recipientNftDoc = await db.collection("users").doc(userId).collection("nft").doc("tokenIDs").get();
  const recipientTokenIDs = recipientNftDoc.exists ? (recipientNftDoc.data()?.tokenIDs || []) : [];
  
  // Check if token already exists in the collection
  if (!recipientTokenIDs.includes(tokenId.toString())) {
    // Add token to recipient's collection
    await db.collection("users").doc(userId).collection("nft").doc("tokenIDs").set({
      tokenIDs: [...recipientTokenIDs, tokenId.toString()]
    });
    console.log(`Added token ${tokenId} to recipient ${userId}'s collection`);
  } else {
    console.log(`Token ${tokenId} already exists in recipient ${userId}'s collection`);
  }
}

/**
 * Records the transfer in the transfers collection
 */
async function recordTransfer(db: any, transferData: {
  tokenId: string,
  fromAddress: string,
  toAddress: string,
  txHash: string,
  fromUserId: string,
  toUserId: string
}): Promise<void> {
  await db.collection("transfers").add({
    ...transferData,
    timestamp: new Date()
  });
  console.log(`Recorded transfer in database: ${transferData.tokenId} from ${transferData.fromUserId} to ${transferData.toUserId}`);
}