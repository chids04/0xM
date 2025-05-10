import type { APIRoute } from "astro";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { app } from "../../../firebase/server";

export const POST: APIRoute = async ({ request, cookies }) => {
  const auth = getAuth(app);
  const db = getFirestore(app);

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
      JSON.stringify({ message: "Missing email" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let targetUserRecord;

  try{
    targetUserRecord = await auth.getUserByEmail(targetEmail);
  }
  catch(error){
    return new Response(
      JSON.stringify({ message: "User not found in firebase" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }
  console.log(targetUserRecord)

  const targetUserId = targetUserRecord.uid
  console.log("target UID:", targetUserId == "d1WLghysvZ0vdLxJc7tGx6BJmmm3");

  if (senderUid === targetUserId) {
    return new Response(
      JSON.stringify({ message: "Cannot add yourself as a friend" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // update the target user's pendingRequests array in their friends subcollection.
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
    console.error("Error updating sent requests:", err);
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