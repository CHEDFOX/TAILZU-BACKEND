/**
 * THE TEST RIG FOR LEAD AND HELPERS MODE (code-team-*.test.ts): THE AGENT RIG (tests/agent-rig.ts) WITH A REPO BIG ENOUGH FOR A TEAM, AND A MODEL THAT TAKES EACH
 * JOB'S TURNS FROM ITS OWN SCRIPT.
 *
 * The agent rig's scripted model has one queue, which is right for one job and wrong for several that run side by side: the helpers would take each other's
 * turns in whatever order they happen to be asked. Here every job has its own script, found by who it is: the lead ("lead"), or a helper by its part and round
 * ("p1", "p2", "p1.fix1" ...). A turn is a tool call or a few, as in the agent rig (`call`, `done`). The JSON questions (the split, the review) are the work
 * core's `json.on(purpose, answer)`, as everywhere, with `reviews` and `splits` recording what was asked.
 *
 *   the repo      sixteen files in areas: contracts (src/types), the API (src/api), the web page (src/web), mail, tags, stats and utilities
 *   the lead      is handed the job with the place already found (a chat's hand-off), so locating asks nothing
 *   the helpers   run on `model` "z-ai/glm-5.3-flash"; a review is answered as the reviewer the router named
 */
import { BudgetExceeded, type CallInput, type CallResult } from "../src/code/brain/gateway.js";
import { addJobSpend } from "../src/code/brain/spend.js";
import { stateOf, type AgentState } from "../src/code/agent/types.js";
import type { EnqueueOptions } from "../src/code/agent/orchestrator.js";
import { createWorkBranch } from "../src/code/projects.js";
import type { Located } from "../src/code/work/index.js";
import { agentRig, call, done, KEYS, type AgentRig, type AgentRigOptions, type Turn } from "./agent-rig.js";
import { sym, type FileSpec } from "./work-fixtures.js";

export { call, done, KEYS };

const T = (name: string, body: string) => `export const ${name} = ${JSON.stringify(body)};\n`;

/** The files of the repo. Short, and each one has a line a test can edit. */
export const TEAM_FILES: Record<string, string> = {
  "README.md": "# shop\n",
  "package.json": JSON.stringify({ name: "shop", scripts: { test: "vitest run", typecheck: "tsc --noEmit", lint: "eslint ." } }, null, 2),
  "src/types/note.ts": "export interface Note {\n  id: string;\n  words: number;\n}\n",
  "src/api/notes.ts": T("notes", "v0"),
  "src/api/notes.test.ts": T("notesTest", "v0"),
  "src/api/routes.ts": T("routes", "v0"),
  "src/web/NotePage.tsx": T("page", "v0"),
  "src/web/NotePage.test.tsx": T("pageTest", "v0"),
  "src/web/api.ts": T("webApi", "v0"),
  "src/mail/send.ts": T("send", "v0"),
  "src/mail/send.test.ts": T("sendTest", "v0"),
  "src/tags/count.ts": T("count", "v0"),
  "src/tags/count.test.ts": T("countTest", "v0"),
  "src/stats/summary.ts": T("summary", "v0"),
  "src/stats/summary.test.ts": T("summaryTest", "v0"),
  "src/util/format.ts": T("format", "v0"),
  "src/util/format.test.ts": T("formatTest", "v0"),
};

/** The files a big plan changes: fourteen, which is more than the twelve a lead is for. */
export const BIG_PLAN_FILES = Object.keys(TEAM_FILES).filter((p) => p.startsWith("src/"));

const rows = (files: Record<string, string>): FileSpec[] => Object.keys(files).map((path) => ({
  path, ...(path.startsWith("src/") ? { symbols: [sym(path.split("/").pop()!.replace(/\..*$/, ""), "const")] } : {}), summary: `The file ${path}.`,
  ...(path.endsWith(".test.ts") || path.endsWith(".test.tsx") ? {} : { tests: [path.replace(/\.tsx?$/, (m) => `.test${m}`)].filter((t) => t in files) }),
  ...(path === "src/api/routes.ts" ? { imports: ["src/api/notes.ts"] } : {}),
  ...(path === "src/web/api.ts" ? { imports: ["src/types/note.ts"] } : {}),
}));

