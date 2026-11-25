import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { updatePassword } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  await requireUser();
  return <AuthShell><AuthForm action={updatePassword} mode="reset" /></AuthShell>;
}
