import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

import milestoneTrackerABI from "../../../contracts/MilestonTrackerABI.json";
const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;

// Function to hash milestone data for blockchain verification
function hashMilestone(data: any) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function decryptPrivateKey(encryptedData: string): string {
    const [iv, encrypted] = encryptedData.split(":");
    
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes.");
    }

    const ivBuffer = Buffer.from(iv, 'hex');
    if (ivBuffer.length !== 16) {
        throw new Error("IV must be 16 bytes.");
    }

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, ivBuffer);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
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
    
    // generate a unique ID for the milestone
    const milestoneId = uuidv4();
    
    //this is for firebase
    const milestoneData = {
      id: milestoneId,
      description,
      milestone_date,
      image: image || "",
      owner: uid,
      participants: [] as string[], 
      taggedFriendIds: taggedFriendIds || [],
      isPending: taggedFriendIds?.length > 0,
      createdAt: new Date().toISOString(),
      hash: ""
    };
    
    
    try {
      // connect to Ethereum network
      const provider = new ethers.JsonRpcProvider(
        import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
      );
      
    
      // Wallet for signing transactions

      //get encrypted priv key from firebase

      let encryptedPrivKey
      const walletDoc = await db.collection("users").doc(uid).collection("wallet").doc("wallet_info").get()

      if(walletDoc.exists){
        const walletData = walletDoc.data()
        encryptedPrivKey = walletData?.encryptedPrivateKey
      }


      //send some eth to account, wallet not implemented yet so do this for now
      const testWallet = new ethers.Wallet(
        import.meta.env.ETHEREUM_PRIVATE_KEY,
        provider
      )

      const wallet = new ethers.Wallet(
        decryptPrivateKey(encryptedPrivKey), 
        provider
      );

      const sendMoney = await testWallet.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("1.0")
      })

      console.log("sending funds")
      await sendMoney.wait();
      console.log("funds sent");
 
      
      // Get the address of your deployed proxy contract
      const contractAddress = import.meta.env.MILESTONE_TRACKER_ADDRESS;

      if (taggedFriendIds && taggedFriendIds.length > 0) {
        for (const friendId of taggedFriendIds) {
          //also need to get the the pub key of the particpants,
          const walletRef = db.collection("users").doc(friendId).collection("wallet").doc("wallet_info")
          const walletDoc = await walletRef.get()
          const friendUser = await auth.getUser(friendId);
          const email = friendUser.email

          if(walletDoc.exists){
            const walletData = walletDoc.data();
            const friendPublicKey = walletData?.publicKey;

            if(friendPublicKey){
              milestoneData.participants.push(friendPublicKey);
            }
          }

          else{
            return new Response(
              JSON.stringify({ 
                message: email + " is missing a private / public key, tell them to generate one in settings", 
                errorCode: "BLOCKCHAIN_TRANSACTION_FAILED"
              }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        }
      }

      // create contract instance
      const milestoneContract = new ethers.Contract(
        contractAddress,
        milestoneTrackerABI.abi,
        wallet
      );


      let tx;
      let isGroup = false;


      const milestoneHash = hashMilestone(milestoneData);
      milestoneData.hash = milestoneHash

      // Execute the appropriate contract method based on whether there are participants
      if (!taggedFriendIds || taggedFriendIds.length === 0) {
        // Call addMilestone for solo milestones
        tx = await milestoneContract.addMilestone(
          milestoneData.description,
          milestoneHash,
          milestoneId
        );
      } else {
        // Call addGroupMilestone for group milestones
        isGroup = true;
        tx = await milestoneContract.addGroupMilestone(
          milestoneData.description,
          milestoneData.participants, // These should be Ethereum addresses
          milestoneHash,
          milestoneId
        );
      }
      
      // Wait for transaction to be mined
      console.log("Waiting for transaction to be mined...");
      const receipt = await tx.wait();
      console.log("Transaction confirmed:", receipt);

      

      if(receipt.status == 1){

        let events;
        //filter events by wallet address
        if(!isGroup){
          events = await milestoneContract.queryFilter(
          milestoneContract.filters.MilestoneAdded(wallet.address),
          "latest"
        )

        console.log("added event filter")
        }else{
          events = await milestoneContract.queryFilter(
            milestoneContract.filters.GroupMilestoneAdded(wallet.address),
            "latest"
          )
        }


        //then filter by transaction hash for the specific transaction
        for (const event of events.filter(e => e.transactionHash === receipt.hash)) {

          if(!isGroup){
            const parsedLog = milestoneContract.interface.parseLog(event)

            if (!parsedLog || !parsedLog.args) {
              console.error("Parsed log is null or missing args");
              continue;
            }
            const { user, id, description, timeStamp } = parsedLog.args;
            console.log(`Milestone added by ${user}:`);
            console.log(`Description: ${description}`);
            console.log(`Timestamp: ${timeStamp}`);
            console.log(`Milestone ID: ${id}`);

          }
          else{
            const parsedLog = milestoneContract.interface.parseLog(event)

            if (!parsedLog || !parsedLog.args) {
              console.error("Parsed log is null or missing args");
              continue;
            }
 
            const { user, id, description, timeStamp, particpantCount } = parsedLog.args;
            console.log(`Milestone added by ${user}:`);
            console.log(`Description: ${description}`);
            console.log(`Timestamp: ${timeStamp}`);
            console.log(`Milestone ID: ${id}`);
            console.log(`Particpant Count: ${particpantCount}`)

            for (const friendId of taggedFriendIds) {
              const friendRequestRef = db.collection("users").doc(friendId).collection("milestones").doc("milestoneData");
              
              const milestoneRequest = {
                ...milestoneData,
                requestedBy: uid,
                requestDate: new Date().toISOString(),
                status: "pending",
                transactionHash: receipt.hash, // Include blockchain transaction info
                blockNumber: receipt.blockNumber
              };
              
              const friendMilestonesDoc = await friendRequestRef.get();
              
              if (!friendMilestonesDoc.exists) {
                await friendRequestRef.set({
                  acceptedMilestones: [],
                  pendingMilestones: [],
                  requestedMilestones: [milestoneRequest]
                });
              } else {
                await friendRequestRef.update({
                  requestedMilestones: FieldValue.arrayUnion(milestoneRequest)
                });
              }
            }
            
          }


          //here i can pass this data to my admin panel, to track transactions for now i just write to firebase

          const milestonesDocRef = db.collection("users").doc(uid).collection("milestones").doc("milestoneData");
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

        //if here then no event was emitted, blockchain error

        console.error("No Milestone added event was recieved")
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

  return new Response(
    JSON.stringify({ error: "Unknown error occurred" }),
    { status: 500, headers: { "Content-Type": "application/json" } }
  );

  
};