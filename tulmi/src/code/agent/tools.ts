/**
 * THE AGENT'S TOOLS: WHAT THE MODEL CAN DO, AND WHAT EACH ONE REALLY DOES.
 *
 *   read_file {path, from?, to?}       the work branch overlaid with the staged edits, 12,000 characters at most
 *   list_dir {path}                    the same overlay, one level
 *   search_code {query}                the project brain: files, symbols, the text people see
 *   edit_file {path, old, new}         an exact replace of text that occurs once; STAGES it
 *   write_file {path, content}         stages a whole file
 *   delete_file {path}                 stages a deletion
 *   run {cmd, why}                     on a runner, with the staged edits laid over the checkout
 *   web_search, read_page, research    layer 3 (code/webTools.ts)
 *   find_resources {need}              layer 6: the library shortlist
 *   flag_finding {severity, path, line?, text}   something noticed in code it was not asked about
 *   note {text}                        a line for the work log
 *   ask_user {question, options?}      the job waits for the person
 *   done {summary}                     the work is finished
 *
 * A tool never throws at the model. A refusal comes back as a result that says what to do
 * instead (changeset.ts Refused), and a failure of ours as one plain sentence; the loop
 * counts a turn whose every call failed as a bad one (loop.ts), which is what makes the
 * router climb a tier.
 *
 * WHAT COMES BACK IS DATA. A file, a command's output, a search hit and a page are returned
 * in `data` (never in `content`), and context.ts shows them to the model only inside a fence
 * (a web page inside the web code's own). `content` is Tailzu's own words.
 *
 * Every call is written to the work log with its result in a few words (the WorkLog redacts
 * a secret before it is kept); the call's id goes in the entry, so a server that picks the
 * job up after a crash does not log a call twice.
 */
import { ConnectorError } from "../../connectors/state.js";
import type { FetchLike } from "../../connectors/egressTypes.js";
import { asUntrusted } from "../../web/reader.js";
import type { ToolCall, ToolDef } from "../brain/types.js";
import { assertRepoPath } from "../github.js";
import { scanForSecrets } from "../policy.js";
import type { BrainHandle } from "../project/index.js";
import { isSecretPath } from "../project/lang.js";
import type { Workspace } from "../projects.js";
import { findResources } from "../resources/finder.js";
import { WEB_TOOLS, type WebTools } from "../webTools.js";
import { cleanFinding, type WorkLog } from "../work/index.js";
import { Changeset, Refused, checkedText, editablePath, replaceOnce } from "./changeset.js";
import type { RunOutcome, RunSpec } from "./runner.js";
import { FINDINGS_MAX, LIST_MAX, READ_MAX_CHARS, RESULT_MAX_CHARS, RUNS_MAX, RUN_TIMEOUT_SEC, type AgentState, type ResultRecord } from "./types.js";

export type ToolControl = { type: "done"; summary: string } | { type: "ask"; question: string; options?: string[] };
export interface ToolOutcome extends ResultRecord { control?: ToolControl }

