import { Dashboard } from "@/components/dashboard";
import { requireRole } from "@/lib/auth";

export default async function StudentDashboard() {
  const context = await requireRole("student");
  return <Dashboard role="student" context={context} />;
}
