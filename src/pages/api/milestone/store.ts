import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createErrorResponse } from "@/utils/ErrorResponse";


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

    // attach IPFS CIDs to milestone data
    const milestoneDocData = {
        id,
        taggedFriendIds: Array.isArray(taggedFriends) ? taggedFriends.map((f: any) => f.uid) : [],
        owner,
        ipfsCIDs,
        isPending: Array.isArray(taggedFriends) && taggedFriends.length > 0,
    }


    const milestoneRef = db.collection("milestones").doc(id);
    await milestoneRef.set(milestoneDocData);

    // Store in owner's milestones subcollection
    if(milestoneDocData.isPending){
        const pendingRef = db.collection("users").doc(owner).collection("milestones").doc("pending");
        if (!(await pendingRef.get()).exists) {
            await pendingRef.set({ milestoneRefs: [milestoneRef] });
        } else {
            await pendingRef.update({
                milestoneRefs: FieldValue.arrayUnion(milestoneRef),
            });
        }

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

    } else {
        const completedRef = db.collection("users").doc(owner).collection("milestones").doc("accepted");
        if (!(await completedRef.get()).exists) {
            await completedRef.set({ milestoneRefs: [milestoneRef] });
        } else {
            await completedRef.update({
                milestoneRefs: FieldValue.arrayUnion(milestoneRef),
            });
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