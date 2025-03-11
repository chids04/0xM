"use client";

import React, { useState } from "react";
import { TagFriendDropdown } from "./TagFriendDropdown";

export interface Friend {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

interface ClientTagFriendDropdownProps {
  friends: Friend[];
  onTagSelect?: (friend: Friend) => void;
  onRemoveTag?: (friend: Friend) => void;
}

export function ClientTagFriendDropdown({ friends, onTagSelect, onRemoveTag }: ClientTagFriendDropdownProps) {
  const [taggedFriends, setTaggedFriends] = useState<Friend[]>([]);

  const handleTagSelect = (friend: Friend) => {
    if (!taggedFriends.some((f) => f.uid === friend.uid)) {
      const updatedTags = [...taggedFriends, friend];
      setTaggedFriends(updatedTags);
      onTagSelect && onTagSelect(friend);
    }
  };

  const handleRemove = (friend: Friend) => {
    setTaggedFriends(taggedFriends.filter((f) => f.uid !== friend.uid));
    onRemoveTag && onRemoveTag(friend);
  };

  return (
    <>
      <TagFriendDropdown friends={friends} onSelect={handleTagSelect} />
      {taggedFriends.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-white">Tagged Friends:</p>
          {taggedFriends.map((friend) => (
            <div key={friend.uid} className="flex items-center gap-2">
              <img
                src={friend.photoURL}
                alt={friend.displayName}
                className="w-6 h-6 rounded-full border border-[#333333]"
              />
              <span className="text-white">{friend.displayName}</span>
              <button
                onClick={() => handleRemove(friend)}
                className="text-red-500 text-xs hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}