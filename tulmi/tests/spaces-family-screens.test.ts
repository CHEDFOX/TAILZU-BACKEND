/**
 * SPACES, THE FAMILY REDESIGN, AS THE SERVER DRAWS IT (experience/bots/screens/spaces/{start,feed,peoplePage}.ts, screens/work.ts and
 * work/workTab.ts, screens/shell/homeThought.ts; shared/types/sdui.ts 3i): the new screens go only to a build that declares every
 * block they draw, voice only to one that listens with live words, and every older build keeps today's screens untouched.
 * The data is tests/spaces-data.ts (the new Spaces' reads) and tests/bots-bots-data.ts (the bots' pages).
 */
import { describe, expect, it, vi } from "vitest";
import type { Node, ScreenResponse } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
});

const { buildBotsScreen, BOTS_SCREENS } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, ctxFor } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { canSpaces2, canHomeThought, canVoice, canDeskTalk } = await import("../src/experience/bots/kit.js");
const { sampleApi } = await import("./bots-bots-data.js");
const D = await import("./spaces-data.js");

const A = "/v1/botsapp/bots";
type Client = "phone" | "desktop";

/** Every block of the new Spaces and Home's thought, with voice (sdui 3i). The phone also says it fills "$state" params. */
const NEW = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras"];
const OLD = ["BotsKit", "FileUpload"];
const VOICELESS = NEW.filter((n) => !["VoiceLive", "LiveWords", "DoubleTap"].includes(n));
const canOf = (client: Client, base: string[] = NEW): string[] => [...base, ...(client === "phone" ? ["ActionParams"] : ["DeskTalkTo"])];

async function build(screenId: string, client: Client, o: { params?: Record<string, string | number>; api?: Record<string, unknown>; can?: string[]; calls?: Array<{ method: string; path: string }> } = {}) {
  const s = await buildBotsScreen(
    { screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: "u", name: "Aanya" }, can: new Set(o.can ?? canOf(client)), desk: { pages: client === "desktop", notes: client === "desktop" } },
    fakeDeps({ api: o.api ?? D.spacesApi(), ...(o.calls ? { calls: o.calls } : {}) }),
  );
  return { s, nodes: walk(s.root!) };
}
const texts = (nodes: Node[]): string[] => nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
const ofType = (nodes: Node[], type: string) => nodes.filter((n) => n.type === type);

/** Every action anywhere in a screen: in nodes' `on`, nested in sequences and conditions, and in props that hold actions. */
function actionsIn(x: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(x)) { for (const v of x) actionsIn(v, out); return out; }
  if (!x || typeof x !== "object") return out;
  const o = x as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o);
  for (const v of Object.values(o)) actionsIn(v, out);
  return out;
}
const callsIn = (x: unknown) => actionsIn(x).filter((a) => a.kind === "callEndpoint");
const callTo = (x: unknown, method: string, path: string) => callsIn(x).find((a) => a.method === method && a.path === path);
const said = (a: unknown) => JSON.stringify(a).includes('"truthy":"lastError.message"');

