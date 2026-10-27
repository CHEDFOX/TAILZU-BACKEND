/**
 * INLINE SVG CHARTS, NO LIBRARIES: bars and a scatter, drawn from numbers, coloured from CSS variables so they follow the page's light and dark theme.
 */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface Bar { label: string; value: number; of?: number; note?: string; tone?: "ok" | "bad" | "mid" | "plain" }

const TONE: Record<NonNullable<Bar["tone"]>, string> = { ok: "var(--ok)", bad: "var(--bad)", mid: "var(--mid)", plain: "var(--accent)" };

/** Horizontal bars: a label, a bar scaled to `max` (default the biggest value), and the value written at its end. */
export function barChart(bars: Bar[], o: { width?: number; max?: number; format?: (b: Bar) => string; labelWidth?: number } = {}): string {
  const w = o.width ?? 640;
  const lw = o.labelWidth ?? 170;
  const rowH = 24;
  const max = o.max ?? Math.max(1e-9, ...bars.map((b) => b.value));
  const bw = w - lw - 90;
  const fmt = o.format ?? ((b: Bar): string => (b.of !== undefined ? `${b.value}/${b.of}` : String(Math.round(b.value * 100) / 100)));
  const rows = bars.map((b, i) => {
    const y = i * rowH;
    const len = Math.max(0, Math.min(1, b.value / max)) * bw;
    return `<g transform="translate(0,${y})"><text x="${lw - 8}" y="16" text-anchor="end" class="lbl">${esc(b.label.slice(0, 28))}</text><rect x="${lw}" y="4" width="${bw}" height="14" rx="3" class="track"/><rect x="${lw}" y="4" width="${len.toFixed(1)}" height="14" rx="3" fill="${TONE[b.tone ?? "plain"]}"/><text x="${lw + bw + 8}" y="16" class="val">${esc(fmt(b))}</text>${b.note ? `<title>${esc(b.note)}</title>` : ""}</g>`;
  });
  return `<svg role="img" viewBox="0 0 ${w} ${Math.max(rowH, bars.length * rowH)}" width="100%" style="max-width:${w}px">${rows.join("")}</svg>`;
}

export interface Dot { label: string; x: number; y: number; tone?: Bar["tone"] }

/** A scatter: x on a log scale when `logX` (costs), y from 0 to 1 (quality). */
export function scatter(dots: Dot[], o: { width?: number; height?: number; xLabel: string; yLabel: string; logX?: boolean } = { xLabel: "", yLabel: "" }): string {
  const w = o.width ?? 640, h = o.height ?? 340;
  const m = { l: 52, r: 16, t: 12, b: 40 };
  const pts = dots.filter((d) => Number.isFinite(d.x) && d.x > 0);
  if (!pts.length) return `<p class="mut">No data to plot.</p>`;
  const xs = pts.map((d) => (o.logX ? Math.log10(d.x) : d.x));
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const span = hi - lo || 1;
  const px = (v: number): number => m.l + (((o.logX ? Math.log10(v) : v) - lo) / span) * (w - m.l - m.r);
  const py = (v: number): number => h - m.b - Math.max(0, Math.min(1, v)) * (h - m.t - m.b);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${m.l}" x2="${w - m.r}" y1="${py(t)}" y2="${py(t)}" class="grid"/><text x="${m.l - 6}" y="${py(t) + 4}" text-anchor="end" class="lbl">${Math.round(t * 100)}%</text>`).join("");
  const dotsSvg = pts.map((d) => `<g><circle cx="${px(d.x).toFixed(1)}" cy="${py(d.y).toFixed(1)}" r="5" fill="${TONE[d.tone ?? "plain"]}" opacity="0.85"/><text x="${(px(d.x) + 8).toFixed(1)}" y="${(py(d.y) + 4).toFixed(1)}" class="lbl">${esc(d.label.slice(0, 22))}</text><title>${esc(d.label)}: ${d.x.toPrecision(3)}, ${Math.round(d.y * 100)}%</title></g>`).join("");
  return `<svg role="img" viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">${grid}<text x="${w / 2}" y="${h - 6}" text-anchor="middle" class="lbl">${esc(o.xLabel)}${o.logX ? " (log scale)" : ""}</text><text x="12" y="${h / 2}" transform="rotate(-90 12 ${h / 2})" text-anchor="middle" class="lbl">${esc(o.yLabel)}</text>${dotsSvg}</svg>`;
}

export const CSS = `
:root{--bg:#fff;--fg:#0f172a;--mut:#64748b;--line:#e2e8f0;--card:#f8fafc;--ok:#15803d;--okbg:#dcfce7;--bad:#b91c1c;--badbg:#fee2e2;--mid:#b45309;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--fg:#e2e8f0;--mut:#94a3b8;--line:#1e293b;--card:#111a30;--ok:#86efac;--okbg:#14532d;--bad:#fca5a5;--badbg:#7f1d1d;--mid:#fcd34d;--accent:#a5b4fc}}
*{box-sizing:border-box}body{font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:16px;max-width:1100px;margin-inline:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}p{margin:4px 0}.mut{color:var(--mut)}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:120px}
.card b{display:block;font-size:20px}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600;white-space:nowrap}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}
.pill{display:inline-block;border-radius:999px;padding:0 8px;font-size:12px}.pill.ok{background:var(--okbg)}.pill.bad{background:var(--badbg)}
svg .lbl{font-size:12px;fill:var(--fg)}svg .val{font-size:12px;fill:var(--mut)}svg .track{fill:var(--line)}svg .grid{stroke:var(--line);stroke-width:1}
code,pre{font:12px ui-monospace,monospace}pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0}
details{margin:4px 0}summary{cursor:pointer}
`;

export const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
