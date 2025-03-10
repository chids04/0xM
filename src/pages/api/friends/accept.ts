import type { APIRoute } from "astro";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { app } from "../../../firebase/server";

export const POST: APIRoute = async ({ request, cookies }) => {
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

  // Get the requester's user ID from the request body
  const { requestId } = await request.json();
  if (!requestId) {
    return new Response(
      JSON.stringify({ message: "Missing request ID" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Transaction to ensure atomicity of operations across documents
    await db.runTransaction(async (transaction) => {
      // 1. Get current user's friend document
      const currentUserFriendsRef = db.collection("users").doc(currentUserUid).collection("friends").doc("request-status");
      const currentUserFriendsDoc = await transaction.get(currentUserFriendsRef);
      
      // 2. Get requester's friend document
      const requesterFriendsRef = db.collection("users").doc(requestId).collection("friends").doc("request-status");
      const requesterFriendsDoc = await transaction.get(requesterFriendsRef);
      
      // Set up default values if documents don't exist
      const currentUserData = currentUserFriendsDoc.exists ? currentUserFriendsDoc.data() : { pendingRequests: [], acceptedRequests: [] };
      const requesterData = requesterFriendsDoc.exists ? requesterFriendsDoc.data() : { sentRequests: [], acceptedRequests: [] };
      
      // Validate that the request is actually pending
      if (!currentUserData.pendingRequests?.includes(requestId)) {
        throw new Error("Friend request not found");
      }
      
      // 3. Add both users to each other's acceptedRequests arrays
      const updatedCurrentUserPendingRequests = (currentUserData.pendingRequests || []).filter(
        (uid: string) => uid !== requestId
      );
      
      const updatedRequesterSentRequests = (requesterData.sentRequests || []).filter(
        (uid: string) => uid !== currentUserUid
      );
      
      const currentUserAcceptedRequests = [...(currentUserData.acceptedRequests || []), requestId];
      const requesterAcceptedRequests = [...(requesterData.acceptedRequests || []), currentUserUid];
      
      // 4. Update documents with the new arrays
      transaction.set(currentUserFriendsRef, {
        pendingRequests: updatedCurrentUserPendingRequests,
        acceptedRequests: currentUserAcceptedRequests,
      }, { merge: true });
      
      transaction.set(requesterFriendsRef, {
        sentRequests: updatedRequesterSentRequests,
        acceptedRequests: requesterAcceptedRequests,
      }, { merge: true });
    });
    
    return new Response(
      JSON.stringify({ message: "Friend request accepted successfully" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Error accepting friend request:", error);
    return new Response(
      JSON.stringify({ message: error instanceof Error ? error.message : "Failed to accept friend request" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

