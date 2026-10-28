/**
 * THE SHOWCASE: every Bots app screen, on the phone and in the window, drawn by the apps' own renderers (render.ts) with the sample
 * day (samples/), each beside its board, on two review sheets.
 *
 *   cd tulmi && npx tsx scripts/bots-render/showcase.ts
 *
 * Writes, in scripts/bots-render/out/showcase/ (or --out):
 *   phone.html, desktop.html          the review sheets: each screen's render | its board, labelled, whole (open these)
 *   sheets/phone-NN.png, desktop-NN.png  the same sheets as pictures, a few screens a page
 *   screens/<id>[~variant].<client>.png / .json   each render, and the screen JSON it drew
 *   boards/<Board>.png                each board, drawn the way bots-design/check.cjs draws it
 *   problems.json                     every screen that failed, spilled, or fell back to an empty or error state, and why
 *   results.json                      every render, problems or not
 *
 * Options: --only <regex on id or id~variant>   --client phone|desktop|both   --jobs <n, default 4>   --out <dir>   --design <dir>
 *
 * "Fell back" means one of: the id is not built yet (the "on its way" page); the screen's own load threw; a route it read had no sample
 * answer (each is listed); or it shows an error or empty state ("Couldn't …", "Nothing here yet", …).
 */
import fs from "node:fs";
import path from "node:path";

process.env.PUBLIC_ORIGIN = "https://api.local";

const R = await import("./render.js");
const { SAMPLES, apiFor } = await import("./samples/index.js");
const { BOTS_SCREENS } = await import("../../src/experience/bots/index.js");
const { fakeDeps, ctxFor, IST } = await import("../../src/experience/bots/fixtures.js");
const { loadLive } = await import("../../src/experience/bots/live.js");
const { walk } = await import("../../src/experience/bots/lint.js");
type Sample = (typeof SAMPLES)[number];
type Client = "phone" | "desktop";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = path.resolve(flag("out") ?? path.join(R.HERE, "out/showcase"));
const DESIGN = flag("design") ?? R.DEFAULT_DESIGN;
const JOBS = Math.max(1, Number(flag("jobs") ?? 4));
const CLIENTS: Client[] = (flag("client") ?? "both") === "both" ? ["phone", "desktop"] : [flag("client") as Client];
const only = flag("only") ? new RegExp(flag("only")!) : undefined;

