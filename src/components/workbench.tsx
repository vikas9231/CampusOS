"use client";

import { useMemo, useState, useActionState, useEffect, useTransition, useId } from "react";
import { ArrowDownUp, Search } from "lucide-react";
import { createModuleRecord, updateModuleRecord, saveAttendance, getAttendanceRoster, type ModuleActionState, type AttendanceRosterRow } from "@/app/actions/modules";
import type { WorkbenchData } from "@/lib/workbench-data";
import type { WorkbenchField } from "@/lib/workbench";

const initial: ModuleActionState = {};

function Field({ field, options, optionError, value }: { field: WorkbenchField; options: { value: string; label: string }[]; optionError?: string; value?: unknown }) {
  const id = useId();
  const defaultValue = value === null || value === undefined ? "" : String(value);
  const isCourseSelect = field.type === "select" && field.options === "courses";
  return <label className="work-field" htmlFor={id}><span>{field.label}{field.required && <b> *</b>}</span>{field.type === "textarea" ? <textarea id={id} name={field.name} required={field.required} defaultValue={defaultValue} rows={3} maxLength={5000} /> : field.type === "select" ? <><select id={id} name={field.name} required={field.required} defaultValue={defaultValue}><option value="" disabled={Boolean(optionError) || (isCourseSelect && options.length === 0)}>{optionError ? "Courses unavailable" : isCourseSelect && options.length === 0 ? "No active courses" : "Choose…"}</option>{!optionError && options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{optionError ? <small className="notice error" role="alert">{optionError}</small> : isCourseSelect && options.length === 0 ? <small className="work-roster-note">No active courses are available. Add or activate a course in the Courses section.</small> : null}</> : <input id={id} name={field.name} type={field.type || "text"} required={field.required} min={field.min} max={field.max} step={field.step} maxLength={field.type === "number" ? undefined : 500} defaultValue={field.type === "datetime-local" && defaultValue ? defaultValue.slice(0, 16) : defaultValue} />}</label>;
}

function ActionFeedback({ state }: { state: ModuleActionState }) {
  return <>{state.error && <p className="notice error" role="alert">{state.error}</p>}{state.success && <p className="notice success" role="status">{state.success}</p>}</>;
}

function CreateRecord({ data }: { data: WorkbenchData }) {
  const [state, action, pending] = useActionState(createModuleRecord, initial);
  const fields = data.spec.fields.filter((field) => field.create !== false);
  if (fields.length === 0) return null;
  return <section className="work-panel create-record"><div className="work-panel-heading"><div><h2>Add record</h2><p>Inputs are validated on the server and checked by database constraints.</p></div></div><form action={action} className="work-form"><input type="hidden" name="portal_role" value={data.role} /><input type="hidden" name="module_key" value={data.key} />{fields.map((field) => <Field key={field.name} field={field} options={field.options ? data.options[field.options] || [] : []} optionError={field.options ? data.optionErrors[field.options] : undefined} />)}<div className="work-submit"><button className="button primary" type="submit" disabled={pending || Boolean(data.optionErrors.courses) || (fields.some((field) => field.options === "courses") && (data.options.courses || []).length === 0)}>{pending ? "Saving…" : "Save record"}</button><ActionFeedback state={state} /></div></form></section>;
}

function EditRecord({ data, row }: { data: WorkbenchData; row: Record<string, unknown> }) {
  const [state, action, pending] = useActionState(updateModuleRecord, initial);
  const fields = data.spec.fields.filter((field) => field.update !== false);
  if (fields.length === 0) return null;
  return <details className="row-editor"><summary>Edit record</summary><form action={action} className="work-form compact-form"><input type="hidden" name="portal_role" value={data.role} /><input type="hidden" name="module_key" value={data.key} /><input type="hidden" name="record_id" value={String(row.id)} />{fields.map((field) => <Field key={field.name} field={field} options={field.options ? data.options[field.options] || [] : []} optionError={field.options ? data.optionErrors[field.options] : undefined} value={row[field.name]} />)}<div className="work-submit"><button className="button secondary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button><ActionFeedback state={state} /></div></form></details>;
}

function AttendanceMarker({ data }: { data: WorkbenchData }) {
  const [state, action, pending] = useActionState(saveAttendance, initial);
  const [offering, setOffering] = useState("");
  const [roster, setRoster] = useState<AttendanceRosterRow[]>([]);
  const [rosterError, setRosterError] = useState("");
  const [loadingRoster, startRosterLoad] = useTransition();
  useEffect(() => {
    if (!offering) { setRoster([]); setRosterError(""); return; }
    startRosterLoad(async () => {
      const result = await getAttendanceRoster(offering);
      setRoster(result.rows);
      setRosterError(result.error || "");
    });
  }, [offering]);
  return <section className="work-panel create-record"><div className="work-panel-heading"><div><h2>Mark class attendance</h2><p>Choose each student’s status; records are saved together for this session.</p></div></div><form action={action} className="work-form"><input type="hidden" name="portal_role" value="faculty" /><label className="work-field"><span>Course offering *</span><select name="course_offering_id" value={offering} required onChange={(event) => setOffering(event.target.value)}><option value="">Choose a class</option>{(data.options.offerings || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="work-field"><span>Session date *</span><input name="session_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label className="work-field"><span>Session label</span><input name="session_label" maxLength={120} placeholder="Lecture, lab, etc." /></label>{loadingRoster ? <p className="work-roster-note">Loading enrolled students…</p> : rosterError ? <p className="notice error work-roster-note">{rosterError}</p> : offering && roster.length === 0 ? <p className="work-roster-note">No enrolled students found for this class.</p> : null}{roster.length > 0 && <div className="attendance-roster"><div className="attendance-roster-heading"><strong>{roster.length} enrolled students</strong><span>Set each attendance status</span></div>{roster.map((student) => <label className="attendance-roster-row" key={student.id}><span><strong>{student.studentName}</strong><small>{student.enrollmentNumber}</small></span><select name={`attendance_${student.id}`} defaultValue="present" aria-label={`Attendance status for ${student.studentName}`}><option value="present">Present</option><option value="absent">Absent</option><option value="excused">Excused</option></select></label>)}</div>}<div className="work-submit"><button className="button primary" type="submit" disabled={pending || loadingRoster || !offering || roster.length === 0}>{pending ? "Saving…" : "Save attendance"}</button><ActionFeedback state={state} /></div></form></section>;
}

function displayValue(value: unknown, labels: Record<string, string>) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (labels[text]) return labels[text];
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text)) return `${text.slice(0, 8)}…`;
  return text.replaceAll("_", " ");
}

