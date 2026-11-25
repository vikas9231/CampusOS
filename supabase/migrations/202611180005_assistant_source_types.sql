-- Persist which authorized sources grounded an assistant message.
alter table public.chat_messages
  add column if not exists source_types text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_source_types_allowed'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_source_types_allowed
      check (source_types <@ array['live_erp', 'documents']::text[]);
  end if;
end;
$$;

-- Backfill source indicators for prior assistant messages without changing their content.
update public.chat_messages
set source_types = case
  when content like 'Here is the authorized ERP information I found:%' then array['live_erp']::text[]
  when jsonb_typeof(citations) = 'array' and jsonb_array_length(citations) > 0 then array['documents']::text[]
  else '{}'::text[]
end
where message_role = 'assistant' and cardinality(source_types) = 0;
