/**
 * Xode at work in the Bots app (screens/codeWork.ts): the live job and its chat, the team, a design and its preview,
 * attaching, done and failed, on the routes' own answers (bots-codework-data.ts), for the phone and the window.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ActionSpec, Node } from "../shared/types/sdui.js";
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { fakeDeps, IST } from "../src/experience/bots/fixtures.js";
import { setSpendSource } from "../src/experience/bots/live.js";
import { lintTree, walk } from "../src/experience/bots/lint.js";
import { threadFor } from "../src/experience/bots/screens/codeWork.js";
import { citations, flowOf, outline, plainWords, stageOf, testCount, tries, visibleParts, workLines } from "../src/botsCodeWork/read.js";
import { ART, CODEWORK_API, JOB_ANSWER, JOB_ASK, JOB_DONE, JOB_FAILED, JOB_LEAD, PROJECT } from "./bots-codework-data.js";

type Client = "phone" | "desktop";

/** The usage meter every screen reads (ctx.live.usage): Lite or Elite, used in stretches, or the free plan's month with none. */
const meter = (windows: boolean) =>
  setSpendSource(async () => ({ limitPaise: 50_000, monthPaise: 1000, usage: { used: 0.1, month: 0.05, state: "ok" as const, resetsAt: null, windows } }));
afterEach(() => setSpendSource(null));

async function build(screenId: string, client: Client, params: Record<string, string> = {}, api: Record<string, unknown> = CODEWORK_API) {
  const calls: Array<{ method: string; path: string }> = [];
  const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: "00000000-0000-4000-8000-00000000aaaa" }, can: new Set(["BotsKit"]), desk: { pages: false, notes: false } },
    fakeDeps({ jobs: [], tasks: [], api, calls }));
  return { s, calls, words: walk(s.root!).map((n) => String(n.props?.content ?? "")).filter(Boolean) };
}

/** Every action reachable from a tree (on.onPress / onSubmit, and the actions inside sequences and conditions). */
function actionsOf(root: Node): ActionSpec[] {
  const out: ActionSpec[] = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const x = a as ActionSpec & Record<string, unknown>;
    out.push(x);
    for (const k of ["actions"]) if (Array.isArray(x[k])) (x[k] as unknown[]).forEach(visit);
    for (const k of ["then", "else", "onSuccess", "onError"]) visit(x[k]);
  };
  for (const n of walk(root)) for (const a of Object.values(n.on ?? {})) visit(a);
  return out;
}
const posts = (root: Node) => actionsOf(root).filter((a): a is Extract<ActionSpec, { kind: "callEndpoint" }> => a.kind === "callEndpoint");

const SCREENS_WITH_PARAMS: Array<[string, Record<string, string>]> = [
  ["bots.code.job", { id: JOB_ASK }], ["bots.code.job", { id: JOB_ANSWER }], ["bots.code.job", { project: PROJECT }],
  ["bots.code.job", { id: JOB_DONE }], ["bots.code.team", { id: JOB_LEAD }], ["bots.code.design", { id: ART, job: JOB_DONE }],
  ["bots.code.preview", { id: ART }], ["bots.attach", { id: JOB_ASK }], ["bots.done", { id: JOB_DONE }], ["bots.failed", { id: JOB_FAILED }],
];

