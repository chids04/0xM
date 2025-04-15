import React, { useState, useEffect } from 'react';
import { formatDistance } from 'date-fns';

interface NFTGalleryProps {
  userId: string;
}

interface NFT {
  tokenId: number;
  milestoneId: string;
  nftImageUrl: string;
  mintedAt?: string;
}

export const NFTGallery: React.FC<NFTGalleryProps> = ({ userId }) => {
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null);

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
    
    if (userId) {
      fetchNFTs();
    }
  }, [userId]);

  const openNFTDetail = (nft: NFT) => {
    setSelectedNFT(nft);
  };

  const closeNFTDetail = () => {
    setSelectedNFT(null);
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
              <div className="mt-2 flex justify-between items-center">
                <span className="text-xs text-gray-500">
                  {nft.mintedAt ? 
                    `Minted ${formatDistance(new Date(nft.mintedAt), new Date(), { addSuffix: true })}` : 
                    'Recently minted'
                  }
                </span>
                <span className="inline-flex rounded-full bg-purple-900/30 px-2 py-1 text-xs font-medium text-purple-400 ring-1 ring-inset ring-purple-700/30">
                  NFT
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* NFT Detail Modal */}
      {selectedNFT && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg max-w-3xl w-full overflow-hidden relative">
            <button 
              onClick={closeNFTDetail}
              className="absolute top-4 right-4 text-gray-400 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <div className="flex flex-col md:flex-row">
              <div className="w-full md:w-1/2 aspect-[4/3] bg-gradient-to-b from-gray-800 to-gray-900">
                <img 
                  src={selectedNFT.nftImageUrl} 
                  alt={`NFT ${selectedNFT.tokenId}`} 
                  className="w-full h-full object-contain"
                />
              </div>
              
              <div className="p-6 w-full md:w-1/2">
                <div className="flex justify-between items-start">
                  <h2 className="text-2xl font-bold text-white">NFT #{selectedNFT.tokenId}</h2>
                  <span className="inline-flex rounded-full bg-purple-900/30 px-2 py-1 text-xs font-medium text-purple-400 ring-1 ring-inset ring-purple-700/30">
                    NFT
                  </span>
                </div>
                
                <div className="mt-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-medium text-gray-400">Milestone ID</h3>
                    <p className="mt-1 text-sm text-white">{selectedNFT.milestoneId}</p>
                  </div>
                  
                  <div>
                    <h3 className="text-sm font-medium text-gray-400">Minted</h3>
                    <p className="mt-1 text-sm text-white">
                      {selectedNFT.mintedAt ? 
                        new Date(selectedNFT.mintedAt).toLocaleString() : 
                        'Date unavailable'
                      }
                    </p>
                  </div>
                </div>
                
                <div className="mt-8 space-y-4">
                  <a
                    href={selectedNFT.nftImageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View Full Image
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};