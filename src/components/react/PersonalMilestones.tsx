import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { collection, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';
import { app, auth } from '../../firebase/client';
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import html2canvas from 'html2canvas-pro';
import { ethers } from 'ethers';
import benchmarkService from '@/utils/BenchmarkService';

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
  // add a ref to store refs for each milestone card
  const milestoneRefs = useRef<Array<HTMLDivElement | null>>([]);
  // state to store measured heights
  const [milestoneHeights, setMilestoneHeights] = useState<number[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [firebaseUserInfo, setFirebaseUserInfo] = useState(auth.currentUser);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | null>(null);

  // verification states
  const [verificationStatus, setVerificationStatus] = useState<Record<string, { verified: boolean, loading: boolean, error?: string }>>({});
  const [batchVerifying, setBatchVerifying] = useState(false);
  const [batchResults, setBatchResults] = useState<{ total: number, verified: number, failed: number } | null>(null);

  // preview modal state
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

  //nft minting price
  const [nftMintPrice, setNftMintPrice] = useState<string | null>(null);
  const [nftPriceLoading, setNftPriceLoading] = useState(true);
  const [nftPriceError, setNftPriceError] = useState<string | null>(null);
  
  // helper function for setting status messages
  const setStatus = (msg: string, type: "success" | "error" = "error") => {
    setStatusMessage(msg);
    setStatusType(type);
    setTimeout(() => {
      setStatusMessage(null);
      setStatusType(null);
    }, 5000);
  };
  
  // check for mobile screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    const fetchNftMintPrice = async () => {
      try {
        setNftPriceLoading(true);
        setNftPriceError(null);
        const response = await fetch("/api/nft/mint-price", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
  
        if (!response.ok) throw new Error((await response.json())?.error?.message || "Failed to fetch NFT mint price");
        const data = await response.json();
        if (data.success && data.price) setNftMintPrice(data.price);
        else throw new Error("Invalid price data received");
      } catch (error) {
        console.error("Error fetching NFT mint price:", error);
        setNftPriceError((error as Error).message || "Failed to fetch NFT mint price");
      } finally {
        setNftPriceLoading(false);
      }
    };
  
    fetchNftMintPrice();
  }, []);


  // fetch milestones from firebase
  useEffect(() => {
    const db = getFirestore(app);
    const auth = getAuth(app);

    setIsLoading(true);
    setStatus("Loading milestones...", "success");

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUsername(user.displayName || 'Anonymous');
        setFirebaseUserInfo(user);
      } else {
        setCurrentUsername(null);
        setFirebaseUserInfo(null);
      }
    });
    
    // helper function to fetch with timeout
    const fetchWithTimeout = async (url: string, timeoutMs = 10000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        if ((error as Error).name === 'AbortError') {
          throw new Error('Request timed out after ' + timeoutMs + 'ms');
        }
        throw error;
      }
    };

    const fetchMilestones = async () => {
      const end = benchmarkService.start("personalMilestone")
      try {
        const acceptedRef = doc(db, "users", userId, "milestones", "accepted");
        const acceptedSnapshot = await getDoc(acceptedRef);

        if (!acceptedSnapshot.exists()) {
          console.error("Accepted milestones document does not exist.");
          setMilestones([]);
          setFilteredMilestones([]);
          setStatus("No milestones found", "error");
          return;
        }

        const acceptedData = acceptedSnapshot.data();
        const milestoneRefs = acceptedData?.milestoneRefs || [];
        
        if (milestoneRefs.length === 0) {
          setStatus("No milestones found", "error");
          setMilestones([]);
          setFilteredMilestones([]);
          return;
        }
        
        setStatus(`Loading ${milestoneRefs.length} milestones...`, "success");
        
        // fetch milestone firestore docs
        const milestonesDataPromises = milestoneRefs.map(async (ref: any, index: number) => {
          try {
            // ref is a documentreference
            const milestoneSnapshot = await getDoc(ref);
            if (!milestoneSnapshot.exists()) return null;
            
            const milestoneDocData = milestoneSnapshot.data();
            // only include if owner matches current userid
            if (!milestoneDocData?.owner || milestoneDocData.owner !== userId) return null;
            
            // get ipfs cid from milestonedocdata
            const metadataCid = milestoneDocData?.ipfsCIDs?.metadataCid;
            if (!metadataCid) return null;

            // fetch milestone data from ipfs with timeout
            const ipfsUrl = `http://127.0.0.1:8080/ipfs/${metadataCid}`;
            try {
              const ipfsResponse = await fetchWithTimeout(ipfsUrl, 10000); // 10 second timeout
              
              if (!ipfsResponse.ok) {
                console.error("Failed to fetch milestone data from IPFS:", ipfsUrl);
                
                // return partial data if ipfs fetch fails
                return {
                  id: milestoneSnapshot.id,
                  description: `Milestone ${index + 1} (IPFS data unavailable)`,
                  milestone_date: milestoneDocData.createdAt || new Date().toISOString(),
                  createdAt: milestoneDocData.createdAt || new Date().toISOString(),
                  ...milestoneDocData,
                  ipfsError: true
                };
              }
              
              const ipfsData = await ipfsResponse.json();

              // merge firestore doc data for id owner etc with ipfs data
              return {
                id: milestoneSnapshot.id,
                ...ipfsData,
                ...milestoneDocData,
              };
            } catch (ipfsError) {
              console.error("Error or timeout fetching from IPFS:", ipfsError);
              
              // return partial data if ipfs fetch times out
              return {
                id: milestoneSnapshot.id,
                description: `Milestone ${index + 1} (IPFS data unavailable)`,
                milestone_date: milestoneDocData.createdAt || new Date().toISOString(),
                createdAt: milestoneDocData.createdAt || new Date().toISOString(),
                ...milestoneDocData,
                ipfsError: true
              };
            }
          } catch (error) {
            console.error("Error fetching milestone from Firestore:", error, ref);
            return null;
          }
        });

        const milestonesData = (await Promise.all(milestonesDataPromises)).filter(Boolean);

        milestonesData.sort(
          (a: any, b: any) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
        );

        setMilestones(milestonesData);
        setFilteredMilestones(milestonesData);
        
        const ipfsErrorCount = milestonesData.filter(m => m.ipfsError).length;
        if (ipfsErrorCount > 0) {
          setStatus(`Loaded ${milestonesData.length} milestones. Note: ${ipfsErrorCount} milestones have incomplete data due to IPFS timeout.`, "error");
        } else {
          setStatus(`Successfully loaded ${milestonesData.length} milestones`, "success");
        }
      } catch (error) {
        console.error("Error fetching milestones:", error);
        setStatus(`Error loading milestones: ${(error as Error).message}`, "error");
        setMilestones([]);
        setFilteredMilestones([]);
      } finally {
        end();
        setIsLoading(false);
      }
    };

    if (userId) {
      fetchMilestones();
    }
    
    return () => {
      unsubscribe();
    };
  }, [userId]);  // measure milestone card heights after render with improved image handling
  useEffect(() => {
    if (!filteredMilestones.length) {
      setMilestoneHeights([]);
      return;
    }
    
    // function to measure heights properly
    const measureHeights = () => {
      const heights = filteredMilestones.map((_, idx) => {
        const el = milestoneRefs.current[idx];
        return el ? el.offsetHeight : 220; // increased fallback height
      });
      setMilestoneHeights(heights);
    };

    // initial measurement
    measureHeights();
    
    // perform multiple measurements to catch different loading phases
    const measurementTimers = [
      setTimeout(measureHeights, 100),
      setTimeout(measureHeights, 500),
      setTimeout(measureHeights, 1000),
      setTimeout(measureHeights, 2000)
    ];
    
    // monitor for image loads within milestone cards
    const imageLoadHandler = () => {
      measureHeights();
      // schedule another measurement after a short delay to account for layout changes
      setTimeout(measureHeights, 50);
    };
    
    // create mutationobserver to watch for dom changes within milestone cards
    const observer = new MutationObserver((mutations) => {
      let hasRelevantChanges = false;
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' || mutation.type === 'attributes') {
          hasRelevantChanges = true;
        }
      });
      
      if (hasRelevantChanges) {
        measureHeights();
      }
    });
    
    // observe each milestone card for changes
    milestoneRefs.current.forEach(ref => {
      if (ref) {
        observer.observe(ref, { 
          childList: true, 
          subtree: true, 
          attributes: true,
          attributeFilter: ['src', 'style', 'class']
        });
      }
    });
    
    // add event listeners to all images in milestone cards
    const images = document.querySelectorAll('.milestone-card img');
    images.forEach(img => {
      img.addEventListener('load', imageLoadHandler);
      img.addEventListener('error', imageLoadHandler);
      
      // if image is already loaded trigger measurement
      if ((img as HTMLImageElement).complete) {
        imageLoadHandler();
      }
    });
    
    return () => {
      measurementTimers.forEach(timer => clearTimeout(timer));
      observer.disconnect();
      images.forEach(img => {
        img.removeEventListener('load', imageLoadHandler);
        img.removeEventListener('error', imageLoadHandler);
      });
    };
  }, [filteredMilestones]);

  // update card positions
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
      
      // get the safety margin to prevent overlap
      // this adds extra spacing between cards to prevent overlap issues
      const safetyMargin = 30;
      
      if (window.innerWidth < 768) {
        // use measured heights to prevent overlap  mobile view vertical layout
        let currentTop = 0;
        const gap = 30; // increased gap for better separation
        milestoneElements.forEach((milestone, i) => {
          // Use measured height with a minimum fallback
          const height = Math.max(milestoneHeights[i] || 220, 220) + safetyMargin;
          (milestone as HTMLElement).style.top = `${currentTop}px`;
          (milestone as HTMLElement).style.left = '50%';
          currentTop += height + gap;
        });
      } else {
        const maxAmplitude = containerWidth * 0.3;
        const amplitude = Math.min(maxAmplitude, Math.max(20, (window.innerWidth - 480) / 4));
        // Use measured heights for vertical positioning - desktop view (sine wave layout)
        let currentTop = 0;
        const gap = 40; // Increased gap for better separation
        
        milestoneElements.forEach((milestone, idx) => {
          // Use measured height with a minimum fallback and safety margin
          const height = Math.max(milestoneHeights[idx] || 220, 220) + safetyMargin;
          const sinePosition = totalMilestones > 1 ? (idx / (totalMilestones - 1)) * Math.PI * 3 : 0;
          const horizontalOffset = Math.sin(sinePosition) * amplitude;
          const horizontalPos = 0.5 + horizontalOffset / containerWidth;
          
          // Position card from the top, not from center
          (milestone as HTMLElement).style.top = `${currentTop}px`;
          (milestone as HTMLElement).style.left = `${horizontalPos * 100}%`;
          
          // Move to next position with height + gap
          currentTop += height + gap;
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
  }, [filteredMilestones, milestoneHeights]);

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

  // Adjust containerHeight calculation to use measured heights
  const containerHeight = isMobile
    ? milestoneHeights.reduce((sum, h) => sum + h, 0) + (milestoneHeights.length > 0 ? (milestoneHeights.length - 1) * 20 : 0)
    : milestoneHeights.reduce((sum, h) => sum + h, 0) + (milestoneHeights.length > 0 ? (milestoneHeights.length - 1) * 20 : 0) + 200;

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
      setStatus("Starting milestone verification...", "success");
      setVerificationStatus(prev => ({
        ...prev,
        [milestoneId]: { ...prev[milestoneId], loading: true }
      }));

      const end = benchmarkService.start("verifyMilestone")

      const response = await fetch('/api/milestone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, milestoneId: milestoneId })
      });

      end();

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Verification failed');
      }

      if (data.verified) {
        setStatus("Milestone verified successfully!", "success");
      } else {
        setStatus("Milestone verification failed: hash mismatch detected", "error");
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
      setStatus(`Verification error: ${error.message}`, "error");
      
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
    setStatus("Starting batch verification of all milestones...", "success");
    
    try {
      let verified = 0;
      let failed = 0;
      const total = filteredMilestones.length;
      
      for (const milestone of filteredMilestones) {
        setStatus(`Verifying milestone ${verified + failed + 1} of ${total}...`, "success");
        const isVerified = await verifyMilestone(milestone.id);
        if (isVerified) {
          verified++;
        } else {
          failed++;
        }
      }
      
      setBatchResults({
        total,
        verified,
        failed
      });
      
      if (failed === 0) {
        setStatus(`All ${verified} milestones verified successfully!`, "success");
      } else {
        setStatus(`Verification complete: ${verified} succeeded, ${failed} failed`, "error");
      }
    } catch (error) {
      console.error("Error during batch verification:", error);
      setStatus("Error during batch verification. Please try again.", "error");
    } finally {
      setBatchVerifying(false);
    }
  };

  // Preview handling
  const handleShowPreview = (milestone: any) => {
    const status = verificationStatus[milestone.id];
    if (!status || !status.verified) {
      setStatus("Milestone must be verified before previewing. Please verify the milestone first.", "error");
      return;
    }

    setStatus("Opening milestone preview...", "success");
    setPreviewData({
      visible: true,
      milestone,
      loading: false,
      error: null
    });
  };

  const handleSaveImage = async () => {
    if (!previewData.milestone) return;
    const end = benchmarkService.start("mint NFT")
  
    setPreviewData(prev => ({ ...prev, loading: true }));
    setStatus("Starting NFT minting process...", "success");
  
    try {
      const certificateElement = document.getElementById('certificate-container');
      if (!certificateElement) throw new Error('Certificate element not found');
  
      setStatus("Generating certificate image...", "success");
      const canvas = await html2canvas(certificateElement, {
        scale: 2,
        logging: true,
        useCORS: true,
        backgroundColor: '#1a1a1a'
      });
  
      // Convert canvas to a blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create image blob'));
          }
        }, 'image/png');
      });
  
      // Create a file object from the blob
      const fileName = `milestone-${previewData.milestone.id}.png`;
      const imageFile = new File([blob], fileName, { type: 'image/png' });
  
      // 1. Permit signature for NFT mint price
      if (!nftMintPrice) throw new Error("NFT mint price not loaded");
      
      setStatus("Preparing payment transaction...", "success");
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      if(!window.ethereum || !window.ethereum.selectedAddress) {
        throw new Error("Please connect your wallet to proceed.");
      }

      const signer = await provider.getSigner();

      // Request permit data for the mint price
      const permitRes = await fetch("/api/transaction/make-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: window.ethereum.selectedAddress,
          amount: nftMintPrice,
        }),
      });
      
      if (!permitRes.ok) {
        const errorData = await permitRes.json();
        throw new Error(errorData?.error?.message || "Failed to create permit transaction");
      }
      
      const permitData = await permitRes.json();
      const { domain: permitDomain, types: permitTypes, message: permitMessage } = permitData;
      
      setStatus("Please sign the payment authorization in your wallet", "success");
      setPreviewData(prev => ({ ...prev, loading: true, error: null }));
      let permitSignature;
      try {
        permitSignature = await signer.signTypedData(permitDomain, permitTypes, permitMessage);
      } catch (error) {
        setStatus("Payment signature was rejected", "error");
        setPreviewData(prev => ({
          ...prev,
          loading: false,
          error: "Payment signature rejected."
        }));
        return;
      }
  
      // send permit to backend
      setStatus("Processing payment...", "success");
      const permitTx = await fetch("/api/transaction/send-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: permitData,
          signature: permitSignature,
        }),
      });
      
      if (!permitTx.ok) {
        const errorData = await permitTx.json();
        throw new Error(errorData?.error?.message || "Failed to send permit transaction");
      }
  
      // 2. Create meta-tx for NFT mint
      setStatus("Preparing NFT metadata...", "success");
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('milestoneId', previewData.milestone.id);
      formData.append('userId', userId);
      formData.append('milestoneDescription', previewData.milestone.description);
  
      const mintTxRes = await fetch('/api/nft/create-mint-tx', {
        method: 'POST',
        body: formData,
      });
      
      if (!mintTxRes.ok) {
        const errorData = await mintTxRes.json();
        setPreviewData(prev => ({
          ...prev,
          loading: false,
          error: errorData?.error?.message || "Failed to create NFT mint transaction"
        }));
        setStatus("Failed to create NFT mint transaction", "error");
        throw new Error(errorData?.error?.message || "Failed to create NFT mint transaction");
      }
      
      const { metaTxRequest, domain, types } = await mintTxRes.json();
  
      // 3. user signs meta-tx for minting NFT
      setStatus("Please sign the NFT minting transaction in your wallet", "success");
      let mintSignature;
      try {
        mintSignature = await signer.signTypedData(domain, types, metaTxRequest);
      } catch {
        setStatus("NFT minting signature was rejected", "error");
        setPreviewData(prev => ({
          ...prev,
          loading: false,
          error: "NFT mint signature rejected."
        }));
        return;
      }
      
      const tx = { ...metaTxRequest, signature: mintSignature };
  
      // 4. relay meta-tx to backend
      setStatus("Submitting NFT minting transaction to blockchain...", "success");
      const relayRes = await fetch("/api/milestone/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaTx: tx,
          type: "mintNFT"
        }),
      });
      
      if (!relayRes.ok) {
        const errorData = await relayRes.json();
        throw new Error(errorData?.error?.message || "Failed to relay NFT mint transaction");
      }
      
      const result = await relayRes.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to mint NFT");
      }

      const { txHash, blockNum } = result;

      // Save NFT tokenId to Firestore for the user
      setStatus("Saving NFT information...", "success");
      try {
        const saveTokenIdRes = await fetch("/api/nft/save-tokenid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash, blockNum }),
        });
        if (!saveTokenIdRes.ok) {
          const errorData = await saveTokenIdRes.json();
          console.error("Failed to save NFT tokenId:", errorData?.message || errorData?.error || saveTokenIdRes.statusText);
        } else {
          const { tokenId } = await saveTokenIdRes.json();
          console.log("NFT tokenId saved:", tokenId);
        }
      } catch (err) {
        console.error("Error calling save-tokenid endpoint:", err);
      }

      // Show success notification
      setStatus("NFT minted successfully!", "success");
      alert(`NFT minted successfully! Tx Hash: ${result.txHash}`);
      setPreviewData(prev => ({ ...prev, loading: false, visible: false }));
    } catch (error: any) {
      console.error('Error minting NFT:', error);
      setStatus(`Error minting NFT: ${error.message}`, "error");
      setPreviewData(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to mint NFT'
      }));
    }
  end();
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
      
      {statusMessage && (
        <div className={`mb-4 p-4 rounded-xl ${
          statusType === 'success' ? 'bg-green-900/30 text-green-400 border border-green-500/20' : 
          'bg-red-900/30 text-red-400 border border-red-500/20'
        }`}>
          {statusMessage}
        </div>
      )}
      
      <div className="mb-6">
          {nftPriceLoading ? (
            <div className="p-4 bg-[#222] rounded-xl border border-purple-500/20 animate-pulse">
              <p className="text-gray-400">Loading NFT minting price...</p>
            </div>
          ) : nftPriceError ? (
            <div className="p-4 bg-red-900/30 text-red-400 rounded-xl text-sm border border-red-500/20">
              Failed to load NFT minting price: {nftPriceError}
            </div>
          ) : nftMintPrice && (
            <div className="p-4 bg-[#222] border border-purple-500/20 rounded-xl">
              <h3 className="text-white font-medium mb-2">NFT Minting Cost</h3>
              <div className="flex items-center gap-2">
                <span className="text-yellow-400 text-lg font-semibold">{nftMintPrice} MST</span>
                <span className="text-gray-400 text-sm">to mint your milestone as an NFT</span>
              </div>
              <p className="text-gray-400 text-xs mt-1">This fee covers the blockchain transaction to create your unique digital certificate.</p>
            </div>
          )}
        </div> 
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

      {isLoading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mb-2"></div>
          <p className="text-gray-400">Loading your milestones...</p>
        </div>
      ) : filteredMilestones.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          No milestones found matching your filters.
        </div>
      )}

      {/* Timeline Container */}      <div
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
              // Attach ref for measuring height
              ref={el => milestoneRefs.current[index] = el}
              // Add explicit vertical positioning to prevent overlap during initial render
              style={{ top: `${index * (250 + 40)}px` }}
            >
              <div
                className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border border-purple-500/20 transition-all duration-300 ${
                  isMobile ? 'w-full max-w-sm' : 'w-[280px]'
                }`}
              >
                {milestone.image && (
                  <img
                  src={milestone.image?.startsWith("http") ? milestone.image : `http://127.0.0.1:8080/ipfs/${milestone.image}`}
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
                    Create NFT
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

            <h3 className="text-xl font-bold text-white mb-4">Preview NFT</h3>
            
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
                  src={`http://127.0.0.1:8080/ipfs/${previewData.milestone.image}`}
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
                  'Create NFT'
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