/**
 * ANSWERING A QUESTION ABOUT A PROJECT'S CODE: THE BRAIN FIRST, A FEW READS ONLY WHEN IT MUST, EVERY CLAIM WITH path:line.
 *
 *   readQuestion   what kind it is (where, what, how, why, impact), whether it is a deep one (strong tier), whether it wants the code itself (question.ts)
 *   locate         where in the project it is about, from the brain's index alone (work/locate.ts, no file read)
 *   FAST PATH      sure of the files, and the brain's summaries, symbols, graph and test map are enough: the model is sent those FACTS and nothing is read.
 *                  A "where" and a "what" nearly always; a "how" when the graph shows the flow; an "impact" from the graph (work/impact.ts).
 *   READ PATH      not sure, or a "why", or the code itself was asked for: the located spans are read, 3 files and 5,000 characters at the most, through the
 *                  job's room (read and grep) when the person has one open, else through GitHub. Never a secret file, never a file nothing pointed at
 *   WHOLE PROJECT  a question about the project as a whole is read the way a newcomer reads it: the brain's map (languages, frameworks, entry points,
 *                  commands, features with their files) and the README, the manifest and the entry files themselves, 4 files and 7,000 characters at most
 *   OVERVIEW       nothing matched: the project's overview is the basis, and the answer says so
 *   THE ANSWER     one call of the front_code_answer role, at the tier the front door's decision named (cheap; strong for a deep why or an impact question)
 *   CITATIONS      each path:line in it is checked against what was seen; the ones that do not resolve are taken out and the notes say so (cite.ts)
 *   THE PICTURE    when the decision plans a diagram, a flow drawn from the import graph by code (flow.ts): no model, no cost
 *   THE THREAD     one more turn in the conversation's rolling summary, and the files this answer found for a hand-off to a job (threads.ts, handoff.ts)
 *
 * THE VALUES. A summary says "a fixed-window rate limit"; the question asked for the default limit and window, and they are in a line of config. So the
 * constants the located files hold (config objects, defaults, default parameters: facts.ts) are read for any question about a value, and for any config file
 * among the files, even on the fast path, and given to the model beside the facts; and after the answer is written the ones the question asks about, and the
 * ones on the lines it cites, must be in it, by name and by value, or they are added in a line of their own.
 *
 * What is sent to the model is fenced as data, the person's words go through the secret scan (forModel), and a file the scan flags is never read for it.
 */
import { aboutLines } from "../../bots/shared.js";
import { askText, type FrontModel } from "../../front/model.js";
import { FrontError } from "../../front/types.js";
import { REPLY_TOKENS, LOCATE_PAISE } from "../../front/path.js";
import type { Length } from "../../front/types.js";
import type { ModelTier } from "../brain/tiers.js";
import type { LiveFiles } from "../live/ports.js";
import type { BrainHandle, BrainView } from "../project/index.js";
import { isSecretPath, isTestPath } from "../project/lang.js";
import { findInMap } from "../project/map.js";
import { computeImpact, extractCues, fence, forModel, locate, type Located, type LocateTarget } from "../work/index.js";
import { CONFIDENT, fusedFor } from "../work/locate.js";
import { cut, type ModelCtx } from "../work/model.js";
import { Anchors, checkCitations, keptLocations } from "./cite.js";
import { factsBlock, gatherFacts, isConfigPath, missingFacts, withMissing, type Fact } from "./facts.js";
import { flowDiagram } from "./flow.js";
import { investigate, type LookTools } from "./look.js";
import { isFollowUp, readQuestion, type QuestionRead } from "./question.js";
import { afterTurn, type ChatThread } from "./threads.js";

/** The least room a code answer has: its citations make it longer than a reply of the same length (the changesets run cut a "short" one mid-sentence). */
export const CODE_ANSWER_TOKENS_MIN = REPLY_TOKENS.medium;

const LANGUAGE_WORDS: Record<string, string> = { en: "English", hinglish: "Hinglish (Hindi in Latin letters, mixed with English)", hi: "Hindi" };

const isAbortErr = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === "AbortError";

