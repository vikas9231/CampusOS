-- Identity and role foundation for CampusOS.
-- Run with Supabase migrations (or paste into the SQL editor for a new project).

create extension if not exists pgcrypto;

create type public.app_role as enum ('super_admin', 'faculty', 'student', 'hod');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  department_id uuid references public.departments(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint role_assignment_scope check (
    (role = 'hod' and department_id is not null)
    or (role <> 'hod' and department_id is null)
  ),
  constraint role_assignment_unique_scope unique nulls not distinct (user_id, role, department_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index role_assignments_user_idx on public.role_assignments(user_id);
create index role_assignments_department_idx on public.role_assignments(department_id) where department_id is not null;
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.role_assignments
    where user_id = _user_id and role = _role
  );
$$;

revoke all on function public.has_role(uuid, public.app_role) from public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill accounts created before this migration was applied.
insert into public.profiles (id, full_name, email)
select id, coalesce(raw_user_meta_data ->> 'full_name', ''), coalesce(email, '')
from auth.users
on conflict (id) do update set email = excluded.email;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger departments_updated_at before update on public.departments
  for each row execute procedure public.set_updated_at();

create or replace function public.audit_role_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_row public.role_assignments;
  event_action text;
begin
  if tg_op = 'DELETE' then
    changed_row := old;
    event_action := 'role_assignment.removed';
  else
    changed_row := new;
    event_action := case when tg_op = 'INSERT' then 'role_assignment.created' else 'role_assignment.updated' end;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), event_action, 'role_assignment', changed_row.id,
    jsonb_build_object('user_id', changed_row.user_id, 'role', changed_row.role, 'department_id', changed_row.department_id)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger role_assignment_audit
  after insert or update or delete on public.role_assignments
  for each row execute procedure public.audit_role_assignment_change();

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.role_assignments enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_read_self_or_admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.has_role((select auth.uid()), 'super_admin'));

create policy "profiles_update_self_or_admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.has_role((select auth.uid()), 'super_admin'))
  with check (id = (select auth.uid()) or public.has_role((select auth.uid()), 'super_admin'));

create policy "roles_read_self_or_admin" on public.role_assignments
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role((select auth.uid()), 'super_admin'));

create policy "roles_manage_admin_only" on public.role_assignments
  for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin'))
  with check (public.has_role((select auth.uid()), 'super_admin'));

create policy "departments_read_authenticated" on public.departments
  for select to authenticated using (true);

create policy "audit_read_admin_only" on public.audit_logs
  for select to authenticated using (public.has_role((select auth.uid()), 'super_admin'));

revoke all on public.profiles, public.role_assignments, public.departments from anon;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.profiles, public.role_assignments, public.departments to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant insert, update, delete on public.role_assignments to authenticated;
grant select on public.audit_logs to authenticated;

-- First administrator bootstrap (run once in the Supabase SQL editor as project owner):
-- insert into public.role_assignments (user_id, role)
-- select id, 'super_admin'::public.app_role from auth.users where email = 'admin@yourcollege.edu';
-- Role changes from then on can be performed by an authenticated super admin.
