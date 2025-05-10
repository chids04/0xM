import type { APIRoute } from "astro";
import { buildGaslessApprovalMessage } from "@/utils/txhelpers";
import { tokenContract, forwarderContract, relayerContract } from "@/utils/contracts";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { ethers } from "ethers";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { userAddress, amount } = await request.json();

    const { domain, types, message } = await buildGaslessApprovalMessage({
      userAddress,
      spender: await relayerContract.getAddress(),
      amount: ethers.parseEther(amount),
      tokenContract,
      forwarderContract,
    });

    return new Response(
      JSON.stringify({ domain, types, message }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return createErrorResponse("SERVER_ERROR", "Internal server error", 500);
  }
};