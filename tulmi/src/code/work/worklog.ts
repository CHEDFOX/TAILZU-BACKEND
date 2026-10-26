/**
 * THE WORK LOG: WHAT THE BOT DID AND NOTICED ON A JOB, KEPT AS IT HAPPENED, AND WRITTEN UP FOR THE PR.
 *
 * A pull request from a bot is only as trustworthy as its account of itself. So
 * as a job goes the agent loop writes down, in order, eight kinds of thing:
 *
 *   step      what it set out to do next, and why
 *   read      files it read
 *   edit      a file it changed (files; data.action edit | create | delete; text says why)
 *   command   a check it ran (text is the command; data { kind, exitCode, durationMs,
 *             summary, verdict? }: verdict is the baseline comparison, findings.ts)
 *   finding   something it noticed while reading (data { severity, path, line? })
 *   decision  a choice it made where there was more than one way
 *   question  something it asked the person (data { answer? } once answered)
 *   note      anything else
 *
 * Each entry is `{ at, kind, text, files?, data? }`. worklogMarkdown(jobId) turns
 * the log into the section of the PR body a reviewer reads: what changed and why,
 * the files, the checks and what they said, the findings, the decisions.
 *
 * NOTHING SECRET IS KEPT. Every line, every path and every leaf of `data` goes
 * through the policy's secret scan (policy.ts scanForSecrets) before it is
 * stored: a token on its own is replaced by [redacted], a line the scan flags as
 * a whole is withheld, a private key's block is dropped to a note, and whatever
 * still looks like a secret after all that is replaced outright. The log goes
 * into a pull request; it must not be a way for a secret to get there.
 *
 * A log that cannot be written (the table is missing, the database is down) is a
 * log that is lost, never a job that fails: append() swallows it and says so by
 * returning null.
 */
import { scanForSecrets } from "../policy.js";
import { cut } from "./model.js";
import { ENTRIES_MAX, WORK_KINDS, worklogStore, type NewWorkEntry, type WorkEntry, type WorkKind, type WorklogStore } from "./worklogStore.js";

export { WORK_KINDS, MemoryWorklogStore, SupabaseWorklogStore, worklogStore, resetWorklogStoreForTests } from "./worklogStore.js";
export type { WorkEntry, WorkKind, WorklogStore } from "./worklogStore.js";

// ------------------------------------------------------------------ redacting

const flagged = (s: string): boolean => scanForSecrets([{ path: "worklog.txt", content: s }]).length > 0;

const REDACTED = "[redacted]";
const LINE_WITHHELD = "[line withheld: it looked like it held a secret]";
const WHOLE_WITHHELD = "(withheld: it looked like it held a secret)";

/**
 * Text as it may be kept: unchanged when the secret scan finds nothing in it;
 * otherwise each word the scan flags on its own becomes [redacted], a line the
 * scan flags only as a whole (`api_key: "..."`) is withheld, a private key's
 * block is a note, and a result that still trips the scan is withheld entirely.
 */
export function redactText(raw: unknown, max = 2000): string {
  if (typeof raw !== "string" || !raw) return "";
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  if (!flagged(text)) return cut(text, max);
  const out: string[] = [];
  let inKey = false;
  for (const line of text.split("\n")) {
    if (inKey) { if (/-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/.test(line)) inKey = false; continue; }
    if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/.test(line)) {
      out.push("[a private key was withheld]");
      if (!/-----END (?:[A-Z0-9]+ )*PRIVATE KEY/.test(line)) inKey = true;
      continue;
    }
    if (!flagged(line)) { out.push(line); continue; }
    const words = line.split(/(\s+)/).map((w) => (w.trim() && flagged(w) ? REDACTED : w)).join("");
    out.push(flagged(words) ? LINE_WITHHELD : words);
  }
  const res = out.join("\n");
  return flagged(res) ? WHOLE_WITHHELD : cut(res, max);
}

const DATA_BYTES = 4000;

function redactLeaf(v: unknown, depth: number): unknown {
  if (typeof v === "string") return redactText(v, 500);
  if (v === null || typeof v === "number" || typeof v === "boolean") return v;
  if (depth >= 4) return undefined;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redactLeaf(x, depth + 1)).filter((x) => x !== undefined);
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) {
      const r = redactLeaf(x, depth + 1);
      if (r !== undefined) o[redactText(k, 60) || "_"] = r;
    }
    return o;
  }
  return undefined;
}

