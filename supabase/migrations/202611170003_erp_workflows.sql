-- Workflow helpers for role-safe staff/student provisioning and assignment resubmission.

create or replace function public.admin_create_student(
  p_profile_id uuid,
  p_enrollment_number text,
  p_course_id uuid,
  p_admission_year smallint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_student_id uuid;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  insert into public.role_assignments(user_id, role, created_by)
  values (p_profile_id, 'student', auth.uid()) on conflict do nothing;
  insert into public.students(profile_id, enrollment_number, course_id, admission_year)
  values (p_profile_id, trim(p_enrollment_number), p_course_id, p_admission_year)
  returning id into new_student_id;
  return new_student_id;
end;
$$;

create or replace function public.admin_create_faculty(
  p_profile_id uuid,
  p_employee_number text,
  p_department_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_faculty_id uuid;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  insert into public.role_assignments(user_id, role, created_by)
  values (p_profile_id, 'faculty', auth.uid()) on conflict do nothing;
  insert into public.faculty(profile_id, employee_number, department_id)
  values (p_profile_id, trim(p_employee_number), p_department_id)
  returning id into new_faculty_id;
  return new_faculty_id;
end;
$$;

revoke all on function public.admin_create_student(uuid, text, uuid, smallint) from public;
revoke all on function public.admin_create_faculty(uuid, text, uuid) from public;

grant execute on function public.admin_create_student(uuid, text, uuid, smallint) to authenticated;
grant execute on function public.admin_create_faculty(uuid, text, uuid) to authenticated;

drop policy if exists "documents_upload_own" on public.documents;

create policy "documents_upload_own"
on public.documents
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and uploaded_by = (select auth.uid())
  and (
    classification = 'private'

    or (
      classification = 'department'
      and (
        public.has_role((select auth.uid()), 'faculty')
        or public.has_role((select auth.uid()), 'hod')
      )
      and public.can_access_department(
        (select auth.uid()), department_id
      )
    )

    or (
      classification = 'course'
      and (
        (
          (
            public.has_role((select auth.uid()), 'faculty')
            or public.has_role((select auth.uid()), 'hod')
          )
          and public.can_access_course(
            (select auth.uid()), course_id
          )
        )
        or (
          public.has_role((select auth.uid()), 'student')
          and public.can_access_course(
            (select auth.uid()), course_id
          )
        )
      )
    )
  )
);


create policy "submissions_student_update" on public.submissions for update to authenticated
  using (
    public.has_role((select auth.uid()), 'student')
    and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid()))
  )
  with check (
    public.has_role((select auth.uid()), 'student')
    and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid()))
  );
