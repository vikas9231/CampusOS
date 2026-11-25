import { PortalShell } from "@/components/portal-shell";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function FacultyLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("faculty");
  return <PortalShell context={context} role="faculty">{children}</PortalShell>;
}
