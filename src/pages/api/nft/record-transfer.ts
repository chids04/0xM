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
    
    const { tokenId, fromAddress, toAddress, txHash, userId } = requestData;

    // Validate required fields
    if (!tokenId || !fromAddress || !toAddress || !txHash) {
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
    
    // Step 2: Find recipient and add token to their collection
    const recipientUserId = await findAndUpdateRecipient(db, toAddress, tokenId);
    
    // Step 3: Record the transfer in the transfers collection
    await recordTransfer(db, {
      tokenId,
      fromAddress, 
      toAddress,
      txHash,
      fromUserId: userId,
      toUserId: recipientUserId
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
 * Finds the recipient by wallet address and adds the token to their collection
 * Returns the recipient's userId if found, null otherwise
 */
async function findAndUpdateRecipient(db: any, toAddress: string, tokenId: string): Promise<string | null> {
  // Try multiple methods to find the recipient
  let recipientUserId = await findRecipientByDocumentId(db, toAddress);
  
  // If not found, try the fallback query method
  if (!recipientUserId) {
    recipientUserId = await findRecipientByQuery(db, toAddress);
  }
  
  // If we found a recipient, add the token to their collection
  if (recipientUserId) {
    await addTokenToRecipient(db, recipientUserId, tokenId);
  }
  
  return recipientUserId;
}

/**
 * Looks up the recipient by direct document ID
 */
async function findRecipientByDocumentId(db: any, address: string): Promise<string | null> {
  // Normalize the address for consistent matching
  const normalizedAddress = address.toLowerCase();
  console.log(`Looking for wallet document with ID: ${normalizedAddress}`);
  
  // First, try the global wallets collection
  const walletDoc = await db.collection("wallets").doc(normalizedAddress).get();
  if (walletDoc.exists) {
    const userId = walletDoc.data()?.userId;
    console.log(`Found wallet document with userId: ${userId || 'null'}`);
    return userId || null;
  }
  
  // If not found in global collection, try user collection approach
  console.log("Not found in global wallet collection, trying users collection...");
  try {
    // Query the users collection to find the user with this wallet address
    const usersSnapshot = await db.collection("users").get();
    
    for (const userDoc of usersSnapshot.docs) {
      const walletInfoDoc = await db.collection("users").doc(userDoc.id).collection("wallet").doc("wallet_info").get();
      
      if (walletInfoDoc.exists) {
        const walletData = walletInfoDoc.data();
        const userWalletAddress = walletData?.address || walletData?.publicKey;
        
        if (userWalletAddress && userWalletAddress.toLowerCase() === normalizedAddress) {
          console.log(`Found matching wallet in user collection: ${userDoc.id}`);
          return userDoc.id;
        }
      }
    }
    
    console.log("No wallet document found with that address in user collections");
    return null;
  } catch (error) {
    console.error("Error searching through user collections:", error);
    return null;
  }
}

/**
 * Looks up the recipient by querying the 'address' field
 */
async function findRecipientByQuery(db: any, address: string): Promise<string | null> {
  const normalizedAddress = address.toLowerCase();
  console.log(`Trying fallback: querying wallets where address=${normalizedAddress}`);
  
  // Try the global wallets collection first
  const recipientQuery = await db.collection("wallets")
    .where("address", "==", normalizedAddress)
    .limit(1)
    .get();

  if (!recipientQuery.empty) {
    const userId = recipientQuery.docs[0].data().userId;
    console.log(`Found recipient via global collection query, userId: ${userId || 'null'}`);
    return userId || null;
  }
  
  // Try querying the users collection
  try {
    // Users might have a different property name (publicKey instead of address)
    const usersSnapshot = await db.collection("users").get();
    
    for (const userDoc of usersSnapshot.docs) {
      // Try to get the wallet_info document
      const walletInfoQuery = await db.collection("users").doc(userDoc.id)
        .collection("wallet").doc("wallet_info").get();
      
      if (walletInfoQuery.exists) {
        const walletData = walletInfoQuery.data();
        
        // Check both possible field names (address and publicKey)
        const userAddress = walletData?.address || walletData?.publicKey;
        
        if (userAddress && userAddress.toLowerCase() === normalizedAddress) {
          console.log(`Found recipient via user collection query, userId: ${userDoc.id}`);
          return userDoc.id;
        }
      }
    }
    
    console.log("No matching wallet documents found via any queries");
    return null;
    
  } catch (error) {
    console.error("Error performing wallet queries:", error);
    return null;
  }
}

/**
 * Adds the token to the recipient's collection
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
  toUserId: string | null
}): Promise<void> {
  await db.collection("transfers").add({
    ...transferData,
    timestamp: new Date()
  });
  console.log(`Recorded transfer in database: ${transferData.tokenId} from ${transferData.fromUserId} to ${transferData.toUserId || 'unknown'}`);
}