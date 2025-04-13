"use client";

import React, { useEffect, useCallback } from "react";
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
  description: z.string().max(30, { message: "Description must be less than 30 characters." }),
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
    },
    mode: "onChange",
  });

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
      </form>
    </Form>
  );
}