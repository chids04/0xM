import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const data = await request.json();
    const { milestoneId, ownerUid } = data;

    // Validate input
    if (!milestoneId || !ownerUid) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          details: "Request must include milestoneId and ownerUid",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

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

    // Prevent the owner from declining their own milestone
    if (currentUserUid === ownerUid) {
      return new Response(
        JSON.stringify({
          message: "Owner cannot decline their own milestone",
          errorCode: "INVALID_ACTION",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get milestone data
    const milestoneRef = db.collection("milestones").doc(milestoneId);
    const milestoneDoc = await milestoneRef.get();

    if (!milestoneDoc.exists) {
      return new Response(
        JSON.stringify({
          message: "Milestone not found",
          errorCode: "MILESTONE_NOT_FOUND",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const milestoneData = milestoneDoc.data();
    if (!milestoneData) {
      return new Response(
        JSON.stringify({
          message: "Milestone data is empty",
          errorCode: "MILESTONE_DATA_EMPTY",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get taggedFriendIds from milestone data
    const taggedFriendIds = milestoneData.taggedFriendIds || [];

    // Create array of all users to update (owner + tagged friends + current user)
    const usersToUpdate = [...new Set([ownerUid, currentUserUid, ...taggedFriendIds])];

    // Update pending and declined milestones for all relevant users
    for (const userId of usersToUpdate) {
      const userPendingRef = db
        .collection("users")
        .doc(userId)
        .collection("milestones")
        .doc("pending");
      
      const userDeclinedRef = db
        .collection("users")
        .doc(userId)
        .collection("milestones")
        .doc("declined");

      // Remove from pending
      const userPendingDoc = await userPendingRef.get();
      if (userPendingDoc.exists) {
        await userPendingRef.update({
          milestoneRefs: FieldValue.arrayRemove(milestoneRef)
        });
      }

      // Add to declined
      const userDeclinedDoc = await userDeclinedRef.get();
      if (!userDeclinedDoc.exists) {
        await userDeclinedRef.set({ milestoneRefs: [milestoneRef] });
      } else {
        await userDeclinedRef.update({
          milestoneRefs: FieldValue.arrayUnion(milestoneRef)
        });
      }
    }

    // Update the milestone document to track who declined it
    await milestoneRef.update({
      declinedBy: FieldValue.arrayUnion({
        uid: currentUserUid,
        timestamp: Timestamp.now()
      }),
      status: "declined" // Add a status field for easy filtering
    });

    // Add to global expiring milestones for automated cleanup
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 3); // 3 days from now

    const expiringMilestonesRef = db.collection("expiringMilestones").doc(milestoneId);
    await expiringMilestonesRef.set({
      milestoneRef,
      owner: ownerUid,
      declinedBy: currentUserUid,
      declinedAt: Timestamp.now(),
      expiryDate: Timestamp.fromDate(expiryDate),
      processed: false
    });

    return new Response(
      JSON.stringify({
        message: "Milestone declined successfully",
        declinedMilestoneId: milestoneId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in milestone decline API:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error", message: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};