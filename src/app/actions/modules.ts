"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWorkbenchSpec } from "@/lib/workbench";
import type { Role } from "@/types/auth";

export type ModuleActionState = { error?: string; success?: string };
export type AttendanceRosterRow = { id: string; enrollmentNumber: string; studentName: string };

function rethrowRedirect(error: unknown) {
  if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
}

function parseRole(value: FormDataEntryValue | null): Role | null {
  return value === "super_admin" || value === "faculty" || value === "student" || value === "hod" ? value : null;
}

function parseValue(field: { type?: string; required?: boolean; min?: number; max?: number }, raw: FormDataEntryValue | null) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value && field.required) throw new Error("Complete all required fields.");
  if (!value) return null;
  if (field.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || (field.min !== undefined && number < field.min) || (field.max !== undefined && number > field.max)) {
      throw new Error("A number is outside the allowed range.");
    }
    return number;
  }
  if (field.type === "datetime-local") {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) throw new Error("Enter a valid date and time.");
    return date.toISOString();
  }
  if (value.length > 5000) throw new Error("Text fields must be shorter than 5,000 characters.");
  return value;
}

async function resolveActor(formData: FormData) {
  const role = parseRole(formData.get("portal_role"));
  const module = z.string().min(1).max(50).safeParse(formData.get("module_key"));
  if (!role || !module.success) throw new Error("This operation is not available.");
  const context = await requireRole(role);
  const spec = getWorkbenchSpec(role, module.data);
  if (!spec) throw new Error("This module is not available for your account.");
  return { role, context, spec, moduleKey: module.data };
}

export async function createModuleRecord(_state: ModuleActionState, formData: FormData): Promise<ModuleActionState> {
  try {
    const { role, context, spec, moduleKey } = await resolveActor(formData);
    const fields = spec.fields.filter((field) => field.create !== false);
    if (!fields.length) return { error: "This module is read-only for your role." };
    const values: Record<string, unknown> = {};
    for (const field of fields) values[field.name] = parseValue(field, formData.get(field.name));
    if (spec.actorField) values[spec.actorField] = context.profile.id;
    if (spec.ownStudent) {
      const supabase = await createClient();
      const { data: student } = await supabase.from("students").select("id").eq("profile_id", context.profile.id).maybeSingle();
      if (!student) return { error: "Your student record has not been set up." };
      values.student_id = student.id;
    }

    const supabase = await createClient();
    let error: { code?: string } | null = null;
    if (spec.createRpc === "admin_create_student") {
      const result = await supabase.rpc(spec.createRpc, {
        p_profile_id: values.profile_id,
        p_enrollment_number: values.enrollment_number,
        p_course_id: values.course_id,
        p_admission_year: values.admission_year,
      });
      error = result.error;
    } else if (spec.createRpc === "admin_create_faculty") {
      const result = await supabase.rpc(spec.createRpc, {
        p_profile_id: values.profile_id,
        p_employee_number: values.employee_number,
        p_department_id: values.department_id,
      });
      error = result.error;
    } else {
      const result = await (supabase.from(spec.table) as any).insert(values);
      error = result.error;
    }
    if (error) return { error: error.code === "23505" ? "That identifier or record already exists." : "The record could not be saved. Check the selected records and try again." };
    revalidatePath(`/${role === "super_admin" ? "admin" : role}/${moduleKey}`);
    return { success: "Record saved." };
  } catch (error) {
    rethrowRedirect(error);
    return { error: error instanceof Error ? error.message : "The record could not be saved." };
  }
}

export async function updateModuleRecord(_state: ModuleActionState, formData: FormData): Promise<ModuleActionState> {
  try {
    const { role, context, spec, moduleKey } = await resolveActor(formData);
    const id = z.string().uuid().safeParse(formData.get("record_id"));
    if (!id.success) return { error: "Select a valid record." };
    const fields = spec.fields.filter((field) => field.update !== false);
    if (!fields.length) return { error: "This module is read-only for your role." };
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = formData.get(field.name);
      if (raw === null && !field.required) continue;
      values[field.name] = parseValue(field, raw);
    }
    if (spec.actorField) values[spec.actorField] = context.profile.id;
    const supabase = await createClient();
    const { data, error } = await (supabase.from(spec.table) as any).update(values).eq("id", id.data).select("id").maybeSingle();
    if (error || !data) return { error: "The record could not be updated. Your role may not have permission to change it." };
    revalidatePath(`/${role === "super_admin" ? "admin" : role}/${moduleKey}`);
    return { success: "Changes saved." };
  } catch (error) {
    rethrowRedirect(error);
    return { error: error instanceof Error ? error.message : "The record could not be updated." };
  }
}

export async function getAttendanceRoster(offeringId: string): Promise<{ rows: AttendanceRosterRow[]; error?: string }> {
  try {
    await requireRole("faculty");
    const id = z.string().uuid().safeParse(offeringId);
    if (!id.success) return { rows: [], error: "Choose a valid class." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("enrollments").select("id,student:students(enrollment_number,profile:profiles(full_name))").eq("course_offering_id", id.data).eq("status", "enrolled").order("enrolled_at").limit(500);
    if (error) return { rows: [], error: "The class roster could not be loaded." };
    const rows = ((data || []) as any[]).map((item) => ({
      id: item.id as string,
      enrollmentNumber: String(item.student?.enrollment_number || "Student"),
      studentName: String(item.student?.profile?.full_name || "Student"),
    }));
    return { rows };
  } catch (error) {
    rethrowRedirect(error);
    return { rows: [], error: "The class roster is unavailable." };
  }
}

export async function saveAttendance(_state: ModuleActionState, formData: FormData): Promise<ModuleActionState> {
  try {
    const context = await requireRole("faculty");
    const offeringId = z.string().uuid().safeParse(formData.get("course_offering_id"));
    const date = z.string().date().safeParse(formData.get("session_date"));
    const label = z.string().max(120).safeParse(String(formData.get("session_label") || ""));
    if (!offeringId.success || !date.success || !label.success) return { error: "Choose a class and valid session date." };
    const supabase = await createClient();
    const { data: session, error: sessionError } = await supabase.from("attendance_sessions").upsert({
      course_offering_id: offeringId.data, session_date: date.data, session_label: label.data.trim(), created_by: context.profile.id,
    }, { onConflict: "course_offering_id,session_date,session_label" }).select("id").single();
    if (sessionError || !session) return { error: "The attendance session could not be saved. Check your class assignment." };
    const rosterResult = await supabase.from("enrollments").select("id").eq("course_offering_id", offeringId.data).eq("status", "enrolled").limit(500);
    if (rosterResult.error) return { error: "The class roster could not be loaded." };
    const attendance = (rosterResult.data || []).map(({ id }) => {
      const raw = formData.get(`attendance_${id}`);
      if (raw !== "present" && raw !== "absent" && raw !== "excused") throw new Error("Choose an attendance status for every student.");
      const status = raw;
      return { session_id: session.id, enrollment_id: id, status, marked_by: context.profile.id };
    });
    if (attendance.length) {
      const { error } = await supabase.from("attendance_records").upsert(attendance, { onConflict: "session_id,enrollment_id" });
      if (error) return { error: "Attendance was not saved. Check class access and try again." };
    }
    revalidatePath("/faculty/attendance");
    revalidatePath("/student/attendance");
    return { success: `Attendance saved for ${attendance.length} enrolled students.` };
  } catch (error) {
    rethrowRedirect(error);
    return { error: error instanceof Error ? error.message : "Attendance could not be saved." };
  }
}
