# Smart College ERP Portal Architecture

## Repository assessment

The provided workspace is empty: it contains no application source, package manifest, database migrations, or Git repository. The attached project brief is therefore the only project specification available. This document defines a target architecture; it does not claim that any part of the system is already implemented.

## Architecture summary

Use a modular monolith for the ERP web application, backed by Supabase PostgreSQL, with a separately deployed FastAPI service for document ingestion and RAG chat. Keep the web application as the policy enforcement point for ERP operations: authenticated requests are authorized on the server, and PostgreSQL RLS independently limits database access. The AI service receives a verified user identity and scoped claims and applies the same access boundaries to retrieval.

```text
Browser
  | HTTPS, Supabase Auth session
  v
Next.js App Router
  |-- Server Components: read models and dashboards
  |-- Server Actions / Route Handlers: validated mutations and APIs
  |-- shared auth, authorization, validation, and domain services
  |-- Supabase server client (user JWT; RLS enforced)
  |-- private service client (narrow server-only jobs only)
  |-- FastAPI AI service (short-lived signed identity assertion)
       |-- document extraction, chunking, embeddings, retrieval, LLM
       |-- Supabase PostgreSQL + pgvector (tenant/role filtered)
       `-- Google Gemini API (server-side credentials)
  |
  `-- Supabase Storage (private buckets; signed URLs after authorization)
```

## Technology and deployment boundaries

- **Web application:** Next.js App Router and TypeScript. Tailwind CSS, shadcn/ui, and Lucide React form the UI system; React Hook Form and Zod handle forms; TanStack Table handles operational lists; Recharts handles analytics.
- **Backend-for-frontend:** Next.js Server Actions and Route Handlers. They own request validation, authorization checks, domain workflows, audit events, and response shaping. Keep domain logic in server-only modules rather than components.
- **Identity and persistence:** Supabase Auth and PostgreSQL. Use SQL migrations as the source of truth for schema, indexes, constraints, helper functions, and RLS policies. Supabase Storage holds private uploads.
- **AI service:** Python FastAPI, isolated from the UI deployment. It handles ingestion and chat orchestration, document parsing, chunking, embeddings, and retrieval. Use LangChain only at the integration/orchestration boundary; keep authorization and retrieval filters explicit and testable.
- **External model provider:** Google Gemini API called only from the AI service for chat and embeddings. Credentials are never exposed to browser code.
- **Environments:** Separate Supabase projects and secrets for local, staging, and production. Deploy Next.js and FastAPI independently, with TLS, health checks, structured logs, and managed secret configuration.

## Application layers and module ownership

Organize the Next.js application by feature, with shared infrastructure kept separate:

```text
src/
  app/                 routes, layouts, route handlers
  components/          shared UI primitives and shell
  features/
    students/ faculty/ departments/ courses/ enrollments/
    attendance/ exams/ assignments/ timetable/ fees/
    notices/ complaints/ documents/ analytics/ assistant/
  server/
    auth/               session, guards, permission helpers
    db/                 Supabase clients, generated database types
    services/           cross-feature workflows
    audit/              sensitive-action audit writer
    storage/            upload validation and signed URL helpers
  schemas/              shared Zod schemas
  lib/                  UI-safe shared helpers
supabase/
  migrations/
  seed.sql
ai-service/
  app/                  FastAPI routes and dependency wiring
  ingestion/            parsing, chunking, embedding jobs
  retrieval/            scoped search and answer generation
  tests/
```

Each feature owns its schemas, server-side queries/actions, and UI. Cross-feature workflows (for example, publishing examination results or generating a fee receipt) live in server services with explicit transaction boundaries. Do not let client components query tables directly for privileged workflows.

### Route and dashboard shape

- `/login`, `/forgot-password`, `/reset-password`
- `/admin/*`, `/faculty/*`, `/student/*`, `/hod/*`
- Shared authenticated shell with role-filtered navigation, profile menu, notifications, and responsive sidebar.
- Dashboard route resolution uses the authenticated profile and active role; the server redirects to the appropriate landing page. Hiding navigation is usability only, never authorization.
- Route handlers and Server Actions call a server-side permission guard on every operation, including reads that disclose private records.

## Identity, roles, and authorization

Supabase Auth establishes identity. A `profiles` record keyed by `auth.users.id` stores the person's common profile and account state. Role assignments are stored in relational tables rather than trusting user-editable profile metadata or client-supplied role values. A user can have one or more role assignments, with HOD assignment tied to a department.

Define permissions as server-side capabilities (for example `attendance.mark`, `results.publish`, `students.read_department`) and map each role to them. Enforce them at three layers:

1. **UI:** render only relevant navigation and actions.
2. **Server:** authenticate and authorize every query and mutation; validate input with Zod; scope queries to the actor's permitted student, subject, or department IDs.
3. **Database:** enable RLS on every user-facing table. Policies use stable helper functions for role, self, and department membership checks. Storage policies restrict each private bucket by owner, department, or explicitly authorized staff.

