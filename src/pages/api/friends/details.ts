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

      if(!userData){
        throw new Error("User not found in database")
      }
      
      // Combine data, prioritizing Auth data
      const result = {
        displayName: userRecord.displayName || userData.displayName || "User",
        username: userData.username || userRecord.displayName || "User",
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

          if(!userData){
            throw new Error("User data does not exist in database")
          }
          const result = {
            displayName: userData.displayName || "User",
            username: userData.username || userData.displayName || "User",
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
    
    // Create a map to store user details
    const userDetailsMap: Record<string, { email: string, username: string }> = {};
    
    // Fetch details for each friend in parallel
    const fetchPromises = friendIds.map(async (friendId) => {
      try {
        let email = `user-${friendId.substring(0, 4)}@unknown.com`;
        let username = `User-${friendId.substring(0, 4)}`;
        
        // Try to get user details from Firebase Auth first
        try {
          const userRecord = await auth.getUser(friendId);
          email = userRecord.email || email;
          username = userRecord.displayName || username;
        } catch (authError) {
          // Auth failed, that's ok, we'll try Firestore
        }
        
        // Try to get additional details from Firestore
        try {
          const userDoc = await db.collection("users").doc(friendId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();

            if(!userData){
              throw new Error("User does not exist in database")
            }
            // Only override if Firestore has values
            if (userData.email) email = userData.email;
            if (userData.username) username = userData.username;
            else if (userData.displayName) username = userData.displayName;
          }
        } catch (firestoreError) {
          console.error(`Error fetching Firestore data for user ${friendId}:`, firestoreError);
        }
        
        // Store in our map
        userDetailsMap[friendId] = { email, username };
      } catch (error) {
        console.error(`Error fetching details for user ${friendId}:`, error);
        userDetailsMap[friendId] = {
          email: `user-${friendId.substring(0, 4)}@unknown.com`,
          username: `User-${friendId.substring(0, 4)}`
        };
      }
    });
    
    await Promise.all(fetchPromises);
    
    return new Response(
      JSON.stringify(userDetailsMap),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing bulk user details request:", error);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};