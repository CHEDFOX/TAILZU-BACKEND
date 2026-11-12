/**
 * "PLAN SOMETHING" AND THE HOME, JOINED (docs/plan-ease.md §10; screens/bots/planMake.ts, planHome.ts; routes/bots/planMake.ts and the
 * plan/day and plan/box routes in routes/bots/botsBots.ts):
 *
 *   - each screen is built as the server serves it (buildBotsScreen, its own load through the real routes), then driven the way the apps
 *     run it: a tap runs the node's own action tree by the phone's rules (sdui/state.ts, fill.ts, actions.ts evalCondition) or the
 *     window's (sdui/theme.js visible: String() compares, an empty list is false), and every call goes to the real routes through
 *     app.inject, over one calendar in memory
 *   - so a path or a body the screens send (1.2.2) that the routes (5.1) do not take, or read differently, fails here: the box (draft,
 *     `day`), the card (check, `d`, `at`, `day0`), a fix and Take out (check, `fix`, `drop`), Done (make, `key` from the answer), the
 *     re-check after fix_first, Read it with AI (draft, `keep`), a bill's preview (plan/box), the home's plan/day query and its Undo
 *   - the sample states the renders draw (samples/planMake.ts MAKE_STATES, the real PlanMake's answers) show the server's words
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
// The bearer is the user's id here; no bearer is no one.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { walk } = await import("../src/experience/bots/lint.js");
const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase, setPlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanFollows, setPlanFollows } = await import("../src/botsBots/planFollow.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { PlanCapture, memoryCaptureStore, setPlanCapture } = await import("../src/botsBots/planCapture.js");
const { botsAreaParts } = await import("../src/botsBots/index.js");
const { registerBotsBotsRoutes } = await import("../src/routes/bots/botsBots.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { resetConfigForTests } = await import("../src/config.js");
const { MAKE_API, MAKE_STATES, MAKE_PARAMS } = await import("../scripts/bots-render/samples/planMake.js");
const { FIXED_NOW } = await import("../src/experience/bots/fixtures.js");

type Client = "phone" | "desktop";
type Act = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Screen = Awaited<ReturnType<typeof buildBotsScreen>>;

const MIN = 60_000;
const IST = 330;
/** Thursday 12 November 2026, 10:00 in India (the spec's worked examples). */
const T0 = Date.UTC(2026, 10, 12, 10, 0) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const DAD = "22222222-0000-4000-8000-000000000002";
const SUNITA = "11111111-0000-4000-8000-000000000001";
const A = "/v1/botsapp/bots";
const MK = `${A}/plan/make`;
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const NEW = ["BotsKit", "BotsMotion", "BotBuddy", "KitExtras", "PersonBot", "FontBricolage", "FileUpload", "ActionParams"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CARD0 = (day: string) => ({ title: "", day, dayWords: "", time: "", timeWords: "", repeat: "", days: [], who: "", whoName: "", imp: "", place: "", guessed: "" });

// ------------------------------------------------------------------ the server: the real routes over one calendar in memory

interface Sent { method: string; path: string; body?: unknown; status: number; answer: unknown }

async function server() {
  // One clock for every part, the server's own (Date.now): the routes' PlanMake reads it as the server's does.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const clock = () => Date.now();
  const calendar = new Calendar({ rows: memoryCalendarRows(), now: clock, publish: () => undefined });
  const prefs = memoryPlanPrefs(clock);
  const ease = new PlanEase({ calendar, prefs, skips: new MemoryTable(), now: clock });
  const contacts = async (u: string) => (u === U ? [{ userId: DAD, name: "Dad" }, { userId: SUNITA, name: "Sunita Sharma" }] : []);
  const follows = new PlanFollows({
    stores: memoryFollowStores(), calendar, now: clock, settingsOf: async () => structuredClone(DEFAULT_SETTINGS), log: { info: () => undefined, warn: () => undefined },
    tzOfUser: async () => IST, contacts, muted: async () => false,
    engine: () => ({ notify: async () => null, configFor: () => structuredClone(PUSH_DEFAULTS) }) as never,
    calls: () => ({ ring: async () => ({ none: "x" }), closeFor: async () => undefined }) as never,
  });
  setPlanFollows(follows);
  let yes = false;
  const reads: Array<{ user: string; o?: unknown }> = [];
  let answer = JSON.stringify({ items: [] });
  const capture = new PlanCapture({
    calendar, prefs, store: memoryCaptureStore(), now: clock, tzOf: async () => IST, usdInr: () => 100, aiOk: async () => yes,
    readers: {
      text: async (_s, user, o) => { reads.push({ user, ...(o ? { o } : {}) }); return { text: answer, usd: 0.0005 }; },
      picture: async () => { throw new Error("no"); }, glance: async () => { throw new Error("no"); },
    },
  });

  const app: FastifyInstance = Fastify();
  // The server's own wiring (routes/bots/botsBots.ts): plan/day, plan/box, the act door, follow-through, then "Plan something" over
  // this Plan Ease. Spaces' contacts and invite are the test's, and so is the reader.
  registerBotsBotsRoutes(app, { rateLimit: RL, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null }, {
    parts: { ...botsAreaParts({ bots: null, connectors: null, now: clock }), ease },
  });
  setPlanEase(ease);
  follows.wire({ contacts, muted: async () => false });
  follows.people.wire({ invite: async () => ({ screen: "bots.space.invite", params: { id: "s1" } }) });
  setPlanCapture(capture);
  // The person's yes (privacy/aiConsent.ts PUT /v1/you/ai-consent, registered by the server itself): kept here as the reader's gate.
  app.put("/v1/you/ai-consent", async (req) => { yes = (req.body as { agree?: unknown })?.agree === true; return { agreed: yes, at: Date.now() }; });
  await app.ready();

  const sent: Sent[] = [];
  /** A call as an app sends it: the answer, or an error carrying the server's own { code, message } (what lastError holds). */
  const send = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await app.inject({ method: method as "GET", url: path, headers: { authorization: `Bearer ${U}` }, ...(body === undefined ? {} : { payload: body as object }) });
    const answer = res.body ? res.json() : null;
    sent.push({ method, path, ...(body === undefined ? {} : { body: structuredClone(body) }), status: res.statusCode, answer });
    if (res.statusCode >= 400) throw Object.assign(new Error(`${method} ${path} → ${res.statusCode}`), { status: res.statusCode, server: answer });
    return answer;
  };
  return {
    app, calendar, sent, send, reads,
    at: (ms: number) => { vi.setSystemTime(ms); },
    now: () => Date.now(),
    yes: (v: boolean) => { yes = v; },
    answer: (v: unknown) => { answer = JSON.stringify(v); },
  };
}
type Server = Awaited<ReturnType<typeof server>>;

