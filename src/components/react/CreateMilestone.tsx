import { useState, useEffect, useCallback } from "react";
import { MilestoneForm } from "@/components/react/MilestoneForm";
import { ClientTagFriendDropdown } from "@/components/react/ClientTagFriendDropdown";

interface Friend {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

export function CreateMilestone({ friends }: { friends: Friend[] }) {
  const [taggedFriends, setTaggedFriends] = useState<Friend[]>([]);
  const [submitForm, setSubmitForm] = useState<(() => Promise<any>) | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleTagSelect = (friend: Friend) => {
    setTaggedFriends((prev) => {
      if (!prev.some((f) => f.uid === friend.uid)) {
        return [...prev, friend];
      }
      return prev;
    });
  };

  const handleRemoveTag = (friend: Friend) => {
    setTaggedFriends((prev) => prev.filter((f) => f.uid !== friend.uid));
  };

  // Use useCallback to memoize the setSubmitForm handler
  const setFormSubmitFunction = useCallback((fn: any) => {
    setSubmitForm(() => fn);
  }, []);

  const createMilestone = async () => {
    // Prevent double-clicks
    if (isSubmitting) return;
    
    if (!submitForm) {
      alert("Form is not ready yet.");
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Get the form data
      const formData = await submitForm();
      
      if (!formData) {
        alert("Please fill out the milestone details correctly.");
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
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        alert("Milestone created successfully!");
        // You might want to redirect or clear the form here
      } else {
        const errorData = await res.json().catch(() => null);
        alert(`Error creating milestone: ${errorData?.message || res.statusText}`);
      }
    } catch (error) {
      console.error("Error in form submission:", error);
      alert(`An error occurred: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4 text-white">Create a New Milestone</h1>
      <MilestoneForm setSubmitForm={setFormSubmitFunction} />
      <div className="mt-8">
        <h2 className="text-xl text-white mb-2">Tag Friends</h2>
        <ClientTagFriendDropdown
          friends={friends}
          onTagSelect={handleTagSelect}
          onRemoveTag={handleRemoveTag}
        />
      </div>
      <div className="mt-8">
        <button
          className="bg-[#141313] text-white py-2 px-4 rounded-md hover:bg-[#111111] focus:outline-none focus:ring-2 focus:ring-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={createMilestone}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating..." : "Create Milestone"}
        </button>
      </div>
    </div>
  );
}