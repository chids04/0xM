import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { app } from '../../firebase/client';

interface MilestoneTimelineProps {
  userId: string;
}

const MilestoneTimeline: React.FC<MilestoneTimelineProps> = ({ userId }) => {
  const [milestones, setMilestones] = useState<any[]>([]);
  const [filteredMilestones, setFilteredMilestones] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

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
    const db = getFirestore(app);

    const fetchMilestones = async () => {
      try {
        const milestonesRef = doc(db, "users", userId, "milestones", "milestoneData");
        const snapshot = await getDoc(milestonesRef);
        if (snapshot.exists()) {
          const data = snapshot.data();
          const milestoneArr = data.acceptedMilestones || [];
          // Map only the fields we need: description, milestone_date, createdAt
          const milestonesData = milestoneArr.map((item: any, index: number) => ({
            description: item.description,
            milestone_date: item.milestone_date,
            createdAt: item.createdAt,
            id: item.id || index,
            index,
          }));
          // Sort by milestone_date
          milestonesData.sort(
            (a, b) => new Date(a.milestone_date).getTime() - new Date(b.milestone_date).getTime()
          );
          setMilestones(milestonesData);
          setFilteredMilestones(milestonesData);
        } else {
          console.error("Milestones document does not exist.");
          setMilestones([]);
          setFilteredMilestones([]);
        }
      } catch (error) {
        console.error("Error fetching milestones:", error);
      }
    };

    if (userId) {
      fetchMilestones();
    }
  }, [userId]);

  // Update card positions when window resizes or filtered milestones change
  useEffect(() => {
    const updatePositions = () => {
      if (!containerRef.current || filteredMilestones.length === 0) return;
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
        const sinePosition = (index / (totalMilestones - 1)) * Math.PI * 3;
        const horizontalOffset = Math.sin(sinePosition) * amplitude;
        const horizontalPos = 0.5 + horizontalOffset / containerWidth;
        (milestone as HTMLElement).style.top = `${verticalPos}px`;
        (milestone as HTMLElement).style.left = `${horizontalPos * 100}%`;
      });
    };
    updatePositions();
    window.addEventListener('resize', updatePositions);
    return () => window.removeEventListener('resize', updatePositions);
  }, [filteredMilestones]);

  // Filter milestones by description (if search is desired) and date range
  useEffect(() => {
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
  }, [milestones, searchTerm, dateRange]);

  const containerHeight = isMobile
    ? filteredMilestones.length * 220  
    : filteredMilestones.length * 200 + 200;

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDateRange(prev => ({ ...prev, [name]: value }));
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
            onClick={() => { setSearchTerm(''); setDateRange({ start: '', end: '' }); }}
            className="w-full bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
          >
            Clear Filters
          </button>
        </div>
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
              <div className={`bg-[#1a1a1a] p-6 rounded-xl shadow-lg border border-purple-500/20 transition-all duration-300 ${isMobile ? 'w-full max-w-sm' : 'w-[280px]'}`}>
                <p className="text-white text-lg font-medium mb-2">
                  {milestone.description}
                </p>
                <p className="text-gray-400 mb-1">
                  Date: {new Date(milestone.milestone_date).toLocaleDateString('en-US')}
                </p>
                <p className="text-gray-400">
                  Timestamp: {new Date(milestone.createdAt).toLocaleTimeString('en-US')}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
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

export default MilestoneTimeline;