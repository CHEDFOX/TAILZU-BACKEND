/**
 * THE MAIL BOT'S CALLS ON SCREEN (screens/bots/mailCalls.ts, mailPage.ts): the mail page's Calls with Start a call and the latest calls, only
 * when calls are on for the business; one call's screen with its link (Copy and Share), who waits with Let in and Not now, who is in with
 * Remove for a guest, the lobby's switch, End for everyone on a second yes, a line that joining from the app comes with its next update and
 * never a web page; an ended call with no link; a call that isn't there. Every tree is drawn by the shipped app (the linter), on the phone and
 * in the window.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");
const { topicsForScreen } = await import("../src/live/topics.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const RID = "3f2b8c1e-5a47-4d0e-9b61-0c7d2e8a1f44";
const BOT = {
  slug: "mail", name: "Mail", colour: "sand", builtin: true, publicCard: false, tone: "", principles: [], purpose: "Keeps your business's email.",
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const BIZ = {
  id: "leaf-co", name: "Leaf & Co", domain: "leafandco.in", email: "hello@leafandco.in", signature: "", ready: true, allowance: { spentUsd: 0, capUsd: 1 },
  addresses: [{ id: 1, email: "hello@leafandco.in", label: "", isPrimary: true, aiMode: "draft", displayName: "", autoReply: null }],
};
const ROOM = (o: Record<string, unknown> = {}) => ({
  id: RID, title: "Order 1234", host: "Leaf & Co", link: "https://x0bot.com/m/abc-defg-hjk", code: "abc-defg-hjk", status: "open", lobby: true,
  people: [], waiting: [], businessId: "leaf-co", createdAt: FIXED_NOW - 3_600_000, lastAt: FIXED_NOW - 3_600_000, minutes: 0, ...o,
});

async function build(o: { screen?: string; params?: Record<string, string>; client?: "phone" | "desktop"; can?: string[]; blocks?: string[]; calls?: unknown[] | null; room?: unknown } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "mail", name: "Mail", colour: "sand", purpose: BOT.purpose, builtin: true }], calls,
    api: {
      "GET /v1/bots/mail": { bot: BOT }, "GET /v1/bots/mail/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/mail/connectors": { connectors: [] },
      "GET /v1/botsapp/bots/chat/mail?limit=1": { turns: [] }, "GET /v1/botsapp/bots/chat/mail?limit=30": { turns: [] },
      "GET /v1/mail/overview": { businesses: [BIZ], waiting: [], today: { received: 1, answered: 0, drafted: 0, needsPerson: 0, filed: 1 } },
      "GET /v1/mail/businesses/leaf-co/activity?limit=40": { runs: [] },
      ...(o.calls === null ? {} : { "GET /v1/mail/businesses/leaf-co/calls": { calls: o.calls ?? [] } }),
      ...(o.room ? { [`GET /v1/rooms/${RID}`]: { room: o.room } } : {}),
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: o.client ?? "phone", params: { slug: "mail", ...(o.params ?? {}) }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, can: new Set(o.can ?? DRAWS), ...(o.blocks ? { blocks: new Set(o.blocks) } : {}),
    desk: { pages: false, notes: false },
  }, deps);
  const root = s.root as Node;
  const needs = (s as unknown as { needs?: string[] }).needs ?? [];
  // walk() follows children; a List's or an Each's row template lives in its props, so that subtree is walked too.
  const expand = (ns: Node[]): Node[] => ns.flatMap((n) => {
    const item = (n.props as { item?: Node } | undefined)?.item;
    return item && typeof item === "object" ? [n, ...expand(walk(item))] : [n];
  });
  const nodes = expand(walk(root));
  const flat = (a: unknown): ActionSpec[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as ActionSpec & { actions?: unknown[]; then?: unknown; else?: unknown; ok?: unknown; fail?: unknown };
    return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else), ...flat(x.ok), ...flat(x.fail)];
  };
  return {
    s, lint: lintTree(root, { needs }), nodes,
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    every: () => nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat),
  };
}
const endpoints = (acts: ActionSpec[]) => acts.filter((a) => a.kind === "callEndpoint") as Array<Extract<ActionSpec, { kind: "callEndpoint" }>>;
const callScreen = (o: Parameters<typeof build>[0] = {}) => build({ screen: "bots.mail.call", params: { b: "leaf-co", r: RID }, ...o });

describe("the mail page's calls", () => {
  it("start a call under the business, and list the latest", async () => {
    const p = await build({ calls: [ROOM({ status: "live", people: [{ identity: "h_1", name: "Aanya", role: "host", since: FIXED_NOW }] }), ROOM({ id: "x", title: "Returns" })] });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Calls", "Start a call", "Order 1234", "On now · 1 person", "Returns"]));
    expect(endpoints(p.every()).find((c) => c.path === "/v1/mail/businesses/leaf-co/calls")).toMatchObject({ method: "POST" });
    expect(p.every().some((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === "bots.mail.call")).toBe(true);
  });

  it("say what calls are before the first", async () => {
    const p = await build({ calls: [] });
    expect(p.texts.some((t) => /Nobody needs an app or an account to join/.test(t))).toBe(true);
  });

  it("are not there while calls are off, or the business isn't theirs to call from", async () => {
    const p = await build({ calls: null });
    expect(p.lint).toEqual([]);
    expect(p.texts).not.toContain("Calls");
    expect(p.texts).not.toContain("Start a call");
  });
});

describe("one call", () => {
  it("joins into the call for a client that has the block", async () => {
    const p = await callScreen({ room: ROOM(), blocks: ["call"] });
    expect(p.lint).toEqual([]);
    const opens = p.every().filter((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === "bots.mail.room") as Array<{ params: Record<string, string> }>;
    expect(opens.map((o) => o.params)).toEqual([{ b: "leaf-co", r: RID, video: "1" }, { b: "leaf-co", r: RID, video: "0" }]);
    expect(p.texts).toEqual(expect.arrayContaining(["Join with video", "Audio only"]));
  });

  it("says joining comes with the app's next update for a client without it, and never a web page", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const p = await callScreen({ client, room: ROOM() });
      expect(p.every().some((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === "bots.mail.room")).toBe(false);
      expect(p.lint).toEqual([]);
      expect(p.texts.some((t) => /comes with the app's next update/.test(t))).toBe(true);
      expect(p.every().some((a) => a.kind === "openUrl")).toBe(false);
    }
  });

  it("shows its link with Copy and Share, and the lobby's switch", async () => {
    const p = await callScreen({ room: ROOM() });
    expect(p.texts).toEqual(expect.arrayContaining(["https://x0bot.com/m/abc-defg-hjk", "Copy", "Share", "Ask before letting people in"]));
    const acts = p.every();
    expect(acts.some((a) => a.kind === "copyToClipboard" && (a as { text: string }).text === "https://x0bot.com/m/abc-defg-hjk")).toBe(true);
    expect(acts.some((a) => a.kind === "share" && (a as { url: string }).url === "https://x0bot.com/m/abc-defg-hjk")).toBe(true);
    expect(endpoints(acts).find((c) => c.method === "PUT")).toMatchObject({ path: `/v1/rooms/${RID}`, body: { lobby: false } });
  });

  it("lets in who waits, or not, and sends a guest away", async () => {
    const p = await callScreen({ room: ROOM({
      status: "live", waiting: [{ id: "knock-0001", name: "Ravi", since: FIXED_NOW }],
      people: [{ identity: "h_1", name: "Aanya", role: "host", since: FIXED_NOW }, { identity: "g_2", name: "Asha", role: "guest", since: FIXED_NOW }],
    }) });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Waiting to join", "Ravi", "Let in", "Not now", "In the call", "Asha", "Remove"]));
    const e = endpoints(p.every()).map((c) => [c.path, c.body]);
    expect(e).toEqual(expect.arrayContaining([
      [`/v1/rooms/${RID}/admit`, { knock: "knock-0001" }],
      [`/v1/rooms/${RID}/deny`, { knock: "knock-0001" }],
      [`/v1/rooms/${RID}/remove`, { identity: "g_2" }],
    ]));
    // The host is never sent away from their own call.
    expect(e.some(([path, body]) => path === `/v1/rooms/${RID}/remove` && (body as { identity: string }).identity === "h_1")).toBe(false);
  });

  it("ends for everyone only on a second yes", async () => {
    const p = await callScreen({ room: ROOM() });
    expect(p.texts).toEqual(expect.arrayContaining(["End the call for everyone", "End the call for everyone? The link stops working."]));
    expect((p.s as unknown as { state: Record<string, unknown> }).state.rc_sure).toBe(false);
    expect(endpoints(p.every()).some((c) => c.path === `/v1/rooms/${RID}/end`)).toBe(true);
  });

  it("ended, has no link and nothing to join", async () => {
    const p = await callScreen({ room: ROOM({ status: "ended" }) });
    expect(p.lint).toEqual([]);
    expect(p.texts.some((t) => /comes with the app's next update/.test(t))).toBe(false);
    expect(p.texts).not.toContain("https://x0bot.com/m/abc-defg-hjk");
    expect(p.texts.some((t) => /has ended/.test(t))).toBe(true);
  });

  it("that isn't there, says so with a way back", async () => {
    const p = await callScreen();
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("This call couldn't be found.");
  });

  it("is read again as people come and go", () => {
    expect(topicsForScreen("bots.mail.call", { r: RID })).toEqual([`room:${RID}`]);
  });
});

describe("in a call", () => {
  type Spec = ActionSpec & Record<string, unknown>;
  const inCall = (o: Parameters<typeof build>[0] = {}) =>
    build({ screen: "bots.mail.room", params: { b: "leaf-co", r: RID, video: "1" }, blocks: ["call"], room: ROOM(), ...o });
  const parts = async (o: Parameters<typeof build>[0] = {}) => {
    const p = await inCall(o);
    const s = p.s as unknown as { state: Record<string, unknown>; actions: Record<string, Spec>; needs?: string[] };
    return { p, nodes: p.nodes, state: s.state, actions: s.actions, needs: s.needs ?? [] };
  };

  it("takes a seat as it opens, and says it needs the call block", async () => {
    const { p, nodes, state, actions, needs } = await parts();
    expect(p.lint).toEqual([]);
    expect(needs).toContain("call");
    expect(actions.start).toMatchObject({ kind: "call.join", join: `/v1/rooms/${RID}/join`, statePath: "c", video: true });
    expect((actions.start.onEnd as Spec)).toMatchObject({ kind: "navigate", screenId: "bots.mail.call", replace: true });
    expect(nodes.some((n) => (n.on as Record<string, unknown> | undefined)?.onAppear === "start")).toBe(true);
    expect(state.c).toMatchObject({ phase: "connecting", mic: true, cam: true });
    // The seat is never in the screen's state.
    expect(JSON.stringify(state)).not.toContain("seat");
  });

  it("draws one tile per person, and their own picture", async () => {
    const { nodes } = await parts();
    const callers = nodes.filter((n) => n.type === "Caller");
    expect(callers.length).toBeGreaterThanOrEqual(2);
    // One tile inside an Each over the people, and their own with who "me".
    expect(nodes.some((n) => n.type === "Each" && JSON.stringify((n.props as Record<string, unknown>)?.data) === JSON.stringify({ $: "state.c.people" }))).toBe(true);
    expect(callers.some((n) => (n.props as Record<string, unknown>)?.who === "me")).toBe(true);
    expect(callers.some((n) => JSON.stringify((n.props as Record<string, unknown>)?.who) === JSON.stringify({ $: "item.identity" }))).toBe(true);
  });

  it("starts an audio call with the camera off", async () => {
    const { actions, state } = await parts({ params: { b: "leaf-co", r: RID, video: "0" } });
    expect(actions.start).toMatchObject({ video: false });
    expect(state.c).toMatchObject({ cam: false });
  });

  it("works the call from the server's own buttons", async () => {
    const phone = await inCall();
    const ops = (acts: ActionSpec[]) => acts.filter((a) => a.kind === "call.set" || a.kind === "call.leave")
      .map((a) => [(a as Spec).kind, (a as Spec).op, (a as Spec).value]);
    expect(ops(phone.every())).toEqual(expect.arrayContaining([
      ["call.set", "mic", false], ["call.set", "mic", true], ["call.set", "cam", false], ["call.set", "cam", true],
      ["call.set", "flip", undefined], ["call.set", "speaker", true], ["call.leave", undefined, undefined],
    ]));
    expect(phone.texts).toEqual(expect.arrayContaining(["Mute", "Unmute", "Camera off", "Camera on", "Flip", "Speaker", "Hang up"]));
    const desk = await inCall({ client: "desktop" });
    expect(desk.texts).not.toContain("Flip");
    expect(desk.texts).toContain("Hang up");
  });

  it("says where the call stands, and lets in who waits, from the call's own state", async () => {
    const { p, nodes } = await parts();
    const shown = nodes.filter((n) => n.visibleIf).map((n) => JSON.stringify(n.visibleIf));
    for (const phase of ["connecting", "live", "reconnecting", "ended", "failed"]) {
      expect(shown.some((c) => c.includes(`state.c.phase == '${phase}'`))).toBe(true);
    }
    // Who waits comes from the call, not from reading the page again.
    expect(nodes.some((n) => n.type === "Each" && JSON.stringify((n.props as Record<string, unknown>)?.data) === JSON.stringify({ $: "state.c.waiting" }))).toBe(true);
    expect(endpoints(p.every()).map((c) => c.path)).toEqual(expect.arrayContaining([`/v1/rooms/${RID}/admit`, `/v1/rooms/${RID}/deny`]));
  });

  it("asks for the microphone when it was refused", async () => {
    const { p, actions, state } = await parts();
    expect(actions.start.onBlocked).toEqual({ kind: "setState", path: "micCard", value: true });
    expect(state.micCard).toBe(false);
    expect(p.texts).toContain("Let X0 Bot hear you");
  });

  it("has nothing to join for a call that ended or isn't there", async () => {
    for (const o of [{ room: ROOM({ status: "ended" }) }, { room: undefined }]) {
      const { p, nodes, actions, needs } = await parts(o);
      expect(p.lint).toEqual([]);
      expect(nodes.some((n) => n.type === "Caller")).toBe(false);
      expect(actions?.start).toBeUndefined();
      // Nothing to need: it is a plain vocabulary-1 card, so every build can read it.
      expect(needs).toEqual([]);
    }
  });

  it("is read again as people come and go", () => {
    expect(topicsForScreen("bots.mail.room", { r: RID })).toEqual([`room:${RID}`]);
  });
});
