"use client";

import React, { useState, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface Friend {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

interface TagFriendDropdownProps {
  friends: Friend[];
  onSelect: (friend: Friend) => void;
}

export function TagFriendDropdown({ friends, onSelect }: TagFriendDropdownProps) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredFriends = useMemo(() => {
    if (!search) return friends;
    const lowerSearch = search.toLowerCase();
    return friends.filter(
      (friend) =>
        friend.displayName.toLowerCase().includes(lowerSearch) ||
        friend.email.toLowerCase().includes(lowerSearch)
    );
  }, [search, friends]);

  return (
    // Make the container focusable so it can handle onBlur.
    <div
      className="relative"
      tabIndex={0}
      onBlur={() => setIsOpen(false)}
    >
      <Input
        ref={inputRef}
        placeholder="Search friends..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setIsOpen(true)}
        className="w-full"
      />
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-[#1f1f1f] border border-[#333333] rounded-md shadow-lg">
          <ScrollArea style={{ height: "200px" }}>
            {filteredFriends.map((friend) => (
              <div
                key={friend.uid}
                className="flex items-center p-2 hover:bg-[#222222] cursor-pointer"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevents the onBlur from closing the dropdown first
                  onSelect(friend);
                  setIsOpen(false);
                  setSearch("");
                  if (inputRef.current) {
                    inputRef.current.blur();
                  }
                }}
              >
                <img
                  src={friend.photoURL}
                  alt={`${friend.displayName}'s avatar`}
                  className="w-8 h-8 rounded-full mr-2 border border-[#333333]"
                />
                <div>
                  <div className="text-white font-medium">{friend.displayName}</div>
                  <div className="text-gray-400 text-xs">{friend.email}</div>
                </div>
              </div>
            ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}