import { createClient } from "@/lib/supabase/server";
import type { AuthContext } from "@/lib/auth";
import type { Role } from "@/types/auth";
import type { DashboardMetricKey, DashboardMetricValues } from "@/types/erp";

export type DashboardStat = { value: string; foot: string };
export type DashboardStats = Record<string, DashboardStat>;

const definitions: Record<Role, { key: DashboardMetricKey; label: string }[]> = {
  super_admin: [
    { key: "students", label: "Students" },
    { key: "faculty", label: "Faculty" },
    { key: "departments", label: "Departments" },
    { key: "payments", label: "Paid payments" },
  ],
  faculty: [
    { key: "classes", label: "Assigned classes" },
    { key: "students", label: "Students" },
    { key: "attendance", label: "Attendance sessions" },
    { key: "upcoming", label: "Upcoming assignments" },
  ],
  student: [
    { key: "subjects", label: "Enrolled subjects" },
    { key: "attendance", label: "Attendance" },
    { key: "semesters", label: "Active semesters" },
    { key: "fees", label: "Outstanding invoices" },
  ],
  hod: [
    { key: "students", label: "Students" },
    { key: "faculty", label: "Faculty" },
    { key: "courses", label: "Courses" },
    { key: "attendance", label: "Attendance" },
  ],
};

export function dashboardKpis(role: Role) {
  return definitions[role];
}

export async function getDashboardStats(role: Role, context: AuthContext): Promise<DashboardStats> {
  const supabase = await createClient();
  const departmentId = role === "hod"
    ? context.assignments.find((assignment) => assignment.role === "hod")?.department_id ?? null
    : null;
  const { data, error } = await supabase.rpc("get_dashboard_metrics", {
    p_role: role,
    p_department_id: departmentId,
  });

  if (error || !data || typeof data !== "object") {
    return Object.fromEntries(definitions[role].map(({ key }) => [key, { value: "—", foot: "Data unavailable" }]));
  }

  const metrics = data as DashboardMetricValues;
  return Object.fromEntries(definitions[role].map(({ key }) => {
    const rawValue = metrics[key];
    if (rawValue === null || rawValue === undefined) {
      return [key, { value: "—", foot: key === "attendance" ? "No attendance records yet" : "No records available yet" }];
    }
    const value = key === "attendance" && role !== "faculty"
      ? `${rawValue}%`
      : new Intl.NumberFormat("en").format(rawValue);
    const foot = role === "faculty" && key === "upcoming"
      ? "Open assignment deadlines"
      : key === "attendance"
        ? "Calculated from recorded sessions"
        : "Live authorized records";
    return [key, { value, foot }];
  }));
}
