import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { getWorkbenchSpec, optionChoices, type FieldOption } from "@/lib/workbench";
import type { Role } from "@/types/auth";

const optionSources: Record<string, { table: string; select: string; value: string; label: string; activeOnly?: boolean }> = {
  departments: { table: "departments", select: "id,code,name", value: "id", label: "name" },
  profiles: { table: "profiles", select: "id,full_name,email", value: "id", label: "full_name" },
  courses: { table: "courses", select: "id,code,name,status", value: "id", label: "name", activeOnly: true },
  years: { table: "academic_years", select: "id,name", value: "id", label: "name" },
  semesters: { table: "semesters", select: "id,semester_number,course_id", value: "id", label: "semester_number" },
  subjects: { table: "subjects", select: "id,code,title", value: "id", label: "title" },
  faculty: { table: "faculty", select: "id,employee_number", value: "id", label: "employee_number" },
  students: { table: "students", select: "id,enrollment_number", value: "id", label: "enrollment_number" },
  offerings: { table: "course_offerings", select: "id,section,subject_id,semester_id", value: "id", label: "section" },
  examinations: { table: "examinations", select: "id,title", value: "id", label: "title" },
  examSubjects: { table: "exam_subjects", select: "id,examination_id,course_offering_id", value: "id", label: "id" },
  enrollments: { table: "enrollments", select: "id,student_id,course_offering_id", value: "id", label: "id" },
  rooms: { table: "rooms", select: "id,building,room_number", value: "id", label: "room_number" },
  attendanceSessions: { table: "attendance_sessions", select: "id,session_date,session_label", value: "id", label: "session_date" },
  assignments: { table: "assignments", select: "id,title", value: "id", label: "title" },
  invoices: { table: "student_invoices", select: "id,invoice_number", value: "id", label: "invoice_number" },
};

const referenceSource: Record<string, string> = {
  department_id: "departments", profile_id: "profiles", course_id: "courses", academic_year_id: "years",
  semester_id: "semesters", subject_id: "subjects", faculty_id: "faculty", student_id: "students",
  course_offering_id: "offerings", examination_id: "examinations", exam_subject_id: "examSubjects",
  enrollment_id: "enrollments", room_id: "rooms", session_id: "attendanceSessions", assignment_id: "assignments", invoice_id: "invoices",
};

export type WorkbenchData = {
  role: Role;
  key: string;
  spec: NonNullable<ReturnType<typeof getWorkbenchSpec>>;
  rows: Record<string, unknown>[];
  options: Record<string, FieldOption[]>;
  optionErrors: Record<string, string>;
  valueLabels: Record<string, string>;
  actorName: string;
  error?: string;
};

export async function loadWorkbenchData(role: Role, modulePath: string[]) {
  const key = modulePath.join("/");
  const { profile } = await requireRole(role);
  const spec = getWorkbenchSpec(role, key);
  if (!spec) return null;
  const supabase = await createClient();
  const query = (supabase.from(spec.table) as any).select(spec.select).limit(200);
  const { data, error } = spec.orderBy
    ? await query.order(spec.orderBy, { ascending: false })
    : await query;
  const rows = (data || []) as Record<string, unknown>[];
  const sources = [...new Set([
    ...spec.fields.map((field) => field.options).filter((source): source is string => Boolean(source)),
    ...spec.columns.map((column) => referenceSource[column.key]).filter((source): source is string => Boolean(source)),
  ])];
  const options: Record<string, FieldOption[]> = {};
  const optionErrors: Record<string, string> = {};

  for (const source of sources) {
    const staticChoices = optionChoices(source);
    if (staticChoices.length) {
      options[source] = staticChoices;
      continue;
    }
    if (source === "unassignedProfiles") {
      const [{ data: profiles }, { data: students }, { data: faculty }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email").order("full_name").limit(200),
        supabase.from("students").select("profile_id"),
        supabase.from("faculty").select("profile_id"),
      ]);
      const used = new Set([...(students || []).map((item) => item.profile_id), ...(faculty || []).map((item) => item.profile_id)]);
      options[source] = (profiles || []).filter((item) => !used.has(item.id)).map((item) => ({ value: item.id, label: `${item.full_name || item.email} · ${item.email}` }));
      continue;
    }
    const optionSpec = optionSources[source];
    if (!optionSpec) continue;
    let optionQuery = (supabase.from(optionSpec.table) as any).select(optionSpec.select);
    if (optionSpec.activeOnly) optionQuery = optionQuery.eq("status", "active").order("name");
    const { data: optionRows, error: optionError } = await optionQuery.limit(500);
    if (optionError) {
      optionErrors[source] = source === "courses"
        ? "Courses could not be loaded. Check the server log and course table access policy."
        : "Options could not be loaded. Check the server log and database access policy.";
      console.error(`[workbench] Option query failed: ${JSON.stringify({
        source,
        table: `public.${optionSpec.table}`,
        query: `select ${optionSpec.select}${optionSpec.activeOnly ? " where status = 'active' order by name" : ""} limit 500`,
        code: optionError.code,
        message: optionError.message,
        details: optionError.details,
        hint: optionError.hint,
      })}`);
      options[source] = [];
      continue;
    }
    options[source] = (optionRows || []).map((item: Record<string, unknown>) => ({
      value: String(item[optionSpec.value]),
      label: source === "courses"
        ? `${String(item.name ?? item.id)}${item.code ? ` (${String(item.code)})` : ""}`
        : String(item[optionSpec.label] ?? item.id),
    }));
  }

  const valueLabels = Object.values(options).flat().reduce<Record<string, string>>((result, option) => {
    result[option.value] = option.label;
    return result;
  }, {});

  return {
    role, key, spec, rows, options, optionErrors, valueLabels, actorName: profile.full_name,
    error: error ? "Records could not be loaded. Check the database setup and access policy." : undefined,
  };
}
