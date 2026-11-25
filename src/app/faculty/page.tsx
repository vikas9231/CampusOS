import { Dashboard } from "@/components/dashboard";
import { requireRole } from "@/lib/auth";

export default async function FacultyDashboard() {
  const context = await requireRole("faculty");
  return <Dashboard role="faculty" context={context} />;
}
