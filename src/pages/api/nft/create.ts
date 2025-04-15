import type { APIRoute } from "astro";
import { app } from "../../../firebase/server"
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage, getDownloadURL, Storage } from "firebase-admin/storage";
import { ethers } from "ethers";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { createGaslessApproval } from "../wallet/helpers/GaslessApproval";
import { createMetaTxRequest } from "../wallet/helpers/CreateMetaTx";


const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("missing encryption key");
}

function decryptPrivateKey(encryptedData: string): string {
  const [iv, encrypted] = encryptedData.split(":");
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes.");
  }
  const ivBuffer = Buffer.from(iv, "hex");
  if (ivBuffer.length !== 16) {
    throw new Error("IV must be 16 bytes.");
  }
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, ivBuffer);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function createErrorResponse(code: string, message: string, status: number) {
  console.error(`${code}: ${message}`);
  return new Response(
    JSON.stringify({
      success: false,
      error: { code, message },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let uploadedFile: string | null = null;
  let storage: Storage = getStorage(app);
  
  async function cleanupAndError(code: string, message: string, status: number) {
    // Clean up any uploaded file
    if (uploadedFile && storage) {
      try {
        await storage.bucket("nft-images").file(uploadedFile).delete();
        console.log(`Cleaned up file: ${uploadedFile}`);
      } catch (err) {
        console.error(`Failed to clean up file ${uploadedFile}:`, err);
      }
    }
    // Return error response
    return createErrorResponse(code, message, status);
  }
  
  try {
    // Parse form data
    const formData = await request.formData();
    const imageFile = formData.get("image");
    const milestoneId = formData.get("milestoneId")?.toString();
    const userId = formData.get("userId")?.toString();

    // Validate inputs
    if (!imageFile || !milestoneId || !userId) {
      return createErrorResponse("VALIDATION_ERROR", "Missing required fields.", 400);
    }

    if (!(imageFile instanceof File)) {
      return createErrorResponse("VALIDATION_ERROR", "Invalid image file.", 400);
    }

    // Validate file type and size
    if (!imageFile.type.startsWith("image/")) {
      return createErrorResponse("VALIDATION_ERROR", "Invalid file type. Only images are allowed.", 400);
    }
    if (imageFile.size > 5 * 1024 * 1024) {
      return createErrorResponse("VALIDATION_ERROR", "File size exceeds 5MB limit.", 400);
    }

    // Authenticate user
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return createErrorResponse("AUTH_ERROR", "Unauthorized", 401);
    }

    // Initialize Firebase services early for potential cleanup
    const db = getFirestore(app);
    const auth = getAuth(app);
    
    try {
      const decodedCookie = await auth.verifySessionCookie(sessionCookie);
      if (decodedCookie.uid !== userId) {
        return cleanupAndError("AUTH_ERROR", "User ID mismatch", 403);
      }
    } catch (authError) {
      return cleanupAndError("AUTH_ERROR", "Invalid session", 401);
    }

    // Verify milestone exists
    const milestoneRef = db.collection("milestones").doc(milestoneId);
    const milestoneDoc = await milestoneRef.get();
    if (!milestoneDoc.exists) {
      return cleanupAndError("NOT_FOUND", "Milestone not found.", 404);
    }

    const milestoneData = milestoneDoc.data();
    if (milestoneData?.nftTokenId) {
      return cleanupAndError(
        "ALREADY_EXISTS", 
        `This milestone already has an NFT with token ID ${milestoneData.nftTokenId}`, 
        409
      );
    }

    // Upload image to Firebase Storage
    const bucket = storage.bucket("nft-images");
    const fileName = `nfts/${milestoneId}/${imageFile.name}`;
    const file = bucket.file(fileName);
    uploadedFile = fileName;

    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      await file.save(buffer, {
        metadata: {
          contentType: imageFile.type,
        },
      });
    } catch (uploadError) {
      return cleanupAndError("STORAGE_ERROR", "Failed to upload image.", 500);
    }

    let imageUrl;
    try {
      [imageUrl] = await file.getSignedUrl({
        action: "read",
        expires: "03-01-2500", 
      });
    } catch (urlError) {
      return cleanupAndError("STORAGE_ERROR", "Failed to get image URL.", 500);
    }

    // Load blockchain configuration
    const nftContractAddress = import.meta.env.MILESTONE_NFT_ADDRESS;
    const forwarderAddress = import.meta.env.FORWARDER_ADDRESS;
    const tokenAddress = import.meta.env.MST_TOKEN_ADDRESS;
    const relayerAddress = import.meta.env.MILESTONE_RELAYER_ADDRESS;

    if (!nftContractAddress || !forwarderAddress || !tokenAddress || !relayerAddress) {
      return cleanupAndError("CONFIG_ERROR", "Missing contract addresses.", 500);
    }

    const ADMIN_PRIV = import.meta.env.ADMIN_PRIV_KEY;
    if (!ADMIN_PRIV) {
      return cleanupAndError(
        "SERVER_ERROR",
        "Admin unavailable to sign transaction, try again later",
        500
      );
    }

    const nftABI = import.meta.env.MILESTONE_NFT_ABI;
    const forwarderABI = import.meta.env.FORWARDER_ABI;
    const tokenABI = import.meta.env.MST_TOKEN_ABI;
    const relayerABI = import.meta.env.MILESTONE_RELAYER_ABI;

    if (!nftABI || !forwarderABI || !tokenABI || !relayerABI) {
      return cleanupAndError("CONFIG_ERROR", "Missing contract ABIs.", 500);
    }

    let nft_abi, forwarder_abi, token_abi, relayer_abi;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = join(__dirname, "../../../../blockchain");
      nft_abi = JSON.parse(readFileSync(join(projectRoot, nftABI), "utf8")).abi;
      forwarder_abi = JSON.parse(readFileSync(join(projectRoot, forwarderABI), "utf8")).abi;
      token_abi = JSON.parse(readFileSync(join(projectRoot, tokenABI), "utf8")).abi;
      relayer_abi = JSON.parse(readFileSync(join(projectRoot, relayerABI), "utf8")).abi;
    } catch (error) {
      return cleanupAndError("BLOCKCHAIN_ERROR", "Failed to load contract ABIs.", 500);
    }

    const provider = new ethers.JsonRpcProvider(import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545");

    // Get user's wallet
    const walletDoc = await db
      .collection("users")
      .doc(userId)
      .collection("wallet")
      .doc("wallet_info")
      .get();

    if (!walletDoc.exists) {
      return cleanupAndError("WALLET_ERROR", "User wallet not found.", 400);
    }

    const walletData = walletDoc.data();
    const encryptedPrivKey = walletData?.encryptedPrivateKey;
    if (!encryptedPrivKey) {
      return cleanupAndError("WALLET_ERROR", "User private key not found.", 400);
    }

    let userWallet;
    try {
      userWallet = new ethers.Wallet(decryptPrivateKey(encryptedPrivKey), provider);
    } catch (walletError) {
      return cleanupAndError("WALLET_ERROR", "Failed to initialize user wallet.", 500);
    }
    
    const adminWallet = new ethers.Wallet(ADMIN_PRIV, provider);

    const tokenContract = new ethers.Contract(tokenAddress, token_abi, provider);
    const relayerContract = new ethers.Contract(relayerAddress, relayer_abi, adminWallet);
    const forwarderContract = new ethers.Contract(forwarderAddress, forwarder_abi, provider);
    const nftContract = new ethers.Contract(nftContractAddress, nft_abi, adminWallet);

    let mintFee, balance;
    try {
      mintFee = await relayerContract.mintNFTFee();
      balance = await tokenContract.balanceOf(await userWallet.getAddress());
    } catch (balanceError) {
      return cleanupAndError("BLOCKCHAIN_ERROR", "Failed to check balance or fee.", 500);
    }

    if (mintFee > balance) {
      return cleanupAndError("INSUFFICIENT_FUNDS", "Insufficient token balance for minting.", 400);
    }

    // Gasless approval
    let approvalResult;
    try {
      approvalResult = await createGaslessApproval({
        signer: userWallet,
        tokenContract,
        forwarder: forwarderContract,
        relayer: relayerContract,
        spender: relayerAddress,
        amount: mintFee,
      });
    } catch (approvalError) {
      return cleanupAndError(
        "BLOCKCHAIN_ERROR", 
        `Gasless approval threw an exception: ${(approvalError as Error).message}`, 
        500
      );
    }

    if (!approvalResult.success) {
      return cleanupAndError(
        "BLOCKCHAIN_ERROR", 
        `Gasless approval failed: ${approvalResult.error?.message}`, 
        500
      );
    }

    // Create meta-transaction for minting NFT
    let query;
    try {
      query = await createMetaTxRequest(
        userWallet,
        forwarderAddress,
        forwarder_abi,
        nftContractAddress,
        nft_abi,
        "mintNFT",
        [await userWallet.getAddress(), milestoneId, imageUrl]
      );
    } catch (metaTxError) {
      return cleanupAndError(
        "BLOCKCHAIN_ERROR",
        `Failed to create meta-transaction: ${(metaTxError as Error).message}`,
        500
      );
    }

    // Relay the transaction
    let tx, receipt;
    try {
      tx = await relayerContract.relayMintNFT(query);
      receipt = await tx.wait();
      
      if (receipt.status !== 1) {
        return cleanupAndError("BLOCKCHAIN_ERROR", "NFT minting transaction failed.", 500);
      }
    } catch (txError) {
      return cleanupAndError(
        "BLOCKCHAIN_ERROR",
        `NFT minting transaction error: ${(txError as Error).message}`,
        500
      );
    }

    // Extract token ID from event
    let tokenId;
    try {
      // First try with filters
      const nftEvents = await nftContract.queryFilter(
        nftContract.filters.NFTMinted(await userWallet.getAddress()),
        receipt.blockNumber,
        receipt.blockNumber
      );

      const event = nftEvents.find(e => e.transactionHash === receipt.hash) as ethers.EventLog;
      tokenId = Number(event.args[2])
      console.log("Token ID from event:", tokenId);
      
      
      if (!tokenId) {
        throw new Error("Could not find tokenId in transaction logs");
      }
    } catch (eventError) {
      console.error("Error extracting token ID:", eventError);
      // Continue anyway - we might still have a successful mint even if event extraction fails
      // But log the issue for debugging
      console.log("Transaction receipt:", JSON.stringify(receipt));
      
      // Since we couldn't get the token ID but the transaction was successful,
      // we'll create a record with a placeholder and update it later
      tokenId = "unknown";
    }

    // store NFT data in Firestore
    try {
      await milestoneRef.update({
        nftTokenId: tokenId,
        nftMintedAt: FieldValue.serverTimestamp(),
      });
    } catch (dbError) {
      console.error("Error storing NFT data:", dbError);
    }

    // Clear uploaded file reference since we succeeded
    uploadedFile = null;

    return new Response(
      JSON.stringify({
        success: true,
        message: "NFT minted successfully.",
        transactionHash: receipt.hash,
        tokenId: tokenId
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    // Final cleanup on unhandled errors
    if (uploadedFile && storage) {
      await storage.bucket("nft-images").file(uploadedFile).delete().catch((err) => {
        console.error(`Failed to clean up file ${uploadedFile}:`, err);
      });
    }
    
    console.error("Unhandled error in NFT minting:", error);
    return createErrorResponse(
      "SERVER_ERROR",
      error.message || "An unexpected error occurred while minting the NFT.",
      500
    );
  }
};