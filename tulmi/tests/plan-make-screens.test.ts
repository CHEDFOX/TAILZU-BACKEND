/**
 * "PLAN SOMETHING", AS DRAWN (screens/bots/planMake.ts; docs/plan-ease.md §10):
 *
 *   - the card: What, When, For who (people as their tiny bots, You first), one Must not miss switch, Repeat and Place closed until
 *     wanted, Check; the check face: three slots, three notes each, fixes, Change, Take out, Done; the box at the bottom
 *   - the state: never kept, no key until an answer gives one; every action behind the busy guard; Check and Done hidden while busy
 *   - the calls: make/draft (the box, Read it with AI with keep 1), make/check (Check, a fix, Take out), make (Done), plan/box (a bill's
 *     preview); Done from the Plan lands on the home, from elsewhere goes back with a toast; fix_first checks again
 *   - the AI line and card only when setup says ask; an older build or the switch off: the old form; lint clean
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
const { MAKE_API, MAKE_OFF_API, MAKE_STATES, DAD, MOM, RIYA } = await import("../scripts/bots-render/samples/planMake.js");
type MakeSetup = import("../src/botsBots/planMake.js").MakeSetup;
type CardDraft = import("../src/botsBots/planMake.js").CardDraft;

const U = "aaaaaaaa-0000-4000-8000-000000000001";
const A = "/v1/botsapp/bots";
const MK = `${A}/plan/make`;
const SETUP_KEY = `GET ${MK}?tz=${IST}`;
const SETUP = MAKE_API[SETUP_KEY] as MakeSetup;
const NEW = ["BotsKit", "BotsMotion", "BotBuddy", "KitExtras", "PersonBot", "FontBricolage", "FileUpload", "ActionParams"];
const FROM_PLAN = { from: "plan", day: "2026-10-28" };

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

async function draw(client: "phone" | "desktop", o: { can?: string[]; params?: Record<string, string>; setup?: Partial<MakeSetup> | null } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = o.setup === null ? {} : { [SETUP_KEY]: { ...SETUP, ...(o.setup ?? {}) } };
  const s = await buildBotsScreen(
    { screenId: "bots.plan.make", client, params: o.params ?? FROM_PLAN, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" }, can: new Set(o.can ?? NEW), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ api, calls, now: FIXED_NOW }),
  );
  const nodes = walk(s.root!);
  return { s, nodes, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")), calls: calls.map((c) => `${c.method} ${c.path}`) };
}

type Act = Record<string, unknown>;
/** Every action under one action, flattened. */
function flat(a: unknown, out: Act[] = []): Act[] {
  if (!a || typeof a !== "object") return out;
  const o = a as Act;
  out.push(o);
  for (const k of ["actions", "then", "else", "onSuccess", "onError"]) { const v = o[k]; if (Array.isArray(v)) v.forEach((x) => flat(x, out)); else flat(v, out); }
  return out;
}
const actions = (nodes: Node[]): Act[] => nodes.flatMap((n) => Object.values(n.on ?? {}).flatMap((v) => flat(v)));
const callsTo = (nodes: Node[], path: string): Act[] => actions(nodes).filter((a) => a.kind === "callEndpoint" && a.path === path);
/** The node (a button or a word) whose own text is `content` and that is pressable. */
const pressable = (nodes: Node[], content: string): Node[] => nodes.filter((n) => n.on?.onPress && walk(n).some((x) => x.type === "Text" && x.props?.content === content));
/** Each node with the visibleIfs of it and its ancestors. */
function withConds(root: Node, conds: unknown[] = [], out: Array<{ n: Node; conds: unknown[] }> = []) {
  const here = root.visibleIf ? [...conds, root.visibleIf] : conds;
  out.push({ n: root, conds: here });
  for (const c of root.children ?? []) withConds(c, here, out);
  return out;
}
const IDLE_IF = { neq: ["busy", ""] };
const isIdle = (a: unknown): boolean => !!a && typeof a === "object" && (a as Act).kind === "condition" && JSON.stringify((a as Act).if) === JSON.stringify(IDLE_IF);
/** Each call to `paths` reached from `a`, and whether a busy guard is around it. */
function guards(a: unknown, paths: (p: string) => boolean, inGuard = false, out: Array<{ path: string; guarded: boolean }> = []) {
  if (!a || typeof a !== "object") return out;
  const o = a as Act;
  if (o.kind === "callEndpoint" && paths(String(o.path))) out.push({ path: String(o.path), guarded: inGuard });
  if (isIdle(o)) { guards(o.else, paths, true, out); return out; }
  for (const k of ["actions", "then", "else", "onSuccess", "onError"]) { const v = o[k]; if (Array.isArray(v)) v.forEach((x) => guards(x, paths, inGuard, out)); else guards(v, paths, inGuard, out); }
  return out;
}

