/**
 * The You tab's Activity (connectors/list.ts activityOf, experience/assistant.ts
 * youCard): the person's last runs, from the run ledger, and how each ended.
 *
 * What must hold: each row of the mapping (a run, and its task when it
 * stopped on a card) says what really happened; waiting first, then running,
 * then the newest that ended, at most five, none from before the last seven
 * days and none whose task Coming up already shows; no rows, no card; a card
 * still waiting opens the confirm sheet; Try again only where there are words
 * to try again with, and it is the card's own Do it with them put back; the
 * lines are in the person's voice and the words of ours in both; the person's
 * words are in state, never in a node; a ledger that cannot be read leaves
 * the card out and the tab whole; and every piece of it is one the store
 * build (622c76e) draws, checked against its own source.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => { throw new Error("no network in this test"); } } };
  },
}));
vi.mock("node:fs/promises", () => ({
  readFile: async () => { throw new Error("no cache here"); },
  writeFile: async () => {},
  mkdir: async () => {},
}));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const { buildScreen } = await import("../src/experience/catalog.js");
const { askAction } = await import("../src/experience/assistant.js");
const { SW, settingsHinglishSeeds } = await import("../src/experience/settingsWords.js");
const { NEON } = await import("../src/experience/touches.js");
const { ACTIVITY_MS, activityOf, assistantView } = await import("../src/connectors/list.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { ALWAYS_ON } = await import("../src/connectors/catalog.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { APPROVAL_TTL_MS, EXPIRED_STEP } = await import("../src/connectors/tasks.js");
const { STUCK_STEP } = await import("../src/connectors/sweeper.js");
const { receiptLine, resetRunStoreForTests, runStore } = await import("../src/runs/index.js");
const { SWEEP_TIMES } = await import("../src/runs/types.js");
const { audit, storeBuilds, typesIn } = await import("./store-audit.js");
type RunView = import("../src/runs/types.js").RunView;
type ActivityItem = import("../src/connectors/list.js").ActivityItem;
type AssistantTask = import("../../shared/types/api.js").AssistantTask;

const NOW = Date.parse("2026-10-26T05:00:00Z");
const MIN = 60_000;

// ---- a small reader for the trees, as you-hand-it.test.ts has one ----------------------

type AnyNode = { type?: string; props?: Record<string, any>; style?: Record<string, any>; on?: Record<string, any>; bind?: Record<string, string>; children?: AnyNode[] };
function nodes(root: unknown, keep: (n: AnyNode) => boolean = () => true): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const n = v as AnyNode;
    if (typeof n.type === "string" && keep(n)) out.push(n);
    for (const c of Object.values(n)) if (c && typeof c === "object") walk(c);
  };
  walk(root);
  return out;
}
function actions(root: unknown): any[] {
  const out: any[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.kind === "string") out.push(o);
    for (const c of Object.values(o)) walk(c);
  };
  walk(root);
  return out;
}
const texts = (root: unknown) => nodes(root, (n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));

// ---- runs and tasks -------------------------------------------------------------------

const run = (runId: string, outcome: RunView["outcome"], o: Partial<RunView> = {}): RunView =>
  ({ runId, surface: "phone", outcome, title: `Asked ${runId}`, at: NOW - MIN, steps: 1, effects: 0, ...o });
const task = (id: string, state: AssistantTask["state"], o: Partial<AssistantTask> = {}): AssistantTask => ({
  id, state, title: `Task ${id}`, steps: [{ at: NOW - MIN, text: `Step of ${id}` }], approval: null, createdAt: NOW - MIN, updatedAt: NOW - MIN, ...o,
});
const card = (id: string, o: Partial<AssistantTask> = {}) =>
  task(id, "waiting", { approval: { id: `a_${id}`, connector: "google-tasks", tool: "add_task", risk: "write", preview: "Add the task Gym" }, ...o });
const one = (r: RunView, tasks: AssistantTask[] = []) => activityOf([r], tasks, NOW)[0];
/** A row as its line reads, in English. */
const reads = (a: ActivityItem | undefined) => a && { state: a.state, line: receiptLine(a.outcome, a.reason, "en") };