describe("the gates", () => {
  it("the new Spaces only for a build with every block; the phone must fill \"$state\" params too, the window always does", () => {
    const ctx = (client: Client, can: string[]) => ctxFor("bots.spaces", client, undefined, { can: new Set(can) });
    expect(canSpaces2(ctx("phone", canOf("phone")))).toBe(true);
    expect(canSpaces2(ctx("phone", NEW))).toBe(false);
    expect(canSpaces2(ctx("desktop", NEW))).toBe(true);
    expect(canSpaces2(ctx("desktop", OLD))).toBe(false);
    expect(canHomeThought(ctx("phone", ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "KitExtras"]))).toBe(true);
    expect(canVoice(ctx("phone", VOICELESS))).toBe(false);
    expect(canDeskTalk(ctx("phone", canOf("phone")))).toBe(false);
    expect(canDeskTalk(ctx("desktop", canOf("desktop")))).toBe(true);
  });

  it("a phone without ActionParams gets today's Spaces; the window with NEW (no ActionParams) gets the new one", async () => {
    const phone = await build("bots.spaces", "phone", { can: NEW });
    expect(ofType(phone.nodes, "BotStage")).toHaveLength(0);
    expect(texts(phone.nodes)).toContain("Start a space");
    const desk = await build("bots.spaces", "desktop", { can: NEW });
    expect(ofType(desk.nodes, "BotStage")).toHaveLength(1);
  });

  // THE GATING SWEEP: nothing of 3i reaches an older build, and nothing of voice reaches a build that can't listen.
  const NODES_3I = ["BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords"];
  const PARAMS: Array<[string, Record<string, string>]> = [
    ...[...BOTS_SCREENS.keys()].map((id) => [id, {}] as [string, Record<string, string>]),
    ["bots.spaces", { id: "s1" }], ["bots.spaces", { made: "s1" }], ["bots.spaces", { thought: "1" }], ["bots.space.people", { id: "s1" }],
    ["bots.space.invite", { id: "s1" }], ["bots.space.member", { id: "s1", member: "r" }],
    ["bots.work", { bot: "plan", space: "s1", owner: "m" }], ["bots.work", { bot: "plan", space: "s1", owner: "m", item: "e:doctor@2026-11-14" }],
  ];
  function leaks(s: ScreenResponse, voiceOnly: boolean): string[] {
    const bad: string[] = [];
    const visit = (x: unknown) => {
      if (Array.isArray(x)) { x.forEach(visit); return; }
      if (!x || typeof x !== "object") return;
      const o = x as Record<string, unknown>;
      if (typeof o.type === "string") {
        if (o.type === "LiveWords" || (!voiceOnly && NODES_3I.includes(o.type))) bad.push(`node ${o.type}`);
        const p = (o.props ?? {}) as Record<string, unknown>;
        // A computer's sign-in code field (screens/link.ts) has had maxLength since before KitExtras (the phone's TextInput takes it).
        if (!voiceOnly && o.type === "TextField" && ("keyboard" in p || "autoFocus" in p || ("maxLength" in p && o.id !== "link.code"))) bad.push(`TextField ${String(o.id)} extras`);
        if (!voiceOnly && "startAtEnd" in p) bad.push(`${o.type} startAtEnd`);
        if ((o.on as Record<string, unknown> | undefined)?.onDoubleTap) bad.push(`${o.type} onDoubleTap`);
      }
      if (o.kind === "voiceLive" || o.kind === "voiceStop") bad.push(`action ${String(o.kind)}`);
      if ("doubleTap" in o) bad.push("doubleTap");
      if (!voiceOnly && "stay" in o) bad.push("stay");
      if (!voiceOnly && (o.act === "listen" || o.act === "stand")) bad.push(`act ${String(o.act)}`);
      for (const v of Object.values(o)) visit(v);
    };
    visit(s.root);
    visit(s.actions);
    if (s.talkTo) bad.push("talkTo");
    return bad;
  }
  for (const client of ["phone", "desktop"] as const) {
    it(`sweeps every screen on the ${client}: an old build gets nothing new, a voiceless one no voice`, async () => {
      const api = { ...(await sampleApi()), ...D.spacesApi() };
      for (const [id, params] of PARAMS) {
        const old = await build(id, client, { params, api, can: OLD });
        expect(leaks(old.s, false), `${id} ${JSON.stringify(params)} ${client} OLD`).toEqual([]);
        expect(lintTree(old.s.root!), `${id} ${client} OLD`).toEqual([]);
        const quiet = await build(id, client, { params, api, can: canOf(client, VOICELESS) });
        expect(leaks(quiet.s, true), `${id} ${JSON.stringify(params)} ${client} voiceless`).toEqual([]);
        expect(lintTree(quiet.s.root!), `${id} ${client} voiceless`).toEqual([]);
        const all = await build(id, client, { params, api });
        expect(lintTree(all.s.root!), `${id} ${client} NEW`).toEqual([]);
      }
    });
  }
});

