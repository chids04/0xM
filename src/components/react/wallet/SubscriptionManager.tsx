import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SubscriptionManagerProps {
  walletAddress: string;
  currentUser: any;
}

type SubscriptionTier = 'Free' | 'Tier1' | 'Tier2';

interface SubscriptionInfo {
  tier: SubscriptionTier;
  writesUsed: number;
  lastReset: Date | null;
  writeLimit: number | 'Unlimited';
}

interface FeeDiscounts {
  tier1DiscountPercent: number;
  tier2DiscountPercent: number;
}

export default function SubscriptionManager({ walletAddress, currentUser }: SubscriptionManagerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [currentSubscription, setCurrentSubscription] = useState<SubscriptionInfo>({
    tier: 'Free',
    writesUsed: 0,
    lastReset: null,
    writeLimit: 0
  });
  const [feeDiscounts, setFeeDiscounts] = useState<FeeDiscounts>({
    tier1DiscountPercent: 0,
    tier2DiscountPercent: 0
  });
  const [status, setStatus] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // Fetch subscription info
  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const response = await fetch('/api/wallet/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: walletAddress })
        });
        const data = await response.json();
        if (data.success) {
          setCurrentSubscription({
            tier: data.subscription.tierName as SubscriptionTier,
            writesUsed: data.subscription.writesUsed,
            writeLimit: data.subscription.writeLimit,
            lastReset: data.subscription.lastReset ? new Date(data.subscription.lastReset * 1000) : null
          });
        }
      } catch (error) {
        setStatus({ message: "Could not load your subscription details", type: "error" });
      }
    };
    fetchSubscription();
  }, [walletAddress]);

  // Fetch fee discounts
  useEffect(() => {
    const fetchDiscounts = async () => {
      try {
        const response = await fetch('/api/milestone/fees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feeType: "milestone" })
        });
        const data = await response.json();
        if (data.success && data.fees) {
          setFeeDiscounts({
            tier1DiscountPercent: data.fees.tier1DiscountPercent ?? 0,
            tier2DiscountPercent: data.fees.tier2DiscountPercent ?? 0
          });
        }
      } catch (error) {
        setStatus({ message: "Could not load fee discounts", type: "error" });
      }
    };
    fetchDiscounts();
  }, []);

  const handleSubscribe = async (tier: 'Tier1' | 'Tier2') => {
    setIsLoading(true);
    setStatus(null);

    try {
      const response = await fetch('/api/wallet/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: walletAddress,
          tier: tier === 'Tier1' ? 1 : 2,
          user: currentUser
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || data.message || 'Failed to subscribe');
      }

      setStatus({
        message: `Successfully subscribed to ${tier}!`,
        type: 'success'
      });

      // Refetch subscription info to update UI
      const subRes = await fetch('/api/wallet/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress })
      });
      const subData = await subRes.json();
      if (subData.success) {
        setCurrentSubscription({
          tier: subData.subscription.tierName as SubscriptionTier,
          writesUsed: subData.subscription.writesUsed,
          writeLimit: subData.subscription.writeLimit,
          lastReset: subData.subscription.lastReset ? new Date(subData.subscription.lastReset * 1000) : null
        });
      }
    } catch (error: any) {
      setStatus({
        message: error.message || 'Failed to subscribe',
        type: 'error'
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatus(null), 5000);
    }
  };

  // Format benefits based on tier and discount
  const getTierBenefits = (tier: SubscriptionTier) => {
    switch (tier) {
      case 'Free':
        return [
          '5 write operations per month',
          'No discounts on transaction fees'
        ];
      case 'Tier1':
        return [
          '50 write operations per month',
          `Discount: ${feeDiscounts.tier1DiscountPercent}% on transaction fees`
        ];
      case 'Tier2':
        return [
          'Unlimited write operations',
          `Discount: ${feeDiscounts.tier2DiscountPercent}% on transaction fees`
        ];
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
              <span className="text-gray-400">Transaction fee discount:</span>{" "}
              {currentSubscription.tier === "Tier1"
                ? feeDiscounts.tier1DiscountPercent
                : currentSubscription.tier === "Tier2"
                ? feeDiscounts.tier2DiscountPercent
                : 0
              }%
            </p>
            {currentSubscription.lastReset && (
              <p className="text-sm text-gray-300">
                <span className="text-gray-400">Resets on:</span> {new Date(currentSubscription.lastReset.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
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