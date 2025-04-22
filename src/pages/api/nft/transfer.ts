import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("Missing encryption key");
}

function decryptPrivateKey(encryptedData: string): string {
  const parts = encryptedData.split(':');
  const iv = Buffer.from(parts.shift()!, 'hex');
  const content = Buffer.from(parts.join(':'), 'hex');
  
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc', 
    Buffer.from(ENCRYPTION_KEY), 
    iv
  );
  
  const decrypted = Buffer.concat([
    decipher.update(content),
    decipher.final()
  ]);
  
  return decrypted.toString();
}

function createErrorResponse(code: string, message: string, status: number) {
  return new Response(
    JSON.stringify({ 
      success: false,
      error: { code, message } 
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Parse request body
    const body = await request.json();
    const { tokenId, recipientAddress, userId } = body;

    // Validate required parameters
    if (!tokenId || !recipientAddress || !userId) {
      return createErrorResponse(
        "INVALID_PARAMS", 
        "Missing required parameters: tokenId, recipientAddress, and userId are required", 
        400
      );
    }

    // Authenticate user
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

    // Verify the user is the one making the request
    if (decodedCookie.uid !== userId) {
      return createErrorResponse("AUTH_ERROR", "User ID mismatch", 403);
    }

    // Initialize Firestore
    const db = getFirestore(app);

    // Load blockchain configuration
    const nftContractAddress = import.meta.env.MILESTONE_NFT_ADDRESS;
    const forwarderAddress = import.meta.env.FORWARDER_ADDRESS;
    const tokenAddress = import.meta.env.MST_TOKEN_ADDRESS;
    const relayerAddress = import.meta.env.MILESTONE_RELAYER_ADDRESS;
    const ADMIN_PRIV = import.meta.env.ADMIN_PRIV_KEY;

    if (!nftContractAddress || !forwarderAddress || !tokenAddress || !relayerAddress || !ADMIN_PRIV) {
      return createErrorResponse("CONFIG_ERROR", "Missing contract addresses or admin key", 500);
    }

    // Load ABIs
    let nft_abi, forwarder_abi, token_abi, relayer_abi;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = join(__dirname, "../../../../blockchain");
      
      nft_abi = JSON.parse(
        readFileSync(join(projectRoot, import.meta.env.MILESTONE_NFT_ABI), "utf8")
      ).abi;
      
      forwarder_abi = JSON.parse(
        readFileSync(join(projectRoot, import.meta.env.FORWARDER_ABI), "utf8")
      ).abi;
      
      token_abi = JSON.parse(
        readFileSync(join(projectRoot, import.meta.env.MST_TOKEN_ABI), "utf8")
      ).abi;
      
      relayer_abi = JSON.parse(
        readFileSync(join(projectRoot, import.meta.env.MILESTONE_RELAYER_ABI), "utf8")
      ).abi;
    } catch (error) {
      console.error("ABI loading error:", error);
      return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to load contract ABIs", 500);
    }

    // Get the user's wallet
    let encryptedPrivKey, userAddress;
    try {
      const walletDoc = await db
        .collection("users")
        .doc(userId)
        .collection("wallet")
        .doc("wallet_info")
        .get();

      if (!walletDoc.exists) {
        return createErrorResponse("WALLET_ERROR", "User wallet not found", 404);
      }

      const walletData = walletDoc.data();
      encryptedPrivKey = walletData?.encryptedPrivateKey;
      userAddress = walletData?.publicKey;
      
      if (!encryptedPrivKey || !userAddress) {
        return createErrorResponse("WALLET_ERROR", "Invalid wallet data", 400);
      }
    } catch (dbError) {
      console.error("Database error:", dbError);
      return createErrorResponse("DATABASE_ERROR", "Failed to fetch user wallet", 500);
    }

    // Set up blockchain provider and contracts
    const provider = new ethers.JsonRpcProvider(
      import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
    );

    const userWallet = new ethers.Wallet(decryptPrivateKey(encryptedPrivKey), provider);
    const adminWallet = new ethers.Wallet(ADMIN_PRIV, provider);
    
    const tokenContract = new ethers.Contract(tokenAddress, token_abi, provider);
    const nftContract = new ethers.Contract(nftContractAddress, nft_abi, provider);
    const relayerContract = new ethers.Contract(relayerAddress, relayer_abi, adminWallet);
    const forwarderContract = new ethers.Contract(forwarderAddress, forwarder_abi, provider);

    // Check if the user is the owner of the NFT
    try {
      const nftOwner = await nftContract.ownerOf(tokenId);
      if (nftOwner.toLowerCase() !== userAddress.toLowerCase()) {
        return createErrorResponse(
          "UNAUTHORIZED", 
          "You are not the owner of this NFT", 
          403
        );
      }
    } catch (ownerError) {
      console.error("Error verifying NFT ownership:", ownerError);
      return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to verify NFT ownership", 500);
    }
    
    // Get the transfer fee
    let transferNFTFee;
    try {
      transferNFTFee = await relayerContract.transferNFTFee();
    } catch (feeError) {
      console.error("Error fetching transfer fee:", feeError);
      return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to fetch transfer fee", 500);
    }
    
    // Check if user has enough balance for the fee
    const balance = await tokenContract.balanceOf(userAddress);
    if (balance < transferNFTFee) {
      return createErrorResponse(
        "INSUFFICIENT_FUNDS", 
        `Insufficient balance for transfer fee. Required: ${ethers.formatEther(transferNFTFee)} MST`, 
        400
      );
    }
    
    // Create a signature for token approval (gasless)
    const tokenNonce = await tokenContract.nonces(userAddress);
    const tokenName = await tokenContract.name();
    const chainId = (await provider.getNetwork()).chainId;
    
    const tokenDomainData = {
      name: tokenName,
      version: '1',
      chainId,
      verifyingContract: tokenAddress
    };
    
    const tokenTypes = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
      ]
    };
    
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    const tokenPermitData = {
      owner: userAddress,
      spender: relayerAddress,
      value: transferNFTFee.toString(),
      nonce: tokenNonce.toString(),
      deadline
    };
    
    // Sign the token approval
    const tokenSignature = await userWallet.signTypedData(
      tokenDomainData,
      tokenTypes,
      tokenPermitData
    );

    // Sign NFT approval for the relayer (gasless)
    const forwarderRequest = {
      from: userAddress,
      to: nftContractAddress,
      value: 0,
      gas: 300000, // Gas limit for the approval
      nonce: (await forwarderContract.getNonce(userAddress)).toString(),
      data: nftContract.interface.encodeFunctionData('approve', [relayerAddress, tokenId])
    };

    const forwarderDomain = {
      name: 'MilestoneForwarder',
      version: '1',
      chainId,
      verifyingContract: forwarderAddress
    };

    const forwarderTypes = {
      ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'data', type: 'bytes' }
      ]
    };

    // Sign the NFT approval request
    const nftApprovalSignature = await userWallet.signTypedData(
      forwarderDomain, 
      forwarderTypes, 
      forwarderRequest
    );

    // Now prepare the relayer call with all the gasless transactions
    try {
      const tx = await relayerContract.executeTransferNFT(
        // Token permit data
        {
          owner: userAddress,
          spender: relayerAddress,
          value: transferNFTFee.toString(),
          nonce: tokenNonce.toString(),
          deadline,
          v: parseInt(tokenSignature.slice(130, 132), 16),
          r: '0x' + tokenSignature.slice(2, 66),
          s: '0x' + tokenSignature.slice(66, 130)
        },
        // NFT approval request
        forwarderRequest,
        nftApprovalSignature,
        // NFT transfer details
        tokenId,
        recipientAddress
      );
      
      const receipt = await tx.wait();
      
      if (receipt.status !== 1) {
        return createErrorResponse(
          "BLOCKCHAIN_ERROR", 
          "NFT transfer transaction failed", 
          500
        );
      }
      
      // Update the NFT ownership in Firestore
      try {
        const milestonesWithNFT = await db.collection("milestones")
          .where("nftTokenId", "==", tokenId.toString())
          .limit(1)
          .get();
          
        if (!milestonesWithNFT.empty) {
          const milestoneDoc = milestonesWithNFT.docs[0];
          await milestoneDoc.ref.update({
            nftOwnedBy: recipientAddress,
            lastTransferred: FieldValue.serverTimestamp(),
            previousOwner: userAddress
          });
          
          console.log(`Updated milestone ${milestoneDoc.id} with new NFT owner: ${recipientAddress}`);
        }
      } catch (dbError) {
        // This is not critical, so we'll just log the error but continue
        console.error("Error updating NFT ownership in Firestore:", dbError);
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          message: "NFT transferred successfully",
          transactionHash: receipt.hash,
          tokenId,
          from: userAddress,
          to: recipientAddress
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (txError: any) {
      console.error("Transaction error:", txError);
      
      // Extract more detailed error if available
      const errorMessage = txError.reason || txError.message || "Unknown error occurred during transfer";
      
      return createErrorResponse(
        "BLOCKCHAIN_ERROR", 
        `Transfer failed: ${errorMessage}`, 
        500
      );
    }
  } catch (error: any) {
    console.error("Unhandled error in NFT transfer:", error);
    return createErrorResponse(
      "SERVER_ERROR", 
      error.message || "An unexpected error occurred during the NFT transfer", 
      500
    );
  }
};