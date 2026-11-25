-- Clearing a thread is routed through FastAPI, which verifies the caller's
-- Supabase identity, role assignment, and thread ownership before deletion.
grant delete on public.chat_messages to service_role;