export const TEAM_TASK = "Let people export a note as a PDF from the note page and email it to a friend, and show the word count in the stats and with the shared formats.";
export const LOCATED: Located = {
  targets: [{ path: "src/api/notes.ts", why: "the export lives here", signals: [], score: 1 }], related: [], tests: [], confidence: 1, used: { expanded: false, picked: false, paise: 0 },
};

/** A plan of fourteen files in six steps, as `work.plan` answers it. */
export function bigPlan(files: readonly string[] = BIG_PLAN_FILES) {
  const by = (re: RegExp) => files.filter((f) => re.test(f)).map((path) => ({ path, action: "edit" as const }));
  return {
    steps: [
      { do: "Add the export fields to the Note type", files: by(/^src\/types\//) },
      { do: "Build the export endpoint and its route", files: by(/^src\/api\//) },
      { do: "Add the export button and the call to the endpoint", files: by(/^src\/web\//) },
      { do: "Email the PDF to a friend", files: by(/^src\/mail\//) },
      { do: "Show the word count in the stats and with the formats", files: [...by(/^src\/tags\//), ...by(/^src\/stats\//)] },
      { do: "Share the number formats", files: by(/^src\/util\//) },
    ].filter((s) => s.files.length),
    notes: [] as string[],
  };
}

/** The split the model proposes: the contracts, then four parts over disjoint folders. */
export function goodSplit() {
  return {
    parts: [
      { id: 0, title: "Note contract", goal: "Add the export fields to the Note type.", ownedPaths: ["src/types/"], reads: [], dependsOn: [], acceptance: ["Note has what an export needs"], budgetShare: 1 },
      { id: 1, title: "Export API", goal: "Build the export endpoint and its route, with tests.", ownedPaths: ["src/api/"], reads: ["src/types/note.ts"], dependsOn: [0], acceptance: ["The endpoint answers with a PDF", "A test covers it"], budgetShare: 3 },
      { id: 2, title: "Note page", goal: "Add the export button and the call to the endpoint.", ownedPaths: ["src/web/"], reads: ["src/types/note.ts"], dependsOn: [0], acceptance: ["The page has an export button"], budgetShare: 3 },
      { id: 3, title: "Mail", goal: "Email the PDF to a friend.", ownedPaths: ["src/mail/"], reads: ["src/types/note.ts"], dependsOn: [0], acceptance: ["The mail sender can attach a PDF"], budgetShare: 2 },
      { id: 4, title: "Counts and stats", goal: "Show the word count in the stats and with the shared formats.", ownedPaths: ["src/tags/", "src/stats/", "src/util/"], reads: [], dependsOn: [0], acceptance: ["The word count shows in the stats"], budgetShare: 2 },
    ],
    notes: [],
  };
}

type Script = Array<Turn | ((input: CallInput<unknown>) => Turn)>;

export interface ReviewSeen { part: number; tier: string | undefined; model: string | undefined; writerModel: string | undefined; user: string }

export async function teamRig(o: AgentRigOptions & { files?: Record<string, string> } = {}) {
  const files = o.files ?? TEAM_FILES;
  const r = await agentRig({ ...o, files, rows: rows(files), features: [
    { name: "Notes", summary: "Notes.", files: ["src/api/notes.ts", "src/types/note.ts"], fileCount: 2, routes: [], texts: [] },
    { name: "Mail", summary: "Mail.", files: ["src/mail/send.ts"], fileCount: 1, routes: [], texts: [] },
    { name: "Stats", summary: "Stats.", files: ["src/tags/count.ts", "src/stats/summary.ts"], fileCount: 2, routes: [], texts: [] },
  ] });
  // The agent rig's own server is not used here (it would answer with the one-queue model); it must not pick up a job either.
  r.orch.crash();
  const scripts = new Map<string, Script>();
  const reviews: ReviewSeen[] = [];
  /** A test can change what the review call answers with (the model that answered). */
  const hooks = { review: (res: CallResult<unknown>): CallResult<unknown> => res };
  /** Which model answers whose turns. */
  const models: Record<string, string> = { lead: "fake/lead" };
  /** What a review answers, by part number. Passing with nothing to say unless a test says otherwise. */
  const verdicts = new Map<number, Array<{ verdict: "pass" | "fix"; summary: string; findings: Array<{ severity: "blocker" | "major" | "minor" | "note"; path: string; line?: number; text: string }> }>>();
  const base = r.model.call;
  const keyOf = async (jobId: string | undefined): Promise<string> => {
    const job = jobId ? await r.jobStore.getJobById(jobId) : null;
    const s = stateOf(job?.checkpoint);
    if (!s?.part) return "lead";
    return `p${s.part.id}${s.part.round ? `.fix${s.part.round}` : ""}${s.part.attempt ? `.try${s.part.attempt}` : ""}`;
  };
  r.model.call = (async <T>(input: CallInput<T>): Promise<CallResult<T>> => {
    if (input.purpose === "team.review") {
      const part = Number(/part (\d+):/.exec(input.messages.map((m) => String(m.content)).join("\n"))?.[1] ?? 0);
      reviews.push({ part, tier: input.tier, model: input.model, writerModel: input.writerModel, user: input.messages.map((m) => String(m.content)).join("\n") });
      const q = verdicts.get(part);
      r.json.on("team.review", () => (q?.length ? q.shift()! : { verdict: "pass", summary: "Meets the goal.", findings: [] }));
      const res = await base<T>(input);
      return hooks.review({ ...res, model: input.model ?? "google/gemini-2.5-flash" }) as CallResult<T>;
    }
    if (input.purpose !== "agent.work") return base(input);
    // A work turn: the job's own script, charged like the gateway charges it.
    let userId = input.userId;
    if (input.jobId) {
      const job = await r.jobStore.getJobById(input.jobId);
      if (!job) throw new Error("no such job");
      userId ??= job.userId;
      if (job.spentPaise + r.model.need > job.budgetPaise) {
        throw new BudgetExceeded({ needPaise: r.model.need, spentPaise: job.spentPaise, budgetPaise: job.budgetPaise, scope: "job", purpose: input.purpose, ...(input.tier ? { tier: input.tier } : {}) });
      }
    }
    const key = await keyOf(input.jobId);
    const msgs = input.messages.map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content)));
    r.model.seen.push({ input: input as CallInput<unknown>, messages: msgs.join("\n---\n"), system: msgs[0] ?? "", user: msgs[1] ?? "", tier: input.tier, tools: (input.tools ?? []).map((t) => t.name) });
    r.model.turns += 1;
    const script = scripts.get(key);
    const next = script?.shift();
    if (!next) throw new Error(`the script of ${key} ran out`);
    const turn = typeof next === "function" ? next(input as CallInput<unknown>) : next;
    const toolCalls = turn.calls.map((c) => ({ id: `call_${(r.model.n += 1)}`, name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args) }));
    const result = {
      text: turn.text ?? "", json: undefined, toolCalls, model: models[key] ?? models[key.split(".")[0]!] ?? "z-ai/glm-5.3-flash", ...(input.tier ? { tier: input.tier } : {}),
      promptTokens: 100, completionTokens: 50, costUsd: 0.0001, paise: r.model.paise, costSource: "reported", truncated: false, ms: 1, calls: 1, trail: [],
    } as CallResult<T>;
    if (input.jobId) await addJobSpend(r.jobStore, input.jobId, result.paise);
    void userId;
    return result;
  }) as typeof r.model.call;

  /** A server over these stores whose model is the per-job one. */
  const server = (over: Parameters<AgentRig["orchestrator"]>[0] = {}) => r.orchestrator(over);

  r.json.on("work.plan", bigPlan());
  r.json.on("team.split", goodSplit());

  /** The lead job on a fresh work branch, handed to the agent with the place found. */
  async function startLead(task = TEAM_TASK, opts: EnqueueOptions & { budgetPaise?: number; orch?: ReturnType<typeof server> } = {}) {
    const { branch } = await createWorkBranch(r.d, "alice", r.project.id, task);
    const job = await r.jobs.createJob("alice", r.project.id, branch, task, opts.budgetPaise ?? 20_000, { agent: true });
    const orch = opts.orch ?? lead;
    const { budgetPaise: _b, orch: _o, ...enq } = opts;
    await orch.enqueue(job.id, task, { located: LOCATED, locatedFrom: "chat", ...enq });
    return { job, branch };
  }
  const lead = server({ instanceId: "lead" });

  const parts = async (leadId: string) => (await r.stateNow(leadId)).team?.parts ?? [];
  const partOf = async (leadId: string, id: number) => (await parts(leadId)).find((p) => p.id === id)!;
  /** Helper jobs the lead made, with their states. */
  const helpers = async (leadId: string) => {
    const out: Array<{ id: string; branch: string; state: AgentState; jobState: string }> = [];
    for (const j of await r.jobStore.listJobs("alice", 200)) {
      const s = stateOf(j.checkpoint);
      if (s?.part?.parentId === leadId) out.push({ id: j.id, branch: j.branch, state: s, jobState: j.state });
    }
    return out;
  };

  return { ...r, scripts, reviews, hooks, verdicts, models, server, lead, startLead, parts, partOf, helpers, files };
}
export type TeamRig = Awaited<ReturnType<typeof teamRig>>;

// ----------------------------------------------------------------- scripts

/** `edit_file` that replaces a file's whole content marker, for the files above (`v0` -> the given marker). */
export const edit = (path: string, to: string, from = "v0") => call("edit_file", { path, old: `"${from}"`, new: `"${to}"` });

/** The turns of a part that edits each file once and finishes. */
export const buildScript = (paths: readonly string[], summary: string, mark = "v1"): Script => [...paths.map((p) => edit(p, mark)), done(summary)];

/** Waits until a condition holds, moving nothing: a few turns of the event loop. */
export async function settle(r: TeamRig, until: () => Promise<boolean>, rounds = 400): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    if (await until()) return;
    await r.lead.idle();
    r.fake.clock.t += 1_000;
    await r.lead.tick().catch(() => undefined);
    await new Promise<void>((res) => setImmediate(res));
  }
  throw new Error("timed out waiting");
}


// ------------------------------------------------------------ shared by the tests

export const CONTRACT_EDIT = { path: "src/types/note.ts", old: "  words: number;\n", new: "  words: number;\n  pdfUrl?: string;\n" };
export const OVER = ["done", "failed", "cancelled"];

/** The scripts of a team that does everything right: the contracts, then four parts. */
export function allGood(r: TeamRig) {
  r.scripts.set("lead", [call("edit_file", CONTRACT_EDIT), done("Added the export fields to the Note type.")]);
  r.scripts.set("p1", buildScript(["src/api/notes.ts", "src/api/notes.test.ts", "src/api/routes.ts"], "Built the export endpoint."));
  r.scripts.set("p2", buildScript(["src/web/NotePage.tsx", "src/web/NotePage.test.tsx", "src/web/api.ts"], "Added the export button."));
  r.scripts.set("p3", buildScript(["src/mail/send.ts", "src/mail/send.test.ts"], "The mail sender attaches a PDF."));
  r.scripts.set("p4", buildScript(["src/tags/count.ts", "src/tags/count.test.ts", "src/stats/summary.ts", "src/stats/summary.test.ts", "src/util/format.ts", "src/util/format.test.ts"], "Shows the word count."));
}

/** Runs the lead to its end (or to a stop: `until`). */
export async function run(r: TeamRig, id: string, until?: () => Promise<boolean>) {
  await settle(r, until ?? (async () => OVER.includes((await r.jobNow(id)).state)));
  return { job: await r.jobNow(id), s: await r.stateNow(id) };
}

/** The first-parent chain of a branch, newest first. */
export function chain(r: TeamRig, branch: string) {
  const out: Array<{ sha: string; parents: string[]; message: string }> = [];
  let sha: string | undefined = r.fake.head(r.repo, branch);
  while (sha) {
    const c = r.fake.commitOf(r.repo, sha);
    if (!c) break;
    out.push({ sha, parents: c.parents, message: c.message });
    sha = c.parents[0];
  }
  return out;
}
