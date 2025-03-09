"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";

interface FriendRequest {
  uid: string;
  displayName: string;
  photoURL: string;
  timestamp?: any;
}

interface FriendRequestsListProps {
  requests: FriendRequest[];
  userId: string;
}

export function FriendRequestsList({ requests, userId }: FriendRequestsListProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleAcceptRequest = async (requestId: string) => {
    if (!userId || processingId) return;
    setProcessingId(requestId);
    try {
      await fetch("/api/friends/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      window.location.reload();
    } catch (error) {
      console.error("Error accepting friend request:", error);
      setProcessingId(null);
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    if (!userId || processingId) return;
    setProcessingId(requestId);
    try {
      await fetch("/api/friends/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      window.location.reload();
    } catch (error) {
      console.error("Error declining friend request:", error);
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <div
          key={request.uid}
          className="flex items-center justify-between p-3 bg-[#222222] rounded-lg border border-gray-800 hover:border-purple-500/30 transition-all"
        >
          <div className="flex items-center gap-3">
            <img
              src={request.photoURL}
              alt={`${request.displayName}'s avatar`}
              className="w-10 h-10 rounded-full border border-purple-500/30"
            />
            <div>
              <h3 className="text-white font-medium">{request.displayName || "User"}</h3>
              {request.timestamp && (
                <p className="text-xs text-gray-400">
                  Requested {new Date(request.timestamp.toDate()).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleAcceptRequest(request.uid)}
              disabled={processingId === request.uid}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDeclineRequest(request.uid)}
              disabled={processingId === request.uid}
              className="border-red-800 text-red-400 hover:bg-red-950/30"
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}