The Supabase service-role secret bypasses RLS. Keep it server-only and reserve it for narrowly scoped maintenance/ingestion tasks. Prefer user-scoped Supabase clients for ordinary ERP reads and writes. Any privileged job must independently validate its inputs, authorize its initiating actor, and write audit records.

### Role scope

- **Super Admin:** college-wide configuration and operational access; sensitive actions are audited.
- **Faculty:** assigned subjects/classes, rosters, attendance, learning materials, assignments, submissions, and marks within assigned teaching scope.
- **Student:** own profile, enrollment, attendance, results, fees, submissions, support requests, and documents; published course/college information as allowed.
- **HOD:** read and approve within the assigned department; department reports and faculty/course oversight. Department scope is derived server-side, not accepted from request parameters.

Define whether HOD can also act as faculty by combining role assignments, not by widening all HOD permissions. Establish approval and publication transitions for marks and academic requests before implementation.

## Domain and relational data model

Use UUID primary keys, `created_at`/`updated_at` timestamps, foreign keys, and explicit uniqueness constraints. Add `created_by`/`updated_by` where accountability matters. Store monetary amounts as integer minor units plus ISO currency (or fixed-precision numeric), never floating-point. Use soft deletion only where retention/audit needs require it; otherwise prefer explicit status transitions.

### Core identity and academic structure

- `profiles(id -> auth.users.id, name, contact, status)`
- `role_assignments(user_id, role, department_id nullable)`
- `departments(id, code, name, hod_profile_id)`
- `courses(id, department_id, code, name, duration, status)`
- `academic_years(id, name, start_date, end_date, status)`
- `semesters(id, academic_year_id, number, start_date, end_date)`
- `subjects(id, course_id, code, title, credits)`
- `students(id, profile_id, enrollment_number, course_id, admission_year, status)`
- `faculty(id, profile_id, employee_number, department_id, status)`
- `course_offerings(id, subject_id, semester_id, section, faculty_id)`
- `enrollments(id, student_id, course_offering_id, status)`

### Teaching and assessment

- `attendance_sessions(id, course_offering_id, session_date, created_by)` and `attendance_records(session_id, enrollment_id, status, marked_by, marked_at)`; unique `(session_id, enrollment_id)`.
- `examinations(id, semester_id, title, type, schedule/status)` and `exam_subjects(id, examination_id, course_offering_id, max_marks)`.
- `marks(id, exam_subject_id, enrollment_id, marks, entered_by, status, published_at)`; constrain marks to valid ranges and record revisions/audit events.
- `assignments(id, course_offering_id, title, due_at, attachment_id, status)` and `submissions(id, assignment_id, student_id, submitted_at, attachment_id, grade, feedback)`.
- `timetable_slots(id, course_offering_id, weekday, starts_at, ends_at, room_id)` and `rooms(id, building, name, capacity)`; enforce no overlapping room/faculty allocations with database constraints or a transactional scheduling function.

### Administration and supporting records

- `fee_items(id, course_id/semester_id, label, amount, due_at)`; `student_invoices(id, student_id, academic_year_id, status)` and `invoice_lines(invoice_id, fee_item_id, amount)`; `payments(id, invoice_id, amount, provider_reference, status, paid_at)`. Treat payment-provider callbacks as idempotent and verify signatures.
- `notices(id, author_id, title, body, published_at, expires_at)` and `notice_targets(notice_id, role, department_id, course_id)`.
- `complaints(id, student_id, category, body, status, assigned_to, resolution)`.
- `documents(id, storage_path, owner_id, department_id, classification, mime_type, size_bytes, checksum, uploaded_by)`; keep storage paths private and metadata authorization-aligned.
- `audit_logs(id, actor_id, action, entity_type, entity_id, before/after metadata, request_id, created_at)` with restricted insert/read access and no secrets or unnecessary sensitive content.
- `notifications` or an outbox table for durable in-app notifications, if the chosen delivery workflow requires them.

### RAG and assistant records

- `knowledge_documents(id, document_id, processing_status, visibility_scope, uploaded_by, processed_at, error_code)`.
- `document_chunks(id, knowledge_document_id, chunk_index, content, embedding vector, metadata)` with pgvector index and foreign-keyed source metadata. Use a controlled migration to enable pgvector and index the embedding column.
- `chat_threads(id, owner_id, created_at)` and `chat_messages(id, thread_id, role, content, citations, created_at)`; RLS allows a user to read their own thread. Avoid persisting unnecessary ERP answers or sensitive prompt payloads.

Use database views or server-side aggregate queries for dashboards. Attendance percentage is derived from eligible attendance sessions and present records under a clearly documented policy (for example, treatment of excused sessions). Do not store a mutable percentage as the source of truth.

## Key request and data flows

### Authenticated ERP operation

1. Browser submits to a Server Action or Route Handler with its Supabase session.
2. Server validates payload and resolves actor, active role, and scope from trusted database records.
3. Server checks the required capability and performs a user-scoped database operation.
4. RLS independently checks row access; database constraints protect invariants and concurrency.
5. Sensitive writes append an audit event in the same transaction where feasible; the response returns only fields needed by the client.

