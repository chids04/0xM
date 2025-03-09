import type { APIRoute } from "astro";
import { ethers } from "ethers";
import * as crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";
import { defineCollection } from "astro:content";
import { datetimeRegex } from "astro:schema";


//if a new user, we create a wallet key pair and store some user e-mail and account creation date

const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY

if(!ENCRYPTION_KEY){
    throw new Error("missing encryption key");
}

const IV: string = import.meta.env.ENCRYPTION_IV;
if(!IV){
  throw new Error("missing initalization vector");
}

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
  try {
    const db = getFirestore(app);
    const auth = getAuth(app);

    const body = await request.json();
    const userId = body?.uid;

    if (!userId) {
      return new Response("Missing user ID", { status: 400 });
    }

    //get user email
    let user_email;
    try{
      const user_rec = await auth.getUser(userId)
      user_email = user_rec.email
    }
    catch(error){
      if (error instanceof Error) {
        console.log("error getting user email from firebase" + error.message);
      }

      return new Response("failed to get user from firebase", { status: 500 })
    }

    // Create a random Ethereum wallet
    const wallet = ethers.Wallet.createRandom();
    const publicKey = wallet.address;

    //batch the transactions so it is atomic, cant have user email and no wallet

    const batch = db.batch()

    const userRef = db.collection("users").doc(userId)
    batch.set(userRef, {
      email: user_email,
      creationDate: new Date()
    })

    // Store wallet in Firestore
    const walletRef = db.collection("users").doc(userId).collection("wallet").doc("wallet_info")
    batch.set(walletRef, {
      publicKey,
      encryptedPrivateKey: encryptPrivateKey(wallet.privateKey),
    });

    await batch.commit()
    
    return new Response(
      JSON.stringify({ success: true, publicKey }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in user creation process:", error);
    // You can check for specific error types if needed
    if (error instanceof Error) {
      if (error.message.includes("Encryption key must be 32 bytes") || 
          error.message.includes("IV must be 16 bytes")) {
        return new Response("Server error", { status: 500 });
      }
    }
    return new Response("Failed to create wallet", { status: 500 });
  }
};
