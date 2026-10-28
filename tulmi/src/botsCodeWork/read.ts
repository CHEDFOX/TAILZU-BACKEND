/**
 * THE CODE BOT AT WORK, READ FOR THE BOTS APP (screens/codeWork.ts): pure helpers that turn what the existing routes return
 * (GET /v1/code/jobs/:id, its log and team, an artifact's text, an answer's words) into what the screens draw.
 *
 *   outline(source)     an artifact's markup (html, svg, a React component's JSX) as a tree of the parts a person can point at,
 *                       each with the viewer's own element id ("line:col" of its "<" in the source, viewer/docs/artifact-viewer.md
 *                       section 4), so POST /v1/artifacts/:id/edit { elementId } changes only that part
 *   flowOf(mermaid)     the boxes of a `flowchart` the code chat drew (code/chat/flow.ts), in the order the arrows go
 *   citations(text)     the `path:line` an answer rests on (code/chat/cite.ts kept only the ones it saw)
 *   plainWords(md)      an answer's Markdown as paragraphs and code blocks
 *   stageOf(phase)      the agent's phase as the five stages the boards show (Understand · Plan · Build · Check · Ship)
 *   workLines(entries)  the work log as the short lines "watch it work" shows (Read…, Edited…, Ran…)
 *   tries(entries)      what a job that failed tried: each check it ran and what came of it
 *   counts(...)         the numbers of a finished job (files, tests, minutes)
 *
 * Nothing here reads a store, the network or the clock.
 */
import { attachmentKindOf, type MediaKind } from "../media/types.js";

// ------------------------------------------------------------------ the shapes the routes return (as much as is read)

/** GET /v1/code/jobs/:id → job (routes/codeJobs.ts, stripAgent). */
export interface JobRow {
  id: string;
  projectId: string;
  branch: string;
  task: string;
  state: "queued" | "running" | "waiting_for_compute" | "waiting_for_you" | "paused" | "done" | "failed" | "cancelled";
  placement: "none" | "desktop" | "github" | "paid";
  budgetPaise: number;
  spentPaise: number;
  reason: string;
  waitingOn: "paid" | "commit" | "answer" | "approval" | "budget" | null;
  agent: boolean;
  createdAt: number;
  updatedAt: number;
}

