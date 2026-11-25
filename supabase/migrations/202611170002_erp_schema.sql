-- Core academic, attendance, assessment, fees, notices, files, and support schema.
-- RLS is enabled on every public data table created in this migration.

create extension if not exists btree_gist;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Role helpers may be called by RLS. Prevent callers from probing another user's role.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _user_id is not null
    and exists (
      select 1 from public.role_assignments target_role
      where target_role.user_id = _user_id and target_role.role = _role
    )
    and (
      _user_id = (select auth.uid())
      or exists (select 1 from public.role_assignments actor_role
        where actor_role.user_id = (select auth.uid()) and actor_role.role = 'super_admin')
    );
$$;

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on < ends_on)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  code text not null unique,
  name text not null,
  duration_years smallint not null check (duration_years between 1 and 10),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_department_idx on public.courses(department_id);

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  semester_number smallint not null check (semester_number between 1 and 20),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, academic_year_id, semester_number),
  check (starts_on is null or ends_on is null or starts_on < ends_on)
);
create index semesters_course_year_idx on public.semesters(course_id, academic_year_id);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  code text not null,
  title text not null,
  credits numeric(4,1) not null default 0 check (credits >= 0),
  semester_number smallint not null check (semester_number between 1 and 20),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, code)
);
create index subjects_course_semester_idx on public.subjects(course_id, semester_number);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  enrollment_number text not null unique,
  course_id uuid not null references public.courses(id) on delete restrict,
  admission_year smallint not null check (admission_year between 1950 and 2200),
  status text not null default 'active' check (status in ('active', 'graduated', 'suspended', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_course_status_idx on public.students(course_id, status);

create table public.faculty (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  employee_number text not null unique,
  department_id uuid not null references public.departments(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'on_leave', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index faculty_department_idx on public.faculty(department_id);

create table public.course_offerings (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  semester_id uuid not null references public.semesters(id) on delete restrict,
  faculty_id uuid not null references public.faculty(id) on delete restrict,
  section text not null default 'A',
  capacity integer check (capacity is null or capacity > 0),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, semester_id, section)
);
create index course_offerings_faculty_idx on public.course_offerings(faculty_id, status);
create index course_offerings_semester_idx on public.course_offerings(semester_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  course_offering_id uuid not null references public.course_offerings(id) on delete restrict,
  status text not null default 'enrolled' check (status in ('enrolled', 'dropped', 'completed')),
  enrolled_at timestamptz not null default now(),
  unique (student_id, course_offering_id)
);
create index enrollments_offering_idx on public.enrollments(course_offering_id, status);
create index enrollments_student_idx on public.enrollments(student_id, status);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  building text not null default '',
  room_number text not null,
  capacity integer check (capacity is null or capacity > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building, room_number)
);

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  course_offering_id uuid not null references public.course_offerings(id) on delete cascade,
  faculty_id uuid not null references public.faculty(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  exclude using gist (
    room_id with =,
    weekday with =,
    (tsrange(date '2000-01-03' + weekday + starts_at, date '2000-01-03' + weekday + ends_at, '[)')) with &&
  ),
  exclude using gist (
    faculty_id with =,
    weekday with =,
    (tsrange(date '2000-01-03' + weekday + starts_at, date '2000-01-03' + weekday + ends_at, '[)')) with &&
  )
);
create index timetable_offering_idx on public.timetable_slots(course_offering_id, weekday);

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  course_offering_id uuid not null references public.course_offerings(id) on delete cascade,
  session_date date not null,
  session_label text not null default '',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_offering_id, session_date, session_label)
);
create index attendance_sessions_date_idx on public.attendance_sessions(session_date desc, course_offering_id);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused')),
  marked_by uuid not null references public.profiles(id) on delete restrict,
  marked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, enrollment_id)
);
create index attendance_records_enrollment_idx on public.attendance_records(enrollment_id, status);

create table public.attendance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid not null,
  enrollment_id uuid not null,
  changed_by uuid references public.profiles(id) on delete set null,
  old_status text not null,
  new_status text not null,
  changed_at timestamptz not null default now()
);
create index attendance_audit_enrollment_idx on public.attendance_audit_logs(enrollment_id, changed_at desc);

