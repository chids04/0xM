import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

export const GET: APIRoute = async ({ url, cookies }) => {
  try {
    // Get user ID from query parameter
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: { code: "MISSING_PARAMETER", message: "User ID is required" } 
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Authenticate user with session cookie
    const auth = getAuth(app);
    const sessionCookie = cookies.get("__session")?.value;
    
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: { code: "AUTH_ERROR", message: "Unauthorized" } 
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify the session cookie
    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: { code: "AUTH_ERROR", message: "Invalid session" } 
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Firebase services
    const db = getFirestore(app);

    // Get user's wallet address
    let userWalletAddress;
    try {
      const walletDoc = await db
        .collection("users")
        .doc(userId)
        .collection("wallet")
        .doc("wallet_info")
        .get();

      if (!walletDoc.exists) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: { code: "WALLET_ERROR", message: "User wallet not found" } 
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      userWalletAddress = walletDoc.data()?.publicKey;
      if (!userWalletAddress) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: { code: "WALLET_ERROR", message: "User wallet address not found" } 
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      
      console.log(`User wallet address: ${userWalletAddress}`);
    } catch (error) {
      console.error("Error retrieving wallet address:", error);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: { code: "WALLET_ERROR", message: "Failed to retrieve user wallet" } 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Load blockchain configuration
    const nftContractAddress = import.meta.env.MILESTONE_NFT_ADDRESS;
    const nftABI = import.meta.env.MILESTONE_NFT_ABI;
    
    if (!nftContractAddress || !nftABI) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: { code: "CONFIG_ERROR", message: "Missing contract configuration" } 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Load NFT contract ABI
    let nft_abi;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = join(__dirname, "../../../../blockchain");
      const nftArtifact = JSON.parse(readFileSync(join(projectRoot, nftABI), "utf8"));
      nft_abi = nftArtifact.abi;
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: { code: "BLOCKCHAIN_ERROR", message: "Failed to load contract ABI" } 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize blockchain provider and contract
    const provider = new ethers.JsonRpcProvider(
      import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
    );
    const nftContract = new ethers.Contract(nftContractAddress, nft_abi, provider);

    // Query Firestore for all milestones with NFTs (may include others' milestones)
    // This approach lets us find NFTs transferred to this user
    const milestonesWithNFTsQuery = db.collection("milestones")
      .where("nftOwnedBy", "==", userWalletAddress)
      .limit(50); // Add a reasonable limit
      
    const milestonesWithNFTsSnapshot = await milestonesWithNFTsQuery.get();
    
    let nfts = [];
    
    if (!milestonesWithNFTsSnapshot.empty) {
      // Process milestones that have NFTs owned by this user
      const nftPromises = milestonesWithNFTsSnapshot.docs.map(async (doc) => {
        const milestone = { id: doc.id, ...(doc.data() as { nftTokenId?: string; nftImageUrl?: string; nftMintedAt?: any }) };
        
        // Skip if no tokenId (shouldn't happen with our query, but just in case)
        if (!milestone.nftTokenId) return null;
        
        try {
          // Get NFT metadata from smart contract
          const [milestoneId, imageUrl] = await nftContract.getNFTMetadata(milestone.nftTokenId);
          
          return {
            tokenId: milestone.nftTokenId,
            milestoneId: milestone.id,
            nftImageUrl: imageUrl,
            mintedAt: milestone.nftMintedAt ? 
              new Date(milestone.nftMintedAt.toDate()).toISOString() : 
              undefined,
          };
        } catch (error) {
          console.error(`Failed to get NFT data for token ${milestone.nftTokenId}:`, error);
          
          // Fallback to the image URL in the milestone if available
          if (milestone.nftImageUrl) {
            return {
              tokenId: milestone.nftTokenId,
              milestoneId: milestone.id,
              nftImageUrl: milestone.nftImageUrl,
              mintedAt: milestone.nftMintedAt ? 
                new Date(milestone.nftMintedAt.toDate()).toISOString() : 
                undefined,
            };
          }
          
          return null;
        }
      });
      
      nfts = (await Promise.all(nftPromises)).filter(nft => nft !== null);
    }
    
    console.log(`Found ${nfts.length} NFTs owned by user's wallet ${userWalletAddress}`);
    
    return new Response(
      JSON.stringify({ success: true, nfts }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Error fetching user NFTs:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: { code: "SERVER_ERROR", message: "Failed to fetch NFTs" } 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};