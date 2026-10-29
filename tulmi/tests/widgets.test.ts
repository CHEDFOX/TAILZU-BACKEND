/**
 * QUICK ACCESS FROM OUTSIDE THE APP (src/widgets, routes/widgets.ts; docs/widgets.md):
 *
 *   - GET /v1/widgets/now: both widgets' rows, worded, linked, with buttons; the empty state; the kill switches; the server's knobs
 *   - the widget's own token: narrow (its scopes only, never a reply, never a session anywhere else), short-lived, revocable,
 *     one per phone, hashed
 *   - POST /v1/widgets/act: the person's own only, the risk rule for a connected app's yes, a question's own answers only, once
 *   - the push engine: a category per kind (push.<kind>.category) and the item its buttons answer
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const A_ = "11111111-1111-4111-8111-111111111111"; // Aanya, who makes Home
const M_ = "22222222-2222-4222-8222-222222222222"; // Mom
const R_ = "33333333-3333-4333-8333-333333333333"; // Rohan
const EMAIL: Record<string, string> = { [A_]: "aanya.sharma@example.in", [M_]: "meera.sharma@example.in", [R_]: "rohan@example.in" };

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id && EMAIL[id] ? { id, email: EMAIL[id] } : null; } };
});
vi.mock("../src/push/index.js", () => ({ pushEngine: () => ({ notify: async () => null }) }));

const { Spaces } = await import("../src/botsBots/spaces.js");
const { MailOutbox, NOT_CONFIGURED } = await import("../src/botsBots/mail.js");
const { MemoryPaged, resetSpaceTablesForTests } = await import("../src/botsBots/spaceRows.js");
const { resetAreaTablesForTests } = await import("../src/botsBots/rows.js");
const { registerSpacesRoutes } = await import("../src/routes/botsSpaces.js");
const { registerWidgetRoutes, actPartsOf } = await import("../src/routes/widgets.js");
const { resetCalendarForTests } = await import("../src/calendar/index.js");
const { WidgetTokens, MemoryWidgetTokenStore, TOKEN_RE, hashToken } = await import("../src/widgets/token.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { WIDGETS_DEFAULTS } = await import("../src/widgets/defaults.js");
const { parseItem, itemId, questionMark, pushItemOf } = await import("../src/widgets/items.js");
const { buildNow } = await import("../src/widgets/now.js");

const RL = { rateLimit: { max: 10_000, timeWindow: 60_000 } };
const AREA = "/v1/botsapp/bots";
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const JOB = "job-1111";
const CT = "ctask-1";

type Flags = Record<string, unknown>;

/** A connected app's call waiting for a yes, and a Code bot job asking a question: fakes of the two services. */
function fakeServices(clock: { t: number }) {
  const approvals = new Map<string, { userId: string; state: string; approval: { id: string; connector: string; tool: string; risk: string; preview: string } | null; title: string; approved: number; denied: number }>();
  approvals.set(CT, { userId: A_, state: "waiting", approval: { id: "ap-1", connector: "google-calendar", tool: "move_event", risk: "write", preview: "Dinner, 7:30 pm" }, title: "Move dinner to 7:30?", approved: 0, denied: 0 });
  const connectors = {
    store: { getTask: async (u: string, id: string) => { const t = approvals.get(id); return t && t.userId === u ? { ...t } : null; } },
    tasks: {
      list: async (u: string) => [...approvals.entries()].filter(([, t]) => t.userId === u).map(([id, t]) => ({ id, state: t.state, title: t.title, steps: [], approval: t.approval, createdAt: 1, updatedAt: clock.t - 5 * MIN })),
      approve: async (u: string, id: string, approvalId?: string) => {
        const t = approvals.get(id);
        if (!t || t.userId !== u) return { status: "not_found" };
        if (t.state !== "waiting" || (approvalId && approvalId !== t.approval?.id)) return { status: "not_waiting" };
        t.state = "done"; t.approved += 1; t.approval = null;
        return { status: "ok" };
      },
      deny: async (u: string, id: string) => {
        const t = approvals.get(id);
        if (!t || t.userId !== u) return { status: "not_found" };
        if (t.state !== "waiting") return { status: "not_waiting" };
        t.state = "cancelled"; t.denied += 1; t.approval = null;
        return { status: "ok" };
      },
    },
  };
  const job = {
    id: JOB, userId: A_, projectId: "p", branch: "b", task: "Fix the cart total", state: "waiting_for_you", placement: "none", leaseHolder: null, leaseEpoch: 0, leaseExpiresAt: null,
    checkpoint: { stepIndex: 2, headSha: "", notes: "", agent: { v: 1, phase: "work", waiting: { kind: "question", question: "Round per item or at the end?", options: ["Per item", "At the end"], from: "model" } } },
    budgetPaise: 3000, spentPaise: 120, reassignments: 0, reason: "", waitingOn: "answer", agent: true, agentHolder: null, agentEpoch: 0, agentExpiresAt: null, createdAt: 1, updatedAt: clock.t - 2 * MIN,
  };
  const answers: string[] = [];
  const jobs = {
    job: async (u: string, id: string) => { if (u !== A_ || id !== JOB) throw Object.assign(new Error("No such job"), { code: "not_found" }); return structuredClone(job); },
    listJobs: async (u: string) => (u === A_ ? [structuredClone(job)] : []),
  };
  const agent = { answer: async (u: string, id: string, a: unknown) => { if (u !== A_ || id !== JOB) throw new Error("no"); answers.push(String(a)); return {}; } };
  return { approvals, connectors, jobs, agent, answers, job };
}

