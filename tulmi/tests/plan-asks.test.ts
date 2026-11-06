/**
 * PLAN EASE, STEP 5: FAMILY ASKS, REPEATS AND TURNS (docs/plan-ease-people.md; src/botsBots/planAsks.ts, planAskWords.ts, spaceTasks.ts):
 *
 *   - the words: what, which days (two days are two asks), the time and place, "every Sunday", turns named or "Who's in?"
 *   - nothing goes out until [Ask]; then one push each and a card with the asker's tiny bot; the first "I'll do it" wins, lands on
 *     their day, the asker hears quietly, a late tap hears who has it; no "gave you a task" push, ever
 *   - one quiet nudge halfway; nobody by the take-by and the asker hears, with [I'll do it]; it stays open for the family
 *   - the evening note says who's doing what
 *   - turns: in the order named, one push the evening before, [Can't do it] passes it on, a Done moves the turn on; "Who's in?" starts
 *     with whoever tapped first
 *   - an open ask is on nobody's day and in nobody's list; health words stay plain; Spaces off or the switch off: the chat, as before
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
const { PlanAsks, setPlanAsks, plugAsks, ASK_NEEDS } = await import("../src/botsBots/planAsks.js");
const { readAsk, askQuestion, noneWords, takeByOf, baseVerb, thirdPerson, ingOf } = await import("../src/botsBots/planAskWords.js");
const { eveningNote } = await import("../src/botsBots/planNotes.js");
const { removePlanSource } = await import("../src/botsBots/planSources.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { resetConfigForTests } = await import("../src/config.js");

const MIN = 60_000;
const IST = 330;
/** November 2026, India's wall clock, as UTC ms: Mon 9, Tue 10, Wed 11, Thu 12, Sat 14, Sun 15. */
const ist = (day: number, h: number, m = 0) => Date.UTC(2026, 10, day, h, m) - IST * MIN;
const P = "aaaaaaaa-0000-4000-8000-00000000000a"; // Priya, who asks
const M = "aaaaaaaa-0000-4000-8000-00000000000b"; // Mom
const A = "aaaaaaaa-0000-4000-8000-00000000000c"; // Arjun
const R = "aaaaaaaa-0000-4000-8000-00000000000d"; // Rohan
const X = "aaaaaaaa-0000-4000-8000-00000000000e"; // someone in no space

type Push = { userId: string; kind: string; key: string; vars: Record<string, string>; data: Record<string, string>; category?: string };

/** Ghar: Priya (its admin), Mom, Arjun and Rohan; the calendar, the space's tasks, the asks and Plan Ease, on one clock. */
async function ghar(t0: number, o: { blocked?: Array<[string, string]> } = {}) {
  resetAreaTablesForTests();
  resetSpaceTablesForTests();
  const clock = { t: t0 };
  const now = () => clock.t;
  const spaces = new Spaces(null, now, { outbox: new MailOutbox(new MemoryPaged(), now), mailer: NOT_CONFIGURED, origin: () => "https://app.example.in" });
  const { id: space } = await spaces.create(P, "Ghar", "Priya");
  const row = (await spaces.spaceRow(space))!;
  for (const [u, name] of [[M, "Mom"], [A, "Arjun"], [R, "Rohan"]] as const) await spaces.addMember(row, { id: u }, name, { consent: 2 });
  const cal = new Calendar({ rows: memoryCalendarRows(), now, publish: () => undefined });
  const taskRows = new MemoryPaged();
  const pushes: Push[] = [];
  const tasks = new SpaceTasks(spaces, now, { rows: taskRows as never, publish: () => undefined, notify: async (u, m) => { pushes.push({ userId: u, ...m }); }, days: cal });
  cal.onSpaceAnswer((u, s, t, st) => tasks.answer(u, s, t, { status: st }));
  // Who has a block between them (blocks.ts hiddenFor: either way round).
  const blocks = { hiddenFor: async (v: string) => new Set((o.blocked ?? []).flatMap(([a, b]) => (a === v ? [b] : b === v ? [a] : []))) };
  const asks = new PlanAsks(spaces, { rows: taskRows as never, client: null, now, days: cal, publish: () => undefined, notify: async (u, m) => { pushes.push({ userId: u, ...m }); }, blocks });
  setPlanAsks(asks);
  plugAsks();
  tasks.onAnswer((u, r, st) => asks.answered(u, r, st));
  const ease = new PlanEase({ calendar: cal, prefs: memoryPlanPrefs(now), skips: new MemoryTable(), now, send: async (u, m) => { pushes.push({ userId: u, ...m, data: m.data ?? {} }); } });
  ease.attach();
  const door = new QuickActs({ spaceTasks: tasks, threads: null, approvals: null, jobs: null, plan: { scope: (i, a) => ease.scope(i, a), act: (u, i, a) => ease.act(u, i, a) } }, new MemoryQuickActionStore(), now);
  const policy = { inPlaceRisks: ["read"], modes: {}, tokenEnabled: true };
  const act = (who: string, item: string, action: string, via: { kind: "session" } | { kind: "widget"; scopes: Array<"task.done" | "needs.answer"> } = { kind: "session" }) =>
    door.run(who, { item, action }, via, policy);
  const kinds = (kind: string) => pushes.filter((p) => p.kind === kind);
  return { clock, space, spaces, cal, tasks, asks, ease, act, pushes, kinds };
}

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanAsks(null); removePlanSource("ask"); });

