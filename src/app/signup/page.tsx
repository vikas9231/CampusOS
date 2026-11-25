import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { signUp } from "@/app/actions/auth";

export default function SignupPage() {
  return <AuthShell><AuthForm action={signUp} mode="signup" /></AuthShell>;
}
