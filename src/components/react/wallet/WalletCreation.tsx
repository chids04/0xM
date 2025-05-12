"use client"

import { useState, useEffect, useCallback } from "react"
import { ethers } from "ethers"
import { app } from "../../../firebase/client"
import {
  getFirestore,
  doc,
  runTransaction,
  getDoc
} from "firebase/firestore"

interface WalletCreationModalProps {
  userId: string
}

export function WalletCreationModal({ userId }: WalletCreationModalProps) {
  const [showModal, setShowModal] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)

  // Show modal when userId is set
  useEffect(() => {
    if (!userId) return;
  
    const checkWallet = async () => {
      const db = getFirestore(app);
      const userWalletRef = doc(db, "users", userId, "wallet", "wallet_info");
    const userWalletSnap = await getDoc(userWalletRef);
    const walletAddress = userWalletSnap.data()?.address;
    const selectedAddress = window.ethereum?.selectedAddress?.toLowerCase();

    if (
      !userWalletSnap.exists() ||
      !walletAddress ||
      (selectedAddress && walletAddress.toLowerCase() !== selectedAddress)
    ) {
      setShowModal(true);
    } else {
      setShowModal(false);
      setAddress(walletAddress);
    }

    };
  
    checkWallet();
  }, [userId]);

  // auto retry connectWallet when metamask account changes after error
  useEffect(() => {
    if (!window.ethereum) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (
        error &&
        error.includes("Please select a different wallet in MetaMask") &&
        accounts.length > 0
      ) {
        connectWallet()
      }
    }

    window.ethereum.on?.("accountsChanged", handleAccountsChanged)
    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged)
    }
  }, [error, userId])

  // Memoized connectWallet to avoid stale closure
  const connectWallet = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      if (!window.ethereum) {
        throw new Error("MetaMask not installed")
      }

      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send("eth_requestAccounts", [])
      const signer = await provider.getSigner()
      const userAddress = await signer.getAddress()

      await saveWalletToFirestore(userId, userAddress)
      setAddress(userAddress)
      setShowModal(false)
    } catch (err: any) {
      if (
        err.message &&
        err.message.includes("already linked to") &&
        window.ethereum
      ) {
        try {
          // this opens the MetaMask account selection window
          await window.ethereum.request({
            method: "wallet_requestPermissions",
            params: [{ eth_accounts: {} }],
          })
          setError(err.message)
        } catch (permErr: any) {
          setError("Permission request was denied. Please select a different wallet in MetaMask.")
        }
      } else {
        setError(err.message || "Failed to connect wallet")
      }
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  const saveWalletToFirestore = async (uid: string, addr: string) => {
    const db = getFirestore(app)
    const globalRef = doc(db, "wallets", addr)
    const userWalletRef = doc(db, "users", uid, "wallet", "wallet_info")

    const userWalletSnap = await getDoc(userWalletRef)
    if (userWalletSnap.exists() && userWalletSnap.data().address !== addr) {
      throw new Error("This email is already linked to another wallet")
    }

    await runTransaction(db, async (tx) => {
      const globalSnap = await tx.get(globalRef)
      if (globalSnap.exists() && globalSnap.data().userId !== uid) {
        throw new Error("This wallet is already linked to another account.")
      }

      //free reward for new users (contract mints to first 100 people)
      const res = await fetch("/api/wallet/airdrop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });

      if (!res.ok) {
        setError("Failed to claim free rewards. Sorry!");
      }

      tx.set(globalRef, {
        userId: uid,
        address: addr,
        createdAt: Date.now()
      })
      tx.set(userWalletRef, {
        address: addr,
        createdAt: Date.now()
      })
    })
  }

  if (!showModal) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-[1000]">
      <div className="bg-[#1f1f1f] border border-purple-500/20 shadow-xl rounded-lg p-8 max-w-md w-full mx-4 text-center">
        <h2 className="text-2xl font-bold text-white mb-4">
          Connect Your Wallet
        </h2>

        {isLoading ? (
          <div className="flex flex-col items-center space-y-4 py-6">
            <div className="relative h-16 w-16">
              <div className="absolute h-16 w-16 rounded-full border-4 border-t-purple-500 border-r-purple-400 border-b-purple-300 border-l-purple-200 animate-spin"></div>
            </div>
            <p className="text-gray-300 mt-4">Connecting to MetaMask...</p>
          </div>
        ) : error ? (
          <div className="space-y-4 py-4">
            <p className="text-red-400">{error}</p>
            <button
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors duration-300 shadow-md hover:shadow-lg"
              onClick={connectWallet}
              disabled={isLoading}
            >
              Retry Connection
            </button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <p className="text-gray-300 mb-2">
              Use MetaMask to connect your blockchain wallet and interact with
              the platform.
            </p>
            <button
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors duration-300 shadow-md hover:shadow-lg"
              onClick={connectWallet}
              disabled={isLoading}
            >
              Connect MetaMask
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
