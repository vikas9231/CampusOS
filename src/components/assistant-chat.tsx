"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, FileUp, MessageCircle, Plus, RefreshCw, Send, Sparkles, Trash2, UserRound } from "lucide-react";
import type { Role } from "@/types/auth";

type Citation = { document_id: string; title: string; similarity: number };
type SourceType = "live_erp" | "documents";
type Message = { id?: string; message_role: "user" | "assistant"; content: string; citations: Citation[]; source_types?: SourceType[]; created_at?: string };
type Thread = { id: string; context_role: Role; created_at: string; updated_at: string };
type KnowledgeDocument = { id: string; title: string; status: string; sizeBytes: number; createdAt: string; processedAt: string | null; errorCode: string | null };

export function AssistantChat({ role, initialThreads, initialMessages }: { role: Role; initialThreads: Thread[]; initialMessages: Message[] }) {
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(initialThreads[0]?.id || null);
  const [messages, setMessages] = useState(initialMessages);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [uploadState, setUploadState] = useState("");
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [documentError, setDocumentError] = useState("");
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentAction, setDocumentAction] = useState("");
  const [serviceReady, setServiceReady] = useState<boolean | null>(null);

  async function loadDocuments() {
    setDocumentsLoading(true);
    try {
      const response = await fetch("/api/assistant/documents", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Document list could not be loaded.");
      setDocumentError("");
      setDocuments(result.documents || []);
    } finally { setDocumentsLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/assistant/chat?health=1", { cache: "no-store" }).then((response) => {
      if (active) setServiceReady(response.ok);
    }).catch(() => { if (active) setServiceReady(false); });
    if (role === "super_admin") void loadDocuments().catch((loadError) => {
      if (active) setDocumentError(loadError instanceof Error ? loadError.message : "Document list could not be loaded.");
    });
    return () => { active = false; };
  }, [role]);

  async function openThread(id: string) {
    setThreadId(id);
    setError("");
    try {
      const response = await fetch(`/api/assistant/chat?role=${role}&threadId=${id}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Chat history could not be loaded.");
      setMessages(result.messages || []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Chat history could not be loaded."); }
  }

  function newThread() { setThreadId(null); setMessages([]); setError(""); }

  async function clearThread() {
    if (!threadId) { newThread(); return; }
    setPending(true); setError("");
    try {
      const response = await fetch("/api/assistant/chat", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, threadId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Conversation could not be cleared.");
      setMessages([]);
    } catch (clearError) { setError(clearError instanceof Error ? clearError.message : "Conversation could not be cleared."); }
    finally { setPending(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 2 || pending) return;
    setQuestion("");
    setError("");
    setMessages((current) => [...current, { message_role: "user", content: text, citations: [] }]);
    setPending(true);
    try {
      const response = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, message: text, threadId: threadId || undefined }) });
      const result = await response.json();
      if (result.threadId) {
        setThreadId(result.threadId);
        setThreads((current) => current.some((thread) => thread.id === result.threadId) ? current : [{ id: result.threadId, context_role: role, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...current]);
      }
      if (!response.ok) throw new Error(result.error || "The assistant could not answer.");
      setMessages((current) => [...current, { message_role: "assistant", content: result.answer, citations: result.citations || [], source_types: result.sources || [] }]);
      setThreads((current) => current.some((thread) => thread.id === result.threadId) ? current : [{ id: result.threadId, context_role: role, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...current]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The assistant could not answer.");
    } finally { setPending(false); }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || !file.size) { setUploadState("Choose a PDF or DOCX file first."); return; }
    setUploading(true); setUploadState("");
    try {
      const response = await fetch("/api/assistant/documents", { method: "POST", body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Document processing failed.");
      setUploadState(`${result.title} is indexed and available to the assistant.`);
      form.reset();
      await loadDocuments().catch((loadError) => setDocumentError(loadError instanceof Error ? loadError.message : "Document list could not be loaded."));
    } catch (uploadError) {
      setUploadState(uploadError instanceof Error ? uploadError.message : "Document processing failed.");
      await loadDocuments().catch((loadError) => setDocumentError(loadError instanceof Error ? loadError.message : "Document list could not be loaded."));
    } finally { setUploading(false); }
  }

  async function manageDocument(documentId: string, action: "retry" | "remove") {
    const key = `${documentId}:${action}`;
    setDocumentAction(key); setDocumentError("");
    try {
      const response = action === "retry"
        ? await fetch("/api/assistant/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, documentId }) })
        : await fetch(`/api/assistant/documents?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Document ${action} failed.`);
      await loadDocuments();
    } catch (actionError) { setDocumentError(actionError instanceof Error ? actionError.message : `Document ${action} failed.`); }
    finally { setDocumentAction(""); }
  }

  return <div className="assistant-page"><div className="welcome-row"><div><p className="eyebrow">CAMPUS KNOWLEDGE</p><h1>AI Assistant</h1><p className="page-subtitle">Ask about college documents and the ERP information available to your role.</p></div><div className="today-pill"><Sparkles size={15} /> {serviceReady === null ? "Connecting" : serviceReady ? "Assistant online" : "Assistant offline"}</div></div>
    <div className="assistant-layout"><aside className="assistant-history work-panel"><button className="button primary full" type="button" onClick={newThread}><Plus size={15} /> New conversation</button>{threadId && <button className="button secondary full" type="button" onClick={() => void clearThread()} disabled={pending}><Trash2 size={14} /> Clear conversation</button>}<p className="assistant-history-label">RECENT CONVERSATIONS</p>{threads.length ? threads.map((thread) => <button className={`assistant-thread ${thread.id === threadId ? "selected" : ""}`} type="button" key={thread.id} onClick={() => void openThread(thread.id)}><MessageCircle size={15} /><span>{thread.created_at.slice(0, 10)} conversation</span></button>) : <p className="assistant-hint">Your conversations will appear here.</p>}
      {role === "super_admin" && <div className="assistant-upload"><div className="assistant-upload-title"><FileUp size={16} /><strong>Knowledge documents</strong></div><p>PDF and DOCX files up to 25 MB are stored privately and indexed for authorized search.</p><form onSubmit={uploadDocument}><input type="file" name="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /><button className="button secondary full" type="submit" disabled={uploading}>{uploading ? "Indexing…" : "Upload and index"}</button></form>{uploadState && <p className="assistant-upload-status" role="status">{uploadState}</p>}{documentError && <p className="notice error" role="alert">{documentError}</p>}{documents.length ? <div className="assistant-document-list">{documents.map((document) => <div className="assistant-document" key={document.id}><strong title={document.title}>{document.title}</strong><span>Status: {document.status}{document.errorCode ? ` (${document.errorCode})` : ""}</span><div><button type="button" className="assistant-document-action" disabled={!!documentAction} onClick={() => void manageDocument(document.id, "retry")} aria-label={`Retry ${document.title}`}><RefreshCw size={13} /> {documentAction === `${document.id}:retry` ? "Retrying" : "Retry"}</button><button type="button" className="assistant-document-action danger" disabled={!!documentAction} onClick={() => void manageDocument(document.id, "remove")} aria-label={`Remove ${document.title}`}><Trash2 size={13} /> Remove</button></div></div>)}</div> : <p className="assistant-hint">{documentsLoading ? "Loading documents…" : documentError ? "Document list unavailable." : "No knowledge documents have been uploaded."}</p>}</div>}
    </aside><section className="assistant-conversation work-panel"><div className="assistant-messages" aria-live="polite">{messages.length === 0 && <div className="assistant-welcome"><div className="assistant-orb"><Bot size={21} /></div><h2>What would you like to know?</h2><p>Current ERP answers use records available to your role. College policy questions use retrieved documents and include citations.</p><div className="assistant-suggestions"><button type="button" onClick={() => setQuestion("What is my current attendance percentage?")}>What is my current attendance percentage?</button><button type="button" onClick={() => setQuestion("What are the attendance requirements?")}>What are the attendance requirements?</button></div></div>}
      {messages.map((message, index) => <article className={`assistant-message ${message.message_role}`} key={message.id || `${index}-${message.message_role}`}><div className="assistant-message-icon">{message.message_role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}</div><div className="assistant-message-body"><div className="assistant-message-label">{message.message_role === "assistant" ? "CampusOS Assistant" : "You"}</div>{message.message_role === "assistant" && !!message.source_types?.length && <div className="assistant-source-indicators">{message.source_types.includes("live_erp") && <span>Live ERP data</span>}{message.source_types.includes("documents") && <span>College documents</span>}</div>}<p>{message.content}</p>{message.citations?.length > 0 && <div className="assistant-citations"><span>Document sources</span>{message.citations.map((citation) => <div key={citation.document_id}>{citation.title}</div>)}</div>}</div></article>)}
      {pending && <div className="assistant-typing"><span /><span /><span /> Checking authorized data sources…</div>}
    </div>{error && <p className="notice error" role="alert">{error}</p>}<form className="assistant-composer" onSubmit={sendMessage}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your attendance, courses, fees, or college policies…" maxLength={4000} rows={2} aria-label="Your question" /><button className="button primary" type="submit" disabled={pending || question.trim().length < 2} aria-label="Send question"><Send size={16} /> Send</button><small>ERP answers are role scoped. Do not enter passwords or sensitive personal information.</small></form></section></div>
    <p className="data-note"><Sparkles size={13} /> {serviceReady === null ? "Checking assistant service…" : serviceReady ? "Assistant service connected. Private source access is enforced by Supabase row-level security." : "Assistant service is unavailable. Check the service configuration."}</p></div>;
}
