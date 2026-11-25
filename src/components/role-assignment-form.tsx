"use client";

import { useActionState } from "react";
import { assignRole, type RoleActionState } from "@/app/actions/roles";

const initialState: RoleActionState = {};

export function RoleAssignmentForm({ users, departments }: { users: { id: string; full_name: string; email: string }[]; departments: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(assignRole, initialState);
  return <form action={action} className="assign-form">
    <label>College account<select name="user_id" required defaultValue=""><option value="" disabled>Select an account</option>{users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email} · {user.email}</option>)}</select></label>
    <label>Access role<select name="role" required defaultValue="student"><option value="student">Student</option><option value="faculty">Faculty</option><option value="hod">Head of Department</option><option value="super_admin">Super Admin</option></select></label>
    <label>Department <span className="label-hint">HOD only</span><select name="department_id" defaultValue=""><option value="">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
    {state.error && <p className="notice error form-message" role="alert">{state.error}</p>}{state.success && <p className="notice success form-message" role="status">{state.success}</p>}
    <button className="button primary" type="submit" disabled={pending || users.length === 0}>{pending ? "Assigning…" : "Assign role"}</button>
  </form>;
}
