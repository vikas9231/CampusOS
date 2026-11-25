"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type RegistrationActionState = { error?: string; success?: string };
const requestIdSchema = z.string().uuid();

function rpcErrorMessage(message?: string) {
  const value = message?.toLowerCase() || "";
  if (value.includes("super admin access required")) return "Only a Super Admin can review registration requests.";
  if (value.includes("no longer pending")) return "This request was already reviewed. Refresh the list to see its latest status.";
  if (value.includes("duplicate key") || value.includes("unique constraint")) return "That enrollment or employee number is already in use.";
  if (value.includes("foreign key")) return "Choose a valid course or department.";
  return "The request could not be processed. Check the details and try again.";
}

export async function approveRegistration(_state: RegistrationActionState, formData: FormData): Promise<RegistrationActionState> {
  await requireRole("super_admin");
  const requestId = requestIdSchema.safeParse(formData.get("request_id"));
  const role = z.enum(["student", "faculty"]).safeParse(formData.get("requested_role"));
  if (!requestId.success || !role.success) return { error: "Invalid registration request." };
  const supabase = await createClient();
  if (role.data === "student") {
    const enrollment = z.string().trim().min(1).max(80).safeParse(formData.get("enrollment_number"));
    const course = z.string().uuid().safeParse(formData.get("course_id"));
    const year = z.coerce.number().int().min(1950).max(2200).safeParse(formData.get("admission_year"));
    if (!enrollment.success || !course.success || !year.success) return { error: "Enter an enrollment number, course, and valid admission year." };
    const { error } = await supabase.rpc("admin_approve_student_request", {
      p_request_id: requestId.data, p_enrollment_number: enrollment.data,
      p_course_id: course.data, p_admission_year: year.data,
    });
    if (error) return { error: rpcErrorMessage(error.message) };
  } else {
    const employee = z.string().trim().min(1).max(80).safeParse(formData.get("employee_number"));
    const department = z.string().uuid().safeParse(formData.get("department_id"));
    if (!employee.success || !department.success) return { error: "Enter an employee number and choose a department." };
    const { error } = await supabase.rpc("admin_approve_faculty_request", {
      p_request_id: requestId.data, p_employee_number: employee.data, p_department_id: department.data,
    });
    if (error) return { error: rpcErrorMessage(error.message) };
  }
  revalidatePath("/admin/access");
  revalidatePath("/pending-access");
  return { success: "Registration approved and access provisioned." };
}

export async function rejectRegistration(_state: RegistrationActionState, formData: FormData): Promise<RegistrationActionState> {
  await requireRole("super_admin");
  const requestId = requestIdSchema.safeParse(formData.get("request_id"));
  const note = z.string().trim().max(500).safeParse(formData.get("rejection_note") ?? "");
  if (!requestId.success || !note.success) return { error: "Invalid request or rejection note." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reject_role_request", {
    p_request_id: requestId.data, p_rejection_note: note.data || null,
  });
  if (error) return { error: rpcErrorMessage(error.message) };
  revalidatePath("/admin/access");
  revalidatePath("/pending-access");
  return { success: "Registration request rejected." };
}
