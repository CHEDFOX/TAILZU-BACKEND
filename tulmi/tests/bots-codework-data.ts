/**
 * Xode at work, as the existing routes answer it: a job waiting on a quick question, a lead with two helpers, a job that
 * shipped, one that could not finish, an approved design and the person's files. For tests/bots-codework.test.ts and the render
 * check (`npx tsx -e` prints CODEWORK_API as JSON for --api).
 */
import { FIXED_NOW } from "../src/experience/bots/fixtures.js";

const MIN = 60_000, HOUR = 60 * MIN;
export const PROJECT = "5e1d0c2b-0000-4000-8000-00000000c0de";
export const JOB_ASK = "7c1d2e3f-0000-4000-8000-000000000001";
export const JOB_LEAD = "7c1d2e3f-0000-4000-8000-000000000002";
export const JOB_DONE = "7c1d2e3f-0000-4000-8000-000000000003";
export const JOB_FAILED = "7c1d2e3f-0000-4000-8000-000000000007";
export const JOB_ANSWER = "7c1d2e3f-0000-4000-8000-000000000008";
export const ART = "a7a7a7a7-0000-4000-8000-000000000001";

const job = (o: Record<string, unknown>) => ({
  projectId: PROJECT, branch: "tailzu/fix-cart-rounding-3f2a", placement: "desktop", budgetPaise: 3000, reason: "", waitingOn: null, agent: true,
  leaseHolder: null, leaseEpoch: 1, leaseExpiresAt: null, checkpoint: { stepIndex: 2, headSha: "", notes: "" }, reassignments: 0,
  agentHolder: null, agentEpoch: 1, agentExpiresAt: null, userId: "u", ...o,
});
const agent = (o: Record<string, unknown>) => ({ phase: "work", staged: [], commits: [], fixRounds: 0, mode: "guided", planFirst: false, steps: 6, findings: [], notes: [], ...o });

const askLog = [
  { seq: 1, at: FIXED_NOW - 9 * MIN, kind: "read", text: "cart/total.ts", files: ["src/cart/total.ts"] },
  { seq: 2, at: FIXED_NOW - 7 * MIN, kind: "edit", text: "Rounds each line before adding", files: ["src/cart/total.ts"], data: { action: "edit" } },
  { seq: 3, at: FIXED_NOW - 4 * MIN, kind: "command", text: "pnpm test", data: { kind: "test", exitCode: 1, summary: "Tests 1 failed | 17 passed (18)" } },
];