/** The screen as the server serves it, its own load going through the routes. */
async function build(s: Server, screenId: string, client: Client, params: Record<string, unknown>, can = NEW): Promise<Screen> {
  const deps = { ...fakeDeps({ now: s.now() }), api: <T,>(method: string, path: string, body?: unknown) => s.send(method, path, body) as Promise<T> };
  return buildBotsScreen({
    screenId, client, params: params as Record<string, string>, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(can),
    desk: { pages: client === "desktop", notes: false },
  }, deps);
}

// ------------------------------------------------------------------ the apps' rules, for the actions these screens use

function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), obj);
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== "object" || cur[k] == null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

/** One screen, run as the phone or the window runs it. */
class Driver {
  state: Record<string, unknown>;
  readonly said: string[] = [];
  readonly went: Array<{ kind: "navigate"; screenId: string; params?: Record<string, unknown>; replace?: boolean } | { kind: "back" }> = [];
  readonly nodes: Node[];
  private readonly parent = new Map<Node, Node>();

  constructor(readonly screen: Screen, readonly client: Client, private readonly send: Server["send"]) {
    this.state = JSON.parse(JSON.stringify(screen.state ?? {}));
    this.nodes = walk(screen.root!);
    for (const n of this.nodes) for (const c of n.children ?? []) this.parent.set(c, n);
  }

  get(path: string): unknown { return getPath(this.state, path); }

