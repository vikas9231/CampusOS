import type { Role } from "@/types/auth";

export type FieldOption = { value: string; label: string };
export type WorkbenchField = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "time" | "select" | "textarea";
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
  options?: string;
  create?: boolean;
  update?: boolean;
};

export type WorkbenchSpec = {
  title: string;
  description: string;
  table: string;
  select: string;
  columns: { key: string; label: string }[];
  fields: WorkbenchField[];
  orderBy?: string;
  actorField?: string;
  ownStudent?: boolean;
  createRpc?: string;
};

const fields = (items: WorkbenchField[]) => items;
const commonStatus: WorkbenchField = { name: "status", label: "Status", type: "select", options: "status" };

const admin: Record<string, WorkbenchSpec> = {
  departments: {
    title: "Departments", description: "Create and maintain college departments.", table: "departments", select: "id,code,name,created_at", orderBy: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Department" }],
    fields: fields([{ name: "code", label: "Department code", required: true }, { name: "name", label: "Department name", required: true }]),
  },
  courses: {
    title: "Courses", description: "Manage degree programs and their department ownership.", table: "courses", select: "id,code,name,department_id,duration_years,status", orderBy: "name",
    columns: [{ key: "code", label: "Code" }, { key: "name", label: "Course" }, { key: "department_id", label: "Department" }, { key: "duration_years", label: "Years" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "department_id", label: "Department", type: "select", options: "departments", required: true }, { name: "code", label: "Course code", required: true }, { name: "name", label: "Course name", required: true }, { name: "duration_years", label: "Duration (years)", type: "number", min: 1, max: 10, required: true }, { ...commonStatus, options: "courseStatus" }]),
  },
  years: {
    title: "Academic years", description: "Set academic-year dates and active state.", table: "academic_years", select: "id,name,starts_on,ends_on,status", orderBy: "starts_on",
    columns: [{ key: "name", label: "Academic year" }, { key: "starts_on", label: "Starts" }, { key: "ends_on", label: "Ends" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "name", label: "Name (for example 2026-2027)", required: true }, { name: "starts_on", label: "Start date", type: "date", required: true }, { name: "ends_on", label: "End date", type: "date", required: true }, { ...commonStatus, options: "yearStatus" }]),
  },
  semesters: {
    title: "Semesters", description: "Create course-specific semester periods.", table: "semesters", select: "id,course_id,academic_year_id,semester_number,status,starts_on,ends_on", orderBy: "semester_number",
    columns: [{ key: "course_id", label: "Course" }, { key: "academic_year_id", label: "Academic year" }, { key: "semester_number", label: "Semester" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "course_id", label: "Course", type: "select", options: "courses", required: true }, { name: "academic_year_id", label: "Academic year", type: "select", options: "years", required: true }, { name: "semester_number", label: "Semester number", type: "number", min: 1, max: 20, required: true }, { name: "starts_on", label: "Start date", type: "date" }, { name: "ends_on", label: "End date", type: "date" }, { ...commonStatus, options: "semesterStatus" }]),
  },
  subjects: {
    title: "Subjects", description: "Maintain subjects, credits, and semester placement.", table: "subjects", select: "id,course_id,code,title,credits,semester_number,status", orderBy: "title",
    columns: [{ key: "course_id", label: "Course" }, { key: "code", label: "Code" }, { key: "title", label: "Subject" }, { key: "credits", label: "Credits" }, { key: "semester_number", label: "Semester" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "course_id", label: "Course", type: "select", options: "courses", required: true }, { name: "code", label: "Subject code", required: true }, { name: "title", label: "Title", required: true }, { name: "credits", label: "Credits", type: "number", min: 0, step: "0.5", required: true }, { name: "semester_number", label: "Semester number", type: "number", min: 1, max: 20, required: true }, { ...commonStatus, options: "activeStatus" }]),
  },
  students: {
    title: "Students", description: "Create student records for registered accounts and assign enrollment details.", table: "students", select: "id,profile_id,enrollment_number,course_id,admission_year,status", orderBy: "enrollment_number", createRpc: "admin_create_student",
    columns: [{ key: "profile_id", label: "Account" }, { key: "enrollment_number", label: "Enrollment no." }, { key: "course_id", label: "Course" }, { key: "admission_year", label: "Admission year" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "profile_id", label: "Registered account", type: "select", options: "unassignedProfiles", required: true, update: false }, { name: "enrollment_number", label: "Enrollment number", required: true }, { name: "course_id", label: "Course", type: "select", options: "courses", required: true }, { name: "admission_year", label: "Admission year", type: "number", min: 1950, max: 2200, required: true }, { ...commonStatus, options: "studentStatus" }]),
  },
  faculty: {
    title: "Faculty", description: "Create staff records for registered accounts and assign departments.", table: "faculty", select: "id,profile_id,employee_number,department_id,status", orderBy: "employee_number", createRpc: "admin_create_faculty",
    columns: [{ key: "profile_id", label: "Account" }, { key: "employee_number", label: "Employee no." }, { key: "department_id", label: "Department" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "profile_id", label: "Registered account", type: "select", options: "unassignedProfiles", required: true, update: false }, { name: "employee_number", label: "Employee number", required: true }, { name: "department_id", label: "Department", type: "select", options: "departments", required: true }, { ...commonStatus, options: "facultyStatus" }]),
  },
  offerings: {
    title: "Course offerings", description: "Assign a teacher and section for each course semester.", table: "course_offerings", select: "id,subject_id,semester_id,faculty_id,section,capacity,status", orderBy: "created_at",
    columns: [{ key: "subject_id", label: "Subject" }, { key: "semester_id", label: "Semester" }, { key: "faculty_id", label: "Faculty" }, { key: "section", label: "Section" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "subject_id", label: "Subject", type: "select", options: "subjects", required: true }, { name: "semester_id", label: "Semester", type: "select", options: "semesters", required: true }, { name: "faculty_id", label: "Faculty member", type: "select", options: "faculty", required: true }, { name: "section", label: "Section", required: true }, { name: "capacity", label: "Capacity", type: "number", min: 1 }, { ...commonStatus, options: "offeringStatus" }]),
  },
  enrollments: {
    title: "Enrollments", description: "Enroll students into offerings that belong to their degree course.", table: "enrollments", select: "id,student_id,course_offering_id,status,enrolled_at", orderBy: "enrolled_at",
    columns: [{ key: "student_id", label: "Student" }, { key: "course_offering_id", label: "Course offering" }, { key: "status", label: "Status" }, { key: "enrolled_at", label: "Enrolled" }],
    fields: fields([{ name: "student_id", label: "Student", type: "select", options: "students", required: true }, { name: "course_offering_id", label: "Course offering", type: "select", options: "offerings", required: true }, { ...commonStatus, options: "enrollmentStatus" }]),
  },
  examinations: {
    title: "Examinations", description: "Schedule examination windows and publish completed exams.", table: "examinations", select: "id,semester_id,title,exam_type,starts_on,ends_on,status", orderBy: "starts_on",
    columns: [{ key: "title", label: "Exam" }, { key: "semester_id", label: "Semester" }, { key: "exam_type", label: "Type" }, { key: "starts_on", label: "Starts" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "semester_id", label: "Semester", type: "select", options: "semesters", required: true }, { name: "title", label: "Examination name", required: true }, { name: "exam_type", label: "Type", type: "select", options: "examTypes", required: true }, { name: "starts_on", label: "Start date", type: "date" }, { name: "ends_on", label: "End date", type: "date" }, { ...commonStatus, options: "examStatus" }]),
  },
  attendance: {
    title: "Attendance sessions", description: "Review recorded attendance sessions.", table: "attendance_sessions", select: "id,course_offering_id,session_date,session_label,created_by,created_at", orderBy: "session_date",
    columns: [{ key: "course_offering_id", label: "Offering" }, { key: "session_date", label: "Date" }, { key: "session_label", label: "Session" }, { key: "created_by", label: "Marked by" }], fields: [],
  },
  examSubjects: {
    title: "Exam papers", description: "Add subject offerings and maximum marks to an exam.", table: "exam_subjects", select: "id,examination_id,course_offering_id,exam_date,max_marks", orderBy: "exam_date",
    columns: [{ key: "examination_id", label: "Examination" }, { key: "course_offering_id", label: "Offering" }, { key: "exam_date", label: "Date" }, { key: "max_marks", label: "Maximum marks" }],
    fields: fields([{ name: "examination_id", label: "Examination", type: "select", options: "examinations", required: true }, { name: "course_offering_id", label: "Offering", type: "select", options: "offerings", required: true }, { name: "exam_date", label: "Exam date", type: "date" }, { name: "max_marks", label: "Maximum marks", type: "number", min: 1, step: "0.01", required: true }]),
  },
  marks: {
    title: "Results & marks", description: "Enter and publish marks for enrolled students.", table: "marks", select: "id,exam_subject_id,enrollment_id,score,status,published_at", orderBy: "updated_at", actorField: "entered_by",
    columns: [{ key: "exam_subject_id", label: "Exam paper" }, { key: "enrollment_id", label: "Enrollment" }, { key: "score", label: "Score" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "exam_subject_id", label: "Exam paper", type: "select", options: "examSubjects", required: true }, { name: "enrollment_id", label: "Student enrollment", type: "select", options: "enrollments", required: true }, { name: "score", label: "Score", type: "number", min: 0, step: "0.01", required: true }, { name: "status", label: "Publication", type: "select", options: "markStatus" }]),
  },
  assignments: {
    title: "Assignments", description: "Create coursework and set due dates and grading limits.", table: "assignments", select: "id,course_offering_id,title,due_at,max_marks,published_at", orderBy: "due_at", actorField: "created_by",
    columns: [{ key: "course_offering_id", label: "Offering" }, { key: "title", label: "Assignment" }, { key: "due_at", label: "Due" }, { key: "max_marks", label: "Max marks" }, { key: "published_at", label: "Published" }],
    fields: fields([{ name: "course_offering_id", label: "Course offering", type: "select", options: "offerings", required: true }, { name: "title", label: "Title", required: true }, { name: "description", label: "Instructions", type: "textarea" }, { name: "due_at", label: "Deadline", type: "datetime-local", required: true }, { name: "max_marks", label: "Maximum marks", type: "number", min: 1, step: "0.01", required: true }, { name: "published_at", label: "Publish now", type: "datetime-local" }]),
  },
  submissions: {
    title: "Assignment submissions", description: "Review submissions and provide grades and feedback.", table: "submissions", select: "id,assignment_id,student_id,submitted_at,grade,feedback,graded_at", orderBy: "submitted_at", actorField: "graded_by",
    columns: [{ key: "assignment_id", label: "Assignment" }, { key: "student_id", label: "Student" }, { key: "submitted_at", label: "Submitted" }, { key: "grade", label: "Grade" }, { key: "feedback", label: "Feedback" }],
    fields: fields([{ name: "grade", label: "Grade", type: "number", min: 0, step: "0.01" }, { name: "feedback", label: "Feedback", type: "textarea" }]),
  },
  fees: {
    title: "Fee items", description: "Define fee charges for courses and academic years.", table: "fee_items", select: "id,course_id,academic_year_id,label,amount,currency,due_on", orderBy: "due_on",
    columns: [{ key: "label", label: "Fee item" }, { key: "course_id", label: "Course" }, { key: "academic_year_id", label: "Academic year" }, { key: "amount", label: "Amount" }, { key: "currency", label: "Currency" }, { key: "due_on", label: "Due date" }],
    fields: fields([{ name: "course_id", label: "Course", type: "select", options: "courses", required: true }, { name: "academic_year_id", label: "Academic year", type: "select", options: "years" }, { name: "label", label: "Fee description", required: true }, { name: "amount", label: "Amount", type: "number", min: 0, step: "0.01", required: true }, { name: "currency", label: "Currency (ISO 4217)", required: true }, { name: "due_on", label: "Due date", type: "date" }]),
  },
  invoices: {
    title: "Student invoices", description: "Issue student fee invoices. Payment settlement requires a configured payment provider.", table: "student_invoices", select: "id,invoice_number,student_id,academic_year_id,total_amount,currency,due_on,status", orderBy: "due_on",
    columns: [{ key: "invoice_number", label: "Invoice" }, { key: "student_id", label: "Student" }, { key: "total_amount", label: "Total" }, { key: "currency", label: "Currency" }, { key: "due_on", label: "Due" }, { key: "status", label: "Status" }],
    fields: fields([{ name: "student_id", label: "Student", type: "select", options: "students", required: true }, { name: "academic_year_id", label: "Academic year", type: "select", options: "years", required: true }, { name: "invoice_number", label: "Invoice number", required: true }, { name: "total_amount", label: "Total amount", type: "number", min: 0, step: "0.01", required: true }, { name: "currency", label: "Currency", required: true }, { name: "due_on", label: "Due date", type: "date" }]),
  },
  payments: {
    title: "Payment history", description: "Review payment records. Payment status is updated by a verified provider callback.", table: "payments", select: "id,invoice_id,amount,currency,provider,status,paid_at,created_at", orderBy: "created_at",
    columns: [{ key: "invoice_id", label: "Invoice" }, { key: "amount", label: "Amount" }, { key: "currency", label: "Currency" }, { key: "provider", label: "Provider" }, { key: "status", label: "Status" }, { key: "paid_at", label: "Paid at" }], fields: [],
  },
  timetable: {
    title: "Timetable", description: "Schedule course offerings. Database constraints reject room or faculty conflicts.", table: "timetable_slots", select: "id,course_offering_id,faculty_id,room_id,weekday,starts_at,ends_at", orderBy: "weekday",
    columns: [{ key: "course_offering_id", label: "Offering" }, { key: "faculty_id", label: "Faculty" }, { key: "room_id", label: "Room" }, { key: "weekday", label: "Weekday" }, { key: "starts_at", label: "From" }, { key: "ends_at", label: "To" }],
    fields: fields([{ name: "course_offering_id", label: "Offering", type: "select", options: "offerings", required: true }, { name: "faculty_id", label: "Faculty", type: "select", options: "faculty", required: true }, { name: "room_id", label: "Room", type: "select", options: "rooms", required: true }, { name: "weekday", label: "Weekday (1 Mon - 7 Sun)", type: "number", min: 1, max: 7, required: true }, { name: "starts_at", label: "Starts", type: "time", required: true }, { name: "ends_at", label: "Ends", type: "time", required: true }]),
  },
  notices: {
    title: "Notices", description: "Publish college-wide notices. Targeted notice workflows can be added by selecting a role or department.", table: "notices", select: "id,title,body,published_at,expires_at,created_at", orderBy: "created_at", actorField: "author_id",
    columns: [{ key: "title", label: "Title" }, { key: "body", label: "Notice" }, { key: "published_at", label: "Published" }, { key: "expires_at", label: "Expires" }],
    fields: fields([{ name: "title", label: "Title", required: true }, { name: "body", label: "Message", type: "textarea", required: true }, { name: "published_at", label: "Publish at", type: "datetime-local" }, { name: "expires_at", label: "Expires at", type: "datetime-local" }]),
  },
  complaints: {
    title: "Complaints & support", description: "Track student requests and department responses.", table: "complaints", select: "id,student_id,category,subject,description,status,assigned_to,resolution,created_at", orderBy: "created_at",
    columns: [{ key: "category", label: "Category" }, { key: "subject", label: "Subject" }, { key: "description", label: "Request" }, { key: "status", label: "Status" }, { key: "resolution", label: "Resolution" }],
    fields: fields([{ name: "student_id", label: "Student", type: "select", options: "students", create: false, update: false }, { name: "category", label: "Category", required: true }, { name: "subject", label: "Subject", required: true }, { name: "description", label: "Details", type: "textarea", required: true }, { name: "status", label: "Status", type: "select", options: "complaintStatus", create: false }, { name: "resolution", label: "Resolution", type: "textarea", create: false }]),
  },
  reports: { title: "Academic reports", description: "Review assessment outcomes available to your account.", table: "marks", select: "id,exam_subject_id,enrollment_id,score,status,published_at", orderBy: "updated_at", columns: [{ key: "exam_subject_id", label: "Exam paper" }, { key: "enrollment_id", label: "Enrollment" }, { key: "score", label: "Score" }, { key: "status", label: "Status" }], fields: [] },
};

