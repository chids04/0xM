import React, { useState, useEffect } from 'react';
import { formatDistance } from 'date-fns';
import { TagFriendDropdown } from "./TagFriendDropdown";
import type { Friend } from "./ClientTagFriendDropdown";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface NFTGalleryProps {
  userId: string;
  friends: Friend[];
}



interface NFT {
  tokenId: number;
  milestoneId: string;
  nftImageUrl: string;
  mintedAt?: string;
}

export function NFTGallery({ userId, friends }: NFTGalleryProps) {
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState<boolean>(false);
  const [transferToAddress, setTransferToAddress] = useState<string>("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
  const [transferLoading, setTransferLoading] = useState<boolean>(false);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [transferFee, setTransferFee] = useState<string>("5.0");
  const [isFeeLoading, setIsFeeLoading] = useState<boolean>(false);

  useEffect(() => {
    const fetchNFTs = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/api/nft/get-user-nfts?userId=${userId}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Failed to fetch NFTs');
        }
        
        const data = await response.json();
        if (data.success && Array.isArray(data.nfts)) {
          setNfts(data.nfts);
        } else {
          setNfts([]);
        }
      } catch (e) {
        console.error('Error fetching NFTs:', e);
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
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
  };

  const closeNFTDetail = () => {
    setSelectedNFT(null);
  };
  
  const openTransferModal = (nft: NFT, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening NFT detail modal
    setSelectedNFT(nft);
    setIsTransferModalOpen(true);
    setTransferToAddress("");
    setSelectedFriend(null);
    setTransferError(null);
    setTransferSuccess(null);
  };
  
  const closeTransferModal = () => {
    setIsTransferModalOpen(false);
    setTimeout(() => {
      setSelectedNFT(null);
      setTransferError(null);
      setTransferSuccess(null);
    }, 300);
  };
  
  const handleFriendSelect = (friend: Friend) => {
    setSelectedFriend(friend);
    setTransferError(null);
  };

  const handleTransferNFT = async () => {
    // Validate input
    if (!transferToAddress) {
      setTransferError("Please enter a recipient address");
      return;
    }
    
    if (!selectedNFT) {
      setTransferError("No NFT selected for transfer");
      return;
    }
    
    setTransferLoading(true);
    setTransferError(null);
    setTransferSuccess(null);
    
    try {
      const response = await fetch('/api/nft/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: selectedNFT.tokenId,
          recipientAddress: transferToAddress,
          userId
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to transfer NFT');
      }
      
      setTransferSuccess(`Successfully transferred NFT #${selectedNFT.tokenId} to ${selectedFriend ? selectedFriend.displayName : transferToAddress}`);
      
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
    } finally {
      setTransferLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
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
            </div>
            <div className="p-4">
              <h3 className="text-lg font-semibold text-white truncate">NFT #{nft.tokenId}</h3>
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

      {/* NFT Detail Modal */}
      {selectedNFT && isTransferModalOpen && (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
        <div className="bg-[#1a1a1a] border border-purple-500/20 rounded-lg max-w-2xl w-full overflow-hidden relative">
          {/* Close Button */}
          <button
            onClick={closeTransferModal}
            className="absolute top-4 right-4 text-gray-400 hover:text-white z-10"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <div className="flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-[#333333]">
              <h2 className="text-xl font-bold text-white">Transfer NFT #{selectedNFT.tokenId}</h2>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="flex flex-col md:flex-row gap-6">
                {/* NFT Preview */}
                <div className="w-full md:w-1/3">
                  <div className="aspect-square bg-gradient-to-b from-gray-800 to-gray-900 rounded-lg overflow-hidden">
                    <img
                      src={selectedNFT.nftImageUrl}
                      alt={`NFT ${selectedNFT.tokenId}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>

                {/* Form */}
                <div className="w-full md:w-2/3 space-y-4">
                  {/* Friend Selection */}
                  {friends.length > 0 && (
                    <div className="space-y-2">
                      <label className="block text-gray-300 text-sm font-medium mb-1">
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
                    <label className="block text-gray-300 text-sm font-medium mb-1">
                      Recipient Address
                    </label>
                    <Input
                      type="text"
                      value={transferToAddress}
                      onChange={(e) => setTransferToAddress(e.target.value)}
                      placeholder="Enter wallet address"
                      disabled={!!selectedFriend}
                      className="bg-[#252525] text-white border-[#333333] focus:border-purple-500"
                    />
                    <p className="text-xs text-gray-500">
                      {selectedFriend
                        ? "Address auto-filled from selected friend"
                        : friends.length > 0
                        ? "Enter manually or select a friend above"
                        : "Enter the recipient's wallet address"}
                    </p>
                  </div>

                  {/* Transfer Fee */}
                  <div className="p-3 bg-[#222] rounded-md">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400">Transfer Fee:</span>
                      <span className="text-white">
                        {isFeeLoading ? (
                          <span className="inline-block w-6 h-3 bg-gray-600 animate-pulse rounded"></span>
                        ) : (
                          `${transferFee} MST`
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Fee is charged in MST tokens and will be deducted from your wallet
                    </p>
                  </div>

                  {/* Messages */}
                  {(transferError || transferSuccess) && (
                    <div
                      className={`p-4 rounded-md text-sm transition-all duration-300 ${
                        transferError
                          ? "bg-red-900/50 text-red-300 border border-red-500/30"
                          : "bg-green-900/50 text-green-300 border border-green-500/30"
                      }`}
                    >
                      {transferError || transferSuccess}
                      <button
                        className="ml-2 text-xs opacity-75 hover:opacity-100"
                        onClick={() => {
                          setTransferError(null);
                          setTransferSuccess(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-[#1f1f1f] border-t border-[#333333] p-4 flex justify-end space-x-3">
              <Button
                onClick={closeTransferModal}
                className="px-4 py-2 bg-[#252525] text-gray-300 hover:bg-[#333333]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleTransferNFT}
                disabled={transferLoading || !transferToAddress}
                className={`px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 ${
                  transferLoading || !transferToAddress ? "opacity-60 cursor-not-allowed" : ""
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
              </Button>
            </div>
          </div>
        </div>
      </div>
      )} 
      
      {/* NFT Transfer Modal */}
      {selectedNFT && isTransferModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg max-w-2xl w-full overflow-hidden relative">
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
                      
                      {/* Fee information */}
                      <div className="mt-4 p-3 bg-[#1a1a1a] rounded-md">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-400">Transfer Fee:</span>
                          <span className="text-white">
                            {isFeeLoading ? 
                              <span className="inline-block w-6 h-3 bg-gray-600 animate-pulse rounded"></span> : 
                              `${transferFee} MST`}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Fee is charged in MST tokens and will be deducted from your wallet
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