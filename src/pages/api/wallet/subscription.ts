
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

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if(!ENCRYPTION_KEY){
    throw new Error("missing encryption key");
}


/**
 * Decrypts a private key using AES-256-CBC encryption.
 * @param {string} encryptedPrivateKey - The encrypted private key.
 * @returns {string} The decrypted private key.
 */
function decryptPrivateKey(encryptedPrivateKey: string): string {
    const [ivHex, encryptedData] = encryptedPrivateKey.split(':');
    
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes.");
    }

    const iv = Buffer.from(ivHex, 'hex');
    if (iv.length !== 16) {
        throw new Error("IV must be 16 bytes.");
    }

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}


export const POST: APIRoute = async ({ request }) => {
    try {
        const db = getFirestore(app);
    
        const body = await request.json();
        const userAddress = body.address
    

        const token_adr = import.meta.env.MST_TOKEN_ADDRESS;
        const admin_priv = import.meta.env.ADMIN_PRIV_KEY
        if ( !token_adr || !admin_priv) {
            return createErrorResponse("CONFIG_ERROR", "Missing blockchain configuration", 500);
        }

        // ABI loading with proper error handling
        const tokenABI = import.meta.env.MST_TOKEN_ABI;
        let token_abi;
        if (!tokenABI) {
            return createErrorResponse("CONFIG_ERROR", "Missing token contract ABI path", 500);
        }
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);

            const projectRoot = join(__dirname, '../../../../blockchain');
            const artifact = JSON.parse(readFileSync(join(projectRoot, tokenABI), 'utf8'));
            token_abi = artifact.abi
        } catch (error) {
            console.error("ABI loading error:", error);
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to load token ABI", 500);
        }

        //get user private key
        
            
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
            provider
        )

        
        
        const subscriptionData = await token_contract.subscriptions(userAddress)
        const tierNames = ['Free', 'Tier1', 'Tier2'];
        const writeLimit = Number(subscriptionData[0]) === 0 ? 5 : 
                          Number(subscriptionData[0]) === 1 ? 50 : 'Unlimited';
        const readLimit = Number(subscriptionData[0]) === 0 ? 20 : 'Unlimited';
        
        // Calculate next reset date
        const lastResetTimestamp = Number(subscriptionData[3]);
        const lastReset = new Date(lastResetTimestamp * 1000);
        const nextReset = new Date(lastReset);

        nextReset.setDate(nextReset.getDate() + 30); 
        const subscription = {
            tier: Number(subscriptionData[0]), 
            tierName: tierNames[Number(subscriptionData[0])],
            writesUsed: Number(subscriptionData[1]),
            readsUsed: Number(subscriptionData[2]),
            lastReset: lastResetTimestamp,
            nextReset: Math.floor(nextReset.getTime() / 1000),
            writeLimit,
            readLimit,
            writesRemaining: writeLimit === 'Unlimited' ? 'Unlimited' : 
                            Math.max(0, writeLimit - Number(subscriptionData[1])),
            readsRemaining: readLimit === 'Unlimited' ? 'Unlimited' : 
                           Math.max(0, readLimit - Number(subscriptionData[2])),
            isNewUser: lastResetTimestamp === 0
        };

        console.log(subscription)

        return new Response(
            JSON.stringify({ 
                success: true, 
                subscription: subscription 
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error checking wallet:", error);
        return new Response(
            JSON.stringify({ 
                success: false, 
                error: { 
                    code: "BLOCKCHAIN_ERROR", 
                    message: "Failed to retrieve subscription details" 
                } 
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
};