// ---- the mapping, row by row ----------------------------------------------------------

describe("activityOf: what each run comes to", () => {
  it("running: Working on it", () => {
    expect(reads(one(run("r1", "running")))).toEqual({ state: "running", line: "Working on it." });
  });

  it("stopped on a card, the card still waiting and under an hour old: waiting, with the task and its app", () => {
    const a = one(run("r1", "needs_you", { reason: "approval", taskId: "t1" }), [card("t1", { updatedAt: NOW - 59 * MIN })]);
    expect(a).toMatchObject({ state: "waiting", taskId: "t1", app: "google-tasks" });
    expect(reads(a)!.line).toBe("Waiting for your OK.");
  });

  it("the card waiting longer than its hour: failed, as expired, whatever the task still says", () => {
    const a = one(run("r1", "needs_you", { reason: "approval", taskId: "t1" }), [card("t1", { updatedAt: NOW - APPROVAL_TTL_MS - MIN })]);
    expect(a).toMatchObject({ state: "failed", reason: "expired" });
    expect(reads(a)!.line).toBe(receiptLine("cancelled", "expired", "en"));
  });

  it("the card answered: done; failed as stuck or as the app's problem; refused (done, You said no) or expired", () => {
    const r = run("r1", "needs_you", { reason: "approval", taskId: "t1" });
    expect(reads(one(r, [task("t1", "done")]))).toEqual({ state: "done", line: "Done." });
    expect(reads(one(r, [task("t1", "failed", { steps: [{ at: 1, text: "Google Tasks: Add task (you approved)" }, { at: 2, text: STUCK_STEP }] })]))).toEqual({ state: "failed", line: "This stopped before it finished." });
    expect(reads(one(r, [task("t1", "failed", { steps: [{ at: 1, text: "Google Tasks: Add task failed" }] })]))).toEqual({ state: "failed", line: receiptLine("failed", "app_error", "en") });
    expect(reads(one(r, [task("t1", "cancelled", { steps: [{ at: 1, text: "You said no to Add task" }] })]))).toEqual({ state: "done", line: "You said no." });
    expect(reads(one(r, [task("t1", "cancelled", { steps: [{ at: 1, text: EXPIRED_STEP }] })]))).toEqual({ state: "failed", line: receiptLine("cancelled", "expired", "en") });
    // A yes being carried out is running.
    expect(reads(one(r, [task("t1", "running")]))).toEqual({ state: "running", line: "Working on it." });
    // Its task not among those read: how it ended is not known here, so it is not said.
    expect(one(r, [])).toBeUndefined();
    expect(one(run("r2", "needs_you", { reason: "approval" }), [task("t1", "done")])).toBeUndefined();
  });

  it("a question back: waiting for their answer, while it can still be answered", () => {
    const q = run("q1", "needs_you", { reason: "question", at: NOW - MIN });
    expect(reads(one(q))).toEqual({ state: "waiting", line: "Waiting for your answer." });
    expect(one(q)!.taskId).toBeUndefined();
    // Past the five minutes the answer would have to come in, it is not waiting.
    expect(one({ ...q, at: NOW - SWEEP_TIMES.followUpMs - 1 })).toBeUndefined();
    // Once they ask the phone anything else, that was the answer (or the question let go).
    expect(activityOf([run("n1", "done", { at: NOW - 10_000 }), q], [], NOW).map((a) => a.runId)).toEqual(["n1"]);
    // A desktop question waits while its run is not quiet.
    const d = run("d1", "needs_you", { reason: "question", surface: "desktop", at: NOW - 9 * MIN });
    expect(one(d)!.state).toBe("waiting");
    expect(one({ ...d, at: NOW - SWEEP_TIMES.quietMs - 1 })).toBeUndefined();
  });

  it("done: done, in its own words (a hand-off is ready in the other app)", () => {
    expect(reads(one(run("r1", "done")))).toEqual({ state: "done", line: "Done." });
    expect(reads(one(run("r1", "done", { reason: "handoff" })))!.line).toBe(receiptLine("done", "handoff", "en"));
  });

  it("partial and failed: failed, with Try again only when the ledger kept their words for it", () => {
    const f = one(run("r1", "failed", { reason: "model_unavailable", retry: "add gym tomorrow" }));
    expect(f).toMatchObject({ state: "failed", retry: "add gym tomorrow" });
    expect(reads(f)!.line).toBe(receiptLine("failed", "model_unavailable", "en"));
    expect(one(run("r2", "failed", { reason: "app_error" }))!.retry).toBeUndefined();
    const p = one(run("r3", "partial", { reason: "app_timeout" }));
    expect(p!.state).toBe("failed");
    expect(reads(p)!.line).toBe(receiptLine("partial", "app_timeout", "en"));
  });

  it("cancelled: failed (stopped on the computer, hung up, unanswered, expired); refused: done", () => {
    for (const reason of ["device_stopped", "hung_up", "unanswered", "expired"] as const) {
      expect(reads(one(run("r1", "cancelled", { reason }))), reason).toEqual({ state: "failed", line: receiptLine("cancelled", reason, "en") });
    }
    expect(reads(one(run("r1", "cancelled", { reason: "denied" })))).toEqual({ state: "done", line: "You said no." });
  });

  it("waiting first, then running, then the newest that ended; nothing older than seven days", () => {
    const rows = activityOf([
      run("done-new", "done", { at: NOW - 1 * MIN }),
      run("run", "running", { at: NOW - 2 * MIN }),
      run("failed-mid", "failed", { at: NOW - 3 * MIN }),
      run("card", "needs_you", { reason: "approval", taskId: "t1", at: NOW - 30 * MIN }),
      run("done-old", "done", { at: NOW - 40 * MIN }),
      run("ancient", "done", { at: NOW - ACTIVITY_MS - 1 }),
    ], [card("t1")], NOW);
    expect(rows.map((a) => a.runId)).toEqual(["card", "run", "done-new", "failed-mid", "done-old"]);
    expect(ACTIVITY_MS).toBe(7 * 24 * 3_600_000);
  });
});

