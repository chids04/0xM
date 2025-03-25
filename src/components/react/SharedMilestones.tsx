import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { app } from '../../firebase/client';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

interface SharedMilestoneTimelineProps {
  userId: string;
}

const SharedMilestoneTimeline: React.FC<SharedMilestoneTimelineProps> = ({ userId }) => {
  const [milestones, setMilestones] = useState<any[]>([]);
  const [pendingMilestones, setPendingMilestones] = useState<any[]>([]);
  const [filteredMilestones, setFilteredMilestones] = useState<any[]>([]);
  const [participantEmails, setParticipantEmails] = useState<Record<string, string>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [activeTab, setActiveTab] = useState<'active' | 'pending'>('active');
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    const fetchMilestonesAndEmails = async () => {
      if (!userId) return;

      setIsLoading(true);
      const db = getFirestore(app);

      try {
        const milestonesRef = doc(db, "users", userId, "milestones", "milestoneData");
        const snapshot = await getDoc(milestonesRef);

        if (snapshot.exists()) {
          const data = snapshot.data();

          const acceptedMilestoneArr = data.acceptedMilestones || [];
          const milestonesData = acceptedMilestoneArr
            .filter((item: any) => (item.participants || []).length > 0)
            .map((item: any, index: number) => ({
              description: item.description,
              milestone_date: item.milestone_date,
              createdAt: item.createdAt,
              participants: item.participants || [],
              taggedFriendIds: item.taggedFriendIds || [],
              image: item.image || '', // Add image field
              id: item.id || index,
              index,
            }));

          milestonesData.sort(
            (a: any, b: any) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
          );

          setMilestones(milestonesData);
          setFilteredMilestones(milestonesData);

          const pendingMilestoneArr = data.pendingMilestones || [];
          const pendingData = pendingMilestoneArr.map((item: any, index: number) => ({
            description: item.description,
            milestone_date: item.milestone_date,
            createdAt: item.createdAt,
            participants: item.participants || [],
            taggedFriendIds: item.taggedFriendIds || [],
            proposedBy: item.owner || "Unknown",
            image: item.image || '', // Add image field
            id: item.id || `pending-${index}`,
            index,
            signatureCount: item.signatureCount || 0,
          }));

          pendingData.sort(
            (a: any, b: any) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
          );

          console.log("Pending milestones:", pendingData);
          setPendingMilestones(pendingData);

          const allUids = [
            ...new Set([
              ...pendingData.flatMap((m) => m.taggedFriendIds || []),
              ...milestonesData.flatMap((m) => m.taggedFriendIds || []),
            ]),
          ];
          if (allUids.length > 0) {
            const response = await fetch('/api/users/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uids: allUids }),
            });

            if (response.ok) {
              const emailData = await response.json();
              setParticipantEmails(emailData);
            } else {
              console.error("Failed to fetch participant emails:", response.statusText);
            }
          }
        } else {
          console.error("Milestones document does not exist.");
          setMilestones([]);
          setFilteredMilestones([]);
          setPendingMilestones([]);
        }
      } catch (error) {
        console.error("Error fetching milestones:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMilestonesAndEmails();
  }, [userId]);

  useLayoutEffect(() => {
    const updatePositions = () => {
      if (!containerRef.current) return;
      const activeItems = activeTab === 'active' ? filteredMilestones : pendingMilestones;
      if (activeItems.length === 0) return;
  
      const container = containerRef.current;
      const milestoneElements = container.querySelectorAll('.milestone-card');
      const totalMilestones = milestoneElements.length;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
  
      if (containerWidth === 0 || containerHeight === 0) return;
  
      if (window.innerWidth < 768) {
        milestoneElements.forEach((milestone, i) => {
          const cardHeight = 340; // Match max-height for mobile
          // Reduce offset to start higher (e.g., remove or lower the 20px spacing)
          const verticalPos = cardHeight * i + 10 * i; // Changed from + 20 * (i + 1) to + 10 * i
          (milestone as HTMLElement).style.top = `${verticalPos}px`;
          (milestone as HTMLElement).style.left = '50%';
        });
      } else {
        const maxAmplitude = containerWidth * 0.3;
        const amplitude = Math.min(maxAmplitude, Math.max(20, (window.innerWidth - 480) / 4));
        const cardHeight = 300; // Match max-height for desktop
        const totalSpacing = containerHeight - (cardHeight * totalMilestones);
        const spaceBetweenCards = totalSpacing / (totalMilestones || 1); // Avoid division by zero
  
        milestoneElements.forEach((milestone) => {
          const index = parseInt(milestone.getAttribute('data-index') || '0');
          // Simplify to start higher: remove cardHeight / 2 offset
          const verticalPos = spaceBetweenCards * index + cardHeight * index; // Changed from + cardHeight / 2
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
  }, [filteredMilestones, pendingMilestones, activeTab]);

  useEffect(() => {
    if (activeTab === 'active') {
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
    }
  }, [milestones, searchTerm, dateRange, activeTab]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDateRange((prev) => ({ ...prev, [name]: value }));
  };

  const handleAcceptMilestone = async (pendingMilestone: any) => {
    if (!userId) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/milestone/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestoneId: pendingMilestone.id,
          ownerUid: pendingMilestone.proposedBy || "Unknown",
          participants: pendingMilestone.participants || [],
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to accept milestone');
      }

      setPendingMilestones((prev) => prev.filter((item) => item.id !== pendingMilestone.id));

      if (result.isFinalized) {
        const newMilestone = {
          ...pendingMilestone,
          isShared: (pendingMilestone.participants || []).length > 1,
          isPending: false,
          transactionHash: result.transactionHash,
        };
        setMilestones((prev) =>
          [...prev, newMilestone].sort(
            (a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
          )
        );
      }

      alert('Milestone accepted successfully!');
    } catch (error: any) {
      console.error("Error accepting milestone:", error);
      alert(`Failed to accept milestone: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDenyMilestone = async (pendingMilestone: any) => {
    if (!userId) return;

    setIsLoading(true);

    try {
      const response = await fetch('/api/milestone/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          milestoneId: pendingMilestone.id,
          ownerUid: pendingMilestone.proposedBy || "Unknown",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to decline milestone');
      }

      setPendingMilestones((prev) => prev.filter((item) => item.id !== pendingMilestone.id));

      alert('Milestone declined successfully!');
    } catch (error: any) {
      console.error("Error declining milestone:", error);
      alert(`Failed to decline milestone: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const activeDisplayItems = activeTab === 'active' ? filteredMilestones : pendingMilestones;
  const containerHeight = isMobile
    ? activeDisplayItems.length * 360 // Increased to account for taller cards
    : activeDisplayItems.length * 320 + 200; // Adjusted for desktop

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-6">Shared Milestones</h1>

      <div className="flex border-b border-purple-500/30 mb-6">
        <button
          onClick={() => setActiveTab('active')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'active'
              ? 'text-purple-500 border-b-2 border-purple-500'
              : 'text-gray-400 hover:text-purple-300'
          }`}
        >
          Active Milestones
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'pending'
              ? 'text-purple-500 border-b-2 border-purple-500'
              : 'text-gray-400 hover:text-purple-300'
          } relative`}
        >
          Pending Milestones
          {pendingMilestones.length > 0 && (
            <span className="absolute top-0 right-0 px-2 py-1 text-xs bg-purple-500 text-white rounded-full">
              {pendingMilestones.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'active' && (
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

          <div className="relative w-full my-10" style={{ height: `${containerHeight}px` }} ref={containerRef}>
            <div className="hidden lg:block absolute top-0 left-1/2 h-full w-0.5 bg-purple-500/30 transform -translate-x-1/2"></div>

            <div className="milestone-container">
              {activeTab === 'active' &&
                filteredMilestones.map((milestone, index) => (
                  <div key={milestone.id} className="milestone-card" data-index={index}>
                    <div
                      className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border ${
                        milestone.isShared ? 'border-purple-500/50' : 'border-purple-500/20'
                      } transition-all duration-300 ${isMobile ? 'w-full max-w-md' : 'w-[360px]'}`}
                    >
                      {milestone.isShared && (
                        <div className="mb-2 flex items-center">
                          <span className="bg-purple-500/20 text-purple-300 text-xs px-2 py-1 rounded-full">
                            Shared
                          </span>
                        </div>
                      )}
                      {milestone.image && (
                        <img
                          src={milestone.image}
                          alt={milestone.description}
                          className="w-full h-40 object-cover rounded-md mb-2"
                        />
                      )}
                      <p className="text-white text-lg font-medium mb-2 truncate">{milestone.description}</p>
                      <p className="text-gray-400 mb-1">
                        Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}
                      </p>
                      <p className="text-gray-400 mb-1 break-words">
                        Participants:{' '}
                        {(milestone.taggedFriendIds || []).map((uid: string, i: number) => (
                          <span key={uid}>
                            {participantEmails[uid] || 'Unknown'} ({milestone.participants[i] || 'No public key'})
                            {i < milestone.taggedFriendIds.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </p>
                      <p className="text-gray-400">
                        Created: {new Date(milestone.createdAt).toLocaleString('en-US')}
                      </p>
                    </div>
                  </div>
                ))}

              {activeTab === 'pending' &&
                pendingMilestones.map((milestone, index) => (
                  <div key={milestone.id} className="milestone-card" data-index={index}>
                    <div
                      className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border border-yellow-500/30 transition-all duration-300 ${
                        isMobile ? 'w-full max-w-md' : 'w-[360px]'
                      }`}
                    >
                      <div className="mb-2 flex items-center">
                        <span className="bg-yellow-500/20 text-yellow-300 text-xs px-2 py-1 rounded-full">
                          Pending Approval
                        </span>
                      </div>
                      {milestone.image && (
                        <img
                          src={milestone.image}
                          alt={milestone.description}
                          className="w-full h-40 object-cover rounded-md mb-2"
                        />
                      )}
                      <p className="text-white text-lg font-medium mb-2 truncate">{milestone.description}</p>
                      <p className="text-gray-400 mb-1">
                        Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}
                      </p>
                      <p className="text-gray-400 mb-1">Proposed by: {milestone.proposedBy}</p>
                      <p className="text-gray-400 mb-1 break-words">
                        Participants:{' '}
                        {(milestone.taggedFriendIds || []).map((uid: string, i: number) => (
                          <span key={uid}>
                            {participantEmails[uid] || 'Unknown'} ({milestone.participants[i] || 'No public key'})
                            {i < milestone.taggedFriendIds.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </p>
                      <p className="text-gray-400 mb-3">
                        Signatures: {milestone.signatureCount}/{milestone.taggedFriendIds?.length || 0}
                      </p>
                      {milestone.proposedBy !== userId && (
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
                    </div>
                  </div>
                ))}
            </div>
          </div>
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
    max-height: 300px; /* Increased for desktop */
    overflow-x: hidden; /* No horizontal scroll */
    overflow-y: auto; /* Vertical scroll only */
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
      max-width: 32rem; /* max-w-md */
      max-height: 340px; /* Increased for mobile */
    }
  }
`;

export default SharedMilestoneTimeline;