/** GET /v1/code/jobs/:id → steps (jobs/types.ts JobStep, narrowed). */
export interface StepRow {
  idx: number;
  kind: "edit" | "exec";
  commands: string[];
  status: string;
  exitCode: number | null;
  outputTail: string;
  minutes: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** GET /v1/code/jobs/:id → agent (code/agent/orchestrator.ts AgentView, narrowed). */
export interface AgentView {
  phase: string;
  waiting?: { kind: string; question?: string; options?: string[]; for?: string; action?: string; faceId?: boolean; summary?: Record<string, unknown> };
  plan?: { risk: string; steps: Array<{ n: number; do: string; files: string[] }> };
  staged: string[];
  commits: string[];
  pr?: { number: number; url: string; ready: boolean };
  verify?: { ran: boolean; ok: boolean; summary: string };
  fixRounds: number;
  steps: number;
  findings: Array<{ severity: string; path: string; line?: number; text: string }>;
  report?: { outcome: "done" | "failed" | "budget" | "answer"; text: string; prUrl?: string; costPaise: number; continueWithPaise?: number };
  notes: string[];
  spec?: { artifactId: string; version: number; title: string };
  design?: { stage: string; round: number; match?: number; skipped?: string };
  team?: { stage: string; why: string; parts: Array<{ id: number; title: string; status: string; jobId?: string }> };
  part?: { parentId: string; id: number; title: string; round: number };
}

export interface JobRead {
  job: JobRow;
  steps: StepRow[];
  agent?: AgentView;
}

/** GET /v1/code/jobs/:id/log → entries (code/work/worklogStore.ts WorkEntry). */
export interface WorkEntry {
  seq: number;
  at: number;
  kind: "step" | "read" | "edit" | "command" | "finding" | "decision" | "question" | "note";
  text: string;
  files?: string[];
  data?: Record<string, unknown>;
}

/** GET /v1/code/projects/:id → project (code/store.ts CodeProject, narrowed). */
export interface ProjectRow {
  id: string;
  fullName: string;
  defaultBranch: string;
}

/** GET /v1/code/jobs/:id/team (code/team/types.ts TeamView and the helpers' jobs). */
export interface TeamRead {
  job: { id: string; state: JobRow["state"]; budgetPaise: number; spentPaise: number };
  team: {
    stage: "contracts" | "run" | "final" | "done";
    why: string;
    reason: string;
    parallel: number;
    budget: { totalPaise: number; spentPaise: number; reservePaise: number; poolPaise: number };
    parts: PartRow[];
    notes: string[];
  };
  children: Array<{ part: number; jobId: string; state: JobRow["state"]; waitingOn: string | null; reason: string; spentPaise: number; budgetPaise: number }>;
}

export interface PartRow {
  id: number;
  title: string;
  goal: string;
  kind: "files" | "repo";
  status: "waiting" | "ready" | "running" | "blocked" | "reviewing" | "fixing" | "approved" | "merged" | "failed" | "stopped" | "exhausted" | "skipped";
  ownedPaths: string[];
  dependsOn: number[];
  branch?: string;
  jobId?: string;
  budgetPaise: number;
  spentPaise: number;
  fixRounds: number;
  review?: { verdict: string; family?: string; writerFamily?: string; summary: string; findings: number; blockers: number };
  reason?: string;
}

/** GET /v1/artifacts/:id (routes/artifacts.ts). */
export interface ArtifactRead {
  artifact: { id: string; projectId: string | null; type: string; title: string; headVersion: number; spentPaise: number; createdAt: number; updatedAt: number };
  version: number;
  content: string;
}

/** GET /v1/artifacts/:id/versions. */
export interface VersionRow {
  version: number;
  madeBy: "bot" | "person";
  note: string;
  createdAt: number;
}

/** GET /v1/files (routes/files.ts): the person's files, and the ref an ask carries. */
export interface FileRow {
  id: string;
  name: string;
  kind: string;
  mime: string;
  bytes: number;
  sha256: string;
  createdAt: number;
  pages?: number;
  durationSeconds?: number;
}

/** The ref an ask carries for a file already read (routes/files.ts attachmentOf): no bytes, read again by its SHA-256. */
export function refOf(f: FileRow): { id: string; kind: string; mime: string; bytes: number; sha256: string; name: string } {
  return { id: f.id, kind: attachmentKindOf(f.kind as MediaKind), mime: f.mime, bytes: f.bytes, sha256: f.sha256, name: f.name };
}

// ------------------------------------------------------------------ jobs

export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const ENDED: readonly JobRow["state"][] = ["done", "failed", "cancelled"];
export const isOver = (s: JobRow["state"]): boolean => ENDED.includes(s);

export const STAGES = ["Understand", "Plan", "Build", "Check", "Ship"];

/** The agent's phase as the index of the stage it is in (5: all done). */
export function stageOf(phase: string | undefined, state: JobRow["state"]): number {
  if (state === "done") return 5;
  switch (phase) {
    case "plan": case "split": return 1;
    case "work": case "team": return 2;
    case "verify": case "design": return 3;
    case "commit": case "pr": case "report": return 4;
    case "done": return 5;
    default: return 0;
  }
}

/** "owner/storefront" → "storefront". */
export const projectName = (p: { fullName: string } | undefined | null): string => (p?.fullName ?? "").split("/").pop() || "your project";

/** The minutes between two times, as a person reads them ("6 min", "1 h 20 min"). */
export function minutesBetween(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / 60_000));
}

