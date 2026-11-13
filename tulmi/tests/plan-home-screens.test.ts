/**
 * PLAN EASE'S HOME, THE THREADED DAY AGAIN, AS DRAWN (screens/bots/planHome.ts; docs/plan-ease.md §2):
 *
 *   - the header: Back, one tappable top area (Plan Ease, its ochre line, the walking bot) and the + beside it; both open "Plan
 *     something" with the day shown, the top area with the box ready
 *   - the week strip, one Needs-you card above the day, the day as a thread (leave-by, weather, free time, follow lines, must not miss,
 *     For Dad with Dad's tiny bot), to-dos with no day, Share, where the day starts; no box and no chips
 *   - after Done: "Added: …" with Undo, the new row outlined, the bot's "celebrate"
 *   - the window; a build without the walking bot; an older build, PLAN_V2_HOME off, PLAN_V2_MAKE off
 *
 * The home is drawn from GET .../plan/day as the real PlanEase.day answers it on the boards' day (samples/planMake.ts PLAN_DAY_API: a
 * calendar in memory, places' travel and follow-through's cards and lines as their sources answer).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { resetConfigForTests } = await import("../src/config.js");
const { addAction } = await import("../src/experience/bots/screens/planItem.js");
const { sampleApi } = await import("./bots-bots-data.js");
const { PLAN_DAY_API, MADE_KEY } = await import("../scripts/bots-render/samples/planMake.js");
type PlanDayData = import("../src/botsBots/planThread.js").PlanDayData;

const U = "aaaaaaaa-0000-4000-8000-000000000001";
const A = "/v1/botsapp/bots";
const DAY = `GET ${A}/plan/day?tz=${IST}`;
const TODAY = PLAN_DAY_API[DAY] as PlanDayData;
const NEW = ["BotsKit", "BotsMotion", "BotBuddy", "KitExtras", "PersonBot", "FontBricolage", "FileUpload", "ActionParams"];

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

async function draw(screenId: string, client: "phone" | "desktop", o: { can?: string[]; params?: Record<string, string>; api?: Record<string, unknown> } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const s = await buildBotsScreen(
    { screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(o.can ?? NEW), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ api: { ...(await sampleApi()), ...PLAN_DAY_API, ...(o.api ?? {}) }, calls, now: FIXED_NOW }),
  );
  const nodes = walk(s.root!);
  return { s, nodes, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")), calls: calls.map((c) => `${c.method} ${c.path}`) };
}

/** Every action under one action, flattened. */
function flat(a: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!a || typeof a !== "object") return out;
  const o = a as Record<string, unknown>;
  out.push(o);
  for (const k of ["actions", "then", "else", "onSuccess", "onError"]) { const v = o[k]; if (Array.isArray(v)) v.forEach((x) => flat(x, out)); else flat(v, out); }
  return out;
}
const actions = (nodes: Node[]) => nodes.flatMap((n) => Object.values(n.on ?? {}).flatMap((v) => flat(v)));
const labelled = (nodes: Node[], label: string) => nodes.find((n) => n.props?.accessibilityLabel === label);
const parentOf = (nodes: Node[], child: Node) => nodes.find((n) => (n.children ?? []).includes(child));