// ---- the read ---------------------------------------------------------------------------

describe("assistantView reads the runs with the tasks, and never fails for them", () => {
  const setup = () => {
    const store = new MemoryConnectorStore();
    return { store, connectors: createConnectors({ store, redirectUrl: "https://api.example.com/v1/connectors/callback", catalog: [...ALWAYS_ON] }) };
  };

  it("with the tasks: Activity, its card's task read from them", async () => {
    const { store, connectors } = setup();
    const t = await store.createTask("u1", { runId: "run_1", title: "Gym" });
    await store.updateTask("u1", t.id, { state: "done" });
    const asked: Array<[string, number]> = [];
    const runs = { recent: async (u: string, n: number) => { asked.push([u, n]); return [run("run_1", "needs_you", { reason: "approval", taskId: t.id, at: Date.now() })]; } };
    const v = await assistantView(connectors, "u1", { apps: true, tasks: true }, undefined, runs);
    expect(asked).toEqual([["u1", 12]]);
    expect(v.activity!.map((a) => [a.runId, a.state])).toEqual([["run_1", "done"]]);
    // No tasks asked for: no runs read.
    const none = await assistantView(connectors, "u1", { apps: true }, undefined, runs);
    expect(none.activity).toBeUndefined();
    expect(asked.length).toBe(1);
  });

  it("a ledger that cannot be read leaves Activity out, and the rest of the page as it was", async () => {
    const { connectors } = setup();
    const broken = { recent: async () => { throw new Error("agent_runs is not there yet"); } };
    const v = await assistantView(connectors, "u1", { apps: true, tasks: true }, undefined, broken);
    expect(v.activity).toBeUndefined();
    expect(v.tasks).toEqual([]);
    expect(v.apps).toBeDefined();
  });

  it("from the run ledger itself (src/runs), by default", async () => {
    resetRunStoreForTests();
    const { connectors } = setup();
    await runStore().saveStep("u1", { runId: "ask_ledger1", surface: "phone", platform: "ios", step: 0, outcome: "done", reason: "handoff", effects: 1, ms: 900, title: "message mom on whatsapp" });
    const v = await assistantView(connectors, "u1", { tasks: true });
    expect(v.activity).toEqual([expect.objectContaining({ runId: "ask_ledger1", state: "done", title: "message mom on whatsapp", outcome: "done", reason: "handoff" })]);
    resetRunStoreForTests();
  });
});