  private resolve(v: unknown): unknown {
    if (typeof v === "string") return v.startsWith("$state.") ? this.get(v.slice(7)) : v;
    if (Array.isArray(v)) return v.map((x) => this.resolve(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x)]));
    return v;
  }

  private truthy(v: unknown): boolean {
    if (this.client === "phone") return !!v;
    if (Array.isArray(v)) return v.length > 0;
    if (v !== null && typeof v === "object") return true;
    return v === true || v === "true" || (typeof v === "number" && v !== 0) || (typeof v === "string" && v.length > 0);
  }

  cond(c: Act | undefined): boolean {
    if (!c) return true;
    const same = (a: unknown, b: unknown) => (this.client === "phone" ? a === b : String(a) === String(b));
    if ("eq" in c) return same(this.get(c.eq[0]), c.eq[1]);
    if ("neq" in c) return !same(this.get(c.neq[0]), c.neq[1]);
    if ("truthy" in c) return this.truthy(this.get(c.truthy));
    if ("falsy" in c) return !this.truthy(this.get(c.falsy));
    if ("contains" in c) { const v = this.get(c.contains[0]); return Array.isArray(v) ? v.some((x) => same(x, c.contains[1])) : String(v ?? "").includes(c.contains[1]); }
    if ("all" in c) return (c.all as Act[]).every((x) => this.cond(x));
    if ("any" in c) return (c.any as Act[]).some((x) => this.cond(x));
    if ("not" in c) return !this.cond(c.not);
    throw new Error(`a condition this test does not know: ${JSON.stringify(c)}`);
  }

  async run(a: Act | undefined): Promise<void> {
    if (!a) return;
    switch (a.kind) {
      case "sequence": for (const x of a.actions ?? []) await this.run(x); return;
      case "condition": return this.run(this.cond(a.if) ? a.then : a.else);
      case "setState": setPath(this.state, a.path, this.resolve(a.value)); return;
      case "clearState": setPath(this.state, a.path, undefined); return;
      case "toggleInArray": {
        const cur = this.get(a.path);
        const list = Array.isArray(cur) ? [...cur] : [];
        const at = list.indexOf(a.value);
        if (at >= 0) list.splice(at, 1); else list.push(a.value);
        setPath(this.state, a.path, list);
        return;
      }
      case "toast": this.said.push(String(this.resolve(a.message) ?? "")); return;
      case "haptic": return;
      case "navigate": this.went.push({ kind: "navigate", screenId: a.screenId, ...(a.params ? { params: this.resolve(a.params) as Record<string, unknown> } : {}), ...(a.replace ? { replace: true } : {}) }); return;
      case "navigateBack": this.went.push({ kind: "back" }); return;
      case "callEndpoint": {
        const path = String(a.path).replace(/\$state\.[A-Za-z0-9_.]+/g, (m) => encodeURIComponent(String(this.get(m.slice(7)) ?? "")));
        const body = a.body != null ? this.resolve(a.body) : undefined;
        try {
          const res = await this.send(a.method, path, body);
          if (a.assignTo) setPath(this.state, a.assignTo, res);
          await this.run(a.onSuccess);
        } catch (err) {
          const server = (err as { server?: { code?: string; message?: string } }).server;
          setPath(this.state, "lastError", server ? { code: server.code, message: server.message } : null);
          await this.run(a.onError);
        }
        return;
      }
      default: throw new Error(`an action this test does not run: ${a.kind}`);
    }
  }

  /** Shown: its own visibleIf and every one above it hold. */
  shown(n: Node): boolean {
    for (let x: Node | undefined = n; x; x = this.parent.get(x)) if (x.visibleIf && !this.cond(x.visibleIf as Act)) return false;
    return true;
  }
  private textOf(n: Node): string {
    const b = (n.bind as { content?: string } | undefined)?.content;
    return b ? String(this.get(b) ?? "") : String(n.props?.content ?? "");
  }
  /** Every word on screen now, in order (bound texts as they read). */
  words(): string[] {
    return this.nodes.filter((n) => n.type === "Text" && this.shown(n)).map((n) => this.textOf(n)).filter(Boolean);
  }
  /** The pressable shown now whose own words are `label` (within draft `slot` when given). */
  pressable(label: string, o: { slot?: number } = {}): Node {
    const found = this.nodes.filter((n) => n.on?.onPress && this.shown(n)
      && walk(n).some((x) => x.type === "Text" && this.textOf(x) === label)
      && !walk(n).slice(1).some((x) => x.on?.onPress && walk(x).some((y) => y.type === "Text" && this.textOf(y) === label))
      && (o.slot === undefined || this.within(n, `chk.items.${o.slot}.`)));
    if (!found.length) throw new Error(`nothing to tap that says "${label}"; on screen: ${this.words().join(" | ")}`);
    return found[0]!;
  }
  private within(n: Node, prefix: string): boolean {
    for (let x: Node | undefined = n; x; x = this.parent.get(x)) if (JSON.stringify(x.visibleIf ?? "").includes(prefix)) return true;
    return false;
  }
  tap(label: string, o: { slot?: number } = {}): Promise<void> { return this.run(this.pressable(label, o).on!.onPress as Act); }
  /** Types into the field bound to `path` (it must be on screen). */
  type(path: string, value: string): void {
    const f = this.nodes.find((n) => n.type === "TextField" && n.bind?.value === path && this.shown(n));
    if (!f) throw new Error(`no field for ${path} on screen`);
    setPath(this.state, path, value);
  }
  submit(path: string): Promise<void> {
    const f = this.nodes.find((n) => n.type === "TextField" && n.bind?.value === path && this.shown(n))!;
    return this.run(f.on!.onSubmit as Act);
  }
}

const makeScreen = async (s: Server, client: Client, params: Record<string, unknown>) => new Driver(await build(s, "bots.plan.make", client, params), client, s.send);
const posts = (s: Server, path: string) => s.sent.filter((x) => x.method === "POST" && x.path === path);

let S: Server;
beforeEach(async () => { vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests(); S = await server(); });
afterEach(async () => { await S.app.close(); setPlanFollows(null); setPlanCapture(null); setPlanEase(null); vi.useRealTimers(); vi.unstubAllEnvs(); resetConfigForTests(); });

