import { notFound } from "next/navigation";
import { Workbench } from "@/components/workbench";
import { loadWorkbenchData } from "@/lib/workbench-data";

export const dynamic = "force-dynamic";

export default async function FacultyModulePage({ params }: { params: Promise<{ module: string[] }> }) {
  const { module } = await params;
  const data = await loadWorkbenchData("faculty", module);
  if (!data) notFound();
  return <Workbench data={data} />;
}