export function Workbench({ data }: { data: WorkbenchData }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.rows;
    return data.rows.filter((row) => data.spec.columns.some(({ key }) => displayValue(row[key], data.valueLabels).toLowerCase().includes(query)));
  }, [data, search]);
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize);

  return <><div className="welcome-row"><div><p className="eyebrow">ERP MODULE</p><h1>{data.spec.title}</h1><p className="page-subtitle">{data.spec.description}</p></div><div className="today-pill"><ArrowDownUp size={15} /> RLS protected</div></div>{data.error && <p className="notice error" role="alert">{data.error}</p>}{data.role === "faculty" && data.key === "attendance" ? <AttendanceMarker data={data} /> : <CreateRecord data={data} />}<section className="work-panel records-panel"><div className="work-panel-heading"><div><h2>Records</h2><p>{filteredRows.length} rows visible to your role</p></div><label className="table-search"><Search size={15} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Filter these records" aria-label="Filter records" /></label></div>{pageRows.length === 0 ? <div className="work-empty"><strong>{search ? "No matching records" : "No records yet"}</strong><span>{search ? "Change the filter and try again." : "Add the first record or wait for a related module to create it."}</span></div> : <div className="directory-table-wrap"><table className="directory-table work-table"><thead><tr>{data.spec.columns.map((column) => <th key={column.key}>{column.label}</th>)}{data.spec.fields.some((field) => field.update !== false) && <th>Actions</th>}</tr></thead><tbody>{pageRows.map((row) => <tr key={String(row.id)}>{data.spec.columns.map(({ key }) => <td key={key}>{displayValue(row[key], data.valueLabels)}</td>)}{data.spec.fields.some((field) => field.update !== false) && <td><EditRecord data={data} row={row} /></td>}</tr>)}</tbody></table></div>}<div className="table-pager"><span>Page {page + 1} of {pageCount}</span><div><button className="button secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button><button className="button secondary" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>Next</button></div></div></section></>;
}
