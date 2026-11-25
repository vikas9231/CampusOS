import { Dashboard } from "@/components/dashboard";
import { requireRole } from "@/lib/auth";

export default async function HodDashboard() {
  const context = await requireRole("hod");
  return <Dashboard role="hod" context={context} />;
}
