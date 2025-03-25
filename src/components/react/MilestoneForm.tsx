"use client";

import React, { useEffect, useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/input";
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
  milestone_date: z.string().refine(
    (date) => {
      try {
        const parsed = new Date(date);
        return !isNaN(parsed.getTime());
      } catch (error) {
        return false;
      }
    },
    {
      message: "Invalid date format. Please use YYYY-MM-DD.",
    }
  ),
  image: z
    .string()
    .url({ message: "Please enter a valid URL (e.g., https://example.com/image.jpg)." })
    .optional()
    .or(z.literal("")), // Allow empty string for optional field
});

type MilestoneSchemaType = z.infer<typeof milestoneSchema>;

interface MilestoneFormProps {
  setSubmitForm: (submitFn: () => Promise<MilestoneSchemaType | null>) => void;
}

export function MilestoneForm({ setSubmitForm }: MilestoneFormProps) {
  const form = useForm<MilestoneSchemaType>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      description: "",
      milestone_date: "",
      image: "",
    },
    mode: "onChange",
  });

  const [imagePreview, setImagePreview] = useState<string>("");

  const submitFormFn = useCallback(async () => {
    const isValid = await form.trigger();
    if (isValid) {
      return form.getValues();
    }
    return null;
  }, [form]);

  useEffect(() => {
    setSubmitForm(submitFormFn);
  }, [setSubmitForm, submitFormFn]);

  // Watch the image field and update preview
  const imageValue = form.watch("image");
  useEffect(() => {
    if (imageValue && z.string().url().safeParse(imageValue).success) {
      setImagePreview(imageValue);
    } else {
      setImagePreview("");
    }
  }, [imageValue]);

  return (
    <Form {...form}>
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
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
              <FormLabel className="text-white">Date</FormLabel>
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
              <FormLabel className="text-white">Image URL</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  placeholder="Enter image URL (e.g., https://example.com/image.jpg)"
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-gray-400">
                Enter the URL of an image to represent this milestone (optional).
              </FormDescription>
              <FormMessage />
              {imagePreview && (
                <div className="mt-2">
                  <p className="text-white mb-1">Preview:</p>
                  <img
                    src={imagePreview}
                    alt="Milestone preview"
                    className="max-w-full h-auto rounded-md border border-gray-700"
                    onError={() => setImagePreview("")}
                  />
                </div>
              )}
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}