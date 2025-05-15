"use client"

import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { useState, useEffect } from 'react'
import { doc, getFirestore, onSnapshot } from "firebase/firestore"
import { app } from "../../firebase/client"
import { getAuth, onAuthStateChanged } from "firebase/auth"


interface UserCardProps {
  user: any;
  photoURL: string;
}

export function UserCard({ user, photoURL }: UserCardProps) {
  const [walletBalance, setWalletBalance] = useState("0.00 MST")
 const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Track current authenticated user
  useEffect(() => {
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // User is signed in
        console.log("Current user ID:", user.uid);
        setCurrentUserId(user.uid);
      } else {
        // User is signed out
        console.log("No user signed in");
        setCurrentUserId(null);
      }
    });
    
    // Clean up the listener on unmount
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // set up real-time listener for this user's document
    const db = getFirestore(app)
    const auth = getAuth(app)
    console.log(auth.currentUser)
    const userRef = doc(db, 'users', user.uid, "wallet", "wallet_info");
    
    const unsubscribe = onSnapshot(userRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        setWalletBalance(data.balance+ " MST" || "0.00 MST");
        console.log(data.balance)
      }
    }, (error) => {
      console.error("Error listening to Firestore updates:", error);
    });

    // cleanup subscription on unmount
    return () => unsubscribe();
  }, [user.uid]);

  

  return (
    <Card className="bg-[#1f1f1f] border-[#333] text-white shadow-lg hover:shadow-xl transition-shadow duration-300 px-4 py-2">
      <CardHeader className="flex flex-row items-center gap-2 py-1.5 px-0">
        <img
          src={photoURL}
          alt={`${user.displayName}'s profile`}
          className="w-8 h-8 rounded-full border border-[#333] flex-shrink-0"
        />
        <div className="flex flex-col overflow-hidden">
          <h3 className="text-sm font-medium text-white break-words">{user.displayName}</h3>
          <p className="text-xs text-green-400">{walletBalance}</p>
        </div>
      </CardHeader>
    </Card>
  )
}