/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function ago(then: number, now: number): string {
  const m = Math.max(0, Math.round((now - then) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const short = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const fileOf = (p: string): string => p.split("/").filter(Boolean).slice(-2).join("/") || p;

export interface WorkLine {
  /** done: it happened. waiting: what it waits for now. */
  mark: "done" | "working" | "waiting";
  text: string;
  sub?: string;
}

/** A test count in a check's words: "18 passed", "17 of 18 pass", "Tests 3 failed | 45 passed (48)". */
export function testCount(s: string): { pass?: number; total?: number; fail?: number } {
  const out: { pass?: number; total?: number; fail?: number } = {};
  const of = /(\d+)\s+of\s+(\d+)\s+(?:tests?\s+)?pass/i.exec(s);
  if (of) return { pass: Number(of[1]), total: Number(of[2]) };
  const p = /(\d+)\s+(?:tests?\s+)?pass(?:ed|es)?\b/i.exec(s);
  const f = /(\d+)\s+(?:tests?\s+)?fail(?:ed|s|ing)?\b/i.exec(s);
  const t = /\((\d+)\)|(\d+)\s+tests?\b/i.exec(s);
  if (p) out.pass = Number(p[1]);
  if (f) out.fail = Number(f[1]);
  if (t) out.total = Number(t[1] ?? t[2]);
  if (out.total === undefined && out.pass !== undefined && out.fail !== undefined) out.total = out.pass + out.fail;
  return out;
}

/** A check's result in a few words: "18 tests · 17 pass", "passed", "3 failing". */
function checkWords(e: WorkEntry): string {
  const d = e.data ?? {};
  const summary = typeof d.summary === "string" ? d.summary : "";
  const n = testCount(summary);
  if (n.total !== undefined && n.pass !== undefined) return `${n.total} tests · ${n.pass} pass`;
  if (n.fail) return `${n.fail} failing`;
  const code = typeof d.exitCode === "number" ? d.exitCode : null;
  if (summary) return short(summary.replace(/\s+/g, " "), 60);
  return code === 0 ? "passed" : code === null ? "" : "failed";
}

/** One entry of the work log as a line, or null for what the short list leaves out (notes, decisions). */
export function workLine(e: WorkEntry): WorkLine | null {
  const files = (e.files ?? []).map(fileOf);
  switch (e.kind) {
    case "read": return { mark: "done", text: `Read ${files[0] ?? short(e.text, 60)}${files.length > 1 ? ` and ${files.length - 1} more` : ""}` };
    case "edit": {
      const action = String(e.data?.action ?? "edit");
      const verb = action === "create" ? "Made" : action === "delete" ? "Removed" : "Edited";
      return { mark: "done", text: `${verb} ${files[0] ?? "a file"}${files.length > 1 ? ` and ${files.length - 1} more` : ""}`, ...(e.text ? { sub: short(e.text, 90) } : {}) };
    }
    case "command": {
      const kind = typeof e.data?.kind === "string" ? e.data.kind : "";
      const words = checkWords(e);
      const what = kind === "test" ? "the tests" : kind === "build" ? "the build" : kind === "lint" ? "the linter" : kind === "typecheck" ? "the type check" : short(e.text, 40);
      return { mark: "done", text: words && kind === "test" && /tests/.test(words) ? `Ran ${words}` : `Ran ${what}${words ? ` · ${words}` : ""}` };
    }
    case "step": return { mark: "done", text: short(e.text, 80) };
    case "question": return { mark: "done", text: `Asked: ${short(e.text, 70)}`, ...(typeof e.data?.answer === "string" ? { sub: `You said: ${short(e.data.answer, 60)}` } : {}) };
    default: return null;
  }
}

/** The last few things the job did, and what it waits for now. */
export function workLines(entries: WorkEntry[], o: { max: number; waiting?: string; working?: string }): WorkLine[] {
  const lines = entries.map(workLine).filter((l): l is WorkLine => !!l);
  const tail = lines.slice(-Math.max(0, o.max - (o.waiting || o.working ? 1 : 0)));
  if (o.waiting) tail.push({ mark: "waiting", text: o.waiting });
  else if (o.working) tail.push({ mark: "working", text: o.working });
  return tail;
}

/** The steps a job ran on a computer, as lines, for a job with no work log (no agent on this server). */
export function stepLines(steps: StepRow[] | null | undefined): WorkLine[] {
  // A job the router has not given steps to yet (or an older job row) has none: no lines, never a crash.
  return (steps ?? []).map((s) => ({
    mark: s.status === "done" || s.status === "failed" || s.status === "cancelled" ? "done" as const : s.status === "running" || s.status === "dispatched" ? "working" as const : "waiting" as const,
    text: s.kind === "edit" ? `Edited ${(s.commands ?? []).map(fileOf).slice(0, 2).join(", ") || "files"}` : `Ran ${short(s.commands?.[0] ?? "a step", 50)}`,
    ...(s.exitCode !== null && s.exitCode !== 0 ? { sub: `exit ${s.exitCode}` } : {}),
  }));
}

/** What a failed job tried: each check it ran (newest last), with what it was doing just before, at most `max`. */
export function tries(entries: WorkEntry[], max = 3): Array<{ title: string; result: string; ok: boolean }> {
  const out: Array<{ title: string; result: string; ok: boolean }> = [];
  let doing = "";
  for (const e of entries) {
    if (e.kind === "edit" && e.text) doing = e.text;
    else if (e.kind === "step" && e.text) doing = e.text;
    else if (e.kind === "command") {
      const code = typeof e.data?.exitCode === "number" ? e.data.exitCode : null;
      const kind = typeof e.data?.kind === "string" ? e.data.kind : "";
      const title = doing ? short(doing, 70) : `Ran ${kind === "test" ? "the tests" : short(e.text, 50)}`;
      out.push({ title, result: checkWords(e) || (code === 0 ? "passed" : "failed"), ok: code === 0 });
      doing = "";
    }
  }
  return out.slice(-max);
}

/** The files a job changed, from its log: each with the reason the edit gave. */
export function changedFiles(entries: WorkEntry[], staged: string[] = []): Array<{ path: string; why: string; action: string }> {
  const by = new Map<string, { path: string; why: string; action: string }>();
  for (const e of entries) {
    if (e.kind !== "edit") continue;
    for (const f of e.files ?? []) by.set(f, { path: f, why: e.text, action: String(e.data?.action ?? "edit") });
  }
  for (const f of staged) if (!by.has(f)) by.set(f, { path: f, why: "", action: "edit" });
  return [...by.values()];
}

/** How many tests passed in the end: the agent's check first, then the last test run in the log. */
export function testsPassed(agent: AgentView | undefined, entries: WorkEntry[]): { pass: number; total?: number } | null {
  const fromVerify = agent?.verify?.summary ? testCount(agent.verify.summary) : {};
  if (fromVerify.pass !== undefined) return { pass: fromVerify.pass, ...(fromVerify.total !== undefined ? { total: fromVerify.total } : {}) };
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind !== "command") continue;
    const n = testCount(String(e.data?.summary ?? ""));
    if (n.pass !== undefined) return { pass: n.pass, ...(n.total !== undefined ? { total: n.total } : {}) };
  }
  return null;
}

/** The first sentence of a text (a report, a reason), cut to `max`. */
export function firstSentence(s: string, max = 90): string {
  const t = s.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return short(m ? m[1]! : t, max);
}

// ------------------------------------------------------------------ an answer's words

/** Every `path:line` (or `path:a-b`) in an answer, once each, at most `max`. */
export function citations(text: string, max = 4): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(`[])((?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z]{1,6}:\d+(?:-\d+)?)/g)) {
    seen.add(m[1]!);
    if (seen.size >= max) break;
  }
  return [...seen];
}

export interface Block { kind: "para" | "code"; text: string }

/** An answer's Markdown as paragraphs (inline marks taken off) and code blocks, at most `max` blocks. */
export function plainWords(md: string, max = 8): Block[] {
  const out: Block[] = [];
  const parts = md.replace(/\r/g, "").split(/```[^\n]*\n?/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) { if (part.trim()) out.push({ kind: "code", text: part.replace(/\n+$/, "").split("\n").slice(0, 14).join("\n") }); return; }
    for (const p of part.split(/\n{2,}/)) {
      const t = p.replace(/^#{1,6}\s+/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/`([^`]+)`/g, "$1")
        .replace(/^\s*[-*]\s+/gm, "· ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
      if (t) out.push({ kind: "para", text: t });
    }
  });
  return out.slice(0, max);
}

