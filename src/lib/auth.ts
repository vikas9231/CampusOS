import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Profile, Role, RoleAssignment } from "@/types/auth";

export type AuthContext = { profile: Profile; assignments: RoleAssignment[] };

export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return getAuthContextForUser(user, supabase);
}

export async function getAuthContextForUser(
  user: Pick<User, "id" | "email" | "user_metadata">,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<AuthContext> {
  let profile: Profile | null = null;
  let assignments: RoleAssignment[] = [];
  let profileError: { code?: string } | null = null;
  let assignmentsError: { code?: string } | null = null;
  try {
    const [profileResult, assignmentsResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("role_assignments")
        .select("role, department_id, departments(name)")
        .eq("user_id", user.id),
    ]);
    profile = profileResult.data;
    profileError = profileResult.error;
    assignments = (assignmentsResult.data || []) as unknown as RoleAssignment[];
    assignmentsError = assignmentsResult.error;
  } catch (lookupError) {
    console.error("[auth] Account context lookup failed", {
      name: lookupError instanceof Error ? lookupError.name : "UnknownError",
    });
  }

  if (!profile) {
    // Recover accounts created before the profile trigger was installed.
    try {
      const { error: repairError } = await supabase.rpc("ensure_current_profile");
      if (!repairError) {
        const { data } = await supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url")
          .eq("id", user.id)
          .maybeSingle();
        profile = data;
      }
    } catch (repairError) {
      console.error("[auth] Profile recovery failed", {
        name: repairError instanceof Error ? repairError.name : "UnknownError",
      });
    }
  }

  if (profileError) console.error("[auth] Profile lookup failed", { code: profileError.code });
  if (assignmentsError) console.error("[auth] Role lookup failed", { code: assignmentsError.code });
  const metadataName = user.user_metadata?.full_name;
  const fullName = typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim()
    : user.email?.split("@")[0] || "College user";
  return {
    // A valid Auth session stays authenticated even if its profile row is
    // temporarily unavailable. In that case the user is routed to Pending Access.
    profile: profile
      ? { ...profile, email: profile.email || user.email || "" }
      : { id: user.id, full_name: fullName, email: user.email || "", avatar_url: null },
    assignments,
  };
}

export async function requireUser() {
  if (!isSupabaseConfigured()) redirect("/login?setup=supabase");
  const context = await getAuthContext();
  if (!context) redirect("/login");
  return context;
}

export async function requireRole(role: Role) {
  const context = await requireUser();
  if (!context.assignments.some((assignment) => assignment.role === role)) {
    redirect("/dashboard");
  }
  return context;
}

export function landingPath(assignments: RoleAssignment[]) {
  const order: Role[] = ["super_admin", "hod", "faculty", "student"];
  const role = order.find((candidate) => assignments.some((a) => a.role === candidate));
  return role ? `/${rolePath(role)}` : "/pending-access";
}

export function rolePath(role: Role) {
  return role === "super_admin" ? "admin" : role;
}

export function roleLabel(role: Role) {
  return role === "super_admin" ? "Super Admin" : role === "hod" ? "Head of Department" : role[0].toUpperCase() + role.slice(1);
}
