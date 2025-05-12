"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ethers } from 'ethers'
import { getFirestore } from "firebase/firestore"
import { app } from "../../../firebase/client"
import { doc, updateDoc } from "firebase/firestore";
import { StaticClientAddressNotAvailable } from "node_modules/astro/dist/core/errors/errors-data";

interface WalletBalanceProps {
  currentUser: any
}

export function WalletBalance({ currentUser }: WalletBalanceProps) {
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [topUpAmount, setTopUpAmount] = useState("");
    const [isTopUpLoading, setIsTopUpLoading] = useState(false);
    const [topUpStatus, setTopUpStatus] = useState<null | { type: 'success' | 'error', message: string }>(null);
    const [address, setAddress] = useState<string | null>(null);

    useEffect(() => {
        const fetchWalletData = async () => {
            try {
                setLoading(true);

                if(!window.ethereum || !window.ethereum.selectedAddress) {
                    setError("Please connect your wallet to view balance.");
                    setBalance(0);
                    return;
                }

                setAddress(window.ethereum.selectedAddress);

                // Fetch contract address and ABI from your API endpoint
                const contractInfoRes = await fetch('/api/contract-info?contract=token');
                if (!contractInfoRes.ok) throw new Error("Failed to fetch contract info");
                const { address: tokenAddress, abi } = await contractInfoRes.json();

                if (!tokenAddress || !abi) {
                    setError("Unable to check balance, please try again later");
                    return;
                }

                // Setup ethers provider and contract
                const provider = new ethers.BrowserProvider(window.ethereum);
                const contract = new ethers.Contract(tokenAddress, abi, provider);

                // Get balance
                const userAddress = window.ethereum.selectedAddress;
                const rawBalance = await contract.balanceOf(userAddress);
                const decimals = await contract.decimals();
                const formatted = Number(ethers.formatUnits(rawBalance, decimals));
                setBalance(formatted);

                // Optionally update Firestore
                const db = getFirestore(app)
                const userDocRef = doc(db, "users", currentUser.uid, "wallet", "wallet_info");
                await updateDoc(userDocRef, { balance: formatted });

            } catch (error: any) {
                console.error('Error fetching wallet data:', error);
                setError(error.message || 'Could not load balance');
                setBalance(0);
            } finally {
                setLoading(false);
            }
        };

        fetchWalletData();

        // Refresh every 30 seconds
        const intervalId = setInterval(fetchWalletData, 30000);

        return () => clearInterval(intervalId);
    }, []);

    const formattedBalance = balance.toFixed(2);

    // Handle top up button click (unchanged)
    const handleTopUp = async () => {
        if (!topUpAmount || isNaN(Number(topUpAmount)) || Number(topUpAmount) <= 0) {
            setTopUpStatus({
                type: 'error',
                message: 'Please enter a valid amount'
            });
            return;
        }

        try {
            setIsTopUpLoading(true);
            setTopUpStatus(null);

            const response = await fetch('/api/wallet/topup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user: currentUser,
                    amount: topUpAmount
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error?.message || 'Failed to top up wallet');
            }

            if (data.success) {
                setBalance(parseFloat(data.balance));
                setTopUpStatus({
                    type: 'success',
                    message: `Successfully added ${topUpAmount} MST to your wallet!, please give it a moment to update`
                });
                setTopUpAmount('');
            } else {
                throw new Error(data.message || 'Unknown error occurred');
            }
        } catch (error: any) {
            setTopUpStatus({
                type: 'error',
                message: error.message || 'Failed to top up wallet'
            });
        } finally {
            setIsTopUpLoading(false);
            setTimeout(() => {
                setTopUpStatus(null);
            }, 5000);
        }
    };

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
                        <div className="text-4xl font-bold text-white mb-2 text-center">
                          {formattedBalance} <span className="text-purple-400">MST</span>
                        </div>
                    )}

                    <div className="mt-4 text-center">
                        <div className="text-xs text-gray-500 mb-1">Wallet Address</div>
                        <div className="flex items-center justify-center">
                            <code className="bg-[#111] text-gray-300 p-2 rounded text-xs break-all">
                                {address || 'Not connected'}
                            </code>
                            <button 
                                onClick={() => {
                                    navigator.clipboard.writeText(address || '');
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

                    {/* Top Up Section */}
                    <div className="mt-6 w-full">
                        <div className="text-sm text-gray-400 mb-2">Top Up Balance</div>
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                placeholder="Enter MST amount"
                                value={topUpAmount}
                                onChange={(e) => setTopUpAmount(e.target.value)}
                                className="bg-[#222] border-[#333] text-white"
                                min="0"
                                step="1"
                            />
                            <Button 
                                onClick={handleTopUp}
                                disabled={isTopUpLoading}
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                            >
                                {isTopUpLoading ? (
                                    <span className="flex items-center">
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing
                                    </span>
                                ) : 'Top Up'}
                            </Button>
                        </div>
                        {topUpStatus && (
                            <div className={`mt-2 text-sm p-2 rounded ${
                                topUpStatus.type === 'success' 
                                    ? 'bg-green-900/30 text-green-400' 
                                    : 'bg-red-900/30 text-red-400'
                            }`}>
                                {topUpStatus.message}
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}