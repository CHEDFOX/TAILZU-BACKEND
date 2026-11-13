/**
 * A BOT'S ANSWER, DRAWN (bots/run.ts step 7, botsBots/chat.ts, routes/bots/botsBots.ts, experience/bots/show.ts and screens/bots/parts.ts):
 *
 *   - after the words, the drawing is asked for where the answer is drawn (the app's chat; never an API caller, never over a yes, never a "Done."),
 *     and kept on the answer
 *   - its call comes off the request's money; BOT_SHOW=false turns it off
 *   - a link may come from a tool's result, never from the bot's own words
 *   - the chat keeps it with the bot's turn, and the person can answer it: a tap sends words; picks and a form come back as words
 *   - the chat draws it with the kit's own parts on the phone and in the window: live on the last turn, still (with the pick) on an older one
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id && !id.startsWith("tzb_") ? { id, email: "aanya.sharma@example.in" } : null;
    },
  };
});

const { ALICE, rig, def, toolCall } = await import("./bots-rig.js");
const { fakeReader } = await import("./bots-bots-data.js");
const { registerBotRoutes } = await import("../src/routes/bots/bots.js");
const { registerBotsBotsRoutes, AREA } = await import("../src/routes/bots/botsBots.js");
const { botsAreaParts, resetAreaTablesForTests } = await import("../src/botsBots/index.js");
const { MemoryEventStore } = await import("../src/shell/events.js");
const { resetConfigForTests } = await import("../src/config.js");
const { chatTurns } = await import("../src/experience/bots/screens/bots/parts.js");
type Turn = import("../src/experience/bots/screens/bots/parts.js").Turn;
const { showNodes, MOTION } = await import("../src/experience/bots/show.js");
const { PALETTE_HEX } = await import("../src/experience/bots/palette.js");
const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { checkShown } = await import("../src/show/check.js");

type Sent = Parameters<Parameters<typeof rig>[0]>[0];
const QUESTION = "Three trips:\n- Lonavala: 1.5 hours\n- Alibaug: 3 hours\nWhich one should I plan?";
const DRAWN = { blocks: [{ type: "choice", question: "Which one?", options: ["Lonavala", "Alibaug"] }], lists: "drawn" };
/** The bot answers `words`; the drawing step answers `drawn`. */
const model = (words: string | ((s: Sent, n: number) => unknown), drawn: unknown = DRAWN) => (s: Sent, n: number) =>
  (s.purpose === "bot.show" ? { json: drawn } : typeof words === "string" ? words : words(s, n)) as never;

const made = async (r: Awaited<ReturnType<typeof rig>>, over: Record<string, unknown> = {}) => (await r.bots.create(ALICE, def({ slug: "buddy", ...over }))).bot;

describe("in the run", () => {
  afterEach(() => { delete process.env.BOT_SHOW; resetConfigForTests(); });

  it("draws after the words and keeps it on the answer, its cost on the request", async () => {
    const r = await rig(model(QUESTION));
    await made(r);
    const a = await r.bots.ask(ALICE, "buddy", { message: "plan a weekend near pune", draw: true });
    expect(a.text).toBe(QUESTION);
    expect(a.show).toEqual({ blocks: [{ type: "choice", key: "k0", question: "Which one?", options: [{ label: "Lonavala" }, { label: "Alibaug" }], multi: false, send: "Send" }], lists: "drawn" });
    expect(r.model.of("bot.show")).toHaveLength(1);
    expect(a.paise).toBe(8);
  });

  it("does not ask for a short done, nor for an API caller", async () => {
    const r = await rig(model("Done, it's on your calendar."));
    await made(r);
    expect((await r.bots.ask(ALICE, "buddy", { message: "add gym at 6", draw: true })).show).toBeUndefined();
    const api = await rig(model(QUESTION));
    const bot = await made(api);
    const { key } = await api.bots.createKey(ALICE, bot.slug, "site");
    await api.bots.askWithKey(`Bearer ${key}`, bot.slug, { message: "plan a weekend" });
    expect(api.model.of("bot.run")).toHaveLength(1);
    expect(api.model.of("bot.show")).toHaveLength(0);
  });

  it("is asked only where the answer is drawn: a routine, the front door or a call that does not ask gets none", async () => {
    const r = await rig(model(QUESTION));
    await made(r);
    expect((await r.bots.ask(ALICE, "buddy", { message: "plan a weekend", fresh: true })).show).toBeUndefined();
    expect(r.model.of("bot.show")).toHaveLength(0);
  });

  it("is off with BOT_SHOW=false", async () => {
    process.env.BOT_SHOW = "false";
    resetConfigForTests();
    const r = await rig(model(QUESTION));
    await made(r);
    expect((await r.bots.ask(ALICE, "buddy", { message: "plan a weekend", draw: true })).show).toBeUndefined();
    expect(r.model.of("bot.show")).toHaveLength(0);
  });

  it("does not draw over a change waiting for the owner's yes", async () => {
    const r = await rig(model((_s, n) => (n === 0 ? { toolCalls: [toolCall("fake-cal__create_event", { title: "Gym", start: "2026-10-28T06:00:00Z" })] } : "It's waiting for your yes. Anything else?")));
    await made(r, { skills: { connectors: ["fake-cal"] } });
    const a = await r.bots.ask(ALICE, "buddy", { message: "add gym tomorrow at 6", draw: true });
    expect(a.approvals).toHaveLength(1);
    expect(a.show).toBeUndefined();
    expect(r.model.of("bot.show")).toHaveLength(0);
  });

  it("links what a tool read, never what the bot wrote", async () => {
    const drawn = { blocks: [{ type: "link", label: "Ferry", url: "https://ferry.example/times" }, { type: "image", url: "https://evil.example/p?d=x", alt: "x" }] };
    const r = await rig(model((_s, n) => (n === 0 ? { toolCalls: [toolCall("web_search", { query: "ferry" })] } : "Hourly from 6. See https://evil.example/p?d=x for more?"), drawn), {
      ports: { web: (() => ({ tools: [{ name: "web_search", description: "s", parameters: { type: "object" } }], run: async () => ({ ok: true, message: { role: "tool", tool_call_id: "c", content: "Times: https://ferry.example/times" } }), settled: async () => undefined })) as never },
    });
    await made(r, { skills: { web: true } });
    const a = await r.bots.ask(ALICE, "buddy", { message: "when is the ferry?", draw: true });
    expect(a.show).toEqual({ blocks: [{ type: "link", label: "Ferry", url: "https://ferry.example/times" }] });
  });
});