create table public.examinations (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters(id) on delete restrict,
  title text not null,
  exam_type text not null check (exam_type in ('internal', 'midterm', 'final', 'practical', 'other')),
  starts_on date,
  ends_on date,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'completed', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create table public.exam_subjects (
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null references public.examinations(id) on delete cascade,
  course_offering_id uuid not null references public.course_offerings(id) on delete restrict,
  exam_date date,
  max_marks numeric(7,2) not null check (max_marks > 0),
  created_at timestamptz not null default now(),
  unique (examination_id, course_offering_id)
);

create table public.marks (
  id uuid primary key default gen_random_uuid(),
  exam_subject_id uuid not null references public.exam_subjects(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  score numeric(7,2) not null check (score >= 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  entered_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_subject_id, enrollment_id)
);
create index marks_enrollment_status_idx on public.marks(enrollment_id, status);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_offering_id uuid not null references public.course_offerings(id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz not null,
  max_marks numeric(7,2) not null default 100 check (max_marks > 0),
  published_at timestamptz,
  attachment_document_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_offering_due_idx on public.assignments(course_offering_id, due_at);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  storage_path text,
  submitted_at timestamptz not null default now(),
  grade numeric(7,2) check (grade is null or grade >= 0),
  feedback text,
  graded_by uuid references public.profiles(id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);
create index submissions_student_idx on public.submissions(student_id, submitted_at desc);

create table public.fee_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  academic_year_id uuid references public.academic_years(id) on delete restrict,
  label text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_invoices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  invoice_number text not null unique,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  due_on date,
  status text not null default 'pending' check (status in ('pending', 'partially_paid', 'paid', 'void', 'overdue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_student_status_idx on public.student_invoices(student_id, status);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.student_invoices(id) on delete cascade,
  fee_item_id uuid references public.fee_items(id) on delete set null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.student_invoices(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  provider text,
  provider_reference text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_invoice_status_idx on public.payments(invoice_id, status);

create or replace function public.validate_enrollment()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not exists (
    select 1 from public.students s
    join public.course_offerings o on o.id = new.course_offering_id
    join public.subjects sub on sub.id = o.subject_id
    where s.id = new.student_id and s.course_id = sub.course_id
  ) then raise exception 'Student and course offering must belong to the same course'; end if;
  return new;
end;
$$;
create trigger enrollment_validate before insert or update on public.enrollments
  for each row execute procedure public.validate_enrollment();

create or replace function public.validate_exam_subject()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not exists (
    select 1 from public.examinations x
    join public.course_offerings o on o.semester_id = x.semester_id
    where x.id = new.examination_id and o.id = new.course_offering_id
  ) then raise exception 'Exam and course offering must belong to the same semester'; end if;
  return new;
end;
$$;
create trigger exam_subject_validate before insert or update on public.exam_subjects
  for each row execute procedure public.validate_exam_subject();

create or replace function public.validate_invoice_line()
returns trigger language plpgsql set search_path = public
as $$
declare invoice_course uuid; invoice_currency char(3); item_course uuid; item_currency char(3);
begin
  select s.course_id, i.currency into invoice_course, invoice_currency
  from public.student_invoices i join public.students s on s.id = i.student_id
  where i.id = new.invoice_id;
  if new.fee_item_id is not null then
    select course_id, currency into item_course, item_currency from public.fee_items where id = new.fee_item_id;
    if item_course is null or item_course <> invoice_course or item_currency <> invoice_currency then
      raise exception 'Invoice line fee item must match the student course and invoice currency';
    end if;
  end if;
  return new;
end;
$$;
create trigger invoice_line_validate before insert or update on public.invoice_lines
  for each row execute procedure public.validate_invoice_line();

create or replace function public.validate_payment()
returns trigger language plpgsql set search_path = public
as $$
declare invoice_currency char(3);
begin
  select currency into invoice_currency from public.student_invoices where id = new.invoice_id;
  if invoice_currency is null or new.currency <> invoice_currency then
    raise exception 'Payment currency must match the invoice currency';
  end if;
  if new.status = 'paid' and new.paid_at is null then new.paid_at = now(); end if;
  return new;
end;
$$;
create trigger payment_validate before insert or update on public.payments
  for each row execute procedure public.validate_payment();

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  body text not null,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or published_at is null or expires_at > published_at)
);

create table public.notice_targets (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  role public.app_role not null,
  department_id uuid references public.departments(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique nulls not distinct (notice_id, role, department_id, course_id)
);
create index notice_targets_notice_idx on public.notice_targets(notice_id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  classification text not null default 'private' check (classification in ('private', 'department', 'course', 'college')),
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  checksum text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((classification = 'department' and department_id is not null) or classification <> 'department'),
  check ((classification = 'course' and course_id is not null) or classification <> 'course')
);
create index documents_owner_idx on public.documents(owner_id, created_at desc);
create index documents_scope_idx on public.documents(classification, department_id, course_id);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.documents(id) on delete cascade,
  processing_status text not null default 'queued' check (processing_status in ('queued', 'processing', 'ready', 'failed')),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  knowledge_document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (knowledge_document_id, chunk_index)
);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_knowledge_idx on public.document_chunks(knowledge_document_id, chunk_index);

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  context_role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_threads_owner_updated_idx on public.chat_threads(owner_id, updated_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  message_role text not null check (message_role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index chat_messages_thread_created_idx on public.chat_messages(thread_id, created_at);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  category text not null,
  subject text not null,
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'closed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index complaints_student_status_idx on public.complaints(student_id, status);

alter table public.assignments add constraint assignments_document_fk
  foreign key (attachment_document_id) references public.documents(id) on delete set null;

create or replace function public.is_hod_for_department(_user_id uuid, _department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.role_assignments
    where user_id = _user_id and role = 'hod' and department_id = _department_id)
    and _user_id = (select auth.uid());
$$;

create or replace function public.is_faculty_for_offering(_user_id uuid, _offering_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.course_offerings o
    join public.faculty f on f.id = o.faculty_id
    where o.id = _offering_id and f.profile_id = _user_id
      and public.has_role(_user_id, 'faculty')
  ) and _user_id = (select auth.uid());
$$;

create or replace function public.is_student_in_offering(_user_id uuid, _offering_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    join public.students s on s.id = e.student_id
    where e.course_offering_id = _offering_id and e.status = 'enrolled'
      and s.profile_id = _user_id and s.status = 'active'
      and public.has_role(_user_id, 'student')
  ) and _user_id = (select auth.uid());
$$;

create or replace function public.can_access_department(_user_id uuid, _department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select _user_id = (select auth.uid()) and (
    public.has_role(_user_id, 'super_admin')
    or public.is_hod_for_department(_user_id, _department_id)
    or (public.has_role(_user_id, 'faculty') and exists (select 1 from public.faculty f where f.profile_id = _user_id and f.department_id = _department_id))
    or exists (
      select 1 from public.students s join public.courses c on c.id = s.course_id
      where s.profile_id = _user_id and c.department_id = _department_id and public.has_role(_user_id, 'student')
    ));
$$;

create or replace function public.can_access_course(_user_id uuid, _course_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select _user_id = (select auth.uid()) and (
    public.has_role(_user_id, 'super_admin')
    or exists (
      select 1 from public.courses c
      where c.id = _course_id and public.is_hod_for_department(_user_id, c.department_id)
    )
    or (public.has_role(_user_id, 'student') and exists (select 1 from public.students s where s.profile_id = _user_id and s.course_id = _course_id))
    or exists (
      select 1 from public.course_offerings o
      join public.subjects sub on sub.id = o.subject_id
      join public.faculty f on f.id = o.faculty_id
      where sub.course_id = _course_id and f.profile_id = _user_id and public.has_role(_user_id, 'faculty')
    ));
$$;

create or replace function public.can_access_offering(_user_id uuid, _offering_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select _user_id = (select auth.uid()) and (
    public.has_role(_user_id, 'super_admin')
    or public.is_faculty_for_offering(_user_id, _offering_id)
    or public.is_student_in_offering(_user_id, _offering_id)
    or exists (
      select 1 from public.course_offerings o
      join public.subjects sub on sub.id = o.subject_id
      join public.courses c on c.id = sub.course_id
      where o.id = _offering_id and public.is_hod_for_department(_user_id, c.department_id)
    ));
$$;

create or replace function public.can_manage_offering(_user_id uuid, _offering_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select _user_id = (select auth.uid()) and (
    public.has_role(_user_id, 'super_admin')
    or public.is_faculty_for_offering(_user_id, _offering_id)
    or exists (
      select 1 from public.course_offerings o
      join public.subjects sub on sub.id = o.subject_id
      join public.courses c on c.id = sub.course_id
      where o.id = _offering_id and public.is_hod_for_department(_user_id, c.department_id)
    ));
$$;

create or replace function public.can_access_student(_user_id uuid, _student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select _user_id = (select auth.uid()) and (
    public.has_role(_user_id, 'super_admin')
    or (public.has_role(_user_id, 'student') and exists (select 1 from public.students s where s.id = _student_id and s.profile_id = _user_id))
    or exists (
      select 1 from public.students s join public.courses c on c.id = s.course_id
      where s.id = _student_id and public.is_hod_for_department(_user_id, c.department_id)
    )
    or exists (
      select 1 from public.enrollments e join public.course_offerings o on o.id = e.course_offering_id
      where e.student_id = _student_id and public.is_faculty_for_offering(_user_id, o.id)
    ));
$$;

create or replace function public.can_access_enrollment(_user_id uuid, _enrollment_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    join public.students s on s.id = e.student_id
      where e.id = _enrollment_id and (
      (public.has_role(_user_id, 'student') and s.profile_id = _user_id) or public.can_access_offering(_user_id, e.course_offering_id)
    )
  ) and _user_id = (select auth.uid());
$$;

create or replace function public.can_manage_enrollment(_user_id uuid, _enrollment_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.enrollments e
    where e.id = _enrollment_id and public.can_manage_offering(_user_id, e.course_offering_id)
  ) and _user_id = (select auth.uid());
$$;

create or replace function public.is_notice_visible(_user_id uuid, _notice_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.notices n
    where n.id = _notice_id and n.published_at is not null
      and (n.expires_at is null or n.expires_at > now())
      and (
        not exists (select 1 from public.notice_targets nt where nt.notice_id = n.id)
        or exists (
          select 1 from public.notice_targets nt
          join public.role_assignments ra on ra.role = nt.role and ra.user_id = _user_id
          where nt.notice_id = n.id
            and (nt.department_id is null or public.can_access_department(_user_id, nt.department_id))
            and (nt.course_id is null or public.can_access_course(_user_id, nt.course_id))
        )
      )
  ) and _user_id = (select auth.uid());
$$;

create or replace function public.validate_timetable_slot()
returns trigger language plpgsql set search_path = public
as $$
declare offering_faculty uuid;
begin
  select faculty_id into offering_faculty from public.course_offerings where id = new.course_offering_id;
  if offering_faculty is null or offering_faculty <> new.faculty_id then
    raise exception 'Timetable faculty must match the course offering';
  end if;
  return new;
end;
$$;

create trigger timetable_slot_validate before insert or update on public.timetable_slots
  for each row execute procedure public.validate_timetable_slot();

create or replace function public.validate_course_offering()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not exists (
    select 1 from public.subjects sub join public.semesters sem on sem.course_id = sub.course_id
    where sub.id = new.subject_id and sem.id = new.semester_id
  ) then raise exception 'Subject and semester must belong to the same course'; end if;
  return new;
end;
$$;
create trigger course_offering_validate before insert or update on public.course_offerings
  for each row execute procedure public.validate_course_offering();

create or replace function public.validate_attendance_record()
returns trigger language plpgsql set search_path = public
as $$
begin
  if not exists (
    select 1 from public.attendance_sessions a
    join public.enrollments e on e.course_offering_id = a.course_offering_id
    where a.id = new.session_id and e.id = new.enrollment_id and e.status = 'enrolled'
  ) then raise exception 'Attendance enrollment must belong to the session course offering'; end if;
  return new;
end;
$$;

create trigger attendance_record_validate before insert or update on public.attendance_records
  for each row execute procedure public.validate_attendance_record();

create or replace function public.audit_attendance_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.attendance_audit_logs(attendance_record_id, enrollment_id, changed_by, old_status, new_status)
    values (new.id, new.enrollment_id, auth.uid(), old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger attendance_record_audit after update on public.attendance_records
  for each row execute procedure public.audit_attendance_change();

create or replace function public.validate_mark()
returns trigger language plpgsql set search_path = public
as $$
declare maximum numeric(7,2); offering uuid;
begin
  select es.max_marks, es.course_offering_id into maximum, offering
  from public.exam_subjects es where es.id = new.exam_subject_id;
  if maximum is null or new.score > maximum then raise exception 'Mark must be within the exam subject maximum'; end if;
  if not exists (select 1 from public.enrollments e where e.id = new.enrollment_id and e.course_offering_id = offering)
    then raise exception 'Mark enrollment must belong to the exam subject course offering'; end if;
  if new.status = 'published' and new.published_at is null then new.published_at = now(); end if;
  return new;
end;
$$;

create trigger marks_validate before insert or update on public.marks
  for each row execute procedure public.validate_mark();

create or replace function public.audit_mark_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare changed_row public.marks; event_action text;
begin
  if tg_op = 'DELETE' then changed_row := old; event_action := 'mark.removed';
  else changed_row := new; event_action := case when tg_op = 'INSERT' then 'mark.created' else 'mark.updated' end;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), event_action, 'mark', changed_row.id,
    jsonb_build_object('enrollment_id', changed_row.enrollment_id, 'exam_subject_id', changed_row.exam_subject_id,
      'score', changed_row.score, 'status', changed_row.status));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger marks_audit after insert or update or delete on public.marks
  for each row execute procedure public.audit_mark_change();

create or replace function public.audit_payment_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare changed_row public.payments; event_action text;
begin
  if tg_op = 'DELETE' then changed_row := old; event_action := 'payment.removed';
  else changed_row := new; event_action := case when tg_op = 'INSERT' then 'payment.created' else 'payment.updated' end;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), event_action, 'payment', changed_row.id,
    jsonb_build_object('invoice_id', changed_row.invoice_id, 'amount', changed_row.amount,
      'currency', changed_row.currency, 'status', changed_row.status));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute procedure public.audit_payment_change();

create or replace function public.validate_submission()
returns trigger language plpgsql set search_path = public
as $$
declare offering uuid; maximum numeric(7,2);
begin
  select course_offering_id, max_marks into offering, maximum from public.assignments where id = new.assignment_id;
  if offering is null or not exists (
    select 1 from public.enrollments e where e.student_id = new.student_id
      and e.course_offering_id = offering and e.status = 'enrolled'
  ) then raise exception 'Student must be enrolled in the assignment course offering'; end if;
  if public.has_role(auth.uid(), 'student') then
    if tg_op = 'INSERT' then new.submitted_at = now(); end if;
    new.grade = null;
    new.feedback = null;
    new.graded_by = null;
    new.graded_at = null;
  elsif new.grade is not null then
    if new.grade > maximum then raise exception 'Grade must not exceed assignment maximum'; end if;
    if tg_op = 'INSERT' then
      new.graded_by = auth.uid();
      new.graded_at = now();
    elsif old.grade is distinct from new.grade then
      new.graded_by = auth.uid();
      new.graded_at = now();
    end if;
  end if;
  return new;
end;
$$;

create trigger submission_validate before insert or update on public.submissions
  for each row execute procedure public.validate_submission();

create or replace function public.validate_complaint()
returns trigger language plpgsql set search_path = public
as $$
begin
  if public.has_role(auth.uid(), 'student') then
    if tg_op = 'INSERT' then new.status = 'open'; end if;
    new.assigned_to = null;
    new.resolution = null;
  end if;
  return new;
end;
$$;
create trigger complaint_validate before insert or update on public.complaints
  for each row execute procedure public.validate_complaint();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'academic_years','courses','semesters','subjects','students','faculty','course_offerings',
    'rooms','timetable_slots','attendance_sessions','attendance_records','examinations','marks',
    'assignments','submissions','fee_items','student_invoices','payments','notices','complaints'
  ] loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute procedure public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'academic_years','courses','semesters','subjects','students','faculty','course_offerings','enrollments',
    'rooms','timetable_slots','attendance_sessions','attendance_records','attendance_audit_logs',
    'examinations','exam_subjects','marks','assignments','submissions','fee_items','student_invoices',
    'invoice_lines','payments','notices','notice_targets','documents','complaints'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end;
$$;

-- Catalog and setup tables are readable by signed-in users; only Super Admins can change them.
create policy "academic_years_read" on public.academic_years for select to authenticated using (true);
create policy "academic_years_admin_manage" on public.academic_years for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "courses_read" on public.courses for select to authenticated using (true);
create policy "courses_admin_manage" on public.courses for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "semesters_read" on public.semesters for select to authenticated using (true);
create policy "semesters_admin_manage" on public.semesters for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "subjects_read" on public.subjects for select to authenticated using (true);
create policy "subjects_admin_manage" on public.subjects for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "departments_admin_manage" on public.departments for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
grant insert, update, delete on public.departments to authenticated;
create policy "students_scoped_read" on public.students for select to authenticated
  using (public.can_access_student((select auth.uid()), id));
create policy "students_admin_manage" on public.students for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "faculty_directory_read" on public.faculty for select to authenticated
  using (
    (profile_id = (select auth.uid()) and public.has_role((select auth.uid()), 'faculty'))
    or public.has_role((select auth.uid()), 'super_admin')
    or public.is_hod_for_department((select auth.uid()), department_id)
    or exists (select 1 from public.course_offerings o where o.faculty_id = faculty.id
      and public.can_access_offering((select auth.uid()), o.id))
  );
create policy "faculty_admin_manage" on public.faculty for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "offerings_scoped_read" on public.course_offerings for select to authenticated
  using (public.can_access_offering((select auth.uid()), id));
create policy "offerings_admin_manage" on public.course_offerings for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "enrollments_scoped_read" on public.enrollments for select to authenticated
  using (public.can_access_enrollment((select auth.uid()), id));
create policy "enrollments_admin_manage" on public.enrollments for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "rooms_read" on public.rooms for select to authenticated using (true);
create policy "rooms_admin_manage" on public.rooms for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "timetable_scoped_read" on public.timetable_slots for select to authenticated
  using (public.can_access_offering((select auth.uid()), course_offering_id));
create policy "timetable_admin_manage" on public.timetable_slots for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));

-- Faculty can maintain attendance for assigned offerings; students can see only their own records.
create policy "attendance_sessions_scoped_read" on public.attendance_sessions for select to authenticated
  using (public.can_access_offering((select auth.uid()), course_offering_id));
create policy "attendance_sessions_admin_manage" on public.attendance_sessions for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "attendance_sessions_faculty_insert" on public.attendance_sessions for insert to authenticated
  with check (created_by = (select auth.uid()) and public.is_faculty_for_offering((select auth.uid()), course_offering_id));
create policy "attendance_sessions_faculty_update" on public.attendance_sessions for update to authenticated
  using (public.is_faculty_for_offering((select auth.uid()), course_offering_id))
  with check (created_by = (select auth.uid()) and public.is_faculty_for_offering((select auth.uid()), course_offering_id));
create policy "attendance_records_scoped_read" on public.attendance_records for select to authenticated
  using (public.can_access_enrollment((select auth.uid()), enrollment_id));
create policy "attendance_records_admin_manage" on public.attendance_records for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "attendance_records_faculty_insert" on public.attendance_records for insert to authenticated
  with check (marked_by = (select auth.uid()) and exists (select 1 from public.enrollments e join public.attendance_sessions a on a.course_offering_id = e.course_offering_id
    where e.id = enrollment_id and a.id = session_id and public.is_faculty_for_offering((select auth.uid()), a.course_offering_id)));
create policy "attendance_records_faculty_update" on public.attendance_records for update to authenticated
  using (exists (select 1 from public.enrollments e join public.attendance_sessions a on a.course_offering_id = e.course_offering_id
    where e.id = enrollment_id and a.id = session_id and public.is_faculty_for_offering((select auth.uid()), a.course_offering_id)))
  with check (marked_by = (select auth.uid()) and exists (select 1 from public.enrollments e join public.attendance_sessions a on a.course_offering_id = e.course_offering_id
    where e.id = enrollment_id and a.id = session_id and public.is_faculty_for_offering((select auth.uid()), a.course_offering_id)));
create policy "attendance_audit_staff_read" on public.attendance_audit_logs for select to authenticated
  using (public.can_manage_enrollment((select auth.uid()), enrollment_id));

-- Exam schedules are visible to signed-in users with access to the relevant course offering.
create policy "examinations_read" on public.examinations for select to authenticated
  using (
    (public.has_role((select auth.uid()), 'super_admin') or public.has_role((select auth.uid()), 'faculty')
      or public.has_role((select auth.uid()), 'student') or public.has_role((select auth.uid()), 'hod'))
    and (status in ('scheduled', 'completed', 'published') or public.has_role((select auth.uid()), 'super_admin'))
  );
create policy "examinations_admin_manage" on public.examinations for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "exam_subjects_scoped_read" on public.exam_subjects for select to authenticated
  using (
    public.can_access_offering((select auth.uid()), course_offering_id)
    and exists (select 1 from public.examinations x where x.id = examination_id
      and (x.status in ('scheduled', 'completed', 'published') or public.can_manage_offering((select auth.uid()), course_offering_id)))
  );
create policy "exam_subjects_admin_manage" on public.exam_subjects for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "marks_scoped_read" on public.marks for select to authenticated
  using (
    (status = 'published' and public.has_role((select auth.uid()), 'student') and exists (
      select 1 from public.enrollments e join public.students s on s.id = e.student_id
      where e.id = enrollment_id and s.profile_id = (select auth.uid())
    ))
    or public.can_manage_enrollment((select auth.uid()), enrollment_id)
  );
create policy "marks_staff_manage" on public.marks for all to authenticated
  using (public.can_manage_enrollment((select auth.uid()), enrollment_id))
  with check (entered_by = (select auth.uid()) and public.can_manage_enrollment((select auth.uid()), enrollment_id));

-- Students can see published assignments and submit their own work; teaching staff can manage the class.
create policy "assignments_scoped_read" on public.assignments for select to authenticated
  using (public.can_access_offering((select auth.uid()), course_offering_id) and
    (published_at is not null or public.can_manage_offering((select auth.uid()), course_offering_id)));
create policy "assignments_staff_manage" on public.assignments for all to authenticated
  using (public.can_manage_offering((select auth.uid()), course_offering_id))
  with check (created_by = (select auth.uid()) and public.can_manage_offering((select auth.uid()), course_offering_id));
create policy "submissions_scoped_read" on public.submissions for select to authenticated
  using (
    (public.has_role((select auth.uid()), 'student') and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid())))
    or exists (select 1 from public.assignments a where a.id = assignment_id and public.can_manage_offering((select auth.uid()), a.course_offering_id))
  );
create policy "submissions_student_insert" on public.submissions for insert to authenticated
  with check (
    public.has_role((select auth.uid()), 'student')
    and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid()))
    and exists (
      select 1 from public.assignments a join public.enrollments e on e.course_offering_id = a.course_offering_id
      where a.id = assignment_id and a.published_at is not null
        and e.student_id = submissions.student_id and e.status = 'enrolled'
    )
  );
create policy "submissions_staff_manage" on public.submissions for all to authenticated
  using (exists (select 1 from public.assignments a where a.id = assignment_id and public.can_manage_offering((select auth.uid()), a.course_offering_id)))
  with check (exists (select 1 from public.assignments a where a.id = assignment_id and public.can_manage_offering((select auth.uid()), a.course_offering_id)));

-- Fee structure is visible to users; invoices/payments are private to the student and financial admins.
create policy "fee_items_read" on public.fee_items for select to authenticated using (true);
create policy "fee_items_admin_manage" on public.fee_items for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "invoices_scoped_read" on public.student_invoices for select to authenticated
  using (public.has_role((select auth.uid()), 'student') and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid())));
