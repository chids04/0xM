"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { app } from "../../firebase/client";
import {
  getAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo
} from "firebase/auth";

const formSchema = z.object({
  username: z.string().min(2, { message: "Username must be at least 2 characters." }),
  email: z.string().email({ message: "Invalid email address." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
})

export function ProfileForm() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

async function onSubmit(values: z.infer<typeof formSchema>) {
  console.log(values) // Handle form submission
  const authClient = getAuth(app);

  try {
    const userCredential = await signInWithEmailAndPassword(authClient, values.email, values.password);
    const idToken = await userCredential.user.getIdToken();

    const response = await fetch("/api/auth/signin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ isNewUser: true }),
    });

    if (response.ok) {
      window.location.assign(response.url);
    }
    else{
      //failed to generate session
      const errorData = await response.json();
      alert("internal server error: " + errorData.message);
    }
  } catch (error) {
    console.error("Error signing in with email and password:", error);
  }

  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

        {/* Email Field */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="Enter email"
                  {...field}
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Password Field */}
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="Enter password"
                  {...field}
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Submit Button */}
        <Button
          type="submit"
          className="w-full bg-[#141313] text-white rounded-md hover:bg-[#111111] focus:outline-none focus:ring-2 focus:ring-gray-700"
        >
          login
        </Button>
      </form>
    </Form>
  )
}