describe("Plan something, driven through the real routes", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`${client}: the box's Send fills the check face (make/draft), Done adds it (make), the home opens on its day with Added, and Undo takes it out`, async () => {
      const m = await makeScreen(S, client, { from: "plan", day: "2026-11-12" });
      // The screen's own load: GET .../plan/make, the real setup.
      expect(S.sent[0]).toMatchObject({ method: "GET", path: `${MK}?tz=${IST}`, status: 200, answer: { today: "2026-11-12", follow: true, ai: "ask" } });
      expect(m.words()).toEqual(expect.arrayContaining(["For who", "You", "Dad", "Sunita Sharma"]));
      m.type("say", "Dentist Sat 5 pm");
      await m.submit("say");
      const draft = posts(S, `${MK}/draft`)[0]!;
      expect(draft).toMatchObject({ status: 200, body: { words: "Dentist Sat 5 pm", tz: IST, d: CARD0("2026-11-12"), list: [], at: "0", day: "2026-11-12" } });
      expect(Object.keys(draft.body as object).sort()).toEqual(["at", "d", "day", "list", "tz", "words"]);
      expect(m.get("step")).toBe("check");
      expect(m.get("busy")).toBe("");
      expect(m.get("key")).toMatch(UUID);
      expect(m.get("say")).toBeUndefined();
      expect(m.words()).toEqual(expect.arrayContaining(["X0 checked", "Dentist", "Sat 14 Nov · 5 pm", "For you", "Looks good", "Change", "Done"]));

      await m.tap("Done");
      const done = posts(S, MK)[0]!;
      expect(done).toMatchObject({ status: 200, body: { key: m.get("key"), list: m.get("list"), tz: IST } });
      expect(Object.keys(done.body as object).sort()).toEqual(["key", "list", "tz"]);
      expect(done.answer).toMatchObject({ ok: true, n: 1, day: "2026-11-14", line: "Added: Dentist, Sat 14 Nov, 5\u00a0pm" });
      expect(m.went).toEqual([{ kind: "back" }, { kind: "navigate", screenId: "bots.plan", replace: true, params: { day: "2026-11-14", made: m.get("key"), n: 1 } }]);

      // The home, opened as Done opened it: GET .../plan/day with exactly those params.
      const nav = m.went[1] as { params: Record<string, unknown> };
      const h = new Driver(await build(S, "bots.plan", client, nav.params), client, S.send);
      const day = S.sent.find((x) => x.path.startsWith(`${A}/plan/day`))!;
      expect(day).toMatchObject({ method: "GET", path: `${A}/plan/day?tz=${IST}&day=2026-11-14&made=${m.get("key")}&n=1`, status: 200, answer: { day: "2026-11-14", added: { line: "Added: Dentist, Sat 14 Nov, 5\u00a0pm", key: m.get("key"), n: 1 } } });
      expect(h.words()).toEqual(expect.arrayContaining(["Added: Dentist, Sat 14 Nov, 5\u00a0pm", "Undo", "Saturday · Sat 14 Nov", "5:00 pm", "Dentist", "1 h"]));
      expect((day.answer as { thread: Array<{ k: string; fresh?: boolean }> }).thread.find((x) => x.k === "row")).toMatchObject({ fresh: true });
      await h.tap("Undo");
      expect(posts(S, `${MK}/undo`)[0]).toMatchObject({ status: 200, body: { key: m.get("key"), n: 1 }, answer: { ok: true, removed: 1 } });
      expect(h.said).toEqual(["Taken out"]);
      expect(h.went).toEqual([{ kind: "navigate", screenId: "bots.plan", replace: true, params: { day: "2026-11-14" } }]);
      expect((await S.calendar.list(U, { from: "2026-11-12", to: "2026-11-20", tz: IST })).events).toEqual([]);
    });
  }

  it("the card: Check posts the card at `at` with the day it opened on; For who and Must not miss reach follow-through at Done", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("d.title", "Pick up Kabir");
    await m.tap("Tomorrow");
    await m.tap("6 pm");
    await m.tap("Dad");
    expect(m.words()).toContain("They get the reminder on their phone.");
    await m.tap("Must not miss");
    await m.tap("+ Place");
    m.type("d.place", "HSR Layout");
    await m.tap("Check");
    const check = posts(S, `${MK}/check`)[0]!;
    expect(check).toMatchObject({
      status: 200,
      body: { list: [], tz: IST, at: "0", day0: "2026-11-12", d: { ...CARD0("2026-11-12"), title: "Pick up Kabir", day: "2026-11-13", time: "18:00", who: DAD, imp: "must", place: "HSR Layout" } },
    });
    expect(Object.keys(check.body as object).sort()).toEqual(["at", "d", "day0", "list", "tz"]);
    expect(m.words()).toEqual(expect.arrayContaining(["Pick up Kabir", "Tomorrow · 6 pm", "For Dad · reminded at 5:45 pm", "Must not miss", "HSR Layout", "Looks good"]));
    // Dad's tiny bot beside the line, nobody else's.
    expect(m.nodes.filter((n) => n.type === "PersonBot" && m.shown(n)).map((n) => n.props?.label)).toEqual(["Dad"]);
    await m.tap("Done");
    expect(posts(S, MK)[0]!.answer).toMatchObject({ ok: true, n: 1, day: "2026-11-13", line: "Added: Pick up Kabir, Fri 13 Nov, 6\u00a0pm · X0 reminds Dad at 5:45\u00a0pm" });
    const ev = (await S.calendar.list(U, { from: "2026-11-13", to: "2026-11-13", tz: IST })).events[0]!;
    expect(ev).toMatchObject({ title: "Pick up Kabir", place: "HSR Layout", importance: "must", people: [expect.objectContaining({ id: DAD })] });
  });

  it("the What words are read on Check by the day it opened on; the box's words take the day being looked at", async () => {
    // "Dentist Sat 5 pm" in What with nothing picked checks as Saturday 5 pm (day0 in the check body).
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("d.title", "Dentist Sat 5 pm");
    await m.tap("Check");
    expect(m.words()).toEqual(expect.arrayContaining(["Dentist", "Sat 14 Nov · 5 pm"]));
    // A day the person picked is never overwritten by the title.
    await m.tap("Change");
    expect(m.get("step")).toBe("edit");
    m.type("d.title", "Friday prayer");
    await m.tap("Sat 14");
    await m.tap("Any time");
    await m.tap("Check");
    expect(m.words()).toEqual(expect.arrayContaining(["Friday prayer", "To do · Sat 14 Nov"]));
    // From the home on Saturday, "Dentist 5 pm" in the box is Saturday (the draft body's day).
    const sat = await makeScreen(S, "desktop", { from: "plan", day: "2026-11-14" });
    sat.type("say", "Dentist 5 pm");
    await sat.submit("say");
    expect(posts(S, `${MK}/draft`).at(-1)!.body).toMatchObject({ day: "2026-11-14" });
    expect(sat.words()).toEqual(expect.arrayContaining(["Dentist", "Sat 14 Nov · 5 pm"]));
  });

  it("a note's fix posts make/check with its id from state; Change opens the card filled; Check again", async () => {
    const m = await makeScreen(S, "desktop", { from: "plan", day: "2026-11-12" });
    m.type("d.title", "Gym");
    await m.tap("Other time");
    m.type("d.timeWords", "7");
    await m.tap("Check");
    expect(m.words()).toEqual(expect.arrayContaining(["Gym", "7 am or 7 pm?", "7 am", "7 pm"]));
    const before = structuredClone(m.get("list"));
    await m.tap("7 pm");
    const fix = posts(S, `${MK}/check`).at(-1)!;
    expect(fix).toMatchObject({ status: 200, body: { list: before, tz: IST, fix: { item: "0", id: "ampm:pm" } } });
    expect(Object.keys(fix.body as object).sort()).toEqual(["fix", "list", "tz"]);
    expect(m.words()).toEqual(expect.arrayContaining(["Gym", "Today · 7 pm", "Looks good"]));
    expect(m.words()).not.toContain("7 am or 7 pm?");
    await m.tap("Change");
    expect(m.get("d")).toMatchObject({ title: "Gym", day: "2026-11-12", time: "other", timeWords: "7 pm", guessed: "" });
    await m.tap("Check");
    expect(m.words()).toEqual(expect.arrayContaining(["Today · 7 pm", "Looks good"]));
  });

  it("two things in one line: two slots and one Done; Take out posts drop; Change on a slot edits that one (at)", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("say", "Dentist Sat 5 pm and haircut Sun 11 am");
    await m.submit("say");
    expect(m.words()).toEqual(expect.arrayContaining(["Dentist", "Sat 14 Nov · 5 pm", "Haircut", "Sun 15 Nov · 11 am", "Adds 2 things to your Plan.", "Take out"]));
    // Change on the second: the card is that draft, at "1"; a new time, then Check posts it at 1.
    await m.tap("Change", { slot: 1 });
    expect(m.get("at")).toBe("1");
    expect(m.get("d")).toMatchObject({ title: "Haircut", day: "2026-11-15" });
    await m.tap("12 pm");
    await m.tap("Check");
    expect(posts(S, `${MK}/check`).at(-1)!.body).toMatchObject({ at: "1", d: { title: "Haircut", time: "12:00" } });
    expect(m.words()).toEqual(expect.arrayContaining(["Dentist", "Haircut", "Sun 15 Nov · 12 pm"]));
    await m.tap("Take out", { slot: 0 });
    expect(posts(S, `${MK}/check`).at(-1)).toMatchObject({ status: 200, body: { list: expect.any(Array), tz: IST, drop: "0" } });
    expect(m.words()).not.toContain("Dentist");
    expect(m.words()).not.toContain("Adds 2 things to your Plan.");
    await m.tap("Done");
    expect(posts(S, MK)[0]!.answer).toMatchObject({ n: 1, day: "2026-11-15", line: "Added: Haircut, Sun 15 Nov, 12\u00a0pm" });
    // One left: no Take out (Change and Done only).
    const one = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    one.type("say", "Dentist Sat 5 pm and haircut Sun 11 am");
    await one.submit("say");
    await one.tap("Take out", { slot: 1 });
    expect(one.words()).toEqual(expect.arrayContaining(["Dentist", "Change", "Done"]));
    expect(one.words()).not.toContain("Take out");
  });

  it("Done after the time passed: 400 fix_first is said, and the check face is drawn again with the stop and its fixes", async () => {
    const m = await makeScreen(S, "phone", {});
    m.type("d.title", "Call the bank");
    await m.tap("Other time");
    m.type("d.timeWords", "10:30 am");
    await m.tap("Check");
    expect(m.words()).toEqual(expect.arrayContaining(["Today · 10:30 am", "Looks good"]));
    S.at(T0 + 45 * MIN);
    await m.tap("Done");
    const done = posts(S, MK)[0]!;
    expect(done).toMatchObject({ status: 400, answer: { code: "fix_first", message: "That time has passed." } });
    expect(m.said).toEqual(["That time has passed."]);
    const again = posts(S, `${MK}/check`).at(-1)!;
    expect(again.body).toEqual({ list: m.get("list"), tz: IST });
    expect(m.get("busy")).toBe("");
    expect(m.words()).toEqual(expect.arrayContaining(["That time has passed.", "Tomorrow, same time"]));
    expect(m.words()).not.toContain("Looks good");
    // Done with the stop up says it and sends nothing.
    await m.tap("Done");
    expect(posts(S, MK)).toHaveLength(1);
    expect(m.said.at(-1)).toBe("That time has passed.");
    await m.tap("Tomorrow, same time");
    expect(m.words()).toEqual(expect.arrayContaining(["Tomorrow · 10:30 am", "Looks good"]));
    await m.tap("Done");
    // Opened from elsewhere (no from): back, with the line.
    expect(posts(S, MK).at(-1)).toMatchObject({ status: 200, answer: { day: "2026-11-13" } });
    expect(m.went).toEqual([{ kind: "back" }]);
    expect(m.said.at(-1)).toBe("Added: Call the bank, Fri 13 Nov, 10:30\u00a0am");
  });

  it("a second tap while Done is on its way sends nothing; a retry with the same key answers the same rows", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("say", "Dentist Fri 5 pm");
    await m.submit("say");
    const done = m.pressable("Done").on!.onPress as Act;
    const first = m.run(done);
    const second = m.run(done);
    await Promise.all([first, second]);
    expect(posts(S, MK)).toHaveLength(1);
    // The same key again (a lost answer): the same rows, nothing new.
    const again = await S.send("POST", MK, { key: m.get("key"), list: m.get("list"), tz: IST });
    expect(again).toEqual(posts(S, MK)[0]!.answer);
    expect((await S.calendar.list(U, { from: "2026-11-13", to: "2026-11-13", tz: IST })).events).toHaveLength(1);
  });

  it("a bill's preview: Change puts the words back; Done runs the box (plan/box) and its line shows", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("say", "Electricity 2140 due 14th");
    await m.submit("say");
    // What Done would add, from the box's own due reader; the words leave the box (they are in the preview) until Change.
    expect(m.words()).toEqual(expect.arrayContaining(["Looks like a bill. Add it?", "Electricity ₹2,140 · due Sat 14 Nov"]));
    expect(m.words()).not.toContain("Electricity 2140 due 14th");
    expect(m.get("say") ?? "").toBe("");
    // Under the header, above the card: on screen when it comes, not below the edit face's long card.
    expect(m.words().indexOf("Looks like a bill. Add it?")).toBeLessThan(m.words().indexOf("What"));
    expect(m.get("step")).toBe("edit");
    await m.tap("Change");
    expect(m.get("say")).toBe("Electricity 2140 due 14th");
    expect(m.get("pre")).toBeUndefined();
    await m.submit("say");
    await m.tap("Done");
    const box = posts(S, `${A}/plan/box`)[0]!;
    expect(box).toMatchObject({ status: 200, body: { words: "Electricity 2140 due 14th", tz: IST } });
    expect(Object.keys(box.body as object).sort()).toEqual(["tz", "words"]);
    expect(m.get("pre")).toBeUndefined();
    expect(m.words().some((w) => /^Added: Electricity/.test(w))).toBe(true);
    expect(posts(S, MK)).toHaveLength(0);
    const tasks = async () => (await S.calendar.list(U, { from: "2026-11-12", to: "2026-11-20", tz: IST })).tasks.filter((t) => !t.done);
    expect((await tasks()).map((t) => t.title)).toEqual([expect.stringMatching(/^Electricity/)]);
    // Its Undo, through the act door (POST /v1/widgets/act), as the box's own Undo.
    await m.tap("Undo");
    expect(S.sent.at(-1)).toMatchObject({ method: "POST", path: "/v1/widgets/act", status: 200, body: { item: expect.stringMatching(/^pt:/), action: "undo" } });
    expect(m.get("boxed")).toBeUndefined();
    expect(await tasks()).toEqual([]);
  });

  it("Read it with AI: the card's What through make/draft with keep 1; no yes, no read and the Turn on AI line; with the yes, one read of the words only", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("d.title", "meet Rahul around 7ish after his class");
    await m.tap("Check");
    expect(m.get("chk.messy")).toBe(true);
    expect(m.words()).toEqual(expect.arrayContaining(["Some words were hard to read.", "Read it with AI"]));
    const list = structuredClone(m.get("list"));
    await m.tap("Read it with AI");
    const read = posts(S, `${MK}/draft`).at(-1)!;
    expect(read).toMatchObject({ status: 200, body: { words: "meet Rahul around 7ish after his class", keep: "1", tz: IST, at: "0", day: "2026-11-12", list, d: (list as unknown[])[0] } });
    expect(Object.keys(read.body as object).sort()).toEqual(["at", "d", "day", "keep", "list", "tz", "words"]);
    expect(S.reads).toHaveLength(0);
    expect(m.words()).toEqual(expect.arrayContaining(["X0 filled in what it could. Check the day and the time.", "X0 can read messy words better with AI.", "Turn on AI"]));
    // With the person's yes: Check, then Read it with AI reads once, only the words.
    S.yes(true);
    S.answer({ items: [{ title: "Meet Rahul", day: "2026-11-12", time: "19:00", time_said: false, repeat: "", weekdays: [], who: "Rahul", place: "" }], change: false });
    await m.tap("Change");
    await m.tap("Check");
    await m.tap("Read it with AI");
    expect(S.reads).toHaveLength(1);
    expect(S.reads[0]!.user).toBe("<message>Meet Rahul around 7ish after his class</message>");
    expect(S.reads[0]!.user).not.toMatch(/Dad|Sunita/);
    expect(m.words()).toEqual(expect.arrayContaining(["Today · 7 pm", "7 am or 7 pm?"]));
    // Check, its fixes and Done never read.
    await m.tap("7 pm");
    await m.tap("Done");
    expect(S.reads).toHaveLength(1);
  });

  it("Read it with AI with no yes, then Turn on AI and Agree: the card's words are read again as the card's (keep 1), its picks stay", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("d.title", "meet Rahul around 7ish after his class");
    await m.tap("Sat 14");
    await m.tap("Dad");
    await m.tap("Must not miss");
    await m.tap("Check");
    await m.tap("Read it with AI");
    expect(S.reads).toHaveLength(0);
    expect(m.get("d")).toMatchObject({ day: "2026-11-14", who: DAD, imp: "must" });
    await m.tap("Turn on AI");
    expect(m.words()).toContain("Agree");
    S.answer({ items: [{ title: "Meet Rahul", day: null, time: "19:00", time_said: false, repeat: "", weekdays: [], who: "Rahul", place: "" }], change: false });
    await m.tap("Agree");
    const refill = posts(S, `${MK}/draft`).at(-1)!;
    expect(refill).toMatchObject({ status: 200, body: { words: "meet Rahul around 7ish after his class", keep: "1" } });
    expect(S.reads).toHaveLength(1);
    // The reading filled only what the card left empty (the time); Dad, must not miss and Saturday stay as picked.
    expect(m.get("d")).toMatchObject({ title: "Meet Rahul", day: "2026-11-14", who: DAD, imp: "must" });
    expect(m.words()).toEqual(expect.arrayContaining(["Meet Rahul", "Sat 14 Nov · 7 pm", "Must not miss"]));
    expect(m.words().some((w) => w.startsWith("For Dad"))).toBe(true);
  });

  it("a question goes to the chat as the box did; a day's question shows the box's own answer", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("say", "What's on tomorrow?");
    await m.submit("say");
    expect(posts(S, `${MK}/draft`)[0]!.answer).toMatchObject({ kind: "box", box: { kind: "day" } });
    expect(m.get("boxed")).toMatchObject({ kind: "day" });
    expect(m.words()).toContain("Open chat");
    expect(m.get("say")).toBeUndefined();
  });
});

