/**
 * A TURN OF TALK, END TO END, WITH A SCRIPTED MODEL (src/talk/index.ts, routes/ask/talk.ts):
 *
 *   - chat goes to the cheap tier; think to the strong one with reasoning on, ponder said first
 *   - send and task are handed to Ask: a send is trusted, a payment is not; nothing is said
 *   - a follow-up is made whole by the brain, in the one call, from the last turns and what they found
 *   - the words stream in whole words; the mood comes first
 *   - a model that fails before a word climbs one tier; after words, no second voice: a short apology
 *   - the person's stop ends the turn with what was said; a new turn of the same talk stops the one before
 *   - a private field, X0 Bot's window, a sensitive app: no model, nothing kept
 *   - an answer that needs fresh facts looks them up first; nothing left of the day, no model
 *   - the NDJSON contract: one event a line, route first, done last
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { talkTurn, TalkSessions, flight, stopTalk, resetTalkSessionsForTests } = await import("../src/talk/index.js");
const { AskDecideReply, resetAskDecideCacheForTests } = await import("../src/askDecide/index.js");
const { PersonContext, MemoryContextStore } = await import("../src/context/index.js");
const { MemoryRoutineStore } = await import("../src/routines/index.js");
const { registerTalkRoutes, readTalkBody } = await import("../src/routes/ask/talk.js");
const { SpendMeter } = await import("../src/artifacts/limits.js");
type CallFn = import("../src/code/work/model.js").CallFn;
type Reply = import("../src/askDecide/index.js").AskDecideReply;
type TalkEvent = import("../../shared/types/api.js").TalkEvent;
type ToolCall = import("../src/code/brain/types.js").ToolCall;

const ME = "u1";
const user = { id: ME } as import("../src/auth/supabase.js").AuthedUser;

/** One answer of the reply model: its pieces, then how it ends. */
type Say =
  | { pieces: string[]; then?: "ok" }
  | { pieces: string[]; then: "fail" }            // fails after these pieces; the gateway voids them and asks the next model
  | { pieces: string[]; then: "hang" }            // waits for the stop
  | { error: Error };                              // fails before a word

interface Script { decide?: Array<Partial<Reply>>; look?: ToolCall[][]; say?: Say[] }

interface Seen { purpose: string; tier: string; reasoning?: string; user: string; tools?: string[]; maxPaise?: number }

const result = (o: { text?: string; json?: unknown; toolCalls?: ToolCall[]; tier?: string }) => ({
  text: o.text ?? "", json: o.json, toolCalls: o.toolCalls ?? [], model: `m-${o.tier}`, promptTokens: 1, completionTokens: 1, costUsd: 0, paise: 1,
  costSource: "estimated", truncated: false, ms: 1, calls: 1, trail: [],
});

function model(s: Script) {
  const seen: Seen[] = [];
  const call = (async (input: {
    purpose: string; tier?: string; reasoning?: string; messages: Array<{ role: string; content: string }>; tools?: Array<{ name: string }>;
    budget: { maxPaise?: number }; signal?: AbortSignal; onText?: (p: string) => void; onReset?: () => void;
  }) => {
    const u = input.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    seen.push({ purpose: input.purpose, tier: String(input.tier), ...(input.reasoning ? { reasoning: input.reasoning } : {}), user: u, ...(input.tools ? { tools: input.tools.map((t) => t.name) } : {}), ...(typeof input.budget === "object" ? { maxPaise: input.budget.maxPaise } : {}) });
    if (input.purpose === "ask.decide") {
      const next = s.decide?.shift();
      if (!next) throw new Error("down");
      const json = AskDecideReply.parse({ goal: "", screen: false, web: false, sure: 0.9, ...next });
      return result({ text: JSON.stringify(json), json, tier: input.tier });
    }
    if (input.purpose === "talk.look") return result({ toolCalls: s.look?.shift() ?? [], tier: input.tier });
    if (input.purpose === "talk.reply") {
      const next = s.say?.shift();
      if (!next) throw new Error("down");
      if ("error" in next) throw next.error;
      for (const p of next.pieces) input.onText?.(p);
      if (next.then === "fail") {
        // What the gateway does: the words shown are void, then the next model on the ladder is asked unless the caller stopped.
        input.onReset?.();
        if (input.signal?.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
        input.onText?.("[talk] A different voice.");
        return result({ text: "A different voice.", tier: input.tier });
      }
      if (next.then === "hang") {
        await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve(), { once: true }));
        const e = new Error("aborted"); e.name = "AbortError"; throw e;
      }
      return result({ text: next.pieces.join(""), tier: input.tier });
    }
    throw new Error(`unexpected purpose ${input.purpose}`);
  }) as unknown as CallFn;
  return { call, seen, of: (purpose: string) => seen.filter((x) => x.purpose === purpose) };
}

