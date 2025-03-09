"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const addFriendSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address." }),
});

type AddFriendFormValues = z.infer<typeof addFriendSchema>;

interface AddFriendProps {
  userId: string;
}

export function AddFriend({ userId }: AddFriendProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  const form = useForm<AddFriendFormValues>({
    resolver: zodResolver(addFriendSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: AddFriendFormValues) => {
    if (!userId) return;
    setStatus("loading");
    setMessage("");

    try {
      const response = await fetch("/api/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEmail: values.email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "An error occurred");
      }

      setStatus("success");
      setMessage(data.message || "Friend request sent successfully.");
      form.reset();
    } catch (error: any) {
      console.error("Error sending friend request:", error);
      setStatus("error");
      setMessage(error.message || "An error occurred while sending the friend request.");
    }
  };

  return (
    <div className="p-4 bg-[#1f1f1f] rounded-lg border border-[#333333]">
      <h3 className="text-lg font-semibold text-white mb-4">Add Friend by Email</h3>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-white">Friend's Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="friend@example.com"
                    className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={status === "loading"}
            className="w-full bg-purple-600 hover:bg-purple-700 transition-colors"
          >
            {status === "loading" ? "Sending..." : "Send Friend Request"}
          </Button>
        </form>
      </Form>
      {message && (
        <div
          className={`mt-4 p-3 rounded-md text-sm ${
            status === "success" ? "bg-green-900/30 text-green-400" : 
            status === "error" ? "bg-red-900/30 text-red-400" : "bg-gray-800 text-gray-300"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}