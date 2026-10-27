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
  const user = features.map((f, i) => `<data id="${i + 1}">\nfolder-or-word: ${f.name}\nfiles: ${f.files.slice(0, 8).join(", ")}\nroutes: ${f.routes.slice(0, 6).join(", ")}\ntexts: ${f.texts.slice(0, 5).join(" | ")}\n</data>`).join("\n");
  const r = await ask(
    ctx, cap, "brain.features", "index_features", fence(user), FeatureSchema, 1800,
  );
  if (!r.ok) return { features: features.map((f) => ({ ...f })), labelled: false };
  const byId = new Map(r.value.features.map((f) => [f.id, f]));
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
}

/** The welcome as a plain template: what is used when no model could write it, and the shape of what the model is asked for. */
export function fallbackWelcome(f: WelcomeFacts): string {
  const head = `${f.name}${f.blurb ? `: ${f.blurb}` : ""}`.slice(0, 220);
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
    `size: ${facts.fileCount} files (${facts.analysed} read)`, `health: ${facts.health}`,
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

