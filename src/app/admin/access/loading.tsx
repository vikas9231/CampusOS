export default function AccessManagementLoading() {
  return <section className="panel directory-panel registration-requests-panel" aria-busy="true" aria-label="Loading registration requests">
    <div className="panel-heading"><div><h2>Registration requests</h2><p>Loading student and faculty access requests…</p></div></div>
    <div className="registration-request-list"><div className="inline-empty">Loading requests and account details…</div></div>
  </section>;
}