describe("the threaded home", () => {
  it("the phone's home: header with the walking bot in one tappable top area, Back and + beside it, lint clean", async () => {
    const { s, nodes, calls } = await draw("bots.plan", "phone");
    expect(lintTree(s.root!)).toEqual([]);
    expect(calls).toContain(DAY);
    const top = labelled(nodes, "Plan Ease. Tap to plan something.")!;
    expect(top.on?.onPress).toBeTruthy();
    const inside = walk(top);
    expect(inside.some((n) => n.type === "BotBuddy")).toBe(true);
    expect(inside.some((n) => n.type === "Text" && n.props?.content === TODAY.head)).toBe(true);
    // Nothing inside the top area is pressable: Back and + are its siblings.
    expect(inside.slice(1).filter((n) => n.on?.onPress)).toEqual([]);
    const head = parentOf(nodes, top)!;
    expect((head.children ?? []).map((n) => n.props?.accessibilityLabel)).toEqual(["Back", "Plan Ease. Tap to plan something.", "Plan something"]);
    expect(labelled(nodes, "Back")!.on?.onPress).toMatchObject({ kind: "navigateBack" });
    expect(s.liveTopics ?? []).toEqual(expect.arrayContaining(["bot:plan", "calendar", "tasks"]));
    // With the new Spaces, Work in space's tabs sit under the header, as on the week page (workTab.ts), still lint clean.
    for (const client of ["phone", "desktop"] as const) {
      const spaces = await draw("bots.plan", client, { can: [...NEW, "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField"] });
      expect(lintTree(spaces.s.root!)).toEqual([]);
      expect(spaces.calls).toContain(`GET ${A}/work/plan`);
      expect(spaces.texts).toEqual(expect.arrayContaining(["Your work", "Work in space"]));
      expect(spaces.texts.indexOf("Plan Ease")).toBeLessThan(spaces.texts.indexOf("Your work"));
    }
  });

  it("+ and the top area open bots.plan.make with from plan and the day shown; the top area asks for the box", async () => {
    const today = await draw("bots.plan", "phone");
    expect(labelled(today.nodes, "Plan Ease. Tap to plan something.")!.on?.onPress).toEqual({ kind: "navigate", screenId: "bots.plan.make", params: { from: "plan", day: "2026-10-28", focus: "box" } });
    expect(labelled(today.nodes, "Plan something")!.on?.onPress).toEqual({ kind: "navigate", screenId: "bots.plan.make", params: { from: "plan", day: "2026-10-28" } });
    const tomorrow = await draw("bots.plan", "phone", { params: { day: "2026-10-29" } });
    expect(tomorrow.calls).toContain(`${DAY}&day=2026-10-29`);
    expect(labelled(tomorrow.nodes, "Plan something")!.on?.onPress).toMatchObject({ params: { from: "plan", day: "2026-10-29" } });
    // Only well-formed params reach the read; the rest are dropped.
    const odd = await draw("bots.plan", "phone", { params: { day: "2026-1-9", week: "x", made: "not-a-key", n: "50" } });
    expect(odd.calls).toContain(DAY);
    const week = await draw("bots.plan", "phone", { params: { week: "-2" }, api: { [`${DAY}&week=-2`]: TODAY } });
    expect(week.calls).toContain(`${DAY}&week=-2`);
    // Every other "Add" (the week page, Today, Tasks) opens it too.
    expect(addAction("2026-10-30", "task")).toEqual({ kind: "navigate", screenId: "bots.plan.make", params: { day: "2026-10-30", kind: "task" } });
    expect(addAction()).toEqual({ kind: "navigate", screenId: "bots.plan.make", params: {} });
  });

  it("the thread's words: Leave home by…, Free · …, Mom · not done yet, Must not miss, For Dad", async () => {
    const { texts, nodes } = await draw("bots.plan", "phone");
    expect(texts).toEqual(expect.arrayContaining([
      "Today · Wed 28 Oct", "All day", "8:15 pm", "To do",
      "Leave home by 7:50 pm · 25 min to Indiranagar", "Only 15 min to get there · 20 min to HSR Layout", "Rain likely around 8 pm",
      "Mom · not done yet", "Must not miss · 45 min · Indiranagar", "Must not miss · For Dad",
      "Open map", "Share today", "To do, no day · 3", "Your day starts from HSR Layout",
    ]));
    // Dad's 10 pm medicine (a to-do with a time) ends the free time after the pickup: no "Free · 9:30 pm to 11:30 pm" over it.
    expect(texts.filter((t) => t.startsWith("Free · "))).toEqual([]);
    // People are their tiny bots: who set it, who does it.
    for (const who of ["For Mom", "For Dad"]) expect(nodes.some((n) => n.type === "PersonBot" && n.props?.label === who)).toBe(true);
    const all = actions(nodes);
    expect(all.find((a) => a.kind === "openUrl" && String(a.url).startsWith("https://www.google.com/maps/dir/"))).toMatchObject({ handoff: true });
    expect(all.find((a) => a.kind === "openUrl" && String(a.url).startsWith("upi://"))).toBeTruthy();
    // A tick goes through the act door; a row's words open the item.
    const row = (title: string) => TODAY.thread.flatMap((t) => (t.k === "row" && t.row.title === title ? [t.row] : []))[0]!;
    expect(all.find((a) => a.kind === "callEndpoint" && a.path === "/v1/widgets/act" && (a.body as { item?: string }).item === row("Buy fruit costume").tick!.item))
      .toMatchObject({ body: { action: "done" } });
    expect(all.find((a) => a.kind === "navigate" && a.screenId === "bots.plan.item" && (a.params as { id?: string }).id === row("Dentist · Dr. Mehta").open.id)).toBeTruthy();
    // A must row is drawn with the ink edge; a done or past one is faded.
    const card = (title: string) => nodes.find((n) => n.style?.borderRadius === 14 && walk(n).some((x) => x.type === "Text" && x.props?.content === title))!;
    expect(card("Dentist · Dr. Mehta").style).toMatchObject({ borderWidth: 1.5 });
    expect(card("Call with Dev").style).toMatchObject({ borderWidth: 1 });
    expect(card("Studio standup").style).toMatchObject({ opacity: 0.55 });
    // The strip: seven days, today ringed, each threads its day; the arrows a week back and on.
    expect(labelled(nodes, "Thursday 29 Oct")!.on?.onPress).toEqual({ kind: "navigate", screenId: "bots.plan", params: { day: "2026-10-29" }, replace: true });
    expect(labelled(nodes, "The week before")!.on?.onPress).toMatchObject({ params: { day: "2026-10-21" } });
  });

  it("no box and no chips on the home", async () => {
    const { nodes, texts } = await draw("bots.plan", "phone");
    expect(nodes.some((n) => n.type === "TextField" && n.bind?.value === "say")).toBe(false);
    expect(texts).not.toContain("Plan my week");
    expect(texts).not.toContain("What should I do first tomorrow?");
    expect(actions(nodes).some((a) => a.kind === "callEndpoint" && String(a.path).endsWith("/plan/box"))).toBe(false);
  });

  it("one Needs-you card above the day, through the act door", async () => {
    const { texts, nodes } = await draw("bots.plan", "phone");
    expect(texts.filter((t) => t === "Needs you")).toHaveLength(1);
    expect(texts.indexOf("Needs you")).toBeLessThan(texts.indexOf("Today · Wed 28 Oct"));
    expect(texts).toEqual(expect.arrayContaining(["Mom hasn't said done", "Pick up Kabir from tuition · 9:15 pm", "Done", "Look"]));
    expect(actions(nodes).find((a) => a.kind === "callEndpoint" && a.path === "/v1/widgets/act" && (a.body as { item?: string }).item === "pf:f1:1"))
      .toMatchObject({ body: { action: "done" } });
  });

  it("after Done: Added … with Undo, the new row outlined", async () => {
    const params = { day: "2026-10-28", made: MADE_KEY, n: "1" };
    const { texts, nodes, calls, s } = await draw("bots.plan", "phone", { params, can: [...NEW, "BotMoments"] });
    expect(lintTree(s.root!)).toEqual([]);
    expect(calls).toContain(`${DAY}&day=2026-10-28&made=${MADE_KEY}&n=1`);
    expect(texts).toContain("Added: Dentist · Dr. Mehta, today, 8:15\u00a0pm");
    const undo = nodes.find((n) => n.on?.onPress && walk(n).some((x) => x.type === "Text" && x.props?.content === "Undo"))!;
    expect(undo.on?.onPress).toMatchObject({ kind: "callEndpoint", method: "POST", path: `${A}/plan/make/undo`, body: { key: MADE_KEY, n: 1 }, stay: true });
    expect(flat(undo.on?.onPress)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "toast", message: "Taken out" }),
      expect.objectContaining({ kind: "navigate", screenId: "bots.plan", params: { day: "2026-10-28" }, replace: true }),
    ]));
    // The walking bot celebrates once, for a build that plays moments.
    expect(nodes.find((n) => n.type === "BotBuddy")?.props).toMatchObject({ moment: "celebrate", momentMode: "once" });
    // A fresh row has its own mark, never the must row's: Plan Ease's ochre edge on a light ochre ground, and "Just added".
    const fresh: PlanDayData = { ...TODAY, thread: TODAY.thread.map((t) => (t.k === "row" && t.row.title === "Call with Dev" ? { ...t, fresh: true } : t)) };
    const f = await draw("bots.plan", "phone", { api: { [DAY]: fresh } });
    const cardOf = (title: string) => f.nodes.find((n) => n.style?.borderRadius === 14 && walk(n).some((x) => x.type === "Text" && x.props?.content === title))!;
    expect(cardOf("Call with Dev").style).toMatchObject({ borderWidth: 1.5, borderColor: "#8F6A1F", backgroundColor: "#fbf3e4" });
    expect(walk(cardOf("Call with Dev")).some((x) => x.type === "Text" && x.props?.content === "Just added")).toBe(true);
    expect(cardOf("Medicine").style).toMatchObject({ borderWidth: 1.5, borderColor: "#0a0a0a" });
    expect(walk(cardOf("Medicine")).some((x) => x.type === "Text" && x.props?.content === "Just added")).toBe(false);
    // Beside Pay, the bill's grey line has two lines ("Must not miss · Due today" is never cut to "Due to…").
    const bill = walk(cardOf("Electricity ₹2,140")).find((x) => x.type === "Text" && String(x.props?.content ?? "").includes("Due today"))!;
    expect(bill.props?.lines ?? bill.props?.numberOfLines).toBe(2);
    // Without made, no moment and no line.
    const plain = await draw("bots.plan", "phone", { can: [...NEW, "BotMoments"] });
    expect(plain.nodes.find((n) => n.type === "BotBuddy")?.props?.moment).toBeUndefined();
    expect(plain.texts.some((t) => t.startsWith("Added"))).toBe(false);
  });

  it("the window: the same, with the week and to-dos on the right", async () => {
    const { s, texts, nodes } = await draw("bots.plan", "desktop");
    expect(lintTree(s.root!)).toEqual([]);
    // The rail: the days after the one shown, tomorrow first (it is not in the main column), only days with something on.
    expect(texts).toEqual(expect.arrayContaining(["Plan Ease", TODAY.head, "Coming up", "Thu 29", "Fri 30", "Parent-teacher meeting 6:15 pm", "To do, no day · 3", "Needs you", "Today · Wed 28 Oct", "Mom · not done yet"]));
    expect(TODAY.week.map((w) => w.key)).toEqual(["2026-10-29", "2026-10-30", "2026-11-01"]);
    expect(texts).not.toContain("Later this week");
    const plan = nodes.find((n) => n.on?.onPress && walk(n).some((x) => x.type === "Text" && x.props?.content === "Plan something"))!;
    expect(plan.on?.onPress).toEqual({ kind: "navigate", screenId: "bots.plan.make", params: { from: "plan", day: "2026-10-28" } });
    expect(labelled(nodes, "Plan Ease. Tap to plan something.")!.on?.onPress).toMatchObject({ params: { focus: "box" } });
    // A week line threads its day here.
    expect(actions(nodes).find((a) => a.kind === "navigate" && a.screenId === "bots.plan" && (a.params as { day?: string }).day === "2026-10-30")).toBeTruthy();
    expect(nodes.some((n) => n.type === "TextField" && n.bind?.value === "say")).toBe(false);
  });

  it("no BotBuddy: the still avatar, still tappable", async () => {
    const { nodes, s } = await draw("bots.plan", "phone", { can: NEW.filter((c) => c !== "BotBuddy" && c !== "BotsMotion") });
    expect(lintTree(s.root!)).toEqual([]);
    expect(nodes.some((n) => n.type === "BotBuddy")).toBe(false);
    const top = labelled(nodes, "Plan Ease. Tap to plan something.")!;
    expect(top.on?.onPress).toMatchObject({ screenId: "bots.plan.make" });
    expect(walk(top).some((n) => n.type === "Image" || (n.style?.borderRadius === 20 && n.style?.width === 40))).toBe(true);
  });

  it("an older build keeps the week page; PLAN_V2_HOME off gives the simple page; PLAN_V2_MAKE off sends + to the old form", async () => {
    const old = await draw("bots.plan", "phone", { can: ["BotsKit"] });
    expect(old.calls).toContain(`GET ${A}/plan?tz=${IST}&week=0`);
    expect(old.calls.some((c) => c.startsWith(DAY))).toBe(false);
    // Its "Add" opens "Plan something", which draws the old form for it.
    expect(actions(old.nodes).find((a) => a.kind === "navigate" && a.screenId === "bots.plan.make")).toBeTruthy();
    const oldForm = await draw("bots.plan.make", "phone", { can: ["BotsKit"], params: { day: "2026-10-29" } });
    expect(oldForm.texts).toContain("Add to your Plan");

    vi.stubEnv("PLAN_V2_HOME", "false"); resetConfigForTests();
    const simple = await draw("bots.plan", "phone", { api: { [`GET ${A}/plan/today?tz=${IST}`]: { v: 2, today: "2026-10-28", tomorrow: "2026-10-29", next: { big: "Nothing planned yet", grey: "", rung: 6 }, needs: null, days: [], week: [] } } });
    expect(simple.calls).toContain(`GET ${A}/plan/today?tz=${IST}`);
    expect(simple.texts).toContain("See the week");
    vi.unstubAllEnvs();

    vi.stubEnv("PLAN_V2_MAKE", "false"); resetConfigForTests();
    const home = await draw("bots.plan", "phone");
    expect(labelled(home.nodes, "Plan something")!.on?.onPress).toMatchObject({ screenId: "bots.plan.make" });
    const form = await draw("bots.plan.make", "phone", { params: { from: "plan", day: "2026-10-28" } });
    expect(form.texts).toContain("Add to your Plan");
    expect(form.calls.some((c) => c.includes("/plan/make"))).toBe(false);
  });

  it("no initials anywhere", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { texts, nodes } = await draw("bots.plan", client);
      expect(texts.some((t) => /^[A-Z]{1,2}$/.test(t))).toBe(false);
      expect(nodes.filter((n) => n.type === "PersonBot").length).toBeGreaterThan(2);
    }
  });
});