/** A small object as it may be kept: its strings redacted, its size bounded; or { withheld: true } if it still looks like it holds a secret. */
export function redactData(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const clean = redactLeaf(data, 0) as Record<string, unknown>;
  const json = JSON.stringify(clean);
  if (flagged(json)) return { withheld: true };
  return json.length > DATA_BYTES ? { truncated: true } : clean;
}

const PATH_MAX = 300;
const FILES_MAX = 50;

function cleanFiles(files: unknown): string[] | undefined {
  if (!Array.isArray(files)) return undefined;
  const out = files.filter((f): f is string => typeof f === "string" && f.length > 0).slice(0, FILES_MAX).map((f) => redactText(f, PATH_MAX)).filter(Boolean);
  return out.length ? out : undefined;
}

// ------------------------------------------------------------------ the log

export interface WorkLogOptions {
  store?: WorklogStore;
  now?: () => number;
  /** Entries of the quiet kinds (read, note) are dropped past this many; the rest go on to 2,000. */
  quietMax?: number;
}

export interface EntryInput { text: string; files?: string[]; data?: Record<string, unknown> }

/** One job's log. Every method returns the entry as kept, or null when it was lost (the store failed, or the log is full). */
export class WorkLog {
  private readonly store: WorklogStore;
  private readonly now: () => number;
  private readonly quietMax: number;
  private n: number | null = null;

  constructor(readonly jobId: string, o: WorkLogOptions = {}) {
    this.store = o.store ?? worklogStore();
    this.now = o.now ?? Date.now;
    this.quietMax = o.quietMax ?? 1000;
  }

  async add(kind: WorkKind, e: EntryInput): Promise<WorkEntry | null> {
    if (!WORK_KINDS.includes(kind)) return null;
    try {
      this.n ??= await this.store.count(this.jobId);
      if (this.n >= ENTRIES_MAX || (this.n >= this.quietMax && (kind === "read" || kind === "note"))) return null;
      const row: NewWorkEntry = { at: this.now(), kind, text: redactText(e.text, 1500) };
      const files = cleanFiles(e.files);
      const data = redactData(e.data);
      if (files) row.files = files;
      if (data) row.data = data;
      const kept = await this.store.append(this.jobId, row);
      this.n += 1;
      return kept;
    } catch {
      return null;
    }
  }

  step(text: string, files?: string[]) { return this.add("step", { text, files }); }
  read(files: string[], text = "") { return this.add("read", { text, files }); }
  edit(action: "edit" | "create" | "delete", files: string[], why: string) { return this.add("edit", { text: why, files, data: { action } }); }
  command(cmd: string, result: { kind?: string; exitCode: number; durationMs?: number; summary?: string; verdict?: string }) {
    return this.add("command", { text: cmd, data: { ...result } });
  }
  finding(f: { severity: "info" | "warn" | "risk"; path: string; line?: number; text: string }) {
    return this.add("finding", { text: f.text, files: [f.path], data: { severity: f.severity, path: f.path, ...(f.line !== undefined ? { line: f.line } : {}) } });
  }
  decision(text: string) { return this.add("decision", { text }); }
  question(text: string, answer?: string) { return this.add("question", { text, ...(answer ? { data: { answer } } : {}) }); }
  note(text: string) { return this.add("note", { text }); }

  entries(o?: { kinds?: readonly WorkKind[] }) { return this.store.list(this.jobId, o); }
  markdown(o?: MarkdownOptions) { return renderWorklog(this.entries().catch(() => []), o); }
}

// ----------------------------------------------------------------- the writing

export interface MarkdownOptions {
  /** The section is cut to about this many characters (8,000 by default); the PR body's own limit is far above it. */
  maxChars?: number;
  /** The heading's level (2 by default). */
  level?: number;
}

const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n+/g, " ").replace(/</g, "&lt;");
const line = (s: string, n = 220): string => esc(cut(s.replace(/\s+/g, " ").trim(), n));
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const SEVERITY_ORDER: Record<string, number> = { risk: 0, warn: 1, info: 2 };

/**
 * The log as the section of a pull request's body: what changed and why, the
 * files, the checks and what they said, what was noticed, what was decided, and
 * what was asked. Short on purpose: a reviewer reads it. A section with nothing
 * in it is left out.
 */
