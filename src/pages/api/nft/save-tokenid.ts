import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import { nftContract, provider } from "@/utils/contracts";
import { createErrorResponse } from "@/utils/ErrorResponse";


export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        const { txHash, blockNum } = await request.json();

        if (!txHash || !blockNum) {
            return new Response(
                JSON.stringify({ message: "Missing required fields" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

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

        const userId = decodedCookie.uid;


        // Fetch transaction receipt
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) {
            return createErrorResponse("NOT_FOUND", "Transaction receipt not found", 404);
        }

        // Find the NFTMinted event in the receipt logs
        const contractAddress = (await nftContract.getAddress()).toLowerCase();
        const nftMintedEventObj = nftContract.interface.getEvent("NFTMinted");
        if (!nftMintedEventObj) {
            return createErrorResponse("NOT_FOUND", "NFTMinted event not found in contract interface", 404);
        }
        const nftMintedEventTopic = nftMintedEventObj.topicHash;
        const nftMintedEvent = receipt.logs.find((log) => {
            // check if the log is from the NFT contract and matches the NFTMinted event
            return (
                log.address.toLowerCase() === contractAddress &&
                log.topics[0] === nftMintedEventTopic
            );
        });

        if (!nftMintedEvent) {
            return createErrorResponse("NOT_FOUND", "NFTMinted event not found for this transaction", 404);
        }

        // Parse the event to extract tokenId
        const parsedEvent = nftContract.interface.parseLog(nftMintedEvent);
        const tokenId = parsedEvent?.args?.tokenId?.toString();
        if (!tokenId) {
            return createErrorResponse("NOT_FOUND", "Token ID not found in event", 404);
        }

        // Save tokenId to Firestore
        const db = getFirestore(app);
        const nftDoc = db.collection("users").doc(userId).collection("nft").doc("tokenIDs");
        await nftDoc.set({ tokenIDs: FieldValue.arrayUnion(tokenId) }, { merge: true });

        return new Response(
            JSON.stringify({ success: true, tokenId }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error in save-tokenid.ts:", error);
        return createErrorResponse("SERVER_ERROR", "Internal server error: " + (error as Error).message, 500);
    }
};