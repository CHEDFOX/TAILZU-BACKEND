/**
 * FOLLOW-THROUGH ON A FAMILY ASK (botsBots/planFollow.ts armAsk; planAsks.ts): a pickup ask Mom took is must-not-miss by the rules, so it is
 * followed for her from her landed reminder, Priya being the asker; Can't goes through the ask's own pass-on (planAsks.cant), and the
 * follow waits for whoever takes it next.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable, resetAreaTablesForTests } = await import("../src/botsBots/rows.js");
const { MemoryPaged, resetSpaceTablesForTests } = await import("../src/botsBots/spaceRows.js");
const { Spaces } = await import("../src/botsBots/spaces.js");
const { MailOutbox, NOT_CONFIGURED } = await import("../src/botsBots/mail.js");
const { SpaceTasks } = await import("../src/botsBots/spaceTasks.js");
const { PlanAsks, setPlanAsks, plugAsks } = await import("../src/botsBots/planAsks.js");
const { removePlanSource } = await import("../src/botsBots/planSources.js");
const { PlanFollows, setPlanFollows } = await import("../src/botsBots/planFollow.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { resetConfigForTests } = await import("../src/config.js");

const MIN = 60_000;
const IST = 330;
const ist = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - IST * MIN;
const P = "aaaaaaaa-0000-4000-8000-00000000000a"; // Priya, who asks
const M = "aaaaaaaa-0000-4000-8000-00000000000b"; // Mom
const A = "aaaaaaaa-0000-4000-8000-00000000000c"; // Arjun

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanAsks(null); setPlanFollows(null); removePlanSource("ask"); });

describe("family asks", () => {
  it("asks: a pickup ask taken by Mom is followed from her landed reminder; Can't goes through the ask's own pass-on", async () => {
    vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests();
    resetAreaTablesForTests();
    resetSpaceTablesForTests();
    const clock = { t: ist(9, 10) };
    const now = () => clock.t;
    const spaces = new Spaces(null, now, { outbox: new MailOutbox(new MemoryPaged(), now), mailer: NOT_CONFIGURED, origin: () => "https://app.example.in" });
    const { id: space } = await spaces.create(P, "Ghar", "Priya");
    const row = (await spaces.spaceRow(space))!;
    for (const [u, name] of [[M, "Mom"], [A, "Arjun"]] as const) await spaces.addMember(row, { id: u }, name, { consent: 2 });
    const cal = new Calendar({ rows: memoryCalendarRows(), now, publish: () => undefined });
    const taskRows = new MemoryPaged();
    const pushes: Array<{ userId: string; kind: string; vars?: Record<string, string | number> }> = [];
    const tasks = new SpaceTasks(spaces, now, { rows: taskRows as never, publish: () => undefined, notify: async (u, m) => { pushes.push({ userId: u, ...m }); }, days: cal });
    const asks = new PlanAsks(spaces, { rows: taskRows as never, client: null, now, days: cal, publish: () => undefined, notify: async (u, m) => { pushes.push({ userId: u, ...m }); } });
    setPlanAsks(asks);
    plugAsks();
    tasks.onAnswer((u, r, st) => asks.answered(u, r, st));
    const ease = new PlanEase({ calendar: cal, prefs: memoryPlanPrefs(now), skips: new MemoryTable(), now, send: async (u, m) => { pushes.push({ userId: u, ...m }); } });
    ease.attach();
    const engine = { notify: async (u: string, m: { kind: string; vars?: Record<string, string | number> }) => { pushes.push({ userId: u, ...m }); return { sent: true, dropped: 0, id: `p${pushes.length}` }; }, configFor: () => structuredClone(PUSH_DEFAULTS) };
    // Who each can message: everyone they share a space with (all of Ghar may message; no blocks here).
    const contacts = async (u: string) => {
      const out: Array<{ userId: string; name: string }> = [];
      for (const s of await spaces.mine(u)) for (const m of await spaces.membersOf(s.id)) if (m.userId !== u && !out.some((x) => x.userId === m.userId)) out.push(m);
      return out;
    };
    const follows = new PlanFollows({
      stores: memoryFollowStores(), calendar: cal, now, engine: () => engine as never, calls: () => ({ ring: async () => ({ none: "off" }), closeFor: async () => undefined }) as never,
      settingsOf: async () => structuredClone(DEFAULT_SETTINGS), contacts, spend: (u, d) => ease.policy.spend(u, d), tzOfUser: async () => IST,
    });
    setPlanFollows(follows);
    ease.wire({ follow: (u, c) => follows.arm(u, c) });
    const door = new QuickActs({ spaceTasks: tasks, threads: null, approvals: null, jobs: null, plan: { scope: (i, a) => ease.scope(i, a), act: (u, i, a) => ease.act(u, i, a) } }, new MemoryQuickActionStore(), now);
    const act = (who: string, item: string, action: string) => door.run(who, { item, action }, { kind: "session" }, { inPlaceRisks: ["read"], modes: {}, tokenEnabled: true });

    const preview = await ease.box(P, "Who picks Kabir up Wednesday at 1 pm?", IST);
    await act(P, preview.act!.item, "ask");
    const card = (await ease.read(M, IST)).needs!;
    await act(M, card.item, "take");
    // Mom's landed pickup comes due at 12:45: followed for her, the asker Priya; its own reminder is not sent.
    clock.t = ist(11, 12, 45);
    pushes.length = 0;
    await cal.remind(async (u, m) => { pushes.push({ userId: u, ...m }); });
    const f = (await follows.stores.follows.select({}))[0]!;
    expect(f).toMatchObject({ user_id: P, kind: "ask", why: "pickup", importance: "must", holder_key: `u:${M}`, item: card.item });
    expect(pushes.map((p) => `${p.userId === M ? "M" : p.userId === P ? "P" : "A"}:${p.kind}`)).toEqual(["M:space_follow"]);
    expect(pushes[0]!.vars).toEqual({ title: "Kabir pickup", body: "From Priya · 1 pm" });
    // Mom can't: the ask's own pass-on opens it again for the family; the follow waits for whoever takes it.
    const out = await follows.reply({ followId: f.id, by: `u:${M}`, answer: "cant", via: "app", n: 1 });
    expect(out.body.state).toBe("nobody");
    expect(pushes.some((p) => p.userId === A && p.kind === "space_ask")).toBe(true);
    // Arjun takes it: the next look (every 5 minutes while nobody has it) follows it for him.
    await act(A, card.item, "take");
    clock.t = ist(11, 12, 51);
    await follows.sweep(clock.t);
    const after = (await follows.stores.follows.select({}))[0]!;
    expect(after).toMatchObject({ holder_key: `u:${A}`, state: "open", n: 2 });
  });
});