export async function renderWorklog(entriesOrPromise: WorkEntry[] | Promise<WorkEntry[]>, o: MarkdownOptions = {}): Promise<string> {
  const entries = await entriesOrPromise;
  const h = "#".repeat(Math.min(Math.max(o.level ?? 2, 1), 5));
  const sub = `${h}#`;
  const out: string[] = [`${h} Work log`];
  const section = (title: string, lines: string[]) => { if (lines.length) out.push("", `${sub} ${title}`, ...lines); };

  // What changed and why: the steps in order, then the reasons for the edits that no step covers.
  const why: string[] = [];
  let n = 0;
  for (const e of entries) {
    if (e.kind === "step" && e.text) { n += 1; why.push(`${n}. ${line(e.text, 300)}`); }
  }
  if (!why.length) for (const e of entries) if (e.kind === "edit" && e.text) why.push(`- ${line(e.text, 300)}`);
  section("What changed and why", why.slice(0, 25));

  // Files: the last thing done to each.
  const files = new Map<string, string>();
  for (const e of entries) if (e.kind === "edit") for (const f of e.files ?? []) files.set(f, str(e.data?.action) || "edit");
  const verbs: Record<string, string> = { edit: "changed", create: "added", delete: "deleted" };
  section("Files", [...files].slice(0, 40).map(([f, a]) => `- \`${esc(f)}\` (${verbs[a] ?? a})`).concat(files.size > 40 ? [`- and ${files.size - 40} more`] : []));

  // Checks: the last result of each command.
  const checks = new Map<string, WorkEntry>();
  for (const e of entries) if (e.kind === "command") checks.set(e.text, e);
  const rows = [...checks.values()].slice(0, 20).map((e) => {
    const d = e.data ?? {};
    const code = num(d.exitCode);
    const verdict = str(d.verdict);
    const secs = num(d.durationMs) !== undefined ? ` in ${Math.max(0, Math.round(num(d.durationMs)! / 1000))}s` : "";
    const result = verdict === "already_broken" ? `failed, and was already failing before Tailzu${secs}`
      : verdict === "broke" ? `**failed**: this change broke it${secs}`
        : verdict === "fixed" ? `passes now; it was failing before${secs}`
          : code === 0 ? `passed${secs}` : `failed (exit ${code ?? "?"})${secs}`;
    const what = str(d.summary) ? `: ${line(str(d.summary), 140)}` : "";
    return `| \`${esc(cut(e.text, 90))}\` | ${esc(result)}${what} |`;
  });
  if (rows.length) section("Checks", ["| Command | Result |", "| --- | --- |", ...rows]);

  // Findings: the worst first.
  const found = entries.filter((e) => e.kind === "finding").sort((a, b) => (SEVERITY_ORDER[str(a.data?.severity)] ?? 3) - (SEVERITY_ORDER[str(b.data?.severity)] ?? 3) || a.seq - b.seq);
  section("Findings", found.slice(0, 15).map((e) => {
    const d = e.data ?? {};
    const where = str(d.path) || e.files?.[0] || "";
    const at = where ? ` \`${esc(where)}${num(d.line) ? `:${num(d.line)}` : ""}\`` : "";
    return `- **${str(d.severity) || "info"}**${at}: ${line(e.text, 240)}`;
  }).concat(found.length > 15 ? [`- and ${found.length - 15} more in the log`] : []));

  section("Decisions", entries.filter((e) => e.kind === "decision").slice(0, 12).map((e) => `- ${line(e.text, 260)}`));
  section("Questions", entries.filter((e) => e.kind === "question").slice(0, 8).map((e) => {
    const a = str(e.data?.answer);
    return `- ${line(e.text, 200)}${a ? ` Answer: ${line(a, 160)}` : " (not answered)"}`;
  }));

  if (out.length === 1) out.push("", "_Nothing was recorded for this job._");
  const text = out.join("\n");
  const max = o.maxChars ?? 8000;
  return text.length > max ? `${text.slice(0, max - 40).trimEnd()}\n\n_(The rest is in the job's log.)_` : text;
}

/**
 * The work log of a job as markdown, ready for the body of its pull request.
 * Secrets were redacted when each line was kept, and the text is passed through
 * the same redaction once more on its way out.
 */
export async function worklogMarkdown(jobId: string, o: MarkdownOptions & { store?: WorklogStore } = {}): Promise<string> {
  const store = o.store ?? worklogStore();
  let entries: WorkEntry[] = [];
  try { entries = await store.list(jobId); } catch { entries = []; }
  return redactText(await renderWorklog(entries, o), (o.maxChars ?? 8000) + 100);
}
