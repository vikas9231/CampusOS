import { Dashboard } from "@/components/dashboard";
import { requireRole } from "@/lib/auth";

export default async function AdminDashboard() {
  const context = await requireRole("super_admin");
  return <Dashboard role="super_admin" context={context} />;
}
