"use client"

import { Card, CardHeader } from "@/components/ui/card"
import { useState, useEffect } from 'react'
import { getAuth, onAuthStateChanged } from "firebase/auth"
import { app } from "../../firebase/client"
import { ethers } from 'ethers'
import benchmarkService from "@/utils/BenchmarkService"

interface UserCardProps {
  user: any;
  photoURL: string;
}

export function UserCard({ user, photoURL }: UserCardProps) {
  const [walletBalance, setWalletBalance] = useState("0.00 MST")
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)

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

  // Listen for MetaMask accounts without requesting them
  useEffect(() => {
    const setupMetaMaskListeners = async () => {
      if (!window.ethereum) {
        console.warn("MetaMask is not installed");
        return;
      }

      // Create provider
      const ethProvider = new ethers.BrowserProvider(window.ethereum);
      setProvider(ethProvider);
      
      // Check if any accounts are already connected
      try {
        const accounts = await window.ethereum.request({ 
          method: 'eth_accounts' // Uses eth_accounts instead of eth_requestAccounts
        });
        
        if (accounts && accounts.length > 0) {
          setWalletAddress(accounts[0]);
          console.log("Found connected wallet:", accounts[0]);
        }
      } catch (error) {
        console.error("Error checking for connected accounts:", error);
      }

      // Listen for account changes
      const handleAccountsChanged = (accounts: string[]) => {
        console.log("Accounts changed:", accounts);
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
        } else {
          setWalletAddress(null);
        }
      };
      
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      
      // Clean up listener
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      };
    };
    
    setupMetaMaskListeners();
  }, []);

  // Fetch token balance using contract
  useEffect(() => {
    if (!walletAddress) return;
    
    const fetchTokenBalance = async () => {
      try {
        // Get token contract info
        const contractInfoRes = await fetch('/api/contract-info?contract=token');
        if (!contractInfoRes.ok) throw new Error("Failed to fetch contract info");
        
        const { address: tokenAddress, abi } = await contractInfoRes.json();
        if (!tokenAddress || !abi) throw new Error("Invalid contract data");
        
        const end = benchmarkService.start("balance")

        const readProvider = new ethers.BrowserProvider(window.ethereum);

        const contract = new ethers.Contract(tokenAddress, abi, readProvider);
        
        // Get balance
        const rawBalance = await contract.balanceOf(walletAddress);
        const formatted = ethers.formatEther(rawBalance);
        end();
        setWalletBalance(`${parseFloat(formatted).toFixed(2)} MST`);
      } catch (error) {
        console.error("Error fetching balance from contract:", error);
        setWalletBalance("Balance unavailiable")
      }
    };
    
    // Initial fetch
    fetchTokenBalance();
    
    // Setup interval to fetch every 10 seconds
    const intervalId = setInterval(fetchTokenBalance, 10000);
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [walletAddress]);

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
          {walletAddress && (
            <p className="text-xs text-gray-400 truncate">
              {`${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`}
            </p>
          )}
        </div>
      </CardHeader>
    </Card>
  )
}