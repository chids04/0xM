import type { APIRoute } from "astro";
import { tokenContract, adminWallet } from "@/utils/contracts";
import { ethers } from "ethers";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { address } = await request.json();

    if (!address || !ethers.isAddress(address)) {
      return new Response(JSON.stringify({ error: "Invalid address" }), { status: 400 });
    }

    const tx = await tokenContract.connect(adminWallet).mint(
      address,
      ethers.parseEther("100")
    );
    const receipt = await tx.wait();

    return new Response(
      JSON.stringify({ txHash: receipt.hash }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Airdrop failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};