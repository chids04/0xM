import type { APIRoute } from "astro";
import { ethers } from "ethers";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { relayerContract } from "@/utils/contracts";

export const POST: APIRoute = async ({ request, cookies }) => {

    try{
        const body = await request.json()
        const feesNeeded = body.feeType

        if(feesNeeded !== "milestone" && feesNeeded !== "transfer"){
            return createErrorResponse("CONFIG_ERROR", "Invalid fee type", 400)
        }
        

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
};
