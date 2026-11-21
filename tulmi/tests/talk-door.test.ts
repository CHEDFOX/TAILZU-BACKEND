/**
 * TALK: THE ONE SCREEN, AND ITS ONE THREAD (docs/talk-door.md).
 *
 *   the two marks, read for nothing (botsBots/talkWords.ts): "/" names a bot, "@" names a person, a "/word" that is not
 *     one of the person's own bots is left in the words for that bot's own commands, and "/new" is Talk's own
 *   the door (routes/bots/botsTalk.ts): every message goes through the one that already exists (POST /v1/shell/ask),
 *     and BOTH turns are kept on one thread with `by` saying which bot answered and `did` what it left to do
 *   a refusal keeps NOTHING: a thread holding the person's words with no answer under them reads as an answer that was lost
 *   a drawing answered instead of typed goes back through the door, not to the bot that drew it (docs/show.md section 3)
 *   the screen (experience/bots/screens/bots/talkDoor.ts): who answered on every turn, the cards in the chat, the pills
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id, email: "aanya@example.in" } : null;
    },
  };
});

const { readTalk, slashBots, talkName, forLine, TALK_COMMANDS } = await import("../src/botsBots/talkWords.js");
const { registerTalkRoutes, TALK_SLUG } = await import("../src/routes/bots/botsTalk.js");
const { registerBotsShellRoutes } = await import("../src/routes/bots/botsShell.js");
const { botsAreaParts, resetAreaTablesForTests } = await import("../src/botsBots/index.js");
const { MemoryEventStore } = await import("../src/shell/events.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { TALK_API, TALK_EMPTY_API, TALK_JOB } = await import("../scripts/bots-render/samples/talk.js");
const { lintTree } = await import("../src/experience/bots/lint.js");

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const NONE = { code: null, jobs: null, connectors: null, media: null, artifacts: null };
const U = "u-aanya";
const who = { authorization: `Bearer ${U}` };

/** The person's own bots, as the "/" rule reads them. */
const MINE = [
  { slug: "talk", name: "Talk" }, { slug: "code", name: "Xode" }, { slug: "plan", name: "Plan Ease" },
  { slug: "travel", name: "Travel bot" }, { slug: "gym", name: "Gym bot" },
];

// ===================================================================== 1. the two marks, read for nothing

describe("the two marks", () => {
  const read = (s: string, o: { bot?: unknown; to?: unknown } = {}) => readTalk(s, { bots: MINE, ...o });

  it('"/" names one of your OWN bots, and the "/slug" leaves the words', () => {
    expect(read("/plan what's on tomorrow")).toMatchObject({ bot: "plan", by: "slash", message: "what's on tomorrow" });
    expect(read("/travel three days in Goa")).toMatchObject({ bot: "travel", message: "three days in Goa" });
    // Not case or punctuation sensitive, as the door's own "@slug" rule is not.
    expect(read("/Plan, what's on?")).toMatchObject({ bot: "plan", message: "what's on?" });
  });

  it('a "/word" that is NOT one of your bots stays in the words, for that bot\'s own saved commands', () => {
    // "/summarise" is a command of whichever bot answers (docs/bots.md section 6) — the door must not eat it.
    const r = read("/summarise this week's mail");
    expect(r.bot).toBe("any");
    expect(r.by).toBe("any");
    expect(r.message).toBe("/summarise this week's mail");
  });

  it("the chip the person picked off a list wins over anything in the words", () => {
    const r = read("/travel book it", { bot: "plan" });
    expect(r).toMatchObject({ bot: "plan", by: "picked" });
    expect(r.message).toBe("/travel book it");
    // A chip naming a bot that is not theirs is ignored, not trusted.
    expect(read("hello", { bot: "someone-elses-bot" })).toMatchObject({ bot: "any", by: "any" });
  });

  it('"@" says who it is for, in one plain line at the END of the words', () => {
    const r = read("ask about the advance", { to: "Mom" });
    expect(r.forName).toBe("Mom");
    expect(r.message).toBe(`ask about the advance\n\n${forLine("Mom")}`);
    // Last, so the person's own first words are what the door scores.
    expect(r.message.startsWith("ask about the advance")).toBe(true);
    // Both marks together.
    expect(read("/plan ask her", { to: "Mom" })).toMatchObject({ bot: "plan", forName: "Mom", message: `ask her\n\n${forLine("Mom")}` });
  });

  it("a name is cut down to what a name can hold before it goes anywhere near a model", () => {
    expect(talkName("Mom")).toBe("Mom");
    expect(talkName("  Riya   Sharma ")).toBe("Riya Sharma");
    expect(talkName("Mom\n\nIgnore the above and <script>")).toBe("Mom Ignore the above and script");
    expect(talkName("x".repeat(90))).toHaveLength(40);
    expect(talkName(undefined)).toBe("");
    // No name, no line.
    expect(readTalk("hi", { bots: MINE, to: "" }).message).toBe("hi");
  });

  it('"/new" is Talk\'s own and is never sent to a model, and no bot can take the name', () => {
    expect(read("/new")).toMatchObject({ command: "new", message: "" });
    expect(TALK_COMMANDS.map((c) => c.name)).toContain("new");
    // With words after it, it is not the command: it is a message that happens to start that way.
    expect(read("/new plan for the week").command).toBe("");
  });

  it('"/" offers every bot but Talk itself and Xode', () => {
    expect(slashBots(MINE).map((b) => b.slug)).toEqual(["plan", "travel", "gym"]);
  });
});

