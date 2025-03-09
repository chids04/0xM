"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { getAuth, updateProfile } from "firebase/auth";
import { getFirestore, doc, updateDoc } from "firebase/firestore";
import { app } from "../../firebase/client";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

const profileSchema = z.object({
  displayName: z.string().min(2, { message: "Display name must be at least 2 characters." }),
  bio: z.string().max(160, { message: "Bio cannot exceed 160 characters." }).optional(),
  location: z.string().max(100, { message: "Location cannot exceed 100 characters." }).optional(),
  website: z.string().url({ message: "Please enter a valid URL." }).or(z.string().length(0)).optional(),
  photoURL: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

interface UserProfileProps {
  userData: {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    bio?: string;
    location?: string;
    website?: string;
    joinDate?: string;
  };
}

export function UserProfile({ userData }: UserProfileProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: userData.displayName || "",
      bio: userData.bio || "",
      location: userData.location || "",
      website: userData.website || "",
      photoURL: userData.photoURL || "",
    },
  });

  const onSubmit = async (values: ProfileFormValues) => {
    setIsSaving(true);
    try {
      const auth = getAuth(app);
      const db = getFirestore(app);
      const user = auth.currentUser;
      
      if (user) {
        // Update displayName and photoURL in Firebase Auth
        if (values.displayName !== userData.displayName || values.photoURL !== userData.photoURL) {
          await updateProfile(user, {
            displayName: values.displayName,
            ...(values.photoURL ? { photoURL: values.photoURL } : {})
          });
        }
        
        // Update additional fields in Firestore
        const userDocRef = doc(db, "users", userData.uid);
        await updateDoc(userDocRef, {
          bio: values.bio || "",
          location: values.location || "",
          website: values.website || "",
          updatedAt: new Date().toISOString()
        });
        
        // Force page refresh to show updated data
        window.location.reload();
      }
    } catch (error) {
      console.error("Error updating profile:", error);
      // Handle error (display error message to user)
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  const joinDate = userData.joinDate 
    ? new Date(userData.joinDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Unknown';

  return (
    <div className="space-y-6">
      {!isEditing ? (
        /* View Mode */
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Profile Image */}
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-purple-500/30">
              <img 
                src={userData.photoURL} 
                alt={`${userData.displayName}'s profile`} 
                className="w-full h-full object-cover"
              />
            </div>
            
            {/* Basic Info */}
            <div className="flex-1 text-center sm:text-left">
              <h2 className="text-2xl font-bold text-white">{userData.displayName}</h2>
              <p className="text-gray-400">{userData.email}</p>
              <p className="text-sm text-purple-400 mt-1">Joined {joinDate}</p>
              
              {userData.bio && (
                <p className="mt-4 text-gray-300">{userData.bio}</p>
              )}
              
              <div className="mt-4 space-y-1">
                {userData.location && (
                  <div className="flex items-center justify-center sm:justify-start gap-2 text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>{userData.location}</span>
                  </div>
                )}
                
                {userData.website && (
                  <div className="flex items-center justify-center sm:justify-start gap-2 text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <a href={userData.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                      {userData.website.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex justify-center sm:justify-end">
            <Button 
              onClick={() => setIsEditing(true)}
              className="bg-purple-600 hover:bg-purple-700 transition-colors"
            >
              Edit Profile
            </Button>
          </div>
        </div>
      ) : (
        /* Edit Mode */
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Profile image URL field */}
            <FormField
              control={form.control}
              name="photoURL"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Profile Image URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://example.com/your-image.jpg"
                      className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-gray-400">
                    Enter a URL for your profile picture
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Display name field */}
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Display Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Your name"
                      className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Bio field */}
            <FormField
              control={form.control}
              name="bio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Bio</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Tell others a bit about yourself"
                      className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-gray-400">
                    Max 160 characters
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Location field */}
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Location</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="New York, USA"
                      className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Website field */}
            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Website</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://yourwebsite.com"
                      className="bg-[#1f1f1f] text-white border border-[#333333] rounded-md"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="flex justify-end space-x-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsEditing(false)}
                className="border-gray-600 text-gray-300 hover:bg-[#2a2a2a]"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSaving}
                className="bg-purple-600 hover:bg-purple-700 transition-colors"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}