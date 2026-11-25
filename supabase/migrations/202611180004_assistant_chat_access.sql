-- Reassert the owner-only chat access needed by the authenticated Next.js client.
-- Message writes remain restricted to the RAG service.
begin;

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_threads, public.chat_messages from anon;
grant select, insert on public.chat_threads to authenticated;
grant select on public.chat_messages to authenticated;
grant select, insert, update on public.chat_threads to service_role;
grant select, insert, delete on public.chat_messages to service_role;

drop policy if exists "chat_threads_owner_create" on public.chat_threads;
create policy "chat_threads_owner_create" on public.chat_threads
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.role_assignments ra
      where ra.user_id = (select auth.uid()) and ra.role = context_role
    )
  );

drop policy if exists "chat_threads_owner_read" on public.chat_threads;
create policy "chat_threads_owner_read" on public.chat_threads
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "chat_messages_owner_read" on public.chat_messages;
create policy "chat_messages_owner_read" on public.chat_messages
  for select to authenticated
  using (exists (
    select 1 from public.chat_threads t
    where t.id = thread_id and t.owner_id = (select auth.uid())
  ));

commit;