create policy "invoices_admin_manage" on public.student_invoices for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "invoice_lines_scoped_read" on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.student_invoices i where i.id = invoice_id and public.can_access_student((select auth.uid()), i.student_id)));
create policy "invoice_lines_admin_manage" on public.invoice_lines for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "payments_scoped_read" on public.payments for select to authenticated
  using (exists (select 1 from public.student_invoices i where i.id = invoice_id and public.can_access_student((select auth.uid()), i.student_id)));
create policy "payments_admin_manage" on public.payments for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));

-- Untargeted published notices are college-wide. Targeted notices require a matching role and scope.
create policy "notices_visible_to_targets" on public.notices for select to authenticated
  using (public.has_role((select auth.uid()), 'super_admin') or public.is_notice_visible((select auth.uid()), id));
create policy "notices_admin_manage" on public.notices for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "notice_targets_scoped_read" on public.notice_targets for select to authenticated
  using (public.has_role((select auth.uid()), 'super_admin'));
create policy "notice_targets_admin_manage" on public.notice_targets for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));

-- Documents are private by default; visibility follows owner, department, course, or college scope.
create policy "documents_scoped_read" on public.documents for select to authenticated
  using (
    (public.has_role((select auth.uid()), 'super_admin') or public.has_role((select auth.uid()), 'student')
      or public.has_role((select auth.uid()), 'faculty') or public.has_role((select auth.uid()), 'hod'))
    and (owner_id = (select auth.uid())
      or public.has_role((select auth.uid()), 'super_admin')
      or classification = 'college'
      or (classification = 'department' and public.can_access_department((select auth.uid()), department_id))
      or (classification = 'course' and public.can_access_course((select auth.uid()), course_id)))
  );