const faculty: Record<string, WorkbenchSpec> = {
  classes: { ...admin.offerings, title: "My classes", description: "Your assigned course offerings and teaching groups.", fields: [] },
  assignments: admin.assignments,
  submissions: admin.submissions,
  results: { ...admin.marks, title: "My class results", fields: [] },
  timetable: { ...admin.timetable, fields: [] },
  notices: { ...admin.notices, fields: [] },
};

const student: Record<string, WorkbenchSpec> = {
  courses: { ...admin.enrollments, title: "My courses", description: "Subjects you are currently enrolled in.", fields: [] },
  assignments: { ...admin.assignments, title: "Assignments", description: "Published coursework and your submission status.", fields: [] },
  results: { ...admin.marks, title: "My results", description: "Published marks for your examinations.", fields: [] },
  fees: { ...admin.invoices, title: "My fees", description: "Your invoices and payment status.", fields: [] },
  notices: { ...admin.notices, fields: [] },
  complaints: { ...admin.complaints, ownStudent: true, fields: [{ name: "category", label: "Category", required: true }, { name: "subject", label: "Subject", required: true }, { name: "description", label: "Details", type: "textarea", required: true }] },
  timetable: { ...admin.timetable, fields: [] },
};

const hod: Record<string, WorkbenchSpec> = {
  students: { ...admin.students, title: "Department students", description: "Students in your assigned department.", fields: [] },
  faculty: { ...admin.faculty, title: "Department faculty", description: "Faculty in your assigned department.", fields: [] },
  academics: { ...admin.offerings, title: "Department courses", description: "Course offerings available in your department.", fields: [] },
  complaints: { ...admin.complaints, title: "Student requests", description: "Review and resolve requests from students in your department.", fields: [{ name: "status", label: "Status", type: "select", options: "complaintStatus" }, { name: "resolution", label: "Resolution", type: "textarea" }] },
  attendance: { ...admin.attendance, title: "Department attendance", fields: [] },
  reports: { ...admin.marks, title: "Department results", description: "Published results in your department.", fields: [] },
};

