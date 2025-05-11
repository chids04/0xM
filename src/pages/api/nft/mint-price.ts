import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { relayerContract } from "@/utils/contracts";

export const GET: APIRoute = async ({ cookies }) => {
  try {

    // call the mintNFTFee function to get the current price
    const mintNFTFee = await relayerContract.mintNFTFee();
    
    // convert to a readable string format (from wei to ether)
    const mintPriceInEther = ethers.formatEther(mintNFTFee);
    
    console.log(`Retrieved NFT mint price: ${mintPriceInEther} MST`);

    // return the price as a formatted string
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