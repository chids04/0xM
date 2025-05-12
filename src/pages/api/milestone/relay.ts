
import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { relayerContract, tokenContract, adminWallet } from "@/utils/contracts";
import { ethers } from "ethers";


export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        const { metaTx, type } = await request.json();

        const { from, to, value, gas, nonce, deadline, data, signature } = metaTx;
        if (!from || !to || !value || !gas || !nonce || !deadline || !data || !signature) {
            return new Response(
                JSON.stringify({ error: "Missing required transaction fields" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        //verify session
        const sessionCookie = cookies.get("__session")?.value;
        if (!sessionCookie) {   
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }
        let decodedCookie;
        try {
            const auth = getAuth(app);
            decodedCookie = await auth.verifySessionCookie(sessionCookie);
        } catch (error) {  
            return new Response(
                JSON.stringify({ error: "Invalid session" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        let tx;
        console.log(metaTx, type)
        if(type == "solo"){
            tx = await relayerContract.relayAddMilestone(metaTx)
        }
        else if(type == "group"){
            tx = await relayerContract.relayAddGroupMilestone(metaTx)
        }
        else if(type == "sign"){
            tx = await relayerContract.relaySignMilestone(metaTx)
        }
        else if(type == "decline") {
            tx = await relayerContract.relayRemoveMilestone(metaTx)
        }
        else if(type == "transfer"){
            tx = await relayerContract.relayTransfer(metaTx)
        }
        else if(type=="subscribe"){
            tx = await relayerContract.relaySubscribe(metaTx)
        }
        else if(type=="mintNFT"){     
            tx = await relayerContract.relayMintNFT(metaTx)
        } else {
            return createErrorResponse("INVALID_TYPE", "Invalid transaction type", 400);
        }


        const receipt = await tx.wait();

        if (receipt.status !== 1) {
            return createErrorResponse("BLOCKCHAIN_ERROR", "Internal server error", 500);
        }

        return new Response(
            JSON.stringify({ success: true, txHash: receipt.hash, blockNum: receipt.blockNumber }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
        

    } catch (error) {
        console.error("Error in relay.ts:", error);
        return createErrorResponse("SERVER_ERROR", "Internal server error: " + (error as Error).message, 500);
    }
};
