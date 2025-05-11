import type { APIRoute } from "astro";
import { buildGaslessApprovalMessage } from "@/utils/txhelpers";
import { tokenContract, forwarderContract, relayerContract } from "@/utils/contracts";
import { createErrorResponse } from "@/utils/ErrorResponse";
import { ethers } from "ethers";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { signature , amount } = await request.json();
    const { v, r, s } = ethers.Signature.from(signature);

    const metaTx = await createMetaTxRequest(
      signer,
      await forwarder.getAddress(),
      forwarder.interface,
      await tokenContract.getAddress(),
      tokenContract.interface,
      'permit',
      [owner, spender, amount, deadline, v, r, s]
    );

    // 6. Submit the request through the relayer
    const tx = await relayer.relayApprove(metaTx);
    const receipt = await tx.wait();

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