function world() {
  const store = new MemoryContextStore();
  const context = new PersonContext({ store, on: async () => true, routines: new MemoryRoutineStore() });
  const sessions = new TalkSessions();
  const daily = new SpendMeter(1_500);
  return { store, context, sessions, daily };
}

async function turn(w: ReturnType<typeof world>, m: ReturnType<typeof model>, input: Partial<Parameters<typeof talkTurn>[0]> & { words: string }, o: { signal?: AbortSignal; look?: Parameters<typeof talkTurn>[1]["look"] } = {}) {
  const events: TalkEvent[] = [];
  const out = await talkTurn({ talkId: "talk_abc123", turn: 0, field: null, ...input }, {
    user, call: m.call, context: w.context, sessions: w.sessions, daily: w.daily, ...(o.signal ? { signal: o.signal } : {}), ...(o.look ? { look: o.look } : {}),
  }, (e) => events.push(e));
  return { events, out, text: events.filter((e): e is Extract<TalkEvent, { t: "text" }> => e.t === "text").map((e) => e.text) };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => { resetAskDecideCacheForTests(); resetTalkSessionsForTests(); });

describe("the road each kind takes", () => {
  it("chat goes to the cheap tier, fast, and says the answer's own mood", async () => {
    const w = world();
    const m = model({ decide: [{ do: "chat" }], say: [{ pieces: ["[laugh] Why did the cat sit on the computer? ", "To keep an eye on the mouse."] }] });
    const r = await turn(w, m, { words: "tell me a joke about cats" });
    expect(r.events[0]).toEqual({ t: "route", kind: "chat", depth: "quick", lang: "en" });
    expect(r.events[1]).toEqual({ t: "mood", mood: "laugh" });
    expect(m.of("talk.reply").map((s) => [s.tier, s.reasoning])).toEqual([["cheap", "none"]]);
    expect(r.events.at(-1)).toEqual({ t: "done", text: "Why did the cat sit on the computer? To keep an eye on the mouse." });
    expect(r.out).toMatchObject({ kind: "chat", ending: "done" });
  });

  it("think goes to the strong tier with reasoning on, and ponder is said before anything else", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[talk] The fifteen year loan costs less ", "overall, by about four lakh."] }] });
    const r = await turn(w, m, { words: "compare a 20 year loan at 8.5% with a 15 year one at 8.1%" });
    expect(r.events[0]).toMatchObject({ t: "route", kind: "think", depth: "think" });
    expect(r.events[1]).toEqual({ t: "mood", mood: "ponder" });
    expect(r.events.findIndex((e) => e.t === "text")).toBeGreaterThan(1);
    expect(m.of("talk.reply").map((s) => [s.tier, s.reasoning])).toEqual([["strong", "medium"]]);
  });

  it("a send is handed to Ask, trusted; nothing is said", async () => {
    const w = world();
    const m = model({ decide: [{ do: "send", goal: "tell Riya the mockups are ready", to: "Riya", via: "WhatsApp" }] });
    const r = await turn(w, m, { words: "tell Riya the mockups are ready" });
    expect(r.events).toEqual([
      { t: "route", kind: "send", depth: "quick", lang: "en" },
      { t: "mood", mood: "done" },
      { t: "handoff", to: "agent", goal: "tell Riya the mockups are ready", trusted: true },
      { t: "done", text: "" },
    ]);
    expect(m.of("talk.reply")).toHaveLength(0);
    await flush();
    expect((await w.store.get(ME))!.people.map((p) => p.name)).toEqual(["Riya"]);
  });

  it("a task that pays is handed to Ask untrusted, so the device asks first", async () => {
    const w = world();
    const m = model({ decide: [{ do: "task" }] });
    const r = await turn(w, m, { words: "pay the electricity bill on the BESCOM site" });
    expect(r.events.find((e) => e.t === "handoff")).toEqual({ t: "handoff", to: "agent", goal: "pay the electricity bill on the BESCOM site", trusted: false });
  });

  it("a bot, notes and a routine are handed to theirs", async () => {
    const w = world();
    const m = model({ decide: [{ do: "notes", notes: "start" }, { do: "routine" }] });
    const notes = await turn(w, m, { words: "start taking notes" });
    expect(notes.events.find((e) => e.t === "handoff")).toMatchObject({ to: "notes", notes: "start", trusted: true });
    const routine = await turn(w, m, { words: "every morning tell me the news", turn: 1 });
    expect(routine.events.find((e) => e.t === "handoff")).toMatchObject({ to: "routine" });
  });
});

