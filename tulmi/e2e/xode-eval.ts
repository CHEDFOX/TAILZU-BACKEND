/**
 * XODE'S CHAT, SCORED, ON REAL PROJECTS: THE ROUTER AND ITS ROADS AGAINST THE ONE LOOP, THE SAME CASES, THE SAME BRAIN.
 *
 *   npx tsx e2e/xode-eval.ts [--only desktop|backend] [--cap 30] [--out e2e/out/xode-eval.md]
 *
 * Each project's brain is built once with real models (as when a person connects the repo; its history, pull requests and issues read from the
 * real repo on api.github.com), the owner's three answers are given to its book, and every case is asked through the front door twice: with the
 * router (agentChat off) and with the one loop (agentChat on). A job is recorded, not run (the code_job road is a stub here): what is scored is
 * that it was started, with what task.
 *
 * A case passes when every check does:
 *   did        what Xode did: answered, started a job, or asked back
 *   says       what the answer must say (each pattern), from the project's real code and history
 *   max        at most this long (a "thanks" is a line)
 *   paths      every file path it names is one the project has
 *   clean      none of its own machinery in the words (<project>, "the brief", "tool call")
 * and it did not fail. The report has each case's verdict, cost and time for both, and the answers.
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRig, USER, type Rig } from "./adapters/rig.js";
import { proxyAwareFetch } from "./fetch.js";
import { createFront } from "../src/front/index.js";
import type { FrontCtx, FrontResult, Turn } from "../src/front/types.js";
import { MemoryThreadStore } from "../src/code/chat/threads.js";

const arg = (name: string, d = ""): string => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const ONLY = arg("only");
const CAP_PAISE = Math.round(Number(arg("cap", "30")) * 100);
const OUT = arg("out", path.join("e2e", "out", "xode-eval.md"));
/** Which ways to ask: both (the default), or only one ("router" or "loop"). */
const MODES = (arg("modes", "router,loop").split(",").filter((m) => m === "router" || m === "loop")) as Array<"router" | "loop">;
/** Only these cases (their ids), when given. */
const CASES = arg("cases") ? new Set(arg("cases").split(",")) : null;

type Did = "answer" | "job" | "ask";
interface Case { id: string; say: string; before?: string[]; did: Did; says?: RegExp[]; max?: number }
interface Project { key: string; repo: string; dir: string; stripDocs: boolean; brainInr: number; owner: { for: string; next: string; keep: string }; cases: Case[] }

