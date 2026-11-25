import { PortalShell } from "@/components/portal-shell";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("student");
  return <PortalShell context={context} role="student">{children}</PortalShell>;
}
