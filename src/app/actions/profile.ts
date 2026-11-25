"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ProfileActionState = { error?: string; success?: string };

export async function updateProfile(_state: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const { profile } = await requireUser();
  const fullName = z.string().trim().min(2).max(100).safeParse(formData.get("full_name"));
  if (!fullName.success) return { error: "Name must be between 2 and 100 characters." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: fullName.data }).eq("id", profile.id);
  if (error) return { error: "Profile could not be updated. Please try again." };
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { success: "Profile updated." };
}
