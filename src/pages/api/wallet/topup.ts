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
        const currentUser = body.user
        const amount = body.amount
    
        if (!currentUser) {
            return new Response("Missing user details", { status: 400 });
        }

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
        let encryptedPrivateKey;
        try {
            const walletRef = db.collection("users").doc(currentUser.uid).collection("wallet").doc("wallet_info");
            const walletDoc = await walletRef.get();
            
            if (!walletDoc.exists) {
                return createErrorResponse(
                    "NOT_FOUND", 
                    "Wallet not found for this user", 
                    404
                );
            }
            
            const walletData = walletDoc.data();
            encryptedPrivateKey = walletData?.encryptedPrivateKey;
            
            if (!encryptedPrivateKey) {
                return createErrorResponse(
                    "DATA_ERROR", 
                    "Encrypted private key not found", 
                    500
                );
            }
        } catch (error) {
            console.error("Database error:", error);
            return createErrorResponse(
                "DATABASE_ERROR", 
                "Failed to retrieve wallet from database", 
                500
            );
        }
            
        let provider
        let admin: ethers.Wallet
        let userWallet: ethers.Wallet
        try{
            provider = new ethers.JsonRpcProvider(
                import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
            );
            admin = new ethers.Wallet(admin_priv, provider)
            userWallet = new ethers.Wallet(decryptPrivateKey(encryptedPrivateKey), provider)
        } catch(error){
            console.error("Error finding Ethereum node")
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to connect to ethereum node", 500)
        }

        const token_contract = new ethers.Contract(
            token_adr,
            token_abi,
            admin
        )
        
        const tx = await token_contract.mint(await userWallet.getAddress(), ethers.parseEther(amount))
        const receipt = await tx.wait()

        if(receipt.status !== 1){
            throw new Error("Transaction error")
        }

        const newBal = await token_contract.balanceOf(await userWallet.getAddress())

        //update firebase doc here
        const walletDoc = db.collection("users").doc(currentUser.uid).collection("wallet").doc("wallet_info");
        await walletDoc.update({ balance: ethers.formatEther(newBal) });

        return new Response(
            JSON.stringify({ 
                success: true, 
                balance: ethers.formatEther(newBal) }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error checking wallet:", error);
        return new Response("Failed to check wallet", { status: 500 });
    }
};
