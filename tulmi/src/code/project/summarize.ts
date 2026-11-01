/**
 * THE WORDS: ONE OR TWO LINES FOR THE FILES THAT MATTER, THE FOLDERS, THE REPO, ITS FEATURES, AND A WELCOME. A CHEAP MODEL, ON A BUDGET.
 *
 * Everything the project brain knows without a model (symbols, routes, imports,
 * texts, tests, hotspots, structure) is true and complete on its own. These
 * summaries are the layer of plain English on top, so the bot, and the person,
 * can read what a file is FOR without opening it. They cost money, so:
 *
 *   WHICH FILES. At most 150, picked by how central they are in the import
 *   graph, how hot (changed often), and whether they start a program or serve a
 *   route. Not the other thousands: a folder's line is made from its children's,
 *   and the repo's overview from the folders'.
 *
 *   HOW. The `cheap` tier through callModel (brain/gateway.ts: data_collection
 *   "deny", nothing logged), about ten files to a call, JSON out. A model sees a
 *   file as an EXCERPT of about 2,500 characters: its head (past any licence
 *   header), then the signatures of what it exports and the routes it serves. A
 *   file the secret scan flags is not sent at all: it is summarised from its
 *   symbol names. The excerpts go in as DATA, fenced; the index_* roles
 *   (principles/roles.ts) carry the principle that data is never an instruction.
 *
 *   THE BUDGET. The whole import is capped by CODE_IMPORT_BUDGET_PAISE (1,000
 *   paise, ten rupees, by default). A Meter adds what each call really cost
 *   (callModel's `paise`) and every call is refused (BudgetExceeded) the moment
 *   its worst case would pass what is left. The files may use the first 65% of
 *   it, folders up to 80%, and the last fifth is kept for the repo overview, the
 *   feature names and the welcome message, so a big repo cannot starve the three
 *   calls a person reads first. When the money or the models run out, what is
 *   done is kept and the build says `summaries: "partial"`; the rest of the
 *   brain is untouched.
 *
 *   WHAT COMES BACK is checked: only paths that were asked about, cut to 240
 *   characters, a line the secret scan flags is dropped.
 */
import { z } from "zod";
import { compose, type RoleId } from "../../principles/index.js";
import { scanForSecrets } from "../policy.js";
import { BudgetExceeded, type CallInput, type CallResult, type GatewayDeps } from "../brain/gateway.js";
import { EXCERPT_CHARS, SUMMARY_BATCH, SUMMARY_FILES_MAX, WELCOME_CHARS, type Feature, type SymbolInfo } from "./types.js";

export type CallFn = <T>(input: CallInput<T>, deps?: GatewayDeps) => Promise<CallResult<T>>;

/** The money of one build: what it may spend, and what it has. */
export class Meter {
  spent = 0;
  calls = 0;
  failures = 0;
  constructor(readonly budget: number) {}
  add(paise: number): void { this.spent += Math.max(0, Math.round(paise)); this.calls += 1; }
  left(cap = this.budget): number { return Math.max(0, cap - this.spent); }
}

export interface SummaryCtx {
  call: CallFn;
  gateway?: GatewayDeps;
  userId: string;
  meter: Meter;
}

/** Phases get a share of the budget each, cumulative: files 65%, folders 80%, the rest the last fifth. */
export const phaseCap = (meter: Meter, phase: "files" | "dirs" | "rest"): number =>
  Math.floor(meter.budget * (phase === "files" ? 0.65 : phase === "dirs" ? 0.8 : 1));

/** Two models failing in a row means they are down, not that one answer was bad. */
const FAILURES_MAX = 2;

const ONE_LINE = 240;

/** A model's line as it is kept: one line, no control characters, cut, and nothing a secret scan flags; or null. */
export function cleanSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 3) return null;
  const cut = s.length > ONE_LINE ? `${s.slice(0, ONE_LINE - 1)}…` : s;
  return scanForSecrets([{ path: "summary.txt", content: cut }]).length ? null : cut;
}

