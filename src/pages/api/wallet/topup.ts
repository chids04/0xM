import type { APIRoute } from "astro";
import { ethers } from "ethers";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";

import { createErrorResponse } from "@/utils/ErrorResponse";
import { tokenContract, adminWallet } from "@/utils/contracts";



export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        const body = await request.json();
        const amount = body.amount

        const db = getFirestore(app);
        const auth = getAuth(app);

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

        const walletDoc = db.collection("users").doc(uid).collection("wallet").doc("wallet_info");
        const walletDocSnap = await walletDoc.get();
        const walletDocData = walletDocSnap.data();
        if (!walletDocData) {
            return createErrorResponse("NOT_FOUND", "Wallet data not found", 404);
        }

        const walletAddress = walletDocData.address;


        const tx = await tokenContract.connect(adminWallet).topUp(walletAddress, ethers.parseEther(amount))
        const receipt = await tx.wait()

        if(receipt.status !== 1){
            throw new Error("Transaction error")
        }

        const newBal = await tokenContract.balanceOf(walletAddress)

        //update firebase doc here
        await walletDoc.update({ balance: ethers.formatEther(newBal) });

        return new Response(
            JSON.stringify({
                success: true,
                balance: ethers.formatEther(newBal)
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error checking wallet:", error);
        return createErrorResponse("SERVER_ERROR", "Error topping up wallet, try again later", 500);
    }
};
