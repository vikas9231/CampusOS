import { redirect } from "next/navigation";
import { getAuthContext, landingPath } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function HomePage() {
  if (isSupabaseConfigured()) {
    const context = await getAuthContext();
    if (context) redirect(landingPath(context.assignments));
  }
  redirect("/login");
}
