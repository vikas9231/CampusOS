"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthContextForUser, landingPath } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(8).max(128);
const signInPasswordSchema = z.string().min(1).max(128);

export type AuthActionState = { error?: string; success?: string };

function signInErrorMessage(error: { code?: string; message?: string; name?: string }) {
  const code = error.code?.toLowerCase() || "";
  const message = error.message?.toLowerCase() || "";
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Confirm your email address before signing in. Check your inbox for the confirmation link.";
  }
  if (code === "invalid_credentials" || code === "user_not_found" || message.includes("invalid login credentials")) {
    return "Email or password is incorrect. Check both fields and try again.";
  }
  if (code.includes("rate_limit") || code === "too_many_requests") {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }
  if (error.name === "AuthRetryableFetchError" || message.includes("fetch failed")) {
    return "Could not reach Supabase Auth. Check your connection and try again.";
  }
  return "Sign-in failed. Please try again or contact your college administrator.";
}

export async function signIn(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) return { error: "Sign-in is unavailable until Supabase is configured on the server." };
  const email = emailSchema.safeParse(formData.get("email"));
  const password = signInPasswordSchema.safeParse(formData.get("password"));
  if (!email.success || !password.success) return { error: "Enter a valid email and password." };

  let supabase;
  let result;
  try {
    supabase = await createClient();
    result = await supabase.auth.signInWithPassword({ email: email.data, password: password.data });
  } catch (error) {
    console.error("[auth] Password sign-in request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return { error: "Could not reach Supabase Auth. Check your connection and try again." };
  }
  if (result.error) {
    console.warn("[auth] Password sign-in was rejected", { code: result.error.code });
    return { error: signInErrorMessage(result.error) };
  }
  if (!result.data.user || !result.data.session) {
    console.error("[auth] Supabase returned no user session after password sign-in");
    return { error: "Supabase did not create a sign-in session. Confirm your email and try again." };
  }

  console.info("[auth] Password sign-in succeeded; loading role assignments");
  const context = await getAuthContextForUser(result.data.user, supabase);
  redirect(landingPath(context.assignments));
}

export async function signUp(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) return { error: "Account creation is unavailable until Supabase is configured on the server." };
  const fullName = z.string().trim().min(2).max(100).safeParse(formData.get("full_name"));
  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));
  const confirmation = z.string().safeParse(formData.get("confirm_password"));
  const requestedRole = z.enum(["student", "faculty"]).safeParse(formData.get("requested_role"));
  if (!fullName.success || !email.success || !password.success || !confirmation.success || !requestedRole.success || password.data !== confirmation.data) return { error: "Check your details, choose Student or Faculty, and enter matching passwords of at least 8 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      data: { full_name: fullName.data, requested_role: requestedRole.data },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback?next=/pending-access`,
    },
  });
  if (error) return { error: error.message };
  if (!data.session) return { success: "Check your email to confirm your account. Your registration request will be reviewed by a college administrator." };
  redirect("/pending-access");
}

export async function requestPasswordReset(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) return { error: "Password reset is unavailable until Supabase is configured on the server." };
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback?next=/reset-password`,
  });
  // Do not disclose whether an account exists.
  return { success: "If an account exists for that address, a password reset link has been sent." };
}

export async function updatePassword(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) return { error: "Password updates are unavailable until Supabase is configured on the server." };
  const password = passwordSchema.safeParse(formData.get("password"));
  const confirmation = z.string().safeParse(formData.get("confirm_password"));
  if (!password.success || !confirmation.success || password.data !== confirmation.data) {
    return { error: "Enter matching passwords with at least 8 characters." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) return { error: "We couldn't update your password. Request a new reset link and try again." };
  redirect("/login?password=updated");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
