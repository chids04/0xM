
import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getAuth } from "firebase-admin/auth";

import { tokenContract } from "@/utils/contracts";


const ENCRYPTION_KEY: string = import.meta.env.ENCRYPTION_KEY;
if(!ENCRYPTION_KEY){
    throw new Error("missing encryption key");
}

export const POST: APIRoute = async ({ request, cookies }) => {
    try {
    
        const body = await request.json();
        const userAddress = body.address
    
        const sessionCookie = cookies.get("__session")?.value;
        if (!sessionCookie) {   
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }
        let decodedCookie;
        try {
            const auth = getAuth(app);
            decodedCookie = await auth.verifySessionCookie(sessionCookie);
        } catch (error) {  
            return new Response(
                JSON.stringify({ error: "Invalid session" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }
        
        const subscriptionData = await tokenContract.subscriptions(userAddress)
        const tierNames = ['Free', 'Tier1', 'Tier2'];
        const writeLimit = Number(subscriptionData[0]) === 0 ? 5 : 
                          Number(subscriptionData[0]) === 1 ? 50 : 'Unlimited';
        const readLimit = Number(subscriptionData[0]) === 0 ? 20 : 'Unlimited';
        
        // Calculate next reset date
        const lastResetTimestamp = Number(subscriptionData[3]);
        const lastReset = new Date(lastResetTimestamp * 1000);
        const nextReset = new Date(lastReset);

        nextReset.setDate(nextReset.getDate() + 30); 
        const subscription = {
            tier: Number(subscriptionData[0]), 
            tierName: tierNames[Number(subscriptionData[0])],
            writesUsed: Number(subscriptionData[1]),
            readsUsed: Number(subscriptionData[2]),
            lastReset: lastResetTimestamp,
            nextReset: Math.floor(nextReset.getTime() / 1000),
            writeLimit,
            readLimit,
            writesRemaining: writeLimit === 'Unlimited' ? 'Unlimited' : 
                            Math.max(0, writeLimit - Number(subscriptionData[1])),
            readsRemaining: readLimit === 'Unlimited' ? 'Unlimited' : 
                           Math.max(0, readLimit - Number(subscriptionData[2])),
            isNewUser: lastResetTimestamp === 0
        };

        return new Response(
            JSON.stringify({ 
                success: true, 
                subscription: subscription 
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error checking wallet:", error);
        return new Response(
            JSON.stringify({ 
                success: false, 
                error: { 
                    code: "BLOCKCHAIN_ERROR", 
                    message: "Failed to retrieve subscription details" 
                } 
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
};

