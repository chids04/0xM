import type { APIRoute } from "astro";
import { ethers } from "ethers";
import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";
import { defineCollection } from "astro:content";
import { datetimeRegex } from "astro:schema";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * Creates a standardized error response
 */
function createErrorResponse(
    code: string, 
    message: string, 
    status: number
) {
    console.error(`${code}: ${message}`);
    return new Response(
        JSON.stringify({ 
            success: false, 
            error: { code, message } 
        }),
        { 
            status, 
            headers: { "Content-Type": "application/json" } 
        }
    );
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const db = getFirestore(app);
    
        const body = await request.json();
        const walletAddress = body.address
    
        if (!walletAddress) {
            return new Response("Missing user wallet", { status: 400 });
        }

        const admin_adr = import.meta.env.ADMIN_ADDRESS;
        const token_adr = import.meta.env.MST_TOKEN_ADDRESS;
        const admin_priv = import.meta.env.ADMIN_PRIV_KEY
        if (!admin_adr || !token_adr || !admin_priv) {
            return createErrorResponse("CONFIG_ERROR", "Missing blockchain configuration", 500);
        }

        // ABI loading with proper error handling
        const abiStoragePath = import.meta.env.MST_TOKEN_ABI;
        let token_abi;
        if (!abiStoragePath) {
            return createErrorResponse("CONFIG_ERROR", "Missing token contract ABI path", 500);
        }
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);

            const projectRoot = join(__dirname, '../../../../blockchain');
            const artifact = JSON.parse(readFileSync(join(projectRoot, abiStoragePath), 'utf8'));
            token_abi = artifact.abi
        } catch (error) {
            console.error("ABI loading error:", error);
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to load token ABI", 500);
        }

        let provider
        let admin: ethers.Wallet
        try{
            provider = new ethers.JsonRpcProvider(
                import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
            );
            admin = new ethers.Wallet(admin_priv, provider)
        } catch(error){
            console.error("Error finding Ethereum node")
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to connect to ethereum node", 500)
        }

        const token_contract = new ethers.Contract(
            token_adr,
            token_abi,
            admin
        )

        const bal = await token_contract.balanceOf(walletAddress)
        const formattedBal = ethers.formatEther(bal)

        return new Response(
            JSON.stringify({ balance: formattedBal }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error checking wallet:", error);
        return new Response("Failed to check wallet", { status: 500 });
    }
};