describe("bots app · Xode at work", () => {
  it("every screen builds on real answers for both clients and keeps the kit's rules", async () => {
    for (const [id, params] of SCREENS_WITH_PARAMS) {
      for (const client of ["phone", "desktop"] as const) {
        const { s } = await build(id, client, params);
        expect(lintTree(s.root!), `${id} ${client} ${JSON.stringify(params)}`).toEqual([]);
        expect(s.cacheTtlSeconds).toBe(0);
      }
    }
  });

  it("a job that can't be read, or a missing id, is an honest page, never a crash", async () => {
    for (const id of ["bots.code.job", "bots.code.team", "bots.done", "bots.failed", "bots.code.design", "bots.code.preview"]) {
      const { s, words } = await build(id, "phone", { id: "7c1d2e3f-0000-4000-8000-0000000000ff" }, {});
      expect(lintTree(s.root!)).toEqual([]);
      expect(words.join(" ")).toMatch(/Couldn't open|Nothing to preview/);
    }
    const { words } = await build("bots.code.job", "phone", { id: "../../v1/admin" }, CODEWORK_API);
    expect(words.join(" ")).toContain("Couldn't open this job");
  });

  it("watch it work: the stages, what it did, the one quick question that answers the job, how much of its share it used (never an amount), stop", async () => {
    const { s, words } = await build("bots.code.job", "phone", { id: JOB_ASK });
    for (const w of ["Fix cart total rounding", "Needs you", "Build", "Read src/cart/total.ts".replace("src/", ""), "Edited cart/total.ts", "Ran 18 tests · 17 pass",
      "Waiting for your answer", "Quick question", "Round each item's price, or round once at the end? Your invoices round each item.", "Each item", "At the end", "Of what it was given", "14% used", "Stop"]) {
      expect(words, w).toContain(w);
    }
    expect(words.join(" ")).not.toMatch(/₹/);
    const p = posts(s.root!);
    expect(p.find((a) => a.path === `/v1/code/jobs/${JOB_ASK}/answer`)?.body).toEqual({ answer: "Each item" });
    expect(p.some((a) => a.path === `/v1/code/jobs/${JOB_ASK}/stop`)).toBe(true);
    // a write is followed by the screen read again
    expect(actionsOf(s.root!).some((a) => a.kind === "refresh")).toBe(true);
  });

  it("a yes, keep going, paid compute: each wait has its own choices, and a yes the server asks about is said again with its id", async () => {
    const base = CODEWORK_API[`GET /v1/code/jobs/${JOB_ASK}`] as { job: Record<string, unknown>; agent: Record<string, unknown> };
    const variant = (job: Record<string, unknown>, agent: Record<string, unknown>) => ({ ...CODEWORK_API, [`GET /v1/code/jobs/${JOB_ASK}`]: { ...base, job: { ...base.job, ...job }, agent: { ...base.agent, ...agent } } });
    const yes = await build("bots.code.job", "phone", { id: JOB_ASK }, variant({ waitingOn: "approval" }, { phase: "plan", waiting: { kind: "approval", action: "job.plan", summary: {} }, plan: { risk: "low", steps: [{ n: 1, do: "Round each line", files: [] }] } }));
    expect(yes.words).toEqual(expect.arrayContaining(["Needs your yes", "Go ahead with this plan?", "1. Round each line", "Yes, go ahead", "No"]));
    const approve = posts(yes.s.root!).filter((a) => a.path === `/v1/code/jobs/${JOB_ASK}/approve`);
    expect(approve.map((a) => a.body)).toEqual([{}, { approvalId: "$state.yes.approvalId" }]);
    expect(posts(yes.s.root!).some((a) => a.path === `/v1/code/jobs/${JOB_ASK}/deny`)).toBe(true);
    const budget = variant({ waitingOn: "budget", spentPaise: 3000 }, { waiting: { kind: "budget" }, report: { outcome: "budget", text: "Out of money", costPaise: 3000, continueWithPaise: 1500 } });
    meter(true);
    const money = await build("bots.code.job", "desktop", { id: JOB_ASK }, budget);
    expect(money.words).toEqual(expect.arrayContaining(["This job has used a lot of this stretch. Keep going?", "Keep going"]));
    // The free plan has no stretches: the same ask says this month, and nothing on the screen says stretch.
    meter(false);
    const free = await build("bots.code.job", "desktop", { id: JOB_ASK }, budget);
    expect(free.words).toEqual(expect.arrayContaining(["This job has used a lot of this month. Keep going?", "Keep going"]));
    expect(free.words.join(" ")).not.toMatch(/stretch/i);
    expect(money.words.join(" ")).not.toMatch(/₹/);
    expect(posts(money.s.root!).find((a) => a.path === `/v1/code/jobs/${JOB_ASK}/budget`)?.body).toEqual({ addPaise: 1500 });
    const paid = await build("bots.code.job", "phone", { id: JOB_ASK }, variant({ waitingOn: "paid", reason: "No computer of yours is online." }, { waiting: undefined }));
    expect(paid.words).toContain("No computer of yours is online.");
    expect(posts(paid.s.root!).some((a) => a.path === `/v1/code/jobs/${JOB_ASK}/compute-ok`)).toBe(true);
    for (const v of [yes, money, paid]) expect(lintTree(v.s.root!)).toEqual([]);
  });

  it("the window draws the chat beside the live job; a word to a waiting job is its answer", async () => {
    const { s, words } = await build("bots.code.job", "desktop", { id: JOB_ASK });
    for (const w of ["storefront", "Fix cart total rounding", "Quick question", "Running on this computer"]) expect(words, w).toContain(w);
    const field = walk(s.root!).find((n) => n.type === "TextField" && n.id === "msg")!;
    expect(field.props?.placeholder).toBe("Ask about the code, or tell Xode what to change…");
    expect(posts(s.root!).some((a) => a.path === `/v1/code/jobs/${JOB_ASK}/answer` && (a.body as Record<string, unknown>).answer === "$state.msg")).toBe(true);
  });

  it("a job that was a question is the chat: the answer, the files and lines it rests on, change it, ask again through the front door", async () => {
    const { s, words } = await build("bots.code.job", "phone", { id: JOB_ANSWER, asked: "Where is the cookie set?", answer: "In `lib/session.ts:42`." });
    for (const w of ["Xode", "storefront", "How does sign-in work here?", "app/api/auth/route.ts:9", "lib/session.ts:42", "Where is the cookie set?", "Change something here", "Show the code"]) {
      expect(words, w).toContain(w);
    }
    const ask = posts(s.root!).filter((a) => a.path === "/v1/ask");
    expect(ask.length).toBeGreaterThan(0);
    expect(ask[0]!.body).toMatchObject({ projectId: PROJECT, threadId: JOB_ANSWER, device: "phone", mode: "text" });
  });

  it("a project's chat with no job keeps one thread per person and project", async () => {
    const { s, words } = await build("bots.code.job", "phone", { project: PROJECT });
    expect(words).toContain("Ask anything about your code.");
    const t = threadFor("00000000-0000-4000-8000-00000000aaaa", PROJECT);
    expect(t).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(threadFor("00000000-0000-4000-8000-00000000aaaa", PROJECT)).toBe(t);
    // The words go up as the person's bubble and the box clears first; the call sends them from there (askMoment.ts).
    expect(posts(s.root!).find((a) => a.path === "/v1/ask")?.body).toMatchObject({ threadId: t, message: "$state.sent" });
  });

  it("a job's page keeps its chat too: the project chat it was asked from above it, and every follow-up after it", async () => {
    const FROM = "34343434-3434-4434-8434-343434343434";
    const api = {
      ...CODEWORK_API,
      [`GET /v1/code/projects/${PROJECT}/chat?thread=${JOB_ANSWER}`]: { thread: JOB_ANSWER, turns: [{ q: "Where is the cookie set?", a: "In lib/session.ts:42.", at: 1 }, { q: "??", a: "Simply: the session file sets it.", at: 2 }] },
      [`GET /v1/code/projects/${PROJECT}/chat?thread=${FROM}`]: { thread: FROM, turns: [{ q: "What is this project?", a: "A storefront.", at: 0 }] },
    };
    for (const client of ["phone", "desktop"] as const) {
      const { s, words } = await build("bots.code.job", client, { id: JOB_ANSWER, from: FROM, asked: "??", answer: "Simply: the session file sets it." }, api);
      for (const w of ["What is this project?", "A storefront.", "How does sign-in work here?", "Where is the cookie set?", "In lib/session.ts:42.", "??", "Simply: the session file sets it."]) {
        expect(words, `${client} ${w}`).toContain(w);
      }
      expect(words.filter((w) => w === "??"), "the turn just asked is drawn once").toHaveLength(1);
      // A follow-up from here keeps the chat it came from.
      expect(actionsOf(s.root!).some((a) => a.kind === "navigate" && (a as { params?: Record<string, string> }).params?.from === FROM)).toBe(true);
    }
  });

  it("a project's chat keeps what came before: the last turns in full, the older ones folded, a new chat on its own thread", async () => {
    const LATEST = "12121212-1212-4212-8212-121212121212";
    const turns = Array.from({ length: 6 }, (_, i) => ({ q: `Question ${i}`, a: `## Answer ${i}\n- point ${i}`, at: i }));
    const api = { ...CODEWORK_API, [`GET /v1/code/projects/${PROJECT}/chat`]: { thread: LATEST, turns } };
    for (const client of ["phone", "desktop"] as const) {
      // Back on the chat, the earlier questions are there: the last four in full, the two before them behind "Show 2 earlier questions".
      const { s, words } = await build("bots.code.job", client, { project: PROJECT, asked: "Question 5", answer: "## Answer 5\n- point 5" }, api);
      for (const w of ["Question 2", "Answer 3", "· point 4", "Question 5", "Show 2 earlier questions", "Question 0", "New chat"]) expect(words, `${client} ${w}`).toContain(w);
      expect(words.filter((w) => w === "Question 5"), "the turn just asked is drawn once").toHaveLength(1);
      // The chat goes on in the latest thread, and "New chat" opens a thread of its own.
      expect(posts(s.root!).find((a) => a.path === "/v1/ask")?.body).toMatchObject({ threadId: LATEST });
      const fresh = actionsOf(s.root!).find((a) => a.kind === "navigate" && (a as { params?: Record<string, string> }).params?.thread && (a as { params?: Record<string, string> }).params!.thread !== LATEST);
      expect(fresh, client).toBeTruthy();
    }
  });

  it("the team: lead and helpers, each part's stop, how much of the job each used (no amounts), stop all", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s, words } = await build("bots.code.team", client, { id: JOB_LEAD });
      for (const w of ["Checkout redesign", "Xode · lead", "Helper · Checkout UI", "Helper · Orders API", "Joining the parts on one branch", "Stop all"]) expect(words, `${client} ${w}`).toContain(w);
      expect(words.join(" ")).toMatch(/of the job/);
      expect(words.join(" ")).not.toMatch(/₹/);
      const p = posts(s.root!);
      expect(p.some((a) => a.path === `/v1/code/jobs/${JOB_LEAD}/stop`)).toBe(true);
      if (client === "phone") expect(p.some((a) => a.path === `/v1/code/jobs/${JOB_LEAD}/team/parts/1/stop`)).toBe(true);
    }
  });

  it("done: shipped, the pull request, the real numbers, the week", async () => {
    const { s, words } = await build("bots.done", "phone", { id: JOB_DONE });
    for (const w of ["Shipped.", "PR #128 is ready · all checks pass", "3", "18", "18m", "Review the PR", "3 shipped this week"]) expect(words, w).toContain(w);
    expect(words.join(" ")).not.toMatch(/₹|cost/);
    expect(actionsOf(s.root!).some((a) => a.kind === "openUrl" && a.url === "https://github.com/aanya-sharma/storefront/pull/128")).toBe(true);
    const desk = await build("bots.done", "desktop", { id: JOB_DONE });
    for (const w of ["What changed", "src/cart/total.ts", "Rounds each line before adding"]) expect(desk.words, w).toContain(w);
    expect(desk.words.join(" ")).not.toMatch(/₹/);
  });

  it("failed: what it tried and how long; try again deeper on the same branch, tell me more, stop here", async () => {
    meter(false);
    expect((await build("bots.failed", "phone", { id: JOB_FAILED })).words).toContain("It checks with you before it uses a lot of this month.");
    meter(true);
    const { s, words } = await build("bots.failed", "phone", { id: JOB_FAILED });
    for (const w of ["Couldn't finish: tests fail on Node 18", "What it tried · 3 tries", "Replaced toSorted() with copy and sort", "2 still failing · receipt dates",
      "How long it worked", "Try again with deeper thinking", "It checks with you before it uses a lot of this stretch.", "Tell me more", "Stop here"]) expect(words, w).toContain(w);
    expect(words.join(" ")).not.toMatch(/₹/);
    const retry = posts(s.root!).find((a) => a.path === "/v1/code/jobs")!;
    expect(retry.body).toMatchObject({ projectId: PROJECT, branch: "checkout-redesign", budgetPaise: 1500 });
    expect(String((retry.body as Record<string, unknown>).task)).toContain("Tests fail on Node 18.");
    const desk = await build("bots.failed", "desktop", { id: JOB_FAILED });
    expect(desk.words).toContain("TypeError: lines.toSorted is not a function");
    expect(actionsOf(desk.s.root!).some((a) => a.kind === "copyText")).toBe(true);
  });

  it("a design: its parts carry the viewer's element ids, a change goes to that part, build it into the app", async () => {
    const { s, words } = await build("bots.code.design", "phone", { id: ART });
    for (const w of ["Pricing card", "In your app's style · version 3", "Starter", "₹299", "Choose Pro", "Build it into my app"]) expect(words, w).toContain(w);
    const picks = actionsOf(s.root!).filter((a) => a.kind === "setState" && a.path === "sel").map((a) => (a as { value: string }).value);
    expect(picks).toContain("5:86"); // the <button> of the Pro card: line 5, column 86
    const p = posts(s.root!);
    expect(p.find((a) => a.path === `/v1/artifacts/${ART}/edit`)?.body).toEqual({ instruction: "$state.change", elementId: "$state.sel" });
    expect(p.find((a) => a.path === `/v1/artifacts/${ART}/build`)?.body).toEqual({ projectId: PROJECT, version: 3 });
  });

  it("the preview: versions to go back to, point to change", async () => {
    const { s, words } = await build("bots.code.preview", "desktop", { id: ART });
    for (const w of ["Live preview", "Versions", "v3 · now", "Added the Team plan", "Go back", "What should change?"]) expect(words, w).toContain(w);
    expect(posts(s.root!).find((a) => a.path === `/v1/artifacts/${ART}/revert`)?.body).toEqual({ version: 2 });
  });

  it("attach: the person's recent files go to Xode as refs, with the message", async () => {
    const { s, words } = await build("bots.attach", "phone", { id: JOB_ASK });
    for (const w of ["Add to chat", "Recent", "redmi-booking.png", "Price list.pdf", "Link", "Voice note", "Xode reads designs, PDFs and videos"]) expect(words, w).toContain(w);
    const set = actionsOf(s.root!).find((a) => a.kind === "setState" && a.path === "atts") as { value: unknown[] };
    expect(set.value[0]).toEqual({ id: "f0000000-0000-4000-8000-000000000001", kind: "image", mime: "image/png", bytes: 655360, sha256: "a".repeat(64), name: "redmi-booking.png" });
    expect(posts(s.root!).find((a) => a.path === "/v1/ask")?.body).toMatchObject({ attachments: "$state.atts", threadId: JOB_ASK, projectId: PROJECT });
  });
});

