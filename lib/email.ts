// Weekly report email, prepared but not sent: no email service is connected yet.
// To send, pick a provider (see README → Weekly email) and call it with renderWeeklyEmail's output.
import type { WeeklySummary } from "./weekly";

export type WeeklyEmailInput = {
  storeName: string;
  appUrl: string; // e.g. https://agentscope-peach.vercel.app/stores/<id>/reports
  summary: WeeklySummary;
  titles: Map<string, string>; // finding_key → title
};

function list(keys: string[], titles: Map<string, string>, max = 10): string[] {
  const lines = keys.slice(0, max).map((k) => `- ${titles.get(k) ?? k}`);
  if (keys.length > max) lines.push(`- and ${keys.length - max} more`);
  return lines;
}

export function renderWeeklyEmail({ storeName, appUrl, summary, titles }: WeeklyEmailInput): { subject: string; text: string } {
  const day = (iso: string) => iso.slice(0, 10);
  const subject = `${storeName}: ${summary.fixed.length} fixed, ${summary.added.length} new, ${summary.recurred.length} back`;
  const text = [
    `AgentScope weekly report for ${storeName}`,
    `${day(summary.fromDate)} → ${day(summary.toDate)}. Open findings now: ${summary.open}.`,
    "",
    `Fixed (${summary.fixed.length})`,
    ...list(summary.fixed, titles),
    "",
    `New (${summary.added.length})`,
    ...list(summary.added, titles),
    "",
    `Came back (${summary.recurred.length})`,
    ...list(summary.recurred, titles),
    "",
    `Details: ${appUrl}`,
  ].join("\n");
  return { subject, text };
}