/** Where the project map says the things the question names are: the components, each with its functions' exact lines. Free. */
async function mapBrief(brain: ChatBrain, search: string): Promise<string> {
  const map = brain.projectMap ? await brain.projectMap().catch(() => null) : null;
  if (!map) return "";
  return findInMap(map, search.replace(/["'“”‘’`]/g, " "), 4).map((path) => {
    const c = map.components[path];
    return c ? `${c.path}${c.summary ? ` - ${cut(c.summary, 120)}` : ""} [${c.symbols.slice(0, 8).map((sym) => `${sym.name}:${sym.start}-${sym.end ?? sym.start}`).join(", ")}]` : path;
  }).join("\n");
}

/** What reading may cost the model: files, characters in all, and per file. */
export const READ_FILES_MAX = 3;
export const READ_CHARS_MAX = 8_000;
export const READ_FILE_CHARS = 3_000;
/** Lines around where the evidence points, and the lines of a file without a pointer. */
const SPAN_AROUND = 20;
const SPAN_HEAD = 50;
const GREP_PATTERNS_MAX = 2;
const GREP_HITS_MAX = 12;
const FACT_FILES = 3;
const FACT_RELATED = 5;

export type Road = "fast" | "read" | "overview";

export type ChatBrain = Pick<BrainHandle, "status" | "findFiles" | "findSymbols" | "findTexts" | "neighbors" | "testsFor" | "feature" | "features" | "file"> & Partial<Pick<BrainHandle, "projectMap">>;

export interface ChatPorts {
  brain: ChatBrain;
  /** A file's text on the branch (GitHub), or null when it cannot be read. Not called on the fast path, except for the constants of a question about a value. */
  read?: (path: string) => Promise<string | null>;
  /** The job's copy of the code, when the person has a job open on this project: read and grep with no GitHub call. */
  files?: Pick<LiveFiles, "read" | "grep"> | null;
  /** The agent's read-only tools: with them the answer looks before it answers (look.ts). */
  look?: LookTools | null;
}

export interface ChatInput {
  userId: string;
  projectId: string;
  /** The person's words. */
  question: string;
  /** What is searched for: the words, and for a follow-up the thread's last question in front of them. */
  search: string;
  /** When `question` was written out for the person (a reaction like "??"): their own words, which the chat shows, and the question the thread keeps. */
  shown?: string;
  kept?: string;
  /** A follow-up made complete (front/complete.ts): what the person meant, shown to the model beside their words. */
  meant?: string;
  /** What the person told their bots about themselves that may matter here (bots/shared.ts), a few short lines. */
  about?: string[];
  /** The latest job started from this thread, where it stands (its state, report, checks, pull request). */
  job?: string;
  /** The language the person wrote in, as the front door read it: said to the model, so a cue in the prompt does not pull it into another. */
  language?: "en" | "hinglish" | "hi" | "other";
  tier: ModelTier;
  length: Length;
  maxPaise: number;
  thread: ChatThread | null;
  /** The decision plans a diagram: draw the flow from the graph if it shows one. */
  diagram: boolean;
  now: number;
  /** The answer's words as they are written, and word that the ones so far are void. */
  onText?: (piece: string) => void;
  onReset?: () => void;
  /** What it is doing, as it does it: "code:locate", "code:grep", "code:read:<path>", "code:write". */
  onStep?: (stage: string) => void;
}

export interface ChatAnswer {
  text: string;
  paise: number;
  notes: string[];
  /** Mermaid, drawn from the graph, when the decision wanted a diagram and the graph shows a flow. */
  diagram?: string;
  road: Road;
  /** Paths read through GitHub or the room. Empty on the fast path. */
  reads: string[];
  /** Patterns searched through the room. */
  greps: string[];
  /** The citations that stayed, `path:line`. */
  cites: string[];
  located: Located;
  /** The thread after this turn, to be kept; null when the question was asked outside a thread. */
  thread: ChatThread | null;
  /** What the person might ask next, written by the model from its own answer (its last line, "Next: a | b"); none when it gave none. */
  next: string[];
}

/** The answer's last line, "Next: a | b", taken off it: at most NEXT_MAX questions, each short. */
const NEXT_MAX = 3;
const NEXT_LINE = /\n[ \t]*[*_]{0,2}next[*_]{0,2}[ \t]*:[*_]{0,2}([^\n]*)\s*$/i;
export function splitNext(text: string): { text: string; next: string[] } {
  const m = NEXT_LINE.exec(`\n${text}`);
  if (!m) return { text, next: [] };
  const next = m[1]!.split("|").map((q) => q.replace(/^[\s"'“”*_-]+|[\s"'“”*_]+$/g, "").replace(/\s+/g, " ")).filter((q) => q.length >= 3 && q.length <= 90);
  return { text: `\n${text}`.slice(0, m.index).trim(), next: [...new Set(next)].slice(0, NEXT_MAX) };
}

/** The words as they come, without the "Next:" line: held back once it starts, and a few characters held in case it is starting. */
export function withoutNext(onText: (piece: string) => void): { onText: (piece: string) => void; reset: () => void } {
  let all = "";
  let sent = 0;
  return {
    onText: (piece) => {
      all += piece;
      const at = all.search(/\s*\n[ \t]*[*_]{0,2}next[*_]{0,2}[ \t]*:/i);
      const upTo = at >= 0 ? at : Math.max(sent, all.length - 8);
      if (upTo > sent) { onText(all.slice(sent, upTo)); sent = upTo; }
    },
    reset: () => { all = ""; sent = 0; },
  };
}

const trimLocated = (l: Located): Located => ({
  targets: l.targets.slice(0, 5), related: l.related.slice(0, 8), tests: l.tests.slice(0, 6), confidence: l.confidence, used: { expanded: l.used.expanded, picked: l.used.picked, paise: 0 },
});

interface Facts {
  text: string;
  /** Every target had a summary or symbols to say. */
  rich: boolean;
  /** The graph shows a path through more than one file. */
  flow: boolean;
}

/** The brain's own facts about the files a question points at, each line with the file:line it can be cited by. Registers what it names as anchors. */
async function gatherBrainFacts(brain: ChatBrain, located: Located, targets: readonly LocateTarget[], search: string, rq: QuestionRead, anchors: Anchors): Promise<Facts> {
  const lines: string[] = [];
  let rich = targets.length > 0;
  for (const t of targets.slice(0, FACT_FILES)) {
    const row = await brain.file(t.path).catch(() => null);
    if (!row) { rich = false; lines.push(`${t.path}:1 — in the index; ${cut(t.why, 120)}`); anchors.known(t.path, 6000, [1]); continue; }
    anchors.known(t.path, row.bytes, [1, ...row.symbols.map((s) => s.line)]);
    const syms = row.symbols.filter((s) => s.kind !== "env" && s.kind !== "entry" && (s.exported !== false || s.kind === "route")).slice(0, 10);
    // Names alone do not say what code does: with no summary of the file, it is read (the changesets run answered "what rules does it check?"
    // from one function name, and filled the rest from what it guessed).
    if (!row.summary) rich = false;
    const near = await brain.neighbors(t.path).catch(() => ({ imports: [] as string[], importedBy: [] as string[] }));
    lines.push([
      `${t.path}:${t.lines?.[0] ?? 1} — ${row.summary ? cut(row.summary, 220) : "(no summary)"}`,
      ...(syms.length ? [`  symbols: ${syms.map((s) => (s.kind === "route" ? `${s.method ?? "ANY"} ${s.path ?? s.name} :${s.line}` : `${s.kind} ${s.name} :${s.line}`)).join("; ")}`] : []),
      ...(near.imports.length ? [`  uses: ${near.imports.slice(0, 6).join(", ")}`] : []),
      ...(near.importedBy.length ? [`  used by: ${near.importedBy.filter((p) => !isTestPath(p)).slice(0, 6).join(", ")}`] : []),
      ...(row.tests.length ? [`  tests: ${row.tests.slice(0, 3).join(", ")}`] : []),
    ].join("\n"));
  }
  for (const r of located.related.filter((x) => !isSecretPath(x.path) && !targets.some((t) => t.path === x.path)).slice(0, FACT_RELATED)) {
    const row = await brain.file(r.path).catch(() => null);
    if (!row) continue;
    anchors.known(r.path, row.bytes, [1, ...row.symbols.map((s) => s.line)]);
    lines.push(`${r.path}:1 — ${r.relation === "imports" ? "used by" : "uses"} ${r.of}: ${row.summary ? cut(row.summary, 140) : "(no summary)"}`);
  }
  const features = (await brain.features().catch(() => [])).filter((f) => f.files.some((p) => targets.some((t) => t.path === p))).slice(0, 2);
  for (const f of features) lines.push(`feature ${cut(f.name, 60)}: ${cut(f.summary, 160)} (${f.files.slice(0, 6).join(", ")})`);
  // The strings a person sees, when the question could be about one.
  const cues = extractCues(search);
  if (cues.ui || cues.quoted.length) {
    for (const h of (await brain.findTexts(cues.quoted[0] ?? cues.phrase ?? search, 4).catch(() => []))) {
      const row = await brain.file(h.path).catch(() => null);
      if (!row || isSecretPath(h.path)) continue;
      anchors.known(h.path, row.bytes, [h.line]);
      lines.push(`text ${h.path}:${h.line} ${JSON.stringify(cut(h.text, 80))}`);
    }
  }
  // What a change would reach: the graph and the test map, not a guess.
  if (rq.kind === "impact" && targets.length) {
    const impact = await computeImpact(targets.slice(0, 3).map((t) => ({ path: t.path, action: "edit" as const })), brain).catch(() => null);
    if (impact) {
      for (const i of impact.importers.slice(0, 12)) { const row = await brain.file(i.path).catch(() => null); if (row) anchors.known(i.path, row.bytes, [1]); lines.push(`${i.path}:1 — imports ${i.of}`); }
      for (const r of impact.routes.slice(0, 6)) lines.push(`route ${r.route} is served by ${r.file}`);
      if (impact.tests.length) lines.push(`tests to run: ${impact.tests.slice(0, 8).join(", ")}`);
      if (impact.publicApi.length) lines.push(`used by other files: ${impact.publicApi.slice(0, 4).map((a) => `${a.path} (${a.exports.slice(0, 3).join(", ")}; ${a.usedBy} files)`).join("; ")}`);
      if (impact.untested.length) lines.push(`no test covers: ${impact.untested.slice(0, 5).join(", ")}`);
    }
  }
  const flow = located.related.length > 0 || features.some((f) => f.files.length >= 2);
  return { text: lines.join("\n"), rich, flow };
}

/** The lines of a file around where the evidence points, numbered, cut. */
/**
 * The two places in `text` where the question's words gather most (windows of SPAN_HEAD lines, apart), the second only when it holds at least half
 * as many: a question about "fixed and linked" groups finds the fixed rules and, further down, the linked ones. Empty when none of the words is there.
 */
export function bestSpans(text: string, search: string): Array<[number, number]> {
  const first = bestSpan(text, search);
  if (!first) return [];
  const all = text.split("\n");
  const from = first[0] - SPAN_AROUND, to = first[1] + SPAN_AROUND;
  // The rest of the file, with the first window blanked out, searched again.
  const rest = all.map((l, i) => (i + 1 >= from && i + 1 <= to ? "" : l)).join("\n");
  const second = bestSpan(rest, search);
  if (!second) return [first];
  const hits = (span: [number, number]) => wordHits(all.slice(span[0] - SPAN_AROUND - 1, span[1] + SPAN_AROUND), search);
  return hits(second) * 2 >= hits(first) ? [first, second].sort((a, b) => a[0] - b[0]) : [first];
}

const wordHits = (lines: readonly string[], search: string): number => {
  const words = [...wordsOf(search)].filter((w) => w.length >= 4).map((w) => w.replace(/s$/, ""));
  return lines.reduce((n, l) => { const low = l.toLowerCase(); return n + words.filter((w) => low.includes(w)).length; }, 0);
};

/** The windows' lines, numbered, one after the other: the whole of the room one file has. */
function spansOf(text: string, spans: ReadonlyArray<[number, number]>): string {
  if (!spans.length) return around(text);
  return cut(spans.map((sp) => around(text, sp)).join("\n…\n"), READ_FILE_CHARS);
}

/** The lines of `text` where the question's words gather most (a window of SPAN_HEAD lines), or undefined when none of them is there. */
export function bestSpan(text: string, search: string): [number, number] | undefined {
  const words = [...wordsOf(search)].filter((w) => w.length >= 4).map((w) => w.replace(/s$/, ""));
  if (!words.length) return undefined;
  const all = text.split("\n");
  const hits = all.map((l) => { const low = l.toLowerCase(); return words.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0); });
  const win = SPAN_HEAD;
  let sum = hits.slice(0, win).reduce((a, b) => a + b, 0);
  let best = sum, at = 0;
  for (let i = 1; i + win <= all.length; i++) {
    sum += hits[i + win - 1]! - hits[i - 1]!;
    if (sum > best) { best = sum; at = i; }
  }
  if (best === 0) return undefined;
  // around() adds SPAN_AROUND on each side: the window is handed in without it.
  return [at + 1 + SPAN_AROUND, Math.min(all.length, at + win - SPAN_AROUND)];
}

function around(text: string, lines?: [number, number]): string {
  const all = text.split("\n");
  const from = lines ? Math.max(1, lines[0] - SPAN_AROUND) : 1;
  const to = Math.min(all.length, lines ? lines[1] + SPAN_AROUND : SPAN_HEAD);
  return cut(all.slice(from - 1, to).map((l, i) => `${from + i}: ${l.length > 200 ? `${l.slice(0, 199)}…` : l}`).join("\n"), READ_FILE_CHARS);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A chat answer as a chat shows it: a heading is a bold line, and a code name runs into the next word with a space between ("`index.js:1`exports"). */
export function tidy(text: string): string {
  // Code spans are taken left to right as pairs, so the gap between two of them is never read as one (that put a space inside "`program`").
  const spaced = text.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "**$1**")
    .replace(/`[^`\n]+`/g, (span: string, at: number, all: string) => (/^[A-Za-z]{3}/.test(all.slice(at + span.length, at + span.length + 3)) ? `${span} ` : span));
  // The prompt's word for what was read is not the person's: outside code, "the excerpts" are the files read.
  return spaced.split(/(`[^`\n]*`)/).map((part) => (part.startsWith("`") ? part : part
    .replace(/\b(?:the|these|those|this|that) excerpts?(?: (?:I was given|you gave(?: me)?|you've given(?: me)?|I have|I got|I can see|I see|shown|provided|here))?\b/gi, (m) => (m[0] === m[0]!.toUpperCase() ? "The files I read" : "the files I read"))
    .replace(/\bexcerpts?\b/gi, "the files I read"))).join("").replace(/\bthe the\b/gi, "the");
}

const TAG_WORDS: Record<string, string> = {
  facts: "the project's index", excerpts: "the files I read", thread: "our chat", last_answer: "my last answer", job: "the job", meant: "your question", earlier: "earlier answers", about_them: "what you told me",
};
/** The prompt's block names said in plain words: a person never reads "<excerpts>" (the changesets run: "<facts>/<excerpts> mein ..."). */
export function plainTags(text: string): string {
  const tag = /<\/?(facts|excerpts|thread|last_answer|job|meant|earlier|about_them)>(?:\s*\/\s*<\/?(facts|excerpts|thread|last_answer|job|meant|earlier|about_them)>)?/g;
  // Only outside code: a backtick span is the project's own text, unless it is nothing but one of the block names ("The `<job>` says").
  const named = /^`<\/?(facts|excerpts|thread|last_answer|job|meant|earlier|about_them)>`$/;
  return text.split(/(`[^`\n]*`)/)
    .map((part) => (named.test(part) ? TAG_WORDS[named.exec(part)![1]!]! : part.startsWith("`") ? part : part.replace(tag, (_m, a: string, b?: string) => (b ? `${TAG_WORDS[a]} and ${TAG_WORDS[b]}` : TAG_WORDS[a]!))))
    .join("").replace(/\b([Tt]he) the\b/g, "$1");
}

/** The patterns worth a grep for this question: the names in the words, and a quoted string. */
export function grepPatterns(search: string): string[] {
  const cues = extractCues(search);
  return [...cues.identifiers, ...cues.quoted].filter((s) => s.length >= 3 && s.length <= 80).slice(0, GREP_PATTERNS_MAX).map(escapeRe);
}

/** Reads the located spans (and greps, with a room), registering every line it saw as an anchor. Returns the excerpts. */
/**
 * Not sure of the files: the free ranking's best (names, symbols, words; no model) are read beside the model's picks, one of each in turn, so a file
 * the question is about is opened, not only named (the changesets run: "rules.ts holds the fixed and linked checks, but I can't see its contents").
 */
async function withRanked(targets: readonly LocateTarget[], search: string, brain: ChatBrain): Promise<LocateTarget[]> {
  // Ranked with the quote marks and without: the ranking takes a quoted piece for a string on a screen and leaves its words out, which hid
  // 'trust proxy' (a setting's name) in the express run; and the project's own source before its examples and docs, which name it everywhere.
  const plain = search.replace(/["'“”‘’`]/g, " ");
  const runs = await Promise.all([fusedFor(search, brain).catch(() => []), plain !== search ? fusedFor(plain, brain).catch(() => []) : Promise.resolve([])]);
  const best = new Map<string, (typeof runs)[number][number]>();
  for (const f of runs.flat()) if ((best.get(f.path)?.score ?? -1) < f.score) best.set(f.path, f);
  const aside = (p: string) => (/(^|\/)(?:examples?|samples?|demos?|docs?|benchmarks?|fixtures?)\//i.test(p) ? 1 : 0);
  const ranked = [...best.values()].filter((f) => !isSecretPath(f.path) && !targets.some((t) => t.path === f.path))
    .sort((a, b) => aside(a.path) - aside(b.path) || b.score - a.score).slice(0, READ_FILES_MAX - 1);
  const out: LocateTarget[] = [];
  for (let i = 0; i < Math.max(targets.length, ranked.length); i++) {
    if (targets[i]) out.push(targets[i]!);
    const f = ranked[i];
    if (f) out.push({ path: f.path, why: "ranked by name, symbols and words", signals: f.signals, score: f.score });
  }
  return out;
}

/**
 * A question about the tests reads the tests: the ones the thread's job changed, then the ones the index links to the files (and to the files that
 * use them), one of each in turn with the code (the changesets run answered "is the 3-group case covered?" from the job's report, never opening the test).
 */
async function withTests(targets: readonly LocateTarget[], job: string | undefined, brain: ChatBrain): Promise<LocateTarget[]> {
  const found: string[] = [];
  for (const m of (job ?? "").matchAll(/^\s*-\s+(\S+)\s+\((?:changed|added)\)/gm)) if (isTestPath(m[1]!)) found.push(m[1]!);
  for (const t of targets.slice(0, 2)) {
    found.push(...(await brain.testsFor(t.path).catch(() => [] as string[])));
    const near = await brain.neighbors(t.path).catch(() => null);
    for (const p of (near?.importedBy ?? []).filter((x) => !isTestPath(x)).slice(0, 2)) found.push(...(await brain.testsFor(p).catch(() => [] as string[])));
  }
  const tests = [...new Set(found)].filter((p) => !isSecretPath(p) && !targets.some((t) => t.path === p)).slice(0, 2);
  const out: LocateTarget[] = [];
  for (let i = 0; i < Math.max(tests.length, targets.length); i++) {
    if (tests[i]) out.push({ path: tests[i]!, why: "a test of the code in question", signals: [], score: 1 });
    if (targets[i]) out.push(targets[i]!);
  }
  return out;
}

async function readSpans(ports: ChatPorts, targets: readonly LocateTarget[], search: string, anchors: Anchors, onStep?: (stage: string) => void): Promise<{ excerpts: string[]; reads: string[]; greps: string[] }> {
  const excerpts: string[] = [];
  const reads: string[] = [];
  const greps: string[] = [];
  let chars = 0;
  const room = ports.files;
  if (room) {
    for (const pattern of grepPatterns(search)) {
      onStep?.("code:grep");
      const r = await room.grep(pattern, { context: 1, maxResults: GREP_HITS_MAX }).catch(() => null);
      if (r?.kind !== "ok" || !r.out.text.trim()) continue;
      greps.push(pattern);
      for (const m of r.out.text.matchAll(/^([^\s:]+):(\d+):/gm)) { if (!isSecretPath(m[1]!)) anchors.hit(m[1]!, Number(m[2])); }
      const body = cut(r.out.text.split("\n").filter((l) => { const p = /^([^\s:]+)[:-]\d+[:-]/.exec(l)?.[1]; return !p || !isSecretPath(p); }).join("\n"), 1_200);
      excerpts.push(`grep ${pattern}\n${body}`);
      chars += body.length;
    }
  }
  for (const t of targets.slice(0, READ_FILES_MAX)) {
    if (isSecretPath(t.path) || chars >= READ_CHARS_MAX) continue;
    onStep?.(`code:read:${t.path}`);
    let body: string | null = null;
    if (room && t.lines) {
      const from = Math.max(1, t.lines[0] - SPAN_AROUND);
      const r = await room.read(t.path, { offset: from, limit: t.lines[1] - t.lines[0] + 2 * SPAN_AROUND + 1 }).catch(() => null);
      if (r?.kind === "ok") { body = cut(r.out.text, READ_FILE_CHARS); anchors.lines(t.path, r.out.total); }
    }
    if (body === null && ports.read) {
      // A file with no pointer into it is read where the question's words gather, not from its top (the changesets run read rules.ts's imports only).
      const text = await ports.read(t.path).catch(() => null);
      if (text !== null) { anchors.read(t.path, text); body = t.lines ? around(text, t.lines) : spansOf(text, bestSpans(text, search)); }
    }
    if (body === null && room && !t.lines) {
      const r = await room.read(t.path, { offset: 1, limit: SPAN_HEAD }).catch(() => null);
      if (r?.kind === "ok") { body = cut(r.out.text, READ_FILE_CHARS); anchors.lines(t.path, r.out.total); }
    }
    if (body === null) continue;
    reads.push(t.path);
    excerpts.push(`${t.path}\n${body}`);
    chars += body.length;
  }
  return { excerpts, reads, greps };
}

const ctxOf = (m: FrontModel, maxPaise: number): ModelCtx => ({
  ...(m.call ? { call: m.call } : {}), ...(m.gateway ? { gateway: m.gateway } : {}), userId: m.userId, budget: { maxPaise }, ...(m.signal ? { signal: m.signal } : {}),
});

/** Words too common to say what a turn was about. */
const COMMON = new Set(["the", "and", "for", "with", "that", "this", "what", "where", "when", "how", "why", "which", "does", "did", "are", "was", "were", "has", "have", "can", "you", "your", "our", "its", "from", "into", "about", "there", "here", "then", "than", "but", "not", "all", "any", "kya", "hai", "kaise", "kahan", "mein"]);
const wordsOf = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []).filter((w) => !COMMON.has(w)));
/** The most of an earlier answer shown, and how many earlier turns. */
const EARLIER_CHARS = 800;
const EARLIER_TURNS = 2;

/**
 * Earlier turns this question is about, beyond the last one: picked by the words they share with what is looked up (two at least), the most
 * recent first on a tie, for nothing. A chat can go on for ever: the summary says what was asked, and this brings back what was answered when
 * it matters again.
 */
export function earlierTurns(thread: ChatThread | null, search: string): Array<{ q: string; a: string }> {
  const turns = (thread?.history ?? []).slice(0, -1);
  if (!turns.length) return [];
  const want = wordsOf(search);
  return turns
    .map((t, i) => {
      const have = wordsOf(`${t.q} ${t.a.slice(0, 2000)}`);
      let shared = 0;
      for (const w of want) if (have.has(w)) shared += 1;
      return { t, i, shared };
    })
    .filter((x) => x.shared >= 2 && x.t.a)
    .sort((a, b) => b.shared - a.shared || b.i - a.i)
    .slice(0, EARLIER_TURNS)
    .sort((a, b) => a.i - b.i)
    .map((x) => ({ q: x.t.q, a: cut(x.t.a, EARLIER_CHARS) }));
}

/** The most of the last answer shown to the model with a follow-up. */
const LAST_ANSWER_CHARS = 2_500;
/** What was said last, when this question goes on from it ("??", "why?", "and the logout?"): a chat answers a follow-up knowing its own last words. */
const lastAnswer = (input: ChatInput): string => {
  const last = input.thread?.history.at(-1);
  return last?.a && (input.kept !== undefined || isFollowUp(input.question)) ? cut(last.a, LAST_ANSWER_CHARS) : "";
};

/** The block of the thread's summary the model is shown, as data. */
const threadBlock = (t: ChatThread | null): string => (t?.summary ? `<thread>\n${fence(forModel(t.summary))}\n</thread>\n\n` : "");

/** The most files read for their constants, and the most of a file that is taken. */
const VALUE_FILES = 5;
const VALUE_FILE_LINES = 400;

/** A file's text, from the job's room when there is one, else from GitHub; null when neither can say. */
function readerOf(ports: ChatPorts): ((path: string) => Promise<string | null>) | null {
  const room = ports.files;
  if (!room && !ports.read) return null;
  return async (path) => {
    if (room) {
      const r = await room.read(path, { offset: 1, limit: VALUE_FILE_LINES }).catch(() => null);
      if (r?.kind === "ok") return r.out.text;
    }
    return ports.read ? ports.read(path).catch(() => null) : null;
  };
}

/**
 * The configuration and constants of the files a question is about: the located files, the files beside them, and the config files they import. Read for a
 * question that asks for a value, and for any config file among them; a question about where something is, with no config file in sight, reads nothing.
 */
async function gatherValues(ports: ChatPorts, located: Located, targets: readonly LocateTarget[], rq: QuestionRead, anchors: Anchors): Promise<Fact[]> {
  const read = readerOf(ports);
  if (!read) return [];
  const near = [...targets.map((t) => t.path), ...located.related.map((r) => r.path)].filter((p) => !isSecretPath(p) && !isTestPath(p));
  // The config files the located files import: the defaults are rarely in the file that applies them.
  const imported: string[] = [];
  for (const t of targets.slice(0, FACT_FILES)) {
    const n = await ports.brain.neighbors(t.path).catch(() => null);
    for (const p of n?.imports ?? []) if (isConfigPath(p)) imported.push(p);
  }
  const paths = [...new Set([...near, ...imported])];
  if (!rq.values && !paths.some(isConfigPath)) return [];
  // The config files first: they are where a default is written.
  const ordered = [...paths.filter(isConfigPath), ...paths.filter((p) => !isConfigPath(p))].slice(0, VALUE_FILES);
  const { facts, texts } = await gatherFacts(ordered, read, { files: VALUE_FILES });
  for (const [path, text] of texts) anchors.read(path, text);
  return facts;
}

/** What a whole-project question may read: files, characters in all. */
const WHOLE_FILES = 4;
const WHOLE_CHARS = 7_000;
/** The manifest a project of this main language keeps at its root; package.json for the rest. */
const MANIFESTS: Record<string, string> = { python: "pyproject.toml", rust: "Cargo.toml", go: "go.mod", java: "pom.xml", php: "composer.json", ruby: "Gemfile" };

/**
 * The project as a newcomer reads it: the brain's map of it, then the README, the manifest and the entry files themselves. The map names files
 * without lines; only what was read can be cited by line.
 */
async function wholeProject(ports: ChatPorts, anchors: Anchors, onStep?: (s: string) => void): Promise<{ basis: string; excerpts: string[]; reads: string[] }> {
  const view: BrainView = await ports.brain.status();
  const st = view.structure;
  const map = [
    cut(view.welcome, 800),
    st ? `${st.fileCount} files; ${st.languages.slice(0, 5).map((l) => `${l.lang} ${Math.round(l.pct)}%`).join(", ")}` : "",
    st?.frameworks.length ? `frameworks: ${st.frameworks.join(", ")}` : "",
    st?.readme ? `readme ${st.readme.path}: ${st.readme.title}${st.readme.blurb ? ` - ${cut(st.readme.blurb, 300)}` : ""}` : "",
    st?.entryPoints.length ? `entry points:\n${st.entryPoints.slice(0, 6).map((e) => `${e.path} (${e.why})`).join("\n")}` : "",
    st?.commands.length ? `commands:\n${st.commands.slice(0, 6).map((c) => `${c.kind}: ${c.cmd}`).join("\n")}` : "",
    view.features.length
      ? `features:\n${view.features.slice(0, 10).map((f) => `${f.name}: ${cut(f.summary, 140)} (${f.files.slice(0, 4).join(", ")}${f.fileCount > 4 ? `, ${f.fileCount - 4} more` : ""})`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
  const read = readerOf(ports);
  const excerpts: string[] = [];
  const reads: string[] = [];
  if (read) {
    const manifest = MANIFESTS[(st?.languages[0]?.lang ?? "").toLowerCase()] ?? "package.json";
    const wanted = [...new Set([st?.readme?.path ?? "README.md", manifest, ...(st?.entryPoints ?? []).map((e) => e.path)])].filter((p) => !isSecretPath(p));
    let chars = 0;
    for (const path of wanted) {
      if (reads.length >= WHOLE_FILES || chars >= WHOLE_CHARS) break;
      onStep?.(`code:read:${path}`);
      const text = await read(path);
      if (text === null) continue;
      anchors.read(path, text);
      const body = around(text);
      reads.push(path);
      excerpts.push(`${path}\n${body}`);
      chars += body.length;
    }
  }
  return { basis: map, excerpts, reads };
}

/** The same ports, with GitHub asked for a file once however many steps want it (the values are read from the files the excerpts are). */
function cachedPorts(ports: ChatPorts): ChatPorts {
  const read = ports.read;
  if (!read) return ports;
  const seen = new Map<string, Promise<string | null>>();
  return { ...ports, read: (path) => { let got = seen.get(path); if (!got) { got = read(path); seen.set(path, got); } return got; } };
}

export async function answerCode(input: ChatInput, given: ChatPorts, model: FrontModel): Promise<ChatAnswer> {
  const ports = cachedPorts(given);
  const { brain } = ports;
  const anchors = new Anchors();
  const rq = readQuestion(input.kept ?? input.meant ?? input.question);
  const notes: string[] = [];

  // Where it is, from the index alone: no file is read to find out.
  input.onStep?.("code:locate");
  const located = await locate(input.search, brain, { model: ctxOf(model, Math.max(1, Math.min(LOCATE_PAISE, input.maxPaise))) });
  const targets = located.targets.filter((t) => !isSecretPath(t.path)).slice(0, FACT_FILES);
  const sure = !located.question && located.confidence >= CONFIDENT && targets.length > 0;
  // Said after the reading, and only when nothing could be read: an answer from the files it read rests on them, sure or not.
  const unsure = !sure && targets.length > 0;

  let road: Road;
  let facts: Facts = { text: "", rich: false, flow: false };
  let values: Fact[] = [];
  let excerpts: string[] = [];
  let reads: string[] = [];
  const seenNow: string[] = [];
  let greps: string[] = [];
  let basis = "";
  if (rq.whole) {
    // The whole project: its map and the files a newcomer opens first, whatever the words happened to match.
    let map: string;
    ({ basis: map, excerpts, reads } = await wholeProject(ports, anchors, input.onStep));
    // The map is the facts beside what was read; with nothing read, it is the basis itself.
    road = reads.length ? "read" : "overview";
    if (reads.length) facts = { text: map, rich: true, flow: false };
    else basis = map;
  } else if (targets.length) {
    facts = await gatherBrainFacts(brain, located, targets, input.search, rq, anchors);
    values = await gatherValues(ports, located, targets, rq, anchors);
    if (values.length) facts = { ...facts, text: `${facts.text}\nvalues in the code:\n${factsBlock(values)}` };
    // Enough from the brain alone? Sure of the files, the facts say something about each, and the question is not one that needs the code itself.
    const fast = sure && facts.rich && rq.kind !== "why" && !rq.wantsCode && !rq.tests && !rq.usage && (rq.kind !== "how" || facts.flow);
    if (fast) road = "fast";
    else {
      // Unsure, or asked where something is used (its uses are rarely where it is defined): the free ranking's picks are read beside the model's.
      const reading = sure && !rq.usage ? targets : await withRanked(targets, input.search, brain);
      ({ excerpts, reads, greps } = await readSpans(ports, rq.tests ? await withTests(reading, input.job, brain) : reading, input.search, anchors, input.onStep));
      road = "read";
      if (!excerpts.length) notes.push(unsure ? "I was not sure which part of the code this is about, and could not read the files, so this rests on the project's index." : "I could not read the files themselves, so this rests on the project's index.");
    }
  } else {
    const view: BrainView = await brain.status();
    road = "overview";
    basis = `${cut(view.welcome, 800)}\n${view.features.slice(0, 8).map((f) => `${f.name}: ${cut(f.summary, 100)}`).join("\n")}`;
    if (!input.job) notes.push("Nothing in the code matched, so this answer is from the project's overview.");
  }

  const left = Math.max(0, input.maxPaise - located.used.paise);
  const earlier = earlierTurns(input.thread, input.search);
  const blocks = [
    `<question>\n${forModel(input.question).replace(/<\/question/gi, "<\\/question")}\n</question>`,
    ...(input.language && LANGUAGE_WORDS[input.language] ? [`Answer in ${LANGUAGE_WORDS[input.language]}.`] : []),
    ...(input.meant && input.meant !== input.question ? [`<meant>\n${fence(forModel(input.meant))}\n</meant>`] : []),
    ...(input.about?.length ? [`<about_them>\n${fence(forModel(aboutLines(input.about)))}\n</about_them>`] : []),
    ...(input.job ? [`<job>\n${fence(forModel(input.job))}\n</job>`] : []),
    ...(input.thread?.summary ? [threadBlock(input.thread).trim()] : []),
    ...(earlier.length ? [`<earlier>\n${fence(forModel(earlier.map((t) => `Q: ${t.q}\nA: ${t.a}`).join("\n\n")))}\n</earlier>`] : []),
    ...(lastAnswer(input) ? [`<last_answer>\n${fence(forModel(lastAnswer(input)))}\n</last_answer>`] : []),
    ...(facts.text ? [`<facts>\n${fence(forModel(facts.text))}\n</facts>`] : []),
    `<excerpts>\n${fence(forModel(excerpts.length ? excerpts.join("\n\n") : basis || "(none read)"))}\n</excerpts>`,
  ].filter((p) => road !== "fast" || !p.startsWith("<excerpts>"));
  const user = blocks.join("\n\n");
  input.onStep?.("code:write");
  const words = input.onText ? withoutNext(input.onText) : null;
  const maxTokens = Math.max(REPLY_TOKENS[input.length], CODE_ANSWER_TOKENS_MIN);
  const reset = input.onReset || words ? { onReset: () => { words?.reset(); input.onReset?.(); } } : {};
  let r: { text: string; paise: number };
  if (ports.look) {
    // Look before answering (look.ts): the same blocks are the brief, with where the map says things are and what this chat read before.
    const [question, ...known] = blocks;
    const map = await mapBrief(brain, input.search);
    const before = input.thread?.seen?.length ? `Read earlier in this chat: ${input.thread.seen.slice(-12).join(", ")}` : "";
    const brief = [question!, `<brief>\n${[...known, ...(map ? [`<map>\n${fence(forModel(map))}\n</map>`] : []), ...(before ? [before] : [])].join("\n\n")}\n</brief>`].join("\n\n");
    try {
      const looked = await investigate({
        model, tier: input.tier, user: brief, tools: ports.look, anchors, maxPaise: Math.max(1, left), maxTokens,
        ...(words ? { onText: words.onText } : {}), ...reset, ...(input.onStep ? { onStep: input.onStep } : {}),
      });
      // Nothing to say after looking (the money or the model gave out before an answer could be had): said plainly, never an empty reply.
      if (!looked.text) throw new FrontError("model_down", "I could not finish looking into that just now. Nothing was changed; try again in a moment.", 503);
      r = looked;
      for (const p of looked.reads) if (!reads.includes(p)) reads.push(p);
      greps.push(...looked.greps.filter((g) => !greps.includes(g)));
      seenNow.push(...looked.seen);
      if (looked.steps > 1) road = "read";
    } catch (err) {
      if (isAbortErr(err) || err instanceof FrontError) throw err;
      throw new FrontError("model_down", "No model could be reached just now. Nothing was changed; try again in a moment.", 503);
    }
  } else {
    r = await askText(model, {
      role: "front_code_answer", tier: input.tier, purpose: "front.code_answer", maxTokens, budget: { maxPaise: left }, user,
      ...(words ? { onText: words.onText } : {}), ...reset,
    });
  }
  const { text: said, next } = splitNext(r.text);

  // Every path:line in the answer is something that was seen; the rest is taken out, and the notes say so.
  const checked = checkCitations(tidy(plainTags(said)), anchors);
  if (checked.dropped.length) notes.push(`I took out ${checked.dropped.length} reference${checked.dropped.length === 1 ? "" : "s"} to code I could not find.`);
  // The values the question asks about, and the ones on the lines it cites, are in the answer by name and by value; the ones it left out are added, with where they are.
  // Values named by the question are added only to a question that asks for a value: "how does the help print a line?" got "displayHelp is true".
  const missing = missingFacts(values, rq.values ? input.question : "", checked.text);
  const answerText = withMissing(checked.text, missing);
  if (missing.length) notes.push(`The answer left out ${missing.length === 1 ? "a value" : `${missing.length} values`} the code holds (${missing.map((f) => f.name).join(", ")}), so ${missing.length === 1 ? "it was" : "they were"} added.`);
  const cites = [...new Set([...keptLocations(checked.kept), ...missing.map((f) => `${f.path}:${f.line}`)])];

  const diagram = input.diagram && targets.length ? (await flowDiagram(brain, targets.map((t) => t.path))) ?? undefined : undefined;
  const slim = trimLocated(located);
  const thread = input.thread ? afterTurn(input.thread, {
    question: input.kept ?? input.question, ...(input.shown !== undefined ? { shown: input.shown } : {}), cites, located: targets.length ? slim : null, now: input.now, answer: answerText, next,
    seen: [...reads.filter((p) => !seenNow.some((x) => x.startsWith(`${p}:`))), ...seenNow],
  }) : null;
  return {
    text: answerText, paise: r.paise + located.used.paise, notes, ...(diagram ? { diagram } : {}), road, reads, greps, cites, located: slim, thread, next,
  };
}
