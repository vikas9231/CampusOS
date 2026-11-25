import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { signIn } from "@/app/actions/auth";
import { getAuthContext, landingPath } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string; error?: string; setup?: string }> }) {
  if (isSupabaseConfigured()) {
    const context = await getAuthContext();
    if (context) redirect(landingPath(context.assignments));
  }
  const params = await searchParams;
  const success = params.password === "updated" ? "Password updated. Sign in with your new password." : undefined;
  const error = !isSupabaseConfigured() || params.setup === "supabase" ? "Sign-in is unavailable until the server has Supabase URL and anon key configured." : params.error === "auth-callback" ? "That confirmation or reset link is invalid or expired. Request a new link and try again." : undefined;
  return <AuthShell><AuthForm action={signIn} mode="login" successMessage={success} errorMessage={error} /></AuthShell>;
}
