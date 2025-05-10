import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { create as createIpfsClient } from "ipfs-http-client";
import { relayerContract, adminWallet, tokenContract, 
  trackerContract, forwarderContract  } from "@/utils/contracts"
import { createErrorResponse } from "@/utils/ErrorResponse";
import { CID } from "ipfs-http-client"; // Import CID class

const ipfs = createIpfsClient({ url: "http://127.0.0.1:5001" });


const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("missing encryption key");
}

function hashMilestone(data: any) {
  // Only include fields that are hashd
  const hashableData = {
    id: data.id,
    description: data.description,
    milestone_date: data.milestone_date,
    image: data.image,
    owner: data.owner,
    participants: data.participants,
    taggedFriendIds: data.taggedFriendIds,
    createdAt: data.createdAt,
  };
  return crypto.createHash("sha256").update(JSON.stringify(hashableData)).digest("hex");
}



export const POST: APIRoute = async ({ request, cookies }) => {
  let metadataCid: string | null = null;
  let imageCid: string | null = null;

  try {
    // Parse multipart form data
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

    const uid = decodedCookie.uid;

    // extract form fields
    const formData = await request.formData();

    const description = formData.get("description")?.toString();
    const milestone_date = formData.get("milestone_date")?.toString();
    const fee = formData.get("fee")?.toString();
    const taggedFriendIdsRaw = formData.get("taggedFriendIds")?.toString();
    const taggedFriendIds = taggedFriendIdsRaw ? JSON.parse(taggedFriendIdsRaw) : [];
    const imageFile = formData.get("image");
    const walletAddress = formData.get("walletAddress")?.toString();

    // Validate required fields
    if (!description || !milestone_date || !walletAddress) {
      return createErrorResponse("VALIDATION_ERROR", "Missing required fields.", 400);
    }

    //ensure user has balance
    const bal = await tokenContract.balanceOf(walletAddress);

    const [
      addMilestoneFee,
      addGroupMilestoneFee,
      signMilestoneFee,
      tier1DiscountPercent,
      tier2DiscountPercent,
    ] = await relayerContract.getMilestoneFees();

    let isGroupMs = false;
    if (taggedFriendIds && taggedFriendIds.length > 0) {
      isGroupMs = true;
    }

    if(isGroupMs){
      if(bal < addGroupMilestoneFee){
        return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient funds", 400);
      }
    } else {
      if(bal < addMilestoneFee){
        return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient funds", 400);
      }
    }


    const milestoneId = uuidv4();

    

    console.log("hello")

    // prep milestone data for hashing
    
    let milestoneDataForHash = {
      id: milestoneId,
      description,
      milestone_date,
      image: "",  
      owner: walletAddress,
      participants: [] as string[],
      createdAt: new Date().toISOString(),
    };


    

    //get address of friends
    if (isGroupMs) {
      for (const friendId of taggedFriendIds) {
        const walletRef = db
          .collection("users")
          .doc(friendId)
          .collection("wallet")
          .doc("wallet_info");
        const friendWalletDoc = await walletRef.get();
        const friendUser = await auth.getUser(friendId);
        const email = friendUser.email;
        if (friendWalletDoc.exists) {
          const friendWalletData = friendWalletDoc.data();
          const friendPublicKey = friendWalletData?.address;
          if (friendPublicKey) {
            milestoneDataForHash.participants.push(friendPublicKey);
          }
        } else {
          return createErrorResponse(
            "WALLET_ERROR",
            `${email} is missing a wallet address, tell them to link one.`,
            500
          );
        }
      }
    }

    if (imageFile instanceof File) {
      //validate image type
      if (!imageFile.type.startsWith("image/")) {
        return createErrorResponse("VALIDATION_ERROR", "Invalid file type. Only images are allowed.", 400);
      }
      // Validate file size (5MB limit)
      if (imageFile.size > 5 * 1024 * 1024) {
        return createErrorResponse("VALIDATION_ERROR", "File size exceeds 5MB limit.", 400);
      }

      // save image to ipfs
      const arrayBuffer = await imageFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const imgResult = await ipfs.add(buffer);
      imageCid = imgResult.cid.toString();
      milestoneDataForHash.image = imageCid;

    }
 
    // calc hash with image URL
    const milestoneHash = hashMilestone(milestoneDataForHash);
    const milestoneData = { ...milestoneDataForHash, hash: milestoneHash, isPending: isGroupMs, taggedFriendIds };

    const metaBuffer = Buffer.from(JSON.stringify(milestoneDataForHash));
    const { cid } = await ipfs.add(metaBuffer);
    metadataCid = cid.toString(); 

    let callData;
    let gasEstimate;


    

    if(isGroupMs){
        callData = trackerContract.interface.encodeFunctionData(
            "addGroupMilestone",
            [
                milestoneDataForHash.description,
                milestoneDataForHash.participants,
                milestoneHash,
                milestoneId
            ]
        );

        gasEstimate = await trackerContract.addGroupMilestone.estimateGas(
            milestoneDataForHash.description,
            milestoneDataForHash.participants,
            milestoneHash,
            milestoneId,
            { from: await adminWallet.getAddress() }
        );
    }
    else{
        callData = trackerContract.interface.encodeFunctionData(
          "addMilestone",
          [
            milestoneDataForHash.description,
            milestoneHash,
            milestoneId
          ]
        );

        gasEstimate = await trackerContract.addMilestone.estimateGas(
          milestoneDataForHash.description,
          milestoneHash,
          milestoneId,
          { from: await adminWallet.getAddress() }
      );
      
    }

    console.log("Gas estimate:", gasEstimate.toString());
    const gasEstimateWithBuffer = (gasEstimate * 15n) / 10n;

    const nonce = await forwarderContract.nonces(walletAddress);

    const metaTxRequest = {
        from: walletAddress,
        to: await trackerContract.getAddress(),
        value: "0", // No ETH value
        gas: gasEstimateWithBuffer.toString(), 
        nonce: nonce.toString(),
        deadline: (Math.floor(Date.now() / 1000) + 3600).toString(), // 1 hour from now
        data: callData,
    };

    const ipfsCIDs = { metadataCid, imageCid };


    return new Response(
        JSON.stringify({
            id: milestoneId,
            metaTxRequest,
            ipfsCIDs,
            owner: uid,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );


    // if (isGroupMs) {
    //   if (addGroupMilestoneFee > bal) {
    //     if (uploadedFile) {
    //       await storage.bucket().file(uploadedFile).delete().catch((err) => {
    //         console.error("Failed to clean up image:", err);
    //       });
    //     }
    //     return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient funds", 400);
    //   }
    //   //gasless approval here
    //   const { success, error } = await createGaslessApproval({
    //     signer: userWallet,
    //     tokenContract: token_contract,
    //     forwarder: forwarderContract,
    //     relayer: relayerContract,
    //     spender: await relayerContract.getAddress(),
    //     amount: addGroupMilestoneFee
    //   })

    //   if(!success){
    //     return createErrorResponse("BLOCKCHAIN_ERROR", "Error in gasless approval" + error?.message, 501)
    //   }

      
    // } else {
    //   if (addMilestoneFee > bal) {
    //     // Cleanup image on insufficient funds
    //     if (uploadedFile) {
    //       await storage.bucket().file(uploadedFile).delete().catch((err) => {
    //         console.error("Failed to clean up image:", err);
    //       });
    //     }
    //     return createErrorResponse("INSUFFICIENT_FUNDS", "Insufficient Funds", 400);
    //   }

    //   const { success, error } = await createGaslessApproval({
    //     signer: userWallet,
    //     tokenContract: token_contract,
    //     forwarder: forwarderContract,
    //     relayer: relayerContract,
    //     spender: await relayerContract.getAddress(),
    //     amount: addMilestoneFee
    //   })

    //   if(!success){
    //     return createErrorResponse("BLOCKCHAIN_ERROR", "Error in gasless approval" + error?.message, 501)
    //   }
    // }

    // let query, tx;
    // let isGroup = false;

    // if (!taggedFriendIds || taggedFriendIds.length === 0) {
    //   query = await createMetaTxRequest(
    //     userWallet,
    //     forwarder_adr,
    //     forwarder_abi,
    //     tracker_adr,
    //     tracker_abi,
    //     "addMilestone",
    //     [milestoneDataForHash.description, milestoneHash, milestoneId]
    //   );
    //   tx = await relayerContract.relayAddMilestone(query);
    // } else {
    //   isGroup = true;
    //   query = await createMetaTxRequest(
    //     userWallet,
    //     forwarder_adr,
    //     forwarder_abi,
    //     tracker_adr,
    //     tracker_abi,
    //     "addGroupMilestone",
    //     [milestoneDataForHash.description, milestoneDataForHash.participants, milestoneHash, milestoneId]
    //   );
    //   tx = await relayerContract.relayAddGroupMilestone(query);
    // }

    // console.log("Waiting for transaction to be mined...");
    // const receipt = await tx.wait();
    // console.log("Transaction confirmed:", receipt);

    // if (receipt.status !== 1) {
    //   // Cleanup image on blockchain failure
    //   if (uploadedFile) {
    //     await storage.bucket().file(uploadedFile).delete().catch((err) => {
    //       console.error("Failed to clean up image:", err);
    //     });
    //   }
    //   return createErrorResponse(
    //     "BLOCKCHAIN_TRANSACTION_FAILED",
    //     "Blockchain transaction failed. Milestone not created.",
    //     500
    //   );
    // }

    // let milestoneData = { ...milestoneDataForHash };
    // const milestoneRef = db.collection("milestones").doc(milestoneId);
    // const ownerRef = db.collection("users").doc(uid).collection("milestones");

    // try {
    //   if (isGroup) {
    //     const milestoneForParticipant = {
    //       ...milestoneData,
    //       signatureCount: 0,
    //     };

    //     const jsonBuffer = Buffer.from(JSON.stringify(milestoneForParticipant));  
    //     const { cid: metadataCid } = await  ipfs.add(jsonBuffer);



    //     await milestoneRef.set(milestoneForParticipant);
    //     const pendingRef = ownerRef.doc("pending");

    //     if (!(await pendingRef.get()).exists) {
    //       await pendingRef.set({ milestoneRefs: [milestoneRef] });
    //     } else {
    //       await pendingRef.update({
    //         milestoneRefs: FieldValue.arrayUnion(milestoneRef),
    //       });
    //     }

    //     for (const friendId of taggedFriendIds) {
    //       const friendPendingRef = db
    //         .collection("users")
    //         .doc(friendId)
    //         .collection("milestones")
    //         .doc("pending");
    //       if (!(await friendPendingRef.get()).exists) {
    //         await friendPendingRef.set({ milestoneRefs: [milestoneRef] });
    //       } else {
    //         await friendPendingRef.update({
    //           milestoneRefs: FieldValue.arrayUnion(milestoneRef),
    //         });
    //       }
    //     }
    //   } else {
    //     await milestoneRef.set(milestoneData);
    //     const acceptedRef = ownerRef.doc("accepted");

    //     const jsonBuffer = Buffer.from(JSON.stringify(milestoneData));  
    //     const { cid: metadataCid } = await  ipfs.add(jsonBuffer);

    //     console.log("IPFS CID:", metadataCid.toString());
        

    //     if (!(await acceptedRef.get()).exists) {
    //       await acceptedRef.set({ milestoneRefs: [milestoneRef] });
    //     } else {
    //       await acceptedRef.update({
    //         milestoneRefs: FieldValue.arrayUnion(milestoneRef),
    //       });
    //     }
    //   }
    // } catch (firestoreError) {
    //   // Cleanup image on Firestore failure
    //   if (uploadedFile) {
    //     await storage.bucket().file(uploadedFile).delete().catch((err) => {
    //       console.error("Failed to clean up image:", err);
    //     });
    //   }
    //   throw firestoreError;
    // }

    // // Clear uploadedFile since we succeeded
    // uploadedFile = null;

    // return new Response(
    //   JSON.stringify({
    //     message: "Milestone created and added to blockchain.",
    //     id: milestoneId,
    //     transactionHash: receipt.transactionHash,
    //     blockchainData: {
    //       blockNumber: receipt.blockNumber,
    //       gasUsed: receipt.gasUsed.toString(),
    //     },
    //   }),
    //   { status: 200, headers: { "Content-Type": "application/json" } }
    // );
  } catch (error: any) {
    // Cleanup image on any unhandled error
    const cleanupCid = async (cid: string | null) => {
      if (!cid) return;
      try {
        const cidObj = CID.parse(cid); 
        await ipfs.pin.rm(cidObj); 
        console.log(`Removed pin for CID: ${cid}`);
      } catch (pinError) {
        console.warn(`Failed to remove pin for CID ${cid}:`, pinError);
      }
      try {
        const cidObj = CID.parse(cid); 
        await ipfs.block.rm(cidObj); 
        console.log(`Removed block for CID: ${cid}`);
      } catch (blockError) {
        console.warn(`Failed to remove block for CID ${cid}:`, blockError);
      }
    };

    
    await Promise.all([
      cleanupCid(metadataCid),
      cleanupCid(imageCid),
    ]);

    console.error("Error in POST handler:", error);
    return createErrorResponse("SERVER_ERROR", error.message || "Unexpected error.", 500);
  }
};