async function served(o: { flags?: Flags; labels?: Record<string, string> } = {}) {
  resetAreaTablesForTests();
  resetSpaceTablesForTests();
  resetCalendarForTests();
  const clock = { t: Date.UTC(2026, 9, 28, 6, 0) };
  const now = () => clock.t;
  const outbox = new MailOutbox(new MemoryPaged(), now);
  const spaces = new Spaces(null, now, { outbox, mailer: NOT_CONFIGURED, origin: () => "https://app.example.in" });
  const svc = fakeServices(clock);
  const app = Fastify();
  const deps = { rateLimit: RL, bots: null, code: null, jobs: svc.jobs as never, connectors: svc.connectors as never, media: null, artifacts: null, agent: svc.agent };
  const parts = registerSpacesRoutes(app, deps, { spaces });
  const tokenStore = new MemoryWidgetTokenStore();
  const tokens = new WidgetTokens(tokenStore, now);
  const actStore = new MemoryQuickActionStore();
  const config = () => {
    const p = structuredClone(WIDGETS_DEFAULTS);
    Object.assign(p.flags, o.flags ?? {});
    Object.assign(p.labels, o.labels ?? {});
    return p;
  };
  registerWidgetRoutes(app, deps, parts, { tokens, config, now, acts: new QuickActs(actPartsOf(deps, parts), actStore, now) });
  await app.ready();
  const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, user: string | null = A_, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method, url, headers: { ...(user ? { authorization: `Bearer ${user}` } : {}), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: r.statusCode, body: r.body ? (() => { try { return r.json(); } catch { return r.body; } })() : null };
  };
  /** Home: Aanya, Mom (Family), Rohan (Kid). Mom gives Aanya a task, shares a list and says she is running late. */
  const home = async () => {
    const id = (await call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id as string;
    const fam = (await call("POST", `${AREA}/spaces/${id}/invite`, A_, { role: "family" })).body;
    await call("POST", `${AREA}/spaces/join`, M_, { code: fam.code });
    const kid = (await call("POST", `${AREA}/spaces/${id}/invite`, A_, { role: "kid" })).body;
    await call("POST", `${AREA}/spaces/join`, R_, { code: kid.code });
    clock.t += HOUR;
    const task = (await call("POST", `${AREA}/spaces/${id}/tasks`, M_, { title: "Call Grandma", people: [A_], tz: 330 })).body.task;
    clock.t += 10 * MIN;
    await call("POST", `${AREA}/shares`, M_, { kind: "text", title: "Weekend plan", text: "Saturday: zoo. Sunday: lunch at Nani's.", access: "view", to: { space: id } });
    clock.t += 10 * MIN;
    const chat = (await call("POST", `${AREA}/threads/direct`, M_, { person: A_ })).body.id as string;
    await call("POST", `${AREA}/threads/${chat}/messages`, M_, { text: "running late" });
    clock.t += 5 * MIN;
    return { id, task, chat };
  };
  const tokenFor = async (user = A_, device = "phone-aanya-1") => (await call("POST", "/v1/widgets/token", user, { device })).body;
  const act = (body: Record<string, unknown>, auth: { widget?: string; user?: string | null } = {}) =>
    call("POST", "/v1/widgets/act", auth.widget ? null : (auth.user === undefined ? A_ : auth.user), body, auth.widget ? { "x-widget-token": auth.widget } : {});
  return { app, call, home, clock, parts, svc, tokens, tokenStore, tokenFor, act };
}

