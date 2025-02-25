import type { APIRoute } from "astro";
import { ethers } from "ethers";
import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY

if(!ENCRYPTION_KEY){
    throw new Error("missing encryption key")
}

const IV: string = import.meta.env.ENCRYPTION_IV;

/**
 * Encrypts a private key using AES-256-CBC encryption.
 * @param {string} privateKey - The private key to encrypt.
 * @returns {string} The encrypted private key.
 */

function encryptPrivateKey(privateKey: string): string {
    
    const key = Buffer.from(ENCRYPTION_KEY, 'hex'); // Ensure key is hex-encoded

    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes.");
    }

    const iv = Buffer.from(IV, 'hex'); // Convert IV to buffer
    if (iv.length !== 16) {
        throw new Error("IV must be 16 bytes.");
    }

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${IV}:${encrypted}`;
  }
  
export const POST: APIRoute = async ({ request }) => {
    const db = getFirestore()

    try {
      const body = await request.json();
      const userId = body?.uid;
  
      if (!userId) {
        return new Response("Missing user ID", { status: 400 });
      }
  
      // Create a random Ethereum wallet
      const wallet = ethers.Wallet.createRandom();
      const publicKey = wallet.address;
  
      // Store wallet in Firestore (or your chosen database)
      await db.collection("users").doc(userId).collection("wallet").doc("wallet_info").set({
        publicKey,
        encryptedPrivateKey: encryptPrivateKey(wallet.privateKey), // Use proper encryption!
      });
  
      return new Response(
        JSON.stringify({ success: true, publicKey }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error("Error creating wallet:", error);
      return new Response("Failed to create wallet", { status: 500 });
    }
  };
  