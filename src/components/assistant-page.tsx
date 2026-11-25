import { AssistantChat } from "@/components/assistant-chat";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/types/auth";

export async function AssistantPage({ role }: { role: Role }) {
  const context = await requireRole(role);
  const supabase = await createClient();
  const { data: threads, error: threadError } = await supabase.from("chat_threads").select("id,context_role,created_at,updated_at").eq("owner_id", context.profile.id).eq("context_role", role).order("updated_at", { ascending: false }).limit(30);
  const selectedThread = threads?.[0];
  let messages: any[] = [];
  if (selectedThread) {
    const result = await supabase.from("chat_messages").select("id,message_role,content,citations,source_types,created_at").eq("thread_id", selectedThread.id).order("created_at").limit(100);
    messages = result.data || [];
  }
  if (threadError) console.error("[assistant] owned chat threads could not be loaded", threadError.code || threadError.message);
  return <AssistantChat role={role} initialThreads={(threads || []) as any} initialMessages={messages as any} key={`${context.profile.id}:${role}`} />;
}
