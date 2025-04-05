"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ethers } from 'ethers'

interface WalletBalanceProps {
  walletAddress: string  // Required prop
}

// Accept the prop with destructuring
export function WalletBalance({ walletAddress }: WalletBalanceProps) {
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const fetchWalletData = async () => {
            try {
                setLoading(true);
                
                // Call your API endpoint to get balance
                const response = await fetch('/api/wallet/balance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: walletAddress })
                });
                
                if (!response.ok) {
                    throw new Error('Failed to fetch balance');
                }
                
                const data = await response.json();

                if (data) {
                    // Convert from wei to ether and then to number
                    setBalance(parseFloat(data.balance));
                } else {
                    throw new Error(data.error || 'Failed to get balance');
                }
            } catch (error) {
                console.error('Error fetching wallet data:', error);
                setError(error.message || 'Could not load balance');
            } finally {
                setLoading(false);
            }
        };
        
        fetchWalletData();
        
        // Refresh every 30 seconds
        const intervalId = setInterval(fetchWalletData, 30000);
        
        return () => clearInterval(intervalId);
    }, [walletAddress]); // Re-run when wallet address changes

    // Format balance to always show 2 decimal places
    const formattedBalance = balance.toFixed(2);
    
    // Truncate wallet address for display
    return (
        <Card className="bg-[#1a1a1a] border border-purple-500/20 shadow-lg overflow-hidden">
            <CardContent className="p-6">
                <div className="flex flex-col items-center">
                    <div className="mb-2 text-gray-400 text-sm">Your Balance</div>
                    
                    {loading ? (
                        <div className="h-12 flex items-center justify-center">
                            <div className="h-5 w-5 border-2 border-t-purple-500 rounded-full animate-spin"></div>
                        </div>
                    ) : error ? (
                        <div className="text-red-400 text-sm">{error}</div>
                    ) : (
                        <div className="text-4xl font-bold text-white mb-2">
                            {formattedBalance} <span className="text-purple-400">MST</span>
                        </div>
                    )}
                    
                    <div className="mt-4 text-center">
                        <div className="text-xs text-gray-500 mb-1">Wallet Address</div>
                        <div className="flex items-center justify-center">
                            <code className="bg-[#111] text-gray-300 p-2 rounded text-xs break-all">
                                {walletAddress}
                            </code>
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
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}