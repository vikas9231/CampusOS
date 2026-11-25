"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthActionState } from "@/app/actions/auth";

type Props = {
  action: (state: AuthActionState, formData: FormData) => Promise<AuthActionState>;
  mode: "login" | "signup" | "forgot" | "reset";
  successMessage?: string;
  errorMessage?: string;
};

const emptyState: AuthActionState = {};

export function AuthForm({ action, mode, successMessage, errorMessage }: Props) {
  const [state, formAction, pending] = useActionState(action, emptyState);
  const isLogin = mode === "login";
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  const title = isLogin ? "Welcome back" : isSignup ? "Create your account" : isForgot ? "Reset your password" : "Choose a new password";

  return (
    <form action={formAction} className="auth-form">
      <div className="auth-heading"><p className="eyebrow">CAMPUS PORTAL</p><h1>{title}</h1><p>{isLogin ? "Sign in to continue to your college workspace." : isSignup ? "Create an account to request access to your college workspace." : isForgot ? "We'll email you a secure password reset link." : "Use a strong password you have not used before."}</p></div>
      {isSignup && <label>Full name<input name="full_name" autoComplete="name" required minLength={2} maxLength={100} placeholder="Your full name" /></label>}
      {isSignup && <label>Request access as<select name="requested_role" required defaultValue="student"><option value="student">Student</option><option value="faculty">Faculty</option></select></label>}
      {!isForgot && mode !== "reset" && <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@college.edu" /></label>}
      {mode === "login" && <label>Password<input name="password" type="password" autoComplete="current-password" required minLength={1} maxLength={128} placeholder="Enter your password" /></label>}
      {isSignup && <><label>Password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="At least 8 characters" /></label><label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Enter your password again" /></label></>}
      {mode === "reset" && <><label>New password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="At least 8 characters" /></label><label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Enter it again" /></label></>}
      {successMessage && <p className="notice success" role="status">{successMessage}</p>}
      {errorMessage && <p className="notice error" role="alert">{errorMessage}</p>}
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      {state.success && <p className="notice success" role="status">{state.success}</p>}
      <button className="button primary full" type="submit" disabled={pending}>{pending ? "Please wait…" : isLogin ? "Sign in" : isSignup ? "Create account" : isForgot ? "Send reset link" : "Update password"}</button>
      <div className="auth-links">
        {isLogin && <><Link href="/forgot-password">Forgot password?</Link><span>New to the portal? <Link href="/signup">Create an account</Link></span></>}
        {isSignup && <span>Already have an account? <Link href="/login">Sign in</Link></span>}
        {isForgot && <Link href="/login">Back to sign in</Link>}
        {mode === "reset" && <Link href="/login">Cancel and sign in</Link>}
      </div>
    </form>
  );
}
