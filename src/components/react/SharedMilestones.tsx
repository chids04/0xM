import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, getFirestore } from 'firebase/firestore';
import { app } from '../../firebase/client';

interface SharedMilestoneTimelineProps {
  userId: string;
}

const SharedMilestoneTimeline: React.FC<SharedMilestoneTimelineProps> = ({ userId }) => {
  const [milestones, setMilestones] = useState<any[]>([]);
  const [pendingMilestones, setPendingMilestones] = useState<any[]>([]);
  const [filteredMilestones, setFilteredMilestones] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [activeTab, setActiveTab] = useState<'active' | 'pending'>('active');
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check for mobile screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Fetch milestones from Firebase using the passed userId
  useEffect(() => {
    const fetchMilestones = async () => {
      if (!userId) return;
      
      setIsLoading(true);
      const db = getFirestore(app);
      
      try {
        const milestonesRef = doc(db, "users", userId, "milestones", "milestoneData");
        const snapshot = await getDoc(milestonesRef);
        
        if (snapshot.exists()) {
          const data = snapshot.data();
          
          //process accepted milestones, since shared, only need particpants where array size > 1
          const acceptedMilestoneArr = data.acceptedMilestones || [];
          const milestonesData = acceptedMilestoneArr
            .filter((item: any) => (item.particpants || []).length > 0)
            .map((item: any, index: number) => ({
                description: item.description,
                milestone_date: item.milestone_date,
                createdAt: item.createdAt,
                participants: item.participants || [],
                particpants_addresses: item.taggedFriendIds || [],
                id: item.id || index,
                index,
            }));
          
          // Sort by milestone_date
          milestonesData.sort(
            (a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
          );
          
          setMilestones(milestonesData);
          setFilteredMilestones(milestonesData);
          
          // Process pending milestones
          const pendingMilestoneArr = data.pendingMilestones || [];
          const pendingData = pendingMilestoneArr.map((item: any, index: number) => ({
            description: item.description,
            milestone_date: item.milestone_date,
            createdAt: item.createdAt,
            participants: item.participants || [],
            proposedBy: item.owner || "Unknown",
            id: item.id || `pending-${index}`,
            index,
          }));
          
          // Sort pending by date
          pendingData.sort(
            (a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
          );
          
          setPendingMilestones(pendingData);
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

    fetchMilestones();
  }, [userId]);

  // Update card positions when window resizes or filtered milestones change
  useEffect(() => {
    const updatePositions = () => {
      if (!containerRef.current) return;
      if (filteredMilestones.length === 0 && activeTab === 'active') return;
      if (pendingMilestones.length === 0 && activeTab === 'pending') return;
      
      const container = containerRef.current;
      const milestoneElements = container.querySelectorAll('.milestone-card');
      const totalMilestones = milestoneElements.length;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (window.innerWidth < 768) {
        milestoneElements.forEach((milestone, i) => {
          const cardHeight = 180;
          const verticalPos = cardHeight * i + 20 * (i + 1);
          (milestone as HTMLElement).style.top = `${verticalPos}px`;
          (milestone as HTMLElement).style.left = '50%';
        });
        return;
      }

      // Sine wave layout for larger screens:
      const maxAmplitude = containerWidth * 0.3;
      const amplitude = Math.min(maxAmplitude, Math.max(20, (window.innerWidth - 480) / 4));
      const cardHeight = 180;
      const totalSpacing = containerHeight - (cardHeight * totalMilestones);
      const spaceBetweenCards = totalSpacing / (totalMilestones + 5);

      milestoneElements.forEach((milestone) => {
        const index = parseInt(milestone.getAttribute('data-index') || '0');
        const verticalPos = spaceBetweenCards * (index + 1) + cardHeight * index + cardHeight / 2;
        const sinePosition = (index / Math.max(1, totalMilestones - 1)) * Math.PI * 3;
        const horizontalOffset = Math.sin(sinePosition) * amplitude;
        const horizontalPos = 0.5 + horizontalOffset / containerWidth;
        (milestone as HTMLElement).style.top = `${verticalPos}px`;
        (milestone as HTMLElement).style.left = `${horizontalPos * 100}%`;
      });
    };
    
    updatePositions();
    window.addEventListener('resize', updatePositions);
    return () => window.removeEventListener('resize', updatePositions);
  }, [filteredMilestones, pendingMilestones, activeTab]);

  // Filter milestones by description and date range
  useEffect(() => {
    if (activeTab === 'active') {
      let filtered = [...milestones];
      if (searchTerm) {
        filtered = filtered.filter(milestone =>
          milestone.description.toLowerCase().includes(searchTerm.toLowerCase())
        );
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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDateRange(prev => ({ ...prev, [name]: value }));
  };

  const handleAcceptMilestone = async (pendingMilestone: any) => {
    if (!userId) return;
    
    setIsLoading(true);
    const db = getFirestore(app);
    
    try {
      const milestonesRef = doc(db, "users", userId, "milestones", "milestoneData");
      const snapshot = await getDoc(milestonesRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        
        // Find the pending milestone
        const pendingArray = data.pendingMilestones || [];
        const acceptedArray = data.acceptedMilestones || [];
        
        // Find the pending milestone index
        const pendingIndex = pendingArray.findIndex((item: any) => item.id === pendingMilestone.id);
        
        if (pendingIndex !== -1) {
          // Move from pending to accepted
          const milestone = pendingArray[pendingIndex];
          acceptedArray.push(milestone);
          pendingArray.splice(pendingIndex, 1);
          
          // Update the document
          await updateDoc(milestonesRef, {
            acceptedMilestones: acceptedArray,
            pendingMilestones: pendingArray
          });
          
          // Update local state
          setPendingMilestones(prev => prev.filter(item => item.id !== pendingMilestone.id));
          
          // Add to milestones with isShared flag
          const newMilestone = {
            ...pendingMilestone,
            isShared: (pendingMilestone.participants || []).length > 1
          };
          
          setMilestones(prev => [...prev, newMilestone].sort(
            (a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
          ));
        }
      }
    } catch (error) {
      console.error("Error accepting milestone:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDenyMilestone = async (pendingMilestone: any) => {
    if (!userId) return;
    
    setIsLoading(true);
    const db = getFirestore(app);
    
    try {
      const milestonesRef = doc(db, "users", userId, "milestones", "milestoneData");
      const snapshot = await getDoc(milestonesRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        
        // Find the pending milestone
        const pendingArray = data.pendingMilestones || [];
        
        // Find the pending milestone index
        const pendingIndex = pendingArray.findIndex((item: any) => item.id === pendingMilestone.id);
        
        if (pendingIndex !== -1) {
          // Remove from pending
          pendingArray.splice(pendingIndex, 1);
          
          // Update the document
          await updateDoc(milestonesRef, {
            pendingMilestones: pendingArray
          });
          
          // Update local state
          setPendingMilestones(prev => prev.filter(item => item.id !== pendingMilestone.id));
        }
      }
    } catch (error) {
      console.error("Error denying milestone:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const activeDisplayItems = activeTab === 'active' ? filteredMilestones : pendingMilestones;
  const containerHeight = isMobile
    ? activeDisplayItems.length * 220  
    : activeDisplayItems.length * 200 + 200;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-6">Shared Milestones</h1>
      
      {/* Tab Navigation */}
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
      
      {/* Filter Controls - Only show for active tab */}
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
              onClick={() => { setSearchTerm(''); setDateRange({ start: '', end: '' }); }}
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
            <div className="text-center py-8 text-gray-400">
              No milestones found matching your filters.
            </div>
          )}
          
          {activeTab === 'pending' && pendingMilestones.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              No pending milestones to review.
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
              {activeTab === 'active' && filteredMilestones.map((milestone, index) => (
                <div 
                  key={milestone.id} 
                  className="milestone-card" 
                  data-index={index}
                >
                  <div className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border ${milestone.isShared ? 'border-purple-500/50' : 'border-purple-500/20'} transition-all duration-300 ${isMobile ? 'w-full max-w-sm' : 'w-[280px]'}`}>
                    {milestone.isShared && (
                      <div className="mb-2 flex items-center">
                        <span className="bg-purple-500/20 text-purple-300 text-xs px-2 py-1 rounded-full">
                          Shared
                        </span>
                      </div>
                    )}
                    <p className="text-white text-lg font-medium mb-2">
                      {milestone.description}
                    </p>
                    <p className="text-gray-400 mb-1">
                      Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}
                    </p>
                    <p className="text-gray-400 mb-1">
                      Participants: {milestone.participants?.length || 1}
                    </p>
                    <p className="text-gray-400">
                      Created: {new Date(milestone.createdAt).toLocaleString('en-US')}
                    </p>
                  </div>
                </div>
              ))}
              
              {activeTab === 'pending' && pendingMilestones.map((milestone, index) => (
                <div 
                  key={milestone.id} 
                  className="milestone-card" 
                  data-index={index}
                >
                  <div className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border border-yellow-500/30 transition-all duration-300 ${isMobile ? 'w-full max-w-sm' : 'w-[280px]'}`}>
                    <div className="mb-2 flex items-center">
                      <span className="bg-yellow-500/20 text-yellow-300 text-xs px-2 py-1 rounded-full">
                        Pending Approval
                      </span>
                    </div>
                    <p className="text-white text-lg font-medium mb-2">
                      {milestone.description}
                    </p>
                    <p className="text-gray-400 mb-1">
                      Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}
                    </p>
                    <p className="text-gray-400 mb-1">
                      Proposed by: {milestone.proposedBy}
                    </p>
                    <p className="text-gray-400 mb-3">
                      Participants: {milestone.participants?.length || 1}
                    </p>
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

// CSS for the component
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
  
  @media (max-width: 767px) {
    .milestone-card > div {
      width: 90vw;
      max-width: 330px;
    }
  }
`;

export default SharedMilestoneTimeline;