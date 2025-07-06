import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { from, to, amount, txHash, timestamp, blockNumber } = await request.json();

    if (!from || !to || !amount || !txHash || !timestamp) {
      return new Response(
        JSON.stringify({ error: "Missing required transaction fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }


    const db = getFirestore(app);
    const transactionRef = db.collection("transactions").doc();
    await transactionRef.set({
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      amount: amount.toString(),
      txHash,
      blockNumber,
      timestamp,
    });
    return new Response(
      JSON.stringify({ success: true, id: transactionRef.id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Failed to save transaction" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};