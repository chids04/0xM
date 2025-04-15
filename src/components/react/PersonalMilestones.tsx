import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { collection, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';
import { app, auth } from '../../firebase/client';
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import html2canvas from 'html2canvas-pro';

interface MilestoneTimelineProps {
  userId: string;
  userName: string;
}

const MilestoneTimeline: React.FC<MilestoneTimelineProps> = ({ userId, userName }) => {
  const [milestones, setMilestones] = useState<any[]>([]);
  const [filteredMilestones, setFilteredMilestones] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [firebaseUserInfo, setFirebaseUserInfo] = useState(auth.currentUser);

  
  // Verification states
  const [verificationStatus, setVerificationStatus] = useState<Record<string, { verified: boolean, loading: boolean, error?: string }>>({});
  const [batchVerifying, setBatchVerifying] = useState(false);
  const [batchResults, setBatchResults] = useState<{ total: number, verified: number, failed: number } | null>(null);

  // Preview modal state
  const [previewData, setPreviewData] = useState<{
    visible: boolean;
    milestone: any | null;
    loading: boolean;
    error: string | null;
  }>({
    visible: false,
    milestone: null,
    loading: false,
    error: null
  });

  // Check for mobile screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);


  // Fetch milestones from Firebase
  useEffect(() => {
    const db = getFirestore(app);
    const auth = getAuth(app)

    console.log(auth)
    const user = auth.currentUser

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log(user.displayName)
        setCurrentUsername(user.displayName || 'Anonymous');
        setFirebaseUserInfo(user);
      } else {
        setCurrentUsername(null);
        setFirebaseUserInfo(null);
      }
    });


    const fetchMilestones = async () => {
      try {
        const acceptedRef = doc(db, "users", userId, "milestones", "accepted");
        const acceptedSnapshot = await getDoc(acceptedRef);

        if (!acceptedSnapshot.exists()) {
          console.error("Accepted milestones document does not exist.");
          setMilestones([]);
          setFilteredMilestones([]);
          return;
        }

        const acceptedData = acceptedSnapshot.data();
        const milestoneRefs = acceptedData?.milestoneRefs || [];
        
        const milestonesDataPromises = milestoneRefs.map(async (ref: any) => {
          try {
            if (typeof ref === 'string') {
              const pathParts = ref.split('/');
              if (pathParts.length >= 2) {
                const collectionName = pathParts[0];
                const docId = pathParts[1]; 
                const milestoneRef = doc(db, collectionName, docId);
                const milestoneSnapshot = await getDoc(milestoneRef);
                if (milestoneSnapshot.exists()) {
                  const data = milestoneSnapshot.data();
                  return data ? { id: milestoneSnapshot.id, ...data } : null;
                }
              }
              return null;
            } else if (ref?.path) {
              const milestoneSnapshot = await getDoc(ref);
              if (milestoneSnapshot.exists()) {
                const data = milestoneSnapshot.data();
                return data ? { id: milestoneSnapshot.id, ...data } : null;
              }
            } else {
              console.error("Invalid milestone reference format:", ref);
            }
            return null;
          } catch (error) {
            console.error("Error fetching individual milestone:", error, ref);
            return null;
          }
        });

        const milestonesData = (await Promise.all(milestonesDataPromises))
          .filter((milestone) => milestone !== null)
          .filter((milestone: any) => (milestone.participants || []).length === 0)
          .map((milestone: any, index: number) => ({
            description: milestone.description,
            milestone_date: milestone.milestone_date,
            createdAt: milestone.createdAt,
            id: milestone.id,
            image: milestone.image,
            index,
          }));

        milestonesData.sort(
          (a: any, b: any) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
        );

        setMilestones(milestonesData);
        setFilteredMilestones(milestonesData);
      } catch (error) {
        console.error("Error fetching milestones:", error);
        setMilestones([]);
        setFilteredMilestones([]);
      }
    };

    if (userId) {
      fetchMilestones();
    }
  }, [userId]);

  // Update card positions
  useLayoutEffect(() => {
    const updatePositions = () => {
      if (!containerRef.current || filteredMilestones.length === 0) return;
      const container = containerRef.current;
      const milestoneElements = container.querySelectorAll('.milestone-card');
      const totalMilestones = milestoneElements.length;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) {
        return;
      }

      if (window.innerWidth < 768) {
        milestoneElements.forEach((milestone, i) => {
          const cardHeight = 180;
          const verticalPos = cardHeight * i + 20 * (i + 1);
          (milestone as HTMLElement).style.top = `${verticalPos}px`;
          (milestone as HTMLElement).style.left = '50%';
        });
      } else {
        const maxAmplitude = containerWidth * 0.3;
        const amplitude = Math.min(maxAmplitude, Math.max(20, (window.innerWidth - 480) / 4));
        const cardHeight = 180;
        const totalSpacing = containerHeight - (cardHeight * totalMilestones);
        const spaceBetweenCards = totalSpacing / (totalMilestones + 5);

        milestoneElements.forEach((milestone) => {
          const index = parseInt(milestone.getAttribute('data-index') || '0');
          const verticalPos = spaceBetweenCards * (index + 1) + cardHeight * index + cardHeight / 2;
          const sinePosition = totalMilestones > 1 ? (index / (totalMilestones - 1)) * Math.PI * 3 : 0;
          const horizontalOffset = Math.sin(sinePosition) * amplitude;
          const horizontalPos = 0.5 + horizontalOffset / containerWidth;
          (milestone as HTMLElement).style.top = `${verticalPos}px`;
          (milestone as HTMLElement).style.left = `${horizontalPos * 100}%`;
        });
      }
    };

    const debounce = (func: Function, wait: number) => {
      let timeout: NodeJS.Timeout;
      return (...args: any[]) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    };

    const debouncedUpdatePositions = debounce(updatePositions, 50);

    const initializePositions = () => {
      if (!containerRef.current || containerRef.current.clientWidth === 0) {
        requestAnimationFrame(initializePositions);
      } else {
        updatePositions();
      }
    };

    initializePositions();
    window.addEventListener('resize', debouncedUpdatePositions);
    window.addEventListener('pageshow', updatePositions);

    return () => {
      window.removeEventListener('resize', debouncedUpdatePositions);
      window.removeEventListener('pageshow', updatePositions);
    };
  }, [filteredMilestones]);

  // Filter milestones
  useEffect(() => {
    let filtered = [...milestones];
    if (searchTerm) {
      filtered = filtered.filter((milestone) =>
        milestone.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    if (dateRange.start) {
      const startDate = new Date(dateRange.start);
      filtered = filtered.filter((milestone) => new Date(milestone.milestone_date) >= startDate);
    }
    if (dateRange.end) {
      const endDate = new Date(dateRange.end);
      filtered = filtered.filter((milestone) => new Date(milestone.milestone_date) <= endDate);
    }
    setFilteredMilestones(filtered);
  }, [milestones, searchTerm, dateRange]);

  const containerHeight = isMobile
    ? filteredMilestones.length * 220
    : filteredMilestones.length * 200 + 200;

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDateRange((prev) => ({ ...prev, [name]: value }));
  };

  // Verify a single milestone
  const verifyMilestone = async (milestoneId: string) => {
    try {
      setVerificationStatus(prev => ({
        ...prev,
        [milestoneId]: { ...prev[milestoneId], loading: true }
      }));

      const response = await fetch('/api/milestone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, milestoneId: milestoneId })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Verification failed');
      }

      setVerificationStatus(prev => ({
        ...prev,
        [milestoneId]: { 
          verified: data.verified,
          loading: false,
          error: data.verified ? undefined : 'Hash mismatch detected'
        }
      }));

      return data.verified;
    } catch (error: any) {
      console.error("Error verifying milestone:", error);
      setVerificationStatus(prev => ({
        ...prev,
        [milestoneId]: { 
          verified: false, 
          loading: false,
          error: error.message
        }
      }));
      return false;
    }
  };

  // Verify all milestones
  const verifyAllMilestones = async () => {
    if (!filteredMilestones.length) return;
    
    setBatchVerifying(true);
    setBatchResults(null);
    
    try {
      let verified = 0;
      let failed = 0;
      
      for (const milestone of filteredMilestones) {
        const isVerified = await verifyMilestone(milestone.id);
        if (isVerified) {
          verified++;
        } else {
          failed++;
        }
      }
      
      setBatchResults({
        total: filteredMilestones.length,
        verified,
        failed
      });
    } catch (error) {
      console.error("Error during batch verification:", error);
    } finally {
      setBatchVerifying(false);
    }
  };

  // Preview handling
  const handleShowPreview = (milestone: any) => {
    const status = verificationStatus[milestone.id];
    if (!status || !status.verified) {
      alert('Milestone must be verified before previewing.');
      return;
    }

    setPreviewData({
      visible: true,
      milestone,
      loading: false,
      error: null
    });
  };

  const handleSaveImage = async () => {
    if (!previewData.milestone) return;
    
    setPreviewData(prev => ({ ...prev, loading: true }));
    
    try {
      const certificateElement = document.getElementById('certificate-container');
      if (!certificateElement) throw new Error('Certificate element not found');

      const canvas = await html2canvas(certificateElement, {
        scale: 2,
        logging: true,
        useCORS: true,
        backgroundColor: '#1a1a1a'
      });

      // Convert canvas to a blob
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            throw new Error('Failed to create image blob');
          }
        }, 'image/png');
      });

      // Create a file object from the blob
      const fileName = `milestone-${previewData.milestone.id}.png`;
      const imageFile = new File([blob], fileName, { type: 'image/png' });

      // Create form data for API request
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('milestoneId', previewData.milestone.id);
      formData.append('userId', userId);

      // Make API request to create NFT
      const response = await fetch('/api/nft/create', { 
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to mint NFT');
      }

      const result = await response.json();
      
      // Show success notification
      alert(`NFT minted successfully! Transaction: ${result.transactionHash.substring(0, 10)}...`);
      setPreviewData(prev => ({ ...prev, loading: false, visible: false }));
    } catch (error: any) {
      console.error('Error minting NFT:', error);
      setPreviewData(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to mint NFT'
      }));
    }
  };

  // Get verification status badge
  const getVerificationBadge = (milestoneId: string) => {
    const status = verificationStatus[milestoneId];
    
    if (!status) {
      return null;
    }
    
    if (status.loading) {
      return (
        <div className="flex items-center mt-2">
          <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full mr-2"></div>
          <span className="text-gray-400 text-sm">Verifying...</span>
        </div>
      );
    }
    
    if (status.verified) {
      return (
        <div className="flex items-center mt-2">
          <svg className="w-4 h-4 text-green-500 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          <span className="text-green-500 text-sm">Verified</span>
        </div>
      );
    }
    
    return (
      <div className="flex items-center mt-2">
        <svg className="w-4 h-4 text-red-500 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
        <span className="text-red-500 text-sm">{status.error || 'Verification failed'}</span>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-6">Your Milestones</h1>

      {/* Filter Controls */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label htmlFor="search" className="block text-sm font-medium text-gray-400 mb-1">
            Search Milestones
          </label>
          <input
            type="text"
            id="search"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search description"
            className="w-full p-2 bg-[#252525] border border-purple-500/20 rounded-lg text-white focus:outline-none focus:border-purple-500"
          />
        </div>
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium text-gray-400 mb-1">
            Start Date
          </label>
          <input
            type="date"
            id="startDate"
            name="start"
            value={dateRange.start}
            onChange={handleDateChange}
            className="w-full p-2 bg-[#252525] border border-purple-500/20 rounded-lg text-white focus:outline-none focus:border-purple-500"
          />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm font-medium text-gray-400 mb-1">
            End Date
          </label>
          <input
            type="date"
            id="endDate"
            name="end"
            value={dateRange.end}
            onChange={handleDateChange}
            className="w-full p-2 bg-[#252525] border border-purple-500/20 rounded-lg text-white focus:outline-none focus:border-purple-500"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={() => {
              setSearchTerm('');
              setDateRange({ start: '', end: '' });
            }}
            className="w-full bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Verification Controls */}
      <div className="mb-6 flex flex-wrap gap-4 items-center">
        <button 
          onClick={verifyAllMilestones}
          disabled={batchVerifying || filteredMilestones.length === 0}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          {batchVerifying ? (
            <>
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
              Verifying...
            </>
          ) : (
            <>Verify All Milestones</>
          )}
        </button>
        
        {batchResults && (
          <div className="text-sm px-4 py-2 rounded-lg bg-[#252525] border border-purple-500/20">
            <span className="text-gray-300">Results: </span>
            <span className="text-green-500">{batchResults.verified} verified</span>
            {batchResults.failed > 0 && (
              <span className="text-red-500 ml-2">{batchResults.failed} failed</span>
            )}
          </div>
        )}
      </div>

      {filteredMilestones.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          No milestones found matching your filters.
        </div>
      )}

      {/* Timeline Container */}
      <div
        className="relative w-full my-10"
        style={{ height: `${containerHeight}px` }}
        ref={containerRef}
      >
        <div className="hidden lg:block absolute top-0 left-1/2 h-full w-0.5 bg-purple-500/30 transform -translate-x-1/2"></div>

        <div className="milestone-container">
          {filteredMilestones.map((milestone, index) => (
            <div
              key={milestone.id}
              className="milestone-card"
              data-index={index}
            >
              <div
                className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border border-purple-500/20 transition-all duration-300 ${
                  isMobile ? 'w-full max-w-sm' : 'w-[280px]'
                }`}
              >
                {milestone.image && (
                  <img
                    src={milestone.image}
                    alt={milestone.description}
                    className="w-full h-40 object-cover rounded-md mb-4"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <p className="text-white text-lg font-medium mb-2">
                  {milestone.description}
                </p>
                <p className="text-gray-400 mb-1">
                  Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}
                </p>
                <p className="text-gray-400">
                  Timestamp: {new Date(milestone.createdAt).toLocaleTimeString('en-US')}
                </p>
                
                {getVerificationBadge(milestone.id)}
                
                <div className="mt-3 flex gap-2">
                  {!verificationStatus[milestone.id]?.loading && (
                    <button
                      onClick={() => verifyMilestone(milestone.id)}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors"
                    >
                      Verify
                    </button>
                  )}
                  <button
                    onClick={() => handleShowPreview(milestone)}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview Modal */}
      {previewData.visible && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="relative bg-[#1a1a1a] rounded-xl max-w-2xl w-full p-6 border border-purple-500/20">
            <button
              onClick={() => setPreviewData(prev => ({ ...prev, visible: false }))}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-xl font-bold text-white mb-4">Preview Certificate</h3>
            
            <div
              id="certificate-container"
              className="p-6 bg-[#1a1a1a] rounded-lg border border-purple-500"
            >
              <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">
                {previewData.milestone.description}
              </h2>
              </div>

              <div className="mb-8">
              {previewData.milestone.image && (
                <div className="mt-4 flex justify-center">
                <img
                  src={previewData.milestone.image}
                  alt="Milestone"
                  className="max-w-full h-auto rounded-lg"
                  style={{ maxHeight: '200px' }}
                  onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  }}
                />
                </div>
              )}
              <div className="mt-6 bg-[#252525] p-4 rounded-lg flex items-center justify-center">
                <p className="text-white text-center">
                {userName}
                </p>
              </div>
              <div className="mt-6 bg-[#252525] p-4 rounded-lg flex justify-center">
                <p className="text-white text-center">
                <span className="text-gray-400">date: </span> {new Date(previewData.milestone.createdAt).toLocaleDateString()}
                </p>
              </div>
              </div>
              
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setPreviewData(prev => ({ ...prev, visible: false }))}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveImage}
                disabled={previewData.loading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center"
              >
                {previewData.loading ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                    Saving...
                  </>
                ) : (
                  'Save Image'
                )}
              </button>
            </div>

            {previewData.error && (
              <div className="mt-4 text-red-500 text-sm">{previewData.error}</div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .milestone-container {
          position: relative;
          width: 100%;
          height: 100%;
        }
        
        .milestone-card {
          position: absolute;
          transition: all 0.6s cubic-bezier(0.22, 1, 0.36, 1);
          transform: translateX(-50%);
        }
        
        @media (max-width: 767px) {
          .milestone-card > div {
            width: 90vw;
            max-width: 330px;
          }
        }
      `}</style>
    </div>
  );
};

export default MilestoneTimeline;