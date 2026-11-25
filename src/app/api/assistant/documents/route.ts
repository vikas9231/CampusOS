import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_SIZE = 25 * 1024 * 1024;

async function adminSession() {
  if (!isSupabaseConfigured()) return { error: NextResponse.json({ error: "Supabase is not configured on the server." }, { status: 503 }) };
  if (!process.env.RAG_SERVICE_URL || !process.env.RAG_SERVICE_TOKEN) return { error: NextResponse.json({ error: "AI document service configuration is missing. Set RAG_SERVICE_URL and RAG_SERVICE_TOKEN in .env.local, then restart Next.js." }, { status: 503 }) };
  const context = await getAuthContext();
  if (!context) return { error: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) };
  if (!context.assignments.some((assignment) => assignment.role === "super_admin")) return { error: NextResponse.json({ error: "Only a Super Admin can manage knowledge documents." }, { status: 403 }) };
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { error: NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 }) };
  return { token: session.access_token };
}

async function forward(path: string, token: string, method = "GET", body?: BodyInit, timeoutMs = 30_000) {
  return fetch(`${process.env.RAG_SERVICE_URL!.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "X-Internal-Token": process.env.RAG_SERVICE_TOKEN!, Authorization: `Bearer ${token}` },
    body,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

export async function GET() {
  const auth = await adminSession();
  if (auth.error) return auth.error;
  try {
    const response = await forward("/v1/documents", auth.token);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: result.detail || "Document list could not be loaded." }, { status: response.status >= 500 ? 502 : response.status });
    const documents = (result.documents || []).map((document: { id: string; original_name: string; mime_type: string; size_bytes: number; created_at: string; knowledge?: { processing_status?: string; processed_at?: string; error_code?: string } | null }) => ({
      id: document.id, title: document.original_name, mimeType: document.mime_type, sizeBytes: document.size_bytes, createdAt: document.created_at,
      status: document.knowledge?.processing_status || "missing", processedAt: document.knowledge?.processed_at || null, errorCode: document.knowledge?.error_code || null,
    }));
    return NextResponse.json({ documents });
  } catch { return NextResponse.json({ error: "The AI document service could not be reached." }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  const auth = await adminSession();
  if (auth.error) return auth.error;
  if (request.headers.get("content-type")?.includes("application/json")) {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
    if (!body || typeof body !== "object" || !("action" in body) || !("documentId" in body) || typeof body.documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.documentId)) {
      return NextResponse.json({ error: "Choose a valid document action." }, { status: 400 });
    }
    const action = (body as { action?: unknown }).action;
    if (action !== "retry") return NextResponse.json({ error: "Unsupported document action." }, { status: 400 });
    try {
      const response = await forward(`/v1/documents/${body.documentId}/retry`, auth.token, "POST");
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return NextResponse.json({ error: result.detail || "Document retry failed." }, { status: response.status >= 500 ? 502 : response.status });
      return NextResponse.json(result);
    } catch { return NextResponse.json({ error: "The AI document service could not be reached." }, { status: 503 }); }
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Choose a PDF or DOCX document." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF or DOCX document." }, { status: 400 });
  if (file.size < 1 || file.size > MAX_SIZE) return NextResponse.json({ error: "Files must be between 1 byte and 25 MB." }, { status: 413 });
  const name = file.name.toLowerCase();
  const validPdf = name.endsWith(".pdf") && file.type === "application/pdf";
  const validDocx = name.endsWith(".docx") && file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (!validPdf && !validDocx) return NextResponse.json({ error: "Upload a PDF or DOCX file." }, { status: 415 });

  const upstream = new FormData();
  upstream.set("file", file, file.name);
  try {
    const response = await forward("/v1/documents/ingest", auth.token, "POST", upstream, 280_000);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: result.detail || "Document indexing failed." }, { status: response.status >= 500 ? 502 : response.status });
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The AI ingestion service could not be reached." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await adminSession();
  if (auth.error) return auth.error;
  const documentId = request.nextUrl.searchParams.get("documentId");
  if (!documentId || !/^[0-9a-f-]{36}$/i.test(documentId)) return NextResponse.json({ error: "Choose a valid document." }, { status: 400 });
  try {
    const response = await forward(`/v1/documents/${documentId}`, auth.token, "DELETE");
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: result.detail || "Document removal failed." }, { status: response.status >= 500 ? 502 : response.status });
    return NextResponse.json(result);
  } catch { return NextResponse.json({ error: "The AI document service could not be reached." }, { status: 503 }); }
}
