import { PortalShell } from "@/components/portal-shell";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HodLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("hod");
  return <PortalShell context={context} role="hod">{children}</PortalShell>;
}
