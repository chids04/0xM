"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ethers } from 'ethers'

export function WalletBalance() {
    const [balance, setBalance] = useState(0);
    const [walletAddress, setWalletAddress] = useState("")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")

    useEffect(() => {
        const fetchWalletData = async () => {
        }
    })
  // Format balance to always show 2 decimal places
  const formattedBalance = balance.toFixed(2);
  
  // Truncate wallet address for display
  const shortenedAddress = walletAddress ? 
    `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}` : 
    "No wallet";

  return (
    <Card className="bg-[#1a1a1a] border border-purple-500/20 shadow-lg overflow-hidden">
      <CardContent className="p-6">
        <div className="flex flex-col items-center">
          <div className="mb-2 text-gray-400 text-sm">Your Balance</div>
          <div className="text-4xl font-bold text-white mb-2">
            {formattedBalance} <span className="text-purple-400">MST</span>
          </div>
          
          <div className="mt-4 text-center">
            <div className="text-xs text-gray-500 mb-1">Wallet Address</div>
            <div className="flex items-center justify-center">
              <code className="bg-[#111] text-gray-300 p-2 rounded text-xs break-all">
                {walletAddress || "Wallet not created"}
              </code>
              {walletAddress && (
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(walletAddress);
                    alert("Address copied to clipboard!");
                  }}
                  className="ml-2 text-purple-400 hover:text-purple-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}