describe("the home's own calls", () => {
  it("a to-do made by Done is ticked on the home through the act door", async () => {
    const m = await makeScreen(S, "phone", { from: "plan", day: "2026-11-12" });
    m.type("d.title", "Buy milk");
    await m.tap("Check");
    expect(m.words()).toEqual(expect.arrayContaining(["Buy milk", "To do · today", "Looks good"]));
    await m.tap("Done");
    const nav = m.went.at(-1) as { params: Record<string, unknown> };
    expect(nav.params).toMatchObject({ day: "2026-11-12", n: 1 });
    const h = new Driver(await build(S, "bots.plan", "phone", nav.params), "phone", S.send);
    expect(h.words()).toEqual(expect.arrayContaining(["Added: Buy milk, today", "To do", "Buy milk"]));
    const tick = h.nodes.find((n) => h.shown(n) && JSON.stringify(n.on?.onPress ?? "").includes("/v1/widgets/act"))!;
    await h.run(tick.on!.onPress as Act);
    expect(S.sent.at(-1)).toMatchObject({ method: "POST", path: "/v1/widgets/act", status: 200, body: { item: expect.stringMatching(/^pt:/), action: "done" } });
    expect((await S.calendar.list(U, { from: "2026-11-12", to: "2026-11-12", tz: IST })).tasks[0]).toMatchObject({ title: "Buy milk", done: true });
  });

  it("+ and the top area open Plan something on the day shown; the strip and a week param read plan/day by the routes' query", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const h = new Driver(await build(S, "bots.plan", client, { week: "1" }), client, S.send);
      const day = S.sent.filter((x) => x.path.startsWith(`${A}/plan/day`)).at(-1)!;
      expect(day).toMatchObject({ path: `${A}/plan/day?tz=${IST}&week=1`, status: 200, answer: { day: "2026-11-19" } });
      await h.tap("Plan Ease");
      expect(h.went.at(-1)).toEqual({ kind: "navigate", screenId: "bots.plan.make", params: { from: "plan", day: "2026-11-19", focus: "box" } });
      const plus = h.nodes.find((n) => n.props?.accessibilityLabel === "Plan something" && n.on?.onPress) ?? h.pressable("Plan something");
      await h.run(plus.on!.onPress as Act);
      expect(h.went.at(-1)).toEqual({ kind: "navigate", screenId: "bots.plan.make", params: { from: "plan", day: "2026-11-19" } });
      await h.tap("20");
      expect(h.went.at(-1)).toEqual({ kind: "navigate", screenId: "bots.plan", replace: true, params: { day: "2026-11-20" } });
    }
  });
});

