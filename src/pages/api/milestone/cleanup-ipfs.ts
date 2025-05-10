import type { APIRoute } from "astro";
import { create as createIpfsClient, CID } from "ipfs-http-client";
import { createErrorResponse } from "@/utils/ErrorResponse";

const ipfs = createIpfsClient({ url: "http://127.0.0.1:5001" });

export const POST: APIRoute = async ({ request }) => {
  try {
    const { metadataCid, imageCid } = await request.json();

    const cleanupCid = async (cid: string | null) => {
      if (!cid) return;
      try {
        const cidObj = CID.parse(cid);
        await ipfs.pin.rm(cidObj);
      } catch {}
      try {
        const cidObj = CID.parse(cid);
        await ipfs.block.rm(cidObj);
      } catch {}
    };

    await Promise.all([
      cleanupCid(metadataCid),
      cleanupCid(imageCid),
    ]);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return createErrorResponse("SERVER_ERROR", error.message || "Unexpected error.", 500);
  }
};