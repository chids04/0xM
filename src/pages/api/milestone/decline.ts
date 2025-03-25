import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
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

    // Update the current user's Firestore document (remove from pending)
    const currentUserMilestonesRef = db
      .collection("users")
      .doc(currentUserUid)
      .collection("milestones")
      .doc("milestoneData");
    const currentUserSnapshot = await currentUserMilestonesRef.get();

    if (!currentUserSnapshot.exists) {
      return new Response(
        JSON.stringify({
          message: "User's milestone data not found",
          errorCode: "USER_MILESTONE_DATA_NOT_FOUND",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const currentUserData = currentUserSnapshot.data();
    const requestedMilestones = currentUserData.requestedMilestones || [];
    const milestoneIndex = requestedMilestones.findIndex((m: any) => m.id === milestoneId);

    if (milestoneIndex === -1) {
      return new Response(
        JSON.stringify({
          message: "Milestone not found in user's pending list",
          errorCode: "MILESTONE_NOT_FOUND",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Remove the milestone from pendingMilestones
    const declinedMilestone = { ...requestedMilestones[milestoneIndex], declinedBy: currentUserUid, declinedAt: new Date().toISOString() };
    requestedMilestones.splice(milestoneIndex, 1);

    await currentUserMilestonesRef.update({
      requestedMilestones,
    });

    // Update the owner's Firestore document (add to declinedMilestones)
    const ownerMilestonesRef = db
      .collection("users")
      .doc(ownerUid)
      .collection("milestones")
      .doc("milestoneData");
    const ownerSnapshot = await ownerMilestonesRef.get();

    if (!ownerSnapshot.exists) {
      return new Response(
        JSON.stringify({
          message: "Owner's milestone data not found",
          errorCode: "OWNER_MILESTONE_DATA_NOT_FOUND",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const ownerData = ownerSnapshot.data();
    const ownerPendingMilestones = ownerData.pendingMilestones || [];
    const ownerMilestoneIndex = ownerPendingMilestones.findIndex((m: any) => m.id === milestoneId);

    if (ownerMilestoneIndex === -1) {
      return new Response(
        JSON.stringify({
          message: "Milestone not found in owner's pending list",
          errorCode: "OWNER_MILESTONE_NOT_FOUND",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Move the milestone to declinedMilestones
    const declinedMilestoneForOwner = { ...ownerPendingMilestones[ownerMilestoneIndex], declinedBy: currentUserUid, declinedAt: new Date().toISOString() };
    ownerPendingMilestones.splice(ownerMilestoneIndex, 1); // Remove from pending

    const declinedMilestones = ownerData.declinedMilestones || [];
    declinedMilestones.push(declinedMilestoneForOwner);

    await ownerMilestonesRef.update({
      requestedMilestones: ownerPendingMilestones,
      declinedMilestones,
    });

    return new Response(
      JSON.stringify({
        message: "Milestone declined successfully",
        declinedMilestoneId: milestoneId,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in milestone decline API:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error", message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};