// ---- the card ---------------------------------------------------------------------------

const names = { "google-tasks": "Google Tasks", notion: "Notion" };
const you = (activity: ActivityItem[] | undefined, extra: Record<string, unknown> = {}, tasks: AssistantTask[] = []) =>
  buildScreen("personality", {
    personality: {}, language: "en", name: "Asha", platform: "ios", tzOffsetMinutes: 330, connectorsOn: true,
    assistant: { apps: [], names, tasks, ...(activity ? { activity } : {}) }, ...extra,
  } as never) as any;
/** The tab's one column of cards; the hand-it-to-me node is the one with its heading. */
const youNode = (s: any): AnyNode => (s.root.children[0].children[0].children as AnyNode[]).find((n) => texts(n).includes(SW["y.h"].en))!;
const activityCard = (s: any): AnyNode | undefined => youNode(s).children!.find((n) => texts(n).includes(SW["y.act"].en));
const rowsOf = (c: AnyNode): AnyNode[] => c.children!.at(-1)!.children!;
const item = (runId: string, state: ActivityItem["state"], o: Partial<ActivityItem> = {}): ActivityItem =>
  ({ runId, surface: "phone", state, title: `Asked ${runId}`, outcome: state === "waiting" ? "needs_you" : state, at: NOW, ...o } as ActivityItem);