describe("a follow-up, made whole by the brain from the last turns and what they found", () => {
  it("'send that to Riya' after an answer with a number hands Ask the number, in one call", async () => {
    const w = world();
    const m = model({
      decide: [{ do: "answer", web: false }, { do: "send", to: "Riya", goal: "send the Taj's number 022 6665 3366 to Riya" }],
      say: [{ pieces: ["[talk] The Taj in Colaba is on 022 6665 3366."] }],
    });
    const first = await turn(w, m, { words: "what's the phone number of the Taj in Colaba" });
    expect(first.events.at(-1)).toEqual({ t: "done", text: "The Taj in Colaba is on 022 6665 3366.", found: { numbers: ["022 6665 3366"], names: ["Taj", "Colaba"] } });
    const second = await turn(w, m, { words: "send that to Riya", turn: 1 });
    const decide = m.of("ask.decide")[1]!;
    expect(decide.user).toContain("This talk so far");
    expect(decide.user).toContain("The Taj in Colaba is on 022 6665 3366.");
    expect(decide.user).toContain("found: numbers 022 6665 3366");
    expect(m.seen.map((x) => x.purpose)).not.toContain("front.complete");
    expect(second.events.find((e) => e.t === "handoff")).toEqual({ t: "handoff", to: "agent", goal: "send the Taj's number 022 6665 3366 to Riya", trusted: true });
    const kept = w.sessions.get(ME, "talk_abc123")!;
    expect(kept.turns.map((t) => [t.n, t.kind, t.goal ?? ""])).toEqual([[0, "answer", ""], [1, "send", "send the Taj's number 022 6665 3366 to Riya"]]);
  });

  it("the brain left 'send that to Riya' as it was: the last answer and what it found go to Ask with it, no call made", async () => {
    const w = world();
    const m = model({
      decide: [{ do: "answer", web: false }, { do: "send", to: "Riya", goal: "send that to Riya" }],
      say: [{ pieces: ["[talk] The Taj in Colaba is on 022 6665 3366."] }],
    });
    await turn(w, m, { words: "what's the phone number of the Taj in Colaba" });
    const second = await turn(w, m, { words: "send that to Riya", turn: 1 });
    expect(m.seen.map((x) => x.purpose)).toEqual(["ask.decide", "talk.reply", "ask.decide"]);
    expect(second.events.find((e) => e.t === "handoff")).toEqual({ t: "handoff", to: "agent", trusted: true,
      goal: "send that to Riya\n(The Taj in Colaba is on 022 6665 3366. Found: numbers 022 6665 3366; names Taj, Colaba)" });
  });

  it("a goal the brain made vaguer, with none of what the last answer found, gets the answer too", async () => {
    const w = world();
    const m = model({
      decide: [{ do: "answer" }, { do: "send", to: "Riya", goal: "send the hotel's number to Riya" }],
      say: [{ pieces: ["[talk] The Taj in Colaba is on 022 6665 3366."] }],
    });
    await turn(w, m, { words: "what's the phone number of the Taj in Colaba" });
    const second = await turn(w, m, { words: "send that to Riya", turn: 1 });
    expect(second.events.find((e) => e.t === "handoff")).toMatchObject({ goal: "send the hotel's number to Riya\n(The Taj in Colaba is on 022 6665 3366. Found: numbers 022 6665 3366; names Taj, Colaba)" });
  });

  it("a vague goal with a name in it but none of the last answer's figures gets the answer ('the Pixel 9 price' is no price)", async () => {
    const w = world();
    const m = model({
      decide: [{ do: "answer" }, { do: "send", to: "Aman", goal: "send the Pixel 9 price to Aman" }],
      say: [{ pieces: ["[talk] The Pixel 9 is about 79,999 rupees in India."] }],
    });
    await turn(w, m, { words: "how much is the Pixel 9 in India" });
    const second = await turn(w, m, { words: "send that price to Aman", turn: 1 });
    expect((second.events.find((e) => e.t === "handoff") as { goal: string }).goal).toContain("79,999");
  });

  it("a lone name, or a guess, is asked about instead of handed to Ask", async () => {
    const w = world();
    const m = model({ decide: [{ do: "send", to: "Riya", sure: 0.8 }, { do: "task", sure: 0.3 }], say: [{ pieces: ["[talk] What about Riya?"] }, { pieces: ["[talk] What should I open?"] }] });
    const one = await turn(w, m, { words: "Riya" });
    expect(one.events.find((e) => e.t === "handoff")).toBeUndefined();
    expect(one.events[0]).toMatchObject({ t: "route", kind: "chat" });
    expect(one.out.reasons).toContain("ask_back");
    const two = await turn(w, m, { words: "open that thing from before", turn: 1 });
    expect(two.events.find((e) => e.t === "handoff")).toBeUndefined();
  });

  it("Chinese and Japanese, written with no spaces, are not one word: a send said whole goes to Ask", async () => {
    const w = world();
    const m = model({ decide: [{ do: "send", sure: 0.9 }, { do: "send", sure: 0.9 }] });
    const zh = await turn(w, m, { words: "给王经理发微信说报告明天上午交" });
    expect(zh.events.find((e) => e.t === "handoff")).toMatchObject({ to: "agent" });
    const ja = await turn(w, m, { words: "田中さんにLINEで明日の会議は10時からと送って", turn: 1 });
    expect(ja.events.find((e) => e.t === "handoff")).toMatchObject({ to: "agent" });
  });

  it("a handoff that does not point back goes as it was said", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }, { do: "send", to: "Riya", goal: "tell Riya I'm late" }], say: [{ pieces: ["[talk] Twelve dollars."] }] });
    await turn(w, m, { words: "how much is pro" });
    const second = await turn(w, m, { words: "tell Riya I'm late", turn: 1 });
    expect(second.events.find((e) => e.t === "handoff")).toMatchObject({ goal: "tell Riya I'm late" });
  });

  it("the answering model sees the talk so far, where they are and the page, fenced", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }, { do: "answer" }], say: [{ pieces: ["[talk] Twelve dollars a month."] }, { pieces: ["[talk] A hundred and twenty."] }] });
    await turn(w, m, { words: "how much is pro", app: "Chrome", title: "Pricing", url: "https://acme.example/pricing", page: { outline: ["Free", "Pro"], text: "Pro costs $12 a month or $120 a year." } });
    await turn(w, m, { words: "and for a year?", turn: 1, app: "Chrome" });
    const [one, two] = m.of("talk.reply");
    expect(one!.user).toContain("<where>\nApp: Chrome\nWindow: Pricing\nAddress: https://acme.example/pricing\n</where>");
    expect(one!.user).toContain("<page>\nOutline:\n- Free\n- Pro\nText:\nPro costs $12 a month or $120 a year.\n</page>");
    expect(two!.user).toContain("<talk>\n- They said: how much is pro\n  X0 said: Twelve dollars a month.");
    expect(two!.user.indexOf("<talk>")).toBeLessThan(two!.user.indexOf("<said>"));
    expect(one!.user).toContain("<lang>\nEnglish\n</lang>\n<said>");
  });
});

