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

    try {
      const decodedCookie = await auth.verifySessionCookie(sessionCookie);
      // We allow the user to view their own NFTs or others' NFTs
      // You can restrict this if needed
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

    // Query Firestore for the user's milestones with NFTs
    const userAcceptedRef = db.collection("users").doc(userId).collection("milestones").doc("accepted");
    const userAcceptedDoc = await userAcceptedRef.get();
    
    let nfts = [];
    
    if (userAcceptedDoc.exists) {
      const data = userAcceptedDoc.data();
      const milestoneRefs = data?.milestoneRefs || [];
      
      // Fetch all milestone data
      const milestonesData = await Promise.all(milestoneRefs.map(async (ref) => {
        let milestoneRef;
        if (typeof ref === 'string') {
          const pathParts = ref.split('/');
          if (pathParts.length >= 2) {
            milestoneRef = db.collection(pathParts[0]).doc(pathParts[1]);
          }
        } else {
          milestoneRef = ref;
        }
        
        if (milestoneRef) {
          const doc = await milestoneRef.get();
          if (doc.exists) {
            return { id: doc.id, ...doc.data() };
          }
        }
        return null;
      }));
      
      // Filter for milestones with NFTs and get NFT data
      const nftPromises = milestonesData
        .filter(m => m && m.nftTokenId)
        .map(async (milestone) => {
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
            return null;
          }
        });
      
      nfts = (await Promise.all(nftPromises)).filter(nft => nft !== null);
    }
    
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