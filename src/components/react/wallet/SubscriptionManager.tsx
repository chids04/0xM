import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ethers } from 'ethers';
import { getFirestore } from "firebase/firestore";
import { app } from "../../../firebase/client";
import { doc, getDoc, updateDoc } from "firebase/firestore";

interface SubscriptionManagerProps {
  walletAddress: string;
  currentUser: any;
}

type SubscriptionTier = 'Free' | 'Tier1' | 'Tier2';

interface SubscriptionInfo {
    tier: SubscriptionTier;
    writesUsed: number;
    readsUsed: number;
    lastReset: Date | null;
    writeLimit: number | 'Unlimited'; // Add this
    readLimit: number | 'Unlimited';  // Add this
  }

export default function SubscriptionManager({ walletAddress, currentUser }: SubscriptionManagerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSubscription, setCurrentSubscription] = useState<SubscriptionInfo>({
    tier: 'Free',
    writesUsed: 0,
    readsUsed: 0,
    lastReset: null,
    writeLimit: 0,
    readLimit: 0
  });
  const [status, setStatus] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  // Fetch current subscription status
  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const response = await fetch('/api/wallet/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: walletAddress })
        });
  
        if (!response.ok) {
          throw new Error('Failed to fetch subscription details');
        }
  
        const data = await response.json();
        if (data.success) {
          setCurrentSubscription({
            tier: data.subscription.tierName as SubscriptionTier, // Use tierName instead of tier
            writesUsed: data.subscription.writesUsed,
            readsUsed: data.subscription.readsUsed,
            writeLimit: data.subscription.writeLimit, // Add these limits
            readLimit: data.subscription.readLimit,
            lastReset: data.subscription.lastReset ? new Date(data.subscription.lastReset * 1000) : null
          });
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
        setError('Could not load your subscription details');
      }
    };
  
    fetchSubscription();
  }, [walletAddress]);

  const handleSubscribe = async (tier: 'Tier1' | 'Tier2') => {
    setIsLoading(true);
    setError(null);
    setStatus(null);
    
    try {
      // Call your API to handle the subscription
      const response = await fetch('/api/wallet/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: walletAddress,
          tier: tier === 'Tier1' ? 1 : 2, // enum in contract uses 1 for Tier1, 2 for Tier2
          user: currentUser
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to subscribe');
      }

      if (data.success) {
        setStatus({
          message: `Successfully subscribed to ${tier}!`,
          type: 'success'
        });
        
        // Update local state with new subscription
        setCurrentSubscription({
          ...currentSubscription,
          tier: tier
        });
      } else {
        throw new Error(data.message || 'Unknown error occurred');
      }
    } catch (error) {
      console.error('Subscription error:', error);
      setStatus({
        message: error.message || 'Failed to subscribe',
        type: 'error'
      });
    } finally {
      setIsLoading(false);
      
      // Clear status after 5 seconds
      setTimeout(() => {
        setStatus(null);
      }, 5000);
    }
  };

  // Format benefits based on tier
  const getTierBenefits = (tier: SubscriptionTier) => {
    switch(tier) {
      case 'Free':
        return ['5 write operations per month', '20 read operations per month', 'No discounts on transaction fees'];
      case 'Tier1':
        return ['50 write operations per month', 'Unlimited read operations', '25% discount on transaction fees'];
      case 'Tier2':
        return ['Unlimited write operations', 'Unlimited read operations', '50% discount on transaction fees'];
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-[#1a1a1a] border border-purple-500/20">
        <CardHeader>
          <CardTitle className="text-white">Your Subscription</CardTitle>
          <CardDescription className="text-gray-400">
            Current tier: <span className="text-purple-400 font-semibold">{currentSubscription.tier}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
        <div className="space-y-2">
            <p className="text-sm text-gray-300">
                <span className="text-gray-400">Write operations:</span> {currentSubscription.writesUsed}
                {currentSubscription.writeLimit !== 'Unlimited' 
                ? ` / ${currentSubscription.writeLimit}` 
                : ' (unlimited)'}
            </p>
            <p className="text-sm text-gray-300">
                <span className="text-gray-400">Read operations:</span> {currentSubscription.readsUsed}
                {currentSubscription.readLimit !== 'Unlimited' 
                ? ` / ${currentSubscription.readLimit}` 
                : ' (unlimited)'}
            </p>
            {currentSubscription.lastReset && (
                <p className="text-sm text-gray-300">
                <span className="text-gray-400">Resets on:</span> {new Date(currentSubscription.lastReset.getTime() + 30*24*60*60*1000).toLocaleDateString()}
                </p>
            )}
            </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tier 1 Subscription */}
        <Card className={`bg-[#1a1a1a] border ${currentSubscription.tier === 'Tier1' ? 'border-green-500' : 'border-purple-500/20'}`}>
          <CardHeader>
            <CardTitle className="text-white">
              Tier 1 Subscription
              {currentSubscription.tier === 'Tier1' && (
                <span className="ml-2 text-xs bg-green-800/50 text-green-400 px-2 py-1 rounded">ACTIVE</span>
              )}
            </CardTitle>
            <CardDescription className="text-gray-400">100 MST per month</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 mb-4">
              {getTierBenefits('Tier1').map((benefit, index) => (
                <li key={index} className="text-sm text-gray-300 flex items-start">
                  <span className="text-purple-400 mr-2">✓</span> {benefit}
                </li>
              ))}
            </ul>
            <Button
              onClick={() => handleSubscribe('Tier1')}
              disabled={isLoading || currentSubscription.tier === 'Tier1'}
              className={`w-full ${
                currentSubscription.tier === 'Tier1' 
                  ? 'bg-green-800/20 text-green-400 cursor-not-allowed' 
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              }`}
            >
              {currentSubscription.tier === 'Tier1' 
                ? 'Current Plan' 
                : isLoading ? 'Processing...' : 'Subscribe for 100 MST'}
            </Button>
          </CardContent>
        </Card>

        {/* Tier 2 Subscription */}
        <Card className={`bg-[#1a1a1a] border ${currentSubscription.tier === 'Tier2' ? 'border-green-500' : 'border-purple-500/20'}`}>
          <CardHeader>
            <CardTitle className="text-white">
              Tier 2 Subscription
              {currentSubscription.tier === 'Tier2' && (
                <span className="ml-2 text-xs bg-green-800/50 text-green-400 px-2 py-1 rounded">ACTIVE</span>
              )}
            </CardTitle>
            <CardDescription className="text-gray-400">500 MST per month</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 mb-4">
              {getTierBenefits('Tier2').map((benefit, index) => (
                <li key={index} className="text-sm text-gray-300 flex items-start">
                  <span className="text-purple-400 mr-2">✓</span> {benefit}
                </li>
              ))}
            </ul>
            <Button
              onClick={() => handleSubscribe('Tier2')}
              disabled={isLoading || currentSubscription.tier === 'Tier2'}
              className={`w-full ${
                currentSubscription.tier === 'Tier2' 
                  ? 'bg-green-800/20 text-green-400 cursor-not-allowed' 
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              }`}
            >
              {currentSubscription.tier === 'Tier2' 
                ? 'Current Plan' 
                : isLoading ? 'Processing...' : 'Subscribe for 500 MST'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {status && (
        <div className={`p-3 rounded-md ${
          status.type === 'success' 
            ? 'bg-green-900/30 text-green-400' 
            : 'bg-red-900/30 text-red-400'
        }`}>
          {status.message}
        </div>
      )}
    </div>
  );
}