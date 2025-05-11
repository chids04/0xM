import { useState, useEffect, useCallback, useRef } from "react";
import { MilestoneForm } from "@/components/react/MilestoneForm";
import { TagFriendDropdown } from "@/components/react/TagFriendDropdown";
import { app } from "../../firebase/client"
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { ethers } from "ethers";

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

const MAX_FRIENDS = 4;

export function CreateMilestone({ friends, userId }: { friends: Friend[], userId: any }) {
  const [taggedFriends, setTaggedFriends] = useState<Friend[]>([]);
  const [submitForm, setSubmitForm] = useState<(() => Promise<any>) | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feeData, setFeeData] = useState<FeeData | null>(null);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"success" | "error" | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);


  async function cleanupIpfs(ipfsCIDs: any) {
    console.log("Cleaning up IPFS CIDs:", ipfsCIDs);
    if (ipfsCIDs && (ipfsCIDs.metadataCid || ipfsCIDs.imageCid)) {
      await fetch("/api/milestone/cleanup-ipfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadataCid: ipfsCIDs.metadataCid || null,
          imageCid: ipfsCIDs.imageCid || null,
        }),
      });
    }
  }

  const handleError = useCallback((msg: string, type: "error" | "success" = "error") => {
    setStatusMessage(msg);
    setStatusType(type);
    setIsSubmitting(false);
    timeoutRef.current = setTimeout(() => {
      setStatusMessage(null);
      setStatusType(null);
    }, 5000);
  }, []);


  useEffect(() => {
    const fetchSubscription = async () => {
      try {
        const db = getFirestore(app)
        const walletRef = doc(db, "users", userId, "wallet", "wallet_info")
        const walletDoc = await getDoc(walletRef)
        if(walletDoc.exists()){
          const walletData = walletDoc.data()
          const res = await fetch("/api/wallet/subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: walletData.address }),
          });
          if (!res.ok) throw new Error("Failed to fetch user subscription");
          const data = await res.json();
          if (data.success && data.subscription) {
            setSubscription(data.subscription);
          }
        }
        setSubscriptionLoading(true);
      } catch {
        setSubscription(null);
      } finally {
        setSubscriptionLoading(false);
      }
    };
    fetchSubscription();
  }, [userId]);

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
        if (data.success && data.fees) {
          setFeeData(data.fees);
        } else {
          throw new Error("Invalid fee data received");
        }
      } catch (error) {
        setFeeError((error as Error).message || "Failed to fetch fees");
      } finally {
        setFeeLoading(false);
      }
    };
    fetchFees();
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);


  const handleTagSelect = (friend: Friend) => {
    setTaggedFriends((prev) => {
      if (prev.length < MAX_FRIENDS && !prev.some((f) => f.uid === friend.uid)) {
        return [...prev, friend];
      }
      return prev;
    });
  };

  const handleRemoveTag = (friend: Friend) => {
    setTaggedFriends((prev) => prev.filter((f) => f.uid !== friend.uid));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        handleError("Please select a valid image file.");
        setSelectedFile(null);
        setImagePreview(null);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        handleError("Image file size must be less than 5MB.");
        setSelectedFile(null);
        setImagePreview(null);
        return;
      }
      setSelectedFile(file);
      setImagePreview(URL.createObjectURL(file));
      setStatusMessage(null);
      setStatusType(null);
    } else {
      setSelectedFile(null);
      setImagePreview(null);
    }
  };

  const setFormSubmitFunction = useCallback((fn: any) => setSubmitForm(() => fn), []);


  const createMilestone = async () => {
    if (isSubmitting) return;

    if (
      subscription &&
      subscription.writeLimit !== "Unlimited" &&
      Number(subscription.writesUsed) >= Number(subscription.writeLimit)
    ) {
      handleError("You have reached your monthly milestone creation limit.");
      return;
    }

    if (!submitForm) {
      handleError("Form is not ready yet.");
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setIsSubmitting(true);
    setStatusMessage(null);
    setStatusType(null);

    try {
      const formData = await submitForm();

      if (!formData || !formData.description || !formData.milestone_date) {
        handleError("Please fill out the milestone details correctly.");
        setIsSubmitting(false);
        return;
      }

      const payload = new FormData();
      if (window.ethereum && window.ethereum.selectedAddress) {
        payload.append("walletAddress", window.ethereum.selectedAddress);
      } else {
        throw new Error("MetaMask wallet address not found");
      }
      payload.append("description", formData.description);
      payload.append("milestone_date", formData.milestone_date);
      payload.append("taggedFriendIds", JSON.stringify(taggedFriends.map((f) => f.uid)));
      payload.append("fee", getApplicableFee() || "");
      if (selectedFile) payload.append("image", selectedFile);

      const txPayload = await fetch("/api/milestone/create", {
        method: "POST",
        body: payload,
      });

      if (!txPayload.ok) {
        let errorMsg = "Error generating blockchain transaction, please try again.";
        try {
          const errorData = await txPayload.json();
          if (errorData?.error) errorMsg = errorData.error.message;
        } catch {}
        throw new Error(errorMsg);
      }

      const { id, metaTxRequest, ipfsCIDs, owner } = await txPayload.json();
      const contractInfo = await fetch(`/api/wallet/domain?to=${metaTxRequest.to}`);
      const { domain, types } = await contractInfo.json();

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      let signature;
      try {
        signature = await signer.signTypedData(domain, types, metaTxRequest);
      } catch {
        handleError("Signature request was rejected.");
        cleanupIpfs(ipfsCIDs);
        return;
      }

      const tx = { ...metaTxRequest, signature };

      // Payment
      const payment = await fetch("api/transaction/make-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: window.ethereum.selectedAddress,
          amount: getApplicableFee(),
        }),
      });

      if (!payment.ok) {
        cleanupIpfs(ipfsCIDs);
        throw new Error("Failed to create payment transaction, please try again.");
      }

      const paymentData = await payment.json();
      const { domain: paymentDomain, types: paymentTypes, message: paymentMessage } = paymentData;

      let paymentSignature;
      try {
        paymentSignature = await signer.signTypedData(paymentDomain, paymentTypes, paymentMessage);
      } catch {
        handleError("Signature request was rejected.");
        cleanupIpfs(ipfsCIDs);
        return;
      }

      const paymentTx = await fetch("/api/transaction/send-permit-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: paymentData,
          signature: paymentSignature,
        }),
      });

      if (!paymentTx.ok) {
        cleanupIpfs(ipfsCIDs);
        const errorData = await paymentTx.json();
        throw new Error(errorData?.error?.message || "Failed to send payment transaction");
      }

      const paymentTxData = await paymentTx.json();
      setStatusMessage(`Payment transaction sent: ${paymentTxData.txHash}`);
      setStatusType("success");

      // Relay
      const relayRes = await fetch("/api/milestone/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaTx: tx,
          type: taggedFriends.length > 0 ? "group" : "solo",
          friends: taggedFriends,
        }),
      });

      if (!relayRes.ok) {
        cleanupIpfs(ipfsCIDs);
        throw new Error("Failed to communicate with the blockchain, please try again later");
      }

      // Store milestone
      const store = await fetch("/api/milestone/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          ipfsCIDs,
          taggedFriends: taggedFriends.map((friend) => ({ uid: friend.uid })),
          owner,
        }),
      });




      if(store.ok){
        setStatusMessage("Milestone created successfully!");
        setStatusType("success");
        setSelectedFile(null);
        setImagePreview(null);
      }


      timeoutRef.current = setTimeout(() => {
        setStatusMessage(null);
        setStatusType(null);
      }, 5000);
    } catch (error) {
      cleanupIpfs((error as any)?.ipfsCIDs);
      handleError(
        `An error occurred: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Fee Calculation ---

  const getApplicableFee = () => {
    if (!feeData) return null;
    let baseFee = taggedFriends.length > 0 ? feeData.addGroupMilestoneFee : feeData.addMilestoneFee;
    if (!baseFee) return null;
    let discountPercent = 0;
    if (subscription && subscription.tierName === "Tier1" && feeData.tier1DiscountPercent) {
      discountPercent = feeData.tier1DiscountPercent;
    } else if (subscription && subscription.tierName === "Tier2" && feeData.tier2DiscountPercent) {
      discountPercent = feeData.tier2DiscountPercent;
    }
    const baseFeeNum = Number(baseFee);
    if (isNaN(baseFeeNum)) return baseFee;
    const discountedFee = baseFeeNum * (1 - discountPercent / 100);
    return discountedFee.toString();
  };

  // --- Write Limit Info ---

  const getWriteLimitInfo = () => {
    if (!subscription) return null;
    const { writeLimit, writesUsed } = subscription;
    if (writeLimit === "Unlimited") {
      return (
        <span>
          Write limit: <span className="text-white font-semibold">Unlimited</span>
        </span>
      );
    }
    const writesRemaining = Math.max(Number(writeLimit) - Number(writesUsed), 0);
    return (
      <span>
        Write limit: <span className="text-white font-semibold">{writeLimit}</span>
        {" | "}
        Used: <span className="text-white font-semibold">{writesUsed}</span>
        {" | "}
        Remaining: <span className="text-white font-semibold">{writesRemaining}</span>
      </span>
    );
  };

  const isOverWriteLimit =
    subscription &&
    subscription.writeLimit !== "Unlimited" &&
    Number(subscription.writesUsed) >= Number(subscription.writeLimit);

  // --- Render ---

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
                {subscription && (
                  <div className="mt-2 text-sm text-gray-300">
                    {getWriteLimitInfo()}
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>
      {isOverWriteLimit && (
        <div className="mb-4 p-3 bg-red-900/30 text-red-400 rounded-md text-sm">
          You have reached your monthly milestone creation limit.
        </div>
      )}
      <MilestoneForm setSubmitForm={setFormSubmitFunction} />
      <div className="mt-6">
        <label htmlFor="image-upload" className="text-white text-lg font-medium">
          Upload Image (Optional)
        </label>
        <input
          id="image-upload"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="mt-2 block w-full text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700"
        />
        {imagePreview && (
          <div className="mt-4">
            <p className="text-white mb-2">Image Preview:</p>
            <img
              src={imagePreview}
              alt="Milestone preview"
              className="max-w-full h-auto rounded-md border border-gray-700"
              style={{ maxHeight: "200px" }}
            />
          </div>
        )}
      </div>
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
          disabled={isSubmitting || isOverWriteLimit}
        >
          {isSubmitting ? "Creating..." : "Create Milestone"}
        </button>
      </div>
    </div>
  );
}