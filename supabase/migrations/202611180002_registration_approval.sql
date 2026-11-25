-- Public registration requests and atomic Super Admin review.
-- Requested roles are informational until an administrator approves them.

create table public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role public.app_role not null check (requested_role in ('student', 'faculty')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'pending' and reviewed_at is null) or (status <> 'pending' and reviewed_at is not null))
);
create index role_requests_status_created_idx on public.role_requests(status, created_at desc);
create unique index role_requests_one_pending_per_user on public.role_requests(user_id) where status = 'pending';
alter table public.role_requests enable row level security;
create policy "role_requests_read_self_or_admin" on public.role_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role((select auth.uid()), 'super_admin'));
revoke all on public.role_requests from anon, authenticated;
grant select on public.role_requests to authenticated;

-- Signup metadata can ask for a role, but this trigger only creates a request.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare requested public.app_role;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email, updated_at = now();

  if new.raw_user_meta_data ->> 'requested_role' in ('student', 'faculty') then
    requested := (new.raw_user_meta_data ->> 'requested_role')::public.app_role;
    insert into public.role_requests(user_id, requested_role)
    values (new.id, requested)
    on conflict (user_id) where status = 'pending' do nothing;
  end if;
  return new;
end;
$$;

-- Keep legacy admin provisioning and direct role inserts from bypassing a pending review.
create or replace function public.prevent_assignment_during_pending_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.role_requests where user_id = new.user_id and status = 'pending') then
    raise exception 'A pending registration request must be reviewed before assigning access' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger role_assignment_pending_registration_guard
  before insert or update of user_id, role on public.role_assignments
  for each row execute function public.prevent_assignment_during_pending_registration();

create or replace function public.admin_approve_student_request(
  p_request_id uuid,
  p_enrollment_number text,
  p_course_id uuid,
  p_admission_year smallint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare request_row public.role_requests; new_student_id uuid;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  select * into request_row from public.role_requests where id = p_request_id for update;
  if not found or request_row.status <> 'pending' or request_row.requested_role <> 'student' then
    raise exception 'This student registration request is no longer pending' using errcode = '22023';
  end if;
  if nullif(trim(p_enrollment_number), '') is null or p_course_id is null or p_admission_year not between 1950 and 2200 then
    raise exception 'Valid student enrollment details are required' using errcode = '22023';
  end if;
  update public.role_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), rejection_note = null
  where id = request_row.id;
  insert into public.students(profile_id, enrollment_number, course_id, admission_year)
  values (request_row.user_id, trim(p_enrollment_number), p_course_id, p_admission_year)
  returning id into new_student_id;
  insert into public.role_assignments(user_id, role, created_by)
  values (request_row.user_id, 'student', auth.uid()) on conflict do nothing;
  return new_student_id;
end;
$$;

create or replace function public.admin_approve_faculty_request(
  p_request_id uuid,
  p_employee_number text,
  p_department_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare request_row public.role_requests; new_faculty_id uuid;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  select * into request_row from public.role_requests where id = p_request_id for update;
  if not found or request_row.status <> 'pending' or request_row.requested_role <> 'faculty' then
    raise exception 'This faculty registration request is no longer pending' using errcode = '22023';
  end if;
  if nullif(trim(p_employee_number), '') is null or p_department_id is null then
    raise exception 'Valid faculty employment details are required' using errcode = '22023';
  end if;
  update public.role_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), rejection_note = null
  where id = request_row.id;
  insert into public.faculty(profile_id, employee_number, department_id)
  values (request_row.user_id, trim(p_employee_number), p_department_id)
  returning id into new_faculty_id;
  insert into public.role_assignments(user_id, role, created_by)
  values (request_row.user_id, 'faculty', auth.uid()) on conflict do nothing;
  return new_faculty_id;
end;
$$;

create or replace function public.admin_reject_role_request(p_request_id uuid, p_rejection_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare request_row public.role_requests;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  select * into request_row from public.role_requests where id = p_request_id for update;
  if not found or request_row.status <> 'pending' then
    raise exception 'This registration request is no longer pending' using errcode = '22023';
  end if;
  update public.role_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
    rejection_note = nullif(trim(left(coalesce(p_rejection_note, ''), 500)), '')
  where id = request_row.id;
end;
$$;

revoke all on function public.admin_approve_student_request(uuid, text, uuid, smallint) from public;
revoke all on function public.admin_approve_faculty_request(uuid, text, uuid) from public;
revoke all on function public.admin_reject_role_request(uuid, text) from public;
grant execute on function public.admin_approve_student_request(uuid, text, uuid, smallint) to authenticated;
grant execute on function public.admin_approve_faculty_request(uuid, text, uuid) to authenticated;
grant execute on function public.admin_reject_role_request(uuid, text) to authenticated;
