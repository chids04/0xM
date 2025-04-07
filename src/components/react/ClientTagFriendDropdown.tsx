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

  // Only return the dropdown itself, without the list of tagged friends
  return <TagFriendDropdown friends={friends} onSelect={handleTagSelect} />;
}