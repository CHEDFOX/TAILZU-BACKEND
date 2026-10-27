/**
 * THE AGENT'S TOOLS: WHAT THE MODEL CAN DO, AND WHAT EACH ONE REALLY DOES.
 *
 *   read_file {path, from?, to?}       the work branch overlaid with the staged edits, 12,000 characters at most
 *   list_dir {path}                    the same overlay, one level
 *   grep {pattern, path?, glob?, ...}  exact text in the files, ripgrep-like, with the staged edits
 *   glob {pattern}                     files by name, newest change first, with the staged edits
 *   search_code {query}                the project brain: files, symbols, the text people see ("where is the feature")
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
 * read_file, list_dir, grep and glob are answered from the job's COPY OF THE CODE when it has one (code/live: the room, a Durable Object, filled
 * from one tarball) and instantly; without one, or when the copy says it cannot (a repo too big for a copy, a file it does not hold), read_file
 * and list_dir use GitHub's API as they always did, glob reads GitHub's tree, and grep reads a bounded number of files from GitHub.
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
import { briefCall } from "./context.js";
import type { LiveFiles, LiveStatus } from "../live/ports.js";
import type { ViewerEvent } from "../live/protocol.js";
import { skipReason } from "../live/rules.js";
import { byPath, globPaths, grepFiles, type GrepFile, type GrepOk, type GrepOptions } from "../live/search.js";
import { scanForSecrets } from "../policy.js";
import type { BrainHandle } from "../project/index.js";
import { isSecretPath } from "../project/lang.js";
import type { Workspace } from "../projects.js";
import { findResources } from "../resources/finder.js";
import { WEB_TOOLS, type WebTools } from "../webTools.js";
import { cleanFinding, redactText, type WorkLog } from "../work/index.js";
import { Changeset, Refused, checkedText, editablePath, replaceOnce } from "./changeset.js";
import type { PathGuard } from "../team/guard.js";
import type { RunOutcome, RunSpec } from "./runner.js";
import { FINDINGS_MAX, FREEFORM_RUNS_MAX, LIST_MAX, READ_MAX_CHARS, RESULT_MAX_CHARS, RUNS_MAX, RUN_TIMEOUT_SEC, type AgentState, type ResultRecord } from "./types.js";

export type ToolControl = { type: "done"; summary: string } | { type: "ask"; question: string; options?: string[] };
export interface ToolOutcome extends ResultRecord { control?: ToolControl }

export const AGENT_TOOL_NAMES = [
  "read_file", "list_dir", "grep", "glob", "search_code", "edit_file", "write_file", "delete_file", "run",
  "web_search", "read_page", "research", "find_resources", "flag_finding", "note", "ask_user", "done",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", additionalProperties: false, required, properties });

/** The definitions the model is given, in the brain's ToolDef shape. */
export const AGENT_TOOLS: readonly ToolDef[] = [
  {
    name: "read_file",
    description: "Read a file with your staged edits applied; lines are numbered. A long file is cut: pass from and to (1-based, inclusive).",
    parameters: obj({
      path: { type: "string", maxLength: 500 }, from: { type: "integer", minimum: 1 }, to: { type: "integer", minimum: 1 },
    }, ["path"]),
  },
  {
    name: "list_dir",
    description: "List what is directly inside a folder (\"\" or \".\" is the root), with your staged edits applied.",
    parameters: obj({ path: { type: "string", maxLength: 500 } }, ["path"]),
  },
  {
    name: "grep",
    description: "Regular-expression search of file text (JavaScript syntax), like ripgrep: `path:line:text` per match. "
      + "Use it for anything EXACT: a name, a string, an import, every call site. It sees your staged edits. If the answer says partial, narrow it with path and glob. "
      + "Very long patterns and nested repeats are refused.",
    parameters: obj({
      pattern: { type: "string", minLength: 1, maxLength: 300 }, path: { type: "string", maxLength: 500 }, glob: { type: "string", maxLength: 200 },
      ignoreCase: { type: "boolean" }, context: { type: "integer", minimum: 0, maximum: 5 }, filesOnly: { type: "boolean" }, maxResults: { type: "integer", minimum: 1, maximum: 500 },
    }, ["pattern"]),
  },
  {
    name: "glob",
    description: "Find files by name with a glob; a pattern with no / matches the name at any depth. Newest changes first; it sees your staged edits. "
      + "Use it to find files by name; use grep for what is inside them.",
    parameters: obj({ pattern: { type: "string", minLength: 1, maxLength: 200 } }, ["pattern"]),
  },
  {
    name: "search_code",
    description: "Ask the project's index WHERE a feature lives: a file, function, class, route, or text shown on screen. Returns paths with a line each; "
      + "for an exact name or string, use grep. It does not see your staged edits.",
    parameters: obj({ query: { type: "string", minLength: 2, maxLength: 200 } }, ["query"]),
  },
  {
    name: "edit_file",
    description: "Replace text in a file. `old` is copied exactly from the file and occurs ONCE (add surrounding lines to make it so); `new` replaces it. Staged, not committed.",
    parameters: obj({ path: { type: "string", maxLength: 500 }, old: { type: "string" }, new: { type: "string" } }, ["path", "old", "new"]),
  },
  {
    name: "write_file",
    description: "Create a file, or replace a whole one, with `content`. Staged, not committed. Prefer edit_file for an existing file.",
    parameters: obj({ path: { type: "string", maxLength: 500 }, content: { type: "string" } }, ["path", "content"]),
  },
  {
    name: "delete_file",
    description: "Delete a file. Staged, not committed.",
    parameters: obj({ path: { type: "string", maxLength: 500 } }, ["path"]),
  },
  {
    name: "run",
    description: "Run shell commands over your staged edits. `cmd` is one command per line, run in order, stopping at the first failure. "
      + "Nothing is assumed installed: install what a run needs in that run. Returns the exit code and the end of the output. "
      + "With a live session the first run opens it (about a minute), later runs start at once, and it closes after two idle minutes; otherwise each run waits for a computer. Batch commands.",
    parameters: obj({ cmd: { type: "string", minLength: 1, maxLength: 6000 }, why: { type: "string", maxLength: 300 } }, ["cmd", "why"]),
  },
  ...WEB_TOOLS,
  {
    name: "find_resources",
    description: "Find the best library or package for a need: a ranked shortlist with licence, maintenance, known vulnerabilities, size and fit, and a pick.",
    parameters: obj({ need: { type: "string", minLength: 3, maxLength: 300 } }, ["need"]),
  },
  {
    name: "flag_finding",
    description: "Record something you noticed outside your task (a bug, a security problem, dead code) for the pull request. Do not fix it unless the task includes it.",
    parameters: obj({
      severity: { type: "string", enum: ["info", "warn", "risk"] }, path: { type: "string", maxLength: 500 }, line: { type: "integer", minimum: 1 }, text: { type: "string", maxLength: 400 },
    }, ["severity", "path", "text"]),
  },
  {
    name: "note",
    description: "Write a line in the work log for the reviewer: a decision and why.",
    parameters: obj({ text: { type: "string", minLength: 3, maxLength: 600 } }, ["text"]),
  },
  {
    name: "ask_user",
    description: "Ask the person a question, only when you cannot go on without the answer; the job waits. Give `options` (up to 4 short choices) when you can.",
    parameters: obj({
      question: { type: "string", minLength: 3, maxLength: 600 }, options: { type: "array", maxItems: 4, items: { type: "string", maxLength: 120 } },
    }, ["question"]),
  },
  {
    name: "done",
    description: "The work is finished, or nothing needed changing (then `summary` is your answer). The server then runs the checks on your staged edits and commits them. `summary` is what the person reads first: what you did and why.",
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
  /** The job's copy of the code (code/live), when there is one. */
  files?: LiveFiles | null;
  /** Compact events for the app's live view. Never throws into the tool. */
  progress?: (ev: ViewerEvent) => void;
  /** Which files this job may change, when it is a part of a team's (team/guard.ts): a helper its own, the lead doing the contracts those. Absent: all of them. */
  owns?: () => PathGuard | undefined;
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
  private tree: { files: Set<string>; sizes: Map<string, number>; dirs: Map<string, Set<string>>; truncated: boolean } | null = null;
  /** What the job's copy of the code said about itself, once asked (undefined: not asked yet). */
  private liveStatus: LiveStatus | null | undefined;
  /** The staged edits the copy was last given. */
  private overlayRev = -1;
  private branchTexts = new Map<string, string | null>();
  /** `callId:kind` of the entries already in the work log: a call picked up again after a crash is not logged twice. */
  private logged = new Set<string>();

  constructor(private readonly env: ToolEnv) {
    this.changes = new Changeset(env.state.work.staged, env.owns);
  }

  /** The branch moved (a commit): what was read of it is stale. */
  invalidate(): void {
    this.tree = null;
    this.branchTexts.clear();
    // The job's copy of the code is of the commit before this one: thrown away, and made again at the next need.
    if (this.env.files?.reset) {
      this.liveStatus = undefined;
      this.overlayRev = -1;
      void this.env.files.reset().catch(() => undefined);
    }
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
    const sizes = new Map<string, number>();
    const dirs = new Map<string, Set<string>>();
    const add = (dir: string, name: string) => { (dirs.get(dir) ?? dirs.set(dir, new Set()).get(dir)!).add(name); };
    for (const e of t.entries) {
      if (e.type === "tree") continue;
      files.add(e.path);
      if (typeof e.size === "number") sizes.set(e.path, e.size);
      const parts = e.path.split("/");
      for (let i = 0; i < parts.length; i += 1) add(parts.slice(0, i).join("/"), i === parts.length - 1 ? parts[i]! : `${parts[i]!}/`);
    }
    this.tree = { files, sizes, dirs, truncated: t.truncated };
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
    this.emit({ t: "tool", id: call.id, name, brief: redactText(briefCall({ id: call.id, name, arguments: call.arguments }), 120), at: this.env.now() });
    let out: ToolOutcome;
    try {
      out = await this.dispatch(call, name as AgentToolName, args);
    } catch (err) {
      if (err instanceof Refused) {
        await this.log(call, "note", `${name} refused: ${short(err.message, 200)}`);
        out = { ok: false, content: err.message };
      } else if (err instanceof ConnectorError) out = { ok: false, content: err.message };
      else if ((err as { name?: string })?.name === "AbortError") out = { ok: false, content: "That was stopped." };
      else throw err;
    }
    this.emit({ t: "result", id: call.id, ok: out.ok, brief: short(redactText((out.content || out.data || "").split("\n")[0] ?? "", 200), 120), at: this.env.now() });
    return out;
  }

  private emit(ev: ViewerEvent): void {
    try { this.env.progress?.(ev); } catch { /* a live view is never worth a failed tool */ }
  }

  // ------------------------------------------------------- the job's copy

  /**
   * The job's copy of the code, if there is one that can answer. `forSearch` also takes a repo too big for a copy ("remote"): its grep and
   * glob go to a runner, which the copy's owner arranges. The staged edits are given to the copy whenever they have changed.
   */
  private async live(forSearch: boolean): Promise<LiveFiles | null> {
    const f = this.env.files;
    if (!f) return null;
    if (this.liveStatus === undefined) {
      try { this.liveStatus = await f.status(); } catch { this.liveStatus = null; }
    }
    const st = this.liveStatus;
    if (!st || !(forSearch ? st.ready || st.remote : st.ready && !st.remote)) return null;
    if (this.overlayRev !== this.changes.rev) {
      try {
        await f.setOverlay(this.changes.toOverlayUnchecked());
        this.overlayRev = this.changes.rev;
      } catch { return null; }
    }
    return f;
  }

  private async dispatch(call: ToolCall, name: AgentToolName, a: Record<string, unknown>): Promise<ToolOutcome> {
    switch (name) {
      case "read_file": return this.readFile(call, a);
      case "list_dir": return this.listDir(call, a);
      case "grep": return this.grep(call, a);
      case "glob": return this.glob(call, a);
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
    const live = await this.live(false);
    if (live) {
      const from = int(a.from) ?? 1;
      const to = int(a.to);
      const r = await live.read(path, { offset: from, ...(to !== undefined ? { limit: Math.max(1, to - from + 1) } : {}) }).catch(() => ({ kind: "unavailable" as const }));
      if (r.kind === "missing") throw new Refused(r.deleted ? `${path} is deleted in your staged edits.` : `There is no file ${path} on the branch. Use list_dir, glob or search_code to find it.`);
      if (r.kind === "ok") return this.readOut(call, path, from, r.out.total, r.out.from === 0 ? [] : r.out.text.split("\n"), r.staged);
      // Not held by the copy (vendored, a lockfile, generated, too big) or the copy would not answer: GitHub still can.
    }
    const text = await this.current(path);
    if (text === null) throw new Refused(this.changes.get(path) ? `${path} is deleted in your staged edits.` : `There is no file ${path} on the branch. Use list_dir, glob or search_code to find it.`);
    const lines = text.split("\n");
    const from = Math.min(int(a.from) ?? 1, lines.length);
    const want = Math.min(int(a.to) ?? lines.length, lines.length);
    const out: string[] = [];
    for (let n = from; n <= want; n += 1) out.push(`${n}: ${lines[n - 1]!.slice(0, 400)}`);
    return this.readOut(call, path, from, lines.length, out, !!this.changes.get(path));
  }

  /** What a read answers with, from numbered lines (`12: text`): cut to what the model is shown, and withheld if it looks like a secret. */
  private async readOut(call: ToolCall, path: string, from: number, total: number, numbered: string[], staged: boolean): Promise<ToolOutcome> {
    if (!numbered.length) {
      await this.log(call, "read", `Read ${path} (nothing from line ${from}; ${total} lines).`, [path]);
      return { ok: true, content: `${path} has ${total} line${total === 1 ? "" : "s"}; there is nothing from line ${from}.`, label: path };
    }
    const first = Number.parseInt(numbered[0]!, 10) || from;
    const out: string[] = [];
    let size = 0;
    let last = first - 1;
    for (const line of numbered) {
      const cutLine = line.length > 412 ? `${line.slice(0, 411)}…` : line;
      if (size + cutLine.length > READ_MAX_CHARS) break;
      out.push(cutLine);
      size += cutLine.length + 1;
      last = Number.parseInt(line, 10) || last + 1;
    }
    const withheld = scanForSecrets([{ path, content: out.join("\n") }]).length > 0;
    const note = last < total ? ` Cut at line ${last} of ${total}; ask for the rest with from=${last + 1}.` : "";
    await this.log(call, "read", `Read ${path} (lines ${first}-${last} of ${total}).`, [path]);
    if (withheld) return { ok: true, content: `${path} looks like it holds a secret, so its text is not shown to you. You can still edit around it if you know the text.`, label: path };
    return { ok: true, content: `${path}, lines ${first}-${last} of ${total}.${note}${staged ? " (with your staged edits)" : ""}`, data: out.join("\n"), label: path };
  }

  private async listDir(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const raw = (str(a.path) ?? "").trim().replace(/^\.\/?$/, "").replace(/^\.\//, "").replace(/\/+$/, "");
    if (raw) readablePath(raw);
    const live = await this.live(false);
    if (live) {
      const r = await live.list(raw).catch(() => ({ kind: "unavailable" as const }));
      if (r.kind === "empty") throw new Refused(`There is nothing in ${raw || "the root"}: no such folder, or it is empty.`);
      if (r.kind === "ok") {
        await this.log(call, "read", `Listed ${raw || "the root"} (${r.out.total} entries).`, raw ? [raw] : undefined);
        return {
          ok: true, content: `${raw || "The root"}: ${r.out.total} entries${r.out.partial ? `, the first ${r.out.entries.length} shown` : ""}.`,
          data: r.out.entries.slice(0, LIST_MAX).join("\n"), label: raw || "/",
        };
      }
    }
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

  // ------------------------------------------------------------ grep, glob

  private async grep(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const pattern = str(a.pattern);
    if (!pattern?.length) throw new Refused("pattern is needed: a regular expression to look for, like \"parseConfig\" or \"TODO\\(\".");
    const opts: GrepOptions = {
      ...(str(a.path)?.trim() ? { path: str(a.path)!.trim().replace(/^\.\//, "") } : {}), ...(str(a.glob)?.trim() ? { glob: str(a.glob)!.trim() } : {}),
      ...(a.ignoreCase === true ? { ignoreCase: true } : {}), ...(int(a.context) !== undefined ? { context: Math.min(5, int(a.context)!) } : {}),
      ...(a.filesOnly === true ? { filesOnly: true } : {}), ...(int(a.maxResults) !== undefined ? { maxResults: int(a.maxResults)! } : {}),
    };
    let out: (GrepOk & { searched?: number; candidates?: number }) | null = null;
    let why = "";
    const live = await this.live(true);
    if (live) {
      const r = await live.grep(pattern, opts).catch(() => ({ kind: "unavailable" as const, why: "" }));
      if (r.kind === "error") return { ok: false, content: r.error };
      if (r.kind === "ok") out = r.out;
      else why = r.why ?? "";
    }
    if (!out) {
      if (this.liveStatus?.remote) {
        throw new Refused(`This repo is too big to search from here${why ? ` (${why})` : ""}. Use search_code to find where something lives, then read_file; or run \`rg\` or \`grep -rn\` with run, which searches the whole checkout.`);
      }
      const fallback = await this.grepViaGithub(pattern, opts);
      if ("error" in fallback) return { ok: false, content: fallback.error };
      out = fallback;
    }
    const text = withholdSecrets(out.text);
    const words = out.matches === 0
      ? `No match for ${JSON.stringify(short(pattern, 60))}${out.partial ? ` (the search was cut short: ${partialWhy(out)})` : ""}.`
      : `${out.matches} ${a.filesOnly === true ? "file" : "line"}${out.matches === 1 ? "" : "s"} match${out.matches === 1 ? "es" : ""} ${JSON.stringify(short(pattern, 60))} in ${out.files} file${out.files === 1 ? "" : "s"}${out.partial ? `. PARTIAL: ${partialWhy(out)}` : ""}.`;
    await this.log(call, "read", `Searched the files for ${JSON.stringify(short(pattern, 60))}: ${out.matches} match${out.matches === 1 ? "" : "es"}.`);
    return text ? { ok: true, content: words, data: text, label: pattern } : { ok: true, content: words };
  }

  /** Without a copy of the code: a bounded look through the files GitHub can give, one by one. Says plainly that it is bounded. */
  private async grepViaGithub(pattern: string, o: GrepOptions): Promise<(GrepOk & { searched?: number; candidates?: number }) | { error: string }> {
    const t = await this.loadTree();
    const staged = new Map(this.changes.files.map((f) => [f.path, f.content]));
    const paths = new Set<string>();
    for (const p of t.files) if (skipReason(p, t.sizes.get(p) ?? 1) === null && staged.get(p) !== null) paths.add(p);
    for (const [p, c] of staged) if (c !== null && skipReason(p, c.length || 1) === null) paths.add(p);
    const scoped = [...paths].filter((p) => (!o.path || p === o.path || p.startsWith(`${o.path.replace(/\/+$/, "")}/`))).sort();
    let globbed = scoped;
    if (o.glob) {
      const g = globPaths(scoped, o.glob, undefined, scoped.length || 1);
      if (!g.ok) return { error: g.error };
      globbed = g.paths.sort();
    }
    const take = globbed.slice(0, GITHUB_GREP_FILES_MAX);
    const files: GrepFile[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, take.length) }, async () => {
      while (next < take.length) {
        const p = take[next++]!;
        try {
          const c = await this.current(p);
          if (c !== null) files.push({ path: p, content: c });
        } catch { /* a file that cannot be read is a file not searched */ }
      }
    }));
    files.sort(byPath);
    const r = grepFiles(files, pattern, o);
    if (!r.ok) return { error: r.error };
    if (globbed.length > take.length) {
      return { ...r, partial: true, why: r.why ?? "files", searched: take.length, candidates: globbed.length };
    }
    return r;
  }

  private async glob(call: ToolCall, a: Record<string, unknown>): Promise<ToolOutcome> {
    const pattern = str(a.pattern)?.trim();
    if (!pattern) throw new Refused("pattern is needed: a glob like src/**/*.ts or *.md.");
    const live = await this.live(true);
    if (live) {
      const r = await live.glob(pattern).catch(() => ({ kind: "unavailable" as const }));
      if (r.kind === "error") return { ok: false, content: r.error };
      if (r.kind === "ok") return this.globOut(call, pattern, r.out.paths, r.out.total);
    }
    const t = await this.loadTree();
    const paths = new Set(t.files);
    const recent = new Map<string, number>();
    // Staged edits are the most recent change there is, the last staged first.
    this.changes.files.forEach((f, i) => {
      recent.set(f.path, 1e15 + i);
      if (f.content === null) paths.delete(f.path); else paths.add(f.path);
    });
    const r = globPaths(paths, pattern, recent);
    if (!r.ok) return { ok: false, content: r.error };
    return this.globOut(call, pattern, r.paths, r.total, t.truncated);
  }

  private async globOut(call: ToolCall, pattern: string, paths: string[], total: number, truncated = false): Promise<ToolOutcome> {
    await this.log(call, "read", `Found files matching ${JSON.stringify(short(pattern, 60))}: ${total}.`);
    if (!paths.length) return { ok: true, content: `No file matches ${JSON.stringify(short(pattern, 60))}.${truncated ? " (GitHub cut the listing of this big repo short.)" : ""}` };
    return {
      ok: true, content: `${total} file${total === 1 ? "" : "s"} match${total === 1 ? "es" : ""} ${JSON.stringify(short(pattern, 60))}${total > paths.length ? `, the first ${paths.length} shown` : ""}, most recently changed first.`,
      data: paths.join("\n"), label: pattern,
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
    this.changes.assertOwned(path);
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
    this.changes.assertOwned(path);
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
    this.changes.assertOwned(path);
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
    // A run picked up again after the advance that started it (a step still out, a session waited for) is the same run, not another.
    const resumed = this.env.state.run?.tag === call.id;
    // A free-form job investigates by running things, so its runs are allowed more of them (and it has fewer steps: types.ts FREEFORM_RUNS_MAX).
    const runsMax = this.env.state.mode === "freeform" ? FREEFORM_RUNS_MAX : RUNS_MAX;
    if (!resumed && this.env.state.work.runs >= runsMax) throw new Refused(`${runsMax} runs are used already in this round of work. Finish with what you have learned, or call done.`);
    const overlay = this.changes.toOverlay();
    if (!resumed) this.env.state.work.runs += 1;
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
    await this.log(call, "command", short(cmd, 200), undefined, { exitCode: out.exitCode, durationMs: out.ms ?? out.minutes * 60_000, summary: short(out.outputTail.trim().split("\n").at(-1) ?? "", 140) });
    const took = out.ms !== undefined && out.ms < 60_000 ? `${(out.ms / 1000).toFixed(1)} seconds` : `${out.minutes} minute${out.minutes === 1 ? "" : "s"}`;
    return { ok: true, content: `Exit code ${out.exitCode}${out.exitCode === 0 ? " (it passed)" : " (it failed)"}, ${took}. The end of what it printed:`, data: tail, label: short(commands[0]!, 80) };
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

/** Files a grep without a copy of the code reads from GitHub, one request each. */
export const GITHUB_GREP_FILES_MAX = 60;

function partialWhy(o: GrepOk & { searched?: number; candidates?: number }): string {
  switch (o.why) {
    case "results": return "there are more matches than are shown. Narrow it with path or glob.";
    case "time": return "it ran out of time. Narrow it with path or glob.";
    case "work": return "it was too much text to search in one go. Narrow it with path or glob.";
    case "files": return `only ${o.searched ?? "some"} of ${o.candidates ?? "many"} files were searched, because the code is being read from GitHub one file at a time. Narrow it with path or glob, or use search_code.`;
    default: return "not everything was searched.";
  }
}

/** A line of grep output that looks like it holds a secret is replaced by a note, as read_file withholds a file's text. */
function withholdSecrets(text: string): string {
  if (!text) return text;
  let held = 0;
  const lines = text.split("\n").map((row) => {
    if (row === "--") return row;
    if (scanForSecrets([{ path: "grep.txt", content: row }]).length === 0) return row;
    held += 1;
    const head = /^(.*?[:-]\d+[:-])/.exec(row)?.[1] ?? "";
    return `${head}[line withheld: it looks like it holds a secret]`;
  });
  return held ? `${lines.join("\n")}\n[${held} line${held === 1 ? "" : "s"} withheld: they look like they hold a secret]` : lines.join("\n");
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
