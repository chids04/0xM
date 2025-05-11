import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { app } from '../../firebase/client';
import { doc, getDoc, getFirestore, writeBatch } from 'firebase/firestore';
import html2canvas from 'html2canvas-pro';
import { ethers } from 'ethers';
import { error } from 'node_modules/astro/dist/core/logger/core';

interface SharedMilestoneTimelineProps {
  userId: string;
}

const SharedMilestoneTimeline: React.FC<SharedMilestoneTimelineProps> = ({ userId }) => {
  const [milestones, setMilestones] = useState<any[]>([]);
  const [pendingMilestones, setPendingMilestones] = useState<any[]>([]);
  const [filteredMilestones, setFilteredMilestones] = useState<any[]>([]);
  const [signedMilestones, setSignedMilestones] = useState<any[]>([]);
  const [participantDetails, setParticipantDetails] = useState<Record<string, { email: string, username: string }>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [activeTab, setActiveTab] = useState<'active' | 'pending' | 'signed'>('active');
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feeData, setFeeData] = useState<{ signMilestoneFee?: string } | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
const [statusType, setStatusType] = useState<"success" | "error" | null>(null);
  
  // Verification states
  const [verificationStatus, setVerificationStatus] = useState<Record<string, { verified: boolean, loading: boolean, error?: string }>>({});
  const [batchVerifying, setBatchVerifying] = useState(false);
  const [batchResults, setBatchResults] = useState<{ total: number, verified: number, failed: number } | null>(null);

  //nft minting price
    const [nftMintPrice, setNftMintPrice] = useState<string | null>(null);
    const [nftPriceLoading, setNftPriceLoading] = useState(true);
    const [nftPriceError, setNftPriceError] = useState<string | null>(null);

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

  const setStatus = (msg: string, type: "success" | "error" = "error") => {
    setStatusMessage(msg);
    setStatusType(type);
    setTimeout(() => {
      setStatusMessage(null);
      setStatusType(null);
    }, 5000);
  };

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

  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    const fetchMilestonesAndDetails = async () => {
      if (!userId) return;

      setIsLoading(true);
      const db = getFirestore(app);

      // Helper to fetch and join Firestore + IPFS data
      const fetchMilestoneWithIpfs = async (refPath: any) => {
        try {
          let milestoneSnapshot;
          if (typeof refPath === 'string') {
            const pathParts = refPath.split('/');
            if (pathParts.length >= 2) {
              const milestoneRef = doc(db, pathParts[0], pathParts[1]);
              milestoneSnapshot = await getDoc(milestoneRef);
            }
          } else if (refPath?.path) {
            milestoneSnapshot = await getDoc(refPath);
          }
          if (!milestoneSnapshot?.exists()) return null;
          const milestoneDocData = milestoneSnapshot.data();
          const metadataCid = milestoneDocData?.ipfsCIDs?.metadataCid;
          let ipfsData = {};
          if (metadataCid) {
            const ipfsUrl = `https://ipfs.io/ipfs/${metadataCid}`;
            try {
              // Timeout promise for 5 seconds
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("IPFS fetch timed out")), 5000)
              );
              const ipfsResponse = await Promise.race([
                fetch(ipfsUrl),
                timeoutPromise
              ]);
              if (ipfsResponse.ok) {
                ipfsData = await ipfsResponse.json();
              } else {
                setStatus("Some milestones may not be available yet, please try again later", "error");
                return null;
              }
            } catch (err) {
              setStatus("Some milestones may not be available yet, please try again later", "error");
              console.error("Failed to fetch milestone data from IPFS:", ipfsUrl, err);
              return null;
            }
          }
          return {
            id: milestoneSnapshot.id,
            ...ipfsData,
            ...milestoneDocData,
          };
        } catch (error) {
          console.error("Error fetching milestone from Firestore/IPFS:", error, refPath);
          return null;
        }
      };

      try {
        // Fetch signed milestones
        const signedRef = doc(db, "users", userId, "milestones", "signed");
        const signedSnapshot = await getDoc(signedRef);
        let signedMilestonesData: any[] = [];

        if (signedSnapshot.exists()) {
          const signedData = signedSnapshot.data();
          const signedRefs = signedData?.milestoneRefs || [];
          const signedMilestonesPromises = signedRefs.map(fetchMilestoneWithIpfs);

          signedMilestonesData = (await Promise.all(signedMilestonesPromises))
            .filter(milestone => milestone !== null)
            .map((milestone, index) => ({ ...milestone, index }))
            .sort((a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime());

          // Check for finalized milestones to move to accepted
          const finalizedMilestones = signedMilestonesData.filter(milestone => 
            milestone.isPending === false
          );

          if (finalizedMilestones.length > 0) {
            console.log(`Found ${finalizedMilestones.length} finalized milestones to move to accepted collection`);
            const batch = writeBatch(db);
            const signedRef = doc(db, "users", userId, "milestones", "signed");
            const acceptedRef = doc(db, "users", userId, "milestones", "accepted");
            const signedDoc = await getDoc(signedRef);
            const acceptedDoc = await getDoc(acceptedRef);

            if (signedDoc.exists()) {
              const signedData = signedDoc.data();
              const signedRefs = signedData?.milestoneRefs || [];
              const updatedSignedRefs = signedRefs.filter((ref: any) => {
                if (typeof ref === 'string') {
                  const pathParts = ref.split('/');
                  if (pathParts.length >= 2) {
                    const docId = pathParts[1];
                    return !finalizedMilestones.some(m => m.id === docId);
                  }
                }
                return true;
              });
              batch.update(signedRef, { milestoneRefs: updatedSignedRefs });
            }

            if (acceptedDoc.exists()) {
              const acceptedData = acceptedDoc.data();
              const acceptedRefs = acceptedData?.milestoneRefs || [];
              const refsToAdd = finalizedMilestones.map(milestone => 
                doc(db, "milestones", milestone.id)
              );
              const uniqueRefsToAdd = refsToAdd.filter(newRef => 
                !acceptedRefs.some((existingRef: string | { path?: string }) => {
                  if (typeof existingRef === 'string') {
                    return existingRef.endsWith(`/${newRef.id}`);
                  } else if (existingRef?.path) {
                    return existingRef.path.endsWith(`/${newRef.id}`);
                  }
                  return false;
                })
              );
              if (uniqueRefsToAdd.length > 0) {
                batch.update(acceptedRef, { milestoneRefs: [...acceptedRefs, ...uniqueRefsToAdd] });
              }
            } else {
              const refsToAdd = finalizedMilestones.map(milestone => 
                doc(db, "milestones", milestone.id)
              );
              batch.set(acceptedRef, { milestoneRefs: refsToAdd });
            }

            try {
              await batch.commit();
              console.log("Successfully moved finalized milestones from signed to accepted");
              signedMilestonesData = signedMilestonesData.filter(milestone => 
                milestone.isPending !== false && 
                milestone.finalizedAt === undefined
              );
            } catch (error) {
              console.error("Error moving finalized milestones:", error);
            }
          }
        }

        setSignedMilestones(signedMilestonesData);

        // Fetch accepted milestones
        const acceptedRef = doc(db, "users", userId, "milestones", "accepted");
        const acceptedSnapshot = await getDoc(acceptedRef);
        let sharedMilestones: any[] = [];

        if (acceptedSnapshot.exists()) {
          const acceptedData = acceptedSnapshot.data();
          const milestoneRefs = acceptedData?.milestoneRefs || [];
          const milestonesDataPromises = milestoneRefs.map(fetchMilestoneWithIpfs);

          sharedMilestones = (await Promise.all(milestonesDataPromises))
            .filter(milestone => milestone !== null)
            .filter(milestone => milestone.owner === userId || (milestone.taggedFriendIds || []).includes(userId))
            .filter(milestone => (milestone.participants || []).length > 0)
            .map((milestone, index) => ({ ...milestone, index }))
            .sort((a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime());
        }

        setMilestones(sharedMilestones);
        setFilteredMilestones(sharedMilestones);

        // Fetch pending milestones
        const pendingRef = doc(db, "users", userId, "milestones", "pending");
        const pendingSnapshot = await getDoc(pendingRef);
        let pendingMilestonesData: any[] = [];

        if (pendingSnapshot.exists()) {
          const pendingData = pendingSnapshot.data();
          const pendingRefs = pendingData?.milestoneRefs || [];
          const pendingMilestonesPromises = pendingRefs.map(fetchMilestoneWithIpfs);

          pendingMilestonesData = (await Promise.all(pendingMilestonesPromises))
            .filter(milestone => milestone !== null)
            .filter(milestone => milestone.owner === userId || (milestone.taggedFriendIds || []).includes(userId))
            .map((milestone, index) => ({
              ...milestone,
              proposedBy: milestone.owner || "Unknown",
              signatureCount: milestone.signatureCount || 0,
              index
            }))
            .sort((a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime());
        }

        console.log("Pending milestones:", pendingMilestonesData);

        setPendingMilestones(pendingMilestonesData);

        // Fetch participant details (email and username)
        const allUids = [
          ...new Set([
            ...pendingMilestonesData.flatMap(m => m.taggedFriendIds || []),
            ...pendingMilestonesData.map(m => m.owner),
            ...sharedMilestones.flatMap(m => m.taggedFriendIds || []),
            ...sharedMilestones.map(m => m.owner),
            ...signedMilestonesData.flatMap(m => m.taggedFriendIds || []),
            ...signedMilestonesData.map(m => m.owner),
          ].filter(Boolean)),
        ];

        if (allUids.length > 0) {
          try {
            const response = await fetch('/api/friends/details', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ friendIds: allUids }),
            });

            if (!response.ok) {
              throw new Error('Failed to fetch user details');
            }

            const detailsMap = await response.json();
            // Ensure both email and username are included, fallback to UID-based placeholders if missing
            const formattedDetails = allUids.reduce((acc, uid) => {
              acc[uid] = {
                email: detailsMap[uid]?.email || `user-${uid.substring(0, 4)}@unknown.com`,
                username: detailsMap[uid]?.username || `User-${uid.substring(0, 4)}`
              };
              return acc;
            }, {} as Record<string, { email: string, username: string }>);

            setParticipantDetails(formattedDetails);
          } catch (emailError) {
            console.error('Error fetching user details:', emailError);
            const fallbackDetails = allUids.reduce((acc, uid) => {
              acc[uid] = {
                email: `user-${uid.substring(0, 4)}@unknown.com`,
                username: `User-${uid.substring(0, 4)}`
              };
              return acc;
            }, {} as Record<string, { email: string, username: string }>);
            setParticipantDetails(fallbackDetails);
          }
        }
      } catch (error) {
        console.error("Error fetching milestones:", error);
        setStatus("Error fetching milestones. Please try again.", "error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchMilestonesAndDetails();
  }, [userId]);

  useEffect(() => {
    const fetchFees = async () => {
      try {
        setFeeLoading(true);
        setFeeError(null);
        const response = await fetch("/api/milestone/fees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feeType: "milestone" }),
        });

        if (!response.ok) throw new Error((await response.json())?.error?.message || "Failed to fetch fees");
        const data = await response.json();
        if (data.success && data.fees) setFeeData(data.fees);
        else throw new Error("Invalid fee data received");
      } catch (error) {
        console.error("Error fetching fees:", error);
        setFeeError((error as Error).message || "Failed to fetch fees");
      } finally {
        setFeeLoading(false);
      }
    };

    fetchFees();
  }, []);

  useLayoutEffect(() => {
    const updatePositions = () => {
      if (!containerRef.current) return;
      const activeItems = activeTab === 'active' ? filteredMilestones : activeTab === 'pending' ? pendingMilestones : signedMilestones;
      if (activeItems.length === 0) return;

      const container = containerRef.current;
      const milestoneElements = container.querySelectorAll('.milestone-card');
      const totalMilestones = milestoneElements.length;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) return;

      if (window.innerWidth < 768) {
        milestoneElements.forEach((milestone, i) => {
          const cardHeight = 360;
          const verticalPos = cardHeight * i + 10 * i;
          (milestone as HTMLElement).style.top = `${verticalPos}px`;
          (milestone as HTMLElement).style.left = '50%';
        });
      } else {
        const maxAmplitude = containerWidth * 0.3;
        const amplitude = Math.min(maxAmplitude, Math.max(20, (window.innerWidth - 480) / 4));
        const cardHeight = 360;
        const totalSpacing = containerHeight - (cardHeight * totalMilestones);
        const spaceBetweenCards = totalSpacing / (totalMilestones || 1);

        milestoneElements.forEach((milestone) => {
          const index = parseInt(milestone.getAttribute('data-index') || '0');
          const verticalPos = spaceBetweenCards * index + cardHeight * index;
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
  }, [filteredMilestones, pendingMilestones, signedMilestones, activeTab]);

  useEffect(() => {
    if (activeTab === 'active') {
      let filtered = [...milestones];
      if (searchTerm) {
        filtered = filtered.filter(milestone => milestone.description.toLowerCase().includes(searchTerm.toLowerCase()));
      }
      if (dateRange.start) {
        const startDate = new Date(dateRange.start);
        filtered = filtered.filter(milestone => new Date(milestone.milestone_date) >= startDate);
      }
      if (dateRange.end) {
        const endDate = new Date(dateRange.end);
        filtered = filtered.filter(milestone => new Date(milestone.milestone_date) <= endDate);
      }
      setFilteredMilestones(filtered);
    }
  }, [milestones, searchTerm, dateRange, activeTab]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value);
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDateRange(prev => ({ ...prev, [name]: value }));
  };

  const handleAcceptMilestone = async (pendingMilestone: any) => {
    if (!userId || pendingMilestone.owner === userId) {
      alert("You can't sign your own milestone.");
      return;
    }

    setIsLoading(true);
    try {
      if(!feeData){
        throw new Error("Fee data not available, try again later");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();

      const payment = await fetch("api/transaction/make-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: window.ethereum.selectedAddress,
          amount: feeData.signMilestoneFee,
        }),
      });

      if(!payment.ok) {
        throw new Error("Failed to create payment transaction, please try again later");
      }

      const paymentData = await payment.json();
      const { domain: paymentDomain, types: paymentTypes, message: paymentMessage } = paymentData;

      let paymentSignature;
      try {
        paymentSignature = await signer.signTypedData(paymentDomain, paymentTypes, paymentMessage);
      } catch {
        setStatus("Signature request was rejected.", "error");
        throw new Error("Signature request was rejected.");
      }

      const paymentTx = await fetch("/api/transaction/send-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: paymentData,
          signature: paymentSignature,
        }),
      });

      if (!paymentTx.ok) {
        const errorData = await paymentTx.json();
        throw new Error(errorData?.error?.message || "Failed to send payment transaction, please try again later");
      }

      const paymentTxData = await paymentTx.json();
      setStatus(`Succesfully approved payment of ${feeData.signMilestoneFee} MST`, "success");

      const accept = await fetch('/api/milestone/create-accept-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestoneId: pendingMilestone.id,
          ownerUid: pendingMilestone.owner || pendingMilestone.proposedBy,
          fee: feeData?.signMilestoneFee
        }),
      });

      if(!accept.ok) {
        const errorData = await accept.json();
        throw new Error(errorData?.error?.message || "Failed to create blockchain transaction, please try again later");
      }

      const { metaTxRequest, domain, types }  = await accept.json();

      let signedTransaction;
      try {
        signedTransaction = await signer.signTypedData(domain, types, metaTxRequest);
      }catch {
        setStatus("Signature request was rejected.", "error");
        throw new Error("Signature request was rejected.");
      }

      const tx = {
        ...metaTxRequest,
        signature: signedTransaction,
      }


      const relayRes = await fetch("/api/milestone/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaTx: tx,
          type: "sign",
        }),
      });

      if (!relayRes.ok) {
        throw new Error("Failed to send signature to the blockchain, please try again later");
      }

      const { txHash, blockNum } = await relayRes.json();

      console.log("Transaction hash:", txHash);
      console.log("Block number:", blockNum);
      console.log("Milestone ID:", pendingMilestone.id);

      const storeRes = await fetch("/api/milestone/save-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({  
          milestoneId: pendingMilestone.id,
          blockNumber: blockNum,
          hash: txHash
        }),
      });

      if (!storeRes.ok) {
        throw new Error("Failed to store signature, please try again later");
      }
      const result = await storeRes.json();

      if (!result.success) {
        throw new Error("Failed to store signature, please try again later");
      }


      setPendingMilestones(prev => prev.filter(item => item.id !== pendingMilestone.id));
      if (result.isFinalized) {
        const newMilestone = { ...pendingMilestone, isPending: false};
        setMilestones(prev => [...prev, newMilestone].sort((a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()));
      }
      setStatus("Milestone accepted successfully!", "success");
    } catch (error: any) {
      console.error("Error accepting milestone:", error);
      setStatus(error.message, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDenyMilestone = async (pendingMilestone: any) => {
    if (!userId || pendingMilestone.owner === userId) {
      alert("You can't deny your own milestone. If you no longer want this milestone, please delete it.");
      return;
    }

    setIsLoading(true);
    try {
      const message = `Decline milestone ${pendingMilestone.id} at ${Date.now()}`;
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [message, window.ethereum.selectedAddress],
      });
      const response = await fetch('/api/milestone/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestoneId: pendingMilestone.id,
          signature,
          message
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to decline milestone');

      setPendingMilestones(prev => prev.filter(item => item.id !== pendingMilestone.id));
      alert('Milestone declined successfully!');
    } catch (error: any) {
      console.error("Error declining milestone:", error);
      alert(`Failed to decline milestone: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
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
        body: JSON.stringify({ 
          userId: userId,
          milestoneId: milestoneId 
        })
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

  // Verify all milestones owned by the user
  const verifyAllMilestones = async () => {
    const ownedMilestones = filteredMilestones.filter(m => m.owner === userId);
    if (!ownedMilestones.length) return;
    
    setBatchVerifying(true);
    setBatchResults(null);
    
    try {
      let verified = 0;
      let failed = 0;
      
      for (const milestone of ownedMilestones) {
        const isVerified = await verifyMilestone(milestone.id);
        if (isVerified) {
          verified++;
        } else {
          failed++;
        }
      }
      
      setBatchResults({
        total: ownedMilestones.length,
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
      alert(`NFT minted successfully! Token ID: ${result.tokenId}...`);
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

  const activeDisplayItems = activeTab === 'active' ? filteredMilestones : activeTab === 'pending' ? pendingMilestones : signedMilestones;
  const containerHeight = isMobile ? activeDisplayItems.length * 380 : activeDisplayItems.length * 360 + 200;

  // Check if there are any owned milestones for batch verification
  const hasOwnedMilestones = filteredMilestones.some(m => m.owner === userId);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-6">Shared Milestones</h1>
      {statusMessage && (
        <div
          className={`p-3 rounded-md mb-4 ${
            statusType === "success"
              ? "bg-green-900/30 text-green-400"
              : "bg-red-900/30 text-red-400"
          }`}
        >
          {statusMessage}
        </div>
      )}
      {isLoading && (
        <div className="text-center py-8 text-gray-400">
          <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          Loading milestones...
        </div>
      )}

      <div className="flex border-b border-purple-500/30 mb-6">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 font-medium ${activeTab === 'active' ? 'text-purple-500 border-b-2 border-purple-500' : 'text-gray-400 hover:text-purple-300'}`}
        >
          Active Milestones
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 font-medium ${activeTab === 'pending' ? 'text-purple-500 border-b-2 border-purple-500' : 'text-gray-400 hover:text-purple-300'} relative`}
        >
          Pending Milestones
          {pendingMilestones.length > 0 && (
            <span className="absolute top-0 right-0 px-2 py-1 text-xs bg-purple-500 text-white rounded-full">
              {pendingMilestones.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('signed')}
          className={`px-4 py-2 font-medium ${activeTab === 'signed' ? 'text-purple-500 border-b-2 border-purple-500' : 'text-gray-400 hover:text-purple-300'} relative`}
        >
          Signed Milestones
          {signedMilestones.length > 0 && (
            <span className="absolute top-0 right--5 px-2 py-1 text-xs bg-purple-500 text-white rounded-full">
              {signedMilestones.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'active' && (
        <>
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
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-400 mb-1">Search Milestones</label>
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
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-400 mb-1">Start Date</label>
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
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-400 mb-1">End Date</label>
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
                onClick={() => { setSearchTerm(''); setDateRange({ start: '', end: '' }); }}
                className="w-full bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {hasOwnedMilestones && (
            <div className="mb-6 flex flex-wrap gap-4 items-center">
              <button 
                onClick={verifyAllMilestones}
                disabled={batchVerifying || !hasOwnedMilestones}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {batchVerifying ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Verifying...
                  </>
                ) : (
                  <>Verify All Your Milestones</>
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
          )}
        </>
      )}

      {activeTab === 'pending' && (
        <div className="mb-6">
          {feeLoading ? (
            <div className="p-3 bg-gray-800 rounded-md animate-pulse"><p className="text-gray-400">Loading transaction fees...</p></div>
          ) : feeError ? (
            <div className="p-3 bg-red-900/30 text-red-400 rounded-md text-sm">Failed to load fee information: {feeError}</div>
          ) : feeData && (
            <div className="p-4 bg-[#222] border border-yellow-500/20 rounded-md">
              <h3 className="text-white font-medium mb-2">Milestone Signature Fee</h3>
              <div className="text-sm">
                <p className="text-gray-400"><span className="mr-2">•</span>Signing a milestone costs: <span className="text-yellow-400 font-medium">{feeData.signMilestoneFee} MST</span></p>
                <p className="text-gray-400 text-xs mt-1">This fee is required to record your signature on the blockchain</p>
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-gray-400">
          <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          Loading milestones...
        </div>
      ) : (
        <>
          {activeTab === 'active' && filteredMilestones.length === 0 && (
            <div className="text-center py-8 text-gray-400">No milestones found matching your filters.</div>
          )}
          {activeTab === 'pending' && pendingMilestones.length === 0 && (
            <div className="text-center py-8 text-gray-400">No pending milestones to review.</div>
          )}
          {activeTab === 'signed' && signedMilestones.length === 0 && (
            <div className="text-center py-8 text-gray-400">No signed milestones found.</div>
          )}

          <div className="relative w-full my-10" style={{ height: `${containerHeight}px` }} ref={containerRef}>
            <div className="hidden lg:block absolute top-0 left-1/2 h-full w-0.5 bg-purple-500/30 transform -translate-x-1/2"></div>
            <div className="milestone-container">
              {activeTab === 'active' && filteredMilestones.map((milestone, index) => (
                <div key={milestone.id} className="milestone-card" data-index={index}>
                  <div className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border ${milestone.owner === userId ? 'border-blue-500/50' : 'border-purple-500/50'} transition-all duration-300 ${isMobile ? 'w-full max-w-md' : 'w-[360px]'}`}>
                    <div className="mb-2 flex items-center">
                      {milestone.owner === userId ? (
                        <span className="bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded-full">Your Milestone</span>
                      ) : (
                        <span className="bg-purple-500/20 text-purple-300 text-xs px-2 py-1 rounded-full">Shared With You</span>
                      )}
                    </div>
                    {milestone.image && (
                      <img 
                        src={
                          milestone.image.startsWith('http')
                            ? milestone.image
                            : `https://ipfs.io/ipfs/${milestone.image}`
                        }
                        alt={milestone.description} 
                        className="w-full h-40 object-cover rounded-md mb-2"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <p className="text-white text-lg font-medium mb-2 truncate">{milestone.description}</p>
                    <p className="text-gray-400 mb-1">Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}</p>
                    <p className="text-gray-400 mb-1">Owner: {participantDetails[milestone.owner]?.username} ({participantDetails[milestone.owner]?.email})</p>
                    <p className="text-gray-400 mb-1 break-words">
                      Participants:{' '}
                      {(milestone.taggedFriendIds || []).map((uid: string, i: number) => (
                        <span key={uid}>
                          {participantDetails[uid]?.username} ({participantDetails[uid]?.email})
                          {i < milestone.taggedFriendIds.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </p>
                    <p className="text-gray-400">Created: {new Date(milestone.createdAt).toLocaleString('en-US')}</p>
                    
                    {getVerificationBadge(milestone.id)}
                    
                    <div className="mt-3 flex gap-2">
                      {milestone.owner === userId && !verificationStatus[milestone.id]?.loading && (
                        <button
                          onClick={() => verifyMilestone(milestone.id)}
                          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors"
                        >
                          Verify
                        </button>
                      )}
                      {milestone.owner === userId && (
                        <button
                          onClick={() => handleShowPreview(milestone)}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                        >
                          Create NFT
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {activeTab === 'pending' && pendingMilestones.map((milestone, index) => (
                <div key={milestone.id} className="milestone-card" data-index={index}>
                  <div className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border ${milestone.owner === userId ? 'border-orange-500/50' : 'border-yellow-500/30'} transition-all duration-300 ${isMobile ? 'w-full max-w-md' : 'w-[360px]'}`}>
                    <div className="mb-2 flex items-center">
                      {milestone.owner === userId ? (
                        <span className="bg-orange-500/20 text-orange-300 text-xs px-2 py-1 rounded-full">Awaiting Signatures</span>
                      ) : (
                        <span className="bg-yellow-500/20 text-yellow-300 text-xs px-2 py-1 rounded-full">Pending Your Approval</span>
                      )}
                    </div>
                    {milestone.image && (
                      <img 
                        src={
                          milestone.image.startsWith('http')
                            ? milestone.image
                            : `https://ipfs.io/ipfs/${milestone.image}`
                        }
                        alt={milestone.description} 
                        className="w-full h-40 object-cover rounded-md mb-2"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <p className="text-white text-lg font-medium mb-2 truncate">{milestone.description}</p>
                    <p className="text-gray-400 mb-1">Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}</p>
                    <p className="text-gray-400 mb-1">Proposed by: {participantDetails[milestone.owner]?.username} ({participantDetails[milestone.owner]?.email})</p>
                    <p className="text-gray-400 mb-1 break-words">
                      Participants:{' '}
                      {(milestone.taggedFriendIds || []).map((uid: string, i: number) => (
                        <span key={uid} className={uid === userId ? "text-purple-300" : ""}>
                          {participantDetails[uid]?.username} ({participantDetails[uid]?.email})
                          {i < milestone.taggedFriendIds.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </p>
                    <p className="text-gray-400 mb-3">Signatures: {milestone.signatureCount}/{milestone.taggedFriendIds?.length || 0}</p>
                    {milestone.owner !== userId && (
                      <div className="flex space-x-2 mt-2">
                        <button
                          onClick={() => handleAcceptMilestone(milestone)}
                          disabled={isLoading}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex-1"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleDenyMilestone(milestone)}
                          disabled={isLoading}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors flex-1"
                        >
                          Deny
                        </button>
                      </div>
                    )}
                    {milestone.owner === userId && (
                      <div className="bg-gray-800/50 p-3 rounded-md text-sm text-gray-300 mt-2">
                        Waiting for participants to sign this milestone. You'll be notified when signatures are complete.
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {activeTab === 'signed' && signedMilestones.map((milestone, index) => (
                <div key={milestone.id} className="milestone-card" data-index={index}>
                  <div className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border border-green-500/50 transition-all duration-300 ${isMobile ? 'w-full max-w-md' : 'w-[360px]'}`}>
                    <div className="mb-2 flex items-center">
                      <span className="bg-green-500/20 text-green-300 text-xs px-2 py-1 rounded-full">Signed by You</span>
                    </div>
                    {milestone.image && (
                      <img 
                        src={
                          milestone.image.startsWith('http')
                            ? milestone.image
                            : `https://ipfs.io/ipfs/${milestone.image}`
                        }
                        alt={milestone.description} 
                        className="w-full h-40 object-cover rounded-md mb-2"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                    <p className="text-white text-lg font-medium mb-2 truncate">{milestone.description}</p>
                    <p className="text-gray-400 mb-1">Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}</p>
                    <p className="text-gray-400 mb-1">Owner: {participantDetails[milestone.owner]?.username} ({participantDetails[milestone.owner]?.email})</p>
                    <p className="text-gray-400 mb-1 break-words">
                      Participants:{' '}
                      {(milestone.taggedFriendIds || []).map((uid: string, i: number) => (
                        <span key={uid} className={uid === userId ? "text-green-300" : ""}>
                          {participantDetails[uid]?.username} ({participantDetails[uid]?.email})
                          {i < milestone.taggedFriendIds.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </p>
                    <p className="text-gray-400">Created: {new Date(milestone.createdAt).toLocaleString('en-US')}</p>
                    {milestone.finalizedAt && <p className="text-gray-400">Finalized: {new Date(milestone.finalizedAt).toLocaleString('en-US')}</p>}
                    
                    {getVerificationBadge(milestone.id)}
                    
                    <div className="mt-3 flex gap-2">
                      {milestone.owner === userId && !verificationStatus[milestone.id]?.loading && (
                        <button
                          onClick={() => verifyMilestone(milestone.id)}
                          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors"
                        >
                          Verify
                        </button>
                      )}
                      {milestone.owner === userId && (
                        <button
                          onClick={() => handleShowPreview(milestone)}
                          className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                        >
                          Create NFT
                        </button>
                      )}
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

                <h3 className="text-xl font-bold text-white mb-4">Preview Image</h3>
                
                <div id="certificate-container" className="p-6 bg-[#1a1a1a] rounded-lg">
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-white mb-2">
                      {previewData.milestone.description}
                    </h2>
                  </div>

                  <div className="mb-8">
                    {previewData.milestone.image && (
                      <div className="mt-4 flex justify-center">
                        <img
                          src={
                            previewData.milestone.image.startsWith('http')
                              ? previewData.milestone.image
                              : `https://ipfs.io/ipfs/${previewData.milestone.image}`
                          }
                          alt="Milestone"
                          className="max-w-full h-auto rounded-lg"
                          style={{ maxHeight: '200px' }}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <div className="mt-4 bg-[#252525] p-4 rounded-lg flex flex-col items-center">
                      <p className="text-gray-400 text-sm mb-1 text-center">Participants</p>
                      <p className="text-white text-center">
                      <>
                        <span className="font-medium">{participantDetails[previewData.milestone.owner]?.username} </span>
                        {(previewData.milestone.taggedFriendIds || []).length > 0 && <span className="mx-1">•</span>}
                        {(previewData.milestone.taggedFriendIds || []).map((uid: string, i: number) => (
                        <span key={uid}>
                          {participantDetails[uid]?.username}
                          {i < previewData.milestone.taggedFriendIds.length - 1 ? ', ' : ''}
                        </span>
                        ))}
                      </>
                      </p>
                    </div>
                    <div className="mt-6 bg-[#252525] p-4 rounded-lg flex flex-col items-center">
                      <p className="text-gray-400 text-sm mb-1 text-center">date</p>
                      <p className="text-white text-center">
                        {new Date(previewData.milestone.createdAt).toLocaleString()}
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
        </>
      )}
      <style>{styles}</style>
    </div>
  );
};

const styles = `
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
  .milestone-card > div {
    max-height: 380px;
    overflow-x: hidden;
    overflow-y: auto;
  }
  .truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .break-words {
    overflow-wrap: break-word;
    word-break: break-all;
  }
  @media (max-width: 767px) {
    .milestone-card > div {
      width: 90vw;
      max-width: 32rem;
      max-height: 380px;
    }
  }
`;

export default SharedMilestoneTimeline;