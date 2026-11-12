/**
 * THE MEETING BOT'S SCREENS (screens/bots/meetPage.ts, meetScreens.ts): its page (join a meeting by its link, what is in a call now, what is
 * coming up, the recent ones, its settings, the minutes used) and one meeting's own screen (leave, answer out loud, the notes so far, call it
 * off on a second yes, the questions it answered, the notes). Every tree is drawn by the shipped app (the linter), on the phone and the window.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const PURPOSE = "Joins your video calls, takes the notes and answers questions.";
const BOT = {
  slug: "meet", name: "Meetings", colour: "moss", builtin: true, publicCard: false, tone: "", principles: [], purpose: PURPOSE,
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const SETTINGS = { autoJoin: false, voice: true, botName: "" };
const MIN = 60_000;
const meeting = (id: string, o: Record<string, unknown> = {}) => ({
  id, title: "Design review", platform: "google_meet", url: "https://meet.google.com/abc-defg-hij", status: "scheduled", voice: true, source: "link",
  joinAt: FIXED_NOW + 3_600_000, startedAt: null, endedAt: null, noteId: null, participants: [], error: null, liveNotes: null, ...o,
});
const OVERVIEW = (o: Record<string, unknown> = {}) => ({
  settings: SETTINGS, botName: "X0 Bot", live: [], upcoming: [], recent: [], minutesToday: 0, minutesCap: 120, calendar: true, ...o,
});

type Client = "phone" | "desktop";
async function build(o: { screen?: string; params?: Record<string, string>; client?: Client; overview?: unknown; detail?: unknown; down?: boolean } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "meet", name: "Meetings", colour: "moss", purpose: PURPOSE, builtin: true }], calls,
    api: {
      "GET /v1/bots/meet": { bot: BOT }, "GET /v1/bots/meet/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/meet/connectors": { connectors: [] },
      "GET /v1/botsapp/bots/chat/meet?limit=1": { turns: [] },
      ...(o.down ? {} : { "GET /v1/meet/overview": o.overview ?? OVERVIEW() }),
      ...(o.detail ? { "GET /v1/meet/meetings/m1": o.detail } : {}),
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: o.client ?? "phone", params: o.screen ? (o.params ?? {}) : { slug: "meet", ...(o.params ?? {}) }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, can: new Set(DRAWS), desk: { pages: false, notes: false },
  }, deps);
  const root = s.root as Node;
  const nodes = walk(root);
  const flat = (a: unknown): ActionSpec[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as ActionSpec & { actions?: unknown[]; then?: unknown; else?: unknown; onSuccess?: unknown; onError?: unknown };
    return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else), ...flat(x.onSuccess), ...flat(x.onError)];
  };
  return {
    s, calls, nodes, root, lint: lintTree(root),
    state: (s as unknown as { state?: Record<string, unknown> }).state ?? {},
    live: (s as unknown as { liveTopics?: string[] }).liveTopics ?? [],
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    fields: nodes.filter((n) => n.type === "TextField").map((n) => (n.bind as { value: string }).value),
    every: () => nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat),
  };
}
type Call = Extract<ActionSpec, { kind: "callEndpoint" }>;
const callsOf = (acts: ActionSpec[]) => acts.filter((a) => a.kind === "callEndpoint") as Call[];
const navs = (acts: ActionSpec[], screenId: string) => acts.filter((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === screenId) as Array<{ params?: Record<string, string>; replace?: boolean }>;

const MEETING_PAGE = { screen: "bots.meet.meeting", params: { m: "m1" } };

describe.each<Client>(["phone", "desktop"])("the meeting bot's page on the %s", (client) => {
  it("with no meeting says what it does, and joins by a link", async () => {
    const p = await build({ client });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Paste a meeting link and your bot joins the call. It takes the notes, answers questions in the chat and out loud, and turns what was agreed into your to-dos.");
    expect(p.texts).toContain("Everyone in the call sees it join, and it says so in the chat.");
    expect(p.texts).toContain("Joins your calls, takes the notes, answers questions");
    expect(p.fields).toEqual(expect.arrayContaining(["mt_url", "ms_name"]));
    expect(p.live).toContain("bot:meet");
    expect(p.state).toMatchObject({ mt_url: "", mt_voice: true, ms_auto: false, ms_voice: true });
    const join = callsOf(p.every()).find((c) => c.path === "/v1/meet/join")!;
    expect(join).toMatchObject({ method: "POST", body: { url: "$state.mt_url", voice: "$state.mt_voice" } });
    expect(JSON.stringify(join.onSuccess)).toContain("Joining. Let it in if your call asks.");
    expect(JSON.stringify(join.onSuccess)).toContain('"mt_url"');
    // An empty field is a toast, not a call.
    const guard = p.every().find((a) => a.kind === "condition" && JSON.stringify(a).includes("/v1/meet/join")) as { if: unknown; else: { message: string } };
    expect(guard.if).toEqual({ truthy: "mt_url" });
    expect(guard.else.message).toMatch(/link/);
    expect(p.texts).toContain("0 of 120 minutes used today");
  });

  it("shows what is in a call now, what is coming up and the recent ones, each opening where it belongs", async () => {
    const p = await build({ client, overview: OVERVIEW({
      live: [
        meeting("l1", { status: "in_call", title: "Sprint planning", participants: ["Asha", "Ravi", "Meera"] }),
        meeting("l2", { status: "waiting", title: "" }),
        meeting("l3", { status: "joining", title: "Standup" }),
      ],
      upcoming: [meeting("u1", { title: "Board call", joinAt: FIXED_NOW + 26 * 3_600_000 })],
      recent: [
        meeting("r1", { status: "done", title: "Customer sync", noteId: "n7", startedAt: FIXED_NOW - 3 * 3_600_000, endedAt: FIXED_NOW - 3 * 3_600_000 + 42 * MIN }),
        meeting("r2", { status: "failed", title: "Vendor call", error: "the host never let it in", startedAt: null, joinAt: FIXED_NOW - 5 * 3_600_000 }),
        meeting("r3", { status: "ended", title: "Retro", startedAt: FIXED_NOW - 8 * 3_600_000, endedAt: FIXED_NOW - 8 * 3_600_000 + 65 * MIN }),
      ],
      minutesToday: 47, calendar: true,
    }) });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining([
      "In a call now", "Coming up", "Recent", "In a call: Sprint planning",
      "Sprint planning", "In the call · 3 people", "Meeting", "Waiting to be let in", "Joining…",
      "Board call", "Customer sync", "Vendor call", "Retro", "47 of 120 minutes used today",
    ]));
    // Sub lines: when, how long and the state.
    expect(p.texts.some((t) => /42 min · Notes ready$/.test(t))).toBe(true);
    expect(p.texts.some((t) => /Couldn't join: the host never let it in$/.test(t))).toBe(true);
    expect(p.texts.some((t) => /1 h 5 min/.test(t))).toBe(true);
    expect(p.texts.some((t) => /^Tomorrow, /.test(t))).toBe(true);
    const opens = navs(p.every(), "bots.meet.meeting").map((n) => n.params);
    expect(opens).toEqual(expect.arrayContaining([{ m: "l1" }, { m: "l2" }, { m: "l3" }, { m: "u1" }, { m: "r2" }, { m: "r3" }]));
    expect(navs(p.every(), "bots.note").map((n) => n.params)).toEqual([{ id: "n7" }]);
    expect(opens).not.toContainEqual({ m: "r1" });
    // Something to show: no explanation card.
    expect(p.texts).not.toContain("Everyone in the call sees it join, and it says so in the chat.");
  });

  it("saves its settings as they change", async () => {
    const p = await build({ client, overview: OVERVIEW({ settings: { autoJoin: true, voice: false, botName: "Scribe" } }) });
    expect(p.lint).toEqual([]);
    expect(p.state).toMatchObject({ ms_auto: true, ms_voice: false, ms_name: "Scribe", mt_voice: false });
    expect(p.texts).toEqual(expect.arrayContaining(["Join my calendar's meetings", "Answer out loud by default", "Name in calls", "Save"]));
    const puts = callsOf(p.every()).filter((c) => c.path === "/v1/meet/settings");
    expect(puts.map((c) => [c.method, c.body])).toEqual(expect.arrayContaining([
      ["PUT", { autoJoin: "$state.ms_auto" }], ["PUT", { voice: "$state.ms_voice" }], ["PUT", { botName: "$state.ms_name" }],
    ]));
    // Connected: no line about the calendar.
    expect(p.texts).not.toContain("Connect Google Calendar in You › Connected apps first.");
  });

  it("says to connect the calendar first when it can't be read", async () => {
    const p = await build({ client, overview: OVERVIEW({ calendar: false }) });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Connect Google Calendar in You › Connected apps first.");
  });

  it("says so when the meetings can't be read", async () => {
    const p = await build({ client, down: true });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("The meetings couldn't be read just now. Pull to try again.");
    expect(p.fields).not.toContain("mt_url");
  });

  it("never starts a text with @, whatever the call was titled", async () => {
    const p = await build({ client, overview: OVERVIEW({ upcoming: [meeting("u1", { title: "@everyone sync" })] }) });
    expect(p.texts.filter((t) => t.startsWith("@"))).toEqual([]);
    expect(p.texts).toContain("everyone sync");
  });
});

describe.each<Client>(["phone", "desktop"])("one meeting on the %s", (client) => {
  it("in the call: Leave the call, Answer out loud and the notes so far", async () => {
    const p = await build({ ...MEETING_PAGE, client, detail: {
      meeting: meeting("m1", {
        status: "in_call", participants: ["Asha", "Ravi"], voice: false, noteId: "n9", startedAt: FIXED_NOW - 10 * MIN, joinAt: null,
        liveNotes: { points: ["Launch moves to March"], actions: [{ who: "Ravi", what: "send the plan" }], at: FIXED_NOW },
      }),
      asks: [
        { askedBy: "Asha", question: "When is the launch?", answer: "In March, as you agreed.", how: "voice", at: FIXED_NOW },
        { askedBy: "@Ravi", question: "Who sends the plan?", answer: "You do.", how: "chat", at: FIXED_NOW },
      ],
    } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining([
      "Design review", "In the call · 2 people", "Google Meet", "Asha", "Ravi", "Answer out loud", "Leave the call", "Notes so far",
      "Launch moves to March", "Ravi: send the plan", "Open the notes", "Questions it answered",
      "When is the launch?", "In March, as you agreed.", "out loud", "in the chat",
    ]));
    expect(p.texts.filter((t) => t.startsWith("@"))).toEqual([]);
    expect(p.state).toMatchObject({ mm_voice: false, mm_sure: false });
    expect(p.live).toEqual(expect.arrayContaining(["bot:meet", "note:n9"]));
    const calls = callsOf(p.every());
    expect(calls.find((c) => c.path === "/v1/meet/meetings/m1/leave")).toMatchObject({ method: "POST" });
    expect(calls.find((c) => c.path === "/v1/meet/meetings/m1" && c.method === "PUT")).toMatchObject({ body: { voice: "$state.mm_voice" } });
    expect(navs(p.every(), "bots.note").map((n) => n.params)).toEqual([{ id: "n9" }]);
    expect(p.texts).not.toContain("Call it off");
  });

  it("in the call before any notes: a quiet line", async () => {
    const p = await build({ ...MEETING_PAGE, client, detail: { meeting: meeting("m1", { status: "waiting", joinAt: null }), asks: [] } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Waiting to be let in", "Notes appear a few minutes in."]));
    expect(p.texts).not.toContain("Questions it answered");
  });

  it("scheduled: Call it off asks again before it deletes, then goes back to the page", async () => {
    const p = await build({ ...MEETING_PAGE, client, detail: { meeting: meeting("m1"), asks: [] } });
    expect(p.lint).toEqual([]);
    expect(p.texts.some((t) => /^Scheduled for Today, /.test(t))).toBe(true);
    expect(p.texts).toEqual(expect.arrayContaining(["Call it off", "Keep it"]));
    // The first tap only asks; the delete is behind the second yes.
    const asks = p.nodes.filter((n) => n.visibleIf && JSON.stringify(n.visibleIf) === '{"falsy":"mm_sure"}');
    expect(asks).toHaveLength(1);
    expect(walk(asks[0]!).some((n) => n.type === "Text" && n.props?.content === "Call it off")).toBe(true);
    expect(JSON.stringify(asks[0]!.on)).toContain('"mm_sure"');
    expect(JSON.stringify(asks[0]!)).not.toContain("DELETE");
    const del = callsOf(p.every()).find((c) => c.method === "DELETE")!;
    expect(del.path).toBe("/v1/meet/meetings/m1");
    expect(JSON.stringify(del.onSuccess)).toContain("Called off.");
    expect(JSON.stringify(del.onSuccess)).toContain('{"kind":"navigate","screenId":"bots.bot","params":{"slug":"meet"},"replace":true}');
    expect(p.every().some((a) => a.kind === "setState" && (a as { path: string }).path === "mm_sure")).toBe(true);
    expect(p.texts).not.toContain("Leave the call");
  });

  it("failed: a notice with why", async () => {
    const p = await build({ ...MEETING_PAGE, client, detail: { meeting: meeting("m1", { status: "failed", error: "the link has expired", joinAt: null }), asks: [] } });
    expect(p.lint).toEqual([]);
    expect(p.texts.filter((t) => t === "Couldn't join: the link has expired").length).toBeGreaterThanOrEqual(1);
    expect(p.texts).not.toContain("Call it off");
  });

  it("done with notes: Open the notes", async () => {
    const p = await build({ ...MEETING_PAGE, client, detail: { meeting: meeting("m1", { status: "done", noteId: "n3", joinAt: null, startedAt: FIXED_NOW - 40 * MIN, endedAt: FIXED_NOW }), asks: [] } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Notes ready", "Open the notes"]));
    expect(navs(p.every(), "bots.note").map((n) => n.params)).toEqual([{ id: "n3" }]);
  });

  it("gone: says so, with a way back", async () => {
    const p = await build({ ...MEETING_PAGE, client });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("This meeting isn't here any more.");
    expect(navs(p.every(), "bots.bot").find((n) => n.params?.slug === "meet")).toMatchObject({ replace: true });
  });
});