### Private file upload/download

1. Server checks operation permission and validates allowed MIME type, extension, and size.
2. Upload uses a short-lived signed URL or server-mediated upload to a private bucket and an unguessable path.
3. Server records document metadata and ownership/scope; ingestion is queued only for approved knowledge sources.
4. Download checks current access before issuing a short-lived signed URL. Never expose a permanent public URL for private student records.

### RAG ingestion and answer

1. An authorized administrator uploads a policy document and sets its visibility classification and targets.
2. An authenticated server-side workflow marks it pending; the AI worker downloads the private file using narrow service credentials, validates size/type, extracts text, chunks it, and computes embeddings.
3. Chunks retain document ID, visibility, and department/course scope. Failed processing records a safe error state and can be retried idempotently.
4. Chat request arrives at Next.js, which verifies the session, applies rate limits, resolves a minimal signed identity assertion (subject, role capabilities, department/course scopes, expiry, audience), then calls FastAPI over authenticated TLS.
5. FastAPI verifies the assertion, builds mandatory retrieval filters from those claims, retrieves only authorized chunks, and queries ERP facts through narrowly scoped server operations when needed. Never use an unfiltered vector search followed by prompt-based filtering.
6. The model receives retrieved context and an instruction to say when evidence is insufficient. The response includes citations to authorized source documents; the server persists the thread under its owner and returns the answer.

Personal data questions (such as “my attendance”) should use a typed, authorized ERP query/tool with the current user's scope, not embedding search over private records. Treat retrieved documents and user prompts as untrusted data; they cannot alter access rules or tool permissions. Do not return another student's records to a student, even if a document or prompt asks for them.

## Cross-cutting requirements

- **Validation:** Zod at web boundaries; Pydantic at FastAPI boundaries. Revalidate identities and scopes across the service boundary.
- **Concurrency and integrity:** foreign keys, unique constraints, check constraints, transactional functions where operations span multiple records, and idempotency keys for payment callbacks and ingestion jobs.
- **Audit:** log actor, action, entity, time, and request correlation ID for role changes, attendance edits, marks, fee/payment changes, approvals, exports, and document access/upload. Minimize stored personal data.
- **Uploads:** allowlist formats and size, inspect actual file content where practical, use randomized object keys, and reject unsupported or dangerous files. Do not execute uploaded content.
- **Abuse controls:** rate limit login-sensitive and AI endpoints; cap prompt/file sizes and model tokens; apply timeouts and request IDs; surface safe error messages.
- **Privacy:** define retention and deletion rules for records, chats, exports, and uploaded documents. Do not place secrets, raw credentials, or unnecessary student data in prompts or logs.
- **Observability:** structured logs and metrics for request latency, authorization failures, ingestion states, AI token/cost use, and database errors; redact tokens and sensitive fields.
- **Accessibility and resilience:** keyboard-accessible components, responsive layout, loading/empty/error states, pagination, and server-side filtering. Exports must use the same authorization scope as on-screen queries.

## Implementation sequence

1. Bootstrap Next.js, TypeScript, UI shell, lint/type-check tooling, environment templates, and local development documentation.
2. Create Supabase migrations for identity, academic structure, constraints, RLS helpers/policies, and seed data; validate policies with representative role scenarios.
3. Implement authentication, profile/role assignment, route guards, permission helpers, audit infrastructure, and private storage access.
4. Deliver core administration and academic setup (departments, courses, subjects, semesters, enrollments), then role-specific dashboards using real queries.
5. Add attendance and timetable, then assignments and submissions, then examinations, marks, and publication workflows.
6. Implement fees and verified payment integration, notices, complaints, and document management.
7. Build reporting and exports from scoped data; add indexes based on real query patterns.
8. Build FastAPI ingestion and scoped RAG chat after document classification and authorization rules are represented in schema and policies.
9. Prepare staging/production deployment, secret handling, backup/restore and retention procedures, operational monitoring, and end-to-end verification.

## Decisions to confirm during implementation

The brief does not specify a payment provider, academic grading rules, attendance shortage threshold, institution/tenant model, SSO requirement, document retention policy, or whether students/faculty may hold multiple roles. This architecture assumes one college per Supabase project, email/password authentication, configurable grading/attendance rules, and role assignments that may be multiple but explicitly scoped. These choices should become configuration or formal product decisions before the related modules are implemented.

## Environment configuration outline

Keep actual secrets out of the repository. An eventual `.env.example` should document names and safe placeholders for:

- Next.js: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`, `AI_SERVICE_URL`, and `AI_SERVICE_SIGNING_SECRET` (or asymmetric signing key configuration).
- FastAPI: Supabase URL and restricted service credentials, `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_EMBEDDING_DIMENSION`, signing-key verification configuration, allowed origins, and operational limits.

Only the Supabase URL and anon key are browser-public. Never prefix private credentials with `NEXT_PUBLIC_`; use separate credentials and signing keys per environment.