describe("streaming, climbing and saying sorry", () => {
  it("streams whole words as they come", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[ta", "lk] Par", "is is the ca", "pital of Fra", "nce."] }] });
    const r = await turn(w, m, { words: "what's the capital of France" });
    expect(r.text.join("")).toBe("Paris is the capital of France.");
    for (const t of r.text.slice(0, -1)) expect(t).toMatch(/\s$/);
    expect(r.text.length).toBeGreaterThan(1);
  });

  it("a model that fails before any word is replaced one tier up", async () => {
    const w = world();
    const m = model({ decide: [{ do: "chat" }], say: [{ error: new Error("every model for this call failed") }, { pieces: ["[talk] Hello there."] }] });
    const r = await turn(w, m, { words: "hello" });
    expect(m.of("talk.reply").map((s) => s.tier)).toEqual(["cheap", "code"]);
    expect(r.events.at(-1)).toEqual({ t: "done", text: "Hello there." });
    expect(r.out.reasons).toContain("down:cheap");
  });

  it("both tiers down before a word: an error, nothing kept", async () => {
    const w = world();
    const m = model({ decide: [{ do: "chat" }], say: [{ error: new Error("down") }, { error: new Error("down") }] });
    const r = await turn(w, m, { words: "hello" });
    expect(r.events.at(-1)).toMatchObject({ t: "error", code: "model_down" });
    expect(w.sessions.get(ME, "talk_abc123")).toBeNull();
  });

  it("a model that fails after words were said is not replaced mid-sentence: a short apology instead", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[talk] The answer is ", "forty"], then: "fail" }] });
    const r = await turn(w, m, { words: "what is the meaning of life" });
    expect(r.text.join("")).toBe("The answer is Sorry, I lost my train of thought. Ask me again?");
    expect(r.events.filter((e) => e.t === "mood").map((e) => (e as { mood: string }).mood)).toEqual(["talk", "sorry"]);
    expect(r.text.join("")).not.toContain("different voice");
    expect(m.of("talk.reply")).toHaveLength(1);
    expect(r.events.at(-1)).toMatchObject({ t: "done", text: "The answer is Sorry, I lost my train of thought. Ask me again?" });
  });

  it("a failed try before any word was said is voided, and the next model's words are the answer", async () => {
    const w = world();
    // The first model writes only its mood tag (nothing said), then fails: the gateway resets and the next one answers.
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[laugh]"], then: "fail" }] });
    const r = await turn(w, m, { words: "what is the meaning of life" });
    expect(r.text.join("")).toBe("A different voice.");
  });

  it("the person's stop ends the turn with what was said so far", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[talk] Well, there are three ", "reasons. First"], then: "hang" }] });
    const f = flight(ME, "talk_abc123");
    const p = turn(w, m, { words: "why do cats purr" }, { signal: f.signal });
    await flush();
    expect(stopTalk(ME, "talk_abc123")).toBe(true);
    const r = await p;
    f.end();
    expect(r.events.at(-1)).toEqual({ t: "done", text: "Well, there are three reasons." });
    expect(r.out.ending).toBe("stopped");
    expect(stopTalk(ME, "talk_abc123")).toBe(false);
    expect(stopTalk("u2", "talk_abc123")).toBe(false);
  });

  it("a new turn of the same talk stops the one before", () => {
    const a = flight(ME, "talk_abc123");
    const b = flight(ME, "talk_abc123");
    expect(a.signal.aborted).toBe(true);
    expect(a.stopped).toBe(true);
    expect(b.signal.aborted).toBe(false);
    b.end();
  });

  it("says nothing that looks like a secret", async () => {
    const w = world();
    const key = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[talk] Your token is ", `${key} and `, "more."] }] });
    const r = await turn(w, m, { words: "what is my github token" });
    expect(r.text.join("")).not.toContain("ghp_");
    expect(r.out.reasons).toContain("guard");
  });
});

