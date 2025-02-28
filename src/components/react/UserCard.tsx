"use client"

import { Card, CardHeader, CardContent } from "@/components/ui/card"

interface UserCardProps {
  userName: string;
  photoURL: string;
  walletBalance?: string; // Optional wallet balance prop
}

export function UserCard({ userName, photoURL, walletBalance = "0.00 ETH" }: UserCardProps) {
  return (
    <Card className="w-48 bg-[#1f1f1f] border-[#333] text-white shadow-lg hover:shadow-xl transition-shadow duration-300">
      <CardHeader className="flex flex-row items-center gap-2 py-1.5 px-2">
        <img
          src={photoURL}
          alt={`${userName}'s profile`}
          className="w-8 h-8 rounded-full border border-[#333] flex-shrink-0"
        />
        <div className="flex flex-col overflow-hidden">
          <h3 className="text-sm font-medium text-white break-words">{userName}</h3>
          <p className="text-xs text-green-400">{walletBalance}</p>
        </div>
      </CardHeader>
    </Card>
  )
}