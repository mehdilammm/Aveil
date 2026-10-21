export default function AiTrafficPage() {
  return (
    <>
      <div className="page-head">
        <h1>AI Traffic</h1>
        <p className="sub">Visits from AI assistants and shopping agents.</p>
      </div>
      <div className="card empty">
        <strong>Not connected yet</strong>
        <p>Traffic data is not collected for this store yet, so there is nothing to show. No numbers are estimated.</p>
      </div>
    </>
  );
}
