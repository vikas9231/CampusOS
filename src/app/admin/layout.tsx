import { PortalShell } from "@/components/portal-shell";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await requireRole("super_admin");
  return <PortalShell context={context} role="super_admin">{children}</PortalShell>;
}
