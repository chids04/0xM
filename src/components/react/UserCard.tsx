"use client"

import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { useState, useEffect } from 'react'
import { doc, getFirestore, onSnapshot } from "firebase/firestore"
import { app } from "../../firebase/client"

interface UserCardProps {
  user: any;
  photoURL: string;
}

export function UserCard({ user, photoURL }: UserCardProps) {
  const [walletBalance, setWalletBalance] = useState("0.00 MST")

  useEffect(() => {
    // Set up real-time listener for this user's document
    const db = getFirestore(app)
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

    // Cleanup subscription on unmount
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