// ===================================================================== the words

describe("family asks: the words", () => {
  const mon = ist(9, 10);

  it("read what, which days, the time and the place", () => {
    expect(readAsk("Who picks Kabir up Wednesday and Thursday at 1 pm?", mon, IST))
      .toMatchObject({ base: "pick Kabir up", title: "Kabir pickup", days: ["2026-11-11", "2026-11-12"], time: 13 * 60, repeat: null, turns: null });
    expect(readAsk("Can someone drop Riya at school tomorrow?", mon, IST)).toMatchObject({ title: "Riya drop", days: ["2026-11-10"] });
    expect(readAsk("Who's doing the groceries Sunday?", mon, IST)).toMatchObject({ base: "do the groceries", title: "Groceries", days: ["2026-11-15"] });
    expect(readAsk("Who picks Kabir up from Little Steps every Wednesday at 1 pm?", mon, IST))
      .toMatchObject({ title: "Kabir pickup", repeat: { every: "week", days: [3] }, days: ["2026-11-11"], time: 13 * 60 });
    expect(readAsk("ask Ghar: who can take Amma to the temple Saturday?", mon, IST)).toMatchObject({ space: "Ghar", days: ["2026-11-14"] });
  });

  it("read turns, named in order or \"Who's in?\"", () => {
    expect(readAsk("Arjun and Rohan take turns watering the plants every Sunday", mon, IST))
      .toMatchObject({ base: "water the plants", title: "Plants", turns: { names: ["Arjun", "Rohan"] }, repeat: { every: "week", days: [0] }, days: ["2026-11-15"] });
    expect(readAsk("Plants every Sunday, taking turns", mon, IST)).toMatchObject({ title: "Plants", turns: { names: [] }, repeat: { every: "week", days: [0] } });
    expect(readAsk("Me and Arjun take turns doing the dishes every day", mon, IST)).toMatchObject({ title: "Dishes", turns: { names: ["me", "Arjun"] }, repeat: { every: "day", days: [] } });
  });

  it("leave everything else to the other slots and the chat", () => {
    for (const w of ["Who is Rahul?", "Who's free Saturday?", "Who's coming tomorrow?", "Dentist Fri 5 pm", "Rahul will send the numbers by Thursday", "Who picks Kabir up?"]) {
      expect(readAsk(w, mon, IST), w).toBeNull();
    }
  });

  it("say it plainly for a health visit, and never \"tomorrow\" where words are read later", () => {
    const r = readAsk("Who takes Amma to the doctor Saturday?", mon, IST)!;
    expect(askQuestion({ base: r.base, title: r.title, day: r.days[0]!, repeat: null }, mon, IST)).toBe("Who can help Saturday?");
    expect(noneWords({ base: r.base, title: r.title, day: r.days[0]!, time: null, turns: false }, mon, IST).title).toBe("Nobody's taken Saturday's appointment yet");
    expect(askQuestion({ base: "pick Kabir up", title: "Kabir pickup", day: "2026-11-10", repeat: null }, mon, IST)).toBe("Who picks Kabir up Tuesday?");
  });

  it("put verbs in their forms, and the take-by where the design says", () => {
    expect(["picks", "doing", "taking", "dropping", "watering", "carries", "does"].map(baseVerb)).toEqual(["pick", "do", "take", "drop", "water", "carry", "do"]);
    expect(["pick", "do", "carry", "fetch"].map(thirdPerson)).toEqual(["picks", "does", "carries", "fetches"]);
    expect(["pick", "take", "drop"].map(ingOf)).toEqual(["picking", "taking", "dropping"]);
    // 6 pm the day before; asked later, 2 hours on, at least an hour before the thing.
    expect(takeByOf("2026-11-11", 13 * 60, IST, ist(9, 10))).toBe(ist(10, 18));
    expect(takeByOf("2026-11-11", 13 * 60, IST, ist(10, 19))).toBe(ist(10, 21));
    expect(takeByOf("2026-11-11", 13 * 60, IST, ist(11, 11))).toBe(ist(11, 12));
  });
});

