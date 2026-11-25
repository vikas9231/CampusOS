import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext, getAuthContextForUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Role } from "@/types/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const roleSchema = z.enum(["super_admin", "faculty", "student", "hod"]);
const postSchema = z.object({ role: roleSchema, message: z.string().trim().min(2).max(4000), threadId: z.string().uuid().optional() });
const clearSchema = z.object({ role: roleSchema, threadId: z.string().uuid() });

async function actor(role: Role, supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const context = await getAuthContextForUser(user, supabase);
  return context.assignments.some((assignment) => assignment.role === role) ? context : null;
}

function logQueryError(operation: string, table: string, role: Role, error: { code?: string; message?: string; details?: string; hint?: string } | null) {
  if (!error) return;
  console.error("[assistant/chat] Supabase query failed", {
    operation,
    table,
    contextRole: role,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

function unavailable() {
  return NextResponse.json({ error: "AI service configuration is missing. Set RAG_SERVICE_URL and RAG_SERVICE_TOKEN in .env.local, then restart Next.js." }, { status: 503 });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("health") === "1") {
    if (!process.env.RAG_SERVICE_URL || !process.env.RAG_SERVICE_TOKEN) return NextResponse.json({ status: "unavailable", error: "AI service configuration is missing. Set RAG_SERVICE_URL and RAG_SERVICE_TOKEN in .env.local, then restart Next.js." }, { status: 503 });
    const context = await getAuthContext();
    if (!context) return NextResponse.json({ status: "unavailable", error: "Sign in to continue." }, { status: 401 });
    if (!context.assignments.some(({ role }) => ["super_admin", "faculty", "student", "hod"].includes(role))) return NextResponse.json({ status: "unavailable", error: "Assistant access is not assigned." }, { status: 403 });
    const healthClient = await createClient();
    const { data: { session } } = await healthClient.auth.getSession();
    if (!session?.access_token) return NextResponse.json({ status: "unavailable", error: "Your session expired. Sign in again." }, { status: 401 });
    try {
      const response = await fetch(`${process.env.RAG_SERVICE_URL.replace(/\/$/, "")}/health`, {
        headers: { "X-Internal-Token": process.env.RAG_SERVICE_TOKEN, Authorization: `Bearer ${session.access_token}` },
        cache: "no-store", signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return NextResponse.json({ status: "unavailable", error: "The assistant service is unhealthy." }, { status: 503 });
      return NextResponse.json({ status: "ok" });
    } catch { return NextResponse.json({ status: "unavailable", error: "The assistant service could not be reached." }, { status: 503 }); }
  }
  const role = roleSchema.safeParse(request.nextUrl.searchParams.get("role"));
  if (!role.success) return NextResponse.json({ error: "Choose a valid workspace." }, { status: 400 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  const supabase = await createClient();
  const context = await actor(role.data, supabase);
  if (!context) return NextResponse.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const threadId = request.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    const { data, error } = await supabase.from("chat_threads").select("id,context_role,created_at,updated_at").eq("owner_id", context.profile.id).eq("context_role", role.data).order("updated_at", { ascending: false }).limit(30);
    if (error) { logQueryError("select history", "chat_threads", role.data, error); return NextResponse.json({ error: "Chat history could not be loaded." }, { status: 500 }); }
    return NextResponse.json({ threads: data || [], messages: [] });
  }
  const parsedId = z.string().uuid().safeParse(threadId);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid chat thread." }, { status: 400 });
  const { data: thread, error: threadError } = await supabase.from("chat_threads").select("id,context_role,created_at,updated_at").eq("id", parsedId.data).eq("owner_id", context.profile.id).eq("context_role", role.data).maybeSingle();
  if (threadError) logQueryError("select thread", "chat_threads", role.data, threadError);
  if (!thread) return NextResponse.json({ error: "Chat thread not found." }, { status: 404 });
  const { data: messages, error } = await supabase.from("chat_messages").select("id,message_role,content,citations,source_types,created_at").eq("thread_id", thread.id).order("created_at").limit(100);
  if (error) { logQueryError("select messages", "chat_messages", role.data, error); return NextResponse.json({ error: "Chat messages could not be loaded." }, { status: 500 }); }
  return NextResponse.json({ thread, messages: messages || [] });
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try { json = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Enter a question between 2 and 4,000 characters." }, { status: 400 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  if (!process.env.RAG_SERVICE_URL || !process.env.RAG_SERVICE_TOKEN) return unavailable();
  const supabase = await createClient();
  const context = await actor(parsed.data.role, supabase);
  if (!context) return NextResponse.json({ error: "You do not have access to this workspace." }, { status: 403 });
  let threadId = parsed.data.threadId;
  if (threadId) {
    const { data, error } = await supabase.from("chat_threads").select("id").eq("id", threadId).eq("owner_id", context.profile.id).eq("context_role", parsed.data.role).maybeSingle();
    if (error) logQueryError("verify thread ownership", "chat_threads", parsed.data.role, error);
    if (!data) return NextResponse.json({ error: "Chat thread not found." }, { status: 404 });
  } else {
    const { data, error } = await supabase.from("chat_threads").insert({ owner_id: context.profile.id, context_role: parsed.data.role }).select("id").single();
    if (error || !data) {
      logQueryError("insert thread", "chat_threads", parsed.data.role, error);
      const code = error?.code;
      const reason = code === "42501" ? "Supabase denied the insert; inspect the authenticated INSERT grant and chat_threads_owner_create RLS policy." : code === "23503" ? "The authenticated account is missing its public profile row." : "Check the server log for the Supabase error details.";
      return NextResponse.json({ error: `A new chat could not be created${code ? ` (${code})` : ""}. ${reason}` }, { status: 500 });
    }
    threadId = data.id;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  try {
    const response = await fetch(`${process.env.RAG_SERVICE_URL.replace(/\/$/, "")}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": process.env.RAG_SERVICE_TOKEN, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ thread_id: threadId, role: parsed.data.role, message: parsed.data.message }),
      signal: AbortSignal.timeout(55_000),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: result.detail || "The assistant could not answer right now.", threadId }, { status: response.status >= 500 ? 503 : response.status });
    return NextResponse.json({ threadId, answer: result.answer, citations: result.citations || [], sources: result.sources || [] });
  } catch {
    return NextResponse.json({ error: "The AI service could not be reached. Check that it is running.", threadId }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  let json: unknown;
  try { json = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const parsed = clearSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid conversation to clear." }, { status: 400 });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  if (!process.env.RAG_SERVICE_URL || !process.env.RAG_SERVICE_TOKEN) return unavailable();
  const supabase = await createClient();
  const context = await actor(parsed.data.role, supabase);
  if (!context) return NextResponse.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const { data: thread, error: threadError } = await supabase.from("chat_threads").select("id").eq("id", parsed.data.threadId).eq("owner_id", context.profile.id).eq("context_role", parsed.data.role).maybeSingle();
  if (threadError) logQueryError("verify clear ownership", "chat_threads", parsed.data.role, threadError);
  if (!thread) return NextResponse.json({ error: "Chat thread not found." }, { status: 404 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  try {
    const response = await fetch(`${process.env.RAG_SERVICE_URL.replace(/\/$/, "")}/v1/chat/${thread.id}/messages`, {
      method: "DELETE",
      headers: { "X-Internal-Token": process.env.RAG_SERVICE_TOKEN, Authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: result.detail || "The conversation could not be cleared." }, { status: response.status >= 500 ? 503 : response.status });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "The AI service could not be reached." }, { status: 503 });
  }
}