export const AGENT_TOOL_NAMES = [
  "read_file", "list_dir", "search_code", "edit_file", "write_file", "delete_file", "run",
  "web_search", "read_page", "research", "find_resources", "flag_finding", "note", "ask_user", "done",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", additionalProperties: false, required, properties });

/** The definitions the model is given, in the brain's ToolDef shape. */
export const AGENT_TOOLS: readonly ToolDef[] = [
  {
    name: "read_file",
    description: "Read a file from the work branch, with your staged edits applied. Lines are numbered. Long files are cut: ask for a range with from and to (1-based, inclusive).",
    parameters: obj({
      path: { type: "string", maxLength: 500 }, from: { type: "integer", minimum: 1 }, to: { type: "integer", minimum: 1 },
    }, ["path"]),
  },
  {
    name: "list_dir",
    description: "List the files and folders directly inside a folder of the repo (path \"\" or \".\" is the root), with your staged edits applied.",
    parameters: obj({ path: { type: "string", maxLength: 500 } }, ["path"]),
  },
  {
    name: "search_code",
    description: "Search the project's index for a file, a function or class or route, or text a person sees on screen. Returns paths with a line about each. It does not see your staged edits.",
    parameters: obj({ query: { type: "string", minLength: 2, maxLength: 200 } }, ["query"]),
  },
  {
    name: "edit_file",
    description: "Replace text in a file. `old` must be copied exactly from the file and occur ONCE (include enough lines around it); `new` is what goes in its place. The edit is staged, not committed.",
    parameters: obj({ path: { type: "string", maxLength: 500 }, old: { type: "string" }, new: { type: "string" } }, ["path", "old", "new"]),
  },
  {
    name: "write_file",
    description: "Create a file, or replace a whole file, with `content`. Staged, not committed. Prefer edit_file for a change to an existing file.",
    parameters: obj({ path: { type: "string", maxLength: 500 }, content: { type: "string" } }, ["path", "content"]),
  },
  {
    name: "delete_file",
    description: "Delete a file. Staged, not committed.",
    parameters: obj({ path: { type: "string", maxLength: 500 } }, ["path"]),
  },
  {
    name: "run",
    description: "Run shell commands on a computer with your staged edits applied to a fresh checkout. `cmd` is one command per line; they run in order and stop at the first that fails. Nothing is installed unless you install it in the same run. Returns the exit code and the end of the output. Each run takes 30 to 60 seconds and costs: batch commands.",
    parameters: obj({ cmd: { type: "string", minLength: 1, maxLength: 6000 }, why: { type: "string", maxLength: 300 } }, ["cmd", "why"]),
  },
  ...WEB_TOOLS,
  {
    name: "find_resources",
    description: "Find the best library or package for a need (\"a date picker for React\", \"PDF parsing in Python\"): a ranked shortlist with licence, maintenance, known vulnerabilities, size and fit, and a pick.",
    parameters: obj({ need: { type: "string", minLength: 3, maxLength: 300 } }, ["need"]),
  },
  {
    name: "flag_finding",
    description: "Record something you noticed in code you were not asked to change: a bug, a security problem, dead code. It goes in the pull request. Do not fix it unless it is part of the task.",
    parameters: obj({
      severity: { type: "string", enum: ["info", "warn", "risk"] }, path: { type: "string", maxLength: 500 }, line: { type: "integer", minimum: 1 }, text: { type: "string", maxLength: 400 },
    }, ["severity", "path", "text"]),
  },
  {
    name: "note",
    description: "Write a line in the work log for the person who reviews this: a decision you made and why.",
    parameters: obj({ text: { type: "string", minLength: 3, maxLength: 600 } }, ["text"]),
  },
  {
    name: "ask_user",
    description: "Ask the person a question, only when you cannot go on without their answer. The job waits for them. Give `options` (up to 4 short choices) when you can.",
    parameters: obj({
      question: { type: "string", minLength: 3, maxLength: 600 }, options: { type: "array", maxItems: 4, items: { type: "string", maxLength: 120 } },
    }, ["question"]),
  },
  {
    name: "done",
    description: "The work is finished (or there was nothing to change: then the summary is your answer). The server will now run the checks on your staged edits and commit them. `summary` is what the person reads first: what you did and why, in a few sentences.",
    parameters: obj({ summary: { type: "string", minLength: 3, maxLength: 2000 } }, ["summary"]),
  },
];

export interface ToolEnv {
  userId: string;
  projectId: string;
  /** The job's state, whose staged edits and counters the tools change. */
  state: AgentState;
  ws: Pick<Workspace, "read" | "tree">;
  brain: BrainHandle;
  log: WorkLog;
  /** Runs commands on a computer (loop's Run.runStep: the runner, with the claim kept alive and the step remembered for a restart). `tag` is the call's id. */
  runStep: (tag: string, spec: RunSpec) => Promise<RunOutcome>;
  web: WebTools;
  fetchFn?: FetchLike;
  /** The repo is private, so a GPL library is a bigger warning (resources/finder.ts). */
  closedSource: boolean;
  now: () => number;
  signal?: AbortSignal;
  findResources?: typeof findResources;
}

/**
 * What a call's arguments are kept as when they held something that looks like a secret (phases.ts modelTurn): the checkpoint, the
 * work log and the context never hold it. The call itself is run, in memory, with what the model sent; it is refused for the secret
 * (changeset.ts checkedText), so nothing is lost by not keeping it.
 */
export const WITHHELD_ARGS = JSON.stringify({ __withheld: true });

/** Whether a call's arguments hold something that looks like a secret, in the JSON as sent or in any text inside it. */
export function argsHoldSecret(raw: string): boolean {
  const texts: string[] = [raw];
  const walk = (v: unknown, depth: number): void => {
    if (typeof v === "string") texts.push(v);
    else if (depth < 4 && Array.isArray(v)) for (const x of v.slice(0, 50)) walk(x, depth + 1);
    else if (depth < 4 && v && typeof v === "object") for (const x of Object.values(v).slice(0, 50)) walk(x, depth + 1);
  };
  try { walk(JSON.parse(raw), 0); } catch { /* not JSON: the text as it is */ }
  return scanForSecrets(texts.map((content, i) => ({ path: `call-${i}.txt`, content }))).length > 0;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined);
const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class Tools {
  readonly changes: Changeset;
  private tree: { files: Set<string>; dirs: Map<string, Set<string>>; truncated: boolean } | null = null;
  private branchTexts = new Map<string, string | null>();
  /** `callId:kind` of the entries already in the work log: a call picked up again after a crash is not logged twice. */
  private logged = new Set<string>();

  constructor(private readonly env: ToolEnv) {
    this.changes = new Changeset(env.state.work.staged);
  }

  /** The branch moved (a commit): what was read of it is stale. */
  invalidate(): void {
    this.tree = null;
    this.branchTexts.clear();
  }

  defs(): readonly ToolDef[] { return AGENT_TOOLS; }

  /** The ids of calls the work log already has (from its entries), so they are not logged again. */
  seedLogged(keys: Iterable<string>): void {
    for (const k of keys) this.logged.add(k);
  }

  /** Whether a path is a file on the work branch now (the tree), or, for a huge repo the tree is cut short of, readable. */
  async exists(path: string): Promise<boolean> {
    const staged = this.changes.get(path);
    if (staged) return staged.content !== null;
    const t = await this.loadTree();
    if (t.files.has(path)) return true;
    if (!t.truncated) return false;
    return (await this.branchText(path).catch(() => null)) !== null;
  }

  // ------------------------------------------------------------- the branch

  private async loadTree() {
    if (this.tree) return this.tree;
    const t = await this.env.ws.tree();
    const files = new Set<string>();
    const dirs = new Map<string, Set<string>>();
    const add = (dir: string, name: string) => { (dirs.get(dir) ?? dirs.set(dir, new Set()).get(dir)!).add(name); };
    for (const e of t.entries) {
      if (e.type === "tree") continue;
      files.add(e.path);
      const parts = e.path.split("/");
      for (let i = 0; i < parts.length; i += 1) add(parts.slice(0, i).join("/"), i === parts.length - 1 ? parts[i]! : `${parts[i]!}/`);
    }
    this.tree = { files, dirs, truncated: t.truncated };
    return this.tree;
  }

  /** A file's text on the work branch, or null when it is not there. A file we cannot read (binary, too big) is a Refused. */
  private async branchText(path: string): Promise<string | null> {
    if (this.branchTexts.has(path)) return this.branchTexts.get(path)!;
    let text: string | null;
    try {
      text = (await this.env.ws.read(path)).text;
    } catch (err) {
      if (err instanceof ConnectorError && err.code === "not_found") text = null;
      else if (err instanceof ConnectorError && (err.code === "too_large" || err.code === "binary_file" || err.code === "not_a_file")) throw new Refused(err.message);
      else throw err;
    }
    if (this.branchTexts.size > 200) this.branchTexts.clear();
    this.branchTexts.set(path, text);
    return text;
  }

  /** A file as the work would see it: staged, or on the branch. Null when it is not there (or was deleted). */
  private async current(path: string): Promise<string | null> {
    const staged = this.changes.get(path);
    if (staged) return staged.content;
    return this.branchText(path);
  }

  // ------------------------------------------------------------------ calls

  async exec(call: ToolCall): Promise<ToolOutcome> {
    const name = call.name;
    if (!(AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
      return { ok: false, content: `There is no tool called ${short(name, 40)}. The tools are ${AGENT_TOOL_NAMES.join(", ")}.` };
    }
    let args: Record<string, unknown>;
    try {
      const v = call.arguments.trim() ? JSON.parse(call.arguments) : {};
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
      args = v as Record<string, unknown>;
      // A call picked up again after a restart, whose arguments were not kept because they held a secret.
      if (args.__withheld === true) {
        return { ok: false, content: "That call had something in it that looks like a secret, so it was not kept and was not run. Secrets never go in git or in a command: read the value from an environment variable, and name the setting in .env.example." };
      }
    } catch {
      return { ok: false, content: `${name} was called with arguments that are not a JSON object. Call it again with its arguments as JSON.` };
    }
    try {
      return await this.dispatch(call, name as AgentToolName, args);
    } catch (err) {
      if (err instanceof Refused) {
        await this.log(call, "note", `${name} refused: ${short(err.message, 200)}`);
        return { ok: false, content: err.message };
      }
      if (err instanceof ConnectorError) return { ok: false, content: err.message };
      if ((err as { name?: string })?.name === "AbortError") return { ok: false, content: "That was stopped." };
      throw err;
    }
  }

  private async dispatch(call: ToolCall, name: AgentToolName, a: Record<string, unknown>): Promise<ToolOutcome> {
    switch (name) {
      case "read_file": return this.readFile(call, a);
      case "list_dir": return this.listDir(call, a);
      case "search_code": return this.searchCode(call, a);
      case "edit_file": return this.editFile(call, a);
      case "write_file": return this.writeFile(call, a);
      case "delete_file": return this.deleteFile(call, a);
      case "run": return this.run(call, a);
      case "web_search": case "read_page": case "research": return this.web(call, name);
      case "find_resources": return this.resources(call, a);
      case "flag_finding": return this.flag(call, a);
      case "note": {
        const text = str(a.text)?.trim();
        if (!text) throw new Refused("text is needed.");
        await this.log(call, "note", text);
        return { ok: true, content: "Noted." };
      }
      case "ask_user": {
        const question = str(a.question)?.trim();
        if (!question) throw new Refused("question is needed.");
        const options = Array.isArray(a.options) ? a.options.filter((o): o is string => typeof o === "string" && !!o.trim()).slice(0, 4).map((o) => short(o.trim(), 120)) : undefined;
        await this.log(call, "question", question);
        return { ok: true, content: "Asked the person.", control: { type: "ask", question: short(question, 600), ...(options?.length ? { options } : {}) } };
      }
      case "done": {
        const summary = str(a.summary)?.trim();
        if (!summary) throw new Refused("summary is needed: what you did, in a few sentences.");
        await this.log(call, "decision", `Finished: ${short(summary, 300)}`);
        return { ok: true, content: "Done.", control: { type: "done", summary: short(summary, 2000) } };
      }
    }
  }

  /** The work log: the call and what came of it, with the call's id so a call picked up again is not logged twice. */
  private async log(call: ToolCall, kind: "read" | "edit" | "command" | "finding" | "decision" | "question" | "note", text: string, files?: string[], data?: Record<string, unknown>): Promise<void> {
    const key = `${call.id}:${kind}`;
    if (this.logged.has(key)) return;
    this.logged.add(key);
    await this.env.log.add(kind, { text, ...(files ? { files } : {}), data: { ...(data ?? {}), callId: call.id, tool: call.name } });
  }

  // ------------------------------------------------------------------ reading

  private async readFile(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const raw = str(a.path)?.trim();
    if (!raw) throw new Refused("path is needed.");
    const path = readablePath(raw);
    const text = await this.current(path);
    if (text === null) throw new Refused(this.changes.get(path) ? `${path} is deleted in your staged edits.` : `There is no file ${path} on the branch. Use list_dir or search_code to find it.`);
    const lines = text.split("\n");
    const from = Math.min(int(a.from) ?? 1, lines.length);
    const want = Math.min(int(a.to) ?? lines.length, lines.length);
    const out: string[] = [];
    let size = 0;
    let last = from - 1;
    for (let n = from; n <= want; n += 1) {
      const line = `${n}: ${lines[n - 1]!.slice(0, 400)}`;
      if (size + line.length > READ_MAX_CHARS) break;
      out.push(line);
      size += line.length + 1;
      last = n;
    }
    const withheld = scanForSecrets([{ path, content: out.join("\n") }]).length > 0;
    const note = last < want ? ` Cut at line ${last} of ${lines.length}; ask for the rest with from=${last + 1}.` : "";
    await this.log(call, "read", `Read ${path} (lines ${from}-${last} of ${lines.length}).`, [path]);
    if (withheld) return { ok: true, content: `${path} looks like it holds a secret, so its text is not shown to you. You can still edit around it if you know the text.`, label: path };
    return { ok: true, content: `${path}, lines ${from}-${last} of ${lines.length}.${note}${this.changes.get(path) ? " (with your staged edits)" : ""}`, data: out.join("\n"), label: path };
  }

  private async listDir(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const raw = (str(a.path) ?? "").trim().replace(/^\.\/?$/, "").replace(/^\.\//, "").replace(/\/+$/, "");
    if (raw) readablePath(raw);
    const t = await this.loadTree();
    const names = new Set(t.dirs.get(raw) ?? []);
    const prefix = raw ? `${raw}/` : "";
    for (const f of this.changes.files) {
      if (!f.path.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      const entry = slash < 0 ? rest : `${rest.slice(0, slash)}/`;
      if (f.content === null && slash < 0) names.delete(entry);
      else if (f.content !== null) names.add(entry);
    }
    if (!names.size) throw new Refused(`There is nothing in ${raw || "the root"}: no such folder, or it is empty.`);
    const sorted = [...names].sort((x, y) => (x.endsWith("/") === y.endsWith("/") ? (x < y ? -1 : 1) : x.endsWith("/") ? -1 : 1));
    const shown = sorted.slice(0, LIST_MAX);
    await this.log(call, "read", `Listed ${raw || "the root"} (${sorted.length} entries).`, raw ? [raw] : undefined);
    return {
      ok: true, content: `${raw || "The root"}: ${sorted.length} entries${sorted.length > shown.length ? `, the first ${shown.length} shown` : ""}${t.truncated ? " (GitHub cut the listing of this big repo short)" : ""}.`,
      data: shown.join("\n"), label: raw || "/",
    };
  }

  private async searchCode(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const q = str(a.query)?.trim();
    if (!q || q.length < 2) throw new Refused("query is needed: a name, a word or a phrase to look for.");
    const [files, symbols, texts] = await Promise.all([
      this.env.brain.findFiles(q, 8).catch(() => []), this.env.brain.findSymbols(q, 10).catch(() => []), this.env.brain.findTexts(q, 8).catch(() => []),
    ]);
    const lines: string[] = [];
    if (files.length) lines.push("Files:", ...files.map((f) => `${f.path}${f.summary ? ` - ${short(f.summary, 100)}` : ""}${f.symbols.length ? ` [${f.symbols.slice(0, 3).map((s) => s.name).join(", ")}]` : ""}`));
    if (symbols.length) lines.push("Symbols:", ...symbols.map((s) => `${s.path}:${s.line} ${s.kind} ${s.method ? `${s.method} ` : ""}${s.name}`));
    if (texts.length) lines.push("Text people see:", ...texts.map((t) => `${t.path}:${t.line} ${JSON.stringify(short(t.text, 90))}`));
    await this.log(call, "read", `Searched the code for ${JSON.stringify(short(q, 60))}: ${files.length} files, ${symbols.length} symbols, ${texts.length} texts.`);
    if (!lines.length) return { ok: true, content: `Nothing in the project's index matches ${JSON.stringify(short(q, 60))}. Try another word, or list_dir.` };
    return { ok: true, content: `Search for ${JSON.stringify(short(q, 60))} (the index does not see your staged edits):`, data: lines.join("\n"), label: q };
  }

  // ------------------------------------------------------------------ editing

  private async editFile(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const path = editablePath(a.path);
    const before = await this.current(path);
    if (before === null) throw new Refused(`There is no file ${path} to edit. Use write_file to create it.`);
    const next = checkedText(path, replaceOnce(path, before, a.old, a.new), before);
    const original = await this.branchText(path);
    this.changes.stage(path, next, { existed: original !== null, original });
    await this.log(call, "edit", `Edited ${path}.`, [path], { action: original === null ? "create" : "edit" });
    return { ok: true, content: `Edited ${path}. It is staged, not committed.` };
  }

  private async writeFile(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const path = editablePath(a.path);
    if (typeof a.content !== "string") throw new Refused("content is needed: the file's whole text.");
    const original = await this.branchText(path);
    const before = await this.current(path);
    const text = checkedText(path, a.content, before);
    this.changes.stage(path, text, { existed: original !== null, original });
    const action = original === null ? "create" : "edit";
    await this.log(call, "edit", `${action === "create" ? "Wrote" : "Rewrote"} ${path}.`, [path], { action });
    return { ok: true, content: `${action === "create" ? "Created" : "Rewrote"} ${path}. It is staged, not committed.` };
  }

  private async deleteFile(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const path = editablePath(a.path);
    const before = await this.current(path);
    if (before === null) throw new Refused(`There is no file ${path} to delete.`);
    const original = await this.branchText(path);
    this.changes.stage(path, null, { existed: original !== null, original });
    await this.log(call, "edit", `Deleted ${path}.`, [path], { action: "delete" });
    return { ok: true, content: `Deleted ${path}. It is staged, not committed.` };
  }

  // ------------------------------------------------------------------ running

  private async run(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const cmd = str(a.cmd);
    if (!cmd?.trim()) throw new Refused("cmd is needed: the command to run, one per line.");
    const commands = cmd.split("\n").map((c) => c.trim()).filter(Boolean);
    if (commands.length > 20) throw new Refused("At most 20 commands in one run. Put them in a script, or split the run.");
    if (commands.some((c) => c.length > 1800)) throw new Refused("A command is over 1,800 characters. Put it in a script file and run that.");
    if (scanForSecrets([{ path: "command.sh", content: cmd }]).length) throw new Refused("That command has something in it that looks like a secret. Never put a secret in a command: read it from the environment.");
    if (this.env.state.work.runs >= RUNS_MAX) throw new Refused(`${RUNS_MAX} runs are used already in this round of work. Finish with what you have learned, or call done.`);
    const overlay = this.changes.toOverlay();
    this.env.state.work.runs += 1;
    const why = short(str(a.why)?.trim() || commands[0]!, 200);
    const out = await this.env.runStep(call.id, { commands, timeoutSec: RUN_TIMEOUT_SEC, estimateMinutes: 2, overlay, why });
    if (out.status !== "done") {
      await this.log(call, "command", short(cmd, 200), undefined, { exitCode: -1, summary: out.status });
      const words = out.status === "no_runner"
        ? "No computer was free to run that (none of the person's computers is online and GitHub's free computers are not available), so it was not run. Carry on without running it, and say in your answer what could not be checked."
        : out.status === "timeout" ? "That did not finish in the time it was given, so it was stopped. Try something smaller." : "The run was stopped.";
      return { ok: false, content: words };
    }
    const tail = out.outputTail.length > RESULT_MAX_CHARS - 400 ? out.outputTail.slice(-(RESULT_MAX_CHARS - 400)) : out.outputTail;
    await this.log(call, "command", short(cmd, 200), undefined, { exitCode: out.exitCode, durationMs: out.minutes * 60_000, summary: short(out.outputTail.trim().split("\n").at(-1) ?? "", 140) });
    return { ok: true, content: `Exit code ${out.exitCode}${out.exitCode === 0 ? " (it passed)" : " (it failed)"}, ${out.minutes} minute${out.minutes === 1 ? "" : "s"}. The end of what it printed:`, data: tail, label: short(commands[0]!, 80) };
  }

  // ---------------------------------------------------------------- the web

  private async web(call: ToolCall, name: AgentToolName): Promise<ToolOutcome> {
    const r = await this.env.web.run({ id: call.id, name, arguments: call.arguments });
    const content = String(r.message.content);
    await this.log(call, "read", `${name}: ${r.ok ? "answered" : short(content, 100)}`);
    // What the web code returns has our own lines around the page, which it has already wrapped: it is passed on as it is, as the wrapper's own.
    return r.ok ? { ok: true, content: "", data: content, wrapped: true } : { ok: false, content };
  }

  private async resources(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const need = str(a.need)?.trim();
    if (!need || need.length < 3) throw new Refused("need is needed: what you are looking for, like \"a date picker for React\".");
    const find = this.env.findResources ?? findResources;
    const found = await find(need, this.env.brain, { ...(this.env.fetchFn ? { fetchFn: this.env.fetchFn } : {}), closedSource: this.env.closedSource, now: this.env.now, ...(this.env.signal ? { signal: this.env.signal } : {}) });
    const lines = [
      `Looking for: ${found.need} (${found.ecosystem})`,
      ...found.candidates.map((c, i) => `${i + 1}. ${c.name}@${c.version} score ${c.score}/100${c.avoid.length ? ` (be careful: ${c.avoid.join("; ")})` : ""} - ${c.line}`),
      `Pick: ${found.pick ?? "none"}. ${found.pickReason}`,
      ...(found.notes.length ? [`Notes: ${found.notes.join(", ")}`] : []),
    ];
    await this.log(call, "decision", `Looked for a library for ${short(found.need, 80)}: ${found.pick ? `picked ${found.pick}` : "no clear pick"}.`);
    // Registry and repository text: from outside, so it goes in as the web's own wrapper does.
    return { ok: true, content: "", data: asUntrusted({ url: "resources://find", finalUrl: "resources://find", text: lines.join("\n"), fetchedAt: this.env.now() }), wrapped: true };
  }

  // -------------------------------------------------------------- findings

  private async flag(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const f = cleanFinding({ severity: a.severity, path: a.path, line: a.line, text: a.text });
    if (!f) throw new Refused("A finding needs a path and a sentence about what you noticed.");
    if (this.env.state.findings.length >= FINDINGS_MAX) throw new Refused(`${FINDINGS_MAX} findings are recorded already; that is enough for one change.`);
    this.env.state.findings.push(f);
    await this.log(call, "finding", f.text, [f.path], { severity: f.severity, path: f.path, ...(f.line !== undefined ? { line: f.line } : {}) });
    return { ok: true, content: "Recorded. It will be in the pull request." };
  }
}

/** A path to READ: inside the repo (workflows are the project's and readable), and not a file that holds secrets, which are never shown to a model. */
function readablePath(raw: string): string {
  const path = raw.trim().replace(/^\.\//, "");
  try {
    assertRepoPath(path);
  } catch {
    throw new Refused(`${JSON.stringify(short(path, 80))} is not a path inside the repo. Use a path relative to the repo's root, with no .. and nothing in .git.`);
  }
  if (isSecretPath(path)) throw new Refused(`${path} is the kind of file that holds secrets, so Tailzu does not read it. If you need to know a setting's name, look at .env.example.`);
  return path;
}
