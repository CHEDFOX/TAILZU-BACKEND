/**
 * OBSERVATION MASKING: AN OLD TOOL OUTPUT BECOMES ONE LINE THAT KEEPS WHAT WAS DONE AND THE FACTS THAT MATTER, WITH NO MODEL.
 *
 * The idea is SWE-agent's and OpenHands': the model's own ACTIONS (what it said, which tool it called with what) stay in the transcript for the whole
 * job; only the OBSERVATIONS (what the tools printed back) are replaced, once they are old enough, by a placeholder. The person's words stay too.
 * JetBrains Research measured it against asking a model to summarise the old turns (the "Complexity Trap", arXiv 2508.21433): as good, and it costs
 * no model call. A placeholder says what the output was without being the output:
 *
 *   [run "npm test": exit 1, 240 lines, first error: TS2345 Argument of type 'string' - output masked]
 *   [read src/lib/api.ts lines 1-200 of 540, 8.2k characters - output masked]
 *   [grep "fetchUsers": 14 lines in 5 files, top src/lib/api.ts (6), src/server/index.ts (4) - output masked]
 *
 * Whatever came from outside Tailzu stays inside a data fence, as everywhere in context.ts: the placeholder is wrapped as data, since it quotes a line
 * of a command's output, and a line a secret scan flags is not quoted at all.
 *
 * Pure. Nothing here reads a store or a model.
 */
import { scanForSecrets } from "../policy.js";
import type { CallRecord, ResultRecord } from "./types.js";

/** How the old observations are dealt with: masked (no model), folded into a summary by the cheap model, or masked with a summary every so often. */
export const CONTEXT_STRATEGIES = ["mask", "summary", "hybrid"] as const;
export type ContextStrategy = (typeof CONTEXT_STRATEGIES)[number];

export const isStrategy = (v: unknown): v is ContextStrategy => typeof v === "string" && (CONTEXT_STRATEGIES as readonly string[]).includes(v);

/** Hybrid: this many of the oldest masked turns are folded into the running summary at once, and only when there are twice as many to fold. */
export const HYBRID_EVERY = 10;

/** An action's long text arguments (a whole file written, an old and a new string) are cut to this in an old turn: the edit itself is staged, not in the transcript. */
export const OLD_ARG_CHARS = 160;
/** The model's words of an old turn are cut to this. */
export const OLD_TEXT_CHARS = 160;