describe("the sample states the renders draw are the real answers", () => {
  it("each check face shows the server's own words, on the phone and in the window", async () => {
    const want: Record<string, string[]> = {
      good: ["Dentist", "Fri 30 Oct · 5 pm", "For you", "Looks good"],
      notes: ["Medicine", "Tomorrow · 9 am", "For Dad · reminded at 9 am", "Must not miss", "Clashes with Studio standup at 9:30 am.", "Move to 10:30 am", "9 am or 9 pm?", "X0 marked it must not miss: it's medicine.", "Keep normal"],
      stop: ["Call the bank", "Today · 8 am", "That time has passed.", "Tomorrow, same time", "Today, 8 pm"],
      multi: ["Dentist", "Haircut", "Sat 31 Oct · 11 am", "Adds 2 things to your Plan.", "Take out"],
      consent: ["Meet Rahul around 7ish after his class", "X0 filled in what it could. Check the day and the time.", "Turn on AI", "Agree"],
      whoIs: ["Take her tablets (Nani)", "Every day · 8 am", "Who is Nani? Pick them.", "Pick", "X0 filled in what it could. Check who it's for.", "Turn on AI"],
      messy: ["meet Rahul around 7ish after his class", "Some words were hard to read.", "Read it with AI"],
      bill: ["Looks like a bill. Add it?", "Electricity ₹2,140 · due Sat 14 Nov"],
      boxDay: ["Open chat"],
    };
    const setup = MAKE_API[`GET ${MK}?tz=${IST}`];
    for (const client of ["phone", "desktop"] as const) {
      const screen = await buildBotsScreen({
        screenId: "bots.plan.make", client, params: MAKE_PARAMS, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(NEW),
        desk: { pages: client === "desktop", notes: false },
      }, fakeDeps({ api: { [`GET ${MK}?tz=${IST}`]: setup }, now: FIXED_NOW }));
      for (const [k, words] of Object.entries(want)) {
        const d = new Driver({ ...screen, state: { ...(screen.state ?? {}), ...MAKE_STATES[k] } }, client, S.send);
        expect(d.words(), `${client} ${k}`).toEqual(expect.arrayContaining(words));
      }
    }
  });
});