describe("Plan something: the card", () => {
  it("the card's words, phone and window", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s, texts, nodes, calls } = await draw(client);
      expect(lintTree(s.root!)).toEqual([]);
      expect(calls).toContain(SETUP_KEY);
      expect(s.title).toBe("Plan something");
      expect(texts).toEqual(expect.arrayContaining([
        "Plan something", "Fill it in, or tell X0 below.", "What", "When", "Today", "Tomorrow", "Fri 30", "No day", "Other day",
        "Any time", "9 am", "12 pm", "4 pm", "6 pm", "8 pm", "Other time", "For who", "You", "Dad", "Mom", "Riya", "They get the reminder on their phone.",
        "Must not miss", "X0 keeps reminding until it's done.", "+ Repeat", "+ Place", "Repeat", "Once", "Every day", "Every week", "Every month",
        "Mon", "Sun", "Pick the days.", "Where", "Check", "Checking…", "X0 checked", "Looks good", "Change", "Take out", "Done", "Adding…",
      ]));
      const field = (path: string) => nodes.find((n) => n.type === "TextField" && n.bind?.value === path);
      expect(field("d.title")?.props).toMatchObject({ placeholder: "Dentist, Dad's medicine, school fees…", maxLength: 120 });
      expect(field("d.dayWords")?.props?.placeholder).toBe("Type a day, like 20 Nov");
      expect(field("d.timeWords")?.props?.placeholder).toBe("Type a time, like 5:30 pm");
      expect(field("d.place")?.props?.placeholder).toBe("Where, like Indiranagar");
      expect(field("say")?.props).toMatchObject({ placeholder: client === "phone" ? "Tell X0, like Dentist Fri 5 pm" : "Tell X0, like Dentist Fri 5 pm, or drop a file", maxLength: 2000, returnKeyType: "send" });
      // The walking bot thinks while the box fills the card or Check runs.
      expect(nodes.find((n) => n.type === "BotBuddy")?.props).toMatchObject({ thinkWhen: { any: [{ eq: ["busy", "fill"] }, { eq: ["busy", "check"] }] } });
    }
    // The top area's "the box is ready" (KitExtras): autoFocus only then.
    const focus = await draw("phone", { params: { ...FROM_PLAN, focus: "box" } });
    expect(focus.nodes.find((n) => n.type === "TextField" && n.bind?.value === "say")?.props?.autoFocus).toBe(true);
    const plain = await draw("phone");
    expect(plain.nodes.find((n) => n.type === "TextField" && n.bind?.value === "say")?.props?.autoFocus).toBeUndefined();
  });

  it("bots.plan.make answers cacheTtlSeconds 0; MAKE_STATE has no key until an answer gives one; ON_FILL and ON_CHECK write res.key", async () => {
    const { s, nodes } = await draw("phone");
    expect(s.cacheTtlSeconds).toBe(0);
    expect(s.state).toMatchObject({ step: "edit", key: "", at: "0", list: [], busy: "", d: { title: "", day: "2026-10-28", time: "", who: "", whoName: "", imp: "", days: [] } });
    // Strings and booleans only in the card: every field written.
    expect(Object.keys((s.state as { d: object }).d).sort()).toEqual(["day", "dayWords", "days", "guessed", "imp", "place", "repeat", "time", "timeWords", "title", "who", "whoName"]);
    const keyWrites = actions(nodes).filter((a) => a.kind === "setState" && a.path === "key");
    expect(keyWrites.length).toBeGreaterThan(1);
    expect(keyWrites.every((a) => a.value === "$state.res.key")).toBe(true);
    // A to-do opens with no day; a day param starts the card on it.
    const todo = await draw("phone", { params: { kind: "task" } });
    expect((todo.s.state as { d: { day: string } }).d.day).toBe("");
    const sat = await draw("phone", { params: { day: "2026-10-31" } });
    expect((sat.s.state as { d: { day: string } }).d.day).toBe("2026-10-31");
  });

  it("every action is wrapped in the busy guard; Check, Done and the preview's Done are hidden while busy; FIX and DROP set busy", async () => {
    const { nodes, s } = await draw("phone");
    const ours = (p: string) => p.startsWith(MK) || p === `${A}/plan/box`;
    const found = nodes.flatMap((n) => Object.values(n.on ?? {}).flatMap((v) => guards(v, ours)));
    expect(new Set(found.map((f) => f.path))).toEqual(new Set([`${MK}/draft`, `${MK}/check`, MK, `${A}/plan/box`]));
    expect(found.filter((f) => !f.guarded)).toEqual([]);
    // Each guarded action sets busy before its call.
    for (const n of nodes) {
      for (const v of Object.values(n.on ?? {})) {
        for (const a of flat(v).filter(isIdle)) {
          const first = flat(a.else).find((x) => x.kind === "setState" || x.kind === "callEndpoint");
          if (flat(a.else).some((x) => x.kind === "callEndpoint" && ours(String(x.path)))) expect(first).toMatchObject({ kind: "setState", path: "busy" });
        }
      }
    }
    const conds = withConds(s.root!);
    const hiddenWhileBusy = (content: string) => pressable(nodes, content).every((n) => conds.find((c) => c.n === n)!.conds.some((c) => JSON.stringify(c) === JSON.stringify({ eq: ["busy", ""] })));
    expect(hiddenWhileBusy("Check")).toBe(true);
    expect(hiddenWhileBusy("Done")).toBe(true);
    // FIX and DROP: busy "check", then make/check with the fix or the drop.
    const fixes = callsTo(nodes, `${MK}/check`).filter((c) => (c.body as { fix?: unknown }).fix);
    const drops = callsTo(nodes, `${MK}/check`).filter((c) => (c.body as { drop?: unknown }).drop);
    expect(fixes.length).toBe(3 * 3 * 2);
    expect(drops.map((c) => (c.body as { drop: string }).drop)).toEqual(["0", "1", "2"]);
    const fixPress = nodes.find((n) => flat(n.on?.onPress).some((a) => a.kind === "callEndpoint" && (a.body as { fix?: unknown })?.fix))!;
    expect(isIdle(fixPress.on?.onPress)).toBe(true);
    expect(flat((fixPress.on!.onPress as Act).else)[1]).toMatchObject({ kind: "setState", path: "busy", value: "check" });
  });

  it("Done's fail on fix_first checks again (CHECK_AGAIN); its ok is fixed by from", async () => {
    const fromPlan = await draw("phone");
    const done = callsTo(fromPlan.nodes, MK)[0]!;
    expect(done).toMatchObject({ method: "POST", body: { key: "$state.key", list: "$state.list", tz: IST }, assignTo: "made", stay: true });
    expect(flat(done.onSuccess)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "navigateBack" }),
      expect.objectContaining({ kind: "navigate", screenId: "bots.plan", replace: true, params: { day: "$state.made.day", made: "$state.made.key", n: "$state.made.n" } }),
    ]));
    const again = flat(done.onError).find((a) => a.kind === "condition" && JSON.stringify(a.if) === JSON.stringify({ eq: ["lastError.code", "fix_first"] }))!;
    expect(flat(again.then).find((a) => a.kind === "callEndpoint")).toMatchObject({ path: `${MK}/check`, body: { list: "$state.list", tz: IST } });
    expect(flat(done.onError)[1]).toMatchObject({ kind: "setState", path: "busy", value: "" });
    // A stop: Done says it, and posts nothing.
    const doneIf = fromPlan.nodes.map((n) => n.on?.onPress).find((a) => flat(a).includes(done))!;
    expect(flat(doneIf).find((a) => a.kind === "condition" && JSON.stringify(a.if) === JSON.stringify({ truthy: "chk.stop" }))).toMatchObject({ then: { kind: "toast", message: "$state.chk.stopLine" } });
    const fromToday = await draw("phone", { params: { day: "2026-10-28" } });
    const ok = flat(callsTo(fromToday.nodes, MK)[0]!.onSuccess);
    expect(ok).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "navigateBack" }), expect.objectContaining({ kind: "toast", message: "$state.made.line" })]));
    expect(ok.some((a) => a.kind === "navigate")).toBe(false);
  });

  it("Read it with AI shows only on chk.messy, never when setup.ai is off, and posts make/draft with keep 1 and the card's What", async () => {
    for (const ai of ["ask", "on"] as const) {
      const { nodes, s } = await draw("phone", { setup: { ai } });
      const read = pressable(nodes, "Read it with AI")[0]!;
      const conds = withConds(s.root!).find((c) => c.n === read)!.conds;
      expect(JSON.stringify(conds)).toContain(JSON.stringify({ truthy: "chk.messy" }));
      const call = flat(read.on?.onPress).find((a) => a.kind === "callEndpoint")!;
      expect(call).toMatchObject({ path: `${MK}/draft`, body: { words: "$state.d.title", keep: "1", d: "$state.d", list: "$state.list", at: "$state.at", tz: IST } });
    }
    const off = await draw("phone", { setup: { ai: "off" } });
    expect(off.texts).not.toContain("Read it with AI");
    expect(off.texts).not.toContain("Some words were hard to read.");
    // The box's Send never asks for keep.
    const send = callsTo(off.nodes, `${MK}/draft`);
    expect(send.length).toBeGreaterThan(0);
    expect(send.every((c) => !("keep" in (c.body as object)))).toBe(true);
  });

  it("the card shows What, When, For who and one Must not miss switch; Repeat and Place stay closed until tapped or filled; no pass-to", async () => {
    const { nodes, texts, s } = await draw("phone");
    const conds = withConds(s.root!);
    const condsOf = (content: string) => JSON.stringify(conds.find((c) => c.n.type === "Text" && c.n.props?.content === content)!.conds);
    // One switch, on only when d.imp is "must"; a tap turns it on or back to "" (X0 decides).
    const sw = nodes.filter((n) => JSON.stringify(n.style?.backgroundColor ?? "").includes('"d.imp","must"'));
    expect(sw).toHaveLength(1);
    const mustRow = pressable(nodes, "Must not miss")[0]!;
    expect(mustRow.on?.onPress).toMatchObject({ kind: "condition", if: { eq: ["d.imp", "must"] }, then: { kind: "setState", path: "d.imp", value: "" }, else: { kind: "setState", path: "d.imp", value: "must" } });
    expect(condsOf("+ Repeat")).toContain(JSON.stringify({ all: [{ falsy: "showRepeat" }, { falsy: "d.repeat" }] }));
    expect(condsOf("+ Place")).toContain(JSON.stringify({ all: [{ falsy: "showPlace" }, { falsy: "d.place" }] }));
    expect(condsOf("Repeat")).toContain(JSON.stringify({ any: [{ truthy: "showRepeat" }, { truthy: "d.repeat" }] }));
    expect(condsOf("Where")).toContain(JSON.stringify({ any: [{ truthy: "showPlace" }, { truthy: "d.place" }] }));
    expect(condsOf("Pick the days.")).toContain(JSON.stringify({ eq: ["d.repeat", "weekly"] }));
    // The weekdays toggle in d.days, Monday first.
    expect(actions(nodes).filter((a) => a.kind === "toggleInArray").map((a) => a.value)).toEqual(["1", "2", "3", "4", "5", "6", "0"]);
    expect(texts.some((t) => /pass|if not done/i.test(t))).toBe(false);
    expect(nodes.some((n) => n.type === "TextField" && /backup|pass/.test(String(n.bind?.value)))).toBe(false);
  });

  it("For who shows each person as their tiny bot, You first; hidden with follow-through off or nobody to pick", async () => {
    const { nodes } = await draw("phone");
    const chips = nodes.filter((n) => flat(n.on?.onPress).some((a) => a.kind === "setState" && a.path === "d.who"));
    expect(chips.map((n) => (n.on!.onPress as Act).value)).toEqual(["", DAD, MOM, RIYA]);
    expect(chips.map((n) => walk(n).find((x) => x.type === "PersonBot")?.props?.label)).toEqual(["You", "Dad", "Mom", "Riya"]);
    // On the check face, each slot's who has that person's tiny bot (You as "me").
    expect(nodes.filter((n) => n.type === "PersonBot" && JSON.stringify(n.visibleIf) === JSON.stringify({ eq: ["chk.items.0.who", "me"] }))).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "PersonBot" && JSON.stringify(n.visibleIf) === JSON.stringify({ eq: ["chk.items.2.who", DAD] }))).toHaveLength(1);
    const off = await draw("phone", { setup: (MAKE_OFF_API[SETUP_KEY] as MakeSetup) });
    expect(off.texts).not.toContain("For who");
    expect(off.texts).not.toContain("Must not miss");
    const alone = await draw("phone", { setup: { people: SETUP.people.filter((p) => p.me) } });
    expect(alone.texts).not.toContain("For who");
    expect(alone.texts).toContain("Must not miss");
  });

  it("Check posts list, d and at; Done posts key and list; the box posts to make/draft", async () => {
    const { nodes } = await draw("phone");
    const check = pressable(nodes, "Check")[0]!;
    expect(flat(check.on?.onPress).find((a) => a.kind === "condition" && JSON.stringify(a.if) === JSON.stringify({ falsy: "d.title" }))).toMatchObject({ then: { kind: "toast", message: "Say what it is first" } });
    expect(flat(check.on?.onPress).find((a) => a.kind === "callEndpoint")).toMatchObject({
      method: "POST", path: `${MK}/check`, body: { list: "$state.list", d: "$state.d", at: "$state.at", tz: IST, day0: "2026-10-28" }, assignTo: "res", stay: true,
    });
    expect(callsTo(nodes, MK)[0]).toMatchObject({ body: { key: "$state.key", list: "$state.list" } });
    const say = nodes.find((n) => n.type === "TextField" && n.bind?.value === "say")!;
    const box = flat(say.on?.onSubmit).find((a) => a.kind === "callEndpoint")!;
    expect(box).toMatchObject({ method: "POST", path: `${MK}/draft`, body: { words: "$state.say", tz: IST, d: "$state.d", list: "$state.list", at: "$state.at", day: "2026-10-28" }, assignTo: "res", stay: true });
    expect(flat(say.on?.onSubmit)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "setState", path: "lastSay", value: "$state.say" })]));
    expect(labelledSend(nodes)?.on?.onPress).toEqual(say.on?.onSubmit);
    // The box's answer: drafts (the check face), a preview, or the box's own reply (the chat, a capture card, a link).
    const fill = flat(box.onSuccess);
    expect(fill).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "setState", path: "list", value: "$state.res.drafts" }),
      expect.objectContaining({ kind: "setState", path: "step", value: "check" }),
      expect.objectContaining({ kind: "setState", path: "pre", value: "$state.res.preview" }),
      expect.objectContaining({ kind: "setState", path: "boxed", value: "$state.res.box" }),
      expect.objectContaining({ kind: "callEndpoint", path: `${A}/chat/plan` }),
      expect.objectContaining({ kind: "navigate", screenId: "bots.plan.capture" }),
    ]));
    // A Take out that leaves nothing is the empty card again.
    const drop = callsTo(nodes, `${MK}/check`).find((c) => (c.body as { drop?: string }).drop === "0")!;
    expect(flat(drop.onSuccess).find((a) => a.kind === "condition" && JSON.stringify(a.if) === JSON.stringify({ truthy: "res.view.empty" }))).toMatchObject({
      then: { actions: expect.arrayContaining([expect.objectContaining({ kind: "setState", path: "step", value: "edit" })]) },
    });
  });

  it("Done from the Plan goes back and opens the home on the new day; from Today it goes back with a toast", async () => {
    const plan = await draw("phone");
    const okPlan = callsTo(plan.nodes, MK)[0]!.onSuccess as Act;
    expect((okPlan.actions as Act[]).map((a) => a.kind)).toEqual(["navigateBack", "navigate"]);
    const today = await draw("desktop", { params: { day: "2026-10-28" } });
    const okToday = callsTo(today.nodes, MK)[0]!.onSuccess as Act;
    expect(okToday.actions).toEqual([{ kind: "navigateBack" }, { kind: "toast", message: "$state.made.line" }]);
  });

  it("the check face binds to three slots and three notes each, and fixes post to make/check", async () => {
    const { nodes } = await draw("phone");
    const binds = new Set(nodes.map((n) => n.bind?.content).filter(Boolean));
    for (const n of [0, 1, 2]) {
      for (const f of ["head", "when", "whoLine", "mustLine", "place"]) expect(binds.has(`chk.items.${n}.${f}`)).toBe(true);
      for (const k of [0, 1, 2]) {
        expect(binds.has(`chk.items.${n}.notes.${k}.text`)).toBe(true);
        expect(binds.has(`chk.items.${n}.notes.${k}.fixes.0.label`)).toBe(true);
        expect(binds.has(`chk.items.${n}.notes.${k}.fixes.1.label`)).toBe(true);
      }
    }
    for (const b of ["chk.count", "chk.extra", "chk.unsure"]) expect(binds.has(b)).toBe(true);
    const fix = callsTo(nodes, `${MK}/check`).find((c) => JSON.stringify(c.body).includes("chk.items.1.notes.2.fixes.0.id"))!;
    expect(fix.body).toEqual({ list: "$state.list", tz: IST, fix: { item: "1", id: "$state.chk.items.1.notes.2.fixes.0.id" } });
    // Pick opens the card on that draft; Invite opens the setup's invite.
    const pick = pressable(nodes, "Pick").find((n) => JSON.stringify(n.visibleIf).includes("chk.items.2."))!;
    expect(flat(pick.on?.onPress)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "setState", path: "d", value: "$state.list.2" }), expect.objectContaining({ kind: "setState", path: "at", value: "2" })]));
    expect(pressable(nodes, "Invite")[0]!.on?.onPress).toEqual({ kind: "navigate", screenId: "bots.space.invite", params: { id: "s1" } });
    const noInvite = await draw("phone", { setup: { invite: null } });
    expect(noInvite.texts).not.toContain("Invite");
  });

  it("the AI line and card only when setup says ask, and only on a check face that came from the box with unsure set", async () => {
    const { nodes, s } = await draw("phone", { setup: { ai: "ask" } });
    const conds = withConds(s.root!);
    const turnOn = pressable(nodes, "Turn on AI")[0]!;
    expect(JSON.stringify(conds.find((c) => c.n === turnOn)!.conds)).toContain(JSON.stringify({ all: [{ eq: ["step", "check"] }, { truthy: "chk.unsure" }] }));
    expect(flat(turnOn.on?.onPress)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "setState", path: "aiAsk", value: true })]));
    // The AI card shows only while aiAsk; Agree saves the yes, then the last words go again.
    const card = nodes.find((n) => n.type === "BotCard")!;
    expect(JSON.stringify(card.visibleIf)).toContain(JSON.stringify({ truthy: "aiAsk" }));
    const agree = callsTo(nodes, "/v1/you/ai-consent")[0]!;
    expect(flat(agree.onSuccess).find((a) => a.kind === "callEndpoint")).toMatchObject({ path: `${MK}/draft`, body: { words: "$state.lastSay" } });
    for (const ai of ["on", "off"] as const) {
      const other = await draw("phone", { setup: { ai } });
      expect(other.texts).not.toContain("Turn on AI");
      expect(other.nodes.some((n) => n.type === "BotCard")).toBe(false);
    }
  });

  it("a bill's preview runs the box on Done and puts the words back on Change", async () => {
    const { nodes, s } = await draw("phone");
    expect(nodes.some((n) => n.bind?.content === "pre.line")).toBe(true);
    expect(nodes.some((n) => n.bind?.content === "pre.words")).toBe(true);
    const box = callsTo(nodes, `${A}/plan/box`)[0]!;
    expect(box).toMatchObject({ body: { words: "$state.pre.words", tz: IST }, assignTo: "boxed", stay: true });
    expect(flat(box.onSuccess)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "clearState", path: "pre" })]));
    const conds = withConds(s.root!);
    const previewOf = (n: Node) => JSON.stringify(conds.find((c) => c.n === n)!.conds).includes('"pre.line"');
    const change = pressable(nodes, "Change").find(previewOf)!;
    expect(change.on?.onPress).toEqual({ kind: "sequence", actions: [{ kind: "setState", path: "say", value: "$state.pre.words" }, { kind: "clearState", path: "pre" }] });
    const done = pressable(nodes, "Done").find(previewOf)!;
    expect(isIdle(done.on?.onPress)).toBe(true);
    expect(flat((done.on!.onPress as Act).else)[1]).toMatchObject({ kind: "setState", path: "busy", value: "box" });
    // The box's reply under it, as on the simple page: its line, Undo, [Ask], Open chat.
    expect(nodes.some((n) => n.bind?.content === "boxed.line")).toBe(true);
    expect(nodes.some((n) => n.bind?.content === "boxed.act.label")).toBe(true);
  });

  it("an older build, or PLAN_V2_MAKE off: the old form", async () => {
    const cases: Array<{ client: "phone" | "desktop"; can: string[] }> = [
      { client: "phone", can: ["BotsKit"] },
      { client: "phone", can: NEW.filter((c) => c !== "ActionParams") },
      { client: "desktop", can: NEW.filter((c) => c !== "KitExtras") },
      { client: "desktop", can: NEW.filter((c) => c !== "PersonBot") },
    ];
    for (const c of cases) {
      const d = await draw(c.client, { can: c.can, params: { day: "2026-10-30", kind: "task" } });
      expect(d.texts).toContain("Add to your Plan");
      expect(d.calls).toEqual([]);
      // It keeps the day and the kind.
      expect(d.s.state).toMatchObject({ kind: "task", day: "2026-10-30" });
    }
    for (const flag of ["PLAN_V2_MAKE", "PLAN_V2_PAGE"]) {
      vi.stubEnv(flag, "false"); resetConfigForTests();
      const d = await draw("phone");
      expect(d.texts).toContain("Add to your Plan");
      expect(d.texts).not.toContain("X0 checked");
      vi.unstubAllEnvs(); resetConfigForTests();
    }
    // A failed setup read never fails the card: no people, no AI.
    const down = await draw("phone", { setup: null });
    expect(down.texts).toContain("Check");
    expect(down.texts).not.toContain("For who");
    expect(down.texts).not.toContain("Read it with AI");
  });

  it("lint clean: no pressable inside a pressable", async () => {
    for (const client of ["phone", "desktop"] as const) {
      for (const setup of [{}, { ai: "on" as const }, { ai: "off" as const, follow: false, people: [] }]) {
        const { s } = await draw(client, { setup });
        expect(lintTree(s.root!)).toEqual([]);
      }
    }
    // The sample states are only state: the tree they draw is the one linted above.
    expect(Object.keys(MAKE_STATES)).toEqual(expect.arrayContaining(["filled", "good", "notes", "stop", "multi", "consent", "whoIs", "bill", "boxDay"]));
  });
});

