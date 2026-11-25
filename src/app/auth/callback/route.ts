import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next") || "/dashboard";
  let next = "/dashboard";
  try {
    const candidate = new URL(nextParam, requestUrl.origin);
    if (candidate.origin === requestUrl.origin) next = `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    // Keep the safe dashboard fallback for malformed redirect parameters.
  }
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, requestUrl.origin));
  }
  return NextResponse.redirect(new URL("/login?error=auth-callback", requestUrl.origin));
}
