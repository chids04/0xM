import type { APIRoute } from "astro";
import { ethers } from "ethers";
import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../../../firebase/server";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { createMetaTxRequest } from "./helpers/CreateMetaTx";

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
        
        // Parse request body
        const body = await request.json();
        const { senderAddress, recipientAddress, amount, currentUser, friendUser } = body;

        // Validate required parameters
        if (!senderAddress || !recipientAddress || !amount || !currentUser) {
            return createErrorResponse(
                "INVALID_PARAMS", 
                "Missing required parameters: senderAddress, recipientAddress, amount, and userId are required", 
                400
            );
        }

        const ADMIN_PRIV = import.meta.env.ADMIN_PRIV_KEY
        if(!ADMIN_PRIV){
            return createErrorResponse("SERVER_ERROR", "Admin unavailiable to sign transaction, try again later", 500)
        }

        // Validate amount is positive
        if (amount <= 0) {
            return createErrorResponse(
                "INVALID_AMOUNT", 
                "Amount must be greater than zero", 
                400
            );
        }

        // Get environment variables
        const token_adr = import.meta.env.MST_TOKEN_ADDRESS;
        const relayer_adr = import.meta.env.MILESTONE_RELAYER_ADDRESS
        const forwarder_adr = import.meta.env.FORWARDER_ADDRESS
        
        if (!token_adr || !relayer_adr || !forwarder_adr) {
            return createErrorResponse(
                "CONFIG_ERROR", 
                "Missing token, forwarder or relayer address, SERVER ERROR", 
                500
            );
        }

        // Load ABI
        const mstABI = import.meta.env.MST_TOKEN_ABI;
        const relayerABI = import.meta.env.MILESTONE_RELAYER_ABI
        const forwarderABI = import.meta.env.FORWARDER_ABI
        let token_abi, relayer_abi, forwarder_abi;
        
        if (!mstABI || !relayerABI || !forwarderABI) {
            return createErrorResponse(
                "CONFIG_ERROR", 
                "Missing token, forwader or relayer ABI, SERVER ERROR", 
                500
            );
        }
        
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const projectRoot = join(__dirname, '../../../../blockchain');
            const mstArtifact = JSON.parse(readFileSync(join(projectRoot, mstABI), 'utf8'));
            const relayerArtifact = JSON.parse(readFileSync(join(projectRoot, relayerABI), 'utf8'));
            const forwarderArtifact = JSON.parse(readFileSync(join(projectRoot, forwarderABI), 'utf8'));
            token_abi = mstArtifact.abi;
            relayer_abi = relayerArtifact.abi
            forwarder_abi = forwarderArtifact.abi
            
        } catch (error) {
            console.error("ABI loading error:", error);
            return createErrorResponse(
                "BLOCKCHAIN_ERROR", 
                "Failed to load token, relayer or forwader ABI", 
                500
            );
        }

        // Fetch user's encrypted private key
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

        // Decrypt private key and create wallet
        let userWallet;
        let provider;
        
        try {
            const privateKey = decryptPrivateKey(encryptedPrivateKey);
            provider = new ethers.JsonRpcProvider(
                import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
            );
            userWallet = new ethers.Wallet(privateKey, provider);
            
            // Verify the wallet address matches
            if (userWallet.address.toLowerCase() !== senderAddress.toLowerCase()) {
                return createErrorResponse(
                    "AUTH_ERROR", 
                    "Sender address does not match wallet address", 
                    403
                );
            }
        } catch (error) {
            console.error("Wallet initialization error:", error);
            return createErrorResponse(
                "WALLET_ERROR", 
                "Failed to initialize wallet", 
                500
            );
        }

        
        try{
            const adminWallet = new ethers.Wallet(ADMIN_PRIV, provider)
            // Create contract instance with user wallet
            const token_contract = new ethers.Contract(
                token_adr,
                token_abi,
                userWallet
            );

            const token_contract_admin = new ethers.Contract(
                token_adr,
                token_abi,
                adminWallet
            );

            const relayerContract = new ethers.Contract(
                relayer_adr,
                relayer_abi,
                adminWallet
            )

            const senderBalance = await token_contract.balanceOf(senderAddress);
            const amountToSend = ethers.parseEther(amount.toString());
            
            if (senderBalance < amountToSend) {
                return createErrorResponse(
                    "INSUFFICIENT_FUNDS", 
                    `Insufficient token balance. Available: ${ethers.formatEther(senderBalance)} MST, Requested: ${amount} MST`, 
                    400
                );
            }

            //approve fee first
            const approveTx = await token_contract.approve(
                relayer_adr,
                ethers.parseEther("2")
            )

            await approveTx.wait();

            const txRequest = await createMetaTxRequest(
                userWallet,
                forwarder_adr,
                forwarder_abi,
                token_adr,
                token_abi,
                "transfer",
                [recipientAddress, amountToSend]
                
            )
            

            const tx = await relayerContract.relayTransfer(txRequest)
            const receipt = await tx.wait()

            if (receipt.status !== 1) {
                throw new Error("Transaction Error")
            }
            
            // Get updated sender balance
            const newBalance = await token_contract.balanceOf(senderAddress);
            const formattedBalance = ethers.formatEther(newBalance);
            
            // Update balance in Firebase
            await db.collection("users").doc(currentUser.uid).collection("wallet").doc("wallet_info").update({
                balance: formattedBalance

            });

            // Add transaction details to a global transactions collection
            const transactionRef = db.collection("transactions").doc();
            await transactionRef.set({
                from: senderAddress,
                to: recipientAddress,
                amount: amountToSend.toString(),
                timestamp: new Date().toISOString(),
                txHash: receipt.hash
            });

            // Add a reference to the transaction in the sender's user document
            
            
            return new Response(
                JSON.stringify({ 
                    success: true, 
                    txHash: receipt.hash,
                    balance: formattedBalance
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
            
        } catch (error) {
            console.error("Transaction error:", error);
            return createErrorResponse(
                "TRANSACTION_ERROR", 
                `Failed to send tokens: ${error.message || "Unknown error"}`, 
                500
            );
        }
    } catch (error) {
        console.error("Error processing request:", error);
        return createErrorResponse(
            "SERVER_ERROR", 
            "An unexpected error occurred", 
            500
        );
    }
};
