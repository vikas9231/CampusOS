import { redirect } from "next/navigation";
import { landingPath, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardRedirect() {
  const context = await requireUser();
  redirect(landingPath(context.assignments));
}
