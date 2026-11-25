-- Let teaching staff resolve names only for students in a class they can manage.
drop policy if exists "profiles_read_self_or_admin" on public.profiles;
create policy "profiles_read_authorized_academic_scope" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.has_role((select auth.uid()), 'super_admin')
    or exists (
      select 1 from public.students s
      join public.enrollments e on e.student_id = s.id and e.status = 'enrolled'
      where s.profile_id = profiles.id
        and public.can_manage_offering((select auth.uid()), e.course_offering_id)
    )
    or exists (
      select 1 from public.faculty f
      where f.profile_id = profiles.id
        and public.can_access_department((select auth.uid()), f.department_id)
    )
  );

-- Keep student resubmissions tied to published assignments in which they remain enrolled.
drop policy if exists "submissions_student_update" on public.submissions;
create policy "submissions_student_update" on public.submissions for update to authenticated
  using (
    public.has_role((select auth.uid()), 'student')
    and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid()))
  )
  with check (
    public.has_role((select auth.uid()), 'student')
    and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid()))
    and exists (
      select 1 from public.assignments a
      join public.enrollments e on e.course_offering_id = a.course_offering_id
      where a.id = assignment_id and a.published_at is not null
        and e.student_id = submissions.student_id and e.status = 'enrolled'
    )
  );
