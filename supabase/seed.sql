-- Small academic catalog seed for local development; no synthetic people or grades.
insert into public.departments (code, name)
values
  ('CSE', 'Computer Science and Engineering'),
  ('BBA', 'Business Administration')
on conflict (code) do nothing;

insert into public.academic_years (name, starts_on, ends_on, status)
values ('2026-2027', date '2026-07-01', date '2027-06-30', 'active')
on conflict (name) do nothing;

insert into public.courses (department_id, code, name, duration_years)
select d.id, seed.code, seed.name, seed.duration_years
from (values
  ('CSE', 'BSC-CS', 'B.Sc. Computer Science', 3),
  ('BBA', 'BBA', 'Bachelor of Business Administration', 3)
) as seed(department_code, code, name, duration_years)
join public.departments d on d.code = seed.department_code
on conflict (code) do nothing;

insert into public.semesters (course_id, academic_year_id, semester_number, status)
select c.id, y.id, 1, 'active'
from public.courses c
join public.academic_years y on y.name = '2026-2027'
where c.code in ('BSC-CS', 'BBA')
on conflict (course_id, academic_year_id, semester_number) do nothing;

insert into public.subjects (course_id, code, title, credits, semester_number)
select c.id, seed.code, seed.title, seed.credits, 1
from (values
  ('BSC-CS', 'CS101', 'Programming Fundamentals', 4.0),
  ('BSC-CS', 'CS102', 'Discrete Mathematics', 3.0),
  ('BBA', 'BA101', 'Principles of Management', 3.0),
  ('BBA', 'BA102', 'Business Communication', 3.0)
) as seed(course_code, code, title, credits)
join public.courses c on c.code = seed.course_code
on conflict (course_id, code) do nothing;
