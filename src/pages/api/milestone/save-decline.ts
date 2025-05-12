import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { create as createIpfsClient, CID } from "ipfs-http-client";
import { trackerContract, adminWallet } from "@/utils/contracts";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { ethers } from "ethers";

const ipfs = createIpfsClient({ url: "http://127.0.0.1:5001" });

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const { milestoneId } = await request.json();
    if (!milestoneId) {
      return createErrorResponse("VALIDATION_ERROR", "Missing milestoneId", 400);
    }

    // Auth
    const auth = getAuth(app);
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return createErrorResponse("AUTH_ERROR", "Unauthorized", 401);
    }
    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch {
      return createErrorResponse("AUTH_ERROR", "Invalid session", 401);
    }

    const db = getFirestore(app);


    const milestoneRef = db.collection("milestones").doc(milestoneId);
    const milestoneDoc = await milestoneRef.get();
    if (!milestoneDoc.exists) {
      return createErrorResponse("NOT_FOUND", "Milestone not found", 404);
    }
    const milestoneData = milestoneDoc.data();
    const ownerUid = milestoneData?.owner;
    const ipfsCIDs = milestoneData?.ipfsCIDs || {};
    const metadataCid = ipfsCIDs.metadataCid || null;
    const imageCid = ipfsCIDs.imageCid || null;

    if (!milestoneData) {
      return createErrorResponse("NOT_FOUND", "Milestone data not found", 404);
    }

    // Get the owner's wallet address from the wallet_info document
    const walletDoc = await db
      .collection("users")
      .doc(ownerUid)
      .collection("wallet")
      .doc("wallet_info")
      .get();

    const ownerAddress = walletDoc.data()?.address || null;

    const milestoneExists = await trackerContract.milestoneExistsFor(ownerAddress, milestoneId);

    if (milestoneExists) {
      return createErrorResponse("BLOCKCHAIN_ERROR", "Milestone has not been deleted", 400);
    }
    // Remove from Firestore
    await milestoneRef.delete();

    // remove from user's milestones subcollections
    const taggedFriendIds: string[] = milestoneData?.taggedFriendIds || [];
    const allUids = [ownerUid, ...taggedFriendIds];

    const userMilestoneTypes = ["pending", "accepted", "signed", "declined"];
    for (const uid of allUids) {
      for (const type of userMilestoneTypes) {
        const userRef = db.collection("users").doc(uid).collection("milestones").doc(type);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
          await userRef.update({
            milestoneRefs: (userDoc.data()?.milestoneRefs || []).filter(
              (ref: any) =>
              (typeof ref === "string"
                ? !ref.endsWith(`/${milestoneId}`)
                : !ref.path.endsWith(`/${milestoneId}`))
            ),
          });
        }
      }
    }

    // remove from IPFS
    const cleanupCid = async (cid: string | null) => {
      if (!cid) return;
      try {
        const cidObj = CID.parse(cid);
        await ipfs.pin.rm(cidObj);
      } catch { }
      try {
        const cidObj = CID.parse(cid);
        await ipfs.block.rm(cidObj);
      } catch { }
    };
    await Promise.all([cleanupCid(metadataCid), cleanupCid(imageCid)]);

    return new Response(
      JSON.stringify({ success: true, message: "Milestone fully removed" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return createErrorResponse("SERVER_ERROR", error.message || "Unexpected error", 500);
  }
};