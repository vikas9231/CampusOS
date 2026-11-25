export type AcademicStatus = "planned" | "active" | "completed" | "closed";

export type DepartmentRow = {
  id: string;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type CourseRow = {
  id: string;
  department_id: string;
  code: string;
  name: string;
  duration_years: number;
  status: "active" | "inactive" | "archived";
};

export type StudentRow = {
  id: string;
  profile_id: string;
  enrollment_number: string;
  course_id: string;
  admission_year: number;
  status: "active" | "graduated" | "suspended" | "withdrawn";
};

export type FacultyRow = {
  id: string;
  profile_id: string;
  employee_number: string;
  department_id: string;
  status: "active" | "on_leave" | "inactive";
};

export type DashboardMetricKey =
  | "students"
  | "faculty"
  | "departments"
  | "payments"
  | "classes"
  | "attendance"
  | "upcoming"
  | "subjects"
  | "semesters"
  | "fees"
  | "courses";

export type DashboardMetricValues = Partial<Record<DashboardMetricKey, number | null>>;
