# CampusOS

College ERP foundation built with Next.js App Router, TypeScript, and Supabase Auth/PostgreSQL.

## Implemented

- Email/password sign-in, signup with email confirmation support, password reset, password update, sign-out, and editable profile name.
- Server-side role checks for Super Admin, Faculty, Student, and HOD routes.
- Role-specific dashboard shells and quick access, with counts and attendance percentages from the scoped Supabase metrics function.
- Super Admin access directory for role assignment and removal. New signups cannot choose or grant their own role.
- Supabase migrations for identity, academic structure, attendance, assessments, fees, notices, documents, complaints, chat history, and pgvector chunks; includes scoped RLS, audit events, timetable collision constraints, and private Storage policies.
- Role-scoped ERP workbenches for departments, courses, academic years, semesters, subjects, students, faculty, offerings, enrollments, attendance sessions, exams, marks, assignments, submissions, fee items, invoices, payments, timetable, notices, complaints, and reports.
- Faculty bulk attendance marking by class roster, with server-side role checks, per-enrollment records, and database audit history.
- Server-validated create/edit forms and paginated searchable tables. Student/faculty provisioning uses narrow database RPCs; normal writes use the signed-in Supabase client so RLS remains active.
- Role-specific AI Assistant pages with private chat history, source citations, and Super Admin PDF/DOCX knowledge ingestion. The FastAPI RAG service verifies Supabase users, retrieves chunks through the existing SECURITY INVOKER RPC with that user's JWT/RLS, and stores embeddings in pgvector.
- Role-scoped dashboard metrics fetched through a `SECURITY INVOKER` PostgreSQL function, so table RLS remains active for aggregates.
- Responsive dashboard layout with mobile sidebar and pending-access view.

Dashboard cards query the database and do not use sample KPI values. The assistant uses role-allowlisted, read-only Supabase queries for live ERP questions and the existing pgvector/Gemini RAG flow for college documents. Each response persists source indicators and document citations. Payment settlement, fee receipts, student document download, student assignment uploads, CSV/PDF exports, and richer trend analytics still need their separate workflows.

## Local setup

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's URL and anon/public key. Set `NEXT_PUBLIC_SITE_URL` to the local origin (`http://localhost:3000`). Never put a service-role key in the browser environment.
3. Apply migrations in order: `202611170001_auth_and_roles.sql`, `202611170002_erp_schema.sql`, `202611170003_erp_workflows.sql`, `202611170004_workflow_access.sql`, `202611170005_rag_chat.sql`, `202611180001_login_profile_repair.sql`, `202611180002_registration_approval.sql`, `202611180003_registration_request_repair.sql`, `202611180004_assistant_chat_access.sql`, and `202611180005_assistant_source_types.sql`. Use the Supabase SQL editor or Supabase CLI.
4. In Supabase Auth URL configuration, set the site URL to your app and add `http://localhost:3000/auth/callback` to allowed redirect URLs. Add the staging/production callback URL when deploying.
5. Install dependencies with `npm install`, then run `npm run dev` and open `http://localhost:3000`.
6. Create the initial account using `/signup` and confirm its email if email confirmation is enabled.
7. Bootstrap the first Super Admin in the Supabase SQL editor as project owner, replacing the address:

   ```sql
   insert into public.role_assignments (user_id, role)
   select id, 'super_admin'::public.app_role
   from auth.users
   where email = 'admin@yourcollege.edu';
   ```

   Initial bootstrap is intentionally a database-owner operation. Afterward, Super Admins can assign roles through **People & access**. HOD roles require a department row. To add a starter catalog for local development, run `supabase/seed.sql`; it creates departments, courses, an academic year, semesters, and subjects without inventing student or staff accounts.
8. Configure `RAG_SERVICE_URL` and a long random `RAG_SERVICE_TOKEN` in the Next.js environment. Copy `ai_service/.env.example` to `ai_service/.env`, use the same token, and set the Supabase URL, anon key, server-only service-role key, `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL`, and `GEMINI_EMBEDDING_DIMENSION`. Keep provider keys and the service-role key out of Next.js `NEXT_PUBLIC_*` variables. The Gemini key belongs only in `ai_service/.env` or the AI service's secret store.
9. Start the AI service from `ai_service` using Python 3.11: create/activate a virtual environment, install `requirements.txt`, then run `uvicorn app.main:app --host 127.0.0.1 --port 8000`. Set `ALLOWED_WEB_ORIGIN` to the Next.js origin. The Next.js server calls the service; browsers never receive the internal token or provider keys.

### Gemini document embeddings

The AI service uses `gemini-embedding-001` with 1536 output dimensions. This matches `public.document_chunks.embedding vector(1536)`, its cosine HNSW index, and `match_authorized_document_chunks`; changing the dimension requires a coordinated database migration and complete reindex. Previously stored vectors must not be mixed with Gemini vectors. Reprocess existing knowledge documents with the Super Admin **Retry indexing** action after setting a valid Gemini key. Original PDFs and DOCX files remain in private Supabase Storage. A failed or pending document is not available to RAG until its status is `ready`.

## Auth and access behavior

- Signup creates a profile and a pending Student or Faculty role request through the database trigger; it never creates a role assignment. Super Admins review requests in **People & access**, and approval atomically creates the student/faculty academic record, role assignment, and reviewed request status. Authenticated users without an assigned role see their request state on the pending-access page.
- Role assignments are read from `public.role_assignments`; role decisions never trust a browser form, URL parameter, or editable auth metadata.
- `/admin/*`, `/faculty/*`, `/student/*`, and `/hod/*` are guarded in server layouts. RLS covers profiles, role assignments, departments, academic records, fees, documents, complaints, and audit logs.
- HOD role assignment is department-scoped; the assigned department is shown in the workspace switcher, and HOD queries are constrained to that department.
- Super Admins can see registered profiles. Users can update only their own name and avatar fields.
- Attendance, marks, fee records, student documents, complaint rows, and chat history have separate owner/staff scope policies. Dashboard aggregates and vector retrieval run as the caller so row policies still apply.
- The `erp-documents` Storage bucket is private. Object paths start with the uploader's auth UUID; document metadata further scopes shared course or department files.
- Chat threads are owner-scoped. Message inserts and generated answers are service-only; each retrieval call uses the caller's Supabase JWT and the database applies document RLS before returning vector matches. The ingestion service accepts only Super Admin uploads and currently makes them college-visible.

## Commands

- `npm run dev` — local development server
- `npm run build` — production build
- `npm run start` — production server
- `npm run typecheck` — TypeScript check

With the Supabase CLI installed and a local stack running, regenerate client database typings after schema changes with `supabase gen types typescript --local --schema public`. The current UI uses explicit ERP row/metrics types and server-side query boundaries; generated client typings can replace the current untyped Supabase client once the deployed schema is linked.

## Deployment notes

Deploy the Next.js app to a Node-compatible host and use separate Supabase projects for staging and production. Configure environment values in the hosting provider's secret store, then add the deployed `/auth/callback` URL to Supabase Auth's redirect allowlist. Apply migrations before deploying app changes that depend on them. Enable email confirmation and configure a production email provider before inviting users. Establish database backup, retention, and incident procedures before storing real student records.

Payment-provider callbacks, notifications, student file workflows, and production rate limiting/monitoring remain separate deployment work. The included AI rate limit is per service process and should be replaced or backed by a shared store for multi-instance production deployments. Never expose a Supabase service-role or Gemini key to the browser.
