/**
 * The You tab's "Hand it to me" card (assistant.ts youCard): Ask from the tab,
 * the next three tasks, and the connected apps, only while connected apps are on.
 *
 * What must hold: the card is there only with CONNECTORS on; its Do it runs
 * exactly what assistant_ask's Do it runs; what waits for an OK comes first and
 * opens the confirm sheet; never more than three rows; See all and Add more
 * apps go where they say; the tab still has its one Blip; neon is for done and
 * connected only; and nothing is sent that a shipped build cannot draw.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }) } };
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

const { buildScreen } = await import("../src/experience/catalog.js");
const { comingUp, askExamples } = await import("../src/experience/assistant.js");
const { localize } = await import("../src/experience/i18n.js");
const { SW } = await import("../src/experience/settingsWords.js");
const { NEON } = await import("../src/experience/touches.js");
const { PHONE_FONT } = await import("../src/experience/phoneLook.js");
const { APP_ICON_IDS } = await import("../src/experience/appIcons.js");

type AnyNode = {
  type?: string; props?: Record<string, any>; style?: Record<string, any>; on?: Record<string, any>;
  bind?: Record<string, string>; visibleIf?: unknown; children?: AnyNode[];
};
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
const poses = (root: unknown) => nodes(root, (n) => n.type === "Image" && /\/blip\//.test(String(n.props?.source?.url))).map((n) => String(n.props!.source.url).match(/\/blip\/([a-z]+-[sl])\.webp/)![1]!);

// ---- fixtures -------------------------------------------------------------------

const app = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  id, name, category: "Docs", oneLine: "Search, read and write pages.", auth: "oauth", connected: true, level: "look", auto: [], ...o,
});
const names: Record<string, string> = { notion: "Notion", slack: "Slack", gmail: "Gmail", zapier: "Zapier", "google-calendar": "Google Calendar", trello: "Trello", linear: "Linear" };
const task = (id: string, state: string, o: Record<string, unknown> = {}) => ({
  id, state, title: `Task ${id}`, steps: [{ at: 1, text: `Step of ${id}` }], approval: null, createdAt: 1, updatedAt: 1, ...o,
});
const waiting = (id: string, connector = "notion", o: Record<string, unknown> = {}) =>
  task(id, "waiting", { approval: { id: "ap" + id, connector, tool: "create_page", risk: "write", preview: "Add the page Gym" }, ...o });

const you = (extra: Record<string, unknown> = {}) =>
  buildScreen("personality", {
    personality: {}, language: "en", name: "Asha", platform: "ios", tzOffsetMinutes: 330, connectorsOn: true,
    assistant: { apps: [app("notion", "Notion")], names, tasks: [] }, ...extra,
  } as never) as any;
const ask = (extra: Record<string, unknown> = {}) =>
  buildScreen("assistant_ask", {
    personality: {}, language: "en", platform: "ios", tzOffsetMinutes: 330, connectorsOn: true,
    assistant: { apps: [], names, tasks: [] }, ...extra,
  } as never) as any;

/** The card: the one node that carries its heading. */
const cardOf = (s: any): AnyNode =>
  nodes(s.root, (n) => n.type === "Stack" && n.props?.keepCase === true && texts(n).includes(SW["y.h"].en))
    .sort((a, b) => nodes(a).length - nodes(b).length)[0]!;
/** The tab's one column of cards: the greeting line first, then the cards in order. */
const columnOf = (s: any): AnyNode[] => s.root.children[0].children[0].children as AnyNode[];
/** The node (a pill) that says `label` and does something when pressed. */
const pressing = (root: unknown, label: string): AnyNode =>
  nodes(root, (n) => !!n.on?.onPress && texts(n).includes(label)).sort((a, b) => nodes(a).length - nodes(b).length)[0]!;