// --------------------------------------------------------------- the choosing

export interface Pickable {
  path: string;
  lang: string;
  rank: number;
  hot: number;
  entry: boolean;
  routes: number;
  symbols: number;
  isTest: boolean;
  kind: "source" | "markup" | "other";
}

/**
 * The files that get a line, at most 150: central ones first (rank), then hot
 * ones, entry points and files that serve a route. Tests, data and docs are not
 * among them: they have no role a person needs spelled out.
 */
export function pickForSummary(files: readonly Pickable[], limit = SUMMARY_FILES_MAX): string[] {
  return files
    .filter((f) => !f.isTest && f.kind !== "other" && (f.symbols > 0 || f.entry || f.kind === "markup"))
    .map((f) => ({ path: f.path, score: f.rank * 10 + Math.min(f.hot, 10) * 1.5 + (f.entry ? 8 : 0) + (f.routes > 0 ? 2 : 0) + Math.min(f.symbols, 20) * 0.05 }))
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
    .slice(0, limit).map((f) => f.path);
}

// ------------------------------------------------------------------ excerpts

export interface ExcerptFile { path: string; lang: string; text: string; symbols: readonly SymbolInfo[]; redact: boolean }

/** The head of a file past a licence header. */
function headOf(text: string, chars: number): string {
  const lines = text.split("\n");
  let i = 0;
  // A leading comment block that mentions a licence is not what the file is about.
  const first = lines.slice(0, 40).join("\n");
  if (/^\s*(?:\/\*|\/\/|#|<!--)/.test(lines[0] ?? "") && /licen[sc]e|copyright|spdx/i.test(first)) {
    while (i < lines.length && i < 40 && /^\s*(?:\/\*|\*|\/\/|#|<!--|-->)/.test(lines[i]!)) i += 1;
  }
  let out = "";
  for (; i < lines.length && out.length < chars; i += 1) {
    const l = lines[i]!.replace(/\s+$/, "");
    if (!l && !out.endsWith("\n\n") && out) out += "\n";
    else if (l) out += `${l.slice(0, 200)}\n`;
  }
  return out.slice(0, chars).trimEnd();
}

/**
 * What a model sees of a file: about 2,500 characters. The head, then the
 * signatures (the source line) of what the file exports and the routes it
 * serves. A file flagged as holding a secret is only its symbol names.
 */
export function excerptOf(f: ExcerptFile, chars = EXCERPT_CHARS): string {
  const names = f.symbols.filter((s) => s.kind !== "env").map((s) => (s.kind === "route" ? `${s.method} ${s.path}` : `${s.kind} ${s.name}`));
  if (f.redact) return `(the file's text is withheld: it may hold a secret)\nsymbols: ${names.slice(0, 40).join(", ")}`.slice(0, chars);
  const head = headOf(f.text, Math.floor(chars * 0.4));
  const lines = f.text.split("\n");
  const sigs: string[] = [];
  let used = head.length + 12;
  for (const s of f.symbols) {
    if (s.kind === "env" || s.kind === "entry" || (s.exported === false && s.kind !== "route")) continue;
    const src = (lines[s.line - 1] ?? "").trim().slice(0, 140);
    if (!src || head.includes(src)) continue;
    if (used + src.length + 1 > chars) break;
    sigs.push(src);
    used += src.length + 1;
  }
  return sigs.length ? `${head}\n--- exports and signatures ---\n${sigs.join("\n")}` : head;
}

const fence = (s: string) => s.replace(/<\/(file|dir|data)/gi, "<\\/$1");

// ------------------------------------------------------------ the model calls

export const FileSchema = z.object({ summaries: z.array(z.object({ path: z.string(), summary: z.string() })).max(40) });
export const DirSchema = FileSchema;
export const OverviewSchema = z.object({ overview: z.string() });
export const FeatureSchema = z.object({ features: z.array(z.object({ id: z.string(), name: z.string(), summary: z.string() })).max(40) });
export const WelcomeSchema = z.object({ welcome: z.string() });

type Outcome<T> = { ok: true; value: T } | { ok: false; reason: "budget" | "down" };

/** One cheap-tier JSON call, held to what is left of the cap. Never throws for money or a model that is down. */
async function ask<T>(ctx: SummaryCtx, cap: number, purpose: string, role: RoleId, user: string, schema: z.ZodType<T>, maxTokens: number): Promise<Outcome<T>> {
  const left = ctx.meter.left(cap);
  if (left <= 0) return { ok: false, reason: "budget" };
  if (ctx.meter.failures >= FAILURES_MAX) return { ok: false, reason: "down" };
  try {
    const r = await ctx.call<T>({
      tier: "cheap", userId: ctx.userId, purpose, json: schema, maxTokens, budget: { maxPaise: left },
      messages: compose(role, [{ role: "user" as const, content: user }]),
    }, ctx.gateway);
    ctx.meter.add(r.paise);
    ctx.meter.failures = 0;
    if (r.json === undefined) return { ok: false, reason: "down" };
    return { ok: true, value: r.json };
  } catch (err) {
    if (err instanceof BudgetExceeded) return { ok: false, reason: "budget" };
    // Whatever it cost before it failed is already in the job's ledger, not here: a failed call counts as no money and one failure.
    ctx.meter.failures += 1;
    return { ok: false, reason: "down" };
  }
}

export type FileJob = ExcerptFile;

/** One or two lines for each file, ten to a call. Returns what came back, and whether it all did. */
export async function summarizeFiles(ctx: SummaryCtx, files: readonly FileJob[], cap: number): Promise<{ summaries: Map<string, string>; complete: boolean }> {
  const out = new Map<string, string>();
  let complete = true;
  for (let i = 0; i < files.length; i += SUMMARY_BATCH) {
    const batch = files.slice(i, i + SUMMARY_BATCH);
    const asked = new Set(batch.map((f) => f.path));
    const user = batch.map((f) => `<file path="${f.path}" lang="${f.lang}">\n${fence(excerptOf(f))}\n</file>`).join("\n");
    const r = await ask(
      ctx, cap, "brain.summarize.files", "index_files", user, FileSchema, 1200,
    );
    if (!r.ok) { complete = false; if (r.reason === "budget" || ctx.meter.failures >= FAILURES_MAX) break; continue; }
    let got = 0;
    for (const s of r.value.summaries) {
      const line = asked.has(s.path) ? cleanSummary(s.summary) : null;
      if (line) { out.set(s.path, line); got += 1; }
    }
    if (got < batch.length) complete = false;
  }
  if (out.size < files.length) complete = false;
  return { summaries: out, complete };
}

// ------------------------------------------------------------ the parts, each with words

/**
 * A file whose parts get words: its text, its symbols, which of them to describe (`want`, indexes into `symbols`), and whether the file needs its
 * own line too. The words are what a part does and what a person would call it: never where it is or what it connects to, which the map has.
 */
export interface CardJob { path: string; lang: string; text: string; symbols: readonly SymbolInfo[]; want: number[]; summary: boolean; redact: boolean }
export interface Meaning { does: string; say: string[] }
export interface CardsOut { files: Map<string, { summary?: string; parts: Map<number, Meaning> }>; complete: boolean; calls: number }

/** The code one call reads, in characters; a file longer than this is read in parts, cut where a symbol starts. */
export const CARD_CALL_CHARS = 20_000;
/**
 * What a full read of a project costs and takes, from its files' sizes alone (no read, no model): its source code (not tests, generated code or
 * data), at what reading cost (tailzu-desktop ₹8.76 for 1.91 MB, tailzu-frontend ₹18.14 for 3.85 MB in 236 calls) with a margin. What already
 * has words: those parts are not paid for again.
 */
export interface ReadEstimate { read: "quick" | "full"; files: number; mb: number; paise: number; minutes: number; parts: number; described: number }
export const FULL_READ_PAISE_PER_MB = 500;
const CALLS_PER_MB = 60;
const SECONDS_PER_CALL = 5;

export function readEstimate(files: ReadonlyArray<{ path: string; bytes: number; symbols: readonly SymbolInfo[] }>, read: "quick" | "full", isSource: (path: string) => boolean): ReadEstimate {
  const source = files.filter((f) => isSource(f.path));
  let parts = 0;
  let described = 0;
  let bytes = 0;
  for (const f of source) {
    const want = cardable(f.symbols);
    const left = want.filter((i) => !f.symbols[i]!.does).length;
    parts += want.length;
    described += want.length - left;
    // A file all of whose parts have words costs nothing more; one partly described is counted whole (it is read whole).
    if (left || !want.length) bytes += f.bytes;
  }
  const mb = bytes / 1e6;
  return {
    read, files: source.length, mb: Math.round(mb * 100) / 100, paise: Math.ceil(mb * FULL_READ_PAISE_PER_MB),
    minutes: Math.max(1, Math.ceil((mb * CALLS_PER_MB * SECONDS_PER_CALL) / CARD_PARALLEL / 60)), parts, described,
  };
}

/** The calls a reading makes at once, the parts one call may be asked for (its answer must fit), and the failures in a row that stop it. */
export const CARD_PARALLEL = 4;
export const CARD_CALL_PARTS = 40;
/** The answer's room: per part asked, and at most. */
const CARD_TOKENS_PER_PART = 120;
const CARD_ANSWER_TOKENS_MAX = 8_000;
const CARD_FAILURES_MAX = 6;
/** A quick read reads this much of each file it picks; a full read reads all of it. */
export const QUICK_FILE_CHARS = 12_000;
const SAY_MAX = 4;
const SAY_CHARS = 48;

/** The symbols worth words: what does something, and the shapes and values another file uses. Not env names or entry marks. */
export function cardable(symbols: readonly SymbolInfo[]): number[] {
  const out: number[] = [];
  symbols.forEach((s, i) => {
    if (s.kind === "env" || s.kind === "entry") return;
    if ((s.kind === "const" || s.kind === "type" || s.kind === "interface" || s.kind === "enum") && s.exported === false) return;
    out.push(i);
  });
  return out;
}

export const CardSchema = z.object({
  files: z.array(z.object({
    path: z.string(), summary: z.string().optional().nullable(),
    parts: z.array(z.object({ id: z.string(), does: z.string(), say: z.array(z.string()).max(8).optional().nullable() })).max(120),
  })).max(40),
});

/** A part of a file for one call: the lines from..to (1-based) and the wanted symbols that start in them. */
interface Piece { job: CardJob; from: number; to: number; ids: number[]; first: boolean; text: string }

function piecesOf(job: CardJob, limit: number): Piece[] {
  // A minified or generated line is cut: one line of a bundle should not be a whole call.
  const lines = job.text.split("\n").map((l) => (l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS)}…` : l));
  // The lines read: all of them, or in a quick read the first `limit` characters' worth.
  let last = lines.length;
  let used = 0;
  for (let i = 0; i < lines.length; i++) { used += lines[i]!.length + 1; if (used > limit) { last = Math.max(1, i); break; } }
  const starts = job.want.map((i) => job.symbols[i]!.line).filter((l) => l <= last);
  const out: Piece[] = [];
  let from = 1;
  while (from <= last) {
    let to = from;
    let size = 0;
    while (to <= last && size + lines[to - 1]!.length + 1 <= CARD_CALL_CHARS) { size += lines[to - 1]!.length + 1; to += 1; }
    to = Math.max(from, to - 1);
    // Cut where a symbol starts, so a part is read whole, unless that would leave the piece too small.
    if (to < last) { const cutAt = [...starts].reverse().find((l) => l > from + 20 && l <= to); if (cutAt) to = cutAt - 1; }
    // And before the part one call may not be asked for (CARD_CALL_PARTS): a file of many small parts is read in several pieces.
    const inside = starts.filter((l) => l >= from && l <= to);
    if (inside.length > CARD_CALL_PARTS) to = inside[CARD_CALL_PARTS]! - 1;
    const ids = job.want.filter((i) => { const l = job.symbols[i]!.line; return l >= from && l <= to; });
    if (ids.length || (from === 1 && job.summary)) out.push({ job, from, to, ids, first: from === 1, text: lines.slice(from - 1, to).join("\n") });
    from = to + 1;
  }
  return out;
}

/** The longest line shown as it is. */
const LINE_CHARS = 2_000;

const partLine = (s: SymbolInfo, id: number) => `p${id} ${s.kind} ${s.kind === "route" ? `${s.method} ${s.path}` : s.name} (line ${s.line})`;

/**
 * Words for each part of each file: what it does, and what a person would call it; and a line for the file. Files are packed into calls of about
 * CARD_CALL_CHARS of code; a long file is read in parts. A part left out by the model is asked once more, alone with its file's lines. A file
 * that may hold a secret is described from its symbols' names only.
 */
export async function cardFiles(ctx: SummaryCtx, jobs: readonly CardJob[], cap: number, o: { fileChars?: number } = {}): Promise<CardsOut> {
  const out: CardsOut["files"] = new Map();
  let complete = true;
  let calls = 0;
  const limit = o.fileChars ?? Number.MAX_SAFE_INTEGER;
  const ask1 = async (pieces: Piece[]): Promise<"ok" | "budget" | "down"> => {
    const user = pieces.map((p) => {
      const syms = p.ids.map((i) => partLine(p.job.symbols[i]!, i)).join("\n");
      const code = p.job.redact ? "(the file's text is withheld: it may hold a secret; describe the parts from their names)" : fence(p.text);
      return `<file path="${p.job.path}" lang="${p.job.lang}" lines="${p.from}-${p.to}"${p.first && p.job.summary ? ' summary="yes"' : ""}>\n<parts>\n${syms || "(none)"}\n</parts>\n<code>\n${code}\n</code>\n</file>`;
    }).join("\n");
    const parts = pieces.reduce((n, p) => n + p.ids.length, 0);
    calls += 1;
    // Room for the answer: a part's words run to about 60 tokens on average, more for a wordy one; an answer cut short is JSON no model can use
    // (tailzu-frontend: 4 calls failed so on every model of the ladder, 6 parts left without words, at 70 a part).
    const r = await ask(ctx, cap, "brain.cards", "index_cards", user, CardSchema, Math.min(CARD_ANSWER_TOKENS_MAX, 400 + parts * CARD_TOKENS_PER_PART));
    if (!r.ok) return r.reason;
    for (const f of r.value.files) {
      const mine = pieces.filter((p) => p.job.path === f.path);
      if (!mine.length) continue;
      const entry = out.get(f.path) ?? { parts: new Map<number, Meaning>() };
      if (f.summary && mine.some((p) => p.first && p.job.summary)) { const line = cleanSummary(f.summary); if (line) entry.summary = line; }
      const allowed = new Set(mine.flatMap((p) => p.ids));
      for (const x of f.parts) {
        const id = Number(/^p?(\d+)$/.exec(x.id.trim())?.[1] ?? NaN);
        if (!allowed.has(id)) continue;
        const does = cleanSummary(x.does);
        if (!does) continue;
        const name = mine[0]!.job.symbols[id]!.name.toLowerCase();
        const say = [...new Set((x.say ?? []).map((w) => cleanSummary(w)?.slice(0, SAY_CHARS)).filter((w): w is string => !!w && w.toLowerCase() !== name))].slice(0, SAY_MAX);
        entry.parts.set(id, { does: does.slice(0, 200), say });
      }
      out.set(f.path, entry);
    }
    return "ok";
  };
  /** A call that failed for its answer (not for money) asked again as two halves, once: a smaller answer fits, and one odd part spoils only its half. */
  const halves = (b: Piece[]): Piece[][] => {
    if (b.length > 1) return [b.slice(0, Math.ceil(b.length / 2)), b.slice(Math.ceil(b.length / 2))];
    const p = b[0]!;
    if (p.ids.length < 2) return [];
    const mid = Math.ceil(p.ids.length / 2);
    return [[{ ...p, ids: p.ids.slice(0, mid) }], [{ ...p, ids: p.ids.slice(mid), first: false }]];
  };
  // Pack the pieces into calls (by code and by parts, so that the answer fits too), and make CARD_PARALLEL of them at a time: a project of
  // 2 MB is 90 calls, and one at a time took five minutes.
  const pack = (pieces: readonly Piece[]): Piece[][] => {
    const batches: Piece[][] = [];
    let batch: Piece[] = [];
    let size = 0;
    let parts = 0;
    for (const p of pieces) {
      if (batch.length && (size + p.text.length > CARD_CALL_CHARS || parts + p.ids.length > CARD_CALL_PARTS)) { batches.push(batch); batch = []; size = 0; parts = 0; }
      batch.push(p);
      size += p.text.length;
      parts += p.ids.length;
    }
    if (batch.length) batches.push(batch);
    return batches;
  };
  // Several calls are in flight at once, so a failure is one of several: the reading stops only after CARD_FAILURES_MAX in a row.
  const stopped = () => ctx.meter.left(cap) <= 0 || ctx.meter.failures >= CARD_FAILURES_MAX;
  const run = async (batches: Piece[][]) => {
    let next = 0;
    const split = new Set<Piece[]>();
    const worker = async () => {
      while (next < batches.length) {
        if (stopped()) { complete = false; return; }
        const mine = batches[next++]!;
        const got = await ask1(mine);
        // Whether it is whole in the end is decided below, part by part: a half that gets its words makes up for the call that failed.
        if (got === "ok") continue;
        if (got === "down" && !split.has(mine)) for (const h of halves(mine)) { split.add(h); batches.push(h); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CARD_PARALLEL, batches.length) }, worker));
  };
  const all = jobs.flatMap((j) => piecesOf(j, limit));
  await run(pack(all));
  // What the model left out, asked once more: each piece with only its missing parts, packed the same way.
  const missing = all.map((p) => ({ ...p, first: false, ids: p.ids.filter((i) => !out.get(p.job.path)?.parts.has(i)) })).filter((p) => p.ids.length);
  if (missing.length && !stopped()) await run(pack(missing));
  // Complete when every file asked for a line has one and every part that was read has words (a quick read leaves the rest of a long file).
  for (const p of all) {
    const got = out.get(p.job.path);
    if ((p.first && p.job.summary && !got?.summary) || p.ids.some((i) => !got?.parts.has(i))) complete = false;
  }
  return { files: out, complete, calls };
}

export interface DirJob {
  path: string;
  files: Array<{ name: string; summary: string }>;
  dirs: Array<{ name: string; summary: string }>;
}

/** A line for each folder, made from what is in it. */
export async function summarizeDirs(ctx: SummaryCtx, dirs: readonly DirJob[], cap: number): Promise<{ summaries: Map<string, string>; complete: boolean }> {
  const out = new Map<string, string>();
  let complete = true;
  for (let i = 0; i < dirs.length; i += SUMMARY_BATCH) {
    const batch = dirs.slice(i, i + SUMMARY_BATCH);
    const asked = new Set(batch.map((d) => d.path));
    const user = batch.map((d) => {
      const kids = [
        ...d.dirs.slice(0, 12).map((x) => `folder ${x.name}${x.summary ? `: ${x.summary}` : ""}`),
        ...d.files.slice(0, 20).map((x) => `file ${x.name}${x.summary ? `: ${x.summary}` : ""}`),
      ];
      return `<dir path="${d.path}">\n${fence(kids.join("\n"))}\n</dir>`;
    }).join("\n");
    const r = await ask(
      ctx, cap, "brain.summarize.dirs", "index_dirs", user, DirSchema, 1000,
    );
    if (!r.ok) { complete = false; if (r.reason === "budget" || ctx.meter.failures >= FAILURES_MAX) break; continue; }
    for (const s of r.value.summaries) { const line = asked.has(s.path) ? cleanSummary(s.summary) : null; if (line) out.set(s.path, line); }
  }
  if (out.size < dirs.length) complete = false;
  return { summaries: out, complete };
}

export interface OverviewFacts {
  name: string;
  readme: { title: string; blurb: string } | null;
  languages: string[];
  frameworks: string[];
  folders: Array<{ name: string; summary: string }>;
  features: string[];
}

/** One overview of the whole repo. */
export async function summarizeRepo(ctx: SummaryCtx, facts: OverviewFacts, cap: number): Promise<string | null> {
  const user = fence([
    `<data>`, `repo: ${facts.name}`, facts.readme?.title ? `readme title: ${facts.readme.title}` : "", facts.readme?.blurb ? `readme: ${facts.readme.blurb}` : "",
    `languages: ${facts.languages.join(", ")}`, `frameworks: ${facts.frameworks.join(", ")}`,
    ...facts.folders.slice(0, 20).map((f) => `folder ${f.name}${f.summary ? `: ${f.summary}` : ""}`),
    facts.features.length ? `features: ${facts.features.join(", ")}` : "", `</data>`,
  ].filter(Boolean).join("\n"));
  const r = await ask(
    ctx, cap, "brain.summarize.repo", "index_repo", user, OverviewSchema, 500,
  );
  return r.ok ? cleanSummary(r.value.overview.slice(0, 400)) : null;
}

/** The cheap model NAMES and describes the clusters (features.ts); a cluster it says nothing about keeps its own name and summary. */
export async function labelFeatures(ctx: SummaryCtx, features: readonly Feature[], cap: number): Promise<{ features: Feature[]; labelled: boolean }> {
  if (!features.length) return { features: [], labelled: true };
  const block = (f: Feature, id: number) => `<data id="${id}">\nfolder-or-word: ${f.name}\nfiles: ${f.files.slice(0, 8).join(", ")}\nroutes: ${f.routes.slice(0, 6).join(", ")}\ntexts: ${f.texts.slice(0, 5).join(" | ")}\n</data>`;
  const byId = new Map<string, { id: string; name: string; summary: string }>();
  // A cheap model can answer the first block or two and stop: the ones it left are asked once more, by themselves.
  for (let round = 0; round < 2; round++) {
    const left = features.map((f, i) => ({ f, id: String(i + 1) })).filter((x) => !byId.has(x.id));
    if (!left.length) break;
    const r = await ask(
      ctx, cap, "brain.features", "index_features", fence(left.map((x) => block(x.f, Number(x.id))).join("\n")), FeatureSchema, 1800,
    );
    if (!r.ok) break;
    const asked = new Set(left.map((x) => x.id));
    for (const f of r.value.features) if (asked.has(f.id)) byId.set(f.id, f);
  }
  if (!byId.size) return { features: features.map((f) => ({ ...f })), labelled: false };
  const out = features.map((f, i) => {
    const l = byId.get(String(i + 1));
    const name = l ? cleanSummary(l.name)?.slice(0, 40) : null;
    const summary = l ? cleanSummary(l.summary) : null;
    return { ...f, name: name ?? f.name, summary: summary ?? f.summary };
  });
  return { features: out, labelled: byId.size >= features.length };
}

// ------------------------------------------------------------------ welcome

export interface WelcomeFacts {
  name: string;
  blurb: string;
  stack: string[];
  fileCount: number;
  analysed: number;
  /** In plain words: "tests pass", "2 of 4 checks fail", "not checked yet". */
  health: string;
  tasks: string[];
  /** When no README says what the project is: what the code says instead (product name, keywords, parts, latest commits). */
  clues?: string[];
}

/** The welcome as a plain template: what is used when no model could write it, and the shape of what the model is asked for. */
export function fallbackWelcome(f: WelcomeFacts): string {
  // The blurb is already cut at a sentence or a word (scan.ts): cut again here, it lost the end of a word ("best-in-cl.").
  const head = `${f.name}${f.blurb ? `: ${f.blurb.replace(/[.…]+$/, "")}` : ""}`;
  const stack = f.stack.length ? ` Built with ${f.stack.slice(0, 6).join(", ")}.` : "";
  const size = ` ${f.fileCount.toLocaleString("en-US")} files${f.analysed && f.analysed < f.fileCount ? `, ${f.analysed.toLocaleString("en-US")} read` : ""}. Health: ${f.health}.`;
  const tasks = f.tasks.length ? ` To start: ${f.tasks.slice(0, 5).map((t, i) => `${i + 1}) ${t}`).join(" ")}` : "";
  return clampWelcome(`${head}.${stack}${size}${tasks}`);
}

/** At most 900 characters, cut at the end of a sentence or a word. */
export function clampWelcome(s: string, max = WELCOME_CHARS): string {
  const one = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  if (stop > max * 0.6) return cut.slice(0, stop + 1).trim();
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/** The welcome message: what the project is, its stack, size and health, and three to five first tasks. At most 900 characters. */
export async function welcomeMessage(ctx: SummaryCtx, facts: WelcomeFacts, cap: number): Promise<{ text: string; viaModel: boolean }> {
  const lines = [
    "<data>", `project: ${facts.name}`, facts.blurb ? `about: ${facts.blurb}` : "", `stack: ${facts.stack.join(", ")}`,
    `size: ${facts.fileCount} files (${facts.analysed} read)`, `health: ${facts.health}`, ...(facts.clues ?? []).slice(0, 16).map((c) => `clue ${c}`),
    ...facts.tasks.slice(0, 6).map((t, i) => `candidate task ${i + 1}: ${t}`), "</data>",
  ].filter(Boolean);
  const r = await ask(
    ctx, cap, "brain.welcome", "welcome", fence(lines.join("\n")), WelcomeSchema, 700,
  );
  if (r.ok) {
    const text = clampWelcome(r.value.welcome);
    if (text.length >= 40 && !scanForSecrets([{ path: "welcome.txt", content: text }]).length) return { text, viaModel: true };
  }
  return { text: fallbackWelcome(facts), viaModel: false };
}

// -------------------------------------------------------------- first tasks

export interface TaskFacts {
  /** What running the baseline said, when someone has. */
  baseline: Array<{ kind: string; ok: boolean; failing: string[] }> | null;
  hasTests: boolean;
  testFrameworks: string[];
  untestedImportant: string[];
  todoHotspots: Array<{ path: string; todo: number }>;
  deprecated: Array<{ name: string; note: string }>;
  behind: Array<{ name: string; declared: string; latest: string | null }>;
  fragile: Array<{ path: string; changes: number }>;
  hasCommands: { test: boolean };
}

/** Concrete first tasks, in the order they are worth doing. At most five. */
export function suggestTasks(f: TaskFacts): string[] {
  const out: string[] = [];
  const add = (t: string) => { if (out.length < 5 && !out.includes(t)) out.push(t.slice(0, 160)); };
  for (const b of f.baseline ?? []) if (!b.ok) add(`Fix the failing ${b.kind}${b.failing.length ? `: ${b.failing.slice(0, 2).join(", ")}` : ""}`);
  for (const d of f.deprecated.slice(0, 2)) add(`Replace the deprecated dependency ${d.name}`);
  if (!f.hasTests) add("Add a first test: this project has none that I can find");
  else if (!f.baseline && f.hasCommands.test === false) add("Add a test command so changes can be checked");
  for (const p of f.untestedImportant.slice(0, 2)) add(`Add tests for ${p}, which changes often and has none`);
  for (const t of f.todoHotspots.slice(0, 2)) add(`Work through the ${t.todo} TODO/FIXME notes in ${t.path}`);
  for (const d of f.behind.slice(0, 2)) add(`Update ${d.name} (${d.declared || "pinned"} to ${d.latest ?? "latest"}), a major version behind`);
  for (const p of f.fragile.slice(0, 1)) add(`Review ${p.path}: changed ${p.changes} times recently and fragile`);
  return out;
}