create policy "documents_upload_own" on public.documents for insert to authenticated
  with check (
    owner_id = (select auth.uid()) and uploaded_by = (select auth.uid()) and (
      classification = 'private'
      or (classification = 'department' and
        (public.has_role((select auth.uid()), 'faculty') or public.has_role((select auth.uid()), 'hod'))
        and public.can_access_department((select auth.uid()), department_id))
      or (classification = 'course' and
        (public.has_role((select auth.uid()), 'faculty') or public.has_role((select auth.uid()), 'hod'))
        and public.can_access_course((select auth.uid()), course_id))
    )
  );
create policy "documents_admin_manage" on public.documents for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));

-- Embedding access always inherits the source document's RLS scope. Only the AI worker writes chunks.
alter table public.knowledge_documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.knowledge_documents, public.document_chunks, public.chat_threads, public.chat_messages from anon;
grant select on public.knowledge_documents, public.document_chunks, public.chat_threads, public.chat_messages to authenticated;
create policy "knowledge_documents_scoped_read" on public.knowledge_documents for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));
create policy "knowledge_documents_admin_manage" on public.knowledge_documents for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "document_chunks_scoped_read" on public.document_chunks for select to authenticated
  using (exists (select 1 from public.knowledge_documents kd join public.documents d on d.id = kd.document_id
    where kd.id = knowledge_document_id));