const nameOf = (s: Sample) => (s.variant ? `${s.id}~${s.variant}` : s.id);
const samples = SAMPLES.filter((s) => !only || only.test(nameOf(s)));
for (const d of ["screens", "boards", "sheets"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// ------------------------------------------------------------------ what counts as a fallback

/** Titles and lines the screens show when their data is missing or a read failed. */
const FALLBACK_TEXT = /^(This part is on its way|Nothing (here|to send|waiting here|to preview|on today)( yet)?|No (words|spaces|apps|repositories|computer|such receipt)( yet)?|Connected apps aren't on yet)$|Couldn't (read|load|open|reach)\b/;

/** The screen's own load, run on its own: did it throw? (buildBotsScreen draws the screen without its data when it does.) */
async function loadError(s: Sample, client: Client, params: Record<string, string | number | boolean>, api: Record<string, unknown>): Promise<string | undefined> {
  const def = BOTS_SCREENS.get(s.id);
  if (!def?.load) return undefined;
  const deps = fakeDeps({ ...s.fake, api });
  const live = await loadLive(deps, IST);
  const ctx = ctxFor(s.id, client, live, { params, ...(client === "desktop" ? { can: new Set(["BotsKit", ...R.DESKTOP_COMPONENTS]) } : {}) });
  try { await def.load(ctx, deps); return undefined; } catch (e) { return (e as Error).message.slice(0, 200); }
}

interface Problem { kind: "failed" | "spilled" | "fallback"; detail: string }
interface Result {
  screen: string; variant?: string; client: Client; params: Record<string, string | number | boolean>;
  board?: string; png?: string; boardPng?: string; json?: string; problems: Problem[];
}

// ------------------------------------------------------------------ the boards (each drawn once)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const browser: any = await R.launchBrowser();
const boards = new Map<string, Promise<string | undefined>>();
function board(name: string | undefined): Promise<string | undefined> {
  if (!name) return Promise.resolve(undefined);
  if (!boards.has(name)) {
    const file = path.join(OUT, "boards", `${name}.png`);
    boards.set(name, R.renderBoard(browser, name, file, DESIGN).then((ok) => (ok ? file : undefined)).catch(() => undefined));
  }
  return boards.get(name)!;
}

// ------------------------------------------------------------------ one render

async function one(s: Sample, client: Client): Promise<Result> {
  const params = (client === "desktop" ? s.deskParams : undefined) ?? s.params ?? {};
  const boardName = client === "phone" ? s.board : s.deskBoard;
  const res: Result = { screen: s.id, ...(s.variant ? { variant: s.variant } : {}), client, params, ...(boardName ? { board: boardName } : {}), problems: [] };
  const api = await apiFor(s);
  const boardPng = await board(boardName);
  if (boardPng) res.boardPng = boardPng;
  else if (boardName) res.problems.push({ kind: "failed", detail: `board ${boardName} could not be drawn` });
  try {
    const r = await R.renderClient(browser, { screenId: s.id, client, params, api, fake: s.fake, out: path.join(OUT, "screens"), base: `${nameOf(s)}.${client}`, compare: false, design: DESIGN });
    res.png = r.png;
    res.json = r.json;
    for (const e of r.errors) res.problems.push({ kind: "failed", detail: `page error: ${e}` });
    for (const sp of r.spills) res.problems.push({ kind: "spilled", detail: sp });
    if (!BOTS_SCREENS.has(s.id)) res.problems.push({ kind: "fallback", detail: "not built yet: draws the \"on its way\" page" });
    const threw = await loadError(s, client, params, api);
    if (threw) res.problems.push({ kind: "fallback", detail: `its load threw: ${threw}` });
    for (const m of r.misses) res.problems.push({ kind: "fallback", detail: `no sample answer for ${m}` });
    const root = (r.screen as { root?: Parameters<typeof walk>[0] }).root;
    const shown = root ? walk(root).filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) : [];
    for (const t of [...new Set(shown.filter((x) => FALLBACK_TEXT.test(x)))]) res.problems.push({ kind: "fallback", detail: `shows "${t}"` });
    if (!root) res.problems.push({ kind: "failed", detail: "the screen has no root" });
  } catch (e) {
    res.problems.push({ kind: "failed", detail: (e as Error).message.slice(0, 500) });
  }
  return res;
}

// ------------------------------------------------------------------ all of them, a few at a time

const queue = samples.flatMap((s) => CLIENTS.map((c) => [s, c] as const));
const results: Result[] = new Array(queue.length);
let next = 0, doneCount = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (next < queue.length) {
    const i = next++;
    const [s, c] = queue[i]!;
    results[i] = await one(s, c);
    doneCount++;
    const p = results[i]!.problems;
    console.log(`${String(doneCount).padStart(3)}/${queue.length} ${p.length ? "!!" : "ok"} ${nameOf(s)} ${c}${p.length ? ` · ${p.map((x) => x.kind).filter((k, j, a) => a.indexOf(k) === j).join(", ")}` : ""}`);
  }
}));

// ------------------------------------------------------------------ the sheets

const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rel = (f: string, from: string) => path.relative(from, f).split(path.sep).join("/");

function item(r: Result, from: string, width: number): string {
  const label = `${r.screen}${r.variant ? ` · ${r.variant}` : ""}`;
  const params = Object.keys(r.params).length ? Object.entries(r.params).map(([k, v]) => `${k}=${String(v).length > 28 ? `${String(v).slice(0, 26)}…` : v}`).join(" ") : "";
  const kinds = [...new Set(r.problems.map((p) => p.kind))];
  const badges = kinds.map((k) => `<b class="${k}">${k}</b>`).join("");
  const why = r.problems.length ? `<ul>${r.problems.slice(0, 4).map((p) => `<li>${esc(p.detail.slice(0, 140))}</li>`).join("")}${r.problems.length > 4 ? `<li>… ${r.problems.length - 4} more</li>` : ""}</ul>` : "";
  const img = (f: string | undefined, cap: string) => f
    ? `<figure><figcaption>${esc(cap)}</figcaption><a href="${rel(f, from)}"><img src="${rel(f, from)}" style="width:${width}px"></a></figure>`
    : `<figure><figcaption>${esc(cap)}</figcaption><div class="none" style="width:${width}px;height:${Math.round(width * (r.client === "phone" ? 844 / 390 : 800 / 1280))}px">no ${cap.startsWith("render") ? "render" : "board"}</div></figure>`;
  return `<section${kinds.length ? ' class="bad"' : ""}><h2>${esc(label)} ${badges}</h2><p class="meta">${esc(params)}</p>${why}<div class="pair">${img(r.png, "render · " + r.client)}${img(r.boardPng, r.board ? `${r.board}.dc.html` : "no board for this screen")}</div></section>`;
}

