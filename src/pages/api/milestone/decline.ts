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
    const { milestoneId, signature, message } = await request.json();
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

    // Get the user's wallet address from the wallet_info document
    const walletDoc = await db
      .collection("users")
      .doc(decodedCookie.uid)
      .collection("wallet")
      .doc("wallet_info")
      .get();
    const userWalletAddress = walletDoc.data()?.address || null;

    let recoveredAddress;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch (err) {
      return createErrorResponse("SIGNATURE_ERROR", "Invalid signature", 400);
    }
    if (recoveredAddress.toLowerCase() !== userWalletAddress.toLowerCase()) {
      return createErrorResponse("SIGNATURE_ERROR", "Signature does not match wallet address", 401);
    }

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

    if(!milestoneData) {
      return createErrorResponse("NOT_FOUND", "Milestone data not found", 404);
    }

    if (milestoneData && !milestoneData.taggedFriendIds.includes(decodedCookie.uid)) {
      return createErrorResponse("AUTH_ERROR", "Unauthorized to decline milestone", 401);
    }

    // Remove from Firestore
    await milestoneRef.delete();

    // Remove from user's milestones subcollections
    const userMilestoneTypes = ["pending", "accepted", "signed", "declined"];
    for (const type of userMilestoneTypes) {
      const userRef = db.collection("users").doc(ownerUid).collection("milestones").doc(type);
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

    // Remove from IPFS
    const cleanupCid = async (cid: string | null) => {
      if (!cid) return;
      try {
        const cidObj = CID.parse(cid);
        await ipfs.pin.rm(cidObj);
      } catch {}
      try {
        const cidObj = CID.parse(cid);
        await ipfs.block.rm(cidObj);
      } catch {}
    };
    await Promise.all([cleanupCid(metadataCid), cleanupCid(imageCid)]);

    // Remove from smart contract
    // Get owner's wallet address
    const ownerWalletDoc = await db
      .collection("users")
      .doc(ownerUid)
      .collection("wallet")
      .doc("wallet_info")
      .get();
    const ownerAddress = ownerWalletDoc.data()?.address;
    if (!ownerAddress) {
      return createErrorResponse("NOT_FOUND", "Owner wallet address not found", 404);
    }

    // Remove milestone on-chain (adminWallet must be authorized)
    try {
      const tx = await trackerContract.connect(adminWallet).removeMilestone(ownerAddress, milestoneId);
      await tx.wait();
    } catch (err: any) {
      return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to remove milestone from contract: " + err.message, 500);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Milestone fully removed" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return createErrorResponse("SERVER_ERROR", error.message || "Unexpected error", 500);
  }
};