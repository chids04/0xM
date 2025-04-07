import type { APIRoute } from "astro";
import { ethers } from "ethers";
import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../../../firebase/server";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export const POST: APIRoute = async ({ request, cookies }) => {

    try{
        const body = await request.json()
        const feesNeeded = body.feeType

        if(feesNeeded !== "milestone" && feesNeeded !== "transfer"){
            return createErrorResponse("CONFIG_ERROR", "Invalid fee type", 400)
        }
        
        const ADMIN_PRIV = import.meta.env.ADMIN_PRIV_KEY
        if(!ADMIN_PRIV){
            return createErrorResponse("SERVER_ERROR", "Admin unavailiable to sign transaction, try again later", 500)
        }

        const relayer_adr = import.meta.env.MILESTONE_RELAYER_ADDRESS
        if (!relayer_adr) {
            return createErrorResponse(
                "CONFIG_ERROR", 
                "Missing relayer address", 
                500
            );
        }

        const relayerABI = import.meta.env.MILESTONE_RELAYER_ABI
        if(!relayerABI){
            return createErrorResponse(
                "CONFIG_ERROR", 
                "Missing relayer contract ABI path, server error", 
                500
            );
        }

        let relayer_abi
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);
            const projectRoot = join(__dirname, '../../../../blockchain');
            const relayerArtifact = JSON.parse(readFileSync(join(projectRoot, relayerABI), 'utf8'));
            relayer_abi = relayerArtifact.abi
            
        } catch (error) {
            console.error("ABI loading error:", error);
            return createErrorResponse(
                "BLOCKCHAIN_ERROR", 
                "Failed to load relayer abi", 
                500
            );
        }

        let adminWallet
        let provider
        try {
            provider = new ethers.JsonRpcProvider(
                import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
            );
            adminWallet = new ethers.Wallet(ADMIN_PRIV, provider);
            
        } catch (error) {
            console.error("Wallet initialization error:", error);
            return createErrorResponse(
                "WALLET_ERROR", 
                "Failed to initialize admin wallet", 
                500
            );
        }

        try{
            const relayerContract = new ethers.Contract(
                relayer_adr,
                relayer_abi,
                adminWallet
            )

            let transferFee: string | undefined;
            let addMilestoneFee: string | undefined;
            let addGroupMilestoneFee: string | undefined;
            let signMilestoneFee: string | undefined;
            let tier1DiscountPercent: number | undefined;
            let tier2DiscountPercent: number | undefined;

            if(feesNeeded == "milestone"){
                [
                    addMilestoneFee, 
                    addGroupMilestoneFee, 
                    signMilestoneFee, 
                    tier1DiscountPercent, 
                    tier2DiscountPercent
                ] = await relayerContract.getMilestoneFees();
            }
            else if (feesNeeded == "transfer"){
                transferFee = await relayerContract.getTransferFee();
            }

            return new Response(
                JSON.stringify({
                    success: true,
                    fees: {
                        transferFee: transferFee ? ethers.formatEther(transferFee) : undefined,
                        addMilestoneFee: addMilestoneFee ? ethers.formatEther(addMilestoneFee) : undefined,
                        addGroupMilestoneFee: addGroupMilestoneFee ? ethers.formatEther(addGroupMilestoneFee) : undefined,
                        signMilestoneFee: signMilestoneFee ? ethers.formatEther(signMilestoneFee) : undefined,
                        tier1DiscountPercent: tier1DiscountPercent !== undefined ? Number(tier1DiscountPercent) : undefined,
                        tier2DiscountPercent: tier2DiscountPercent !== undefined ? Number(tier2DiscountPercent) : undefined
                    }
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        catch(error){
            console.error("Transaction error:", error);
            return createErrorResponse(
                "TRANSACTION_ERROR", 
                `Failed to fetch fees: ${error.message || "Unknown error"}`, 
                500
            );
        }

        
    }
    catch(error){

        console.error(error.message)
        return createErrorResponse(
            "SERVER_ERROR",
            "Server error, try again later",
            501)

    }

    return new Response(
        JSON.stringify({ message: "Succesfully fetched fees" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
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