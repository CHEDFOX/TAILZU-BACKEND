/**
 * A SPREADSHEET'S ROWS AS A CHART OR A TABLE ARTIFACT, MADE BY CODE: NO MODEL, NO COST.
 *
 * The rows are already parsed (tabular.ts, or the worker's reading of an xlsx), so the artifact is written straight from them and goes
 * through the artifact core's own door (ArtifactService.create), which checks it like any other (size, secrets, imports, no network):
 * a table with something that looks like a key in a cell is refused there, in words, and the person is told which kind of thing it was.
 *
 *   chart   a React artifact with recharts: the first text column (or the first column) along the bottom, up to four number columns as
 *           bars, or as lines when the points are many. At most 60 rows of bars, 200 of lines.
 *   table   an HTML page: the header and the rows (up to what fits in the artifact size limit), sticky header, numbers right-aligned.
 *
 * Every cell goes in as an escaped value (HTML escaped, or a JSON literal with `<` written as <), never as markup or code.
 */
import type { Change } from "../artifacts/types.js";
import { LIMITS } from "../artifacts/protocol.js";
import { toNumber } from "./tabular.js";
import type { DataTable } from "./types.js";

export type DataArtifactKind = "chart" | "table";

export interface ArtifactMaker {
  create(userId: string, o: { type: unknown; title?: unknown; content: unknown; projectId?: unknown; madeBy?: "bot" | "person"; note?: string }): Promise<Change>;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** A JSON literal that cannot close a script or a JSX expression early. */
const literal = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** Whether a table can be charted: a number column and at least two rows. */
export const chartable = (t: DataTable): boolean => t.numeric.length > 0 && t.rows.length >= 2 && t.columns.length >= 2;

/** The columns a chart is drawn from: the category, and the number columns (at most four). */
export function chartColumns(t: DataTable): { category: number; series: number[] } {
  const category = t.columns.findIndex((_, i) => !t.numeric.includes(i));
  const cat = category >= 0 ? category : 0;
  const series = t.numeric.filter((i) => i !== cat).slice(0, 4);
  return { category: cat, series };
}

export function chartSource(t: DataTable): string {
  const { category, series } = chartColumns(t);
  const lines = t.rows.length > 24;
  const rows = t.rows.slice(0, lines ? 200 : 60).map((r) => {
    const o: Record<string, string | number> = { name: String(r[category] ?? "").slice(0, 40) };
    for (const i of series) o[`s${i}`] = toNumber(r[i]) ?? 0;
    return o;
  });
  const colours = ["#4f46e5", "#0891b2", "#d97706", "#be185d"];
  const marks = series.map((i, k) => (lines
    ? `<Line key="${i}" type="monotone" dataKey="s${i}" name={${literal(t.columns[i])}} stroke="${colours[k]}" dot={false} strokeWidth={2} />`
    : `<Bar key="${i}" dataKey="s${i}" name={${literal(t.columns[i])}} fill="${colours[k]}" radius={[3, 3, 0, 0]} />`)).join("\n          ");
  const [Chart, Mark] = lines ? ["LineChart", "Line"] : ["BarChart", "Bar"];
  return `import React from "react";
import { ${Chart}, ${Mark}, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";

const DATA = ${literal(rows)};

export default function DataChart() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>${escapeJsx(t.name)}</h2>
      <p style={{ margin: "0 0 12px", color: "#6b7280", fontSize: 13 }}>${escapeJsx(series.map((i) => t.columns[i]).join(", "))} by ${escapeJsx(t.columns[category] ?? "row")}${t.totalRows > rows.length ? `. The first ${rows.length} of ${t.totalRows} rows.` : "."}</p>
      <ResponsiveContainer width="100%" height={340}>
        <${Chart} data={DATA} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 12 }} width={56} />
          <Tooltip />
          <Legend />
          ${marks}
        </${Chart}>
      </ResponsiveContainer>
    </div>
  );
}
`;
}

/** Text that goes between JSX tags: braces and angle brackets are made safe. */
const escapeJsx = (s: string): string => escapeHtml(s).replace(/[{}]/g, (c) => (c === "{" ? "&#123;" : "&#125;"));

export function tableSource(t: DataTable): string {
  const head = `<tr>${t.columns.map((c, i) => `<th${t.numeric.includes(i) ? ' class="n"' : ""}>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const before = (n: number): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(t.name)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111827;--line:#e5e7eb;--head:#f3f4f6;--muted:#6b7280}
@media (prefers-color-scheme:dark){:root{--bg:#111827;--fg:#f3f4f6;--line:#374151;--head:#1f2937;--muted:#9ca3af}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:var(--muted);font-size:13px}
.wrap{overflow:auto;max-height:80vh;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
th{position:sticky;top:0;background:var(--head)}.n{text-align:right;font-variant-numeric:tabular-nums}
</style></head><body>
<h1>${escapeHtml(t.name)}</h1>
<p>${n} of ${t.totalRows} rows.</p>
<div class="wrap"><table>
<thead>${head}</thead>
<tbody>
`;
  const after = "</tbody></table></div></body></html>\n";
  // As many rows as the artifact size limit allows, leaving room for the frame.
  const budget = LIMITS.contentBytes - Buffer.byteLength(before(t.totalRows) + after, "utf8") - 2048;
  const rows: string[] = [];
  let used = 0;
  for (const r of t.rows) {
    const tr = `<tr>${t.columns.map((_, i) => `<td${t.numeric.includes(i) ? ' class="n"' : ""}>${escapeHtml(String(r[i] ?? ""))}</td>`).join("")}</tr>\n`;
    used += Buffer.byteLength(tr, "utf8");
    if (used > budget) break;
    rows.push(tr);
  }
  return before(rows.length) + rows.join("") + after;
}

/** The artifact for a table, made through the artifact core. Throws what the core throws (an ArtifactError with words a person can read). */
export async function makeDataArtifact(
  service: ArtifactMaker, userId: string, t: DataTable, kind: DataArtifactKind, o: { projectId?: string; fileName?: string } = {},
): Promise<{ change: Change; kind: DataArtifactKind }> {
  const base = o.fileName ? o.fileName.replace(/\.[^.]+$/, "") : "";
  const title = (base ? (t.name && t.name !== base ? `${base} · ${t.name}` : base) : t.name || "Data").slice(0, 100);
  const change = await service.create(userId, {
    type: kind === "chart" ? "react" : "html", title, content: kind === "chart" ? chartSource(t) : tableSource(t),
    ...(o.projectId ? { projectId: o.projectId } : {}), madeBy: "bot", note: kind === "chart" ? "Chart of a spreadsheet" : "Table of a spreadsheet",
  });
  return { change, kind };
}
