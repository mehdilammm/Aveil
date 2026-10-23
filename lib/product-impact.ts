// Product Impact summary (C2): for each sampled product, one sentence in three clauses, each with its own badge:
// readiness gaps from the last scan, what AI answers said for questions about its category, and AI bot visits to
// its page. A clause without data says why (Unavailable), never a guess.
import type { Basis } from "./rules";

export type Clause = { key: "readiness" | "visibility" | "traffic"; text: string; basis: Basis };
export type ImpactInput = {
  product: { id: number; name: string; categories: string[] };
  findings: { title: string; severity: "high" | "medium" | "low"; basis: Basis }[];
  answers: { prompt: string; mentioned: boolean | null; error: string | null }[];
  hits: { verified: number; claim: number; pending: number } | null;
  days: number;
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

// Questions are about the product when they name one of its categories (or its own name).
export function relatedAnswers(input: Pick<ImpactInput, "product" | "answers">) {
  const keys = [input.product.name, ...input.product.categories].map(norm).filter((k) => k.length >= 3 && k !== "uncategorized");
  // "LED Mirrors" also matches "LED mirror": the last word without a plural s.
  const loose = keys.map((k) => k.replace(/s$/, ""));
  return input.answers.filter((a) => loose.some((k) => norm(a.prompt).includes(k)));
}

export function productImpact(i: ImpactInput): Clause[] {
  const open = i.findings.filter((f) => f.basis !== "unavailable");
  const high = open.filter((f) => f.severity === "high").length;
  const readiness: Clause = open.length
    ? { key: "readiness", basis: open.some((f) => f.basis === "observed") ? "observed" : "heuristic", text: `${open.length} readiness gap${open.length === 1 ? "" : "s"}${high ? ` (${high} critical)` : ""}: ${open.slice(0, 3).map((f) => f.title).join("; ")}${open.length > 3 ? "; …" : ""}` }
    : i.findings.length
      ? { key: "readiness", basis: "unavailable", text: "readiness not fully checked in the last scan" }
      : { key: "readiness", basis: "observed", text: "no readiness gap in the last scan" };

  const related = relatedAnswers(i);
  const answered = related.filter((a) => !a.error && a.mentioned !== null);
  const named = answered.filter((a) => a.mentioned).length;
  const visibility: Clause = !related.length
    ? { key: "visibility", basis: "unavailable", text: `no AI Visibility question about ${i.product.categories[0] ?? "this product"} yet` }
    : !answered.length
      ? { key: "visibility", basis: "unavailable", text: "the questions about it have no usable answer yet" }
      : { key: "visibility", basis: "observed", text: `the store was named in ${named} of ${answered.length} AI answer${answered.length === 1 ? "" : "s"} to questions about ${i.product.categories[0] ?? "it"} (model answers, not rankings)` };

  const h = i.hits;
  const traffic: Clause = !h
    ? { key: "traffic", basis: "unavailable", text: "AI bot visits per page need plugin 1.5.0 with traffic capture on" }
    : h.verified
      ? { key: "traffic", basis: "observed", text: `${h.verified} verified AI bot visit${h.verified === 1 ? "" : "s"} to its page in ${i.days} days${h.claim ? ` (+${h.claim} user-agent only)` : ""}` }
      : h.claim
        ? { key: "traffic", basis: "heuristic", text: `${h.claim} AI bot visit${h.claim === 1 ? "" : "s"} claimed by user agent only in ${i.days} days, none verified` }
        : { key: "traffic", basis: "observed", text: `no AI bot visit to its page seen in ${i.days} days (cached pages are not seen)` };
  return [readiness, visibility, traffic];
}
