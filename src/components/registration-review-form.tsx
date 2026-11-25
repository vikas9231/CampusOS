"use client";

import { useActionState } from "react";
import { approveRegistration, rejectRegistration, type RegistrationActionState } from "@/app/actions/registration";

const initialState: RegistrationActionState = {};

export function RegistrationReviewForm({
  requestId, requestedRole, courses, departments,
}: {
  requestId: string;
  requestedRole: "student" | "faculty";
  courses: { id: string; code: string; name: string }[];
  departments: { id: string; name: string }[];
}) {
  const [approveState, approveAction, approving] = useActionState(approveRegistration, initialState);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectRegistration, initialState);
  return <div className="registration-review">
    <form action={approveAction} className="registration-approve-form">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="requested_role" value={requestedRole} />
      {requestedRole === "student" ? <>
        <label>Enrollment number<input name="enrollment_number" required maxLength={80} /></label>
        <label>Course<select name="course_id" required defaultValue=""><option value="" disabled>Select a course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label>
        <label>Admission year<input name="admission_year" type="number" required min={1950} max={2200} defaultValue={new Date().getFullYear()} /></label>
      </> : <>
        <label>Employee number<input name="employee_number" required maxLength={80} /></label>
        <label>Department<select name="department_id" required defaultValue=""><option value="" disabled>Select a department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      </>}
      {approveState.error && <p className="notice error" role="alert">{approveState.error}</p>}
      {approveState.success && <p className="notice success" role="status">{approveState.success}</p>}
      <button className="button primary" type="submit" disabled={approving || (requestedRole === "student" ? courses.length === 0 : departments.length === 0)}>{approving ? "Approving…" : "Approve and provision"}</button>
      {requestedRole === "student" && courses.length === 0 && <small>Add an active course before approving students.</small>}
      {requestedRole === "faculty" && departments.length === 0 && <small>Add a department before approving faculty.</small>}
    </form>
    <form action={rejectAction} className="registration-reject-form">
      <input type="hidden" name="request_id" value={requestId} />
      <label>Rejection note <span className="label-hint">Optional, max 500 characters</span><input name="rejection_note" maxLength={500} /></label>
      {rejectState.error && <p className="notice error" role="alert">{rejectState.error}</p>}
      {rejectState.success && <p className="notice success" role="status">{rejectState.success}</p>}
      <button className="button secondary" type="submit" disabled={rejecting}>{rejecting ? "Rejecting…" : "Reject request"}</button>
    </form>
  </div>;
}