describe("privacy: the gates keep nothing and ask no model", () => {
  it("a password field and X0 Bot's own window are typed; a sensitive app with no text box is refused", async () => {
    const w = world();
    const m = model({ decide: [{ do: "chat" }] });
    const pw = await turn(w, m, { words: "hunter2", field: { private: true } });
    expect(pw.events).toEqual([
      { t: "route", kind: "write", depth: "quick", lang: "und-Latn" },
      { t: "handoff", to: "write", goal: "hunter2", trusted: true },
      { t: "done", text: "" },
    ]);
    const ours = await turn(w, m, { words: "what is this", ours: true });
    expect(ours.events.find((e) => e.t === "handoff")).toMatchObject({ to: "write" });
    const bank = await turn(w, m, { words: "what's my balance", app: "HDFC Bank" });
    expect(bank.events.slice(1)).toEqual([{ t: "mood", mood: "nope" }, { t: "error", code: "private", message: expect.any(String) }]);
    const bankBox = await turn(w, m, { words: "pay rent", app: "HDFC Bank", field: {} });
    expect(bankBox.events.find((e) => e.t === "handoff")).toMatchObject({ to: "write" });
    await flush();
    expect(m.seen).toHaveLength(0);
    expect(w.sessions.get(ME, "talk_abc123")).toBeNull();
    expect(await w.store.get(ME)).toBeNull();
  });

  it("an answer is kept in the talk and in the person's context; a secret is not", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }, { do: "answer" }], say: [{ pieces: ["[talk] It's sunny."] }, { pieces: ["[talk] Done."] }] });
    await turn(w, m, { words: "how's the weather" });
    await flush();
    expect(w.sessions.get(ME, "talk_abc123")!.turns).toHaveLength(1);
    const k = (await w.store.get(ME))!;
    expect(k.turns.map((t) => [t.said, t.result])).toEqual([["how's the weather", "It's sunny."]]);
    await turn(w, m, { words: "my password is hunter2, remember it", turn: 1 });
    await flush();
    expect(w.sessions.get(ME, "talk_abc123")!.turns).toHaveLength(1);
    expect((await w.store.get(ME))!.turns).toHaveLength(1);
  });

  it("a private (incognito) window is answered like any other, with its page; the talk holds it for follow-ups, the context keeps nothing", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }, { do: "send", to: "Riya" }], say: [{ pieces: ["[talk] Three flights, the cheapest is 4,200."] }] });
    const r = await turn(w, m, { words: "which flight is cheapest", app: "Chrome", title: "Flights - Incognito", privateWindow: true, page: { text: "Flight A 4,200. Flight B 5,100." } });
    expect(r.events.at(-1)).toMatchObject({ t: "done", text: "Three flights, the cheapest is 4,200." });
    expect(m.of("talk.reply")[0]!.user).toContain("Flight A 4,200");
    // A handoff from one is not kept either.
    const send = await turn(w, m, { words: "send the cheapest one to Riya", app: "Chrome", privateWindow: true, turn: 1 });
    expect(send.events.find((e) => e.t === "handoff")).toBeTruthy();
    await flush();
    // The talk's own memory (in memory, gone with the talk) has it, so "send that to Riya" works; the person's context does not.
    expect(w.sessions.get(ME, "talk_abc123")).not.toBeNull();
    expect(await w.store.get(ME)).toBeNull();
  });

  it("the talk route takes privateWindow off the body", () => {
    expect(readTalkBody({ talkId: "talk_abc123", turn: 0, words: "hi", privateWindow: true })).toMatchObject({ privateWindow: true });
    expect(readTalkBody({ talkId: "talk_abc123", turn: 0, words: "hi", privateWindow: "yes" })).not.toHaveProperty("privateWindow");
  });

  it("with the setup card's read off, the page and the selection are not used", async () => {
    const w = world();
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[talk] I can't see it."] }] });
    await turn(w, m, { words: "what does this page say", field: { selection: "secret plans" }, page: { text: "The whole page." }, grants: { read: "off" } });
    expect(m.of("talk.reply")[0]!.user).not.toContain("<page>");
    expect(m.of("talk.reply")[0]!.user).not.toContain("secret plans");
  });
});

