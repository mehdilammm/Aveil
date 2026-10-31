// Shown while a store page loads its data: the page's shape, not a spinner.
export default function Loading() {
  return (
    <div aria-busy="true">
      <div className="skeleton skeleton-line" style={{ width: "40%", height: 24 }} />
      <div className="skeleton skeleton-line" style={{ width: "65%" }} />
      <div className="stat-strip">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 88 }} />)}
      </div>
      <div className="skeleton skeleton-block" style={{ height: 140 }} />
      <div className="skeleton skeleton-block" />
      <div className="skeleton skeleton-block" />
    </div>
  );
}
