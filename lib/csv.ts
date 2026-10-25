// CSV export. Cells that a spreadsheet would run as a formula are prefixed with an apostrophe, also when the
// formula sign comes after spaces (some spreadsheets trim them) or the cell starts with a tab or line break.
export const FORMULA_START = /^(\s*[=+\-@]|[\t\r\n])/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
