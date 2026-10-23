// In-memory stand-in for the Supabase client in tests: tables are arrays of rows; supports the query calls the
// server code makes (select / insert / update / upsert / delete with eq, neq, in, is, not, gt, gte, lt, order, range,
// limit, single, maybeSingle). RPCs are passed in.
type Row = Record<string, unknown>;
type Rpc = (args: Record<string, unknown>) => unknown;

export function fakeSupabase(tables: Record<string, Row[]> = {}, rpcs: Record<string, Rpc> = {}, keys: Record<string, string[]> = {}) {
  let seq = 0;
  const from = (table: string) => {
    tables[table] ??= [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: Row | Row[] = {};
    let conflict: string[] = keys[table] ?? ["id"];
    const filters: ((r: Row) => boolean)[] = [];
    let range: [number, number] | null = null;
    let limit: number | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let returning = false;
    const q: Record<string, unknown> = {};
    const chain = (f: (r: Row) => boolean) => (filters.push(f), q);
    let columns: string[] | null = null;
    q.select = (cols?: string) => {
      returning = op !== "select" ? true : returning;
      // Simple column lists are projected like PostgREST does; "*" and embeds keep the whole row.
      if (op === "select" && cols && cols !== "*" && !cols.includes("(")) columns = cols.split(",").map((c) => c.trim());
      return q;
    };
    q.insert = (p: Row | Row[]) => ((op = "insert"), (payload = p), q);
    q.update = (p: Row) => ((op = "update"), (payload = p), q);
    q.upsert = (p: Row | Row[], o?: { onConflict?: string }) => ((op = "upsert"), (payload = p), (conflict = o?.onConflict?.split(",") ?? conflict), q);
    q.delete = () => ((op = "delete"), q);
    q.eq = (c: string, v: unknown) => chain((r) => r[c] === v);
    q.neq = (c: string, v: unknown) => chain((r) => r[c] !== v);
    q.in = (c: string, v: unknown[]) => chain((r) => v.includes(r[c]));
    q.is = (c: string, v: unknown) => chain((r) => (r[c] ?? null) === v);
    q.not = (c: string, _o: string, v: unknown) => chain((r) => (r[c] ?? null) !== v);
    q.ilike = (c: string, v: string) => chain((r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase());
    q.like = (c: string, v: string) => chain((r) => String(r[c] ?? "").startsWith(v.replace(/%$/, "")));
    q.gt = (c: string, v: string) => chain((r) => String(r[c] ?? "") > v);
    q.gte = (c: string, v: string) => chain((r) => String(r[c] ?? "") >= v);
    q.lt = (c: string, v: string) => chain((r) => String(r[c] ?? "") < v);
    q.order = (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), q);
    q.range = (a: number, b: number) => ((range = [a, b]), q);
    q.limit = (n: number) => ((limit = n), q);
    const run = () => {
      const rows = tables[table];
      const match = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: p.id ?? `${table}-${++seq}`, created_at: new Date().toISOString(), ...p }));
        rows.push(...list);
        return { data: Array.isArray(payload) ? list : list[0], error: null };
      }
      if (op === "upsert") {
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          const i = rows.findIndex((r) => conflict.every((k) => r[k] === p[k]));
          if (i >= 0) rows[i] = { ...rows[i], ...p };
          else rows.push({ ...p });
        }
        return { data: null, error: null };
      }
      if (op === "update") {
        for (const r of match) Object.assign(r, payload);
        return { data: returning ? match : null, error: null };
      }
      if (op === "delete") {
        tables[table] = rows.filter((r) => !match.includes(r));
        return { data: null, error: null };
      }
      let out = [...match];
      if (order) out.sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
      if (range) out = out.slice(range[0], range[1] + 1);
      if (limit !== null) out = out.slice(0, limit);
      if (columns) out = out.map((r) => Object.fromEntries(columns!.filter((c) => c in r).map((c) => [c, r[c]])));
      return { data: out, error: null };
    };
    q.single = () => {
      const r = run();
      return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] : r.data, error: null });
    };
    q.maybeSingle = () => {
      const r = run();
      return Promise.resolve({ data: (Array.isArray(r.data) ? r.data[0] : r.data) ?? null, error: null });
    };
    q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      try {
        resolve(run());
      } catch (e) {
        reject?.(e);
      }
    };
    return q;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    const r = { data: rpcs[name] ? rpcs[name](args) : null, error: null };
    const p = Promise.resolve(r) as Promise<typeof r> & { maybeSingle: () => Promise<typeof r>; single: () => Promise<typeof r> };
    p.maybeSingle = () => Promise.resolve(r);
    p.single = () => Promise.resolve(r);
    return p;
  };
  return { client: { from, rpc } as never, tables };
}