function sheet(title: string, items: Result[], from: string, width: number, cols: number): string {
  const css = `body{margin:0;padding:20px;background:#e9e9e9;font:13px/1.35 system-ui,sans-serif;color:#222}
h1{font-size:18px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(${cols},max-content);gap:18px;align-items:start}
section{background:#fff;border-radius:10px;padding:12px;border:2px solid transparent}section.bad{border-color:#e0a000}
h2{font-size:14px;margin:0 0 2px;font-family:ui-monospace,monospace}.meta{margin:0 0 4px;color:#666;font-family:ui-monospace,monospace;font-size:11px;min-height:14px;max-width:${2 * width}px;overflow-wrap:anywhere}
ul{margin:0 0 6px;padding-left:16px;color:#7a4b00;font-size:11px;max-width:${2 * width}px}
b{font-size:10px;font-weight:600;text-transform:uppercase;padding:1px 5px;border-radius:4px;margin-left:4px;vertical-align:2px;color:#fff}b.failed{background:#c62828}b.spilled{background:#e07000}b.fallback{background:#6a5acd}
.pair{display:flex;gap:12px}figure{margin:0}figcaption{color:#555;font-size:11px;margin-bottom:4px}img{display:block;border:1px solid #ccc;background:#fff}
.none{display:flex;align-items:center;justify-content:center;border:1px dashed #aaa;color:#999;background:#f6f6f6}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body><h1>${esc(title)}</h1><div class="grid">${items.map((r) => item(r, from, width)).join("")}</div></body></html>`;
}

const sheets: string[] = [];
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
for (const client of CLIENTS) {
  const items = results.filter((r) => r.client === client);
  const width = client === "phone" ? 390 : 640;
  const bad = items.filter((r) => r.problems.length).length;
  const title = `Bots app · ${client} · ${items.length} screens · ${bad} with problems · ${stamp}`;
  const html = path.join(OUT, `${client}.html`);
  fs.writeFileSync(html, sheet(title, items, OUT, width, client === "phone" ? 3 : 2));
  sheets.push(html);
  // The same, as pictures: a few screens a page.
  const per = client === "phone" ? 8 : 6, cols = client === "phone" ? 4 : 2;
  for (const old of fs.readdirSync(path.join(OUT, "sheets")).filter((f) => f.startsWith(`${client}-`))) fs.rmSync(path.join(OUT, "sheets", old));
  for (let i = 0, n = 1; i < items.length; i += per, n++) {
    const tmp = path.join(OUT, "sheets", `.${client}-${n}.html`);
    const png = path.join(OUT, "sheets", `${client}-${String(n).padStart(2, "0")}.png`);
    fs.writeFileSync(tmp, sheet(`${title} · page ${n} of ${Math.ceil(items.length / per)}`, items.slice(i, i + per), path.dirname(tmp), width, cols));
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    await page.goto(`file://${tmp}`);
    await page.evaluate(`Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))))`);
    const size = await page.evaluate(`({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`) as { w: number; h: number };
    await page.setViewportSize({ width: size.w, height: Math.min(size.h, 16000) });
    await page.screenshot({ path: png, fullPage: true });
    await page.close();
    fs.rmSync(tmp);
    sheets.push(png);
  }
}
await browser.close();

// ------------------------------------------------------------------ the lists

const problems = results.filter((r) => r.problems.length).map((r) => ({ screen: r.screen, ...(r.variant ? { variant: r.variant } : {}), client: r.client, params: r.params, problems: r.problems }));
fs.writeFileSync(path.join(OUT, "problems.json"), JSON.stringify(problems, null, 1));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results.map((r) => ({ ...r, png: r.png && rel(r.png, OUT), boardPng: r.boardPng && rel(r.boardPng, OUT), json: r.json && rel(r.json, OUT) })), null, 1));

const count = (k: Problem["kind"]) => results.filter((r) => r.problems.some((p) => p.kind === k)).length;
console.log(`\n${results.length} renders in ${Math.round((Date.now() - t0) / 1000)} s · failed ${count("failed")} · spilled ${count("spilled")} · fell back ${count("fallback")}`);
for (const f of sheets.filter((x) => x.endsWith(".html"))) console.log(`sheet: ${path.relative(process.cwd(), f)}`);
console.log(`pictures: ${path.relative(process.cwd(), path.join(OUT, "sheets"))}/  problems: ${path.relative(process.cwd(), path.join(OUT, "problems.json"))}`);
