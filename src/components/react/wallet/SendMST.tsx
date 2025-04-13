"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TagFriendDropdown } from "../TagFriendDropdown";
import type { Friend } from "../ClientTagFriendDropdown";

interface SendMSTProps {
  friends: Friend[];
  senderAddress: string;
  currentUser: any
}

export function SendMST({ friends, senderAddress, currentUser}: SendMSTProps) {
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [recipientAddress, setRecipientAddress] = useState<string>("");
  const [amount, setAmount] = useState<string>("0");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Only clear messages after a delay to ensure they're seen
  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000); // Messages stay for 5 seconds
      return () => clearTimeout(timer);
    }
  }, [success, error]);

  useEffect(() => {
    if (selectedFriend) {
      fetchFriendWalletAddress(selectedFriend.uid);
    }
  }, [selectedFriend]);

  const fetchFriendWalletAddress = async (uid: string) => {
    try {
      const response = await fetch(`/api/wallet/address?uid=${uid}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch wallet address');
      }
      
      const data = await response.json();
      if (data.address) {
        setRecipientAddress(data.address);
      } else {
        setError("No wallet address found for this friend");
      }
    } catch (error) {
      console.error("Error fetching friend's wallet address:", error);
      setError("Failed to fetch friend's wallet address");
    }
  };

  const handleFriendSelect = (friend: Friend) => {
    setSelectedFriend(friend);
    setError(null);
    setSuccess(null);
  };

  const validateForm = (): boolean => {
    if (!recipientAddress) {
      setError("Please enter a recipient address");
      return false;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return false;
    }

    return true;
  };

  const handleSend = async () => {
    if (!validateForm()) return;
    
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderAddress,
          recipientAddress,
          currentUser,
          friendUser: selectedFriend,
          amount: parseFloat(amount)
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error.message || 'Failed to send tokens');
      }
      
      setSuccess(`Successfully sent ${amount} MST to ${selectedFriend ? selectedFriend.displayName : recipientAddress}`);
      setAmount("0");
      setRecipientAddress("");
      setSelectedFriend(null);
    } catch (error: any) {
      console.error('Error sending tokens:', error);
      setError(error.message || 'Failed to send tokens');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="bg-[#1a1a1a] border border-purple-500/20 shadow-lg overflow-hidden">
      <CardHeader className="border-b border-[#333333] pb-4">
        <CardTitle className="text-white text-xl">Send Milestone Token</CardTitle>
      </CardHeader>
      
      <CardContent className="p-6 space-y-4">
        {/* Friend Selection */}
        {friends.length > 0 && (
          <div className="space-y-2">
            <label className="block text-gray-300 text-sm font-medium mb-1">
              Select Friend
            </label>
            <TagFriendDropdown friends={friends} onSelect={handleFriendSelect} />
            
            {selectedFriend && (
              <div className="mt-2 p-2 bg-[#222] rounded-md flex items-center">
                <img
                  src={selectedFriend.photoURL}
                  alt={selectedFriend.displayName}
                  className="w-6 h-6 rounded-full mr-2"
                />
                <span className="text-white text-sm">{selectedFriend.displayName}</span>
                <button 
                  className="ml-auto text-gray-400 hover:text-red-400"
                  onClick={() => {
                    setSelectedFriend(null);
                    setRecipientAddress("");
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}
        
        {/* Manual Address Input */}
        <div className="space-y-2">
          <label className="block text-gray-300 text-sm font-medium mb-1">
            Recipient Address
          </label>
          <Input
            type="text"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            placeholder="Enter wallet address"
            className="bg-[#252525] text-white border-[#333333] focus:border-purple-500"
            disabled={!!selectedFriend}
          />
          <p className="text-xs text-gray-500">
            {selectedFriend ? "Address auto-filled from selected friend" : 
             friends.length > 0 ? "Enter manually or select a friend above" : 
             "Enter the recipient's wallet address"}
          </p>
        </div>
        
        {/* Amount Input */}
        <div className="space-y-2">
          <label className="block text-gray-300 text-sm font-medium mb-1">
            Amount (MST)
          </label>
          <div className="relative rounded-md">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
              className="bg-[#252525] text-white border-[#333333] focus:border-purple-500"
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <span className="text-gray-400">MST</span>
            </div>
          </div>
        </div>
        
        {/* Enhanced Messages */}
        {(error || success) && (
          <div 
            className={`p-4 rounded-md text-sm transition-all duration-300 ${
              error ? 'bg-red-900/50 text-red-300 border border-red-500/30' : 
              'bg-green-900/50 text-green-300 border border-green-500/30'
            }`}
          >
            {error || success}
            <button
              className="ml-2 text-xs opacity-75 hover:opacity-100"
              onClick={() => {
                setError(null);
                setSuccess(null);
              }}
            >
              ×
            </button>
          </div>
        )}
      </CardContent>
      
      <CardFooter className="bg-[#1f1f1f] border-t border-[#333333] p-4">
        <Button 
          className="w-full bg-purple-600 hover:bg-purple-700 text-white"
          disabled={isLoading}
          onClick={handleSend}
        >
          {isLoading ? (
            <span className="flex items-center">
              <span className="mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
              Sending...
            </span>
          ) : (
            "Send MST"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}