/** The rows of Coming up: the ones that are drawn from `up.N.title`. */
const upRows = (card: AnyNode): AnyNode[] =>
  nodes(card, (n) => n.type === "Stack" && !!n.on?.onPress && nodes(n, (m) => m.bind?.content?.startsWith("up.") === true).length > 0
    && !nodes(n, (m) => m !== n && m.type === "Stack" && !!m.on?.onPress && nodes(m, (k) => k.bind?.content?.startsWith("up.") === true).length > 0 && m.style?.borderRadius === 16).length
    && n.style?.borderRadius === 16);
const rowTitle = (r: AnyNode, s: any): string => s.state.up[Number(nodes(r, (m) => m.bind?.content?.endsWith(".title") === true)[0]!.bind!.content.split(".")[1])].title;

// ---- the card is only there while connected apps are on --------------------------

describe("You: Hand it to me", () => {
  it("is there while connected apps are on, and not otherwise", () => {
    const on = you();
    expect(texts(on.root)).toContain(SW["y.h"].en);
    expect(on.state.ask).toBeDefined();
    for (const off of [{ connectorsOn: false }, { connectorsOn: undefined }]) {
      const s = you(off);
      expect(texts(s.root)).not.toContain(SW["y.h"].en);
      expect(nodes(s.root, (n) => n.type === "TextField" || n.type === "VoiceButton")).toEqual([]);
      expect(JSON.stringify(s)).not.toContain("/v1/assistant/ask");
      expect(s.state).toEqual({ deck: 0, hapticsOn: false, askHapticsOff: false });
      expect(s.cacheTtlSeconds).toBe(45);
    }
    // It sits under the greeting, before the voice card.
    const kids = columnOf(on);
    expect(poses(kids[0])).toEqual(["wave-l"]);
    expect(kids[1]).toBe(cardOf(on));
    expect(columnOf(you({ connectorsOn: false })).length).toBe(kids.length - 1);
    expect(on.cacheTtlSeconds).toBe(15);
  });

  it("opens with the heading in the onboarding's heading face and one warm line", () => {
    const card = cardOf(you());
    const head = nodes(card, (n) => n.type === "Text" && n.props?.content === SW["y.h"].en)[0]!;
    expect(head.style!.fontFamily).toBe(PHONE_FONT.grotesk);
    expect(SW["y.h"].en).toBe("Hand it to me");
    expect(SW["y.p"].en).toBe("Tell me what to do, and I’ll do it in your apps.");
    const line = nodes(card, (n) => n.type === "Text" && n.props?.content === SW["y.p"].en)[0]!;
    expect(line.style!.fontFamily).toBe(PHONE_FONT.ui);
    expect(texts(card).indexOf(SW["y.p"].en)).toBe(texts(card).indexOf(SW["y.h"].en) + 1);
  });

  it("the words are set as written: the card is kept out of the capitalising pass", () => {
    const card = cardOf(you());
    expect(card.props!.keepCase).toBe(true);
    expect(texts(card)).toContain("Tell me what to do, and I’ll do it in your apps.");
    expect(texts(card)).toContain(SW["y.up"].en);
  });

  // ---- Ask, from the tab ----------------------------------------------------------

  it("a field and the mic both write to the same place, and the examples fill it in", () => {
    const s = you();
    const card = cardOf(s);
    const field = nodes(card, (n) => n.type === "TextField")[0]!;
    const mic = nodes(card, (n) => n.type === "VoiceButton")[0]!;
    expect(field.bind).toEqual({ value: "ask.text" });
    expect(mic.bind).toEqual({ value: "ask.text" });
    expect(field.props!.placeholder).toBe("Type or say what you need");
    // The same field and mic as the Ask screen's, node for node.
    const a = ask();
    expect(field).toEqual(nodes(a.root, (n) => n.type === "TextField")[0]);
    // (its fill is a shade of the card's cream, not the Ask page's grey)
    const askMic = nodes(a.root, (n) => n.type === "VoiceButton")[0]!;
    // The same mic, painted in each screen's own ground and ink.
    expect({ ...mic.props, background: 0, color: 0 }).toEqual({ ...askMic.props, background: 0, color: 0 });
    // Examples: state holds them, the chips show and fill exactly that.
    expect(s.state.ask).toEqual({ text: "", busy: false, res: {}, ex: askExamples("en") });
    expect(s.state.ask).toEqual(a.state.ask);
    const chips = nodes(card, (n) => n.type === "Stack" && n.on?.onPress?.kind === "sequence" && n.on.onPress.actions.length === 2 && n.on.onPress.actions[1].path === "ask.text");
    expect(chips.length).toBe(3);
    chips.forEach((c, i) => {
      expect(actions(c.on).find((x) => x.kind === "setState")).toEqual({ kind: "setState", path: "ask.text", value: s.state.ask.ex[i] });
      expect(nodes(c, (n) => n.type === "Text")[0]!.bind).toEqual({ content: `ask.ex.${i}` });
    });
  });

  it("Do it runs exactly the actions assistant_ask's Do it runs", () => {
    for (const ctx of [{}, { platform: "android", tzOffsetMinutes: -240 }, { platform: undefined, tzOffsetMinutes: undefined }]) {
      const mine = pressing(cardOf(you(ctx)), "Do it");
      const theirs = pressing(ask(ctx).root, "Do it");
      expect(mine.on!.onPress).toEqual(theirs.on!.onPress);
      expect(JSON.stringify(mine.on)).toContain('"path":"/v1/assistant/ask"');
    }
    const flow = JSON.stringify(pressing(cardOf(you()), "Do it").on);
    // The ask, then its answer acted on: its line, a hand-off, or the approval sheet.
    expect(flow).toContain('"text":"$state.ask.text"');
    expect(flow).toContain('"assignTo":"ask.res"');
    expect(flow).toContain('"handoff":true');
    expect(flow).toContain('"screenId":"assistant_approve"');
    // Its line is drawn from state, never reworded.
    expect(nodes(cardOf(you()), (n) => n.bind?.content === "ask.res.say").length).toBe(1);
  });

  it("examples are in their voice: Hinglish gets the Hinglish ones, in state", () => {
    const s = you({ language: "hinglish" });
    expect(s.state.ask.ex).toEqual(ask({ language: "hinglish" }).state.ask.ex);
    expect(s.state.ask.ex[0]).toBe("Mom ko WhatsApp pe bolo main raaste mein hoon");
  });

  it("working shows a plain line, with no Blip", () => {
    const card = cardOf(you());
    const busy = nodes(card, (n) => JSON.stringify(n.visibleIf) === JSON.stringify({ truthy: "ask.busy" }))[0]!;
    expect(texts(busy)).toEqual(["On it…"]);
    expect(poses(card)).toEqual([]);
  });

  // ---- Coming up -------------------------------------------------------------------

  it("waiting for you comes first, then running, then the latest done; never more than three", () => {
    const tasks = [
      task("d1", "done", { updatedAt: 10 }), task("r1", "running"), waiting("w1"), task("d2", "done", { updatedAt: 50 }),
      waiting("w2", "slack"), task("r2", "running"), task("f1", "failed"), task("c1", "cancelled"),
    ];
    expect(comingUp(tasks as never).map((x) => x.id)).toEqual(["w1", "w2", "r1"]);
    expect(comingUp([task("d1", "done", { updatedAt: 10 }), task("r1", "running"), task("d2", "done", { updatedAt: 50 })] as never).map((x) => x.id)).toEqual(["r1", "d2"]);
    expect(comingUp([waiting("w1"), task("d1", "done")] as never).map((x) => x.id)).toEqual(["w1", "d1"]);
    // failed, cancelled and a waiting task that has no card to answer are not "coming up".
    expect(comingUp([task("f1", "failed"), task("c1", "cancelled"), task("w0", "waiting")] as never)).toEqual([]);

    const s = you({ assistant: { apps: [app("notion", "Notion")], names, tasks: [...tasks, waiting("w3"), waiting("w4")] } });
    const rows = upRows(cardOf(s));
    expect(rows.length).toBe(3);
    expect(rows.map((r) => rowTitle(r, s))).toEqual(["Task w1", "Task w2", "Task w3"]);
    expect(s.state.up.length).toBe(3);

    const mixed = you({ assistant: { apps: [], names, tasks: [task("d1", "done", { updatedAt: 3 }), task("r1", "running"), waiting("w1")] } });
    expect(upRows(cardOf(mixed)).map((r) => rowTitle(r, mixed))).toEqual(["Task w1", "Task r1", "Task d1"]);
  });

  it("a waiting task shows the app's logo (or its letter), its title, and a Needs your OK pill that opens the sheet for that task", () => {
    const s = you({ assistant: { apps: [app("notion", "Notion")], names, tasks: [waiting("w1", "notion"), waiting("w2", "trello")] } });
    const [first, second] = upRows(cardOf(s));
    expect(SW["y.ok"].en).toBe("Needs your OK");
    for (const [row, id] of [[first!, "w1"], [second!, "w2"]] as const) {
      const pill = nodes(row, (n) => !!n.on?.onPress && texts(n).includes("Needs your OK"))[0]!;
      expect(actions(pill.on).find((a) => a.kind === "navigate")).toEqual({ kind: "navigate", screenId: "assistant_approve", params: { taskId: id } });
      // The row itself leads there too.
      expect(actions(row.on).find((a) => a.kind === "navigate")).toEqual({ kind: "navigate", screenId: "assistant_approve", params: { taskId: id } });
    }
    // Notion has a logo; Trello has none here, so it keeps its letter from state.
    expect(APP_ICON_IDS).toContain("notion");
    expect(nodes(first!, (n) => n.type === "Image" && /\/icons\/notion\.png/.test(String(n.props?.source?.url))).length).toBe(1);
    if (!APP_ICON_IDS.includes("trello")) {
      expect(nodes(second!, (n) => n.bind?.content === "ini.trello").length).toBe(1);
      expect(s.state.ini.trello).toBe("T");
    }
    // The person's and the app's words are in state, never in a node.
    expect(s.state.up[0]).toEqual({ title: "Task w1", sub: "Notion" });
    expect(JSON.stringify(cardOf(s))).not.toContain("Task w1");
    expect(JSON.stringify(cardOf(s))).not.toContain("Add the page Gym");
  });

  it("running and done rows: their last step beneath, a neon tick on done only", () => {
    const s = you({ assistant: { apps: [], names, tasks: [task("r1", "running"), task("d1", "done")] } });
    const [run, done] = upRows(cardOf(s));
    expect(s.state.up).toEqual([{ title: "Task r1", sub: "Step of r1" }, { title: "Task d1", sub: "Step of d1" }]);
    const ticks = (n: AnyNode) => nodes(n, (m) => m.type === "SVG" && m.props?.stroke === NEON);
    expect(ticks(done!).length).toBe(1);
    expect(ticks(run!).length).toBe(0);
    // No Needs your OK, and a press goes to Tasks.
    for (const r of [run!, done!]) {
      expect(texts(r)).not.toContain("Needs your OK");
      expect(actions(r.on).find((a) => a.kind === "navigate")).toEqual({ kind: "navigate", screenId: "assistant_tasks" });
    }
  });

  it("empty: one warm line, and See all is still there", () => {
    const s = you();
    const card = cardOf(s);
    expect(SW["y.none"].en).toBe("Nothing on my list yet.");
    expect(texts(card)).toContain("Nothing on my list yet.");
    expect(upRows(card)).toEqual([]);
    expect(s.state.up).toEqual([]);
  });

  it("a read of the assistant that failed leaves the card without Coming up, and nothing else lost", () => {
    const s = you({ assistant: undefined });
    const card = cardOf(s);
    expect(texts(card)).not.toContain("Nothing on my list yet.");
    expect(texts(card)).not.toContain(SW["y.up"].en);
    expect(nodes(card, (n) => n.type === "TextField").length).toBe(1);
    expect(pressing(card, "Do it")).toBeDefined();
    expect(pressing(card, "Add more apps")).toBeDefined();
    expect(s.state.up).toEqual([]);
  });

  // ---- the routes ------------------------------------------------------------------

  it("See all goes to Tasks, Add more apps goes to Connected apps", () => {
    const card = cardOf(you());
    expect(SW["y.all"].en).toBe("See all");
    expect(SW["y.more"].en).toBe("Add more apps");
    expect(actions(pressing(card, "See all").on).find((a) => a.kind === "navigate")).toEqual({ kind: "navigate", screenId: "assistant_tasks" });
    expect(actions(pressing(card, "Add more apps").on).find((a) => a.kind === "navigate")).toEqual({ kind: "navigate", screenId: "assistant_apps" });
  });

  it("the foot shows the logos of up to five connected apps, and neon marks them as connected", () => {
    const seven = ["notion", "slack", "gmail", "zapier", "google-calendar", "trello", "linear"].map((id) => app(id, names[id]!));
    const s = you({ assistant: { apps: [app("x", "Off", { connected: false }), ...seven], names, tasks: [] } });
    const card = cardOf(s);
    const foot = nodes(card, (n) => n.type === "Stack" && texts(n).includes("Add more apps") && n.style?.justifyContent === "space-between")
      .sort((a, b) => nodes(a).length - nodes(b).length)[0]!;
    const marks = nodes(foot, (n) => n.type === "Stack" && n.style?.width === 28 && n.style?.height === 28);
    expect(marks.length).toBe(5);
    // The five first connected apps, in the catalog's order; the one not connected is not among them.
    expect(Object.keys(s.state.ini).sort()).toEqual(["gmail", "notion", "slack", "zapier", "google-calendar"].sort());
    expect(nodes(foot, (n) => n.style?.backgroundColor === NEON).length).toBe(1);
    // None connected: no logos and no neon.
    const none = you({ assistant: { apps: [app("x", "Off", { connected: false })], names, tasks: [] } });
    expect(nodes(cardOf(none), (n) => n.style?.backgroundColor === NEON || n.props?.stroke === NEON)).toEqual([]);
    // An app added by link never gets a logo, only its letter.
    const custom = you({ assistant: { apps: [app("c_1234", "Mine", { custom: true, auth: "url" })], names, tasks: [] } });
    expect(nodes(cardOf(custom), (n) => n.type === "Image")).toEqual([]);
  });

  it("neon is only for done and connected", () => {
    const s = you({ assistant: { apps: [app("notion", "Notion")], names, tasks: [waiting("w1"), task("r1", "running"), task("d1", "done")] } });
    const card = cardOf(s);
    const neon = nodes(card, (n) => n.style?.backgroundColor === NEON || n.props?.stroke === NEON || n.style?.color === NEON);
    expect(neon.length).toBe(2);   // the done row's tick, and the connected dot in the foot
    const json = JSON.stringify(card);
    expect(json.split(NEON).length - 1).toBe(2);
    // No amber anywhere on the tab.
    expect(JSON.stringify(s).toUpperCase()).not.toContain("E8A23C");
    expect(JSON.stringify(s)).not.toContain("232,162,60");
  });

  // ---- the tab keeps its rules ------------------------------------------------------

  it("still one Blip on You: the greeting's", () => {
    for (const assistant of [undefined, { apps: [], names, tasks: [] }, { apps: [app("notion", "Notion")], names, tasks: [waiting("w1"), task("r1", "running"), task("d1", "done")] }]) {
      expect(poses(you({ assistant }).root)).toEqual(["wave-l"]);
    }
    expect(poses(you({ connectorsOn: false }).root)).toEqual(["wave-l"]);
  });

  it("the tab's other cards are where they were", () => {
    const on = you();
    expect(columnOf(on).filter((n) => n !== cardOf(on))).toEqual(columnOf(you({ connectorsOn: false })));
  });
});

