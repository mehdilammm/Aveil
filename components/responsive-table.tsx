// A table on desktop, one card per row on phones (labels come from the column headers).
export function ResponsiveTable({ columns, rows, numeric = [] }: { columns: string[]; rows: React.ReactNode[][]; numeric?: number[] }) {
  return (
    <div className="table-wrap">
      <table className="rtable">
        <thead><tr>{columns.map((c, i) => <th key={i} className={numeric.includes(i) ? "num" : undefined}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((cell, j) => <td key={j} data-label={columns[j]} className={numeric.includes(j) ? "num" : undefined}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