describe("GET /v1/widgets/now", () => {
  beforeEach(() => { resetSpaceTablesForTests(); resetAreaTablesForTests(); });

  it("words both widgets' rows, newest first, each with who, what, when and a link to exactly that thing", async () => {
    const s = await served();
    const h = await s.home();
    const r = await s.call("GET", "/v1/widgets/now?tz=330&platform=ios");
    expect(r.status).toBe(200);
    const doc = r.body;
    expect(doc).toMatchObject({ v: 1, refreshSec: 900, fetchSec: 60, time: "relative", act: { path: "/v1/widgets/act", inPlace: true } });
    expect(doc.rev).toMatch(/^[0-9a-f]{12}$/);
    const people = doc.people;
    expect(people).toMatchObject({ on: true, title: "From your people", url: "tulmi://screen/bots.spaces", count: 3, newCount: 3, lock: { line: "3 new from your people" } });
    expect(people.rows.map((x: { line: string }) => x.line)).toEqual(["Meera S.: running late", "Meera S. shared Weekend plan", "Meera S.: Call Grandma"]);
    const [msg, shared, task] = people.rows;
    expect(msg).toMatchObject({ kind: "message", who: "Meera S.", initial: "M", text: "running late", private: true, new: true, icon: "bubble.left.fill", androidIcon: "tailzu_wi_chat", url: `tulmi://screen/bots.thread?id=${h.chat}` });
    expect(typeof msg.when).toBe("string");
    expect(shared).toMatchObject({ kind: "shared", text: "Weekend plan", detail: "Home", private: false });
    expect(shared.url).toMatch(/^tulmi:\/\/screen\/bots\.space\.item\?item=/);
    expect(task).toMatchObject({ kind: "task", tag: "task", text: "Call Grandma", url: `tulmi://screen/bots.space.tasks?id=${h.id}`, id: `stask:${h.id}:${h.task.id}` });
    // Nothing a person's own screen would not show: no amounts, no other people's ids.
    expect(JSON.stringify(doc)).not.toMatch(/₹|paise|amount/);
    expect(JSON.stringify(doc)).not.toContain(M_);
  });

  it("puts what needs the person first, each with its buttons, answered in place unless the server says open", async () => {
    const s = await served();
    const h = await s.home();
    const needs = (await s.call("GET", "/v1/widgets/now?tz=330")).body.needs;
    expect(needs.rows.map((x: { kind: string }) => x.kind)).toEqual(["question", "approval", "task"]);
    const [q, ap, t] = needs.rows;
    expect(q).toMatchObject({ who: "Code bot", text: "Round per item or at the end?", id: `job:${JOB}:${questionMark("Round per item or at the end?")}`, url: `tulmi://screen/bots.code.job?id=${JOB}` });
    expect(q.actions).toEqual([{ id: "a0", label: "Per item", style: "primary", mode: "inPlace" }, { id: "a1", label: "At the end", style: "secondary", mode: "inPlace" }]);
    expect(ap).toMatchObject({ who: "Plan bot", text: "Move dinner to 7:30?", detail: "Dinner, 7:30 pm", id: `task:${CT}:ap-1` });
    expect(ap.actions.map((a: { id: string; label: string }) => `${a.id}:${a.label}`)).toEqual(["yes:Yes", "no:No"]);
    expect(t).toMatchObject({ who: "Meera S.", text: "Call Grandma", detail: "From Meera S.", actions: [{ id: "done", label: "Done", style: "primary", mode: "inPlace", icon: "checkmark", androidIcon: "tailzu_wi_check" }] });
    expect(needs.words).toMatchObject({ done: "Done", failed: "Open X0 Bot to finish" });
    // A locked phone redacts what is asked (StandBy, Always-On); the Lock Screen never shows it at all.
    expect(needs.rows.every((r: { private: boolean }) => r.private)).toBe(true);
    expect(needs.lock.line).toBe("3 things need you");
    void h;

    // The server switches a kind to opening the app, renames a button, drops a kind, changes the order.
    const t2 = await served({ flags: { "widgets.needs.modes": { task: "open" }, "widgets.needs.kinds": ["task", "question"] }, labels: { "widgets.action.done": "Did it" } });
    await t2.home();
    const n2 = (await t2.call("GET", "/v1/widgets/now")).body.needs;
    expect(n2.rows.map((x: { kind: string }) => x.kind)).toEqual(["task", "question"]);
    expect(n2.rows[0].actions[0]).toMatchObject({ id: "done", label: "Did it", mode: "open" });
    expect(n2.rows[0].actions[0].url).toMatch(/^tulmi:\/\/screen\/bots\.space\.tasks\?id=/);
  });

  it("a yes that would pay or delete opens the app; a question with too many answers opens the app", async () => {
    const s = await served({ flags: { "widgets.needs.inPlaceRisks": ["read"], "widgets.needs.optionsMax": 1 } });
    await s.home();
    const rows = (await s.call("GET", "/v1/widgets/now")).body.needs.rows as Array<{ kind: string; actions: Array<{ id: string; mode: string }> }>;
    expect(rows.find((r) => r.kind === "approval")!.actions).toEqual([expect.objectContaining({ id: "open", mode: "open" })]);
    expect(rows.find((r) => r.kind === "question")!.actions).toEqual([expect.objectContaining({ id: "open", mode: "open" })]);
  });

  it("says what to do when there is nobody yet, and hides a message's words when the server says so", async () => {
    const s = await served();
    const doc = (await s.call("GET", "/v1/widgets/now", R_)).body;
    expect(doc.people).toMatchObject({ rows: [], count: 0, lock: { line: "Nothing new from your people" }, empty: { title: "Your people, here", cta: "Make a space", url: "tulmi://screen/bots.spaces" } });
    const t = await served({ flags: { "widgets.people.messageText": false, "widgets.people.kinds": ["message"] } });
    await t.home();
    const rows = (await t.call("GET", "/v1/widgets/now")).body.people.rows;
    expect(rows).toEqual([expect.objectContaining({ line: "Meera S. sent a message", text: "", private: false })]);
  });

  it("each widget and the whole thing can be switched off", async () => {
    const s = await served({ flags: { "widgets.people.enabled": false } });
    await s.home();
    const doc = (await s.call("GET", "/v1/widgets/now")).body;
    expect(doc.people).toMatchObject({ on: false, rows: [], count: 0 });
    expect(doc.needs.on).toBe(true);
    const off = await served({ flags: { "widgets.enabled": false } });
    await off.home();
    const d2 = (await off.call("GET", "/v1/widgets/now")).body;
    expect([d2.people.on, d2.needs.on]).toEqual([false, false]);
    expect((await off.call("POST", "/v1/widgets/token", A_, { device: "phone-aanya-1" })).body).toEqual({ token: null });
  });

  it("needs a session", async () => {
    const s = await served();
    expect((await s.call("GET", "/v1/widgets/now", null)).status).toBe(401);
  });
});

