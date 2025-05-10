import type { APIRoute } from "astro";
import { buildGaslessApprovalMessage } from "@/utils/txhelpers";
import { tokenContract, forwarderContract, relayerContract, adminWallet } from "@/utils/contracts";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { ethers } from "ethers";
import { record } from "astro:schema";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { signature, payload } = await request.json();

    console.log(signature, payload)

    const { v, r, s } = ethers.Signature.from(signature);

    const message  = payload.message;
    
    const tx = await tokenContract.connect(adminWallet).permit(
        message.owner,
        message.spender,
        message.value,      // Should be a string or BigNumber
        message.deadline,   // Should be a string or BigNumber
        v,
        r,
        s
      );

      console.log(tx)
      const receipt = await tx.wait();

      console.log("tx receipt",receipt)

      if(receipt.status !== 1) {
        return createErrorResponse("SERVER_ERROR", "Internal server error", 500);
      }


    return new Response(
      JSON.stringify({ txHash: receipt.hash }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.log(error)
    return createErrorResponse("SERVER_ERROR", "Internal server error", 500);
  }
};