// ===================================================================== an ask

describe("family asks: ask, take, nudge, nobody", () => {
  it("send nothing until Ask; then one ask a day, a push each and a card with the asker's tiny bot; the first tap wins", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Who picks Kabir up Wednesday and Thursday at 1 pm?", IST);
    expect(preview).toMatchObject({ slot: "ask", kind: "said", line: "Ask Ghar: who picks Kabir up Wed and Thu at 1 pm?", act: { action: "ask", label: "Ask" }, edit: "Who picks Kabir up Wednesday and Thursday at 1 pm?" });
    expect(g.pushes).toEqual([]);
    expect((await g.ease.read(M, IST)).needs).toBeNull();

    const asked = await g.act(P, preview.act!.item, "ask");
    expect(asked.body).toMatchObject({ ok: true, state: "asked", line: "Asked Ghar. If nobody takes it by 6 pm Tuesday, I'll tell you." });
    expect(g.kinds("space_ask").map((p) => [p.userId, p.vars.title]).sort()).toEqual([
      [M, "Who picks Kabir up Thursday?"], [M, "Who picks Kabir up Wednesday?"], [A, "Who picks Kabir up Thursday?"], [A, "Who picks Kabir up Wednesday?"],
      [R, "Who picks Kabir up Thursday?"], [R, "Who picks Kabir up Wednesday?"],
    ].sort());
    expect(g.kinds("space_ask")[0]!.vars.body).toBe("1 pm. Priya asked.");
    expect(g.kinds("space_ask")[0]!.data.item).toMatch(/^stask:/);
    // A second tap on Ask is the first one's answer: no second round of pushes.
    expect((await g.act(P, preview.act!.item, "ask")).body).toMatchObject({ repeat: true });
    expect(g.kinds("space_ask")).toHaveLength(6);

    const card = (await g.ease.read(M, IST)).needs!;
    expect(card).toMatchObject({ type: "ask", question: "Who picks Kabir up Wednesday?", reason: "Priya asked · 1 pm", person: { name: "Priya" }, category: "x0_claim" });
    expect(card.buttons).toEqual([expect.objectContaining({ id: "take", label: "I'll do it", primary: true, undo: "untake" })]);
    // The widget asks it too, answered in place.
    expect((await g.ease.line(M, IST)).needs?.item).toBe(card.item);

    expect((await g.act(M, card.item, "take", { kind: "widget", scopes: ["needs.answer"] })).body).toMatchObject({ ok: true, state: "taken" });
    const momsWed = (await g.cal.list(M, { from: "2026-11-11", to: "2026-11-11", tz: IST })).events;
    expect(momsWed).toEqual([expect.objectContaining({ title: "Kabir pickup", start: ist(11, 13), from: "Priya", fixed: true })]);
    expect(g.kinds("space_ask_taken")).toEqual([expect.objectContaining({ userId: P, vars: { title: "Mom's picking Kabir up Wednesday", body: "It's on their day." } })]);
    // Arjun's card is Thursday's now; his late tap on Wednesday hears who has it, quietly.
    expect((await g.ease.read(A, IST)).needs?.question).toBe("Who picks Kabir up Thursday?");
    const late = await g.act(A, card.item, "take");
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ message: "Mom's already got it." });
    expect(g.kinds("space_ask_taken").at(-1)).toMatchObject({ userId: A, vars: { title: "Mom's already got it", body: "Wednesday's pickup is sorted." } });
    // Never "Priya gave you a task", never a feed message.
    expect(g.pushes.filter((p) => p.kind === "space_task" || p.kind === "space_plan" || p.kind === "space_feed")).toEqual([]);
    // In the space it's Mom's task now; Thursday's, still open, is in nobody's list.
    expect((await g.tasks.list(P, g.space)).map((t) => [t.title, t.kind, t.people.map((p) => p.name)])).toEqual([["Kabir pickup", "task", ["Mom"]]]);
  });

  it("never ask someone with a block between them and the asker: no push, no card, not on the list of who may take it", async () => {
    const g = await ghar(ist(9, 10), { blocked: [[A, P]] });
    const preview = await g.ease.box(P, "Who picks Kabir up Wednesday at 1 pm?", IST);
    await g.act(P, preview.act!.item, "ask");
    expect(g.kinds("space_ask").map((p) => p.userId).sort()).toEqual([M, R].sort());
    expect((await g.ease.read(A, IST)).needs).toBeNull();
    expect((await g.ease.read(M, IST)).needs?.question).toBe("Who picks Kabir up Wednesday?");
    // Named turns leave them out too.
    const turns = await g.ease.box(P, "Arjun and Rohan take turns watering the plants every Sunday", IST);
    await g.act(P, turns.act!.item, "ask");
    const plants = (await g.asks.store.inSpace(g.space)).find((r) => r.turns && r.asked_ms);
    expect(plants?.turns?.order).toEqual([R]);
  });

  it("nudge the family once halfway, tell the asker if nobody took it, and stay open for the family", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Who picks Kabir up Thursday at 1 pm?", IST);
    await g.act(P, preview.act!.item, "ask");
    // Asked Mon 10 am, take-by Wed 6 pm: halfway is Tue 2 pm.
    g.clock.t = ist(10, 13, 59);
    expect(await g.asks.tick()).toBe(0);
    g.clock.t = ist(10, 14, 1);
    expect(await g.asks.tick()).toBe(1);
    expect(g.kinds("space_ask_nudge").map((p) => p.userId).sort()).toEqual([M, A, R].sort());
    expect(await g.asks.tick()).toBe(0);
    g.clock.t = ist(11, 18, 1);
    expect(await g.asks.tick()).toBe(1);
    expect(g.kinds("space_ask_none")).toEqual([expect.objectContaining({ userId: P, vars: { title: "Nobody's taken Thursday's pickup yet", body: "Kabir, 1 pm." }, category: "x0_claim" })]);
    const mine = (await g.ease.read(P, IST)).needs!;
    expect(mine).toMatchObject({ type: "nobody", question: "Nobody's taken Thursday's pickup yet", reason: "Kabir, 1 pm." });
    expect((await g.ease.read(R, IST)).needs?.type).toBe("ask");
    // Priya does it herself: on her day, no push to herself, the family's cards go.
    expect((await g.act(P, mine.item, "take")).status).toBe(200);
    expect((await g.cal.list(P, { from: "2026-11-12", to: "2026-11-12", tz: IST })).events.map((e) => e.title)).toEqual(["Kabir pickup"]);
    expect(g.kinds("space_ask_taken")).toEqual([]);
    expect((await g.ease.read(R, IST)).needs).toBeNull();
  });

  it("keep an open ask on nobody's day and in nobody's list, and the page's Undo gives a taken one back", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Who picks Kabir up Wednesday at 1 pm?", IST);
    await g.act(P, preview.act!.item, "ask");
    expect(await g.tasks.list(M, g.space)).toEqual([]);
    expect(await g.tasks.givenTo(M)).toEqual([]);
    expect((await g.cal.list(M, { from: "2026-11-11", to: "2026-11-11", tz: IST })).events).toEqual([]);
    const card = (await g.ease.read(M, IST)).needs!;
    await expect(g.tasks.answer(M, g.space, card.item.split(":")[2]!, { status: "done" })).rejects.toMatchObject({ status: 409 });
    await g.act(M, card.item, "take");
    expect((await g.act(M, card.item, "untake")).body).toMatchObject({ state: "undone" });
    expect((await g.cal.list(M, { from: "2026-11-11", to: "2026-11-11", tz: IST })).events).toEqual([]);
    expect((await g.ease.read(A, IST)).needs?.item).toBe(card.item);
  });

  it("open it again for the family when the one who took it can't", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Who picks Kabir up Wednesday at 1 pm?", IST);
    await g.act(P, preview.act!.item, "ask");
    const card = (await g.ease.read(M, IST)).needs!;
    await g.act(M, card.item, "take");
    const ev = (await g.cal.list(M, { from: "2026-11-11", to: "2026-11-11", tz: IST })).events[0]!;
    await g.cal.cantDo(M, ev.id);
    expect((await g.cal.list(M, { from: "2026-11-11", to: "2026-11-11", tz: IST })).events).toEqual([]);
    expect((await g.ease.read(A, IST)).needs?.item).toBe(card.item);
    expect((await g.ease.read(M, IST)).needs).toBeNull();
    expect(g.kinds("space_ask").filter((p) => p.key.includes("again")).map((p) => p.userId).sort()).toEqual([A, R].sort());
  });

  it("say who's doing what in the evening note", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Who picks Kabir up Wednesday at 1 pm?", IST);
    await g.act(P, preview.act!.item, "ask");
    await g.act(M, (await g.ease.read(M, IST)).needs!.item, "take");
    expect(ASK_NEEDS.notes!({ more: { ask: await g.asks.cardsFor(P) } } as never, "2026-11-11")).toEqual(["Kabir pickup: Mom"]);
    // Tuesday evening, Priya's note about Wednesday says so.
    await g.cal.addEvent(P, { title: "Design review", day: "2026-11-11", time: "10:00", tz: IST });
    g.clock.t = ist(10, 20, 0);
    await g.ease.ensure(P, IST, { reschedule: true });
    g.clock.t = ist(10, 20, 31);
    expect(await g.ease.notesTick()).toBe(1);
    expect(g.kinds("plan_evening")[0]!.vars.body).toContain("Kabir pickup: Mom.");
    // Pure: in its own slot, after what to get ready.
    const item = { allDay: false, done: false, fixed: false, source: "me" };
    const words = eveningNote({
      now: ist(10, 20, 30), tz: IST, leaves: new Map(), family: ["Kabir pickup: Mom", "Plants: Arjun"],
      tomorrow: [{ ...item, ref: "event", id: "e1", kind: "event", title: "Design review", day: "2026-11-11", start: ist(11, 10), end: ist(11, 11) }],
      tonight: [{ ...item, ref: "task", id: "t1", kind: "todo", title: "Pack the costume", day: "2026-11-10", start: null, end: null }],
    })!;
    expect(words.title).toBe("Tomorrow: Design review at 10 am");
    expect(words.body).toBe("Tonight: pack the costume. Kabir pickup: Mom, plants: Arjun.");
  });
});