const PROJECTS: Project[] = [
  {
    key: "desktop", repo: "chedfox/tailzu-desktop", dir: "/home/user/TAILZU-DESKTOP", stripDocs: true, brainInr: 10,
    owner: {
      for: "People who write all day on Windows and Mac: press one key, speak, and clean text is pasted where they type. It also hosts the X0 bots on the computer.",
      next: "Ship Ask (the on-screen agent) to everyone, and a signed Mac build.",
      keep: "One key press to dictate; nothing leaves the computer without the person's say.",
    },
    cases: [
      { id: "what-for", say: "what is this project, and who is it for?", did: "answer", says: [/dictat/i, /writ/i] },
      { id: "what-next", say: "What should we do", did: "answer", says: [/\bAsk\b/, /\bMac\b/i] },
      { id: "where-hotkey", say: "where is the dictation hotkey registered?", did: "answer", says: [/main\.js/, /globalShortcut/] },
      { id: "where-redact", say: "where does the runner hide secrets in what it sends back?", did: "answer", says: [/runner\/redact\.js/] },
      { id: "why-updater", say: "why doesn't the updater use Electron's own auto-updater?", did: "answer", says: [/Developer ID|sign/i] },
      { id: "recent", say: "what changed lately?", did: "answer", says: [/Store|icon/i] },
      { id: "thanks", say: "thanks!", did: "answer", max: 300 },
      { id: "bare-fix", say: "fix it", did: "ask" },
      { id: "change", say: "make the pill show how long it has been recording", did: "job" },
      { id: "follow-up", before: ["where is the dictation hotkey registered?"], say: "??", did: "answer", says: [/main\.js|globalShortcut|hotkey|key/i] },
    ],
  },
  {
    key: "backend", repo: "chedfox/tailzu-backend", dir: "/home/user/TAILZU-BACKEND", stripDocs: false, brainInr: 15,
    owner: {
      for: "The X0 Bot server: it builds every screen of the phone and desktop apps (server-driven UI) and runs the bots, Xode the coding bot first.",
      next: "Make Xode the best coding bot on cheap models; then the bots platform for everyone.",
      keep: "Screens are built on the server; keys never reach logs or the apps.",
    },
    cases: [
      { id: "what-for", say: "what is this project, and who is it for?", did: "answer", says: [/X0 Bot|server/i, /screen|bots?/i] },
      { id: "what-next", say: "What should we do", did: "answer", says: [/Xode/] },
      { id: "where-book", say: "where is the project book built?", did: "answer", says: [/book\.ts/] },
      { id: "how-cite", say: "how does the chat avoid citing lines it never read?", did: "answer", says: [/cite\.ts|checkCitations|Anchors/] },
      { id: "copy", say: "what does the app say when the daily spend limit is reached?", did: "answer", says: [/used what X0 Bot may spend/i] },
      { id: "recent", say: "what changed lately?", did: "answer", says: [/book|plan|loop|chat/i] },
      { id: "thanks", say: "thanks!", did: "answer", max: 300 },
      { id: "bare-fix", say: "fix it", did: "ask" },
      { id: "change", say: "add a test that bookCard puts the owner's words first", did: "job" },
      // Anything a person may ask of it: a file to copy, setting it up, what the project cannot say.
      { id: "sql-copy", say: "give me the database code for the project book migration, to copy paste", did: "answer", says: [/alter table public\.code_brain add column if not exists book jsonb/] },
      { id: "vps-setup", say: "what commands do I run to set up and deploy the server on my VPS?", did: "answer", says: [/ship\.sh|docker compose|git pull/i], max: 9000 },
      { id: "github-env", say: "what settings does the server need in .env for GitHub?", did: "answer", says: [/GITHUB_APP_/] },
      { id: "route", say: "where is POST /v1/ask handled?", did: "answer", says: [/routes\/front\.ts/] },
      { id: "local", say: "how do I run it on my own computer?", did: "answer", says: [/npm (?:run )?(?:dev|start|install)|npm ci|docker compose/i], max: 9000 },
      { id: "providers", say: "which other model providers could we use instead of OpenRouter? give options", did: "answer", says: [/Together|Groq|Fireworks|DeepInfra|Anthropic|OpenAI|Google|Mistral|DeepSeek|Bedrock|Azure/i] },
    ],
  },
];

