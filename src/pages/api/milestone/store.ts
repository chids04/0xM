import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { ethers } from "ethers";

import { tokenContract, adminWallet } from "@/utils/contracts";

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const auth = getAuth(app);
    const db = getFirestore(app);

    // Authenticate user
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return createErrorResponse("AUTH_ERROR", "Unauthorized", 401);
    }
    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch (err) {
      return createErrorResponse("AUTH_ERROR", "Invalid session", 401);
    }

    const { id, taggedFriends, ipfsCIDs, owner } = await request.json();
    if (!id || !taggedFriends || !owner || !ipfsCIDs) {
      return createErrorResponse("VALIDATION_ERROR", "Missing required fields.", 400);
    }

    // Attach IPFS CIDs to milestone data
    const milestoneDocData = {
        id,
        taggedFriends,
        owner,
        ipfsCIDs,
        isPending: taggedFriends.length > 0,
    }

    // Check if the user has enough balance

    // Store in main milestones collection
    const milestoneRef = db.collection("milestones").doc(id);
    await milestoneRef.set(milestoneDocData);

    // Store in owner's milestones subcollection
    const ownerRef = db.collection("users").doc(owner).collection("milestones");
    const pendingRef = ownerRef.doc("pending");
    if (!(await pendingRef.get()).exists) {
      await pendingRef.set({ milestoneRefs: [milestoneRef] });
    } else {
      await pendingRef.update({
        milestoneRefs: FieldValue.arrayUnion(milestoneRef),
      });
    }

    // Store in each tagged friend's milestones subcollection
    console.log("Tagged friends:", taggedFriends);
    if (Array.isArray(taggedFriends)) {
      for (const friend of taggedFriends) {
        const uid = friend.uid
        const friendPendingRef = db
          .collection("users")
          .doc(uid)
          .collection("milestones")
          .doc("pending");
        if (!(await friendPendingRef.get()).exists) {
          await friendPendingRef.set({ milestoneRefs: [milestoneRef] });
        } else {
          await friendPendingRef.update({
            milestoneRefs: FieldValue.arrayUnion(milestoneRef),
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in store milestone endpoint:", error);
    return createErrorResponse("SERVER_ERROR", error.message || "Unexpected error.", 500);
  }
};