describe("the widget's own token", () => {
  it("is issued for one phone, kept only as a hash, and replaces that phone's last one", async () => {
    const s = await served();
    const t1 = await s.tokenFor();
    expect(t1.token).toMatch(TOKEN_RE);
    expect(t1).toMatchObject({ scopes: ["needs.answer", "task.done"], path: "/v1/widgets/act", renewAt: 0.5 });
    expect(t1.expiresAt).toBe(s.clock.t + 1440 * MIN);
    expect(JSON.stringify(s.tokenStore.rows)).not.toContain(t1.token);
    expect(s.tokenStore.rows[0]!.hash).toBe(hashToken(t1.token));
    const t2 = await s.tokenFor();
    expect(await s.tokens.verify(t1.token)).toBeNull();
    expect(await s.tokens.verify(t2.token)).toMatchObject({ userId: A_ });
    expect((await s.call("POST", "/v1/widgets/token", A_, { device: "../x" })).status).toBe(400);
    expect((await s.call("POST", "/v1/widgets/token", null, { device: "phone-aanya-1" })).status).toBe(401);
  });

  it("can only answer the person's own needs-you and tick their own tasks: nothing else, nowhere else", async () => {
    const s = await served();
    const h = await s.home();
    const { token } = await s.tokenFor();
    // Not a session: every other route refuses it, however it is sent.
    expect((await s.call("GET", "/v1/widgets/now", null, undefined, { "x-widget-token": token })).status).toBe(401);
    expect((await s.call("GET", "/v1/widgets/now", null, undefined, { authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await s.call("GET", `${AREA}/spaces`, null, undefined, { authorization: `Bearer ${token}` })).status).toBe(401);
    // A reply needs the session.
    const reply = await s.act({ item: `thread:${h.chat}`, action: "reply", text: "ok", key: "reply-key-1" }, { widget: token });
    expect(reply).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    // Someone else's task: the space says no (it is for whom it is for).
    const mine = (await s.call("POST", `${AREA}/spaces/${h.id}/tasks`, A_, { title: "Water the plants", people: [R_], tz: 330 })).body.task;
    const theirs = await s.act({ item: `stask:${h.id}:${mine.id}`, action: "done", key: "k-theirs-1" }, { widget: token });
    expect(theirs.status).toBe(403);
    // A button that does not exist, an item that is not ours.
    expect((await s.act({ item: `stask:${h.id}:${h.task.id}`, action: "delete" }, { widget: token })).status).toBe(400);
    expect((await s.act({ item: "space:1", action: "done" }, { widget: token })).status).toBe(400);
    // Their own: Done.
    const done = await s.act({ item: `stask:${h.id}:${h.task.id}`, action: "done", key: "tap-0001" }, { widget: token });
    expect(done).toMatchObject({ status: 200, body: { ok: true, state: "done" } });
    const given = (await s.call("GET", `${AREA}/tasks/given`)).body.tasks;
    expect(given.find((t: { id: string }) => t.id === h.task.id)).toBeUndefined();
  });

  it("runs out, and is revoked by the phone (sign-out) or all at once", async () => {
    const s = await served();
    const h = await s.home();
    const { token } = await s.tokenFor();
    s.clock.t += 1441 * MIN;
    expect((await s.act({ item: `stask:${h.id}:${h.task.id}`, action: "done" }, { widget: token })).status).toBe(401);
    const t2 = (await s.tokenFor()).token;
    const t3 = (await s.tokenFor(A_, "ipad-aanya-01")).token;
    expect((await s.call("DELETE", "/v1/widgets/token", A_, { device: "phone-aanya-1" })).body).toEqual({ revoked: 1 });
    expect(await s.tokens.verify(t2)).toBeNull();
    expect(await s.tokens.verify(t3)).not.toBeNull();
    expect((await s.call("DELETE", "/v1/widgets/token", A_, {})).body).toEqual({ revoked: 1 });
    expect(await s.tokens.verify(t3)).toBeNull();
    expect(await s.tokens.verify("xwt_nope")).toBeNull();
  });

  it("keeps at most widgets.token.maxPerUser phones, the oldest going first, and is refused when switched off", async () => {
    const s = await served({ flags: { "widgets.token.maxPerUser": 2 } });
    const a = (await s.tokenFor(A_, "device-0001")).token;
    s.clock.t += 1000;
    const b = (await s.tokenFor(A_, "device-0002")).token;
    s.clock.t += 1000;
    const c = (await s.tokenFor(A_, "device-0003")).token;
    expect([!!(await s.tokens.verify(a)), !!(await s.tokens.verify(b)), !!(await s.tokens.verify(c))]).toEqual([false, true, true]);
    const off = await served({ flags: { "widgets.token.enabled": false } });
    const h = await off.home();
    const { token } = await new WidgetTokens(off.tokenStore, () => off.clock.t).issue(A_, "device-0009", { ttlMs: DAY, maxPerUser: 5 });
    expect(await off.act({ item: `stask:${h.id}:${h.task.id}`, action: "done" }, { widget: token })).toMatchObject({ status: 403, body: { code: "open_app" } });
    expect((await off.call("GET", "/v1/widgets/now")).body.needs.rows.find((r: { kind: string }) => r.kind === "task").actions[0].mode).toBe("open");
  });
});

describe("POST /v1/widgets/act", () => {
  it("answers a bot's question with its own answer, and never the next question", async () => {
    const s = await served();
    await s.home();
    const { token } = await s.tokenFor();
    const q = questionMark("Round per item or at the end?");
    expect((await s.act({ item: `job:${JOB}:${q}`, action: "a1", key: "tap-q-0001" }, { widget: token })).body).toMatchObject({ ok: true, state: "done" });
    expect(s.svc.answers).toEqual(["At the end"]);
    expect((await s.act({ item: `job:${JOB}:${q}`, action: "a5", key: "tap-q-0002" }, { widget: token })).status).toBe(400);
    s.svc.job.checkpoint.agent.waiting.question = "Ship it now?";
    expect(await s.act({ item: `job:${JOB}:${q}`, action: "a0", key: "tap-q-0003" }, { widget: token })).toMatchObject({ status: 409, body: { code: "changed" } });
    expect(s.svc.answers).toEqual(["At the end"]);
  });

  it("says yes once, however many times it is tapped, and only at the risks the server allows", async () => {
    const s = await served();
    await s.home();
    const { token } = await s.tokenFor();
    const item = `task:${CT}:ap-1`;
    const first = await s.act({ item, action: "yes", key: "tap-yes-0001" }, { widget: token });
    expect(first).toMatchObject({ status: 200, body: { ok: true, state: "done" } });
    const again = await s.act({ item, action: "yes", key: "tap-yes-0001" }, { widget: token });
    expect(again).toMatchObject({ status: 200, body: { ok: true, state: "done", repeat: true } });
    // Another tap (another key) on the same, now answered: already answered.
    expect(await s.act({ item, action: "no", key: "tap-no-00001" }, { widget: token })).toMatchObject({ status: 409, body: { code: "not_waiting" } });
    expect(s.svc.approvals.get(CT)).toMatchObject({ approved: 1, denied: 0 });

    const pay = await served();
    await pay.home();
    pay.svc.approvals.get(CT)!.approval!.risk = "pay";
    // From a notification (the session) too: a payment is never a button outside the app.
    expect(await pay.act({ item: `task:${CT}`, action: "yes", key: "tap-pay-0001" })).toMatchObject({ status: 403, body: { code: "open_app" } });
    expect(pay.svc.approvals.get(CT)!.approved).toBe(0);
  });

  it("a stale approval is not the one waiting now", async () => {
    const s = await served();
    expect(await s.act({ item: `task:${CT}:ap-OLD`, action: "yes", key: "tap-old-0001" })).toMatchObject({ status: 409, body: { code: "not_waiting" } });
    expect(s.svc.approvals.get(CT)!.approved).toBe(0);
  });

  it("replies to a chat once per key, with the session", async () => {
    const s = await served();
    const h = await s.home();
    const send = () => s.act({ item: `thread:${h.chat}`, action: "reply", text: "On my way", key: "reply-0000-1" });
    expect((await send()).body).toMatchObject({ ok: true, state: "sent" });
    expect((await send()).body).toMatchObject({ ok: true, state: "sent", repeat: true });
    const msgs = (await s.call("GET", `${AREA}/threads/${h.chat}`)).body.messages as Array<{ text: string }>;
    expect(msgs.filter((m) => m.text === "On my way")).toHaveLength(1);
    expect((await s.act({ item: `thread:${h.chat}`, action: "reply", text: "no key" })).status).toBe(400);
    expect((await s.act({ item: `thread:${h.chat}`, action: "reply", text: "", key: "reply-0000-2" })).status).toBe(400);
    // Not theirs to write in: Rohan has no chat with Aanya's mother.
    expect((await s.act({ item: `thread:${h.chat}`, action: "reply", text: "hi", key: "reply-0000-3" }, { user: R_ })).status).toBe(404);
    expect((await s.act({ item: `thread:${h.chat}`, action: "reply", text: "hi", key: "reply-0000-4" }, { user: null })).status).toBe(401);
  });

  it("Done is safe to tap twice", async () => {
    const s = await served();
    const h = await s.home();
    const item = `stask:${h.id}:${h.task.id}`;
    expect((await s.act({ item, action: "done", key: "done-tap-001" })).body).toMatchObject({ ok: true, state: "done" });
    expect((await s.act({ item, action: "done", key: "done-tap-002" })).body).toMatchObject({ ok: true, state: "done" });
    expect((await s.act({ item, action: "done" })).body).toMatchObject({ ok: true });
  });
});

describe("item ids", () => {
  it("read back exactly what they were, and nothing else", () => {
    for (const i of [
      { kind: "job", jobId: "j-1", q: "0123abcd" }, { kind: "task", taskId: "t1", approvalId: null }, { kind: "task", taskId: "t1", approvalId: "a1" },
      { kind: "stask", spaceId: "s1", taskId: "t1" }, { kind: "thread", threadId: "th1" }, { kind: "item", itemId: "i1" }, { kind: "msg", threadId: "th", messageId: "m" },
    ] as const) expect(parseItem(itemId(i))).toEqual(i);
    for (const bad of ["", "job:j1", "job:j1:XYZ", "stask:s1", "thread:a:b", "x:y", "task:a/b", "task:a:b:c", 42, "task:" + "a".repeat(300)]) expect(parseItem(bad)).toBeNull();
  });
  it("a push carries the item its buttons answer", () => {
    expect(pushItemOf("space_task", { spaceId: "s1", taskId: "t1" })).toBe("stask:s1:t1");
    expect(pushItemOf("space_message", { threadId: "th1" })).toBe("thread:th1");
    expect(pushItemOf("approval", { taskId: "t9" })).toBe("task:t9");
    expect(pushItemOf("streak", {})).toBeNull();
    expect(pushItemOf("space_message", { threadId: "../x" })).toBeNull();
  });
});

describe("buildNow", () => {
  it("writes a time the server's way, and keeps the rows each size draws", () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const doc = buildNow({
      now, tzOffsetMinutes: 330, inSpaces: true, tokenReady: true,
      people: { messages: [{ threadId: "t", messageId: "m", chat: "Home", chatKind: "space", from: "Sam", text: "running late", at: now - 3 * HOUR, unread: false }], shared: [], tasks: [] },
      needs: { jobs: [], approvals: [], tasks: [], codeBotName: "Code bot" },
    }, { flags: { ...WIDGETS_DEFAULTS.flags, "widgets.people.limits": { small: 1 } }, labels: { ...WIDGETS_DEFAULTS.labels, "widgets.time.hour": "{n} hr ago" } });
    expect(doc.people.rows[0]).toMatchObject({ when: "3 hr ago", detail: "Home", new: true });
    expect(doc.people.limits).toEqual({ small: 1, medium: 3, large: 6, lock: 0, android: 4 });
    expect(doc.needs).toMatchObject({ rows: [], lock: { line: "Nothing needs you" }, empty: { title: "All clear", url: "tulmi://screen/bots.home" } });
  });
});

describe("a notification's buttons", async () => {
  const { PushEngine } = await import("../src/push/engine.js");
  const { MemoryPushStore } = await import("../src/push/store.js");
  const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
  const setup = (flags: Flags = {}) => {
    const store = new MemoryPushStore();
    store.candidatesList = [{ userId: "user-a", tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: 0 }], lastSeenAt: null, createdAt: 0, locale: null, entitled: false, tzOffsetMin: 0 }];
    const sent: Array<Record<string, any>> = [];
    const sender = { send: async (m: Array<Record<string, any>>) => { sent.push(...m); return m.map(() => ({ status: "ok" as const, id: "t" })); }, receipts: async () => ({}) };
    const engine = new PushEngine(store, sender, () => { const p = structuredClone(PUSH_DEFAULTS); Object.assign(p.flags, flags); return p; }, { info: () => {}, warn: () => {} });
    return { sent, engine };
  };

  it("carry the category the server gives each kind, and the item they answer", async () => {
    const { sent, engine } = setup();
    await engine.notify("user-a", { kind: "space_task", key: "t1:a", vars: { name: "Mom", title: "Call Grandma", due: "" }, data: { spaceId: "s1", taskId: "t1" } });
    await engine.notify("user-a", { kind: "space_message", key: "th:m", vars: { name: "Sam", chat: "Sam" }, data: { threadId: "th1" } });
    await engine.notify("user-a", { kind: "approval", key: "c1", vars: { app: "Calendar" }, data: { taskId: "c1" } });
    await engine.notify("user-a", { kind: "plan_reminder", key: "r1", vars: { title: "Gym", when: "7 am" }, data: { day: "2026-10-29" } });
    expect(sent.map((m) => [m.categoryId ?? null, m.data.item ?? null])).toEqual([
      ["x0_task", "stask:s1:t1"], ["x0_reply", "thread:th1"], ["x0_yesno", "task:c1"], [null, null],
    ]);
    // The words never ride along with a message's push.
    expect(sent[1]!.body).toBe("Sam sent a message");
  });

  it("follow the server: a new category for a kind, none for another, and nothing that is not a category id", async () => {
    const { sent, engine } = setup({ "push.plan_reminder.category": "x0_snooze", "push.space_task.category": "", "push.space_message.category": "bad id!" });
    await engine.notify("user-a", { kind: "plan_reminder", key: "r1", vars: { title: "Gym", when: "7 am" } });
    await engine.notify("user-a", { kind: "space_task", key: "t1:a", vars: { name: "Mom", title: "x", due: "" }, data: { spaceId: "s1", taskId: "t1" } });
    await engine.notify("user-a", { kind: "space_message", key: "m", vars: { name: "Sam", chat: "Sam" }, data: { threadId: "th1" } });
    expect(sent.map((m) => m.categoryId ?? null)).toEqual(["x0_snooze", null, null]);
  });
});
