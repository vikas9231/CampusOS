import { ShieldCheck, UserRoundPlus } from "lucide-react";
import { removeRole } from "@/app/actions/roles";
import { RegistrationReviewForm } from "@/components/registration-review-form";
import { RoleAssignmentForm } from "@/components/role-assignment-form";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/types/auth";

type AssignmentRow = { id: string; role: Role; department_id: string | null; departments: { name: string } | null };
type UserRow = { id: string; full_name: string; email: string; role_assignments: AssignmentRow[] };
type RawAssignmentRow = { id: string; user_id: string; role: Role; department_id: string | null };
type RegistrationRequestRow = {
  id: string; user_id: string; requested_role: "student" | "faculty";
  status: "pending" | "approved" | "rejected"; rejection_note: string | null;
  created_at: string; reviewed_at: string | null;
};
const labels: Record<Role, string> = { super_admin: "Super Admin", faculty: "Faculty", student: "Student", hod: "Head of Department" };

function getSupabaseHost() {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
  } catch {
    return "invalid-url";
  }
}

function logQueryError(
  area: string,
  table: string,
  query: string,
  error: unknown,
) {
  if (!error) return;
  const source = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const errorIsNative = error instanceof Error;
  const diagnostic = {
    area,
    table,
    query,
    supabase: {
      configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      projectHost: getSupabaseHost(),
      serviceRoleKeyConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    error: {
      name: errorIsNative ? error.name : typeof source.name === "string" ? source.name : error?.constructor?.name || "SupabaseError",
      message: errorIsNative ? error.message : typeof source.message === "string" ? source.message : String(error),
      code: source.code ?? null,
      details: source.details ?? null,
      hint: source.hint ?? null,
      stack: errorIsNative && error.stack ? error.stack : typeof source.stack === "string" ? source.stack : null,
      cause: errorIsNative && error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message }
        : null,
      ownPropertyNames: error && typeof error === "object" ? Object.getOwnPropertyNames(error) : [],
    },
  };
  // A JSON string is intentional: Next's dev overlay can render Supabase Error objects as {}.
  console.error(`[admin/access] Supabase query failed: ${JSON.stringify(diagnostic)}`);
}