create policy "chat_threads_owner_read" on public.chat_threads for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "chat_messages_owner_read" on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_threads t where t.id = thread_id and t.owner_id = (select auth.uid())));

-- Search is SECURITY INVOKER: PostgreSQL applies document_chunks and documents RLS before returning results.
create or replace function public.match_authorized_document_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  filter_department_id uuid default null,
  filter_course_id uuid default null
)
returns table (chunk_id uuid, document_id uuid, document_name text, content text, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select chunk.id, doc.id, doc.original_name, chunk.content,
    1 - (chunk.embedding <=> query_embedding) as similarity
  from public.document_chunks chunk
  join public.knowledge_documents kd on kd.id = chunk.knowledge_document_id and kd.processing_status = 'ready'
  join public.documents doc on doc.id = kd.document_id
  where (filter_department_id is null or doc.department_id = filter_department_id)
    and (filter_course_id is null or doc.course_id = filter_course_id)
  order by chunk.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 8), 20));
$$;
revoke all on function public.match_authorized_document_chunks(extensions.vector, integer, uuid, uuid) from public;
grant execute on function public.match_authorized_document_chunks(extensions.vector, integer, uuid, uuid) to authenticated;

create policy "complaints_scoped_read" on public.complaints for select to authenticated
  using (
    (public.has_role((select auth.uid()), 'student') and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid())))
    or public.has_role((select auth.uid()), 'super_admin')
    or exists (
      select 1 from public.students s join public.courses c on c.id = s.course_id
      where s.id = student_id and public.is_hod_for_department((select auth.uid()), c.department_id)
    )
  );
