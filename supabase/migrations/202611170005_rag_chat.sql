-- Chat history is private to its owner. Message writes are restricted to the
-- RAG service so clients cannot forge assistant answers into their history.
grant select, insert on public.chat_threads to authenticated;
grant select on public.chat_messages to authenticated;
grant select, insert, update on public.chat_threads to service_role;
grant select, insert on public.chat_messages to service_role;
grant select on public.role_assignments to service_role;
grant select, insert, update, delete on public.documents, public.knowledge_documents, public.document_chunks to service_role;

create policy "chat_threads_owner_create" on public.chat_threads for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.role_assignments ra
      where ra.user_id = (select auth.uid()) and ra.role = context_role
    )
  );