export const CODEWORK_API: Record<string, unknown> = {
  [`GET /v1/code/projects/${PROJECT}`]: { project: { id: PROJECT, fullName: "aanya-sharma/storefront", defaultBranch: "main" } },

  [`GET /v1/code/jobs/${JOB_ASK}`]: {
    job: job({ id: JOB_ASK, task: "Fix cart total rounding", state: "waiting_for_you", waitingOn: "answer", spentPaise: 420, createdAt: FIXED_NOW - 6 * MIN, updatedAt: FIXED_NOW - MIN }),
    steps: [],
    agent: agent({ phase: "work", waiting: { kind: "question", question: "Round each item's price, or round once at the end? Your invoices round each item.", options: ["Each item", "At the end"] } }),
  },
  [`GET /v1/code/jobs/${JOB_ASK}/log`]: { entries: askLog },

  [`GET /v1/code/jobs/${JOB_LEAD}`]: {
    job: job({ id: JOB_LEAD, task: "Checkout redesign", state: "running", branch: "code-bot/checkout", budgetPaise: 4000, spentPaise: 1860, createdAt: FIXED_NOW - 24 * MIN, updatedAt: FIXED_NOW - MIN }),
    steps: [], agent: agent({ phase: "team", team: { stage: "run", why: "features", parts: [] } }),
  },
  [`GET /v1/code/jobs/${JOB_LEAD}/log`]: { entries: [] },
  [`GET /v1/code/jobs/${JOB_LEAD}/team`]: {
    job: { id: JOB_LEAD, state: "running", budgetPaise: 4000, spentPaise: 1860 },
    team: {
      stage: "run", why: "features", reason: "Checkout has a UI and an API part", parallel: 2,
      budget: { totalPaise: 4000, spentPaise: 1860, reservePaise: 800, poolPaise: 3200 },
      parts: [
        { id: 1, title: "Checkout UI", goal: "Address step with saved places, UPI first", kind: "files", status: "running", ownedPaths: ["app/checkout/"], dependsOn: [], branch: "checkout-ui", jobId: "c0000000-0000-4000-8000-000000000001", jobIds: [], budgetPaise: 1600, spentPaise: 790, fixRounds: 0, refused: [] },
        { id: 2, title: "Orders API", goal: "Save the address with the order; listen for UPI paid / failed", kind: "files", status: "merged", ownedPaths: ["app/api/orders/"], dependsOn: [], branch: "checkout-api", jobId: "c0000000-0000-4000-8000-000000000002", jobIds: [], budgetPaise: 1600, spentPaise: 480, fixRounds: 0, review: { verdict: "pass", family: "gemini", summary: "14 of 14 tests · no notes", findings: 0, blockers: 0 }, refused: [] },
      ],
      links: [], notes: [],
    },
    children: [],
  },

  [`GET /v1/code/jobs/${JOB_DONE}`]: {
    job: job({ id: JOB_DONE, task: "Fix cart total rounding", state: "done", spentPaise: 640, createdAt: FIXED_NOW - 2 * HOUR, updatedAt: FIXED_NOW - 2 * HOUR + 18 * MIN }),
    steps: [],
    agent: agent({
      phase: "done", staged: [], commits: ["abc1234"], pr: { number: 128, url: "https://github.com/aanya-sharma/storefront/pull/128", ready: true },
      verify: { ran: true, ok: true, summary: "18 of 18 tests pass" }, notes: ["One payments test was already failing before I started. I left it alone and noted it in the PR."],
      report: { outcome: "done", text: "Done. I round each line first, then add, so the cart now matches your invoices.", costPaise: 640 },
    }),
  },
  [`GET /v1/code/jobs/${JOB_DONE}/log`]: { entries: [
    { seq: 1, at: 0, kind: "edit", text: "Rounds each line before adding", files: ["src/cart/total.ts"], data: { action: "edit" } },
    { seq: 2, at: 0, kind: "edit", text: "Two new tests for rounding", files: ["src/cart/total.test.ts"], data: { action: "create" } },
    { seq: 3, at: 0, kind: "edit", text: "Noted the fix", files: ["CHANGELOG.md"], data: { action: "edit" } },
  ] },

  [`GET /v1/code/jobs/${JOB_FAILED}`]: {
    job: job({ id: JOB_FAILED, task: "Checkout redesign", state: "failed", branch: "checkout-redesign", spentPaise: 640, createdAt: FIXED_NOW - 11 * MIN - HOUR, updatedAt: FIXED_NOW - HOUR, reason: "Tests fail on Node 18." }),
    steps: [{ idx: 0, kind: "exec", commands: ["pnpm test"], status: "failed", exitCode: 1, outputTail: "FAIL  src/cart/cart.test.ts > sorts lines by price\nTypeError: lines.toSorted is not a function\nTests  3 failed | 45 passed (48)", minutes: 2, startedAt: 0, finishedAt: 0 }],
    agent: agent({ phase: "report", pr: { number: 131, url: "https://github.com/aanya-sharma/storefront/pull/131", ready: false }, report: { outcome: "failed", text: "The new cart code uses toSorted(), which Node 18 doesn't have. On Node 20 all 48 tests pass.", costPaise: 640 } }),
  },
  [`GET /v1/code/jobs/${JOB_FAILED}/log`]: { entries: [
    { seq: 1, at: 0, kind: "command", text: "pnpm test", data: { kind: "test", exitCode: 1, summary: "3 failing in cart.test.ts" } },
    { seq: 2, at: 0, kind: "edit", text: "Replaced toSorted() with copy and sort", files: ["src/cart/sort.ts"], data: { action: "edit" } },
    { seq: 3, at: 0, kind: "command", text: "pnpm test", data: { kind: "test", exitCode: 1, summary: "2 still failing · receipt dates" } },
    { seq: 4, at: 0, kind: "edit", text: "Added a small date helper", files: ["src/cart/date.ts"], data: { action: "create" } },
    { seq: 5, at: 0, kind: "command", text: "pnpm install", data: { kind: "install", exitCode: 1, summary: "Lockfile won't install on Node 18" } },
  ] },

  [`GET /v1/code/jobs/${JOB_ANSWER}`]: {
    job: job({ id: JOB_ANSWER, task: "How does sign-in work here?", state: "done", spentPaise: 90, createdAt: FIXED_NOW - 30 * MIN, updatedAt: FIXED_NOW - 29 * MIN }),
    steps: [], agent: agent({ phase: "done", report: { outcome: "answer", text: "The sign-in page sends the email to your auth route (app/api/auth/route.ts:9), Supabase checks it, and a session cookie keeps you signed in (lib/session.ts:42).", costPaise: 90 } }),
  },
  [`GET /v1/code/jobs/${JOB_ANSWER}/log`]: { entries: [] },

  "GET /v1/code/jobs": { jobs: [
    { id: JOB_DONE, state: "done", updatedAt: FIXED_NOW - HOUR }, { id: "x1", state: "done", updatedAt: FIXED_NOW - 20 * HOUR },
    { id: "x2", state: "done", updatedAt: FIXED_NOW - 30 * HOUR }, { id: "x3", state: "failed", updatedAt: FIXED_NOW - 2 * HOUR },
  ] },

  [`GET /v1/artifacts/${ART}`]: {
    artifact: { id: ART, projectId: PROJECT, type: "html", title: "Pricing card", headVersion: 3, spentPaise: 50, createdAt: FIXED_NOW - HOUR, updatedAt: FIXED_NOW - MIN },
    version: 3,
    content: [
      "<!doctype html>",
      "<html><body>",
      "<div class=\"plans\">",
      "  <div class=\"card\"><h3>Starter</h3><p>For trying it out</p><strong>₹0</strong></div>",
      "  <div class=\"card pro\"><h3>Pro</h3><p>Most people pick this</p><strong>₹299</strong><button>Choose Pro</button></div>",
      "  <div class=\"card\"><h3>Team</h3><p>Up to 10 people</p><strong>₹999</strong></div>",
      "</div>",
      "</body></html>",
    ].join("\n"),
  },
  [`GET /v1/artifacts/${ART}/versions`]: { versions: [
    { version: 1, kind: "snapshot", madeBy: "bot", note: "First draft", createdAt: FIXED_NOW - HOUR, storedBytes: 400 },
    { version: 2, kind: "patch", madeBy: "person", note: "Added the Team plan", createdAt: FIXED_NOW - 25 * MIN, storedBytes: 80 },
    { version: 3, kind: "patch", madeBy: "person", note: "Pro stands out more", createdAt: FIXED_NOW - MIN, storedBytes: 60 },
  ] },

  "GET /v1/files": { files: [
    { id: "f0000000-0000-4000-8000-000000000001", name: "redmi-booking.png", kind: "image", format: "png", mime: "image/png", bytes: 655360, sha256: "a".repeat(64), chars: 0, keep: false, expiresAt: 0, createdAt: FIXED_NOW - 2 * MIN, notes: [], tables: [] },
    { id: "f0000000-0000-4000-8000-000000000002", name: "Price list.pdf", kind: "pdf", format: "pdf", mime: "application/pdf", bytes: 120000, sha256: "b".repeat(64), chars: 900, keep: false, expiresAt: 0, createdAt: FIXED_NOW - HOUR, pages: 2, notes: [], tables: [] },
    { id: "f0000000-0000-4000-8000-000000000003", name: "Recording on Redmi", kind: "video", format: "mp4", mime: "video/mp4", bytes: 3_000_000, sha256: "c".repeat(64), chars: 0, keep: false, expiresAt: 0, createdAt: FIXED_NOW - 3 * HOUR, durationSeconds: 24, notes: [], tables: [] },
  ] },
};
