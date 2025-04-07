import type { APIRoute } from "astro";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { app } from "../../../firebase/server";

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const friendId = url.searchParams.get('friendId');
    
    if (!friendId) {
      return new Response(
        JSON.stringify({ message: "Missing friend ID" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const auth = getAuth(app);
    const db = getFirestore(app);

    try {
      // Get user data from Firebase Auth
      const userRecord = await auth.getUser(friendId);
      
      // Also get additional data from Firestore if needed
      const userDoc = await db.collection("users").doc(friendId).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      
      // Combine data, prioritizing Auth data
      const result = {
        displayName: userRecord.displayName || userData.displayName || "User",
        email: userRecord.email || userData.email || "",
        photoURL: userRecord.photoURL || 
                 userData.photoURL || 
                 `https://api.dicebear.com/7.x/initials/svg?seed=${userRecord.displayName || userRecord.email || "?"}`,
        // Add other fields as needed
      };

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Error fetching user details:", error);
      
      // Still try to get from Firestore if Auth fails
      try {
        const userDoc = await db.collection("users").doc(friendId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          const result = {
            displayName: userData.displayName || "User",
            email: userData.email || "",
            photoURL: userData.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${userData.displayName || userData.email || "?"}`,
          };
          
          return new Response(
            JSON.stringify(result),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
      } catch (firestoreError) {
        console.error("Error fetching user from Firestore:", firestoreError);
      }
      
      return new Response(
        JSON.stringify({ message: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const requestData = await request.json();
    const friendIds = requestData.friendIds || [];
    
    if (!Array.isArray(friendIds) || friendIds.length === 0) {
      return new Response(
        JSON.stringify({ message: "Missing or invalid friendIds array" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const auth = getAuth(app);
    const db = getFirestore(app);
    
    // Create a map to store email results
    const emailMap: Record<string, string> = {};
    
    // Fetch emails for each friend in parallel
    const fetchPromises = friendIds.map(async (friendId) => {
      try {
        // Try to get user email from Firebase Auth first
        try {
          const userRecord = await auth.getUser(friendId);
          emailMap[friendId] = userRecord.email || `User-${friendId.substring(0, 4)}`;
        } catch (authError) {
          // Fallback to Firestore if Auth fails
          const userDoc = await db.collection("users").doc(friendId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            emailMap[friendId] = userData.email || `User-${friendId.substring(0, 4)}`;
          } else {
            emailMap[friendId] = `User-${friendId.substring(0, 4)}`;
          }
        }
      } catch (error) {
        console.error(`Error fetching email for user ${friendId}:`, error);
        emailMap[friendId] = `User-${friendId.substring(0, 4)}`;
      }
    });
    
    await Promise.all(fetchPromises);
    
    return new Response(
      JSON.stringify(emailMap),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing bulk user emails request:", error);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};