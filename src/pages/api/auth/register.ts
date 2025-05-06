import type { APIRoute } from "astro";
import { getAuth } from "firebase-admin/auth";
import { app } from "../../../firebase/server";
import { ethers } from "ethers";

export const POST: APIRoute = async ({ request, redirect }) => {
  const auth = getAuth(app);

  /* Get form data */
  const formData = await request.json();
  const email = formData.email;
  const password = formData.password;
  const name = formData.name;

  if (!email || !password || !name) {
    return new Response(JSON.stringify({ message: "Missing user, email or password" }), {
      status: 400,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  try {
    await auth.createUser({
      email,
      password,
      displayName: name,
    });

  } catch (error: any) {
    console.log(error)
    const errorMessage = error.message || "Something went wrong";
    return new Response(JSON.stringify({ message: errorMessage }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    }); 
  }

  return new Response(JSON.stringify({ message: "User created successfully" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
};