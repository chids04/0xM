import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ethers } from "ethers";

interface SubscriptionManagerProps {
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

export default function SubscriptionManager({ currentUser }: SubscriptionManagerProps) {
  const [walletAddress, setWalletAddress] = useState<string>("");
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

  const setStatusMessage = (message: string, type: 'success' | 'error') => {
    setStatus({ message, type });
    setTimeout(() => setStatus(null), 5000);
  };

  useEffect(() => {
    const getWalletAddress = async () => {
      if (window.ethereum) {
        let address = window.ethereum.selectedAddress;
        if (!address) {
          setStatusMessage("Please connect your wallet", "error");
          return;
        }
        setWalletAddress(address);
      }
    };
    getWalletAddress();
  }, []);

  // Fetch subscription info
  useEffect(() => {
    if (!walletAddress) return;
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
        setStatusMessage("Could not load your subscription details", "error");
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
        setStatusMessage("Could not load fee discounts", "error");
      }
    };
    fetchDiscounts();
  }, []);

  const handleSubscribe = async (tier: 'Tier1' | 'Tier2') => {
    setIsLoading(true);
    setStatus(null);

    try {
      // 1. Get meta-tx details for subscribe
      const subscribeTxRes = await fetch('/api/wallet/create-subscribe-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAddress: walletAddress,
          tier: tier === 'Tier1' ? 1 : 2,
        }),
      });
      if (!subscribeTxRes.ok) {
        const errorData = await subscribeTxRes.json();
        throw new Error(errorData?.error?.message || "Failed to create subscribe transaction");
      }
      const { metaTxRequest, domain, types, tierCost } = await subscribeTxRes.json();

      // 2. Request permit signature for subscription cost
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const permitRes = await fetch("/api/transaction/make-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: walletAddress,
          amount: ethers.formatEther(tierCost),
        }),
      });
      if (!permitRes.ok) {
        const errorData = await permitRes.json();
        throw new Error(errorData?.error?.message || "Failed to create permit transaction");
      }
      const permitData = await permitRes.json();
      const { domain: permitDomain, types: permitTypes, message: permitMessage } = permitData;

      setStatusMessage("Please approve the MST payment in your wallet.", "success");
      let permitSignature;
      try {
        permitSignature = await signer.signTypedData(permitDomain, permitTypes, permitMessage);
      } catch {
        setStatusMessage("Permit signature rejected.", "error");
        setIsLoading(false);
        return;
      }

      // 3. Send permit to backend
      const permitTx = await fetch("/api/transaction/send-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: permitData,
          signature: permitSignature,
        }),
      });
      if (!permitTx.ok) {
        const errorData = await permitTx.json();
        throw new Error(errorData?.error?.message || "Failed to send permit transaction");
      }

      // 4. User signs meta-tx for subscribe
      setStatusMessage("Please sign the subscription transaction in your wallet.", "success");
      let subscribeSignature;
      try {
        subscribeSignature = await signer.signTypedData(domain, types, metaTxRequest);
      } catch {
        setStatusMessage("Subscription signature rejected.", "error");
        setIsLoading(false);
        return;
      }
      const tx = { ...metaTxRequest, signature: subscribeSignature };

      // 5. Relay meta-tx to backend
      const relayRes = await fetch("/api/milestone/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaTx: tx,
          type: "subscribe",
        }),
      });
      if (!relayRes.ok) {
        const errorData = await relayRes.json();
        throw new Error(errorData?.error?.message || "Failed to relay subscription transaction");
      }

      setStatusMessage(`Successfully subscribed to ${tier}!`, 'success');

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
      setStatusMessage(error.message || 'Failed to subscribe', 'error');
    } finally {
      setIsLoading(false);
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
            <p className="text-xs text-gray-500 break-all">
              <span className="font-semibold">Wallet:</span> {walletAddress}
            </p>
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
              className={`w-full ${currentSubscription.tier === 'Tier1'
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
              className={`w-full ${currentSubscription.tier === 'Tier2'
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
        <div className={`p-3 rounded-md ${status.type === 'success'
            ? 'bg-green-900/30 text-green-400'
            : 'bg-red-900/30 text-red-400'
          }`}>
          {status.message}
        </div>
      )}
    </div>
  );
}