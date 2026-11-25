import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { requestPasswordReset } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  return <AuthShell><AuthForm action={requestPasswordReset} mode="forgot" /></AuthShell>;
}