describe("Spaces (bots.spaces)", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`FIRST on the ${client}: his stage (the whole top is his), the crowd, a dotted Create on the left, no list; the waiting invitation open`, async () => {
      const calls: Array<{ method: string; path: string }> = [];
      const { s, nodes } = await build("bots.spaces", client, { api: { [`GET ${A}/spaces?full=1`]: D.FULL_FIRST }, calls });
      expect(lintTree(s.root!)).toEqual([]);
      // The load of a new build reads one thing.
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${A}/spaces?full=1`]);
      const stage = ofType(nodes, "BotStage")[0]!;
      expect(stage.props).toMatchObject({ life: "spaces.me", hit: "stage", toys: false, outWhen: { truthy: "creating" }, thought: { style: "space", openPath: "thOpen", veil: true, place: "low" } });
      // A tap opens his thought, except while Call Your People is open: he is out at the side and stays out.
      expect(stage.on?.onPress).toEqual({ kind: "condition", if: { falsy: "creating" }, then: { kind: "setState", path: "thOpen", value: true } });
      expect(ofType(nodes, "BotCrowd")).toHaveLength(1);
      // A square box: no height (as tall as it is wide); the window's held to a square that fits it.
      expect(ofType(nodes, "BotCrowd")[0]!.props!.height).toBeUndefined();
      if (client === "desktop") expect(nodes.find((n) => n.children?.some((c) => c.type === "BotCrowd"))!.style).toMatchObject({ width: 400, maxWidth: "100%" });
      const row = ofType(nodes, "Vanish")[0]!.children![0]!;
      expect(row.children![0]!.style).toMatchObject({ borderStyle: "dotted", borderWidth: 2 });
      expect(texts(walk(row.children![0]!))).toEqual(["Create"]);
      expect(texts(walk(row.children![1]!))).toEqual(["Your Own Space"]);
      expect(texts(nodes)).not.toContain("Your spaces");
      // An invitation waiting on the first Spaces screen is shown, not hidden behind a tap; he hops for it.
      expect(s.state).toMatchObject({ thOpen: true, news: 1, creating: false, made: false });
      expect(texts(nodes)).toEqual(expect.arrayContaining(["You have an invitation", "Sharma Family", "Aanya invited you · 3 people", "Asked to join with the code 7KQ-29D. The space's admin will let you in.", "The space's admin can see your work and messages there.", "Have a code?"]));
      const acc = callTo(stage, "PUT", `${A}/spaces/invitations/SHARMA22`);
      expect(acc?.body).toEqual({ decision: "accept", consent: true });
      expect(texts(nodes)).not.toContain("Make a new space");
      // Every refusal here says the server's own words.
      for (const c of callsIn(s.root)) expect(said(c.onError), `${String(c.path)}`).toBe(true);
    });
  }

  it("CREATE: two Sent rows, Invite to the draft, Continue to the name, Back deletes the draft; he has walked out", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s, nodes } = await build("bots.spaces", client, { api: { [`GET ${A}/spaces?full=1`]: D.FULL_CREATE } });
      expect(lintTree(s.root!)).toEqual([]);
      expect(s.state).toMatchObject({ creating: true, step: "people" });
      const t = texts(nodes);
      for (const w of ["Call Your People", "Each one gets an email with an invite and a code.", "meera@example.in", "rohan@example.in", "Continue", "Name your space", "Done"]) expect(t, w).toContain(w);
      expect(t.filter((x) => x === "Sent")).toHaveLength(2);
      const crowd = ofType(nodes, "BotCrowd")[0]!;
      expect(crowd.props).toMatchObject({ grownWhen: { truthy: "creating" }, grownHeight: client === "desktop" ? 600 : 560, cheerWhen: { truthy: "made" } });
      expect(callTo(crowd, "DELETE", `${A}/spaces/draft`)).toBeTruthy();
      expect(callTo(crowd, "POST", `${A}/spaces/draft/invite`)?.body).toEqual({ email: "$state.email" });
      const email = nodes.find((n) => n.type === "TextField" && n.id === "email")!;
      expect(email.props).toMatchObject({ keyboard: "email", autoFocus: true });
      // Unnamed: Continue goes to the name; Done makes it and opens the moment it is ready.
      expect(actionsIn(crowd)).toContainEqual({ kind: "setState", path: "step", value: "name" });
      const done = callTo(crowd, "POST", `${A}/spaces/draft/done`)!;
      expect(done.body).toEqual({ name: "$state.spaceName" });
      expect(done.onSuccess).toEqual({ kind: "navigate", screenId: "bots.spaces", params: { made: "$state.madeSpace.id" }, replace: true });
    }
    // A big family: the box grows with every invite (and the Sending row), so Continue is never cut off.
    const many = Array.from({ length: 9 }, (_, i) => ({ code: `INV${i}AAAA`, email: `p${i}@example.in`, at: 0, mail: "sent" as const }));
    const big = await build("bots.spaces", "phone", { api: { [`GET ${A}/spaces?full=1`]: { ...D.FULL_CREATE, draft: { ...D.FULL_CREATE.draft, invites: many } } } });
    expect(ofType(big.nodes, "BotCrowd")[0]!.props!.grownHeight).toBe(286 + 54 * 10);
    // Named first ("Make a new space"): Continue makes it at once, with no field to fill.
    const named = await build("bots.spaces", "phone", { api: { [`GET ${A}/spaces?full=1`]: { ...D.FULL_CREATE, draft: { ...D.FULL_CREATE.draft, name: "College Friends" } } } });
    expect(texts(named.nodes)).toContain("College Friends");
    const cont = callsIn(named.s.root).filter((c) => c.path === `${A}/spaces/draft/done`);
    expect(cont.some((c) => JSON.stringify(c.body) === "{}")).toBe(true);
    const wrapped = actionsIn(named.s.root).filter((a) => a.kind === "condition" && JSON.stringify(a).includes('"body":{}') && JSON.stringify(a.if) === '{"falsy":"spaceName"}');
    expect(wrapped).toEqual([]);
  });

  it("MADE: everyone cheers, he walks back in, \"Home is ready\" and Open", async () => {
    const { s, nodes } = await build("bots.spaces", "phone", { params: { made: "s1" }, api: { [`GET ${A}/spaces?full=1`]: D.FULL_MADE } });
    expect(lintTree(s.root!)).toEqual([]);
    expect(s.state).toMatchObject({ made: true, creating: false });
    expect(texts(nodes)).toEqual(expect.arrayContaining(["Home is ready", "2 people invited. You are its admin.", "Open Home"]));
    // Open: this screen becomes Your spaces and the space opens over it, so Back comes to the list, not to this moment again.
    expect(actionsIn(s.root)).toContainEqual({ kind: "sequence", actions: [
      { kind: "navigate", screenId: "bots.spaces", params: {}, replace: true }, { kind: "navigate", screenId: "bots.spaces", params: { id: "s1" } },
    ] });
    expect(ofType(nodes, "BotStage")[0]!.props!.cheerWhen).toEqual({ any: [{ truthy: "made" }, { gt: ["news", 0] }] });
  });

  for (const client of ["phone", "desktop"] as const) {
    it(`JOINED on the ${client}: the spaces with their last line and what is new; his thought has Make a new space, invitations, requests and the code box`, async () => {
      const { s, nodes } = await build("bots.spaces", client);
      expect(lintTree(s.root!)).toEqual([]);
      expect(s.liveTopics).toEqual(expect.arrayContaining(["spaces", "space:s1", "space:s2"]));
      const t = texts(nodes);
      for (const w of ["Your spaces", "Home", "Mom: Dinner at 8? Bring the dahi", "Studio", "Dev: Shared a Xode project with you", "2", "1"]) expect(t, w).toContain(w);
      expect(ofType(nodes, "BotCrowd")).toHaveLength(0);
      expect(ofType(nodes, "Vanish")).toHaveLength(0);
      const stage = ofType(nodes, "BotStage")[0]!;
      const inThought = texts(walk(stage));
      for (const w of ["Make a new space", "You have an invitation", "Gym Buddies", "Kabir invited you · 4 people", "Requests", "Ishita wants to join Home", "The space's admin can see your work and messages there.", "Have a code?"]) expect(inThought, w).toContain(w);
      expect(callTo(stage, "POST", `${A}/spaces/draft`)?.body).toEqual({ name: "$state.newName" });
      expect(callTo(stage, "PUT", `${A}/spaces/invitations/GYM4BUDD`)).toBeTruthy();
      const decisions = callsIn(stage).filter((c) => c.path === `${A}/spaces/invitations/GYM4BUDD`).map((c) => (c.body as { decision: string }).decision);
      expect(decisions.sort()).toEqual(["accept", "dismiss"]);
      const reqs = callsIn(stage).filter((c) => c.path === `${A}/spaces/s1/requests/rq-ishita`).map((c) => (c.body as { decision: string }).decision);
      expect(reqs.sort()).toEqual(["accept", "dismiss"]);
      const join = callTo(stage, "POST", `${A}/spaces/join`)!;
      expect(join.body).toEqual({ code: "$state.code", consent: true });
      expect(join.onSuccess).toMatchObject({ kind: "condition", if: { eq: ["joined.status", "requested"] } });
      expect(s.state).toMatchObject({ thOpen: false, news: 2 });
      for (const c of callsIn(s.root)) expect(said(c.onError), `${String(c.path)}`).toBe(true);
    });
  }

  it("opens his thought for a request's push (thought=1) and for an invite's link (the code in, its field focused)", async () => {
    expect((await build("bots.spaces", "phone", { params: { thought: "1" } })).s.state).toMatchObject({ thOpen: true });
    const link = await build("bots.spaces", "phone", { params: { join: "7kq-29d" } });
    expect(link.s.state).toMatchObject({ thOpen: true, code: "7KQ29D" });
    expect(link.nodes.find((n) => n.type === "TextField" && n.id === "code")!.props).toMatchObject({ keyboard: "code", autoFocus: true });
  });

  it("an honest page when Spaces can't be read", async () => {
    const { s, nodes } = await build("bots.spaces", "phone", { api: {} });
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts(nodes)).toContain("Couldn't load your spaces");
  });
});

describe("inside a space (bots.spaces?id=)", () => {
  const STAGE_MIN = (size: number) => size + 18 + 82 + 48;
  for (const client of ["phone", "desktop"] as const) {
    it(`the ${client}: no people at the top, one feed, "To Mom" to the sender and the admin, a share card opening its bot, his stage at the foot`, async () => {
      const { s, nodes } = await build("bots.spaces", client, { params: { id: "s1" } });
      expect(lintTree(s.root!)).toEqual([]);
      expect(s.liveTopics).toEqual(expect.arrayContaining(["space:s1", "thread:th-home"]));
      expect(s.state).toMatchObject({ thOpen: false, voice: "", heard: "", said: null, draft: { text: "", toId: "", thingId: "" } });
      const t = texts(nodes);
      for (const w of ["Home", "Dinner at 8? Bring the dahi", "Can someone drop me at practice tomorrow?", "Your check-up is Friday 7:40, I'll drive you", "To Mom", "To Rohan", "Doctor, knee check-up", "Open in Plan Ease", "Older messages", "This week's groceries · Fresh Basket"]) expect(t, w).toContain(w);
      // The header: back, the name and one neutral door; no faces.
      const door = nodes.find((n) => n.props?.accessibilityLabel === "About Home")!;
      expect(door.on?.onPress).toEqual({ kind: "navigate", screenId: "bots.space.people", params: { id: "s1" } });
      expect(texts(nodes).filter((x) => x === "A" || x === "M" || x === "R").length).toBeLessThan(4);
      // A shared thing opens in its bot, as that person's thing.
      expect(actionsIn(s.root)).toContainEqual({ kind: "navigate", screenId: "bots.work", params: { bot: "plan", space: "s1", owner: "u", item: "e:doctor@2026-11-14" } });
      // His stage: tall enough for him, the trail and the pill; the box he writes in.
      const stage = ofType(nodes, "BotStage")[0]!;
      const p = stage.props as { size: number; height: number; thought: Record<string, unknown> };
      expect(p.height).toBeGreaterThanOrEqual(STAGE_MIN(p.size));
      expect(p.thought).toMatchObject({ style: "space", restText: "Write to everyone, or @ someone", shape: "wide", veil: false, place: "follow" });
      const field = ofType(nodes, "MentionField")[0]!;
      expect(field.props).toMatchObject({ draftPath: "draft", thingsPath: `${A}/work/:bot/mine`, people: [{ id: "m", name: "Mom" }, { id: "r", name: "Rohan" }] });
      expect((field.props!.bots as Array<{ name: string }>).map((b) => b.name)).toEqual(["Plan Ease", "Notes", "Travel bot", "Xode"]);
      expect((field.props!.tools as Array<{ label: string }>).map((x) => x.label)).toEqual(["Ask for money", "Give a task or plan", "Group memory"]);
      // Send keeps the screen as it is (the window would wipe "said" with a fetch) and asks first on a name with no one picked.
      const send = callTo(field.on!.onSubmit, "POST", `${A}/spaces/s1/feed`)!;
      expect(send).toMatchObject({ assignTo: "said", stay: true, body: { text: "$state.draft.text", to: "$state.draft.toId", thing: { bot: "$state.draft.bot", id: "$state.draft.thingId" } } });
      expect(send.onSuccess).toMatchObject({ kind: "condition", if: { truthy: "said.confirm" }, then: { kind: "setState", path: "thOpen", value: true } });
      // Voice: a double tap is a chat; its words go as a message, and a name said first opens the box on the question.
      const chat = stage.on!.onDoubleTap as Record<string, unknown>;
      expect(chat).toMatchObject({ kind: "voiceLive", mode: "chat", statePath: "voice", into: "heard", silenceMs: 900, stopWhen: { truthy: "said.confirm" } });
      expect(chat.onHeard).toMatchObject({ body: { text: "$state.heard", voice: true }, assignTo: "said", stay: true, onSuccess: { kind: "condition", if: { truthy: "said.confirm" }, then: { kind: "setState", path: "thOpen", value: true } } });
      expect(ofType(walk(stage), "LiveWords")).toHaveLength(1);
      expect(texts(walk(stage))).toEqual(expect.arrayContaining(["Just them", "Everyone", "Cancel"]));
      // Everyone says so: the server doesn't ask about the name again. The box listens for the whole voice chat (sending too).
      expect(callsIn(stage).find((c) => (c.body as { everyone?: boolean } | undefined)?.everyone === true)?.body).toEqual({ text: "$state.said.confirm.whole", everyone: true });
      expect(stage.props).toMatchObject({ listenWhen: { truthy: "voice" }, thinkWhen: { eq: ["voice", "sending"] } });
      // Stop sharing, under a card the person shared (or any card, for the admin).
      expect(callsIn(s.root).some((c) => c.method === "DELETE" && /\/spaces\/s1\/grants\//.test(String(c.path)))).toBe(true);
      // The window's one key talks to him; the phone has no key.
      if (client === "desktop") expect(s.talkTo).toMatchObject({ voice: { kind: "voiceLive", mode: "once" } });
      else expect(s.talkTo).toBeUndefined();
    });
  }

  it("Stop sharing is only under a card for its sharer and the admin", async () => {
    const card = D.FEED.messages.find((m) => m.thing)!;
    const theirs = { ...D.FEED, space: { ...D.FEED.space, admin: false }, messages: [{ ...card, from: { userId: "m", name: "Mom", you: false }, to: null }] };
    const { nodes } = await build("bots.spaces", "phone", { params: { id: "s1" }, api: { [`GET ${A}/spaces/s1/feed`]: theirs } });
    expect(texts(nodes)).toContain("Open in Plan Ease");
    expect(texts(nodes)).not.toContain("Stop sharing");
    const admin = await build("bots.spaces", "phone", { params: { id: "s1" }, api: { [`GET ${A}/spaces/s1/feed`]: { ...theirs, space: D.FEED.space } } });
    expect(texts(admin.nodes)).toContain("Stop sharing");
  });

  it("the recipient sees a plain message; their own to one person says who", async () => {
    const { nodes } = await build("bots.spaces", "phone", { params: { id: "s1" }, api: { [`GET ${A}/spaces/s1/feed`]: D.FEED_ROHAN } });
    const t = texts(nodes);
    expect(t).toContain("Practice is at 5. Take your water bottle.");
    expect(t).not.toContain("To Rohan");
    expect(t).toContain("To Mom");
  });

  it("a member who hasn't tapped OK on the admin line gets that card, no box and no key", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const feed = { ...D.FEED_ROHAN, space: { ...D.FEED_ROHAN.space, consented: false } };
      const { s, nodes } = await build("bots.spaces", client, { params: { id: "s1" }, api: { [`GET ${A}/spaces/s1/feed`]: feed } });
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(nodes)).toContain("The space's admin can see your work and messages here.");
      expect(ofType(nodes, "MentionField")).toHaveLength(0);
      expect(ofType(nodes, "BotStage")).toHaveLength(0);
      expect(s.talkTo).toBeUndefined();
      expect(callTo(s.root, "PUT", `${A}/spaces/s1/consent`)).toBeTruthy();
    }
  });

  it("without live words: the same space, no double tap, no voice line, no LiveWords, no key", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s, nodes } = await build("bots.spaces", client, { params: { id: "s1" }, can: canOf(client, VOICELESS) });
      const stage = ofType(nodes, "BotStage")[0]!;
      expect(stage.on?.onDoubleTap).toBeUndefined();
      expect(stage.on?.onPress).toEqual({ kind: "setState", path: "thOpen", value: true });
      expect(stage.props!.label).toBe("Your bot. Tap the box to write.");
      expect(stage.props!.listenWhen).toBeUndefined();
      expect(ofType(nodes, "LiveWords")).toHaveLength(0);
      expect(s.talkTo).toBeUndefined();
    }
  });

  it("an honest page when the space can't be read", async () => {
    const { s, nodes } = await build("bots.spaces", "phone", { params: { id: "s1" }, api: {} });
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts(nodes)).toContain("Couldn't open this space");
  });
});

describe("a space's people (bots.space.people)", () => {
  it("the admin sees the code, Make a new code, Call your people and rename; a member sees none of it", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const admin = await build("bots.space.people", client, { params: { id: "s1" } });
      expect(lintTree(admin.s.root!)).toEqual([]);
      const t = texts(admin.nodes);
      for (const w of ["Home", "People · 3", "Aanya (you)", "Admin", "Mom", "Rohan", "Call your people", "The space's code", "7KQ-29D", "Make a new code", "Group memory", "Delete Home"]) expect(t, w).toContain(w);
      expect(callTo(admin.s.root, "POST", `${A}/spaces/s1/code`)).toBeTruthy();
      expect(callTo(admin.s.root, "PUT", `${A}/spaces/s1`)).toBeTruthy();
      const member = await build("bots.space.people", client, { params: { id: "s2" } });
      const m = texts(member.nodes);
      expect(m).not.toContain("Make a new code");
      expect(m).not.toContain("The space's code");
      expect(m).toContain("Leave Studio");
      expect(callTo(member.s.root, "POST", `${A}/spaces/s2/code`)).toBeUndefined();
    }
  });
});

describe("Work in space", () => {
  it("a bot page gets the two tabs for anyone in a space, with a line where nobody has shared yet", async () => {
    const api = { ...(await sampleApi()), ...D.spacesApi() };
    for (const client of ["phone", "desktop"] as const) {
      const { s, nodes } = await build("bots.plan", client, { api });
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(nodes);
      for (const w of ["Your work", "Work in space", "Home", "You see these as admin.", "Mom", "All their plans", "Notes from your space", "Mom: I'll come with you", "Only you change these."]) expect(t, w).toContain(w);
      expect(s.state).toMatchObject({ workTab: "mine" });
      expect(actionsIn(s.root)).toContainEqual({ kind: "navigate", screenId: "bots.work", params: { bot: "plan", space: "s1", owner: "m" } });
      // In no space: the page as it was.
      const none = await build("bots.plan", client, { api: { ...api, [`GET ${A}/work/plan`]: { ...D.WORK_PLAN, spaces: [] } } });
      expect(texts(none.nodes)).not.toContain("Work in space");
      // In a space where nobody has shared anything yet: both tabs, a line, and who can see their things.
      const empty = { ...D.WORK_PLAN, spaces: [{ spaceId: "s2", spaceName: "Studio", admin: false, people: [] }], seenBy: ["Dev"] };
      const quiet = await build("bots.plan", client, { api: { ...api, [`GET ${A}/work/plan`]: empty } });
      expect(lintTree(quiet.s.root!)).toEqual([]);
      for (const w of ["Your work", "Work in space", "Studio", "Nothing here yet. When someone in Studio shares a plan with you, it shows here.", "Dev, the space's admin, can see these too."]) expect(texts(quiet.nodes), w).toContain(w);
      // An older build never asks.
      const calls: Array<{ method: string; path: string }> = [];
      await build("bots.plan", client, { api, can: OLD, calls });
      expect(calls.some((c) => c.path.startsWith(`${A}/work`))).toBe(false);
    }
    expect((await build("bots.plan", "phone", { api, params: { tab: "space" } })).s.state).toMatchObject({ workTab: "space" });
  });

  it("every shareable bot's page asks for its own Work in space", async () => {
    for (const [id, bot] of [["bots.plan", "plan"], ["bots.travel", "travel"], ["bots.notes", "notes"], ["bots.code", "code"]] as const) {
      const calls: Array<{ method: string; path: string }> = [];
      await build(id, "phone", { api: await sampleApi(), calls });
      expect(calls.map((c) => c.path), id).toContain(`${A}/work/${bot}`);
    }
  });

  it("one person's things, and one thing: Change time only when it may be changed", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const person = await build("bots.work", client, { params: { bot: "plan", space: "s1", owner: "m" } });
      expect(lintTree(person.s.root!)).toEqual([]);
      expect(texts(person.nodes)).toEqual(expect.arrayContaining(["Mom", "Home · You see these as admin.", "Doctor, knee check-up", "You see Mom's plans as admin. Mom sees what you change."]));
      const item = await build("bots.work", client, { params: { bot: "plan", space: "s1", owner: "m", item: "e:doctor@2026-11-14" } });
      expect(lintTree(item.s.root!)).toEqual([]);
      const t = texts(item.nodes);
      for (const w of ["Doctor, knee check-up", "Mom's plan · Plan Ease · Home", "Time", "Fri 14 Nov · 7:40 pm", "Change time", "Place", "Dr. Rao's clinic, Indiranagar", "I'll drive you there."]) expect(t, w).toContain(w);
      expect(item.s.state).toMatchObject({ changing: false, day: "2026-11-14", time: "19:40", note: "" });
      const move = callsIn(item.s.root).find((c) => (c.body as { op?: string }).op === "time")!;
      expect(move).toMatchObject({ method: "POST", path: `${A}/work/plan/item`, body: { space: "s1", owner: "m", item: "e:doctor@2026-11-14", day: "$state.day", time: "$state.time", tz: IST } });
      expect(callsIn(item.s.root).some((c) => (c.body as { op?: string }).op === "note")).toBe(true);
      // An old per-bot share: look and add a note, never change.
      const view = { ...D.WORK_ITEM, how: "view", detail: { when: D.WORK_ITEM.detail.when }, can: { time: false, note: true } };
      const v = await build("bots.work", client, { params: { bot: "plan", space: "s1", owner: "m", item: "e:doctor@2026-11-14" }, api: { [`GET ${A}/work/plan/item?space=s1&owner=m&item=${encodeURIComponent("e:doctor@2026-11-14")}&tz=${IST}`]: { item: view } } });
      expect(texts(v.nodes)).not.toContain("Change time");
      expect(texts(v.nodes)).toContain("Mom shares this with the space. You can add a note.");
      expect(callsIn(v.s.root).some((c) => (c.body as { op?: string }).op === "time")).toBe(false);
    }
  });
});

describe("Home's Ask, as his thought", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`the ${client}: his stage at the foot, no ask bar; bot tiles alone take a double tap`, async () => {
      const can = [...canOf(client), "BotsMotion"];
      const { s, nodes } = await build("bots.home", client, { can, api: {} });
      expect(lintTree(s.root!)).toEqual([]);
      const stage = ofType(nodes, "BotStage")[0]!;
      expect(stage.props).toMatchObject({ life: "home.ask", thought: { style: "home", restText: "Ask any bot...", openPath: "askOpen", fullWhen: { truthy: "sent" }, shape: "square", veil: true } });
      expect((stage.props as { height: number }).height).toBeGreaterThanOrEqual((stage.props as { size: number }).size + 18 + 82 + 48);
      expect(s.state).toMatchObject({ askOpen: false, askBot: "any", voice: "" });
      // No ask bar: every field asking any bot is his thought's.
      const inStage = new Set(walk(stage));
      for (const f of nodes.filter((n) => n.type === "TextField" && (n.id === "ask" || n.id === "askMore"))) expect(inStage.has(f)).toBe(true);
      // The answer comes in inside him: no navigate when it is back, the bot asked is "$state.askBot".
      const ask = callTo(stage, "POST", "/v1/shell/ask")!;
      expect(ask).toMatchObject({ stay: true, onSuccess: { kind: "setState", path: "asking", value: false }, body: { bot: "$state.askBot" } });
      // " answered" only under the bot's name, once the answer has come back with it.
      const answered = nodes.filter((n) => n.children?.some((c) => c.props?.content === " answered"));
      expect(answered.length).toBeGreaterThan(0);
      for (const a of answered) expect(a.visibleIf).toEqual({ truthy: "asked.shell.bot.name" });
      const tiles = ofType(nodes, "BotTiles")[0]!.props!.tiles as Array<{ slug: string; doubleTap?: unknown }>;
      for (const t of tiles) {
        if (t.slug === "make" || t.slug.startsWith("space-")) expect(t.doubleTap, t.slug).toBeUndefined();
        else expect(t.doubleTap, t.slug).toMatchObject({ kind: "sequence", actions: [{ kind: "setState", path: "askBot", value: t.slug }, { kind: "voiceLive", mode: "chat" }] });
      }
      if (client === "desktop") expect(s.talkTo).toMatchObject({ voice: { kind: "voiceLive", mode: "once", into: "ask" } });
      else expect(s.talkTo).toBeUndefined();
    });
  }

  it("an older build keeps today's ask bar", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { nodes } = await build("bots.home", client, { can: ["BotsKit", "BotsMotion"], api: {} });
      expect(ofType(nodes, "BotStage")).toHaveLength(0);
      expect(nodes.find((n) => n.type === "TextField" && n.id === "ask")!.bind).toEqual({ value: "ask" });
    }
  });
});
