import type { APIRoute } from "astro";
import { app } from "../../../firebase/server";
import { getFirestore } from "firebase-admin/firestore";
import type { Milestone } from "./create";
import { milestoneConverter } from "./create";

// export const POST : APIRoute = async ({ request, redirect }) => {
//     const formData = await request.formData();
//     const 
// };

