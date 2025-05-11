import type { APIRoute } from "astro";
import { trackerContract } from "@/utils/contracts";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { ethers } from "ethers";
import { getAuth } from "firebase-admin/auth";

export const POST: APIRoute = async ({ request, cookies }) => {
    try{
        const { milestoneId, blockNumber, hash } = await request.json();

        if(!milestoneId || !blockNumber || !hash) {
            return new Response(
                JSON.stringify({ message: "Missing required fields" }), 
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }
        const auth = getAuth(app);

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

        const db = getFirestore(app);
        const milestoneRef = db.collection("milestones").doc(milestoneId);
        const milestoneDoc = await milestoneRef.get();
        if (!milestoneDoc.exists) {
            return createErrorResponse("NOT_FOUND", "Milestone not found", 404);
        }
        const milestoneData = milestoneDoc.data();
        if (!milestoneData) {
            return createErrorResponse("NOT_FOUND", "Milestone data not found", 404);
        }
        const ownerUid = milestoneData.owner;
        const ownerDoc = db.collection("users").doc(ownerUid).collection("wallet").doc("wallet_info");
        const ownerDocSnap = await ownerDoc.get();
        const ownerDocData = ownerDocSnap.data();

        if (!ownerDocData) {
            return createErrorResponse("NOT_FOUND", "Owner wallet not found", 404);
        }

        const ownerAddress = ownerDocData.address;
        if (!ownerAddress) {
            return createErrorResponse("NOT_FOUND", "Owner address not found", 404);
        }


        const finalizedEvents = await trackerContract.queryFilter(
            trackerContract.filters.MilestoneFinalized(ownerAddress, milestoneId),
            blockNumber,
            blockNumber
        );

        const finalizedEvent = finalizedEvents.find(e => e.transactionHash === hash);
        const isFinalized = !!finalizedEvent;
        
        // Firestore operations
        const batch = db.batch();
        
        // Helper function to update milestone refs
        const updateMilestoneRefs = async (userUid: string, fromDoc: string, toDoc: string, milestonePath: any) => {
            const fromRef = db.collection("users").doc(userUid).collection("milestones").doc(fromDoc);
            const toRef = db.collection("users").doc(userUid).collection("milestones").doc(toDoc);
        
            // Get the 'from' document (e.g., pending)
            const fromDocSnap = await fromRef.get();
            if (fromDocSnap.exists) {
            const fromData = fromDocSnap.data();
            if (fromData?.milestoneRefs) {
                const updatedRefs = fromData.milestoneRefs.filter(ref =>
                typeof ref === 'string' ? !ref.endsWith(`/${milestoneId}`) : !ref.path.endsWith(`/${milestoneId}`)
                );
                batch.update(fromRef, { milestoneRefs: updatedRefs });
            }
            }
        
            // Get or create the 'to' document (e.g., signed or accepted)
            const toDocSnap = await toRef.get();
            const milestoneDocRef = db.collection("milestones").doc(milestoneId);

            if (!toDocSnap.exists) {
            batch.set(toRef, { milestoneRefs: [milestoneDocRef] });
            } else {
            batch.update(toRef, { milestoneRefs: FieldValue.arrayUnion(milestoneDocRef) });
            }
        };

        // update the owner's documents if milestone is finalized
        if (isFinalized) {
        // move from pending to accepted for both user and owner
        await updateMilestoneRefs(currentUserUid, "pending", "accepted", milestoneRef.path);
        await updateMilestoneRefs(ownerUid, "pending", "accepted", milestoneRef.path);
        batch.update(milestoneRef, {
            isPending: false,
            signatureCount: FieldValue.increment(1),
        });
        } else {
        // move from pending to signed for current user only
        await updateMilestoneRefs(currentUserUid, "pending", "signed", milestoneRef.path);
        // Owner's pending stays unchanged
        batch.update(milestoneRef, {
            signatureCount: FieldValue.increment(1),
        });
        }
        
        // Commit all changes atomically
        await batch.commit();

        return new Response(
            JSON.stringify({ success: true, message: "Signature saved successfully", isFinalized: isFinalized }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );  

    }catch (error) {
        console.error("Error in save-signature.ts:", error);
        return createErrorResponse("SERVER_ERROR", "Internal server error: " + (error as Error).message, 500);
    }
}