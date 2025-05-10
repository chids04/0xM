import type { APIRoute } from "astro";
import { buildPermitMessage } from "@/utils/txhelpers";
import { tokenContract, relayerContract } from "@/utils/contracts";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { ethers } from "ethers";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { userAddress, amount } = await request.json();

    const { domain, types, message } = await buildPermitMessage({
      userAddress,
      spender: await relayerContract.getAddress(),
      amount: ethers.parseEther(amount),
      tokenContract,
    });

    return new Response(
      JSON.stringify({ domain, types, message }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return createErrorResponse("SERVER_ERROR", "Internal server error", 500);
  }
};