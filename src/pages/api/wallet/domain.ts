import type { APIRoute } from "astro";
import {  forwarderContract } from "@/utils/contracts";

export const GET: APIRoute = async ({ url }) => {
    const to = url.searchParams.get("to");
    if (!to) {
        return new Response(
            JSON.stringify({ error: "Missing 'to' (verifyingContract) parameter" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }


    const { name, version, chainId, verifyingContract } = await forwarderContract.eip712Domain();
    
    const domain = { 
        name, 
        version, 
        chainId: Number(chainId), 
        verifyingContract 
    };

    const types = {
        ForwardRequest: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "gas", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint48" },
            { name: "data", type: "bytes" },
        ],
    };

    return new Response(
        JSON.stringify({ domain, types }),
        { status: 200, headers: { "Content-Type": "application/json" } }
    );
};