// ===================================================================== turns

describe("family asks: turns", () => {
  it("set up named turns: one push the evening before, Can't do it passes it on, a Done moves the turn on", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Arjun and Rohan take turns watering the plants every Sunday", IST);
    expect(preview).toMatchObject({ slot: "ask", line: "Ask Ghar: plants every Sunday, Arjun then Rohan?", act: { action: "ask" } });
    expect((await g.act(P, preview.act!.item, "ask")).body).toMatchObject({ line: "Done. Arjun's first, Sunday. I'll tell each one the evening before." });
    expect(g.pushes).toEqual([]);
    const arjunSun = async () => (await g.cal.list(A, { from: "2026-11-15", to: "2026-11-15", tz: IST })).tasks;
    expect(await arjunSun()).toEqual([expect.objectContaining({ title: "Plants · your turn", from: "Priya", fixed: true, done: false })]);
    // On his list as a row like any other, with Priya's tiny bot.
    const row = (await g.ease.week(A, IST)).days.find((d) => d.key === "2026-11-15")!.rows[0]!;
    expect(row).toMatchObject({ title: "Plants · your turn", person: { name: "Priya" } });

    g.clock.t = ist(14, 18, 1);
    expect(await g.asks.tick()).toBe(1);
    expect(g.kinds("space_turn")).toEqual([expect.objectContaining({ userId: A, vars: { title: "Your turn: plants on Sunday", body: "You're first." }, category: "x0_turn" })]);
    const item = g.kinds("space_turn")[0]!.data.item!;
    expect((await g.act(A, item, "cant")).body).toMatchObject({ ok: true, state: "passed" });
    expect(g.kinds("space_turn").at(-1)).toMatchObject({ userId: R, vars: { title: "Your turn: plants on Sunday", body: "Arjun can't this time." } });
    expect(await arjunSun()).toEqual([]);
    const rohans = (await g.cal.list(R, { from: "2026-11-15", to: "2026-11-15", tz: IST })).tasks;
    expect(rohans).toEqual([expect.objectContaining({ title: "Plants · your turn" })]);
    g.clock.t = ist(14, 18, 5);
    expect(await g.asks.tick()).toBe(0);

    // Rohan ticks it on his own day: the turn moves on to Arjun, next Sunday, told the evening before who did it last.
    g.clock.t = ist(15, 9);
    await g.cal.tickTask(R, rohans[0]!.id, true);
    expect((await g.cal.list(A, { from: "2026-11-22", to: "2026-11-22", tz: IST })).tasks).toEqual([expect.objectContaining({ title: "Plants · your turn", done: false })]);
    g.clock.t = ist(21, 18, 1);
    expect(await g.asks.tick()).toBe(1);
    expect(g.kinds("space_turn").at(-1)).toMatchObject({ userId: A, vars: { body: "Rohan did it last time." } });
  });

  it("ask Who's in? with no names, and start with whoever tapped first", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Plants every Sunday, taking turns", IST);
    expect(preview.line).toBe("Ask Ghar: Plants every Sunday, taking turns. Who's in?");
    await g.act(P, preview.act!.item, "ask");
    expect(g.kinds("space_ask").map((p) => [p.userId, p.category, p.vars.title]).sort()).toEqual([M, A, R].map((u) => [u, "x0_in", "Plants every Sunday, taking turns. Who's in?"]).sort());
    const card = (await g.ease.read(R, IST)).needs!;
    expect(card.buttons).toEqual([expect.objectContaining({ id: "in", label: "I'm in" })]);
    await g.act(R, card.item, "in", { kind: "widget", scopes: ["needs.answer"] });
    await g.act(M, card.item, "in");
    expect((await g.ease.read(R, IST)).needs).toBeNull();
    g.clock.t = ist(14, 18, 1);
    while (await g.asks.tick()) { /* the nudge, then the start */ }
    expect(g.kinds("space_turn")).toEqual([expect.objectContaining({ userId: R, vars: { title: "Your turn: plants on Sunday", body: "You're first." } })]);
    expect((await g.cal.list(R, { from: "2026-11-15", to: "2026-11-15", tz: IST })).tasks.map((t) => t.title)).toEqual(["Plants · your turn"]);
    expect((await g.ease.read(A, IST)).needs).toBeNull();
  });
});

