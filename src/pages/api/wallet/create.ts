import type { APIRoute } from "astro";
import { ethers } from "ethers";
import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY

if(!ENCRYPTION_KEY){
    throw new Error("missing encryption key");
}
    
const IV: string = import.meta.env.ENCRYPTION_IV;
if(!IV){
    throw new Error("missing initalization vector");
}

function encryptPrivateKey(privateKey: string): string {
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes.");
    }

    const iv = Buffer.from(IV, 'hex');
    if (iv.length !== 16) {
        throw new Error("IV must be 16 bytes.");
    }

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${IV}:${encrypted}`;
}
  
export const POST: APIRoute = async ({ request }) => {
    try {
        const db = getFirestore(app);
        const auth = getAuth(app);

        const body = await request.json();
        const userId = body?.uid;
        if (!userId) {
            return createErrorResponse("VALIDATION_ERROR", "Missing user ID", 400);
        }

        const admin_adr = import.meta.env.ADMIN_ADDRESS;
        const token_adr = import.meta.env.MST_TOKEN_ADDRESS;
        const admin_priv = import.meta.env.ADMIN_PRIV_KEY;
        if (!admin_adr || !token_adr || !admin_priv) {
            return createErrorResponse("CONFIG_ERROR", "Missing blockchain configuration", 500);
        }

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
            token_abi = artifact.abi;
        } catch (error) {
            console.error("ABI loading error:", error);
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to load token ABI", 500);
        }

        let user_email;
        try {
            const user_rec = await auth.getUser(userId);
            user_email = user_rec.email;
        } catch (error) {
            console.error("Firebase auth error:", error);
            return createErrorResponse("AUTH_ERROR", "Failed to get user from Firebase", 500);
        }

        let provider;
        let admin: ethers.Wallet;
        try {
            provider = new ethers.JsonRpcProvider(
                import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
            );
            admin = new ethers.Wallet(admin_priv, provider);
        } catch(error) {
            console.error("Error finding Ethereum node:", error);
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to connect to ethereum node", 500);
        }

        // Create wallet first
        let wallet, publicKey;
        try {
            wallet = ethers.Wallet.createRandom(provider);
            publicKey = wallet.address;
        } catch (error) {
            console.error("Wallet creation error:", error);
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to create wallet", 500);
        }

        // Save to Firebase before funding
        try {
            const batch = db.batch();

            const userRef = db.collection("users").doc(userId);
            batch.set(userRef, {
                email: user_email,
                creationDate: new Date()
            });

            const walletRef = db.collection("users").doc(userId).collection("wallet").doc("wallet_info");
            batch.set(walletRef, {
                publicKey,
                encryptedPrivateKey: encryptPrivateKey(wallet.privateKey),
                balance: "0" 
            });

            await batch.commit();
        } catch (error) {
            console.error("Firestore error:", error);
            return createErrorResponse("DATABASE_ERROR", "Failed to save wallet information", 500);
        }

        let formattedBal;
        try {
            const token_contract = new ethers.Contract(
                token_adr,
                token_abi,
                admin
            );
            
            const tx = await token_contract.mint(
                wallet.address,
                ethers.parseEther("100")
            );

            const receipt = await tx.wait();

            const fundTx = await admin.sendTransaction({
                to: wallet.address,
                value: ethers.parseEther("0.001")
            });

            await fundTx.wait();

            if(receipt.status !== 1) {
                throw new Error("Failed to mint MST token");
            }

            const bal = await token_contract.balanceOf(wallet.address);
            formattedBal = ethers.formatEther(bal);

            const walletRef = db.collection("users").doc(userId).collection("wallet").doc("wallet_info");
            await walletRef.update({
                balance: formattedBal
            });
        } catch (error) {
            console.error("Wallet funding error:", error);
            formattedBal = "0"; 
        }

        return new Response(
            JSON.stringify({ success: true, publicKey }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Unhandled error in wallet creation:", error);
        return createErrorResponse("UNKNOWN_ERROR", "Failed to create wallet", 500);
    }
};

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