describe("lookups and money", () => {
  it("an answer that needs fresh facts looks them up first, read-only, and rests on what it found", async () => {
    const w = world();
    const m = model({
      decide: [{ do: "answer", web: true }],
      look: [[{ id: "c1", name: "weather", arguments: '{"place":"Pune"}' }, { id: "c2", name: "web_search", arguments: '{"query":"pune rain"}' }]],
      say: [{ pieces: ["[talk] Light rain in Pune tomorrow, 24 degrees."] }],
    });
    const ran: string[] = [];
    const look = () => ({
      defs: [{ name: "web_search", description: "", parameters: {} }, { name: "weather", description: "", parameters: {} }],
      run: async (c: ToolCall) => { ran.push(c.name); return { content: c.name === "weather" ? "Pune: light rain, 24°C" : "1. Pune weather https://weather.example/pune", ok: true }; },
    });
    const r = await turn(w, m, { words: "will it rain in Pune tomorrow" }, { look });
    expect(ran.sort()).toEqual(["weather", "web_search"]);
    const lk = m.of("talk.look")[0]!;
    expect(lk.tools).toEqual(["web_search", "weather"]);
    expect(lk.tier).toBe("cheap");
    const reply = m.of("talk.reply")[0]!;
    expect(reply.user).toContain("<found_now>\nweather:\nPune: light rain, 24°C");
    expect(r.events.at(-1)).toMatchObject({ t: "done", found: { links: ["https://weather.example/pune"] } });
    expect(r.out.reasons).toEqual(expect.arrayContaining(["look:weather", "look:web_search"]));
  });

  it("nothing left of the day: no model answers", async () => {
    const w = world();
    w.daily.add(ME, 5_000);
    const m = model({ decide: [{ do: "chat" }], say: [{ pieces: ["[talk] hi"] }] });
    const r = await turn(w, m, { words: "hello there" });
    expect(r.events.at(-1)).toMatchObject({ t: "error", code: "budget" });
    expect(m.seen).toHaveLength(0);
  });

  it("charges the day what the turn cost", async () => {
    const w = world();
    const m = model({ decide: [{ do: "chat" }], say: [{ pieces: ["[talk] Hi!"] }] });
    const r = await turn(w, m, { words: "hello there" });
    expect(r.out.paise).toBe(2);
    expect(w.daily.usedPaise(ME)).toBe(2);
  });
});

