// Product Impact summary (C2): for each sampled product, one sentence in three clauses, each with its own badge:
// readiness gaps from the last scan, what AI answers said for questions about its category, and AI bot visits to
// its page. A clause without data says why (Unavailable), never a guess.
import type { Basis } from "./rules";

// Each clause is a catalog message (impact.clause.<msg>) with its values, so it reads natively in English and
// Arabic (ICU plurals, incl. Arabic dual/few/many). Values are real data only: counts, days, category, titles.
export type Clause = { key: "readiness" | "visibility" | "traffic"; msg: ClauseMsg; values: Record<string, string | number>; basis: Basis };
export type ClauseMsg = "gaps" | "notChecked" | "noGap" | "noQuestion" | "noQuestionProduct" | "noAnswer" | "named" | "namedProduct" | "needsPlugin" | "needsPro" | "verified" | "claimed" | "noVisit";
export type ImpactInput = {
  product: { id: number; name: string; categories: string[] };
  findings: { title: string; severity: "high" | "medium" | "low"; basis: Basis }[];
  answers: { prompt: string; mentioned: boolean | null; error: string | null }[];
  hits: { verified: number; claim: number; pending: number } | null;
  // Verified bot traffic is a Pro feature (G7).
  trafficLocked?: boolean;
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
  const titles = `${open.slice(0, 3).map((f) => f.title).join("; ")}${open.length > 3 ? "; …" : ""}`;
  const readiness: Clause = open.length
    ? { key: "readiness", basis: open.some((f) => f.basis === "observed") ? "observed" : "heuristic", msg: "gaps", values: { count: open.length, critical: high, titles } }
    : i.findings.length
      ? { key: "readiness", basis: "unavailable", msg: "notChecked", values: {} }
      : { key: "readiness", basis: "observed", msg: "noGap", values: {} };

  const related = relatedAnswers(i);
  const answered = related.filter((a) => !a.error && a.mentioned !== null);
  const named = answered.filter((a) => a.mentioned).length;
  const topic = i.product.categories[0];
  const visibility: Clause = !related.length
    ? topic ? { key: "visibility", basis: "unavailable", msg: "noQuestion", values: { topic } } : { key: "visibility", basis: "unavailable", msg: "noQuestionProduct", values: {} }
    : !answered.length
      ? { key: "visibility", basis: "unavailable", msg: "noAnswer", values: {} }
      : { key: "visibility", basis: "observed", msg: topic ? "named" : "namedProduct", values: { named, total: answered.length, ...(topic ? { topic } : {}) } };

  const h = i.hits;
  const traffic: Clause = i.trafficLocked
    ? { key: "traffic", basis: "unavailable", msg: "needsPro", values: {} }
    : !h
    ? { key: "traffic", basis: "unavailable", msg: "needsPlugin", values: {} }
    : h.verified
      ? { key: "traffic", basis: "observed", msg: "verified", values: { verified: h.verified, claim: h.claim, days: i.days } }
      : h.claim
        ? { key: "traffic", basis: "heuristic", msg: "claimed", values: { claim: h.claim, days: i.days } }
        : { key: "traffic", basis: "observed", msg: "noVisit", values: { days: i.days } };
  return [readiness, visibility, traffic];
}