/** The box's round Send. */
function labelledSend(nodes: Node[]): Node | undefined {
  return nodes.find((n) => n.props?.accessibilityLabel === "Send" && n.on?.onPress);
}

describe("fixes after review", () => {
  /** The node and every node above it, root first. */
  const pathTo = (root: Node, want: (n: Node) => boolean, up: Node[] = []): Node[] | null => {
    if (want(root)) return [...up, root];
    for (const c of root.children ?? []) { const got = pathTo(c, want, [...up, root]); if (got) return got; }
    return null;
  };
  const isSay = (n: Node) => n.type === "TextField" && n.bind?.value === "say";

  it("the type box stays at the bottom: outside the window's scrolling column, the phone's footer over the keyboard", async () => {
    const desk = await draw("desktop");
    const up = pathTo(desk.s.root!, isSay)!;
    expect(up).not.toBeNull();
    expect(up.some((n) => n.style?.overflowY === "auto")).toBe(false);
    // The card scrolls (it is in the scrolling column); the box is not.
    expect(pathTo(desk.s.root!, (n) => n.type === "Text" && n.props?.content === "What")!.some((n) => n.style?.overflowY === "auto")).toBe(true);
    const phone = await draw("phone");
    const footer = pathTo(phone.s.root!, isSay)!.find((n) => n.props?.keyboard === "above");
    expect(footer).toBeTruthy();
  });

  it("When is today and the next 4 days, No day and Other day; the times have their own label", async () => {
    const { texts } = await draw("phone");
    expect(texts).toEqual(expect.arrayContaining(["When", "Today", "Tomorrow", "Fri 30", "Sat 31", "Sun 1", "No day", "Other day", "Time", "Any time"]));
    expect(texts).not.toContain("Mon 2");
    expect(texts.indexOf("Time")).toBeGreaterThan(texts.indexOf("Other day"));
    expect(texts.indexOf("Time")).toBeLessThan(texts.indexOf("Any time"));
  });

  it("a past day from the home's strip opens the card on today", async () => {
    const { s } = await draw("phone", { params: { from: "plan", day: "2026-10-20" } });
    expect((s.state as { d: CardDraft }).d.day).toBe("2026-10-28");
    expect(((await draw("phone", { params: { from: "plan", day: "2026-10-30" } })).s.state as { d: CardDraft }).d.day).toBe("2026-10-30");
  });

  it("with a stop the face drops its tick and Done is a plain outline; a no-name draft still shows its note, with Fill it in", async () => {
    const { s } = await draw("phone");
    const conds = withConds(s.root!);
    const ofText = (t: string) => conds.filter((c) => c.n.type === "Text" && c.n.props?.content === t).map((c) => JSON.stringify(c.conds));
    // Two Dones: the main (black) one only without a stop, the outline one only with it.
    const dones = conds.filter((c) => c.n.on?.onPress && walk(c.n).some((x) => x.type === "Text" && x.props?.content === "Done") && JSON.stringify(c.conds).includes('"step","check"'));
    expect(dones.map((d) => JSON.stringify(d.conds).includes('{"falsy":"chk.stop"}') ? "no stop" : JSON.stringify(d.conds).includes('{"truthy":"chk.stop"}') ? "stop" : "?").sort()).toEqual(["no stop", "stop"]);
    // The tick beside "X0 checked" shows only without a stop.
    const headRow = conds.find((c) => (c.n.children ?? []).some((k) => k.type === "Text" && k.props?.content === "X0 checked"))!.n;
    expect(headRow.children![0]).toMatchObject({ type: "SVG", visibleIf: { falsy: "chk.stop" } });
    // The slot shows with a head or a first note; "Say what it is." has Fill it in, not Pick.
    expect(conds.some((c) => JSON.stringify(c.n.visibleIf) === JSON.stringify({ any: [{ truthy: "chk.items.0.head" }, { truthy: "chk.items.0.notes.0.text" }] }))).toBe(true);
    expect(ofText("Fill it in").some((c) => c.includes('"eq":["chk.items.0.notes.0.id","no_title"]'))).toBe(true);
    expect(ofText("Pick").some((c) => c.includes('"neq":["chk.items.0.notes.0.id","no_title"]'))).toBe(true);
  });

  it("a bill's preview takes the words out of the box and shows what Done would add; Open chat is a pill here", async () => {
    const { s, nodes } = await draw("phone");
    const fill = flat(nodes.find((n) => n.type === "TextField" && n.bind?.value === "say")!.on!.onSubmit);
    const preview = fill.find((a) => a.kind === "condition" && JSON.stringify(a.if) === JSON.stringify({ eq: ["res.kind", "preview"] }))!;
    expect(flat(preview.then)).toEqual(expect.arrayContaining([{ kind: "clearState", path: "say" }]));
    expect(nodes.some((n) => n.bind?.content === "pre.sum")).toBe(true);
    // Open chat (a day's answer, the chat's answer): an outlined pill, not a grey caption.
    const chat = pressable(nodes, "Open chat");
    expect(chat.length).toBeGreaterThan(0);
    for (const c of chat) expect(c.style).toMatchObject({ borderWidth: 1, borderRadius: 16 });
    void s;
  });
});