describe("POST /v1/talk: the NDJSON contract", () => {
  const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
  const app = (m: ReturnType<typeof model>) => {
    const a = Fastify();
    registerTalkRoutes(a, { rateLimit: RL, bots: null, context: null, call: m.call, look: null, sessions: new TalkSessions() });
    return a;
  };

  it("streams one JSON event a line: route first, done last", async () => {
    const m = model({ decide: [{ do: "chat" }], say: [{ pieces: ["[laugh] Knock knock. ", "Who's there?"] }] });
    const r = await app(m).inject({ method: "POST", url: "/v1/talk", headers: { authorization: "Bearer u1" }, payload: { talkId: "talk_abc123", turn: 0, words: "tell me a joke", tz: 330, field: null } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^application\/x-ndjson/);
    const lines = r.body.trim().split("\n").map((l) => JSON.parse(l) as TalkEvent);
    expect(lines[0]).toEqual({ t: "route", kind: "chat", depth: "quick", lang: "en" });
    expect(lines[1]).toEqual({ t: "mood", mood: "laugh" });
    expect(lines.slice(2, -1).every((e) => e.t === "text")).toBe(true);
    expect(lines.at(-1)).toEqual({ t: "done", text: "Knock knock. Who's there?" });
    for (const e of lines) expect(["route", "mood", "text", "handoff", "done", "error"]).toContain(e.t);
  });

  it("refuses a body without talkId, turn or words, and a stranger", async () => {
    const m = model({});
    const a = app(m);
    const post = (payload: Record<string, unknown>, auth = "Bearer u1") => a.inject({ method: "POST", url: "/v1/talk", headers: { authorization: auth }, payload });
    expect((await post({ talkId: "talk_abc123", turn: 0, words: "hi" }, "")).statusCode).toBe(401);
    expect((await post({ turn: 0, words: "hi" })).statusCode).toBe(400);
    expect((await post({ talkId: "x", turn: 0, words: "hi" })).statusCode).toBe(400);
    expect((await post({ talkId: "talk_abc123", turn: -1, words: "hi" })).statusCode).toBe(400);
    expect((await post({ talkId: "talk_abc123", turn: 0, words: "  " })).statusCode).toBe(400);
    const stop = (payload: Record<string, unknown>, auth = "Bearer u1") => a.inject({ method: "POST", url: "/v1/talk/stop", headers: { authorization: auth }, payload });
    expect((await stop({ talkId: "talk_abc123" })).json()).toEqual({ stopped: false });
    expect((await stop({})).statusCode).toBe(400);
    expect((await stop({ talkId: "talk_abc123" }, "")).statusCode).toBe(401);
  });

  it("a stop from the same person ends the stream with done", async () => {
    const m = model({ decide: [{ do: "answer" }], say: [{ pieces: ["[talk] Let me tell you ", "a long story"], then: "hang" }] });
    const a = app(m);
    const p = a.inject({ method: "POST", url: "/v1/talk", headers: { authorization: "Bearer u1" }, payload: { talkId: "talk_stop01", turn: 0, words: "tell me a long story", field: null } });
    for (let i = 0; i < 50 && m.of("talk.reply").length === 0; i += 1) await flush();
    await flush();
    expect((await a.inject({ method: "POST", url: "/v1/talk/stop", headers: { authorization: "Bearer u2" }, payload: { talkId: "talk_stop01" } })).json()).toEqual({ stopped: false });
    expect((await a.inject({ method: "POST", url: "/v1/talk/stop", headers: { authorization: "Bearer u1" }, payload: { talkId: "talk_stop01" } })).json()).toEqual({ stopped: true });
    const r = await p;
    const lines = r.body.trim().split("\n").map((l) => JSON.parse(l) as TalkEvent);
    expect(lines.at(-1)).toEqual({ t: "done", text: "Let me tell you a long" });
  });
});
