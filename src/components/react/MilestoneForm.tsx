"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const milestoneSchema = z.object({
  description: z.string().min(10, { message: "Description must be at least 10 characters." }),
  milestone_date: z.string().refine((date) => {
    try {
      new Date(date);
      return true;
    } catch (error) {
      return false;
    }
  }, {
    message: "Invalid date format. Please use YYYY-MM-DD.",
  }),
  image: z.any(), // Handle file uploads with 'any' type for simplicity
});

type MilestoneSchemaType = z.infer<typeof milestoneSchema>;

interface MilestoneFormProps {
  onSubmit: (data: MilestoneSchemaType) => void; // Function to handle form submission
}

export function MilestoneForm({ onSubmit }: MilestoneFormProps) {
  const form = useForm<MilestoneSchemaType>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      description: "",
      milestone_date: "",
      image: null,
    },
    mode: "onChange",
  });

  const handleSubmit = (values: MilestoneSchemaType) => {
    onSubmit(values); // Call the parent component's onSubmit function
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white">Description</FormLabel>
              <FormControl>
                <Input
                  placeholder="Describe your milestone"
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-gray-400">
                Enter a detailed description of your milestone.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="milestone_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white">date</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-gray-400">
                Select the date when this milestone should be completed.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="image"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-white">Image</FormLabel>
              <FormControl>
                <Input
                  type="file"
                  accept="image/*"
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-gray-400">
                Upload an image to represent this milestone.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="bg-[#141313] text-white rounded-md hover:bg-[#111111] outline-2 outline-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-700">
          Create Milestone
        </Button>
      </form>
    </Form>
  );
}