"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface Friend {
  uid: string;
  displayName?: string;
  photoURL?: string;
  email?: string;
}

interface FriendsListProps {
  friends: string[]; // Array of friend UIDs
  userId: string;
}

export function FriendsList({ friends, userId }: FriendsListProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [friendDetails, setFriendDetails] = useState<Friend[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch friend details when component mounts
  useEffect(() => {
    const fetchFriendDetails = async () => {
      try {
        setLoading(true);
        const friendDetailPromises = friends.map(async (friendId) => {
          const response = await fetch(`/api/friends/details?friendId=${friendId}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          });
          
          if (!response.ok) {
            throw new Error(`Failed to fetch friend details for ${friendId}`);
          }
          
          const data = await response.json();
          return {
            uid: friendId,
            displayName: data.displayName || "User",
            photoURL: data.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${data.displayName || data.email || "User"}`,
            email: data.email || "",
          };
        });
        
        const details = await Promise.all(friendDetailPromises);
        setFriendDetails(details);
      } catch (error) {
        console.error("Error fetching friend details:", error);
      } finally {
        setLoading(false);
      }
    };

    if (friends.length > 0) {
      fetchFriendDetails();
    } else {
      setLoading(false);
    }
  }, [friends]);

  const handleRemoveFriend = async (friendId: string) => {
    if (!userId || processingId) return;
    setProcessingId(friendId);
    try {
      const response = await fetch("/api/friends/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to remove friend");
      }
      
      window.location.reload();
    } catch (error) {
      console.error("Error removing friend:", error);
      setProcessingId(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-6"><span className="text-gray-400">Loading friends...</span></div>;
  }

  if (friendDetails.length === 0) {
    return <div className="text-gray-400">You haven't added any friends yet.</div>;
  }

  return (
    <div className="space-y-3 min-w-0">
      {friendDetails.map((friend) => (
        <div
          key={friend.uid}
          className="flex min-w-0 items-center justify-between p-3 bg-[#222222] rounded-lg border border-gray-800 hover:border-purple-500/30 transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={friend.photoURL}
              alt={`${friend.displayName}'s avatar`}
              className=" w-10 h-10 rounded-full border border-purple-500/30"
            />
            <div className="overflow-hidden min-w-0">
              <h3 className="text-white font-medium truncate min-w-0">{friend.displayName}</h3>
              <p className="text-gray-400 text-sm truncate min-w-0">{friend.email}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRemoveFriend(friend.uid)}
            disabled={processingId === friend.uid}
            className="border-gray-700 text-gray-400 hover:bg-gray-800 w-20"
          >
            {processingId === friend.uid ? "Removing..." : "Remove"}
          </Button>
        </div>
      ))}
    </div>
  );
}