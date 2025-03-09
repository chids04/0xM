"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";

interface Friend {
  uid: string;
  displayName: string;
  photoURL: string;
}

interface FriendsListProps {
  friends: Friend[];
  userId: string;
}

export function FriendsList({ friends, userId }: FriendsListProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleRemoveFriend = async (friendId: string) => {
    if (!userId || processingId) return;
    setProcessingId(friendId);
    try {
      await fetch("/api/friends/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId }),
      });
      window.location.reload();
    } catch (error) {
      console.error("Error removing friend:", error);
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {friends.map((friend) => (
        <div
          key={friend.uid}
          className="flex items-center justify-between p-3 bg-[#222222] rounded-lg border border-gray-800 hover:border-purple-500/30 transition-all"
        >
          <div className="flex items-center gap-3">
            <img
              src={friend.photoURL}
              alt={`${friend.displayName}'s avatar`}
              className="w-10 h-10 rounded-full border border-purple-500/30"
            />
            <div>
              <h3 className="text-white font-medium">{friend.displayName || "User"}</h3>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRemoveFriend(friend.uid)}
            disabled={processingId === friend.uid}
            className="border-gray-700 text-gray-400 hover:bg-gray-800"
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}