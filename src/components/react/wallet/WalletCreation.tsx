"use client"

import { useState, useEffect } from 'react';
import { doc, getDoc, getFirestore } from "firebase/firestore"
import { app } from "../../../firebase/client"

interface WalletCreationModalProps {
    userId: string;
}

export function WalletCreationModal({ userId }: WalletCreationModalProps) {
    const [showModal, setShowModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Add a flag to prevent multiple executions
        let isMounted = true;
        
        async function checkAndCreateWallet() {
            if (!userId) {
                console.log("No user ID provided, skipping wallet creation");
                return;
            }

            try {
                // Only proceed if component is still mounted
                if (isMounted) {
                    // Check if user has a wallet
                    const hasWallet = await userHasWallet(userId);
                    
                    if (!hasWallet && isMounted) {
                        // Show modal while creating wallet
                        setShowModal(true);
                        const walletCreated = await handleCreateWallet(userId);
                        
                        if (walletCreated && isMounted) {
                            // Hide modal after wallet is created
                            setShowModal(false);
                        } else if (isMounted) {
                            setError("Failed to create wallet");
                        }
                    }
                }
            } catch (error) {
                if (isMounted) {
                    console.error("Error in wallet creation process:", error);
                    setError("Error checking or creating wallet");
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        checkAndCreateWallet();
        
        // Cleanup function
        return () => {
            isMounted = false;
        };
    }, []); // Empty dependency array to run only on mount

    /**
     * Check if the user has a wallet.
     */
    async function userHasWallet(id: string): Promise<boolean> {
        const db = getFirestore(app)
        const walletRef = doc(db, "users", id, "wallet", "wallet_info");
        const walletDoc = await getDoc(walletRef);

        return walletDoc.exists();
    }

    /**
     * Handle wallet creation for the user.
     */
    async function handleCreateWallet(id: string): Promise<boolean> {

        try {
            const response = await fetch('/api/wallet/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: id }),
            });

            return response.ok;
        } catch (error) {
            console.error('Error creating wallet:', error);
            return false;
        }
    }

    /**
     * Manually trigger wallet creation
     */
    const onCreateWalletClick = async () => {
        setIsLoading(true);
        setError(null);
        
        try {
            const walletCreated = await handleCreateWallet(userId);
            if (walletCreated) {
                setShowModal(false);
            } else {
                setError("Failed to create wallet");
            }
        } catch (error) {
            console.error("Error creating wallet:", error);
            setError("Error creating wallet");
        } finally {
            setIsLoading(false);
        }
    };

    if (!showModal) return null;

    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-[1000]"
        >
            <div className="bg-[#1f1f1f] border border-purple-500/20 shadow-xl rounded-lg p-8 max-w-md w-full mx-4 text-center">
                <h2 className="text-2xl font-bold text-white mb-4">Blockchain Wallet</h2>
                
                {isLoading ? (
                    <div className="flex flex-col items-center space-y-4 py-6">
                        <div className="relative h-16 w-16">
                            <div className="absolute h-16 w-16 rounded-full border-4 border-t-purple-500 border-r-purple-400 border-b-purple-300 border-l-purple-200 animate-spin"></div>
                        </div>
                        <p className="text-gray-300 mt-4">Creating your wallet...</p>
                        <p className="text-gray-400 text-sm">This may take a moment</p>
                    </div>
                ) : error ? (
                    <div className="space-y-4 py-4">
                        <p className="text-red-400">{error}</p>
                        <button 
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors duration-300 shadow-md hover:shadow-lg"
                            onClick={onCreateWalletClick}
                        >
                            Try Again
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4 py-4">
                        <p className="text-gray-300 mb-2">Your blockchain wallet is ready to be created. This will allow you to interact with milestones and friends on the platform.</p>
                        <button 
                            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md transition-colors duration-300 shadow-md hover:shadow-lg"
                            id="create-wallet-button"
                            onClick={onCreateWalletClick}
                        >
                            Create Wallet
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}