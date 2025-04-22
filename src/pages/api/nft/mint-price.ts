import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

export const GET: APIRoute = async ({ cookies }) => {
  try {
    // Optional authentication - we'll validate the session cookie if present
    // but will still return the price even without authentication
    const sessionCookie = cookies.get("__session")?.value;
    if (sessionCookie) {
      try {
        const auth = getAuth(app);
        await auth.verifySessionCookie(sessionCookie);
        // Session is valid, but we'll proceed regardless
      } catch (error) {
        // Invalid session, but we'll return price anyway
        console.log("Note: Invalid session but proceeding with price request");
      }
    }

    // Load blockchain configuration
    const relayerAddress = import.meta.env.MILESTONE_RELAYER_ADDRESS;
    const relayerABI = import.meta.env.MILESTONE_RELAYER_ABI;
    
    if (!relayerAddress || !relayerABI) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: { code: "CONFIG_ERROR", message: "Missing contract configuration" } 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Load Relayer contract ABI
    let relayer_abi;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const projectRoot = join(__dirname, "../../../../blockchain");
      const relayerArtifact = JSON.parse(readFileSync(join(projectRoot, relayerABI), "utf8"));
      relayer_abi = relayerArtifact.abi;
    } catch (error) {
      console.error("Error loading ABI:", error);
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
    const relayerContract = new ethers.Contract(relayerAddress, relayer_abi, provider);

    // Call the mintNFTFee function to get the current price
    const mintNFTFee = await relayerContract.mintNFTFee();
    
    // Convert to a readable string format (from wei to ether)
    const mintPriceInEther = ethers.formatEther(mintNFTFee);
    
    console.log(`Retrieved NFT mint price: ${mintPriceInEther} MST`);

    // Return the price as a formatted string
    return new Response(
      JSON.stringify({ 
        success: true, 
        price: mintPriceInEther,
        priceWei: mintNFTFee.toString()
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Error fetching NFT mint price:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: { code: "SERVER_ERROR", message: "Failed to fetch NFT mint price" } 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};