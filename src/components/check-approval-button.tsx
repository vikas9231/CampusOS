"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function CheckApprovalButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button className="button secondary full" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
    {pending ? "Checking…" : "Check approval status"}
  </button>;
}
