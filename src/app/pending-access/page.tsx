import Link from "next/link";
import { Clock3, GraduationCap, LogOut, ShieldCheck } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { CheckApprovalButton } from "@/components/check-approval-button";
import { landingPath, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PendingAccessPage() {
  const { profile, assignments } = await requireUser();
  if (assignments.length) redirect(landingPath(assignments));
  const supabase = await createClient();
  const { data: request, error: requestError } = await supabase.from("role_requests")
    .select("requested_role, status, rejection_note, created_at, reviewed_at")
    .eq("user_id", profile.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (requestError && process.env.NODE_ENV !== "production") {
    console.error("[pending-access] Registration request lookup failed", {
      code: requestError.code, message: requestError.message, details: requestError.details, hint: requestError.hint,
    });
  }
  const rejected = request?.status === "rejected";
  const requestedRole = request?.requested_role === "faculty" ? "Faculty" : request?.requested_role === "student" ? "Student" : null;
  const statusLabel = request?.status === "pending" ? "Pending" : request?.status === "approved" ? "Approved" : rejected ? "Rejected" : null;
  return <main className="pending-page"><div className="pending-card"><Link href="/" className="brand"><span className="brand-mark"><GraduationCap size={22} /></span><span>Campus<span className="brand-light">OS</span></span></Link><div className="pending-icon"><Clock3 size={25} /></div><p className="eyebrow">{rejected ? "REGISTRATION UPDATE" : "ACCOUNT CREATED"}</p><h1>{rejected ? "Registration request declined" : "Access is being set up"}</h1>
    <p className="pending-copy">{rejected
      ? `Hi ${profile.full_name.split(/\s+/)[0] || "there"}. Your ${requestedRole || "access"} registration request was declined.${request?.rejection_note ? ` Note from the administrator: ${request.rejection_note}` : " Contact your college administrator if you need more information."}`
      : requestError
        ? "We could not load your registration request. Ask your administrator to apply the latest registration migration, then check again."
        : request?.status === "approved"
        ? "Your request was approved. Refreshing your account will open the dashboard assigned by your administrator."
        : request?.status === "pending"
          ? `Hi ${profile.full_name.split(/\s+/)[0] || "there"}. Your ${requestedRole || "access"} request is waiting for administrator review. You can check again after it has been reviewed.`
          : "Hi there. Your account is secure, but it does not have a college role yet. Ask your administrator to review your access."}</p>
    {statusLabel && <div className={`request-status ${request?.status}`}>{statusLabel}</div>}
    {requestedRole && <div className="pending-details"><ShieldCheck size={17} /><span>Requested access: {requestedRole}</span></div>}
    <div className="pending-actions"><CheckApprovalButton /><form action={signOut}><button className="button secondary full" type="submit"><LogOut size={16} /> Sign out</button></form></div>
  </div></main>;
}
