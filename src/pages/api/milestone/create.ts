import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";

// Import ABI from your compiled contract artifacts
import milestoneTrackerABI from "../../../contracts/MilestonTrackerABI.json";

// Function to hash milestone data for blockchain verification
function hashMilestone(data: any) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const POST: APIRoute = async ({ request, cookies }) => {


  try {
    const data = await request.json();
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
  
    const uid = decodedCookie.uid;
    
    // Expected payload fields: description, milestone_date, image, taggedFriendIds
    const { description, milestone_date, image, taggedFriendIds } = data;
    if (!description || !milestone_date) {
      return new Response(
        JSON.stringify({ error: "Missing required fields." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Prepare milestone data but don't save to Firebase yet
    const db = getFirestore(app);
    
    // Generate a unique ID for the milestone
    const milestoneId = db.collection("milestones").doc().id;
    
    const milestoneData = {
      id: milestoneId,
      description,
      milestone_date,
      image: image || "",
      owner: uid,
      participants: taggedFriendIds || [],
      taggedFriendIds: taggedFriendIds || [],
      isPending: taggedFriendIds?.length > 0,
      createdAt: new Date().toISOString(),
      transactionHash: "",
      blockNumber: 0,
      milestoneIndex: 0,
    };
    
    // generate hash of milestone data for blockchain
    const milestoneHash = hashMilestone(milestoneData);
    
    try {
      // connect to Ethereum network
      const provider = new ethers.JsonRpcProvider(
        import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
      );
      
      // Wallet for signing transactions
      const wallet = new ethers.Wallet(
        import.meta.env.ETHEREUM_PRIVATE_KEY, 
        provider
      );
      
      // Get the address of your deployed proxy contract
      const contractAddress = import.meta.env.MILESTONE_TRACKER_ADDRESS;

      // create contract instance
      const milestoneContract = new ethers.Contract(
        contractAddress,
        milestoneTrackerABI.abi,
        wallet
      );

      let txHash: string;

    console.log(wallet.address);

      let tx;
      
      // Execute the appropriate contract method based on whether there are participants
      if (!taggedFriendIds || taggedFriendIds.length === 0) {
        // Call addMilestone for solo milestones
        tx = await milestoneContract.addMilestone(
          description,
          milestoneHash,
          milestoneId
        );
      } else {
        // Call addGroupMilestone for group milestones
        tx = await milestoneContract.addGroupMilestone(
          description,
          taggedFriendIds, // These should be Ethereum addresses
          milestoneHash,
          milestoneId
        );
      }
      
      // Wait for transaction to be mined
      console.log("Waiting for transaction to be mined...");
      const receipt = await tx.wait();
      console.log("Transaction confirmed:", receipt);
      
      // Add blockchain information to the milestone data
      
      milestoneData.transactionHash = receipt.hash;
      txHash = receipt.hash
      milestoneData.blockNumber = receipt.blockNumber;

      if(receipt.status == 1){

        const events = await milestoneContract.queryFilter(
          milestoneContract.filters.MilestoneAdded(wallet.address), 
          "latest"
        );

        for (const event of events.filter(e => e.transactionHash === receipt.hash)) {
          const { user, milestoneIndex, description, timeStamp, id } = event.args;
          console.log(`Milestone added by ${user}:`);
          console.log(`Milestone Index: ${milestoneIndex}`);
          console.log(`Description: ${description}`);
          console.log(`Timestamp: ${timeStamp}`);
          console.log(`Milestone ID: ${id}`);

          //here i can pass this data to my admin panel, to track transactions
      }
        const milestonesDocRef = db.collection("users").doc(uid).collection("milestones").doc("milestoneData");
        
        // First check if the document exists
        const milestonesDoc = await milestonesDocRef.get();
        
        if (!milestonesDoc.exists) {
          // If document doesn't exist, create it with initial arrays
          if (!taggedFriendIds || taggedFriendIds.length === 0) {
            await milestonesDocRef.set({
              acceptedMilestones: [milestoneData],
              pendingMilestones: []
            });
          } else {
            await milestonesDocRef.set({
              acceptedMilestones: [],
              pendingMilestones: [milestoneData]
            });
          }
        } else {
          if (!taggedFriendIds || taggedFriendIds.length === 0) {

            // for milestones without tagged friends, append to acceptedMilestones
            await milestonesDocRef.update({
              acceptedMilestones: FieldValue.arrayUnion(milestoneData)
            });
          } else {
            // for milestones with tagged friends, append to pendingMilestones
            await milestonesDocRef.update({
              pendingMilestones: FieldValue.arrayUnion(milestoneData)
            });
          }
        }
        
        // if there are tagged friends, create milestone requests for them
        if (taggedFriendIds && taggedFriendIds.length > 0) {
          for (const friendId of taggedFriendIds) {
            const friendRequestRef = db.collection("users").doc(friendId).collection("milestones").doc("milestoneData");
            
            const milestoneRequest = {
              ...milestoneData,
              requestedBy: uid,
              requestDate: new Date().toISOString(),
              status: "pending"
            };
            
            // Check if the friend's milestonesData document exists
            const friendMilestonesDoc = await friendRequestRef.get();
            
            if (!friendMilestonesDoc.exists) {
              // If document doesn't exist, create it with initial structure
              await friendRequestRef.set({
                acceptedMilestones: [],
                pendingMilestones: [],
                requestedMilestones: [milestoneRequest]
              });
            } else {
              // Document exists, so append to requestedMilestones using arrayUnion
              await friendRequestRef.update({
                requestedMilestones: FieldValue.arrayUnion(milestoneRequest)
              });
            }
          }
        }
        
        

        return new Response(
          JSON.stringify({ 
            message: "Milestone created and added to blockchain.", 
            id: milestoneId,
            transactionHash: receipt.transactionHash,
            blockchainData: {
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed.toString()
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      else{
        //blockchain transaction was not succesful

        console.error("Blockchain transaction was unsuccesful")
        return new Response(
          JSON.stringify({ 
            message: "Blockchain transaction failed. Milestone not created.", 
            errorCode: "BLOCKCHAIN_TRANSACTION_FAILED"
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      
    } catch (ethError) {


      console.error("Blockchain transaction failed:", ethError);
      return new Response(
        JSON.stringify({ 
          message: "Blockchain transaction failed. Milestone not created.", 
          error: "Transaction error",
          errorCode: "BLOCKCHAIN_TRANSACTION_FAILED"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
  } catch (error) {

    console.error("Error in API handler:", error);
    return new Response(
      JSON.stringify({ error: "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};