describe("in the chat", () => {
  beforeEach(() => resetAreaTablesForTests());

  async function served(words: string | ((s: Sent, n: number) => unknown) = QUESTION, drawn: unknown = DRAWN) {
    const r = await rig(model(words, drawn));
    const app = Fastify();
    const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
    registerBotRoutes(app, { rateLimit: RL, bots: r.bots });
    const events = new MemoryEventStore();
    const parts = botsAreaParts({ bots: r.bots, connectors: null, reader: fakeReader(), now: () => r.now.t });
    registerBotsBotsRoutes(app, { rateLimit: RL, bots: r.bots, code: null, jobs: null, connectors: null, media: null, artifacts: null }, { parts, events });
    await app.ready();
    const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: `${AREA}/chat/plan`, headers: { authorization: `Bearer ${ALICE}` }, payload });
    const turns = async (): Promise<Turn[]> => (await app.inject({ method: "GET", url: `${AREA}/chat/plan`, headers: { authorization: `Bearer ${ALICE}` } })).json().turns;
    return { r, post, turns, events };
  }

  it("keeps the drawing with the bot's turn, and gives it back checked", async () => {
    const s = await served();
    expect((await s.post({ message: "plan a weekend" })).statusCode).toBe(200);
    const [me, bot] = await s.turns();
    expect(me!.show).toBeUndefined();
    expect(bot!.show).toMatchObject({ blocks: [{ type: "choice", key: "k0" }], lists: "drawn" });
  });

  it("takes picks as the person's words, from the labels it kept", async () => {
    const s = await served(QUESTION, { blocks: [{ type: "choice", multi: true, options: ["Scuba", "Old fort", "Night market"] }, { type: "form", fields: [{ label: "Guests", kind: "number" }] }] });
    await s.post({ message: "what else is there?" });
    const bot = (await s.turns())[1]!;
    const res = await s.post({ message: "", picks: { turn: bot.id, values: { k0: { o0: true, o2: true }, k1: { f0: "3" } } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().turns[0]).toMatchObject({ role: "me", text: "Scuba, Night market\nGuests: 3" });
    expect(s.r.model.of("bot.run").at(-1)!.user).toContain("Scuba, Night market\nGuests: 3");
    // Activity keeps a title on one line.
    expect((await s.events.list(ALICE, 0))[0]).toMatchObject({ title: "Scuba, Night market Guests: 3" });
  });

  it("refuses picks for nothing, for a turn that is not theirs, or one with no drawing", async () => {
    const s = await served();
    await s.post({ message: "plan a weekend" });
    const [me, bot] = await s.turns();
    expect((await s.post({ picks: { turn: bot!.id, values: {} } })).json().code).toBe("bad_request");
    expect((await s.post({ picks: { turn: me!.id, values: { k0: { o0: true } } } })).statusCode).toBe(404);
    expect((await s.post({ picks: { turn: "not-a-uuid", values: {} } })).statusCode).toBe(404);
  });
});