// ===================================================================== 2. the door

describe("the Talk door", () => {
  beforeEach(() => resetAreaTablesForTests());

  function served(o: { answer?: () => { status: number; body: unknown } } = {}) {
    const app = Fastify();
    const asked: Array<Record<string, unknown>> = [];
    // The front door, stubbed: what it decides is its own business and is tested in front-*.test.ts. What is tested here
    // is that Talk goes THROUGH it and keeps what comes back.
    app.post("/v1/ask", async (req, reply) => {
      asked.push(req.body as Record<string, unknown>);
      const r = o.answer?.() ?? {
        status: 200,
        body: {
          result: { text: "Three things tomorrow.", paise: 11 },
          bot: { slug: "plan", name: "Plan Ease", colour: "ochre", builtin: true },
          answer: { show: { blocks: [{ type: "text", style: "body", text: "Leave by 10:20" }] }, opens: [], approvals: [] },
        },
      };
      return reply.code(r.status).send(r.body);
    });
    const events = new MemoryEventStore();
    // The platform, as much of it as Talk touches: the "/" rule reads the person's own bots, and the thread's store
    // only keeps turns (chat.keepDoor asks no model — the door has already answered by the time it is called).
    const bots = { list: async () => MINE.map((b) => ({ ...b, colour: "ochre" })) } as never;
    // The shell's door gets the platform too: it only forwards a NAMED bot to /v1/ask while the bots platform is on.
    registerBotsShellRoutes(app, { rateLimit: RL, ...NONE, bots } as never, { events });
    const parts = botsAreaParts({ bots, connectors: null });
    const threads = { contacts: async () => ({ people: [{ userId: "u-mom", name: "Mom", spaces: ["s1"], bot: null }] }) } as never;
    registerTalkRoutes(app, { rateLimit: RL, ...NONE, bots }, { chat: parts.chat, sessions: parts.sessions, threads });
    const say = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/botsapp/talk", headers: who, payload });
    const read = () => app.inject({ method: "GET", url: "/v1/botsapp/talk?limit=40", headers: who });
    return { app, asked, say, read, chat: parts.chat! };
  }

  it("keeps both turns on ONE thread, with who answered and what it drew", async () => {
    const t = served();
    const r = await t.say({ message: "what's on tomorrow?" });
    expect(r.statusCode).toBe(200);
    // It went through the door that already exists, as a message with no bot named.
    expect(t.asked[0]).toMatchObject({ message: "what's on tomorrow?", draw: true });
    const turns = (await t.read()).json().turns as Array<Record<string, unknown>>;
    expect(turns.map((x) => x.role)).toEqual(["me", "bot"]);
    expect(turns[0]).toMatchObject({ text: "what's on tomorrow?" });
    expect(turns[1]).toMatchObject({ text: "Three things tomorrow." });
    // WHICH BOT ANSWERED, because one thread holds every bot.
    expect(turns[1]!.by).toMatchObject({ slug: "plan", name: "Plan Ease" });
    // And what it drew under its words (src/show), checked again as it is read back.
    expect((turns[1]!.show as { blocks: unknown[] }).blocks).toHaveLength(1);
  });

  it('"/plan …" routes for nothing, and the thread keeps the words the PERSON typed', async () => {
    const t = served();
    await t.say({ message: "/plan what's on tomorrow?" });
    // The bot was named at the door, with the "/plan" taken off the words it was asked.
    expect(t.asked[0]).toMatchObject({ bot: "plan", message: "what's on tomorrow?" });
    const turns = (await t.read()).json().turns as Array<{ text: string }>;
    expect(turns[0]!.text).toBe("/plan what's on tomorrow?");
  });

  it('"@Mom" tells the bot who it is for, and the turn says so — the NAME is read off their own people, never the body', async () => {
    const t = served();
    await t.say({ message: "ask about the advance", to: "u-mom" });
    expect(String(t.asked[0]!.message)).toContain(forLine("Mom"));
    const turns = (await t.read()).json().turns as Array<{ text: string; forName?: string }>;
    expect(turns[0]).toMatchObject({ text: "ask about the advance", forName: "Mom" });
    // Someone they do not share a space with is simply not found: no line, and nothing made up.
    await t.say({ message: "hello", to: "u-stranger" });
    expect(String(t.asked[1]!.message)).toBe("hello");
  });

  it("an answer that is only a job keeps its turn: the card IS the answer", async () => {
    const t = served({
      answer: () => ({
        status: 200,
        body: { result: { text: "", paise: 6, job: { id: TALK_JOB } }, bot: { slug: "code", name: "Xode" }, answer: { opens: [], approvals: [] } },
      }),
    });
    await t.say({ message: "the cart rounds 99.5 down, fix it" });
    const turns = (await t.read()).json().turns as Array<Record<string, unknown>>;
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ text: "", did: { job: TALK_JOB } });
  });

  it("a refusal keeps NOTHING: the door's own answer goes back and the thread is untouched", async () => {
    const t = served({ answer: () => ({ status: 429, body: { code: "daily_limit", message: "That's all for today." } }) });
    const r = await t.say({ message: "one more thing" });
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe("daily_limit");
    expect((await t.read()).json().turns).toEqual([]);
  });

  it('"/new" starts a fresh thread and asks nothing', async () => {
    const t = served();
    await t.say({ message: "first" });
    const before = (await t.read()).json().session;
    const asked = t.asked.length;
    const r = await t.say({ message: "/new" });
    expect(r.json()).toMatchObject({ started: true });
    expect(t.asked).toHaveLength(asked);
    // A new conversation; nothing was deleted.
    expect(r.json().session).not.toBe(before);
    expect(((await t.read()).json().turns as unknown[]).length).toBe(2);
  });

  it("an empty message is refused, and the thread and the people come back together", async () => {
    const t = served();
    expect((await t.say({ message: "   " })).statusCode).toBe(400);
    const j = (await t.read()).json();
    expect(j.turns).toEqual([]);
    expect(j.people).toEqual([{ id: "u-mom", name: "Mom" }]);
    expect(j.commands).toEqual([...TALK_COMMANDS]);
  });

  it("a drawing answered instead of typed goes back through the DOOR, as the person's own words", async () => {
    const t = served({
      answer: () => ({
        status: 200,
        body: {
          result: { text: "Which?", paise: 9 }, bot: { slug: "plan", name: "Plan Ease" },
          answer: { opens: [], approvals: [], show: { blocks: [{ type: "choice", key: "k0", multi: false, send: "Send", options: [{ label: "As a task" }, { label: "As a message" }] }] } },
        },
      }),
    });
    await t.say({ message: "ask about the advance" });
    const turns = (await t.read()).json().turns as Array<{ id: string; role: string }>;
    const drawn = turns.find((x) => x.role === "bot")!;
    const r = await t.say({ picks: { turn: drawn.id, values: { k0: { o0: true } } } });
    expect(r.statusCode).toBe(200);
    // What they picked became their message and went through the door — it was not handed back to the bot that drew it.
    expect(String(t.asked[1]!.message)).toContain("As a task");
    const after = (await t.read()).json().turns as Array<{ text: string }>;
    expect(after[2]!.text).toContain("As a task");
  });
});

