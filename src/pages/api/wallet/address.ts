import type { APIRoute } from "astro";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { app } from "../../../firebase/server";

export const GET: APIRoute = async ({ request }) => {
  try {
    const db = getFirestore(app);
    const auth = getAuth(app);

    const url = new URL(request.url);
    const uid = url.searchParams.get("uid");

    if (!uid) {
      return new Response(
        JSON.stringify({ message: "Missing user ID" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const walletRef = db
      .collection("users")
      .doc(uid)
      .collection("wallet")
      .doc("wallet_info");
    const walletDoc = await walletRef.get();

    if (!walletDoc.exists) {
      return new Response(
        JSON.stringify({ message: "Wallet not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const walletData = walletDoc.data();
    const address = walletData?.publicKey;

    if (!address) {
      return new Response(
        JSON.stringify({ message: "Public key not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ address }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error getting wallet address:", error);
    return new Response(
      JSON.stringify({ message: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};