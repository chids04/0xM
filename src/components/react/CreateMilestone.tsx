import { useState } from "react";
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
  const [submitForm, setSubmitForm] = useState<(() => Promise<any>) | null>(null); // Return form data

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

  const createMilestone = async () => {
    if (!submitForm) {
      alert("Form is not ready yet.");
      return;
    }

    // Wait for the form submission and get the form data
    const formData = await submitForm();

    if (!formData) {
      alert("Please fill out the milestone details.");
      return;
    }

    const payload = {
      ...formData,
      taggedFriendIds: taggedFriends.map((f) => f.uid),
    };

    console.log(payload);

    const res = await fetch("/api/milestone/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      alert("Milestone created successfully!");
    } else {
      alert("Error creating milestone");
    }
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4 text-white">Create a New Milestone</h1>
      <MilestoneForm setSubmitForm={setSubmitForm} />
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
          className="bg-[#141313] text-white py-2 px-4 rounded-md hover:bg-[#111111] focus:outline-none focus:ring-2 focus:ring-gray-700"
          onClick={createMilestone}
        >
          Create Milestone
        </button>
      </div>
    </div>
  );
}