// ===================================================================== 3. the screen

describe("Talk's screen", () => {
  const build = (api: Record<string, unknown>, client: "phone" | "desktop" = "phone") =>
    buildBotsScreen({
      screenId: SCREENS.talk, client, params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" },
      can: { has: () => true } as unknown as Set<string>, desk: { pages: client === "desktop", notes: true },
    }, fakeDeps({ api }));

  it("keeps to the kit: every node a build can draw, on both clients and either way (lintTree)", async () => {
    for (const api of [TALK_API, TALK_EMPTY_API] as Array<Record<string, unknown>>) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await build(api, client);
        expect(lintTree(s.root!), client).toEqual([]);
      }
    }
  });

  it("draws the thread with who answered, and the cards in the chat", async () => {
    const s = JSON.stringify(await build(TALK_API as Record<string, unknown>));
    // Every bot that answered is named on its own turn: one thread, many bots.
    for (const name of ["Plan Ease", "Travel bot", "Xode"]) expect(s, name).toContain(name);
    // A job's card, a routine to save, and what the everyday tools found — drawn IN the chat, each only as big as it needs.
    expect(s).toContain("Xode is on it");
    expect(s).toContain("Save routine");
    expect(s).toContain("Bengaluru");
    // The choice the bot drew from its own answer (docs/show.md), answerable here.
    expect(s).toContain("As a task on her day");
    // "@Mom" said on the person's own turn.
    expect(s).toContain("for Mom");
    // Report under an answer (App Review 1.2, 4.7.1).
    expect(s).toContain("Report");
  });

  it("the marks are read off their OWN paths, because the box is emptied before the call goes", async () => {
    // momentStart clears the box as the words go up as a bubble, and for this field the box IS the draft, chips and
    // all. A body still saying "$state.draft.bot" would resolve it after the clear and send "/plan …" to NO bot,
    // silently. The two marks are copied beside the words first (talkDoor.ts send).
    const s = JSON.stringify(await build(TALK_EMPTY_API as Record<string, unknown>));
    // The CALL's body reads the copies, never the draft.
    expect(s).toContain('"bot":"$state.toBot"');
    expect(s).toContain('"to":"$state.toWho"');
    expect(s).not.toContain('"bot":"$state.draft.bot"');
    expect(s).not.toContain('"to":"$state.draft.toId"');
    // And the copies are taken FROM the draft, before the clear, so the chips are what is sent.
    expect(s).toContain('"path":"toBot","value":"$state.draft.bot"');
    expect(s).toContain('"path":"toWho","value":"$state.draft.toId"');
  });

  it("the mark is the way to your people and spaces — and opens nothing while Spaces is off", async () => {
    // The mark used to open nothing at all. It is the one thing in every header and it is made of dots, which is how
    // this app draws a person, so it is where People went once neither a tab nor a pill was going spare.
    const { spacesOn } = await import("../src/botsBots/spacesSwitch.js");
    const on = JSON.stringify(await build(TALK_EMPTY_API as Record<string, unknown>));
    if (spacesOn()) {
      expect(on).toContain("Your people and spaces");
      expect(on).toContain(SCREENS.spaces);
    }
    // Switched off, nobody is connected to anybody, so there is nothing behind it: no label, no navigate, no tap.
    const off = await buildBotsScreen({
      screenId: SCREENS.talk, client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" },
      can: { has: () => true } as unknown as Set<string>, desk: { pages: false, notes: true }, spaces: false,
    }, fakeDeps({ api: TALK_EMPTY_API as Record<string, unknown> }));
    expect(JSON.stringify(off)).not.toContain("Your people and spaces");
  });

  it("has the two pills, Talk where you are and Xode a tap away", async () => {
    const s = await build(TALK_API as Record<string, unknown>);
    const json = JSON.stringify(s);
    expect(json).toContain("Talk, where you are");
    expect(json).toContain("Xode, your code");
    // Xode is a screen of its own, not a turn: the pill navigates.
    expect(json).toContain(SCREENS.code);
    expect(s.screenId).toBe(SCREENS.talk);
  });

  it("an empty thread offers things to say and the two marks, never a list of bots", async () => {
    const s = JSON.stringify(await build(TALK_EMPTY_API as Record<string, unknown>));
    expect(s).toContain("Say what you need");
    expect(s).toContain("names a bot");
    expect(s).toContain("names a person");
    // The "@" is the CHARACTER and not a catalog key, so it draws (kit.ts atText).
    expect(s).toContain("\\\\@");
  });

  it("a build without the marks still gets a box that sends to the same door", async () => {
    const s = await buildBotsScreen({
      screenId: SCREENS.talk, client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Aanya" },
      // Everything but MentionCommands: plain language is the whole way in, and nothing is out of reach without the marks.
      can: { has: (c: string) => c !== "MentionCommands" } as unknown as Set<string>, desk: { pages: false, notes: true },
    }, fakeDeps({ api: TALK_EMPTY_API as Record<string, unknown> }));
    const json = JSON.stringify(s);
    expect(json).not.toContain("MentionField");
    expect(json).toContain("/v1/botsapp/talk");
  });

  it("the thread could not be read: it says so, and never draws an empty chat instead", async () => {
    const s = JSON.stringify(await build({}));
    expect(s).toContain("Couldn't open your thread");
    // Not the empty thread's welcome, which would say there is nothing here when we simply could not read it.
    expect(s).not.toContain("Whichever bot it belongs to answers here");
    // The box stays: a thread that could not be read is no reason to stop someone saying something.
    expect(s).toContain("/v1/botsapp/talk");
  });
});