create policy "complaints_student_create" on public.complaints for insert to authenticated
  with check (public.has_role((select auth.uid()), 'student') and exists (select 1 from public.students s where s.id = student_id and s.profile_id = (select auth.uid())));
create policy "complaints_admin_manage" on public.complaints for all to authenticated
  using (public.has_role((select auth.uid()), 'super_admin')) with check (public.has_role((select auth.uid()), 'super_admin'));
create policy "complaints_hod_update" on public.complaints for update to authenticated
  using (exists (
    select 1 from public.students s join public.courses c on c.id = s.course_id
    where s.id = student_id and public.is_hod_for_department((select auth.uid()), c.department_id)
  ))
  with check (exists (
    select 1 from public.students s join public.courses c on c.id = s.course_id
    where s.id = student_id and public.is_hod_for_department((select auth.uid()), c.department_id)
  ));

revoke all on function public.is_hod_for_department(uuid, uuid) from public;
revoke all on function public.is_faculty_for_offering(uuid, uuid) from public;
revoke all on function public.is_student_in_offering(uuid, uuid) from public;
revoke all on function public.can_access_department(uuid, uuid) from public;
revoke all on function public.can_access_course(uuid, uuid) from public;
revoke all on function public.can_access_offering(uuid, uuid) from public;
revoke all on function public.can_manage_offering(uuid, uuid) from public;
revoke all on function public.can_access_student(uuid, uuid) from public;
revoke all on function public.can_access_enrollment(uuid, uuid) from public;
revoke all on function public.can_manage_enrollment(uuid, uuid) from public;
revoke all on function public.is_notice_visible(uuid, uuid) from public;
grant execute on function public.is_hod_for_department(uuid, uuid) to authenticated;
grant execute on function public.is_faculty_for_offering(uuid, uuid) to authenticated;
grant execute on function public.is_student_in_offering(uuid, uuid) to authenticated;
grant execute on function public.can_access_department(uuid, uuid) to authenticated;
grant execute on function public.can_access_course(uuid, uuid) to authenticated;
grant execute on function public.can_access_offering(uuid, uuid) to authenticated;
grant execute on function public.can_manage_offering(uuid, uuid) to authenticated;
grant execute on function public.can_access_student(uuid, uuid) to authenticated;
grant execute on function public.can_access_enrollment(uuid, uuid) to authenticated;
grant execute on function public.can_manage_enrollment(uuid, uuid) to authenticated;
grant execute on function public.is_notice_visible(uuid, uuid) to authenticated;

