import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { app } from "../../firebase/client";
import { getAuth, sendPasswordResetEmail } from "firebase/auth";

const forgotSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: z.infer<typeof forgotSchema>) {
    setError(null);
    const auth = getAuth(app);
    try {
      await sendPasswordResetEmail(auth, values.email);
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Failed to send reset email.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-gray-300">Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="Enter your email"
                  {...field}
                  className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full bg-[#141313] text-white rounded-md hover:bg-[#111111] outline-2 outline-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-700"
        >
          Send Reset Email
        </Button>
        {sent && (
          <div className="text-green-400 text-center">
            Password reset email sent! Check your inbox.
          </div>
        )}
        {error && (
          <div className="text-red-400 text-center">
            {error}
          </div>
        )}
      </form>
    </Form>
  );
}