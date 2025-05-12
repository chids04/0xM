import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { create as createIpfsClient } from "ipfs-http-client";
import { nftContract } from "@/utils/contracts";

const ipfs = createIpfsClient({ url: "http://127.0.0.1:5001" });

export const GET: APIRoute = async ({ url, cookies }) => {
  try {
    // Authenticate user with session cookie
    const auth = getAuth(app);
    const sessionCookie = cookies.get("__session")?.value;
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "AUTH_ERROR", message: "Unauthorized" }
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify the session cookie
    let decodedCookie;
    try {
      decodedCookie = await auth.verifySessionCookie(sessionCookie);
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: "AUTH_ERROR", message: "Invalid session" }
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const userId = decodedCookie.uid;
    const db = getFirestore(app);

    // Get user's NFT token IDs from Firestore
    const nftDoc = await db.collection("users").doc(userId).collection("nft").doc("tokenIDs").get();
    const tokenIDs: string[] = nftDoc.exists && Array.isArray(nftDoc.data()?.tokenIDs) ? nftDoc.data()!.tokenIDs : [];

    if (!tokenIDs.length) {
      return new Response(
        JSON.stringify({ success: true, nfts: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // For each tokenId, get tokenURI and fetch metadata from local IPFS
    const nfts = await Promise.all(tokenIDs.map(async (tokenId) => {
      try {
        const tokenURI = await nftContract.tokenURI(tokenId);
        let metadata = null;
        let ipfsError = false;

        if (tokenURI.startsWith("ipfs://")) {
          try {
            const cid = tokenURI.replace("ipfs://", "");
            // Read from local IPFS node with timeout
            const chunks: Uint8Array[] = [];
            const timeoutController = new AbortController();
            const timeoutId = setTimeout(() => timeoutController.abort(), 3000); // 3 second timeout
            
            try {
              for await (const chunk of ipfs.cat(cid, { signal: timeoutController.signal })) {
                chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
              }
              const buffer = Buffer.concat(chunks);
              metadata = JSON.parse(buffer.toString("utf-8"));
              clearTimeout(timeoutId);
            } catch (ipfsError) {
              console.warn(`IPFS timeout or error for tokenId ${tokenId}:`, ipfsError);
              ipfsError = true;
              // Fallback to gateway
              const fallbackRes = await fetch(`https://ipfs.io/ipfs/${cid}`);
              if (fallbackRes.ok) {
                metadata = await fallbackRes.json();
                ipfsError = false;
              } else {
                throw new Error("Both IPFS node and gateway failed");
              }
            }
          } catch (e) {
            ipfsError = true;
            console.error(`IPFS fetch error for token ${tokenId}:`, e);
          }
        } else {
          // fallback to fetch if not ipfs
          try {
            const metaRes = await fetch(tokenURI);
            if (!metaRes.ok) throw new Error("Failed to fetch metadata from URI");
            metadata = await metaRes.json();
          } catch (e) {
            ipfsError = true;
            console.error(`HTTP fetch error for token ${tokenId}:`, e);
          }
        }

        // Format image URL for frontend display
        let nftImageUrl = "";
        if (metadata?.image && typeof metadata.image === "string") {
          if (metadata.image.startsWith("ipfs://")) {
            // Use both gateway URLs for better availability
            const imageCid = metadata.image.replace("ipfs://", "");
            nftImageUrl = `https://ipfs.io/ipfs/${imageCid}`;
            
            // Check if the image is accessible
            try {
              const imageCheck = await fetch(nftImageUrl, { method: 'HEAD' });
              if (!imageCheck.ok) {
                // Try Cloudflare IPFS gateway as fallback
                nftImageUrl = `https://cloudflare-ipfs.com/ipfs/${imageCid}`;
                ipfsError = true;
              }
            } catch (e) {
              // If checking fails, still use ipfs.io but mark as having issues
              ipfsError = true;
            }
          } else {
            nftImageUrl = metadata.image;
          }
        } else {
          // Missing image in metadata
          nftImageUrl = "/default-nft-image.svg"; // Fallback image
          ipfsError = true;
        }

        return {
          tokenId,
          tokenURI,
          name: metadata?.name || "",
          description: metadata?.description || "",
          milestoneId: metadata?.milestoneId || "",
          nftImageUrl,
          mintedAt: metadata?.mintedAt || null,
          ipfsError, // Flag indicating if there were IPFS loading issues
          metadata
        };
      } catch (err) {
        console.error(`Failed to fetch NFT metadata for tokenId ${tokenId}:`, err);
        // Return minimal NFT info with error flag instead of null
        return {
          tokenId,
          tokenURI: "",
          milestoneId: `Unknown milestone (ID: ${tokenId})`,
          nftImageUrl: "/default-nft-image.svg", // Fallback image
          ipfsError: true
        };
      }
    }));

    const filteredNfts = nfts.filter(Boolean);

    return new Response(
      JSON.stringify({ success: true, nfts: filteredNfts }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching user NFTs:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "SERVER_ERROR", message: "Failed to fetch NFTs" }
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};