export default async function AccessManagementPage({ searchParams }: { searchParams?: Promise<{ status?: string; q?: string }> }) {
  const admin = await requireRole("super_admin");
  const supabase = await createClient();
  const filters = await searchParams;
  const statusFilter = ["pending", "approved", "rejected"].includes(filters?.status || "") ? filters!.status! : "all";
  const search = (filters?.q || "").trim().toLowerCase();
  const [{ data: profiles, error: profilesError }, { data: rawAssignments, error: assignmentsError }, { data: departments, error: departmentsError }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
    supabase.from("role_assignments").select("id, user_id, role, department_id").order("created_at"),
    supabase.from("departments").select("id, name").order("name"),
  ]);
  // Keep request retrieval independent from PostgREST relationship embedding. Applicant
  // profiles are joined in memory, so a stale schema relationship cache cannot hide requests.
  const requestQueryDescription = `select id,user_id,requested_role,status,rejection_note,created_at,reviewed_at from public.role_requests${statusFilter === "all" ? "" : ` where status = '${statusFilter}'`} order by created_at desc`;
  let requestQuery = supabase.from("role_requests").select("id, user_id, requested_role, status, rejection_note, created_at, reviewed_at").order("created_at", { ascending: false });
  if (statusFilter !== "all") requestQuery = requestQuery.eq("status", statusFilter);
  const { data: requestData, error: requestsError } = await requestQuery;
  logQueryError("registration requests", "public.role_requests", requestQueryDescription, requestsError);
  logQueryError("profiles", "public.profiles", "select id,full_name,email order by full_name", profilesError);
  logQueryError("role assignments", "public.role_assignments", "select id,user_id,role,department_id order by created_at", assignmentsError);
  logQueryError("departments", "public.departments", "select id,name order by name", departmentsError);
  const departmentRows = (departments || []) as { id: string; name: string }[];
  const departmentsById = new Map(departmentRows.map((department) => [department.id, department]));
  const assignmentsByUser = new Map<string, AssignmentRow[]>();
  for (const assignment of (rawAssignments || []) as RawAssignmentRow[]) {
    const userAssignments = assignmentsByUser.get(assignment.user_id) || [];
    userAssignments.push({
      id: assignment.id,
      role: assignment.role,
      department_id: assignment.department_id,
      departments: assignment.department_id ? departmentsById.get(assignment.department_id) || null : null,
    });
    assignmentsByUser.set(assignment.user_id, userAssignments);
  }
  const users = ((profiles || []) as { id: string; full_name: string; email: string }[]).map((profile) => ({
    ...profile,
    role_assignments: assignmentsByUser.get(profile.id) || [],
  }));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const requests = ((requestData || []) as unknown as RegistrationRequestRow[]).filter((request) => {
    const user = usersById.get(request.user_id);
    return !search || `${user?.full_name || ""} ${user?.email || ""}`.toLowerCase().includes(search);
  });
  const { data: courses, error: coursesError } = await supabase.from("courses").select("id, code, name").eq("status", "active").order("name");
  logQueryError("active courses", "public.courses", "select id,code,name where status=active order by name", coursesError);
  const courseRows = (courses || []) as { id: string; code: string; name: string }[];
  const requestDepartmentRows = departmentRows;
  const roleCount = users.reduce((count, user) => count + (user.role_assignments?.length || 0), 0);

  return <>
    <div className="welcome-row"><div><p className="eyebrow">COLLEGE SETTINGS</p><h1>People &amp; access</h1><p className="page-subtitle">Provision accounts and assign role-based workspace access.</p></div><div className="today-pill"><ShieldCheck size={16} /> Administrator only</div></div>
    <section className="panel directory-panel registration-requests-panel">
      <div className="panel-heading"><div><h2>Registration requests</h2><p>Review student and faculty access requests. Approval provisions the academic record and role together.</p></div><span className="section-count">{requestsError ? "Unavailable" : `${requests.length} requests`}</span></div>
      <form method="get" className="registration-filters"><label>Search name or email<input name="q" defaultValue={filters?.q || ""} placeholder="Search registered account" /></label><label>Status<select name="status" defaultValue={statusFilter}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><button className="button secondary" type="submit">Filter</button></form>
      {requestsError ? <div className="inline-empty">{requestsError.code === "PGRST205" || requestsError.code === "42P01" ? "Registration request storage is not available. Apply the registration approval migration, then refresh." : "Registration requests could not be loaded. Check the server log for the Supabase error."}</div> : profilesError ? <div className="inline-empty">Applicant profiles could not be loaded. Check the server log for the Supabase error.</div> : requests.length === 0 ? <div className="inline-empty">No registration requests match these filters.</div> : <div className="registration-request-list">{requests.map((request) => {
        const applicant = usersById.get(request.user_id);
        return <article className="registration-request" key={request.id}>
          <div className="registration-request-heading"><div className="directory-user"><span className="user-avatar">{applicant?.full_name?.trim().charAt(0).toUpperCase() || "U"}</span><span><strong>{applicant?.full_name || "Name not provided"}</strong><small>{applicant?.email || "Email unavailable"}</small></span></div><div className="registration-request-meta"><span className={`request-status ${request.status}`}>{request.status}</span><span>{request.requested_role === "student" ? "Student" : "Faculty"}</span><small>Submitted {new Date(request.created_at).toLocaleDateString()}</small></div></div>
          {request.status === "pending" && request.user_id !== admin.profile.id ? <RegistrationReviewForm requestId={request.id} requestedRole={request.requested_role} courses={courseRows} departments={requestDepartmentRows} /> : request.status === "pending" ? <div className="registration-review-result">You cannot review your own registration request.</div> : <div className="registration-review-result">{request.status === "rejected" && request.rejection_note && <p>Rejection note: {request.rejection_note}</p>}{request.reviewed_at && <small>Reviewed {new Date(request.reviewed_at).toLocaleDateString()}</small>}</div>}
        </article>;
      })}</div>}
    </section>
    <div className="access-grid"><section className="panel access-panel"><div className="panel-heading"><div><h2>Assign a role</h2><p>For existing accounts or additional role changes.</p></div><span className="quick-icon blue"><UserRoundPlus size={18} /></span></div>{profilesError || assignmentsError ? <div className="inline-empty">Account or role data could not be loaded. Check the server log.</div> : users.length === 0 ? <div className="inline-empty">No accounts found. Ask users to sign up first.</div> : <RoleAssignmentForm users={users} departments={departmentRows} />}</section><section className="panel access-summary"><p className="eyebrow">ACCESS DIRECTORY</p><div className="summary-number">{profilesError ? "—" : users.length}</div><div className="summary-label">registered accounts</div><div className="summary-divider"/><div className="summary-number small">{assignmentsError ? "—" : roleCount}</div><div className="summary-label">active role assignments</div><p className="summary-note">Accounts without a role can sign in but remain outside protected dashboards.</p></section></div>
    <section className="panel directory-panel"><div className="panel-heading"><div><h2>Account directory</h2><p>Role assignments control access to protected dashboards.</p></div><span className="section-count">{profilesError ? "Unavailable" : `${users.length} accounts`}</span></div>{profilesError || assignmentsError ? <div className="inline-empty">{profilesError ? "Account profiles could not be loaded." : "Role assignments could not be loaded."} Check the server log for the Supabase error.</div> : <div className="directory-table-wrap"><table className="directory-table"><thead><tr><th>Account</th><th>Assigned access</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="directory-user"><span className="user-avatar">{user.full_name.trim().charAt(0).toUpperCase() || "U"}</span><span><strong>{user.full_name || "Name not provided"}</strong><small>{user.email}</small></span></div></td><td>{user.role_assignments?.length ? <div className="role-list">{user.role_assignments.map((assignment) => <span className="role-pill" key={assignment.id}><span>{labels[assignment.role]}{assignment.role === "hod" && assignment.departments?.name ? ` · ${assignment.departments.name}` : ""}</span><form action={removeRole.bind(null, assignment.id)}><button type="submit" aria-label={`Remove ${labels[assignment.role]} from ${user.full_name}`} title="Remove role">×</button></form></span>)}</div> : <span className="no-role">Pending role assignment</span>}</td></tr>)}</tbody></table></div>}</section>
  </>;
}
