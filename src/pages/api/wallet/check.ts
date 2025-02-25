import type { APIRoute } from "astro";
import { getFirestore } from "firebase-admin/firestore";

export const POST: APIRoute = async ({ request }) => {
    
    const db = getFirestore()

    try {
      const body = await request.json();
      const userId = body?.uid;
  
      if (!userId) {
        return new Response("Missing user ID", { status: 400 });
      }
  
      // Check if the wallet exists
      const walletCollection = db.collection("users").doc(userId).collection("wallet")
      const walletSnapshot = await walletCollection.get()
      const hasWallet = !walletSnapshot.empty;
  
      return new Response(
        JSON.stringify({ hasWallet }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Error checking wallet:", error);
      return new Response("Failed to check wallet", { status: 500 });
    }
  };