/** The boxes of a Mermaid `flowchart` (code/chat/flow.ts draws them), in the order its arrows go; at most `max`. */
export function flowOf(mermaid: string, max = 6): string[] {
  if (!/^\s*(flowchart|graph)\b/.test(mermaid)) return [];
  const label = new Map<string, string>();
  const edges: Array<[string, string]> = [];
  for (const raw of mermaid.split("\n").slice(1)) {
    const line = raw.trim();
    for (const m of line.matchAll(/([A-Za-z][\w-]*)\s*(?:\[\(?|\(\[?|\{)"?([^"\]\)\}]+?)"?(?:\)?\]|\]?\)|\})/g)) {
      label.set(m[1]!, m[2]!.split(/<br\s*\/?>/i)[0]!.trim());
    }
    const e = /^([A-Za-z][\w-]*)\b.*?(?:-->|---|==>|-\.->)\s*(?:\|[^|]*\|\s*)?([A-Za-z][\w-]*)/.exec(line);
    if (e) edges.push([e[1]!, e[2]!]);
  }
  const nodes = [...new Set([...label.keys(), ...edges.flat()])];
  if (!nodes.length) return [];
  const into = new Set(edges.map(([, b]) => b));
  const start = nodes.find((n) => !into.has(n)) ?? nodes[0]!;
  const order: string[] = [start];
  while (order.length < max) {
    const last = order[order.length - 1]!;
    const next = edges.find(([a, b]) => a === last && !order.includes(b))?.[1];
    if (!next) break;
    order.push(next);
  }
  for (const n of nodes) if (order.length < max && !order.includes(n) && edges.some(([a, b]) => a === n || b === n)) order.push(n);
  return order.map((n) => label.get(n) ?? n);
}

// ------------------------------------------------------------------ an artifact's parts

/** One part of an artifact a person can point at: its element id, what it is, its words, and its own parts. */
export interface Part {
  id: string;
  tag: string;
  /** What a person calls it: Button, Heading, Text, Picture… */
  kind: string;
  text: string;
  kids: Part[];
}

/** The viewer gives these no id (viewer/docs/artifact-viewer.md section 4). */
const NOT_POINTABLE = new Set(["html", "head", "title", "meta", "link", "script", "style", "base", "noscript", "template", "br", "hr"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export function kindOf(tag: string): string {
  const t = tag.toLowerCase();
  if (t === "button") return "Button";
  if (t === "a") return "Link";
  if (/^h[1-6]$/.test(t)) return "Heading";
  if (t === "p" || t === "span" || t === "label" || t === "strong" || t === "em" || t === "small") return "Text";
  if (t === "img" || t === "svg" || t === "picture") return "Picture";
  if (t === "input" || t === "textarea" || t === "select") return "Field";
  if (t === "li") return "List item";
  if (t === "ul" || t === "ol") return "List";
  if (t === "nav") return "Menu";
  if (t === "header") return "Header";
  if (t === "footer") return "Footer";
  if (t === "form") return "Form";
  if (/^[A-Z]/.test(tag)) return tag.split(".").pop()!;
  return "Box";
}

/**
 * The parts of an artifact's markup, with the ids the viewer gives them: an html or svg artifact's tags, or a React
 * artifact's JSX (a "<" that can begin JSX: after an operator, an opening bracket, `return`). Text between tags is the
 * part's words; `{…}` expressions in JSX text are left out. A Markdown or Mermaid artifact has no parts.
 */
export function outline(src: string, o: { maxParts?: number } = {}): Part[] {
  const maxParts = o.maxParts ?? 120;
  const roots: Part[] = [];
  const stack: Part[] = [];
  let count = 0;
  let line = 1, col = 1, i = 0;
  const n = src.length;
  const advance = (to: number) => { for (; i < to && i < n; i++) { if (src[i] === "\n") { line++; col = 1; } else col++; } };
  const prevSignificant = (at: number): string => {
    let j = at - 1;
    while (j >= 0 && /\s/.test(src[j]!)) j--;
    if (j < 0) return "";
    if (/[A-Za-z_$]/.test(src[j]!)) { let k = j; while (k >= 0 && /[\w$]/.test(src[k]!)) k--; return src.slice(k + 1, j + 1); }
    return src[j]!;
  };
  const jsxStart = (at: number) => { const p = prevSignificant(at); return p === "" || /^[(,=:?!&|{}[;>]$/.test(p) || p === "return" || p === "=>" || p === "\n"; };
  const isMarkup = /^\s*(<!doctype|<html|<svg|<\?xml|<div|<section|<main|<body|<head|<style|<!--)/i.test(src);
  const addText = (t: string) => {
    const words = t.replace(/\{[^}]*\}/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    if (!words || !stack.length) return;
    const top = stack[stack.length - 1]!;
    top.text = top.text ? `${top.text} ${words}` : words;
  };
  let textFrom = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === "<" && src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      advance(end < 0 ? n : end + 3);
      textFrom = i;
      continue;
    }
    if (ch === "<" && /[A-Za-z]/.test(src[i + 1] ?? "") && (isMarkup || jsxStart(i))) {
      if (stack.length) addText(src.slice(textFrom, i));
      const at = `${line}:${col}`;
      const nameM = /^<([A-Za-z][\w.:-]*)/.exec(src.slice(i, i + 80));
      const tag = nameM ? nameM[1]! : "div";
      // to the end of the tag, past quoted strings and {…} expressions
      let j = i + tag.length + 1, depth = 0, quote = "";
      for (; j < n; j++) {
        const c = src[j]!;
        if (quote) { if (c === quote) quote = ""; continue; }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      const selfClosing = src[j - 1] === "/" || VOID.has(tag.toLowerCase());
      const attrs = src.slice(i + tag.length + 1, j);
      advance(j + 1);
      textFrom = i;
      const low = tag.toLowerCase();
      if (low === "script" || low === "style") {
        const end = src.toLowerCase().indexOf(`</${low}`, i);
        advance(end < 0 ? n : end);
        textFrom = i;
        continue;
      }
      if (NOT_POINTABLE.has(low) && low !== "br" && low !== "hr") continue;
      if (low === "br" || low === "hr") continue;
      const part: Part = { id: at, tag, kind: kindOf(tag), text: "", kids: [] };
      // what a field or a picture says about itself
      const said = /(?:placeholder|alt|aria-label|value|title)\s*=\s*["']([^"']{1,80})["']/.exec(attrs);
      if (said && (part.kind === "Field" || part.kind === "Picture" || !selfClosing)) part.text = said[1]!;
      if (count < maxParts) {
        count++;
        if (stack.length) stack[stack.length - 1]!.kids.push(part); else roots.push(part);
      }
      if (!selfClosing) stack.push(part);
      continue;
    }
    if (ch === "<" && src[i + 1] === "/") {
      const m = /^<\/([A-Za-z][\w.:-]*)?\s*>/.exec(src.slice(i, i + 80));
      if (m) {
        if (stack.length) addText(src.slice(textFrom, i));
        const tag = m[1] ?? "";
        let k = stack.length - 1;
        while (k >= 0 && tag && stack[k]!.tag !== tag) k--;
        if (k >= 0) stack.length = k; else if (!tag) stack.pop();
        advance(i + m[0].length);
        textFrom = i;
        continue;
      }
    }
    advance(i + 1);
  }
  return roots;
}

/** A part's own words, or its first descendant's (what a person would call the part). */
export function wordsOf(p: Part): string {
  if (p.text) return p.text;
  for (const k of p.kids) { const w = wordsOf(k); if (w) return w; }
  return "";
}

/** The body of the page (skips html/body wrappers and parts with nothing to show), as the parts a screen draws. */
export function visibleParts(roots: Part[]): Part[] {
  const unwrap = (list: Part[]): Part[] => list.flatMap((p) => {
    const low = p.tag.toLowerCase();
    if (low === "body" || low === "html" || low === "head" || low === "svg" || (low === "div" && !p.text && p.kids.length === 1)) return low === "svg" ? [p] : unwrap(p.kids);
    return [p];
  });
  const prune = (p: Part): Part | null => {
    const kids = p.kids.map(prune).filter((k): k is Part => !!k);
    if (!p.text && !kids.length && p.kind !== "Picture" && p.kind !== "Field" && p.kind !== "Button") return null;
    return { ...p, kids };
  };
  return unwrap(roots).map(prune).filter((p): p is Part => !!p);
}

/** What a waiting yes is about, in a line: the policy's own title when it gave one, else its action in words (as bots/deps.ts approvalLine). */
export function approvalLineOf(action: string, summary: Record<string, unknown>): string {
  const t = typeof summary.title === "string" ? summary.title : typeof summary.text === "string" ? summary.text : "";
  if (t.trim()) return t.trim().slice(0, 140);
  if (action === "job.plan") return "Go ahead with this plan?";
  if (!action) return "Okay to go ahead?";
  return `Okay to ${action.replace(/^[a-z]+\./, "").replace(/[._-]+/g, " ")}?`;
}