describe("bots app · reading Xode's work", () => {
  it("outline: the parts of html and JSX with the viewer's line:col ids", () => {
    const html = "<div>\n  <h1>Hi</h1>\n  <button class=\"x\">Book</button>\n</div>";
    const parts = outline(html);
    expect(parts[0]!.id).toBe("1:1");
    expect(parts[0]!.kids.map((k) => [k.id, k.kind, k.text])).toEqual([["2:3", "Heading", "Hi"], ["3:3", "Button", "Book"]]);
    const jsx = "export default function Card({ n }: { n: number }) {\n  const ok = n < 3;\n  return (\n    <section>\n      <p>{n} left</p>\n      <PriceTag value={n > 1 ? 2 : 1} />\n    </section>\n  );\n}";
    const j = outline(jsx);
    expect(j.map((p) => p.id)).toEqual(["4:5"]);
    expect(j[0]!.kids.map((k) => [k.id, k.kind, k.text])).toEqual([["5:7", "Text", "left"], ["6:7", "PriceTag", ""]]);
    expect(visibleParts(outline("<html><body><div><p>One</p></div></body></html>")).map((p) => p.text)).toEqual(["One"]);
    expect(outline("<style>p{color:red}</style><p>a</p>").map((p) => p.text)).toEqual(["a"]);
  });

  it("the flow, the citations and the words of an answer", () => {
    const m = 'flowchart TD\n  N1["app/login/page.tsx<br/>LoginPage"]\n  N2["app/api/auth/route.ts"]\n  N3["lib/session.ts"]\n  N2 --> N3\n  N1 --> N2';
    expect(flowOf(m)).toEqual(["app/login/page.tsx", "app/api/auth/route.ts", "lib/session.ts"]);
    expect(flowOf("# not a flow")).toEqual([]);
    expect(citations("See `lib/session.ts:42` and (app/api/auth/route.ts:9-12), and lib/session.ts:42 again.")).toEqual(["lib/session.ts:42", "app/api/auth/route.ts:9-12"]);
    expect(plainWords("**Yes.** It's in `a.ts`.\n\n```ts\nconst a = 1;\n```")).toEqual([{ kind: "para", text: "Yes. It's in a.ts." }, { kind: "code", text: "const a = 1;" }]);
    // A structured answer reads like a chat: its heading on its own, each bullet on its own line, nothing cut at 8 blocks.
    const md = "Sign-in lives in two places.\n## Where\n- `lib/session.ts:42` keeps it\n  - refreshed hourly\n- **app/api/auth** checks it\n\n**Why it logs out**\nThe refresh failed.";
    expect(plainWords(md)).toEqual([
      { kind: "para", text: "Sign-in lives in two places." },
      { kind: "head", text: "Where" },
      { kind: "para", text: "· lib/session.ts:42 keeps it\n   · refreshed hourly\n· app/api/auth checks it" },
      { kind: "head", text: "Why it logs out" },
      { kind: "para", text: "The refresh failed." },
    ]);
    expect(plainWords(Array.from({ length: 20 }, (_, i) => `Point ${i}.`).join("\n\n"))).toHaveLength(20);
  });

  it("the stages, the work lines, the tries and the test counts", () => {
    expect([stageOf("locate", "running"), stageOf("work", "running"), stageOf("verify", "running"), stageOf("pr", "running"), stageOf("report", "done")]).toEqual([0, 2, 3, 4, 5]);
    expect(testCount("Tests  3 failed | 45 passed (48)")).toEqual({ pass: 45, fail: 3, total: 48 });
    expect(testCount("18 of 18 tests pass")).toEqual({ pass: 18, total: 18 });
    const log = (CODEWORK_API[`GET /v1/code/jobs/${JOB_FAILED}/log`] as { entries: Parameters<typeof tries>[0] }).entries;
    expect(tries(log).map((t) => t.title)).toEqual(["Ran the tests", "Replaced toSorted() with copy and sort", "Added a small date helper"]);
    expect(workLines(log, { max: 3, waiting: "Waiting for your answer" }).map((l) => l.mark)).toEqual(["done", "done", "waiting"]);
  });
});