const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`);
const oneLine = (s: string, n: number): string => cut(s.replace(/\s+/g, " ").trim(), n);
const kb = (n: number): string => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
const lineCount = (s: string): number => (s ? s.split("\n").length : 0);

function argsOf(c: CallRecord): Record<string, unknown> {
  try {
    const v = JSON.parse(c.arguments || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const text = (v: unknown, n: number): string => (typeof v === "string" ? oneLine(v, n) : "");

/** A line of output that is safe to quote: not one a secret scan flags. */
const quotable = (line: string): string => (line && !scanForSecrets([{ path: "output.txt", content: line }]).length ? line : "");

const ERROR_LINE = /\b(?:error|errors|fail(?:ed|ure|ures|ing)?|exception|panic|fatal|traceback|assert(?:ion)?\w*|not ok|cannot|can't|unable|denied|refused)\b|\bTS\d{4}\b|✗|✖|×/i;

/** The first line of a command's output that says something went wrong, or (for a failing run with no such line) the last line it printed. */
export function firstError(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => ERROR_LINE.test(l));
  return quotable(oneLine(hit ?? lines.at(-1) ?? "", 110));
}

/** The paths with the most matching lines in a grep's output (`path:line:text`), most first. */
function topFiles(output: string, filesOnly: boolean): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const l of output.split("\n")) {
    const m = filesOnly ? /^([^\s:]+)\s*$/.exec(l) : /^([^\s:]+?)[:-]\d+[:-]/.exec(l);
    if (m) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
}

/**
 * What a tool's output was, in a line. Empty for a result that has no output to mask. `quotes` says whether the line holds words taken from the output (a
 * line of a command's errors, the names of the files a search found), which must stay inside a data fence; the rest of the lines are our own words and
 * the model's own arguments, and are not fenced.
 */
export function placeholderOf(call: CallRecord, r: ResultRecord): { line: string; quotes: boolean } {
  const line = placeholderLine(call, r);
  return { line: line.text, quotes: line.quotes };
}

function placeholderLine(call: CallRecord, r: ResultRecord): { text: string; quotes: boolean } {
  const t = (text: string, quotes = false) => ({ text, quotes });
  if (!r.data) return t("");
  const a = argsOf(call);
  const out = r.data;
  const chars = out.length;
  const tail = "output masked";
  switch (call.name) {
    case "run": {
      const code = /Exit code (-?\d+)/.exec(r.content)?.[1] ?? "?";
      const n = lineCount(out.trim());
      const err = code === "0" ? "" : firstError(out);
      return t(`[run "${text(a.cmd ?? r.label, 80)}": exit ${code}, ${n} line${n === 1 ? "" : "s"}${err ? `, first error: ${err}` : code === "0" ? ", passed" : ""} - ${tail}]`, !!err);
    }
    case "read_file": {
      const m = /, lines (\d+)-(\d+) of (\d+)/.exec(r.content);
      return t(`[read ${text(a.path ?? r.label, 90)}${m ? ` lines ${m[1]}-${m[2]} of ${m[3]}` : ""}, ${kb(chars)} characters - ${tail}]`);
    }
    case "grep": {
      const m = /^(\d+) (?:line|file)s? match(?:es)? .* in (\d+) files?/.exec(r.content);
      const top = topFiles(out, a.filesOnly === true).map(([p, n]) => `${p} (${n})`);
      return t(`[grep "${text(a.pattern ?? r.label, 60)}": ${m ? `${m[1]} ${a.filesOnly === true ? "files" : `line${m[1] === "1" ? "" : "s"}`} in ${m[2]} file${m[2] === "1" ? "" : "s"}` : `${lineCount(out.trim())} rows`}${top.length ? `, top ${top.join(", ")}` : ""} - ${tail}]`, top.length > 0);
    }
    case "glob": {
      const m = /^(\d+) files? match/.exec(r.content);
      const first = out.split("\n").slice(0, 2).join(", ");
      return t(`[glob "${text(a.pattern ?? r.label, 60)}": ${m ? m[1] : lineCount(out.trim())} files, first ${first} - ${tail}]`, true);
    }
    case "list_dir": {
      const m = /: (\d+) entries/.exec(r.content);
      return t(`[list_dir ${text(a.path ?? r.label ?? "/", 70) || "/"}: ${m ? m[1] : lineCount(out.trim())} entries - ${tail}]`);
    }
    case "search_code": {
      const files = out.includes("Files:") ? out.split("Files:")[1]!.split("\n").slice(1).filter((l) => l && !/^(?:Symbols|Text people see):/.test(l)).length : 0;
      const first = /(?:^|\n)Files:\n([^\s]+?)(?: - |\s|$)/.exec(out)?.[1] ?? /(?:^|\n)Symbols:\n([^\s:]+)/.exec(out)?.[1] ?? "";
      return t(`[search_code "${text(a.query ?? r.label, 60)}": ${lineCount(out.trim())} rows${files ? `, ${files} files` : ""}${first ? `, top ${first}` : ""} - ${tail}]`, !!first);
    }
    case "read_page": return t(`[read_page ${text(a.url ?? r.label, 90)}: ${kb(chars)} characters - ${tail}]`);
    case "web_search": return t(`[web_search "${text(a.query ?? r.label, 70)}": ${kb(chars)} characters of results - ${tail}]`);
    case "research": return t(`[research "${text(a.question ?? r.label, 70)}": ${kb(chars)} characters - ${tail}]`);
    case "find_resources": {
      const pick = /Pick: ([^.\n]+)/.exec(out)?.[1];
      return t(`[find_resources "${text(a.need ?? r.label, 70)}"${pick ? `: ${oneLine(pick, 50)}` : ""} - ${tail}]`, !!pick);
    }
    default: return t(`[${call.name} ${text(r.label, 70)}: ${kb(chars)} characters - ${tail}]`.replace("  ", " "));
  }
}

/**
 * The result as an old turn keeps it: no data, our words in place of it, and a mark that it was masked. A result with no data (an edit's one line, a
 * failure's reason) is already short and is returned as it is.
 */
export function maskResult(call: CallRecord, r: ResultRecord): ResultRecord {
  if (r.masked || !r.data) return r;
  const p = placeholderOf(call, r);
  const { data: _data, label: _label, wrapped: _wrapped, ...rest } = r;
  void _data; void _label; void _wrapped;
  return { ...rest, content: p.line || `[${call.name} - output masked]`, masked: true, ...(p.quotes ? { quotes: true } : {}) };
}

/** An action's arguments as an old turn shows them: every long string cut, so a whole file the model wrote does not ride along in every later turn. Still valid JSON. */
export function maskArguments(args: string): string {
  if (args.length <= OLD_ARG_CHARS * 2) return args;
  try {
    const v = JSON.parse(args) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return args;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof x === "string" && x.length > OLD_ARG_CHARS ? `${x.slice(0, OLD_ARG_CHARS)}[... ${x.length - OLD_ARG_CHARS} more characters, masked]` : x;
    }
    return JSON.stringify(out);
  } catch {
    return args.length > 1000 ? JSON.stringify({ masked: cut(args, 400) }) : args;
  }
}

/** The model's words of an old turn. */
export const maskText = (t: string): string => (t.length > OLD_TEXT_CHARS ? `${t.slice(0, OLD_TEXT_CHARS - 1)}…` : t);
