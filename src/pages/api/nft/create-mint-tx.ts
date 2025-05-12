import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { create as createIpfsClient } from "ipfs-http-client";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { forwarderContract, adminWallet, nftContract, relayerContract, tokenContract } from "@/utils/contracts";

const ipfs = createIpfsClient({ url: "http://127.0.0.1:5001" });

export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        // Parse form data
        const formData = await request.formData();
        const imageFile = formData.get("image");
        const milestoneId = formData.get("milestoneId")?.toString();
        const userId = formData.get("userId")?.toString();
        const milestoneDescription = formData.get("milestoneDescription")?.toString() || "";

        if (!imageFile || !milestoneId || !userId) {
            return createErrorResponse("VALIDATION_ERROR", "Missing required fields.", 400);
        }
        if (!(imageFile instanceof File)) {
            return createErrorResponse("VALIDATION_ERROR", "Invalid image file.", 400);
        }
        if (!imageFile.type.startsWith("image/")) {
            return createErrorResponse("VALIDATION_ERROR", "Invalid file type. Only images are allowed.", 400);
        }
        if (imageFile.size > 5 * 1024 * 1024) {
            return createErrorResponse("VALIDATION_ERROR", "File size exceeds 5MB limit.", 400);
        }

        // Auth
        const auth = getAuth(app);
        const db = getFirestore(app);
        const sessionCookie = cookies.get("__session")?.value;
        if (!sessionCookie) {
            return createErrorResponse("AUTH_ERROR", "Unauthorized", 401);
        }
        let decodedCookie;
        try {
            decodedCookie = await auth.verifySessionCookie(sessionCookie);
            if (decodedCookie.uid !== userId) {
                return createErrorResponse("AUTH_ERROR", "User ID mismatch", 403);
            }
        } catch {
            return createErrorResponse("AUTH_ERROR", "Invalid session", 401);
        }

        // Get user's wallet address
        const walletDoc = await db
            .collection("users")
            .doc(userId)
            .collection("wallet")
            .doc("wallet_info")
            .get();

        if (!walletDoc.exists) {
            return createErrorResponse("WALLET_ERROR", "User wallet not found.", 400);
        }
        const walletDocData = walletDoc.data();
        if (!walletDocData?.address) {
            return createErrorResponse("WALLET_ERROR", "User wallet address not found.", 400);
        }
        const userWalletAddress = walletDocData.address;

        const mintNFTFee = await relayerContract.mintNFTFee(); // returns BigInt
        const userBalance = await tokenContract.balanceOf(userWalletAddress);
        if (userBalance < mintNFTFee) {
            return createErrorResponse("INSUFFICIENT_BALANCE", "Insufficient MST balance to mint NFT.", 403);
        }


        // Upload image to IPFS
        let imageCid, imageIpfsUrl;
        try {
            const arrayBuffer = await imageFile.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const imgResult = await ipfs.add(buffer);
            imageCid = imgResult.cid.toString();
            await ipfs.pin.add(imgResult.cid);
            imageIpfsUrl = `ipfs://${imageCid}`;
        } catch (err) {
            return createErrorResponse("IPFS_ERROR", "Failed to upload image to IPFS.", 500);
        }

        // --- ERC721 Metadata JSON ---
        const metadataJson = {
            name: `Milestone #${milestoneId}`,
            description: milestoneDescription,
            image: imageIpfsUrl,
            milestoneId: milestoneId
        };

        // Upload metadata JSON to IPFS
        let metadataCid, metadataURI;
        try {
            const metaBuffer = Buffer.from(JSON.stringify(metadataJson));
            const { cid } = await ipfs.add(metaBuffer);
            metadataCid = cid.toString();
            await ipfs.pin.add(cid);
            metadataURI = `ipfs://${metadataCid}`;
        } catch (err) {
            return createErrorResponse("IPFS_ERROR", "Failed to upload metadata to IPFS.", 500);
        }

        console.log("Metadata URI:", metadataURI);
        // Blockchain config


        const callData = nftContract.interface.encodeFunctionData("mintNFT", [
            userWalletAddress,
            metadataURI
        ]);

        // Estimate gas
        let gasEstimate;
        try {
            gasEstimate = await nftContract.mintNFT.estimateGas(
                userWalletAddress,
                metadataURI,
                { from: await adminWallet.getAddress() }
            );
        } catch {
            gasEstimate = 500000n; // fallback
        }
        const gasEstimateWithBuffer = (gasEstimate * 15n) / 10n;

        // Nonce
        const nonce = await forwarderContract.nonces(userWalletAddress);

        // Meta-tx request
        const metaTxRequest = {
            from: userWalletAddress,
            to: await nftContract.getAddress(),
            value: "0",
            gas: gasEstimateWithBuffer.toString(),
            nonce: nonce.toString(),
            deadline: (Math.floor(Date.now() / 1000) + 3600).toString(),
            data: callData,
        };

        // EIP712 domain and types
        const { name, version, chainId, verifyingContract } = await forwarderContract.eip712Domain();
        const domain = { name, version, chainId: Number(chainId), verifyingContract };
        const types = {
            ForwardRequest: [
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "gas", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint48" },
                { name: "data", type: "bytes" },
            ],
        };

        return new Response(
            JSON.stringify({
                metaTxRequest,
                domain,
                types,
                metadataURI,
                imageIpfsUrl
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error: any) {
        console.error("Error in create-mint-tx API:", error);
        return new Response(
            JSON.stringify({ error: "Internal Server Error", message: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
};