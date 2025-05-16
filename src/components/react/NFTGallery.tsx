import React, { useState, useEffect } from 'react';
import { formatDistance } from 'date-fns';
import { TagFriendDropdown } from "./TagFriendDropdown";
import type { Friend } from "./ClientTagFriendDropdown";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ethers } from 'ethers';

import benchmarkService from '@/utils/BenchmarkService';

interface NFTGalleryProps {
  userId: string;
  friends: Friend[];
}

interface NFT {
  tokenId: number;
  milestoneId: string;
  nftImageUrl: string;
  mintedAt?: string;
  description?: string;
  name?: string;
  ipfsError?: boolean; // Flag to indicate if there was an IPFS loading issue
}

interface ContractInfo {
  address: string;
  abi: any[];
}

export function NFTGallery({ userId, friends }: NFTGalleryProps) {
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState<boolean>(false);
  const [isFullImageModalOpen, setIsFullImageModalOpen] = useState<boolean>(false); // Added for full-size image modal
  const [ipfsLoadingIssue, setIpfsLoadingIssue] = useState<boolean>(false); // Added for IPFS loading status
  const [transferToAddress, setTransferToAddress] = useState<string>("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
  const [transferLoading, setTransferLoading] = useState<boolean>(false);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [transferFee, setTransferFee] = useState<string>("5.0");
  const [isFeeLoading, setIsFeeLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | null>(null);
  const [contractInfo, setContractInfo] = useState<ContractInfo | null>(null);
  const [contractLoading, setContractLoading] = useState<boolean>(true);

  // Helper function for setting status messages
  const setStatus = (msg: string, type: "success" | "error" = "error") => {
    setStatusMessage(msg);
    setStatusType(type);
    
    // Auto-clear status message after 5 seconds
    setTimeout(() => {
      setStatusMessage(null);
      setStatusType(null);
    }, 5000);
  };

  // Fetch NFT contract info
  useEffect(() => {
    const fetchContractInfo = async () => {
      try {
        setContractLoading(true);
        const response = await fetch('/api/contract-info?contract=nft');
        
        if (!response.ok) {
          throw new Error('Failed to fetch NFT contract info');
        }
        
        const data = await response.json();
        setContractInfo({
          address: data.address,
          abi: data.abi
        });
      } catch (err) {
        console.error("Failed to fetch contract info:", err);
        setError("Failed to load NFT contract information. Please try again later.");
      } finally {
        setContractLoading(false);
      }
    };
    
    fetchContractInfo();
  }, []);

  useEffect(() => {
    const fetchNFTs = async () => {
      setLoading(true);
      setError(null);
      setIpfsLoadingIssue(false);
      const end = benchmarkService.start("nftFetch");
      
      try {
        const response = await fetch(`/api/nft/get-user-nfts?userId=${userId}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to fetch NFTs');
        }
        
        const data = await response.json();
        if (data.success && Array.isArray(data.nfts)) {
          // Check if any NFTs had IPFS loading issues
          const hasIpfsIssues = data.nfts.some((nft: NFT) => nft.ipfsError);
          setIpfsLoadingIssue(hasIpfsIssues);
          setNfts(data.nfts);
        } else {
          setNfts([]);
        }
      } catch (e) {
        console.error('Error fetching NFTs:', e);
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
        end();
      }
    };
    
    const fetchTransferFee = async () => {
      setIsFeeLoading(true);
      try {
        const response = await fetch('/api/nft/transfer-fee');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.price) {
            setTransferFee(data.price);
          }
        }
      } catch (err) {
        console.error("Failed to fetch NFT transfer fee:", err);
      } finally {
        setIsFeeLoading(false);
      }
    };
    
    if (userId) {
      fetchNFTs();
      fetchTransferFee();
    }
  }, [userId]);

  useEffect(() => {
    if (selectedFriend) {
      fetchFriendWalletAddress(selectedFriend.uid);
    }
  }, [selectedFriend]);
  
  const fetchFriendWalletAddress = async (uid: string) => {
    try {
      const response = await fetch(`/api/wallet/address?uid=${uid}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch wallet address');
      }
      
      const data = await response.json();
      if (data.address) {
        setTransferToAddress(data.address);
      } else {
        setTransferError("No wallet address found for this friend");
      }
    } catch (error) {
      console.error("Error fetching friend's wallet address:", error);
      setTransferError("Failed to fetch friend's wallet address");
    }
  };

  const openNFTDetail = (nft: NFT) => {
    setSelectedNFT(nft);
    setIsFullImageModalOpen(true); // Opening the NFT detail now shows the full image modal
  };

  const closeNFTDetail = () => {
    setIsFullImageModalOpen(false);
    setTimeout(() => setSelectedNFT(null), 300);
  };
  
  const openFullImageModal = (nft: NFT, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the parent click event
    setSelectedNFT(nft);
    setIsFullImageModalOpen(true);
  };
  
  const closeFullImageModal = () => {
    setIsFullImageModalOpen(false);
    // Keep the selected NFT if we're in the transfer modal, otherwise clear it
    if (!isTransferModalOpen) {
      setTimeout(() => setSelectedNFT(null), 300);
    }
  };
  
  const openTransferModal = (nft: NFT, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening NFT detail modal
    setSelectedNFT(nft);
    setIsTransferModalOpen(true);
    
    // Close the full image modal if it's open
    if (isFullImageModalOpen) {
      setIsFullImageModalOpen(false);
    }
    
    setTransferToAddress("");
    setSelectedFriend(null);
    setTransferError(null);
    setTransferSuccess(null);
  };
  
  const closeTransferModal = () => {
    setIsTransferModalOpen(false);
    
    // Only clear the selected NFT if the full image modal is not open
    if (!isFullImageModalOpen) {
      setTimeout(() => {
        setSelectedNFT(null);
        setTransferError(null);
        setTransferSuccess(null);
      }, 300);
    }
  };
  
  const handleFriendSelect = (friend: Friend) => {
    setSelectedFriend(friend);
    setTransferError(null);
  };

  // Direct transfer using user's wallet
  const handleTransferNFT = async () => {
    const end = benchmarkService.start("nftTransfer");
    // Validate input
    if (!transferToAddress) {
      setTransferError("Please enter a recipient address");
      return;
    }
    
    if (!selectedNFT) {
      setTransferError("No NFT selected for transfer");
      return;
    }
    
    if (!contractInfo) {
      setTransferError("Contract information not loaded");
      return;
    }
    
    setTransferLoading(true);
    setTransferError(null);
    setTransferSuccess(null);
    
    try {

      setStatus("Please connect your wallet to transfer the NFT...", "success");
      
      // Check if MetaMask is installed
      if (!window.ethereum || !window.ethereum.selectedAddress) {
        throw new Error("Please connect to your wallet");
      }
      
      const userAddress = window.ethereum.selectedAddress;

      // Create contract instance
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const nftContract = new ethers.Contract(
        contractInfo.address,
        contractInfo.abi,
        signer
      );
      
      // Verify ownership of the NFT
      const owner = await nftContract.ownerOf(selectedNFT.tokenId);
      if (owner.toLowerCase() !== userAddress.toLowerCase()) {
        throw new Error("You are not the owner of this NFT");
      }
      
      // Execute transfer
      setStatus("Please confirm the transfer transaction in your wallet...", "success");
      const tx = await nftContract.transferFrom(
        userAddress,
        transferToAddress,
        selectedNFT.tokenId
      );
      
      setStatus("Transaction submitted. Waiting for confirmation...", "success");
      
      // Wait for transaction to be confirmed
      await tx.wait();
      
      setTransferSuccess(`Successfully transferred NFT #${selectedNFT.tokenId} to ${selectedFriend ? selectedFriend.displayName : transferToAddress}`);
      setStatus("NFT transferred successfully!", "success");
      
      // Update backend about the transfer
      await fetch('/api/nft/record-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: selectedNFT.tokenId,
          fromAddress: userAddress,
          toAddress: transferToAddress,
          txHash: tx.hash,
          userId
        })
      });
      
      // Refresh NFT list after successful transfer
      setTimeout(async () => {
        try {
          const refreshResponse = await fetch(`/api/nft/get-user-nfts?userId=${userId}`);
          const refreshData = await refreshResponse.json();
          if (refreshData.success && Array.isArray(refreshData.nfts)) {
            setNfts(refreshData.nfts);
          }
        } catch (e) {
          console.error('Error refreshing NFTs:', e);
        }
      }, 2000);
    } catch (error: any) {
      console.error('Error transferring NFT:', error);
      setTransferError(error.message || 'Failed to transfer NFT');
      setStatus(`Error: ${error.message || 'Failed to transfer NFT'}`, "error");
    } finally {
      setTransferLoading(false);
    }
  end();
  };

  if (loading || contractLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div 
          className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"
          role="status"
          aria-label="Loading NFTs"
        >
          <span className="sr-only">Loading NFTs...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-800/20 border border-red-900 rounded-lg p-4 mb-6">
        <p className="text-red-500">{error}</p>
        <button 
          className="mt-2 px-3 py-1 bg-red-700/30 hover:bg-red-700/50 rounded text-sm text-red-300"
          onClick={() => window.location.reload()}
        >
          Try Again
        </button>
      </div>
    );
  }

  if (nfts.length === 0) {
    return (
      <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-8 text-center">
        <h3 className="text-xl font-medium text-gray-400 mb-2">No NFTs Found</h3>
        <p className="text-gray-500">This user hasn't minted any milestone NFTs yet.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto">
      {/* Status Message */}
      {statusMessage && (
        <div className={`mb-6 p-4 rounded-lg flex items-center ${
          statusType === "error" 
            ? "bg-red-900/30 border border-red-500/30 text-red-400" 
            : "bg-green-900/30 border border-green-500/30 text-green-400"
        }`}>
          {statusType === "error" ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          )}
          {statusMessage}
        </div>
      )}
      
      {/* IPFS Loading Issue Banner */}
      {ipfsLoadingIssue && (
        <div className="mb-6 p-4 bg-amber-900/30 border border-amber-500/30 rounded-lg">
          <div className="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-amber-500">Some NFT data may be incomplete due to IPFS loading issues</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {nfts.map((nft) => (
          <div 
            key={nft.tokenId} 
            className="bg-gray-800/30 border border-gray-700 rounded-lg overflow-hidden hover:border-purple-600 transition-all cursor-pointer"
            onClick={() => openNFTDetail(nft)}
          >
            <div className="relative w-full aspect-[4/3] bg-gradient-to-b from-gray-800 to-gray-900">
              <img 
                src={nft.nftImageUrl} 
                alt={`NFT ${nft.tokenId}`} 
                className="w-full h-full object-contain"
              />
              <div className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded-full text-xs">
                #{nft.tokenId}
              </div>
              
              {nft.ipfsError && (
                <div className="absolute bottom-2 left-2 bg-amber-500/80 text-black px-2 py-1 rounded-md text-xs">
                  Limited Data
                </div>
              )}
              
              {/* View Full-size Button */}
              <button
                onClick={(e) => openFullImageModal(nft, e)}
                className="absolute bottom-2 right-2 bg-purple-600/80 hover:bg-purple-600 transition-colors py-1 px-2 rounded text-xs text-white"
              >
                View Full
              </button>
            </div>
            <div className="p-4">
              <h3 className="text-lg font-semibold text-white truncate">
                {nft.name || `NFT #${nft.tokenId}`}
              </h3>
              <p className="text-gray-400 text-sm mt-1 truncate">{nft.milestoneId}</p>
              <div className="mt-3 flex justify-between items-center">
                <span className="text-xs text-gray-500">
                  {nft.mintedAt ? 
                    `Minted ${formatDistance(new Date(nft.mintedAt), new Date(), { addSuffix: true })}` : 
                    'Recently minted'
                  }
                </span>
                <button 
                  onClick={(e) => openTransferModal(nft, e)}
                  className="bg-purple-600/60 hover:bg-purple-600 transition-colors py-1 px-3 rounded text-sm text-white"
                >
                  Transfer
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Full-size NFT Image Modal */}
      {selectedNFT && isFullImageModalOpen && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-purple-500/20 rounded-lg max-w-4xl w-full overflow-hidden relative">
            {/* Close Button */}
            <button
              onClick={closeFullImageModal}
              className="absolute top-4 right-4 text-gray-400 hover:text-white z-10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <div className="flex flex-col">
              <div className="p-6 border-b border-gray-700">
                <h2 className="text-xl font-bold text-white">{selectedNFT.name || `NFT #${selectedNFT.tokenId}`}</h2>
              </div>
              
              <div className="p-6">
                <div className="flex flex-col">
                  {/* IPFS Warning if applicable */}
                  {selectedNFT.ipfsError && (
                    <div className="mb-4 p-3 bg-amber-900/30 border border-amber-500/30 rounded-md">
                      <div className="flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-amber-500">Some metadata may be incomplete due to IPFS loading issues</span>
                      </div>
                    </div>
                  )}
                  
                  <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-lg overflow-hidden mb-6">
                    <img 
                      src={selectedNFT.nftImageUrl} 
                      alt={`NFT ${selectedNFT.tokenId}`} 
                      className="w-full object-contain max-h-[50vh]"
                    />
                  </div>
                  
                  <div className="flex justify-center mb-4">
                    <button
                      onClick={closeFullImageModal}
                      className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md flex items-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      Close Image
                    </button>
                  </div>
                  
                  {/* NFT details */}
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg text-white font-medium mb-2">Details</h3>
                      <div className="bg-[#222] p-4 rounded-lg">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-500 mb-1">Token ID</p>
                            <p className="text-white">#{selectedNFT.tokenId}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500 mb-1">Milestone ID</p>
                            <p className="text-white">{selectedNFT.milestoneId}</p>
                          </div>
                          {selectedNFT.mintedAt && (
                            <div>
                              <p className="text-sm text-gray-500 mb-1">Minted</p>
                              <p className="text-white">{formatDistance(new Date(selectedNFT.mintedAt), new Date(), { addSuffix: true })}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Description */}
                    {selectedNFT.description && (
                      <div>
                        <h3 className="text-lg text-white font-medium mb-2">Description</h3>
                        <div className="bg-[#222] p-4 rounded-lg">
                          <p className="text-gray-300 whitespace-pre-wrap">{selectedNFT.description}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Action Buttons */}
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={(e) => {
                      closeFullImageModal();
                      openTransferModal(selectedNFT, e as React.MouseEvent);
                    }}
                    className="px-4 py-2 bg-purple-600/60 hover:bg-purple-600 text-white rounded-md"
                  >
                    Transfer NFT
                  </button>
                  
                  <button
                    onClick={closeFullImageModal}
                    className="px-4 py-2 border border-gray-600 text-gray-300 rounded-md hover:bg-gray-800"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* NFT Transfer Modal */}
      {selectedNFT && isTransferModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-purple-500/20 rounded-lg max-w-2xl w-full overflow-hidden relative">
            {/* Close Button */}
            <button
              onClick={closeTransferModal}
              className="absolute top-4 right-4 text-gray-400 hover:text-white z-10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <div className="flex flex-col">
              <div className="p-6 border-b border-gray-700">
                <h2 className="text-xl font-bold text-white">Transfer NFT #{selectedNFT.tokenId}</h2>
              </div>
              
              <div className="p-6">
                <div className="flex flex-col md:flex-row mb-6">
                  <div className="w-full md:w-1/3 md:pr-4 mb-4 md:mb-0">
                    <div className="aspect-square bg-gradient-to-b from-gray-800 to-gray-900 rounded-lg overflow-hidden">
                      <img 
                        src={selectedNFT.nftImageUrl} 
                        alt={`NFT ${selectedNFT.tokenId}`} 
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                  
                  <div className="w-full md:w-2/3">
                    <div className="space-y-4">
                      {/* Friend Selection */}
                      {friends.length > 0 && (
                        <div className="space-y-2">
                          <label className="block text-gray-300 text-sm font-medium">
                            Select Friend
                          </label>
                          <TagFriendDropdown friends={friends} onSelect={handleFriendSelect} />
                          
                          {selectedFriend && (
                            <div className="mt-2 p-2 bg-[#222] rounded-md flex items-center">
                              <img
                                src={selectedFriend.photoURL}
                                alt={selectedFriend.displayName}
                                className="w-6 h-6 rounded-full mr-2"
                              />
                              <span className="text-white text-sm">{selectedFriend.displayName}</span>
                              <button 
                                className="ml-auto text-gray-400 hover:text-red-400"
                                onClick={() => {
                                  setSelectedFriend(null);
                                  setTransferToAddress("");
                                }}
                              >
                                ×
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Manual Address Input */}
                      <div className="space-y-2">
                        <label className="block text-gray-300 text-sm font-medium">
                          Recipient Address
                        </label>
                        <input
                          type="text"
                          value={transferToAddress}
                          onChange={(e) => setTransferToAddress(e.target.value)}
                          placeholder="Enter wallet address"
                          disabled={!!selectedFriend}
                          className="w-full px-3 py-2 bg-[#252525] text-white border border-[#333333] focus:border-purple-500 rounded-md"
                        />
                        <p className="text-xs text-gray-500">
                          {selectedFriend ? "Address auto-filled from selected friend" : 
                          friends.length > 0 ? "Enter manually or select a friend above" : 
                          "Enter the recipient's wallet address"}
                        </p>
                      </div>
                      
                      {/* Gas fee information */}
                      <div className="mt-4 p-3 bg-[#1a1a1a] border border-amber-500/20 rounded-md">
                        <div className="flex items-center mb-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400 mr-2" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span className="text-amber-400 font-medium">Direct Transfer Information</span>
                        </div>
                        <p className="text-sm text-gray-300 mb-1">
                          This transfer will be executed directly from your wallet.
                        </p>
                        <p className="text-sm text-gray-400">
                          You'll need to pay gas fees in ETH using your connected MetaMask wallet.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Messages */}
                {(transferError || transferSuccess) && (
                  <div 
                    className={`p-4 rounded-md text-sm mb-4 ${
                      transferError ? 'bg-red-900/50 text-red-300 border border-red-500/30' : 
                      'bg-green-900/50 text-green-300 border border-green-500/30'
                    }`}
                  >
                    {transferError || transferSuccess}
                  </div>
                )}
                
                {/* Action Buttons */}
                <div className="flex justify-end space-x-3 mt-4">
                  <button
                    onClick={closeTransferModal}
                    className="px-4 py-2 border border-gray-600 text-gray-300 rounded-md hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  
                  <button
                    onClick={handleTransferNFT}
                    disabled={transferLoading || !transferToAddress}
                    className={`px-4 py-2 bg-purple-600 text-white rounded-md ${
                      transferLoading || !transferToAddress ? 
                        'opacity-60 cursor-not-allowed' : 
                        'hover:bg-purple-700'
                    }`}
                  >
                    {transferLoading ? (
                      <span className="flex items-center">
                        <span className="mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        Transferring...
                      </span>
                    ) : (
                      "Transfer NFT"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};