const byRole: Record<Role, Record<string, WorkbenchSpec>> = {
  super_admin: { ...admin, attendance: { title: "Attendance sessions", description: "Review attendance sessions recorded across the college.", table: "attendance_sessions", select: "id,course_offering_id,session_date,session_label,created_by,created_at", columns: [{ key: "course_offering_id", label: "Offering" }, { key: "session_date", label: "Date" }, { key: "session_label", label: "Session" }, { key: "created_by", label: "Marked by" }], fields: [] } },
  faculty: { ...faculty, attendance: { ...admin.attendance, title: "Attendance", description: "Create attendance sessions for your assigned classes.", actorField: "created_by", fields: [{ name: "course_offering_id", label: "Course offering", type: "select", options: "offerings", required: true }, { name: "session_date", label: "Session date", type: "date", required: true }, { name: "session_label", label: "Session label" }] } },
  student: { ...student, attendance: { title: "My attendance", description: "Your attendance record across enrolled subjects.", table: "attendance_records", select: "id,status,marked_at,enrollment_id,session_id", columns: [{ key: "session_id", label: "Session" }, { key: "status", label: "Status" }, { key: "marked_at", label: "Recorded at" }], fields: [] } },
  hod,
};

export function getWorkbenchSpec(role: Role, key: string) {
  return byRole[role][key] ?? null;
}

export function availableWorkbenchKeys(role: Role) {
  return Object.keys(byRole[role]);
}

export function optionChoices(name: string): FieldOption[] {
  const statuses: Record<string, string[]> = {
    status: [], courseStatus: ["active", "inactive", "archived"], yearStatus: ["planned", "active", "closed"],
    semesterStatus: ["planned", "active", "completed"], activeStatus: ["active", "inactive"], studentStatus: ["active", "graduated", "suspended", "withdrawn"],
    facultyStatus: ["active", "on_leave", "inactive"], offeringStatus: ["active", "completed", "cancelled"], enrollmentStatus: ["enrolled", "dropped", "completed"],
    examTypes: ["internal", "midterm", "final", "practical", "other"], examStatus: ["draft", "scheduled", "completed", "published"],
    markStatus: ["draft", "published"], invoiceStatus: ["pending", "partially_paid", "paid", "void", "overdue"], complaintStatus: ["open", "in_review", "resolved", "closed"],
  };
  return (statuses[name] || []).map((value) => ({ value, label: value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) }));
}