describe("on the screen", () => {
  const shown = checkShown({ blocks: [
    { type: "callout", tone: "warn", title: "Book the ferry first", text: "Two boats on Saturday." },
    { type: "row", children: [{ type: "stat", label: "Drive", value: "3 h" }, { type: "stat", label: "Budget", value: "₹14,000" }] },
    { type: "steps", items: [{ title: "Ferry", state: "done" }, { title: "Stay", state: "now" }] },
    { type: "table", columns: ["Stay", "Price", "Walk", "Rating"], rows: [["Hut", "₹3,200", "2 min", "4.6"]] },
    { type: "chart", kind: "bar", items: [{ label: "Stay", value: 6400 }, { label: "Food", value: 3200 }] },
    { type: "chart", kind: "line", items: [{ label: "Fri", value: 29 }, { label: "Sat", value: 31 }] },
    { type: "draw", width: 200, height: 90, label: "The route", shapes: [{ d: "M10 70 C60 10 120 90 190 25", stroke: "bot" }] },
    { type: "choice", question: "Which stay?", options: ["Beach hut", "Villa"] },
  ] }, { seen: { has: () => false } })!;
  const asks = checkShown({ blocks: [
    { type: "choice", multi: true, send: "Plan these", options: ["Scuba", "Old fort"] },
    { type: "form", send: "Book it", fields: [{ label: "Guests", kind: "number" }, { label: "Room", kind: "choice", options: ["Sea", "Garden"] }] },
    { type: "suggest", items: ["Make it cheaper"] },
  ] }, { seen: { has: () => false } })!;
  const o = { slug: "travel", turn: "44444444-4444-4444-8444-444444444444" };
  const actions = (nodes: unknown) => JSON.stringify(nodes);
  /** A build that draws DotArt, and Blip alive, or neither. */
  const alive = (client: "phone" | "desktop") => ctxFor("bots.chat", client, undefined, { can: new Set(["BotsKit", "BotsMotion", "BotBuddy", "DotArt"]) });
  const typeOf = (nodes: unknown[], type: string) => walk({ type: "Stack", children: nodes as never }).filter((n) => n.type === type);

  it("draws with the kit's own parts, on both clients, with physics or without", () => {
    for (const client of ["phone", "desktop"] as const) {
      for (const ctx of [ctxFor("bots.chat", client), alive(client)]) {
        for (const s of [shown, asks, { ...shown, blip: "survey" as const }]) {
          const nodes = showNodes(ctx, s, { ...o, live: true });
          expect(nodes.length, client).toBeGreaterThan(0);
          expect(lintTree({ type: "Stack", children: nodes }), client).toEqual([]);
        }
      }
    }
  });

  it("draws in one look: monochrome, no colour of any palette, the pictures as dots", () => {
    const json = JSON.stringify(showNodes(alive("phone"), shown, { ...o, live: true }));
    for (const hex of Object.values(PALETTE_HEX)) expect(json, hex).not.toContain(hex);
    // the bars, the line and the drawing: one picture of dots each
    expect(typeOf(showNodes(alive("phone"), shown, { ...o, live: true }), "DotArt")).toHaveLength(3);
    // a build without DotArt: the very same dots, as circles in ink
    const still = typeOf(showNodes(ctxFor("bots.chat", "phone"), shown, { ...o, live: true }), "SVG");
    const circles = still.flatMap((n) => (n.props?.shapes as Array<{ circle?: number[]; fill?: string }> | undefined) ?? []);
    expect(circles.length).toBeGreaterThan(50);
    expect(new Set(circles.map((c) => c.fill))).toEqual(new Set(["#0a0a0a"]));
  });

  it("brings the newest answer's pictures in by physics that suits each, and draws an older one at home", () => {
    const live = typeOf(showNodes(alive("desktop"), shown, { ...o, live: true }), "DotArt").map((n) => n.props as Record<string, unknown>);
    expect(live.map((p) => [p.enter, p.heat ?? 0])).toEqual([[MOTION.bars.enter, 0], [MOTION.line.enter, 0], [MOTION.draw.enter, MOTION.draw.heat]]);
    expect(live.map((p) => p.key)).toEqual([`${o.turn}.4`, `${o.turn}.5`, `${o.turn}.6`]);
    expect(live[2]!.label).toBe("The route");
    const old = typeOf(showNodes(alive("desktop"), shown, { ...o, live: false }), "DotArt").map((n) => n.props as Record<string, unknown>);
    expect(old.every((p) => p.enter === "none" && p.heat === undefined)).toBe(true);
  });

  it("puts Blip beside the first picture when asked: alive in ink on the newest answer, his pose on an older one or an older build", () => {
    const withBlip = { ...shown, blip: "survey" as const };
    const live = showNodes(alive("phone"), withBlip, { ...o, live: true });
    const buddies = typeOf(live, "BotBuddy");
    expect(buddies).toHaveLength(1);
    expect(buddies[0]!.props).toMatchObject({ color: "#0a0a0a", act: "survey", label: "Blip", life: `show.${o.turn}` });
    // beside the callout, the first block he may stand by
    expect(typeOf([live[0]!], "BotBuddy")).toHaveLength(1);
    const old = showNodes(alive("phone"), withBlip, { ...o, live: false });
    expect(typeOf(old, "BotBuddy")).toHaveLength(0);
    expect(typeOf(old, "Image").some((n) => n.props?.accessibilityLabel === "Blip" || JSON.stringify(n.props).includes("blip"))).toBe(true);
    expect(typeOf(showNodes(ctxFor("bots.chat", "phone"), withBlip, { ...o, live: true }), "BotBuddy")).toHaveLength(0);
    // none asked, none drawn
    expect(typeOf(showNodes(alive("phone"), shown, { ...o, live: true }), "BotBuddy")).toHaveLength(0);
  });

  it("puts a wide table in cards on the phone, and keeps it a table in the window", () => {
    const types = (client: "phone" | "desktop") => walk({ type: "Stack", children: showNodes(ctxFor("bots.chat", client), { blocks: [shown.blocks[3]!] }, { ...o, live: true }) }).length;
    expect(types("phone")).not.toBe(types("desktop"));
  });

  it("sends a tap's words, and picks with the turn they answer", () => {
    const one = actions(showNodes(ctxFor("bots.chat", "phone"), shown, { ...o, live: true }));
    expect(one).toContain('"body":{"message":"Beach hut"}');
    expect(one).toContain('"path":"/v1/botsapp/bots/chat/travel"');
    const many = actions(showNodes(ctxFor("bots.chat", "phone"), asks, { ...o, live: true }));
    expect(many).toContain('"picks":{"turn":"44444444-4444-4444-8444-444444444444","values":"$state.show"}');
    expect(many).toContain('"kind":"toggleState","path":"show.k0.o1"');
    expect(many).toContain('"value":"show.k1.f0"');
    expect(many).toContain('"body":{"message":"Make it cheaper"}');
  });

  it("draws an older turn still: no taps, the pick shown, no suggestions or form", () => {
    const still = showNodes(ctxFor("bots.chat", "phone"), { blocks: [...shown.blocks.slice(-1), ...asks.blocks] }, { ...o, live: false, picked: "Villa" });
    const all = walk({ type: "Stack", children: still });
    expect(all.some((n) => n.on?.onPress)).toBe(false);
    expect(all.some((n) => n.type === "TextField")).toBe(false);
    expect(actions(still)).not.toContain("Make it cheaper");
    // the pick shown: an ink edge and its dot filled; the one not picked, a grey edge and a hollow ring
    const chipOf = (label: string) => all.find((n) => n.children?.some((c) => c.props?.content === label))!;
    expect((chipOf("Villa").style as Record<string, unknown>).borderColor).toBe("#0a0a0a");
    expect((chipOf("Villa").children![0]!.style as Record<string, unknown>).backgroundColor).toBe("#0a0a0a");
    expect((chipOf("Beach hut").children![0]!.style as Record<string, unknown>).backgroundColor).toBe("transparent");
  });

  it("is live only on the chat's last turn, and leaves the drawn lists out of the words", () => {
    const at = Date.UTC(2026, 9, 28, 9);
    const base = { opens: [], approvals: [], paise: 0 };
    const turns: Turn[] = [
      { id: "a", role: "me", text: "plan a weekend", at, ...base },
      { id: "b", role: "bot", text: QUESTION, at: at + 1, ...base, show: { blocks: [shown.blocks.at(-1)!], lists: "drawn" } },
      { id: "c", role: "me", text: "Villa", at: at + 2, ...base },
      { id: "d", role: "bot", text: QUESTION, at: at + 3, ...base, show: { blocks: [shown.blocks.at(-1)!] } },
    ];
    const nodes = chatTurns(ctxFor("bots.chat", "phone"), { slug: "travel" }, turns);
    expect(JSON.stringify(nodes).match(/"message":"Beach hut"/g)).toHaveLength(1);
    // the first answer's list is drawn by its choice, the last's is not (Share and Report carry the words, but draw none of them)
    const drawn = walk({ type: "Stack", children: nodes }).filter((n) => n.type === "Text" && String(n.props?.content).includes("Lonavala"));
    expect(drawn).toHaveLength(1);
  });
});
