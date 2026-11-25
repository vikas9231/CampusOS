-- Repair signups made before the registration migration was deployed and tighten
-- self-review checks without modifying a migration that may already be applied.

insert into public.profiles (id, full_name, email)
select id, coalesce(raw_user_meta_data ->> 'full_name', ''), coalesce(email, '')
from auth.users
on conflict (id) do nothing;

-- Only recover a request when signup metadata recorded the requested role and no
-- administrator has already provisioned any access for the account. Legacy accounts
-- without requested_role metadata cannot be classified safely and are left untouched.
insert into public.role_requests (user_id, requested_role)
select u.id, (u.raw_user_meta_data ->> 'requested_role')::public.app_role
from auth.users u
where u.raw_user_meta_data ->> 'requested_role' in ('student', 'faculty')
  and not exists (select 1 from public.role_assignments ra where ra.user_id = u.id)
  and not exists (select 1 from public.role_requests rr where rr.user_id = u.id)
on conflict (user_id) where status = 'pending' do nothing;

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
  if request_row.user_id = auth.uid() then
    raise exception 'Users cannot review their own registration request' using errcode = '42501';
  end if;
  if nullif(trim(p_enrollment_number), '') is null or p_course_id is null or p_admission_year not between 1950 and 2200 then
    raise exception 'Valid student enrollment details are required' using errcode = '22023';
  end if;
  -- Updating first is safe: every statement in this RPC is one PostgreSQL transaction.
  -- The pending-assignment guard sees approved status, and any later error rolls this back.
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
  if request_row.user_id = auth.uid() then
    raise exception 'Users cannot review their own registration request' using errcode = '42501';
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
  if request_row.user_id = auth.uid() then
    raise exception 'Users cannot review their own registration request' using errcode = '42501';
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
