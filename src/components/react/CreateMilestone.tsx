import { useState, useEffect, useCallback, useRef } from "react";
import { MilestoneForm } from "@/components/react/MilestoneForm";
import { TagFriendDropdown } from "@/components/react/TagFriendDropdown";

interface Friend {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

interface FeeData {
  addMilestoneFee?: string;
  addGroupMilestoneFee?: string;
  signMilestoneFee?: string;
  tier1DiscountPercent?: number;
  tier2DiscountPercent?: number;
}

const MAX_FRIENDS = 4; // Maximum number of friends that can be tagged

export function CreateMilestone({ friends }: { friends: Friend[] }) {
  const [taggedFriends, setTaggedFriends] = useState<Friend[]>([]);
  const [submitForm, setSubmitForm] = useState<(() => Promise<any>) | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feeData, setFeeData] = useState<FeeData | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | null>(null);

  // Ref to store the timeout ID
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch milestone fees when component mounts
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

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData?.error?.message || "Failed to fetch fees");
        }

        const data = await response.json();
        console.log("Fee data received:", data);

        if (data.success && data.fees) {
          setFeeData(data.fees);
        } else {
          throw new Error("Invalid fee data received");
        }
      } catch (error) {
        console.error("Error fetching fees:", error);
        setFeeError(error.message || "Failed to fetch fees");
      } finally {
        setFeeLoading(false);
      }
    };

    fetchFees();
  }, []);

  // Cleanup timeout on component unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleTagSelect = (friend: Friend) => {
    setTaggedFriends((prev) => {
      // Only add if we haven't reached the limit and friend isn't already tagged
      if (prev.length < MAX_FRIENDS && !prev.some((f) => f.uid === friend.uid)) {
        return [...prev, friend];
      }
      return prev;
    });
  };

  const handleRemoveTag = (friend: Friend) => {
    setTaggedFriends((prev) => prev.filter((f) => f.uid !== friend.uid));
  };

  const setFormSubmitFunction = useCallback((fn: any) => {
    setSubmitForm(() => fn);
  }, []);

  const createMilestone = async () => {
    if (isSubmitting) return;

    if (!submitForm) {
      setStatusMessage("Form is not ready yet.");
      setStatusType("error");
      return;
    }

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setIsSubmitting(true);
    setStatusMessage(null);
    setStatusType(null);

    try {
      const formData = await submitForm();

      if (!formData) {
        setStatusMessage("Please fill out the milestone details correctly.");
        setStatusType("error");
        setIsSubmitting(false);
        return;
      }

      const payload = {
        ...formData,
        taggedFriendIds: taggedFriends.map((f) => f.uid),
      };

      console.log("Submitting payload:", payload);

      const res = await fetch("/api/milestone/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: payload,
          fee: getApplicableFee(),
        }),
      });

      if (res.ok) {
        setStatusMessage("Milestone created successfully!");
        setStatusType("success");
      } else {
        const errorData = await res.json().catch(() => null);
        setStatusMessage(`Error creating milestone: ${errorData?.message || res.statusText}`);
        setStatusType("error");
      }

      // Set a single timeout to clear the status
      timeoutRef.current = setTimeout(() => {
        setStatusMessage(null);
        setStatusType(null);
      }, 5000);
    } catch (error) {
      console.error("Error in form submission:", error);
      setStatusMessage(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
      setStatusType("error");

      // Set a single timeout to clear the status
      timeoutRef.current = setTimeout(() => {
        setStatusMessage(null);
        setStatusType(null);
      }, 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getApplicableFee = () => {
    if (!feeData) return null;
    return taggedFriends.length > 0 ? feeData.addGroupMilestoneFee : feeData.addMilestoneFee;
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4 text-white">Create a New Milestone</h1>

      {statusMessage && (
        <div
          className={`p-3 rounded-md mb-4 ${
            statusType === "success" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
          }`}
        >
          {statusMessage}
        </div>
      )}

      <div className="mb-6">
        {feeLoading ? (
          <div className="p-3 bg-gray-800 rounded-md animate-pulse">
            <p className="text-gray-400">Loading transaction fees...</p>
          </div>
        ) : feeError ? (
          <div className="p-3 bg-red-900/30 text-red-400 rounded-md text-sm">
            Failed to load fee information: {feeError}
          </div>
        ) : (
          feeData && (
            <div className="p-4 bg-[#222] border border-purple-500/20 rounded-md">
              <h3 className="text-white font-medium mb-2">Transaction Fees</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-gray-400">
                    <span className="mr-2">•</span>
                    Regular milestone:{" "}
                    <span className="text-purple-400 font-medium">{feeData.addMilestoneFee} MST</span>
                  </p>
                  <p className="text-gray-400">
                    <span className="mr-2">•</span>
                    Group milestone:{" "}
                    <span className="text-purple-400 font-medium">{feeData.addGroupMilestoneFee} MST</span>
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">
                    <span className="mr-2">•</span>
                    Tier 1 discount:{" "}
                    <span className="text-green-400 font-medium">{feeData.tier1DiscountPercent}%</span>
                  </p>
                  <p className="text-gray-400">
                    <span className="mr-2">•</span>
                    Tier 2 discount:{" "}
                    <span className="text-green-400 font-medium">{feeData.tier2DiscountPercent}%</span>
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-700">
                <p className="text-white">
                  Current cost:{" "}
                  <span className="text-purple-400 font-medium">{getApplicableFee() || "0"} MST</span>
                  {taggedFriends.length > 0 && (
                    <span className="text-gray-400 text-xs ml-2">(Group milestone)</span>
                  )}
                </p>
              </div>
            </div>
          )
        )}
      </div>

      <MilestoneForm setSubmitForm={setFormSubmitFunction} />
      <div className="mt-8">
        <h2 className="text-xl text-white mb-2">
          Tag Friends
          <span className="text-gray-400 text-sm ml-2">
            ({taggedFriends.length}/{MAX_FRIENDS} max)
          </span>
        </h2>
        
        {taggedFriends.length >= MAX_FRIENDS ? (
          <div className="text-amber-400 text-sm mb-3 p-2 bg-amber-900/20 rounded-md">
            Maximum number of friends reached (4)
          </div>
        ) : (
          <TagFriendDropdown 
            friends={friends} 
            taggedFriends={taggedFriends} 
            onSelect={handleTagSelect} 
          />
        )}

        {taggedFriends.length > 0 && (
          <div className="mt-4 p-3 bg-[#222] rounded-md">
            <h3 className="text-gray-300 text-sm mb-2">Tagged friends ({taggedFriends.length}):</h3>
            <div className="flex flex-wrap gap-2">
              {taggedFriends.map((friend) => (
                <div
                  key={friend.uid}
                  className="flex items-center bg-[#333] p-1 pl-2 pr-3 rounded-full"
                >
                  <img
                    src={friend.photoURL}
                    alt={friend.displayName}
                    className="w-5 h-5 rounded-full mr-1"
                  />
                  <span className="text-white text-sm">{friend.displayName}</span>
                  <button
                    onClick={() => handleRemoveTag(friend)}
                    className="ml-2 text-gray-400 hover:text-red-400"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="mt-8">
        <button
          className="bg-purple-600 text-white py-2 px-6 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={createMilestone}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating..." : "Create Milestone"}
        </button>
      </div>
    </div>
  );
}