const rupees = (p: number): string => `₹${(p / 100).toFixed(2)}`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const PATH = /(?<![\w/.:@-])((?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.(?:js|ts|tsx|jsx|mjs|cjs|json|swift|ps1|py|sql|html|css|md|yml|yaml))(?![\w/])/g;
const LEAK = /<\/?(?:project|chat|map|message|brief|book|facts|excerpts|data)\b|\bthe brief\b|\btool calls?\b|\bmy tools\b/i;

function filesOf(dir: string, stripDocs: boolean): { files: Record<string, string>; all: Set<string>; named: string } {
  const files: Record<string, string> = {};
  const list = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  for (const p of list) {
    if (/(^|\/)(?:e2e\/(?:cache|out|cassettes|results)|node_modules)\//.test(p)) continue;
    if (stripDocs && (/\.(?:md|mdx|rst|txt)$/i.test(p) || /(^|\/)docs?\//i.test(p))) continue;
    let buf: Buffer;
    try { buf = fs.readFileSync(path.join(dir, p)); } catch { continue; }
    if (buf.length > 300_000 || buf.includes(0)) continue;
    files[p] = buf.toString("utf8");
  }
  // A path the code itself names is real too, though not in the repo (config.json in the app's data folder, read at main.js:82).
  return { files, all: new Set(Object.keys(files)), named: Object.values(files).join("\n") };
}

interface Verdict { did: Did | "failed"; checks: Array<[string, boolean]>; pass: boolean; paise: number; ms: number; calls: number; text: string; job?: string }

function judge(c: Case, r: FrontResult | null, error: string, all: Set<string>, inCode: string, jobTask: string | undefined): Omit<Verdict, "paise" | "ms" | "calls"> {
  if (!r) return { did: "failed", checks: [["no failure", false]], pass: false, text: error };
  const did: Did = r.job ? "job" : r.clarify ? "ask" : "answer";
  const text = r.clarify ? `${r.clarify.question} [${r.clarify.options.join(" | ")}]` : r.text ?? "";
  const checks: Array<[string, boolean]> = [[`did ${c.did}`, did === c.did]];
  if (c.did === "answer") checks.push(["not empty", text.trim().length > 0]);
  for (const re of c.says ?? []) checks.push([`says ${re.source}`, re.test(text)]);
  if (c.max) checks.push([`at most ${c.max} chars`, text.length <= c.max]);
  const named = [...text.matchAll(PATH)].map((m) => m[1]!.replace(/^\.\//, ""));
  const ends = (p: string): boolean => all.has(p) || [...all].some((f) => f.endsWith(`/${p}`)) || inCode.includes(p);
  const wrong = named.filter((p) => !ends(p));
  checks.push([`paths real${wrong.length ? ` (not: ${[...new Set(wrong)].slice(0, 3).join(", ")})` : ""}`, !wrong.length]);
  checks.push(["clean", !LEAK.test(text)]);
  return { did, checks, pass: checks.every(([, ok]) => ok), text, ...(jobTask ? { job: jobTask } : {}) };
}

async function runProject(p: Project, lines: string[], totals: Record<string, { pass: number; n: number; paise: number; ms: number }>): Promise<void> {
  const out = (s = ""): void => { lines.push(s); console.log(s); };
  const { files, all, named } = filesOf(p.dir, p.stripDocs);
  const rig: Rig = await createRig({ mode: "real", brainBudgetPaise: p.brainInr * 100, room: false, log: (m) => { if (/^warn /.test(m)) console.error(m); } });
  try {
    const gh = rig.code.github as unknown as { rsend: (repo: unknown, method: string, url: string, body?: unknown, o?: unknown) => Promise<unknown> };
    const local = gh.rsend.bind(gh);
    const live = proxyAwareFetch();
    gh.rsend = async (repo, method, url, body, o) => {
      const m = /\/repos\/[^/]+\/[^/]+\/((?:issues|pulls|milestones|commits)(?:[/?].*)?)$/.exec(url);
      if (method !== "GET" || !m) return local(repo, method, url, body, o);
      const rest = m[1]!.replace(/([?&])sha=[^&]*/, "$1sha=main");
      const res = await live(`https://api.github.com/repos/${p.repo}/${rest}`, { headers: { accept: "application/vnd.github+json", "user-agent": "x0bot-eval" } });
      return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
    };
    const short = p.repo.split("/")[1]!;
    const t0 = Date.now();
    const h = await rig.addProjectFor({ id: short, repo: "synthetic", base: { files }, checks: {}, oracle: {} } as never, short);
    const brain = await rig.code.brain!.open(USER, h.project.id);
    await brain.answerBook(p.owner);
    const brainPaise = Math.ceil(rig.kit.logs.reduce((n, l) => n + l.paise, 0));
    out(`## ${p.repo}${p.stripDocs ? " (docs stripped)" : ""}`);
    out(`${Object.keys(files).length} files; brain ${rupees(brainPaise)} in ${secs(Date.now() - t0)}; the owner's answers given.`);
    out();

    let jobN = 0;
    let lastTask: string | undefined;
    const stubJob = async (c: { message: string; maxPaise: number }) => {
      jobN += 1;
      lastTask = c.message;
      return { job: { id: `stub-${jobN}`, branch: `xode/stub-${jobN}`, state: "queued", budgetPaise: c.maxPaise }, paise: 0 };
    };
    const threads = new MemoryThreadStore();
    const front = (agentChat: boolean) => createFront({
      force: true, code: rig.code, jobs: rig.jobs, agent: rig.orch, call: rig.kit.call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}),
      threads, personal: async () => [], handlers: { codeJob: stubJob as never }, agentChat,
    })!;
    const modes = { router: front(false), loop: front(true) } as const;
    const spent = (): number => Math.ceil(rig.kit.logs.reduce((n, l) => n + l.paise, 0));

    const ask = async (mode: keyof typeof modes, say: string, threadId: string): Promise<{ r: FrontResult | null; error: string }> => {
      const recent: Turn[] = [];
      const kept = await threads.get(USER, h.project.id, threadId).catch(() => null);
      if (kept?.lastQuestion) recent.push({ said: kept.lastQuestion, did: "code_question" });
      const ctx: FrontCtx = { userId: USER, plan: "paid", device: "desktop", mode: "text", visuals: "off", projectId: h.project.id, threadId, recent, attachments: [] };
      try { return { r: (await modes[mode].ask(say, ctx)).result, error: "" }; } catch (err) { return { r: null, error: (err as Error).message }; }
    };

    const rows: string[] = ["| case | expected | router | loop |", "|---|---|---|---|"];
    const answers: string[] = [];
    for (const c of p.cases.filter((x) => !CASES || CASES.has(x.id))) {
      const v: Partial<Record<keyof typeof modes, Verdict>> = {};
      for (const mode of MODES) {
        if (spent() >= CAP_PAISE) { out(`(stopped: ${rupees(spent())} spent, the cap is ${rupees(CAP_PAISE)})`); return; }
        const threadId = randomUUID();
        for (const b of c.before ?? []) await ask(mode, b, threadId);
        lastTask = undefined;
        const before = rig.kit.logs.length;
        const p0 = spent();
        const at = Date.now();
        const { r, error } = await ask(mode, c.say, threadId);
        const verdict: Verdict = { ...judge(c, r, error, all, named, lastTask), paise: spent() - p0, ms: Date.now() - at, calls: rig.kit.logs.length - before };
        v[mode] = verdict;
        const tot = (totals[mode] ??= { pass: 0, n: 0, paise: 0, ms: 0 });
        tot.n += 1; tot.pass += verdict.pass ? 1 : 0; tot.paise += verdict.paise; tot.ms += verdict.ms;
        console.error(`${p.key}/${c.id} ${mode}: ${verdict.pass ? "PASS" : "FAIL"} ${verdict.did} ${rupees(verdict.paise)} ${secs(verdict.ms)}`);
      }
      const cell = (x: Verdict) => `${x.pass ? "✅" : "❌"} ${x.did}, ${rupees(x.paise)}, ${secs(x.ms)}, ${x.calls} calls${x.pass ? "" : `<br>${x.checks.filter(([, ok]) => !ok).map(([n]) => n).join("; ")}`}`;
      rows.push(`| ${c.id}: "${c.say}" | ${c.did} | ${v.router ? cell(v.router) : "-"} | ${v.loop ? cell(v.loop) : "-"} |`);
      answers.push(`#### ${c.id}: "${c.say}"${c.before ? ` (after "${c.before.join('", "')}")` : ""}`, "");
      for (const mode of MODES) {
        const x = v[mode]!;
        answers.push(`**${mode}** (${x.did}${x.job ? `, task: "${x.job.slice(0, 200)}"` : ""}):`, "", x.text.slice(0, 900).split("\n").map((l) => `> ${l}`).join("\n"), "");
      }
    }
    out(rows.join("\n"));
    out();
    out("### The answers");
    out();
    out(answers.join("\n"));
  } finally {
    await rig.dispose();
  }
}

async function main(): Promise<void> {
  const lines: string[] = [];
  const totals: Record<string, { pass: number; n: number; paise: number; ms: number }> = {};
  lines.push(`# Xode's chat, scored: the router against the one loop (${new Date().toISOString().slice(0, 10)})`, "");
  const body: string[] = [];
  for (const p of PROJECTS.filter((x) => !ONLY || x.key === ONLY)) await runProject(p, body, totals);
  lines.push("| | passed | cost | time |", "|---|---|---|---|");
  for (const [mode, t] of Object.entries(totals)) lines.push(`| ${mode} | ${t.pass} of ${t.n} | ${rupees(t.paise)} | ${secs(t.ms)} |`);
  lines.push("", ...body);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${lines.join("\n")}\n`);
  console.log(`\n${lines.slice(0, 6).join("\n")}\n-> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