-- Server-rendered dashboard aggregates. SECURITY INVOKER keeps table RLS in force.
create or replace function public.get_dashboard_metrics(
  p_role public.app_role,
  p_department_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  student_record_id uuid;
  faculty_record_id uuid;
  total_attendance bigint;
  present_attendance bigint;
begin
  if current_user_id is null or not public.has_role(current_user_id, p_role) then
    raise exception 'Role is not assigned to this account' using errcode = '42501';
  end if;

  if p_role = 'super_admin' then
    return jsonb_build_object(
      'students', (select count(*) from public.students),
      'faculty', (select count(*) from public.faculty),
      'departments', (select count(*) from public.departments),
      'payments', (select count(*) from public.payments where status = 'paid')
    );
  elsif p_role = 'faculty' then
    select id into faculty_record_id from public.faculty where profile_id = current_user_id;
    return jsonb_build_object(
      'classes', (select count(*) from public.course_offerings where faculty_id = faculty_record_id and status = 'active'),
      'students', (select count(distinct e.student_id) from public.enrollments e
        join public.course_offerings o on o.id = e.course_offering_id
        where o.faculty_id = faculty_record_id and e.status = 'enrolled'),
      'attendance', (select count(*) from public.attendance_sessions a
        join public.course_offerings o on o.id = a.course_offering_id where o.faculty_id = faculty_record_id),
      'upcoming', (select count(*) from public.assignments a
        join public.course_offerings o on o.id = a.course_offering_id
        where o.faculty_id = faculty_record_id and a.due_at >= now())
    );
  elsif p_role = 'student' then
    select id into student_record_id from public.students where profile_id = current_user_id;
    select count(*) filter (where ar.status in ('present', 'absent')),
      count(*) filter (where ar.status = 'present')
      into total_attendance, present_attendance
      from public.attendance_records ar
      join public.enrollments e on e.id = ar.enrollment_id
      where e.student_id = student_record_id;
    return jsonb_build_object(
      'subjects', (select count(*) from public.enrollments where student_id = student_record_id and status = 'enrolled'),
      'attendance', case when total_attendance = 0 then null else round(100.0 * present_attendance / total_attendance, 1) end,
      'semesters', (select count(distinct sem.id) from public.enrollments e
        join public.course_offerings o on o.id = e.course_offering_id
        join public.semesters sem on sem.id = o.semester_id
        where e.student_id = student_record_id and e.status = 'enrolled' and sem.status = 'active'),
      'fees', (select count(*) from public.student_invoices
        where student_id = student_record_id and status in ('pending', 'partially_paid', 'overdue'))
    );
  elsif p_role = 'hod' then
    if p_department_id is null or not public.is_hod_for_department(current_user_id, p_department_id) then
      raise exception 'Department is not assigned to this HOD' using errcode = '42501';
    end if;
    select count(*) filter (where ar.status in ('present', 'absent')),
      count(*) filter (where ar.status = 'present')
      into total_attendance, present_attendance
      from public.attendance_records ar
      join public.enrollments e on e.id = ar.enrollment_id
      join public.students s on s.id = e.student_id
      join public.courses c on c.id = s.course_id
      where c.department_id = p_department_id;
    return jsonb_build_object(
      'students', (select count(*) from public.students s join public.courses c on c.id = s.course_id where c.department_id = p_department_id),
      'faculty', (select count(*) from public.faculty where department_id = p_department_id),
      'courses', (select count(*) from public.courses where department_id = p_department_id),
      'attendance', case when total_attendance = 0 then null else round(100.0 * present_attendance / total_attendance, 1) end
    );
  end if;
  raise exception 'Unsupported dashboard role' using errcode = '22023';
end;
$$;

revoke all on function public.get_dashboard_metrics(public.app_role, uuid) from public;
grant execute on function public.get_dashboard_metrics(public.app_role, uuid) to authenticated;

-- Private object storage. Object keys begin with the uploader's auth user UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'erp-documents', 'erp-documents', false, 26214400,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "erp_storage_upload_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'erp-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "erp_storage_read_authorized" on storage.objects for select to authenticated
  using (
    bucket_id = 'erp-documents' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.has_role((select auth.uid()), 'super_admin')
      or exists (select 1 from public.documents d where d.storage_path = name)
    )
  );
create policy "erp_storage_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'erp-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'erp-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "erp_storage_delete_own_or_admin" on storage.objects for delete to authenticated
  using (bucket_id = 'erp-documents' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.has_role((select auth.uid()), 'super_admin')
  ));