// ---- nothing a shipped build cannot draw ------------------------------------------

/** The phone's CORE_COMPONENTS at origin/main (app/src/sdui/registry.ts) that this card uses, and the ones around it. */
const SHIPPED_NODES = new Set(["Stack", "Text", "Image", "TextField", "VoiceButton", "SVG", "Spacer"]);
const SHIPPED_ACTIONS = new Set(["navigate", "haptic", "setState", "callEndpoint", "condition", "sequence", "toast", "openUrl"]);
/** What each of them reads (components.tsx), as the Ask and Tasks screens already draw them. */
const SHIPPED_PROPS: Record<string, Set<string>> = {
  Stack: new Set(["pressOpacity", "hitSlop", "keepCase"]),
  Text: new Set(["content", "numberOfLines", "keepCase"]),
  Image: new Set(["source", "contentFit"]),
  TextField: new Set(["placeholder", "multiline"]),
  // stopLabel and recordingColor are read by the shipped VoiceButton; its face
  // (fontFamily, fontSize, color) only by builds from the keyboard-fix update
  // on, and a shipped build that ignores them draws its own, as before.
  VoiceButton: new Set(["targetApp", "language", "label", "stopLabel", "background", "recordingColor", "radius", "paddingVertical", "fontFamily", "fontSize", "color"]),
  SVG: new Set(["viewBox", "d", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin"]),
  Spacer: new Set([]),
};

describe("You: Hand it to me draws only what the shipped app draws", () => {
  const full = you({
    assistant: { apps: [app("notion", "Notion"), app("c_1", "Mine", { custom: true })], names, tasks: [waiting("w1"), task("r1", "running"), task("d1", "done")] },
  });
  const card = cardOf(full);

  it("every node type and prop is in the shipped registry", () => {
    for (const n of nodes(card)) {
      expect(SHIPPED_NODES.has(n.type!), n.type).toBe(true);
      const extra = Object.keys(n.props ?? {}).filter((k) => !SHIPPED_PROPS[n.type!]!.has(k));
      expect(extra, n.type).toEqual([]);
    }
  });

  it("every action is one the shipped app runs", () => {
    const kinds = new Set(actions(card).map((a) => a.kind as string));
    expect([...kinds].filter((k) => !SHIPPED_ACTIONS.has(k))).toEqual([]);
    // No Blip, no Button, no node of ours the phone has to learn.
    expect(nodes(card, (n) => n.type === "Button" || n.type === "Row")).toEqual([]);
  });

  it("the card's state is the screen's own and clashes with none of the tab's", () => {
    expect(Object.keys(full.state).sort()).toEqual(["ask", "askHapticsOff", "deck", "hapticsOn", "ini", "up"]);
  });
});

// ---- words --------------------------------------------------------------------------

describe("You: Hand it to me, in Hinglish", () => {
  it("the design's words are used as written", async () => {
    const s = you({ language: "hinglish", assistant: { apps: [app("notion", "Notion")], names, tasks: [waiting("w1")] } });
    const json = JSON.stringify(await localize(s, "hinglish"));
    for (const hg of [
      SW["y.h"].hg, SW["y.p"].hg, SW["y.up"].hg, SW["y.ok"].hg, SW["y.all"].hg, SW["y.more"].hg,
      "Kar do", "Likho ya bolo, kya chahiye", "Kar raha hoon…",
    ]) expect(json, hg).toContain(hg);
    const empty = JSON.stringify(await localize(you({ language: "hinglish" }), "hinglish"));
    expect(empty).toContain(SW["y.none"].hg);
    // The examples are Hinglish too, from state.
    expect(empty).toContain("Mom ko WhatsApp pe bolo main raaste mein hoon");
  });

  it("each new line has its Hinglish beside it, and the sentences are marked as sentences", () => {
    for (const k of ["y.h", "y.p", "y.up", "y.ok", "y.none", "y.all", "y.more"] as const) {
      expect(SW[k].hg.length, k).toBeGreaterThan(3);
      expect(SW[k].hg, k).not.toBe(SW[k].en);
    }
    expect((SW["y.p"] as { sentence?: true }).sentence).toBe(true);
    expect((SW["y.none"] as { sentence?: true }).sentence).toBe(true);
  });
});
