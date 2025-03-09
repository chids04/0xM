import type { APIRoute } from "astro";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { app } from "../../../firebase/server";

export const POST: APIRoute = async ({ request, cookies }) => {
  const auth = getAuth(app);
  const db = getFirestore(app);

  const usersSnapshot = await db.collection("users").doc("B3WDT0hipv5jSdDBBaPZURhEGYha").collection("wallet").get();
  console.log("Users found:", usersSnapshot.size);

  // verify session using the session cookie
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

  const senderUid = decodedCookie.uid;

  // Get the target user id from the request body
  const { targetEmail } = await request.json();
  if (!targetEmail) {
    return new Response(
      JSON.stringify({ message: "Missing target user id" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let targetUserRecord;
  console.log(targetEmail)

  try{
    targetUserRecord = await auth.getUserByEmail(targetEmail);
  }
  catch(error){
    return new Response(
      JSON.stringify({ message: "User not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

const targetUserId = "uh5KIklJYIPPv6qzYo7KNiuLFHhA"
console.log(targetUserRecord.uid)

// const usersSnapshot = await db.collection("users").get();
// console.log("Users found:", usersSnapshot.size);
// usersSnapshot.forEach(doc => console.log(doc.id));

  console.log(targetUserId)
  // Check if a user document exists for the target UID in the "users" collection
  const targetUserDoc = await db.collection("users").doc(targetUserId).get();
  if (!targetUserDoc.exists) {
    return new Response(
      JSON.stringify({ message: "User not found in firebase" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Prevent users from adding themselves
  if (senderUid === targetUserId) {
    return new Response(
      JSON.stringify({ message: "Cannot add yourself as a friend" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Update the target user's pendingRequests array in their friends subcollection.
  // Using set with merge:true creates the document if it does not exist.
  try {
    await db
      .collection("users")
      .doc(targetUserId)
      .collection("friends")
      .doc("request-status")
      .set(
        {
          pendingRequests: FieldValue.arrayUnion(senderUid)
        },
        { merge: true }
      );
  } catch (err) {
    console.error("Error updating pendingRequests:", err);
    return new Response(
      JSON.stringify({ message: "Could not send friend request" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    await db
      .collection("users")
      .doc(senderUid)
      .collection("friends")
      .doc("request-status")
      .set(
        {
          sentRequests: FieldValue.arrayUnion(targetUserId)
        },
        { merge: true }
      );
  } catch (err) {
    console.error("Error updating sentRequests:", err);
    return new Response(
      JSON.stringify({ message: "Could not update sent requests" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ message: "Friend request sent successfully" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};