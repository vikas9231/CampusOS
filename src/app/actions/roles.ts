"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const roleSchema = z.enum(["super_admin", "faculty", "student", "hod"]);

export type RoleActionState = { error?: string; success?: string };

export async function assignRole(_state: RoleActionState, formData: FormData): Promise<RoleActionState> {
  const actor = await requireRole("super_admin");
  const userId = z.string().uuid().safeParse(formData.get("user_id"));
  const role = roleSchema.safeParse(formData.get("role"));
  const department = z.union([z.literal(""), z.string().uuid()]).safeParse(formData.get("department_id") ?? "");
  if (!userId.success || !role.success || !department.success) return { error: "Choose a valid account, role, and department." };
  if (role.data === "hod" && !department.data) return { error: "A department is required for an HOD role." };
  if (role.data !== "hod" && department.data) return { error: "Only HOD assignments can be scoped to a department here." };

  const supabase = await createClient();
  const { data: pendingRequest, error: requestLookupError } = await supabase.from("role_requests")
    .select("id").eq("user_id", userId.data).eq("status", "pending").maybeSingle();
  if (requestLookupError) return { error: "Registration status could not be checked. Refresh the page and try again." };
  if (pendingRequest) return { error: "Review this account's registration request before assigning access." };
  const { error } = await supabase.from("role_assignments").insert({
    user_id: userId.data,
    role: role.data,
    department_id: department.data || null,
    created_by: actor.profile.id,
  });
  if (error?.code === "23505") return { error: "That role is already assigned to this account." };
  if (error) return { error: "The role could not be assigned. Check the selected account and try again." };
  revalidatePath("/admin/access");
  return { success: "Role assigned." };
}

export async function removeRole(assignmentId: string) {
  await requireRole("super_admin");
  const id = z.string().uuid().parse(assignmentId);
  const supabase = await createClient();
  const { data: assignment, error: lookupError } = await supabase
    .from("role_assignments")
    .select("id, role")
    .eq("id", id)
    .maybeSingle();
  if (lookupError || !assignment) throw new Error("Role assignment was not found.");
  if (assignment.role === "super_admin") {
    const { data: administrators, error: countError } = await supabase
      .from("role_assignments")
      .select("id")
      .eq("role", "super_admin");
    if (countError || (administrators?.length || 0) <= 1) {
      throw new Error("The last Super Admin assignment cannot be removed.");
    }
  }
  const { error } = await supabase.from("role_assignments").delete().eq("id", id);
  if (error) throw new Error("Role assignment could not be removed.");
  revalidatePath("/admin/access");
  revalidatePath("/dashboard");
}
