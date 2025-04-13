import type { APIRoute } from "astro";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { app } from "../../../firebase/server";

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Check if user is authenticated
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ message: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const auth = getAuth(app);
    let session;
    try {
      session = await auth.verifySessionCookie(sessionCookie);
    } catch (error) {
      return new Response(
        JSON.stringify({ message: "Invalid session" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const userId = session.uid;
    const { friendId } = await request.json();

    if (!friendId) {
      return new Response(
        JSON.stringify({ message: "Friend ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const db = getFirestore(app);
    
    // Get the user's friends document
    const userFriendsRef = db.collection("users").doc(userId).collection("friends").doc("request-status");
    const userFriendsDoc = await userFriendsRef.get();
    
    if (!userFriendsDoc.exists) {
      return new Response(
        JSON.stringify({ message: "Friends list not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const userData = userFriendsDoc.data();
    const acceptedFriends = userData?.acceptedRequests || [];

    // Check if the friend is in the user's friends list
    if (!acceptedFriends.includes(friendId)) {
      return new Response(
        JSON.stringify({ message: "User is not in your friends list" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the friend's document
    const friendFriendsRef = db.collection("users").doc(friendId).collection("friends").doc("request-status");
    const friendFriendsDoc = await friendFriendsRef.get();

    // Start a batch write to update both documents atomically
    const batch = db.batch();

    // Update user's document - remove friend from acceptedRequests
    batch.update(userFriendsRef, {
      acceptedRequests: acceptedFriends.filter(id => id !== friendId)
    });

    // Update friend's document - remove user from acceptedRequests (if it exists)
    if (friendFriendsDoc.exists) {
      const friendData = friendFriendsDoc.data();
      const friendAcceptedRequests = friendData?.acceptedRequests || [];
      
      batch.update(friendFriendsRef, {
        acceptedRequests: friendAcceptedRequests.filter(id => id !== userId)
      });
    }

    // Commit the batch
    await batch.commit();

    return new Response(
      JSON.stringify({ 
        message: "Friend removed successfully",
        success: true
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error removing friend:", error);
    return new Response(
      JSON.stringify({ 
        message: "Failed to remove friend", 
        error: error.message 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};