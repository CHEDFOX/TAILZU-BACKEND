/**
 * XODE'S CHAT, SCORED, ON REAL PROJECTS: THE ROUTER AND ITS ROADS AGAINST THE ONE LOOP, THE SAME CASES, THE SAME BRAIN.
 *
 *   npx tsx e2e/xode-eval.ts [--only desktop|backend] [--modes router,loop] [--cases a,b] [--extra e2e/cases/real.jsonl] [--cap 30] [--out e2e/out/xode-eval.md]
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
 *   not        what it must never say (a secret's value)
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
/** Cases from real chats (scripts/xode-cases.ts), one JSON line each; those whose `did` is filled in run with their project's. */
const EXTRA = arg("extra");

type Did = "answer" | "job" | "ask";
interface Case { id: string; say: string; before?: string[]; did: Did; says?: RegExp[]; max?: number; not?: RegExp[] }
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
  // Open projects of other people, in other languages: every question a person might put, of every kind.
  {
    key: "umami", repo: "umami-software/umami", dir: "/home/user/OPEN/umami", stripDocs: false, brainInr: 15,
    owner: {
      for: "Website owners who want simple, privacy-first analytics: no cookies, self-hosted or in the cloud.",
      next: "Make self-hosting easier, then faster reports for big sites.",
      keep: "No cookies and no personal data; one Postgres database is all it needs.",
    },
    cases: [
      { id: "what-for", say: "what is this, in two lines?", did: "answer", says: [/analytics/i, /privacy|cookie/i], max: 1500 },
      { id: "what-next", say: "what should we work on next?", did: "answer", says: [/self-host|setup|report/i] },
      { id: "where-send", say: "where does a pageview from the tracker land on the server?", did: "answer", says: [/api\/send\/route\.ts/] },
      { id: "how-bots", say: "how does it keep bots out of the stats?", did: "answer", says: [/isbot/, /DISABLE_BOT_CHECK/] },
      { id: "error", say: "my events are rejected with 'Website not found.' what causes that?", did: "answer", says: [/send\/route\.ts|fetchWebsite/, /website ?id|websiteId/i] },
      { id: "ui-copy", say: "what warning does it show before deleting a team?", did: "answer", says: [/also delete all team websites/i] },
      { id: "security", say: "is it safe to expose the collect endpoint publicly? what stops abuse?", did: "answer", says: [/isbot|IGNORE_IP|hasBlockedIp|bot/i] },
      { id: "env", say: "what env settings must I set for production?", did: "answer", says: [/DATABASE_URL/, /APP_SECRET/] },
      { id: "local", say: "how do I run it on my laptop?", did: "answer", says: [/pnpm (?:install|run dev|dev|i\b)/], max: 9000 },
      { id: "docker", say: "give me the commands to run it with docker on a VPS", did: "answer", says: [/docker compose|docker-compose/i], max: 9000 },
      { id: "file-copy", say: "show me the prisma model for websites, I want to copy it", did: "answer", says: [/model Website \{/] },
      { id: "sql", say: "write a SQL query for pageviews per day for one website over the last 30 days", did: "answer", says: [/website_event/, /group by/i] },
      { id: "impact", say: "what breaks if I rename the SALT_ROTATION setting?", did: "answer", says: [/send\/route\.ts|getSalt/] },
      { id: "hinglish", say: "salt rotation kaise kaam karta hai?", did: "answer", says: [/getSalt|SALT_ROTATION/] },
      { id: "hindi", say: "ट्रैकर स्क्रिप्ट का कोड कहाँ है?", did: "answer", says: [/src\/tracker\/index\.ts/] },
      { id: "tests", say: "how do I run the tests?", did: "answer", says: [/pnpm (?:run )?test|vitest/] },
      { id: "research", say: "which managed postgres could host its database? options with rough prices", did: "answer", says: [/Neon|Supabase|RDS|Railway|Render|DigitalOcean|Aiven/i] },
      { id: "estimate", say: "how big a job would it be to add Slack alerts when traffic spikes?", did: "answer", says: [/src\//] },
      { id: "chat-midway", before: ["where does a pageview from the tracker land on the server?"], say: "nice. btw I'm new to Next.js, is that a problem for working on this?", did: "answer" },
      { id: "follow-up", before: ["where does a pageview from the tracker land on the server?"], say: "??", did: "answer", says: [/send/] },
      { id: "change", say: "add an env setting DISABLE_IP_BLOCK that skips the IP block check in the send route", did: "job" },
      { id: "handoff", before: ["the bot check lets headless chrome through; how would we also block it?"], say: "ok make that change", did: "job" },
      { id: "bare-fix", say: "fix it", did: "ask" },
      { id: "thanks", say: "thanks, that was quick", did: "answer", max: 400 },
    ],
  },
  {
    key: "fastapi", repo: "fastapi/full-stack-fastapi-template", dir: "/home/user/OPEN/full-stack-fastapi-template", stripDocs: false, brainInr: 10,
    owner: {
      for: "Developers starting a full-stack web app: a FastAPI backend, a React frontend, Postgres and Docker, ready to deploy.",
      next: "Keep it current with FastAPI and React releases, and make deploying it simpler.",
      keep: "Secure defaults: no default secrets in production, hashed passwords, JWT.",
    },
    cases: [
      { id: "what-for", say: "what does this template give me?", did: "answer", says: [/FastAPI/, /React/] },
      { id: "login-flow", say: "how does login work, from the form to the token?", did: "answer", says: [/login\.py|login_access_token/, /create_access_token|security\.py/] },
      { id: "error", say: "I get 'Inactive user' when logging in, why?", did: "answer", says: [/is_active/] },
      { id: "secret-check", say: "the backend won't start and says the SECRET_KEY is \"changethis\". why, and what do I do?", did: "answer", says: [/_check_default_secret|config\.py/, /openssl|secrets\.token|random|generate/i] },
      { id: "secret-file", say: "show me the .env file", did: "answer", not: [/FIRST_SUPERUSER_PASSWORD=changethis/, /POSTGRES_PASSWORD=changethis/] },
      { id: "data-model", say: "how are users and items related in the database?", did: "answer", says: [/owner_id/, /cascade/i] },
      { id: "migration", say: "how do I add a new column and make a migration for it?", did: "answer", says: [/alembic/i, /revision/] },
      { id: "curl", say: "write curl commands to log in and then list my items", did: "answer", says: [/curl/, /login\/access-token/, /items/] },
      { id: "pagination", say: "how does the items list paginate?", did: "answer", says: [/skip/, /limit/] },
      { id: "local", say: "how do I run it locally?", did: "answer", says: [/docker compose (?:watch|up)/], max: 9000 },
      { id: "deploy", say: "deploy it to my own server with docker, step by step", did: "answer", says: [/compose\.deploy\.yml|docker compose -f/], max: 9000 },
      { id: "tests", say: "how do I run the backend tests?", did: "answer", says: [/scripts\/test\.sh|pytest/] },
      { id: "ci", say: "what does CI check on a pull request?", did: "answer", says: [/test-backend|playwright|pre-commit/i] },
      { id: "emails", say: "how are password reset emails sent, and how can I see them locally?", did: "answer", says: [/mailpit/i] },
      { id: "hinglish", say: "naya API endpoint kaise add karu?", did: "answer", says: [/routes|api\/main\.py|APIRouter/] },
      { id: "hindi", say: "पासवर्ड कैसे सुरक्षित रखे जाते हैं?", did: "answer", says: [/hash|bcrypt|argon|pwdlib|security\.py/i] },
      { id: "research", say: "should I use FastAPI Cloud or a VPS for this? compare them", did: "answer", says: [/FastAPI Cloud/, /VPS|server/i] },
      { id: "plan", say: "plan adding teams, where users share items", did: "answer", says: [/models\.py/] },
      { id: "follow-up", before: ["how does login work, from the form to the token?"], say: "and where is the token checked on each request?", did: "answer", says: [/deps\.py|get_current_user/] },
      { id: "reaction", before: ["I get 'Inactive user' when logging in, why?"], say: "??", did: "answer", says: [/is_active|Inactive/] },
      { id: "change", say: "add a search query parameter to the items list that filters by title", did: "job" },
      { id: "handoff", before: ["how would we make access tokens expire after 1 day instead of 8?"], say: "ok do it", did: "job" },
      { id: "bare-fix", say: "please fix the bug", did: "ask" },
      { id: "casual", say: "you're fast lol", did: "answer", max: 400 },
    ],
  },
  {
    key: "pocketbase", repo: "pocketbase/pocketbase", dir: "/home/user/OPEN/pocketbase", stripDocs: false, brainInr: 15,
    owner: {
      for: "Developers who want a whole backend in one file: database, auth, files, realtime and an admin UI.",
      next: "Reach v1.0 with a stable API, and keep the binary small.",
      keep: "One portable executable; pure Go SQLite, no CGO.",
    },
    cases: [
      { id: "what-for", say: "what is pocketbase?", did: "answer", says: [/SQLite/, /realtime|auth|admin/i] },
      { id: "realtime", say: "how do realtime subscriptions work under the hood?", did: "answer", says: [/realtime\.go/, /event-stream|SSE|PB_CONNECT/i] },
      { id: "rate-limit", say: "is there rate limiting? where is it?", did: "answer", says: [/middlewares_rate_limit\.go|rateLimit/] },
      { id: "error", say: "users get 'Failed to authenticate.' where does that come from?", did: "answer", says: [/record_auth_with_password\.go/] },
      { id: "superuser", say: "how do I create a superuser from the command line?", did: "answer", says: [/superuser (?:upsert|create)/] },
      { id: "go-route", say: "how do I add my own route in Go?", did: "answer", says: [/OnServe/, /Router/] },
      { id: "js-hooks", say: "can I extend it with JavaScript? where do the files go?", did: "answer", says: [/pb_hooks/] },
      { id: "build", say: "how do I build a linux binary from the repo?", did: "answer", says: [/CGO_ENABLED=0/, /GOOS=linux|examples\/base/] },
      { id: "vps", say: "how should I run it on a VPS with https?", did: "answer", says: [/serve/, /https|Caddy|nginx|reverse proxy/i], max: 9000 },
      { id: "hooks-flow", say: "what happens when a record is created, which hooks run?", did: "answer", says: [/OnRecordCreate/] },
      { id: "mfa", say: "how does MFA work here?", did: "answer", says: [/mfa/i] },
      { id: "backup", say: "where is the data stored and how do I back it up?", did: "answer", says: [/pb_data/, /backup/i] },
      { id: "impact", say: "what would break if I changed the rate limit middleware's priority?", did: "answer", says: [/priority/i] },
      { id: "go-version", say: "which Go version do I need?", did: "answer", says: [/1\.27/] },
      { id: "hinglish", say: "realtime ka code kaha hai?", did: "answer", says: [/realtime\.go/] },
      { id: "hindi", say: "सुपरयूज़र कैसे बनाऊँ?", did: "answer", says: [/superuser/] },
      { id: "compare", say: "pocketbase or supabase for a small app? be honest", did: "answer", says: [/Supabase/, /SQLite|Postgres/i] },
      { id: "sdk", say: "write JS code to log a user in with email and password", did: "answer", says: [/authWithPassword/] },
      { id: "tests", say: "how do I run the tests?", did: "answer", says: [/go test/] },
      { id: "newcomer", say: "this codebase is big, where should a beginner start reading?", did: "answer", says: [/core|apis|examples\/base/] },
      { id: "reaction", before: ["how do realtime subscriptions work under the hood?"], say: "??", did: "answer", says: [/realtime|SSE|event/i] },
      { id: "change", say: "make the health endpoint also return the app version", did: "job" },
      { id: "bare-fix", say: "fix it", did: "ask" },
      { id: "thanks", say: "great, thanks!", did: "answer", max: 400 },
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
  for (const re of c.not ?? []) checks.push([`never says ${re.source}`, !re.test(text)]);
  if (c.max) checks.push([`at most ${c.max} chars`, text.length <= c.max]);
  const named = [...text.matchAll(PATH)].map((m) => m[1]!.replace(/^\.\//, ""));
  const ends = (p: string): boolean => all.has(p) || [...all].some((f) => f.endsWith(`/${p}`)) || inCode.includes(p);
  const wrong = named.filter((p) => !ends(p));
  checks.push([`paths real${wrong.length ? ` (not: ${[...new Set(wrong)].slice(0, 3).join(", ")})` : ""}`, !wrong.length]);
  checks.push(["clean", !LEAK.test(text)]);
  return { did, checks, pass: checks.every(([, ok]) => ok), text, ...(jobTask ? { job: jobTask } : {}) };
}

/** The labelled lines of an --extra file, as cases of the project with that repo. */
function extraCases(repo: string): Case[] {
  if (!EXTRA) return [];
  return fs.readFileSync(EXTRA, "utf8").split("\n").filter((l) => l.trim()).flatMap((l): Case[] => {
    const x = JSON.parse(l) as { id: string; repo: string; before?: string[]; say: string; did: string; says?: string[]; max?: number };
    if (x.repo !== repo || !["answer", "job", "ask"].includes(x.did)) return [];
    return [{ id: x.id, say: x.say, did: x.did as Did, ...(x.before?.length ? { before: x.before } : {}), ...(x.says?.length ? { says: x.says.map((w) => new RegExp(w, "i")) } : {}), ...(x.max ? { max: x.max } : {}) }];
  });
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
    for (const c of [...p.cases, ...extraCases(p.repo)].filter((x) => !CASES || CASES.has(x.id))) {
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
        // --trace: each model call of the case, to see where the money went.
        if (process.argv.includes("--trace")) for (const l of rig.kit.logs.slice(before)) console.error(`  ${l.purpose} ${l.tier ?? "-"} ${l.model} ${rupees(l.paise)} in ${l.promptTokens} out ${l.completionTokens}${l.ok ? "" : ` FAILED ${l.why ?? l.error ?? ""}`}`);
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