// ===================================================================== off

describe("family asks: off", () => {
  it("leave the words to the chat with Spaces off, the switch off, or nobody else in a space", async () => {
    const g = await ghar(ist(9, 10));
    expect(await g.ease.box(X, "Who picks Kabir up Wednesday?", IST)).toMatchObject({ slot: "chat", kind: "chat" });
    vi.stubEnv("PLAN_V2_ASKS", "false"); resetConfigForTests();
    expect(await g.ease.box(P, "Who picks Kabir up Wednesday?", IST)).toMatchObject({ kind: "chat" });
    vi.stubEnv("PLAN_V2_ASKS", "true"); vi.stubEnv("SPACES_ENABLED", "false"); resetConfigForTests();
    expect(await g.ease.box(P, "Who picks Kabir up Wednesday?", IST)).toMatchObject({ kind: "chat" });
    expect(await g.asks.cardsFor(M)).toEqual({ cards: [], lines: {} });
    expect(await g.asks.tick()).toBe(0);
  });

  it("answer nothing at the door while Spaces is off, and show no card", async () => {
    const g = await ghar(ist(9, 10));
    const preview = await g.ease.box(P, "Who picks Kabir up Wednesday at 1 pm?", IST);
    await g.act(P, preview.act!.item, "ask");
    const card = (await g.ease.read(M, IST)).needs!;
    vi.stubEnv("SPACES_ENABLED", "false"); resetConfigForTests();
    expect((await g.ease.read(M, IST)).needs).toBeNull();
    expect((await g.act(M, card.item, "take")).status).toBe(404);
  });
});
