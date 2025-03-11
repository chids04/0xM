"use client";

import React, { useEffect, useLayoutEffect } from "react";
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
import { fromRoutingStrategy } from "node_modules/astro/dist/i18n/utils";

const milestoneSchema = z.object({
  description: z.string().min(10, { message: "Description must be at least 10 characters." }),
  milestone_date: z.string().refine((date) => {
    try {
      const parsed = new Date(date);
      return !isNaN(parsed.getTime())
    } catch (error) {
      return false;
    }
  }, {
    message: "Invalid date format. Please use DD-MM-YYYY.",
  }),
  image: z.any(), // Handle file uploads with 'any' type for simplicity
});

type MilestoneSchemaType = z.infer<typeof milestoneSchema>;

interface MilestoneFormProps {
  setSubmitForm: (submitFn: () => Promise<MilestoneSchemaType>) => void; // Return form data
}

export function MilestoneForm({ setSubmitForm }: MilestoneFormProps) {
  const form = useForm<MilestoneSchemaType>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      description: "",
      milestone_date: "",
      image: null,
    },
    mode: "onChange",
  });

  // Expose form submission function
  useLayoutEffect(() => {
    setSubmitForm(() => async () => {
      await form.trigger(); // Ensure validation happens
      if (form.formState.isValid) {
        return form.getValues(); // Return the form data
      }
      return null // Return null if the form is invalid
    });
  }, [setSubmitForm, form]);

  return (
    <Form {...form}>
      <form className="space-y-6">
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
              <FormLabel className="text-white">Image</FormLabel>
              <FormControl>
                <Input
                  type="file"
                  accept="image/*"
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500  file:mr-5 file:rounded-md file:text-gray-400"
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
      </form>
    </Form>
  );
}