describe("You: Activity", () => {
  it("no rows, no card: and the tab is exactly as it was", () => {
    for (const a of [undefined, []]) {
      const s = you(a);
      expect(activityCard(s)).toBeUndefined();
      expect(youNode(s).children!.length).toBe(3);
      expect(s.state.act).toEqual([]);
    }
  });

  it("a card after Coming up, in its cream look, headed Activity", () => {
    const s = you([item("r1", "done")]);
    const kids = youNode(s).children!;
    expect(kids.length).toBe(5);
    expect(texts(kids[2]!)).toContain(SW["y.up"].en);
    expect(kids[3]).toEqual({ type: "Spacer", style: { height: 14 } });
    const c = activityCard(s)!;
    expect(kids[4]).toBe(c);
    expect(c.style).toMatchObject({ backgroundColor: "#1A1611", borderRadius: 20 });
    expect(c.props!.keepCase).toBe(true);
    expect(texts(c)[0]).toBe("Activity");
    expect([SW["y.act"].en, SW["y.act"].hg, SW["y.again"].en, SW["y.again"].hg]).toEqual(["Activity", "Kya hua", "Try again", "Phir se karo"]);
    // The Hinglish of our own words reaches the translator as written, in both spellings.
    const seeds = settingsHinglishSeeds();
    expect(seeds.get("Activity")).toBe("Kya hua");
    expect(seeds.get("Try Again")).toBe("Phir se karo");
  });

  it("at most five rows, and none whose task Coming up already shows", () => {
    const tasks = [card("t-up", { updatedAt: NOW })];
    const act = [
      item("w-up", "waiting", { taskId: "t-up", app: "google-tasks" }),
      ...Array.from({ length: 7 }, (_, i) => item(`d${i}`, "done", { at: NOW - i })),
    ];
    const s = you(act, {}, tasks);
    const c = activityCard(s)!;
    expect(rowsOf(c).length).toBe(5);
    expect(s.state.act.map((r: { title: string }) => r.title)).toEqual(["Asked d0", "Asked d1", "Asked d2", "Asked d3", "Asked d4"]);
    // Coming up not read (the tasks' read failed): Activity has nothing to stand aside for, and is not there either.
    expect(activityCard(buildScreen("personality", { personality: {}, language: "en", platform: "ios", connectorsOn: true, assistant: undefined } as never))).toBeUndefined();
  });

  it("each row: its mark, their words and the line from state, and nothing of theirs in a node", () => {
    const act = [
      item("w", "waiting", { taskId: "t1", app: "notion", outcome: "needs_you", reason: "approval" }),
      item("q", "waiting", { outcome: "needs_you", reason: "question" }),
      item("r", "running", { outcome: "running" }),
      item("d", "done", { outcome: "done" }),
      item("f", "failed", { outcome: "failed", reason: "app_error", title: "pay rahul@okicici 500" }),
    ];
    const s = you(act);
    const rows = rowsOf(activityCard(s)!);
    expect(s.state.act).toEqual([
      { title: "Asked w", line: "Waiting for your OK." },
      { title: "Asked q", line: "Waiting for your answer." },
      { title: "Asked r", line: "Working on it." },
      { title: "Asked d", line: "Done." },
      { title: "pay rahul@okicici 500", line: receiptLine("failed", "app_error", "en") },
    ]);
    rows.forEach((row, i) => {
      const bound = nodes(row, (n) => !!n.bind).map((n) => [n.bind!.content, n.props!.numberOfLines]);
      expect(bound.slice(-2)).toEqual([[`act.${i}.title`, 1], [`act.${i}.line`, 1]]);
    });
    expect(JSON.stringify(activityCard(s))).not.toContain("rahul");
    // The marks: the app's logo for a card, the dot while running, the neon tick when done, "!" in a circle when it failed.
    expect(nodes(rows[0], (n) => n.type === "Image" && /notion/.test(String(n.props?.source?.url))).length).toBe(1);
    expect(nodes(rows[2], (n) => n.style?.borderRadius === 5).length).toBe(1);
    expect(nodes(rows[3], (n) => n.type === "SVG" && n.props?.stroke === NEON).length).toBe(1);
    const failed = nodes(rows[4], (n) => n.type === "SVG")[0]!;
    expect(failed.props!.stroke).toBe("rgba(243,226,198,0.66)");
    expect(failed.props!.stroke).not.toBe(NEON);
    expect(nodes(rows[1], (n) => n.type === "SVG").length).toBe(1);
  });

  it("a card still waiting: the row and its Needs your OK open the confirm sheet on that task", () => {
    const s = you([item("w", "waiting", { taskId: "t1", app: "google-tasks", reason: "approval" }), item("q", "waiting", { reason: "question" })]);
    const [w, q] = rowsOf(activityCard(s)!);
    const open = { kind: "navigate", screenId: "assistant_approve", params: { taskId: "t1" } };
    expect(actions(w!.on).find((a) => a.kind === "navigate")).toEqual(open);
    const pill = nodes(w, (n) => !!n.on?.onPress && texts(n).includes(SW["y.ok"].en))[0]!;
    expect(actions(pill.on).find((a) => a.kind === "navigate")).toEqual(open);
    // A question has nothing to open: its answer is asked for in the field above.
    expect(q!.on).toBeUndefined();
    expect(texts(q)).not.toContain(SW["y.ok"].en);
  });

  it("Try again only where there are words to try with: they go back in the field, and the card's own Do it runs", () => {
    const s = you([item("f1", "failed", { retry: "add gym tomorrow" }), item("f2", "failed"), item("d", "done")]);
    const rows = rowsOf(activityCard(s)!);
    const again = (r: AnyNode) => nodes(r, (n) => !!n.on?.onPress && texts(n).includes(SW["y.again"].en));
    expect(again(rows[0]!).length).toBe(1);
    expect(again(rows[1]!)).toEqual([]);
    expect(again(rows[2]!)).toEqual([]);
    expect(s.state.act[0].retry).toBe("add gym tomorrow");
    expect(s.state.act[1]).not.toHaveProperty("retry");
    const pill = again(rows[0]!)[0]!;
    const press = pill.on!.onPress;
    // Once: not while an ask is on its way, and the pill goes when pressed (its words let go from state).
    expect(press).toEqual({
      kind: "condition", if: { falsy: "ask.busy" },
      then: { kind: "sequence", actions: [
        { kind: "setState", path: "ask.text", value: "$state.act.0.retry" },
        { kind: "setState", path: "act.0.retry", value: "" },
        askAction({ platform: "ios", tzOffsetMinutes: 330 }),
      ] },
    });
    expect(pill.visibleIf).toEqual({ truthy: "act.0.retry" });
    // The very actions the hand card's Do it runs.
    const doIt = nodes(youNode(s), (n) => !!n.on?.onPress && texts(n).includes("Do it")).sort((a, b) => nodes(a).length - nodes(b).length)[0]!;
    expect(press.then.actions[2]).toEqual(doIt.on!.onPress);
    // Asked from here, it is answered in the card above: the card says so while it is on its way.
    const busy = activityCard(s)!.children!.find((n) => n.visibleIf?.truthy === "ask.busy")!;
    expect(texts(busy)).toEqual(["On it…"]);
    // Their words are in state only.
    expect(JSON.stringify(activityCard(s))).not.toContain("add gym tomorrow");
  });

  it("a desktop run's row says where it ran: its words are not kept", () => {
    const s = you([item("d", "done", { surface: "desktop", title: "" }), item("p", "done")]);
    expect(s.state.act.map((r: { title: string }) => r.title)).toEqual(["On your computer", "Asked p"]);
    expect(you([item("d", "done", { surface: "desktop", title: "" })], { language: "hinglish" }).state.act[0].title).toBe("Computer pe");
  });

  it("the lines are in their voice", () => {
    const act = [item("d", "done", { outcome: "done" }), item("x", "done", { outcome: "cancelled", reason: "denied" }), item("r", "running", { outcome: "running" })];
    const s = you(act, { language: "hinglish" });
    expect(s.state.act.map((r: { line: string }) => r.line)).toEqual([receiptLine("done", undefined, "hinglish"), receiptLine("cancelled", "denied", "hinglish"), receiptLine("running", undefined, "hinglish")]);
    expect(s.state.act[0].line).toBe("Ho gaya.");
    expect(you(act).state.act[1].line).toBe("You said no.");
  });

  it("is made only of what the store build draws: checked against its own source", () => {
    const s = you([
      item("w", "waiting", { taskId: "t1", app: "google-tasks" }), item("q", "waiting", { reason: "question" }),
      item("r", "running"), item("d", "done"), item("f", "failed", { retry: "add gym" }),
    ]);
    const c = activityCard(s)! as never;
    const builds = storeBuilds();
    for (const [which, b] of builds) expect(audit({ root: c }, b), which).toEqual([]);
    expect([...typesIn(c)].every((t) => ["Stack", "Text", "SVG", "Spacer", "Image"].includes(t))).toBe(true);
    // The one field it sends that the store build reads past is askAction's handoff, on openUrl: nothing else.
    const unread = (b: (typeof builds)[number][1]) => actions(c).flatMap((a) => Object.keys(a).filter((f) => !(b.actionFields[a.kind] ?? []).includes(f)).map((f) => `${a.kind}.${f}`));
    for (const [, b] of builds) expect([...new Set(unread(b))]).toEqual(["openUrl.handoff"]);
    // Live 622c76e, when the phone repo is here.
    if (builds.length > 1) expect(builds[1]![0]).toContain("622c76e");
  });

  it("the audit finds what it is for", () => {
    const s = you([item("d", "done")]);
    const c = JSON.parse(JSON.stringify(activityCard(s)));
    c.children.push({ type: "BlipRoam", props: { h: 60 } }, { type: "Stack", on: { onPress: { kind: "connector.connect" } }, style: { backdropFilter: "blur" } });
    c.children.push({ type: "Text", props: { content: "x", glow: true }, on: { onPress: { kind: "openUrl", url: "x", handoff: true, extra: 1 } } });
    const bad = audit({ root: c }, storeBuilds()[0]![1]).join("\n");
    for (const hit of ["node type BlipRoam", "action kind connector.connect", "style key backdropFilter", "prop glow", "event onPress", "openUrl reads no field extra"]) expect(bad).toContain(hit);
    expect(bad).not.toContain("handoff");
  });
});
