import type { APIRoute } from "astro";
import { ethers } from "ethers";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../../../firebase/server";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as crypto from "crypto";

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if(!ENCRYPTION_KEY){
  throw new Error("missing encryption key");
}

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
function decryptPrivateKey(encryptedData: string): string {
    const [iv, encrypted] = encryptedData.split(":");
    const key = Buffer.from(ENCRYPTION_KEY, "hex");
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes.");
    }
    const ivBuffer = Buffer.from(iv, "hex");
    if (ivBuffer.length !== 16) {
        throw new Error("IV must be 16 bytes.");
    }
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, ivBuffer);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

export const POST: APIRoute = async ({ request }) => {
    try {
        const db = getFirestore(app);
        const body = await request.json();
        const { address, tier, user } = body;

        // Validate input
        if (!address || !ethers.isAddress(address)) {
            return createErrorResponse("INVALID_INPUT", "Invalid wallet address", 400);
        }
        if (tier !== 1 && tier !== 2) {
            return createErrorResponse("INVALID_INPUT", "Invalid tier selection (must be 1 or 2)", 400);
        }

        // Get configuration
        const tokenAddress = import.meta.env.MST_TOKEN_ADDRESS;
        const adminPrivateKey = import.meta.env.ADMIN_PRIV_KEY;
        if (!tokenAddress || !adminPrivateKey) {
            return createErrorResponse("CONFIG_ERROR", "Missing blockchain configuration", 500);
        }

        // Load token ABI
        const tokenABIPath = import.meta.env.MST_TOKEN_ABI;
        if (!tokenABIPath) {
            return createErrorResponse("CONFIG_ERROR", "Missing token contract ABI path", 500);
        }

        let tokenABI;
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const projectRoot = join(__dirname, '../../../../blockchain');
            const artifact = JSON.parse(readFileSync(join(projectRoot, tokenABIPath), 'utf8'));
            tokenABI = artifact.abi;
        } catch (error) {
            console.error("ABI loading error:", error);
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to load token ABI", 500);
        }

        let encryptedPrivKey;
        const walletDoc = await db
            .collection("users")
            .doc(user.uid)
            .collection("wallet")
            .doc("wallet_info")
            .get();

        if (walletDoc.exists) {
            const walletData = walletDoc.data();
            encryptedPrivKey = walletData?.encryptedPrivateKey;
            const walletAddress = walletData?.publicKey
            console.log(walletAddress, address)
        } else {
            return createErrorResponse("WALLET_MISSING", "User wallet not found", 400)
        }

        // Setup provider and signer
        let provider;
        let adminWallet, userWallet;
        try {
            provider = new ethers.JsonRpcProvider(
                import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
            );
            adminWallet = new ethers.Wallet(adminPrivateKey, provider);
            userWallet = new ethers.Wallet(decryptPrivateKey(encryptedPrivKey), provider)
        } catch (error) {
            console.error("Ethereum connection error:", error);
            return createErrorResponse("BLOCKCHAIN_ERROR", "Failed to connect to Ethereum node", 500);
        }

        // Create contract instance
        const tokenContractUser = new ethers.Contract(
            tokenAddress,
            tokenABI,
            userWallet
        );

        const tokenContractAdmin = new ethers.Contract(
            tokenAddress,
            tokenABI,
            adminWallet
        )

        const sendTx = await adminWallet.sendTransaction({
            to: await userWallet.getAddress(),
            value: ethers.parseEther("0.1")
        })

        await sendTx.wait()

        // Check current balance
        const balance = await tokenContractAdmin.balanceOf(address);
        const tierCost = tier === 1 ? 
            ethers.parseEther("100") : // 100 MST for Tier 1
            ethers.parseEther("500");  // 500 MST for Tier 2

        if (balance < tierCost) {
            return createErrorResponse(
                "INSUFFICIENT_BALANCE", 
                `Insufficient MST balance. Required: ${ethers.formatEther(tierCost)} MST`,
                400
            );
        }
        else{
            await tokenContractUser.approve(
                await adminWallet.getAddress(),
                tierCost
            )
        }

        // Execute subscription transaction
        try {
            const tx = await tokenContractAdmin.subscribe(address, tier);
            const receipt = await tx.wait();
 
            if(receipt.status !== 1){
                return createErrorResponse("BLOCKCHAIN_ERROR", "Subscription Failed", 500)
            }

            const subscriptionData = await tokenContractAdmin.subscriptions(await userWallet.getAddress())
            
            console.log(Number(subscriptionData[0]))

            return new Response(
                JSON.stringify({
                    success: true,
                    transactionHash: receipt.hash,
                    tier: tier === 1 ? "Tier1" : "Tier2"
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" }
                }
            );
        } catch (error) {
            console.error("Subscription transaction error:", error);
            return createErrorResponse(
                "TRANSACTION_FAILED",
                `Failed to process subscription: ${error.message}`,
                500
            );
        }

    } catch (error) {
        console.error("Subscription endpoint error:", error);
        return createErrorResponse(
            "INTERNAL_ERROR",
            "Failed to process subscription request",
            500
        );
    }
};