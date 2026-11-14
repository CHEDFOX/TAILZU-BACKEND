/**
 * REPLYING TO A BOT FROM ITS NOTIFICATION (src/bots/notifyReply.ts, routes/bots/botsNotifyReply.ts; docs/widgets.md §5).
 *
 *   - the category is in the bootstrap's push.categories while NOTIFY_REPLY is on, and passes the phone's own cleanCategories rules
 *   - a bot's push carries the category, its data and its conversation only while the switch is on
 *   - the route: another person's bot, nothing typed, too much typed, too many in an hour
 *   - one press, one reply: the same key again is the first answer, not a second model run
 *   - no AI permission: no model is asked, and a push says to open X0
 *   - the bot's answer comes back as a push on the same conversation
 *   - the switch off: 404 and no category anywhere
 *   - THE FIRST PUSH: a routine's answer, and a bot's own note, start the conversation — `bot_ask`, with the answer kept in the
 *     bot's chat; with the switch off a routine pushes `routine_done` exactly as it did before; a muted bot sends nothing
 *
 * The model is never asked: the bot's chat is a fake throughout.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const A_ = "11111111-1111-4111-8111-111111111111"; // Aanya
const B_ = "22222222-2222-4222-8222-222222222222"; // somebody else
const EMAIL: Record<string, string> = { [A_]: "aanya@example.in", [B_]: "other@example.in" };

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id && EMAIL[id] ? { id, email: EMAIL[id], emailConfirmed: true } : null; } };
});

/** What the route pushes. The real push/index.ts needs an engine and Supabase; this is the one seam it uses. */
const pushes: Array<{ userId: string; kind: string; p: Record<string, unknown>; key: string }> = [];
vi.mock("../src/push/index.js", () => ({
  notifyBot: async (userId: string, kind: string, p: Record<string, unknown>, key: string) => { pushes.push({ userId, kind, p, key }); },
  pushEngine: () => null,
}));

const notifyReply = await import("../src/bots/notifyReply.js");
const { BOT_REPLY_CATEGORIES, BOT_REPLY_CATEGORY, NotifyReplies, NotifyReplyError, REPLY_MAX, askMessage, lineOf, notifyReplyOn, resetNotifyReplyForTests, threadIdOf } = notifyReply;
const { registerNotifyReplyRoutes } = await import("../src/routes/bots/botsNotifyReply.js");
const { withAppKnobs } = await import("../src/experience/appKnobs.js");
const { resetConfigForTests } = await import("../src/config.js");
const { verdict } = await import("../src/you/push.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
// The first push's two senders: a routine's answer, and a bot's own note into a chat.
const { Routines, MemoryRoutineStore } = await import("../src/routines/index.js");
const { BotChat } = await import("../src/botsBots/chat.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { setPushGate } = await import("../src/push/engine.js");

const RL = { rateLimit: { max: 10_000, timeWindow: 60_000 } };

/** NOTIFY_REPLY and its friends, for one block of tests. */
function switches(o: { on: boolean; users?: string; perHour?: number }): void {
  process.env.NOTIFY_REPLY = o.on ? "true" : "false";
  process.env.NOTIFY_REPLY_USERS = o.users ?? "";
  process.env.NOTIFY_REPLY_PER_HOUR = String(o.perHour ?? 20);
  resetConfigForTests();
}

// ------------------------------------------------------------------ the phone's own rules, mirrored

/**
 * cleanCategories, as the phone has it (F:app/src/notifications/categoriesCore.ts): a category id of letters, digits and _, at most
 * 40; a button id [a-z0-9_] at most 24, unique across every category; at most 4 buttons; and a `call` to a /v1/ path with nothing in
 * it that could leave the API. A category whose every button is dropped is not registered at all, so a bad one is simply invisible.
 */
const CAT_ID = /^[A-Za-z0-9_]{1,40}$/;
const BUTTON_ID = /^[a-z0-9_]{1,24}$/;
const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
// eslint-disable-next-line no-control-regex
const apiPath = (p: unknown): boolean => typeof p === "string" && p.startsWith("/v1/") && !/[\\@\s\u0000-\u001f\u007f]|\/\/|\/\.\.?(\/|$)/.test(p);

/** What the phone would keep of one category: null when it would register nothing. */
function phoneWouldKeep(c: Record<string, any>, seenButtons: Set<string>): { id: string; buttons: string[] } | null {
  if (typeof c?.id !== "string" || !CAT_ID.test(c.id)) return null;
  const kept: string[] = [];
  for (const a of (Array.isArray(c.actions) ? c.actions : []).slice(0, 4)) {
    if (typeof a?.id !== "string" || !BUTTON_ID.test(a.id) || seenButtons.has(a.id)) continue;
    if (typeof a.title !== "string" || !a.title.trim()) continue;
    const ok = (typeof a.act === "string" && BUTTON_ID.test(a.act)) || a.open === true
      || (a.call && typeof a.call.method === "string" && METHODS.has(String(a.call.method).toUpperCase()) && apiPath(a.call.path));
    if (!ok) continue;
    kept.push(a.id);
    seenButtons.add(a.id);
  }
  return kept.length ? { id: c.id, buttons: kept } : null;
}

/** The templates the phone can fill: "{data.<field>}" and "{text}", nothing else (fillTemplate). */
const TEMPLATE = /\{(data\.[A-Za-z0-9_]+|text)\}/g;
const templatesIn = (v: unknown): string[] => {
  if (typeof v === "string") return [...v.matchAll(TEMPLATE)].map((m) => m[0]!);
  if (Array.isArray(v)) return v.flatMap(templatesIn);
  if (v && typeof v === "object") return Object.values(v).flatMap(templatesIn);
  return [];
};
/** Anything in braces at all, so a template the phone could NOT fill is caught rather than sent as literal text. */
const bracedIn = (v: unknown): string[] => {
  if (typeof v === "string") return [...v.matchAll(/\{[^}]*\}/g)].map((m) => m[0]!);
  if (Array.isArray(v)) return v.flatMap(bracedIn);
  if (v && typeof v === "object") return Object.values(v).flatMap(bracedIn);
  return [];
};

// ------------------------------------------------------------------ the fake bot and its chat

const BOTS: Record<string, Array<{ slug: string; name: string; ownerId: string | null }>> = {
  [A_]: [{ slug: "plan", name: "Plan Ease", ownerId: null }, { slug: "nani", name: "Nani", ownerId: A_ }],
  [B_]: [{ slug: "plan", name: "Plan Ease", ownerId: null }],
};

function fakes() {
  const said: Array<{ userId: string; slug: string; text: string }> = [];
  const bots = {
    resolve: async (userId: string, ref: string) => {
      const def = (BOTS[userId] ?? []).find((b) => b.slug === ref);
      return def ? { def: { ...def, id: def.slug }, stored: null } : null;
    },
  };
  const chat = {
    send: async (userId: string, slug: string, text: string) => {
      said.push({ userId, slug, text });
      return { answer: { text: `heard: ${text}` }, turns: [] };
    },
  };
  return { said, bots, chat };
}

async function server(o: { aiOk?: boolean } = {}) {
  const { said, bots, chat } = fakes();
  const app = Fastify();
  registerNotifyReplyRoutes(app, { rateLimit: RL, bots: bots as never, chat: chat as never });
  // The AI permission check the route's service uses; the real one is privacy/aiGate.ts.
  if (o.aiOk === false) {
    const { installAiCheck } = await import("../src/privacy/aiGate.js");
    installAiCheck(async () => false);
  }
  await app.ready();
  return { app, said };
}

const post = (app: any, who: string, slug: string, body: unknown) =>
  app.inject({ method: "POST", url: `/v1/bots/${slug}/notify-reply`, headers: { authorization: `Bearer ${who}` }, payload: body });

beforeEach(async () => {
  pushes.length = 0;
  resetNotifyReplyForTests();
  const { installAiCheck } = await import("../src/privacy/aiGate.js");
  installAiCheck(null);
  switches({ on: true });
});

// ------------------------------------------------------------------

describe("the category", () => {
  it("is in the bootstrap's push.categories while the switch is on, and passes the phone's rules", () => {
    switches({ on: true });
    const boot = withAppKnobs({ labels: {}, flags: {} } as never, { userId: A_ }) as { flags: Record<string, any> };
    const cats = boot.flags["push.categories"] as Array<Record<string, any>>;
    const ours = cats.find((c) => c.id === BOT_REPLY_CATEGORY);
    expect(ours).toBeTruthy();
    // Every category the server lists survives the phone's own cleaning, ours among them, and no two share a button id.
    const seen = new Set<string>();
    const kept = cats.map((c) => phoneWouldKeep(c, seen));
    expect(kept.filter((k) => k === null)).toEqual([]);
    expect(kept.find((k) => k!.id === BOT_REPLY_CATEGORY)!.buttons).toEqual(["b_reply"]);
  });

  it("asks for a typing box and calls a /v1/ path with only templates the phone can fill", () => {
    const [cat] = BOT_REPLY_CATEGORIES;
    const [a] = cat!.actions;
    expect(a!.input).toEqual({ placeholder: "Reply…", send: "Send" });
    // Not a foreground button: the whole point is answering without the app.
    expect(a!.foreground).toBe(false);
    expect(a!.call.method).toBe("POST");
    expect(apiPath(a!.call.path.replace("{data.slug}", "nani"))).toBe(true);
    expect(templatesIn(a!.call)).toEqual(expect.arrayContaining(["{data.slug}", "{text}", "{data.thread}", "{data.pushId}"]));
    // Nothing in braces that fillTemplate would not fill (a "{{slug}}" would be sent as those characters).
    expect(bracedIn(a!.call).sort()).toEqual(templatesIn(a!.call).sort());
  });

  it("is listed for nobody while the switch is off, and only for the named accounts while it names any", () => {
    switches({ on: false });
    const off = withAppKnobs({ labels: {}, flags: {} } as never, { userId: A_ }) as { flags: Record<string, any> };
    expect((off.flags["push.categories"] as Array<{ id: string }>).some((c) => c.id === BOT_REPLY_CATEGORY)).toBe(false);
    switches({ on: true, users: A_ });
    const mine = withAppKnobs({ labels: {}, flags: {} } as never, { userId: A_ }) as { flags: Record<string, any> };
    const theirs = withAppKnobs({ labels: {}, flags: {} } as never, { userId: B_ }) as { flags: Record<string, any> };
    expect((mine.flags["push.categories"] as Array<{ id: string }>).some((c) => c.id === BOT_REPLY_CATEGORY)).toBe(true);
    expect((theirs.flags["push.categories"] as Array<{ id: string }>).some((c) => c.id === BOT_REPLY_CATEGORY)).toBe(false);
    expect(notifyReplyOn(B_)).toBe(false);
  });
});

describe("a bot's push", () => {
  it("carries the category, the data and the conversation only while the switch is on", () => {
    switches({ on: true });
    const on = askMessage(A_, "bot_ask", { slug: "nani", name: "Nani", line: "Shall I book it?" }, "k1");
    expect(on.category).toBe(BOT_REPLY_CATEGORY);
    expect(on.data).toEqual({ slug: "nani", thread: "nani" });
    expect(on.collapseId).toBe(threadIdOf("nani"));
    expect(on.vars).toEqual({ bot: "Nani", line: "Shall I book it?" });
    switches({ on: false });
    const off = askMessage(A_, "bot_ask", { slug: "nani", name: "Nani", line: "Shall I book it?" }, "k1");
    expect(off.category).toBeUndefined();
    expect(off.collapseId).toBeUndefined();
    // The push still goes, with the data the screen needs; it simply has no buttons, as a bot's push had none before.
    expect(off.data).toEqual({ slug: "nani", thread: "nani" });
  });

  it("never puts a private bot's words on the lock screen", () => {
    expect(lineOf({ slug: "nani", name: "Nani", line: "The scan came back clear." })).toBe("The scan came back clear.");
    expect(lineOf({ slug: "nani", name: "Nani", line: "The scan came back clear.", private: true })).toBe("Sent you a message.");
  });

  it("reaches the engine with its category on the message", async () => {
    const { PushEngine } = await import("../src/push/engine.js");
    const { MemoryPushStore } = await import("../src/push/store.js");
    const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
    const store = new MemoryPushStore();
    store.candidatesList = [{ userId: A_, tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: 0 }], lastSeenAt: null, createdAt: 0, locale: null, entitled: false, tzOffsetMin: 0 }];
    const sent: Array<Record<string, any>> = [];
    const sender = { send: async (m: Array<Record<string, any>>) => { sent.push(...m); return m.map(() => ({ status: "ok" as const, id: "t" })); }, receipts: async () => ({}) };
    const engine = new PushEngine(store, sender, () => structuredClone(PUSH_DEFAULTS), { info: () => {}, warn: () => {} });
    switches({ on: true });
    await engine.notify(A_, askMessage(A_, "bot_ask", { slug: "nani", name: "Nani", line: "Shall I book it?" }, "k1"));
    expect(sent[0]!.categoryId).toBe(BOT_REPLY_CATEGORY);
    expect(sent[0]!.title).toBe("Nani");
    expect(sent[0]!.body).toBe("Shall I book it?");
    expect(sent[0]!.data).toMatchObject({ slug: "nani", thread: "nani", screenId: "bots.chat" });
  });

  it("stays muted when the person turned that bot off, and loses its sound in quiet hours", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.notify.quiet = true; s.notify.quietFrom = 23 * 60; s.notify.quietTo = 7 * 60;
    expect(verdict(s, "bot_ask", 12 * 60, "nani")).toBe("send");
    expect(verdict(s, "bot_reply", 2 * 60, "nani")).toBe("silent");
    s.notify.botsOff = ["nani"];
    expect(verdict(s, "bot_ask", 12 * 60, "nani")).toBe("drop");
    expect(verdict(s, "bot_ask", 12 * 60, "plan")).toBe("send");
  });
});

describe("the route", () => {
  it("feeds the typed words into the bot's chat and pushes the answer back on the same conversation", async () => {
    const { app, said } = await server();
    const r = await post(app, A_, "nani", { text: "  yes please  ", key: "p-abcdefgh:b_reply", thread: "nani" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, state: "sent" });
    expect(said).toEqual([{ userId: A_, slug: "nani", text: "yes please" }]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ userId: A_, kind: "bot_reply", p: { slug: "nani", name: "Nani", line: "heard: yes please", thread: "nani", private: true } });
  });

  it("is a 404 for another person's bot, never a 403", async () => {
    const { app, said } = await server();
    const r = await post(app, B_, "nani", { text: "hello", key: "p-abcdefgh:b_reply" });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("not_found");
    expect(said).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it("refuses nothing typed and more than the box holds", async () => {
    const { app, said } = await server();
    expect((await post(app, A_, "nani", { text: "   ", key: "p-abcdefgh:b_reply" })).statusCode).toBe(400);
    expect((await post(app, A_, "nani", { text: "x".repeat(REPLY_MAX + 1), key: "p-abcdefgh:b_reply" })).statusCode).toBe(413);
    expect(said).toEqual([]);
  });

  it("stops a flood: over the hour's count it is 429, and nothing is asked of the model", async () => {
    switches({ on: true, perHour: 2 });
    const { app, said } = await server();
    expect((await post(app, A_, "nani", { text: "one", key: "p-aaaaaaaa:b_reply" })).statusCode).toBe(200);
    expect((await post(app, A_, "nani", { text: "two", key: "p-bbbbbbbb:b_reply" })).statusCode).toBe(200);
    const third = await post(app, A_, "nani", { text: "three", key: "p-cccccccc:b_reply" });
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe("too_many");
    expect(said).toHaveLength(2);
  });

  it("answers a retried press once: the same key is the first reply, not a second run", async () => {
    const { app, said } = await server();
    const body = { text: "same words", key: "p-abcdefgh:b_reply", thread: "nani" };
    const a = await post(app, A_, "nani", body);
    const b = await post(app, A_, "nani", body);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(said).toHaveLength(1);
    expect(pushes).toHaveLength(1);
  });

  it("asks no model before the person has agreed to AI, and says to open X0", async () => {
    const { app, said } = await server({ aiOk: false });
    const r = await post(app, A_, "nani", { text: "go on", key: "p-abcdefgh:b_reply" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, state: "open" });
    expect(said).toEqual([]);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.p).toMatchObject({ slug: "nani", line: "Open X0 to continue." });
  });
});

describe("the switch off", () => {
  it("is a 404 before anything, and no push carries the category", async () => {
    switches({ on: false });
    const { app, said } = await server();
    const r = await post(app, A_, "nani", { text: "hello", key: "p-abcdefgh:b_reply" });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("notify_reply_off");
    expect(said).toEqual([]);
    expect(askMessage(A_, "bot_ask", { slug: "nani", name: "Nani", line: "hi" }, "k").category).toBeUndefined();
  });

  it("is a 404 for a person the list does not name", async () => {
    switches({ on: true, users: B_ });
    const { app } = await server();
    const r = await post(app, A_, "nani", { text: "hello", key: "p-abcdefgh:b_reply" });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("notify_reply_off");
  });
});

describe("the press's own rules", () => {
  it("keeps a key the phone sends and makes one when there is none", () => {
    expect(NotifyReplies.keyOf("p-abcdefgh:b_reply", "fresh")).toBe("p-abcdefgh:b_reply");
    expect(NotifyReplies.keyOf("short", "fresh")).toBe("fresh");
    expect(NotifyReplies.keyOf(undefined, "fresh")).toBe("fresh");
    expect(NotifyReplies.keyOf("p-ab/cd efgh!!", "fresh")).toBe("p-abcdefgh");
  });

  it("trims and caps what was typed", () => {
    expect(NotifyReplies.textOf("  hi  ")).toBe("hi");
    expect(() => NotifyReplies.textOf("")).toThrow(NotifyReplyError);
    expect(() => NotifyReplies.textOf("x".repeat(REPLY_MAX + 1))).toThrow(NotifyReplyError);
  });
});

describe("review fixes", () => {
  it("lets an account NOTIFY_REPLY_USERS names through the route (the list is read after the session, not before)", async () => {
    switches({ on: true, users: A_ });
    const { app, said } = await server();
    const r = await post(app, A_, "nani", { text: "yes", key: "p-abcdefgh:b_reply" });
    expect(r.statusCode).toBe(200);
    expect(said).toHaveLength(1);
    expect((await post(app, B_, "plan", { text: "yes", key: "p-abcdefgh:b_reply" })).json().code).toBe("notify_reply_off");
  });

  /** A route whose chat is this one and nothing else: for the answers a refusal from the chat turns into. */
  async function routeWith(chat: unknown, extra: Record<string, unknown> = {}) {
    const app = Fastify();
    const { bots } = fakes();
    registerNotifyReplyRoutes(app, { rateLimit: RL, bots: bots as never, chat: chat as never, ...extra });
    await app.ready();
    return app;
  }

  it("keeps every one of the bot's own refusals, instead of a 500 the phone would retry for a day", async () => {
    const { BotError } = await import("../src/bots/index.js");
    // The three the app's chat answers with its own status: a bot's day budget, Xode's own page, an account on its way out.
    const refusals = [
      ["bot_daily_limit", "Nani has used its budget for today.", 429],
      ["code_bot", "Xode answers on its own page.", 409],
      ["account_closing", "This account is being deleted.", 403],
    ] as const;
    for (const [code, message, status] of refusals) {
      const app = await routeWith({ send: async () => { throw new BotError(code, message, status); } });
      const r = await post(app, A_, "nani", { text: "yes", key: `p-abcdefgh:${code}` });
      expect([r.statusCode, r.json().code, r.json().message]).toEqual([status, code, message]);
    }
  });

  it("asks the phone to come back later when the guard is full, with the wait it named", async () => {
    const { Overloaded } = await import("../src/guard/index.js");
    const app = await routeWith({ send: async () => { throw new Overloaded("queue_full", 3, 7); } });
    const r = await post(app, A_, "nani", { text: "yes", key: "p-abcdefgh:busy" });
    expect(r.statusCode).toBe(429);
    expect(r.headers["retry-after"]).toBe("7");
    expect(r.json().code).toBe("overloaded");
  });

  it("answers the AI gate's own no with its 403, not a 500", async () => {
    const { AiConsentNeeded, AI_CONSENT_CODE } = await import("../src/privacy/aiGate.js");
    const app = await routeWith({ send: async () => { throw new AiConsentNeeded(); } });
    const r = await post(app, A_, "nani", { text: "yes", key: "p-abcdefgh:consent" });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe(AI_CONSENT_CODE);
  });

  it("runs the reply under a permit of the guard's, as the app's chat does", async () => {
    const { defaultGuard } = await import("../src/guard/index.js");
    const before = defaultGuard().limiter.stats().active;
    let held = -1;
    const app = await routeWith({
      // While the bot is answering, this reply is holding one of the limits' permits.
      send: async () => { held = defaultGuard().limiter.stats().active; return { answer: { text: "ok", paise: 1 }, turns: [] }; },
    });
    expect((await post(app, A_, "nani", { text: "yes", key: "p-abcdefgh:permit" })).statusCode).toBe(200);
    expect(held).toBe(before + 1);
    expect(defaultGuard().limiter.stats().active).toBe(before);
  });

  it("puts no Reply box on the push that says to open X0", async () => {
    const { app } = await server({ aiOk: false });
    await post(app, A_, "nani", { text: "go on", key: "p-abcdefgh:b_reply" });
    const p = pushes[0]!;
    const m = askMessage(A_, p.kind as never, p.p as never, p.key);
    expect(m.category).toBeUndefined();
    expect(m.collapseId).toBeUndefined();
  });

  it("answers a second, different reply on the same push, and still runs a retried one once", async () => {
    const { app, said } = await server();
    await post(app, A_, "nani", { text: "book the 9am", key: "p-abcdefgh" });
    await post(app, A_, "nani", { text: "book the 9am", key: "p-abcdefgh" });
    await post(app, A_, "nani", { text: "actually cancel it", key: "p-abcdefgh" });
    expect(said.map((s) => s.text)).toEqual(["book the 9am", "actually cancel it"]);
  });

  it("gives the bot's answer an identifier of its own, so the phone's dismissal of the answered notification never takes it", () => {
    switches({ on: true });
    expect(askMessage(A_, "bot_ask", { slug: "nani", name: "Nani", line: "hi" }, "k").collapseId).toBe(threadIdOf("nani"));
    const answer = askMessage(A_, "bot_reply", { slug: "nani", name: "Nani", line: "hi" }, "k");
    expect(answer.category).toBe(BOT_REPLY_CATEGORY);
    expect(answer.collapseId).toBeUndefined();
  });

  it("goes through the app's chat door: what the spaces shared, and the answer written down for Activity", async () => {
    const { MemoryEventStore } = await import("../src/shell/events.js");
    const events = new MemoryEventStore();
    const seen: unknown[] = [];
    const { bots } = fakes();
    const chat = { send: async (_u: string, _s: string, t: string, _sig: unknown, shared: unknown) => { seen.push(shared); return { answer: { text: `heard: ${t}`, paise: 7 }, turns: [] }; } };
    const app = Fastify();
    registerNotifyReplyRoutes(app, {
      rateLimit: RL, bots: bots as never, chat: chat as never, events,
      shared: async () => [{ name: "Trip", kind: "note", text: "Goa, 3 nights" }],
    });
    await app.ready();
    expect((await post(app, A_, "nani", { text: "yes", key: "p-abcdefgh" })).statusCode).toBe(200);
    expect(seen).toEqual([[{ name: "Trip", kind: "note", text: "Goa, 3 nights" }]]);
    const rows = await events.list(A_, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "ask", bot: "nani", title: "yes", paise: 7 });
  });
});

// ------------------------------------------------------------------ the first push

/**
 * WHAT STARTS THE CONVERSATION (src/routines/service.ts `told`, botsBots/chat.ts `note`). Both go through the push the server
 * wires them to (`server.ts`: notifyBot with `bot_ask`), which is the mock above, so what the phone would get is read back with
 * askMessage, exactly as the route's own tests do.
 */
describe("the first push", () => {
  const AT = Date.parse("2026-11-14T08:00:00+05:30");
  const EVERY_DAY = { every: "day" as const, minute: 8 * 60 };
  /** A bot as the platform hands it over: "nani" is Aanya's own (private), "plan" is a built-in (ownerId null). */
  const defOf = (slug: string, name: string, ownerId: string | null) => ({
    id: slug, ownerId, slug, name, colour: "sea", purpose: "", principles: [],
    skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
    knowledge: [], tone: "", visibility: "private", budgets: { perRequestPaise: 150, dailyPaise: 800 },
  });

  /** A routine of Aanya's on one bot, with the answer kept in a real chat over a memory table, wired as server.ts wires it. */
  async function routine(o: { slug?: string; name?: string; owner?: string | null; answer?: string; approvals?: unknown[] } = {}) {
    const slug = o.slug ?? "nani";
    const def = defOf(slug, o.name ?? "Nani", o.owner === undefined ? A_ : o.owner);
    const bots = {
      ask: async () => ({ bot: { slug, name: def.name, colour: "sea", builtin: false }, text: o.answer ?? "3 emails matter: the bank and the landlord.", paise: 12, tools: [], approvals: o.approvals ?? [], artifacts: [], opens: [], notes: [], ms: 5 }),
      resolve: async (_u: string, ref: string) => (ref === slug ? { def } : null),
      target: async () => ({ kind: "bot" as const, bot: def }),
      list: async () => [{ slug, name: def.name, builtin: false }],
    };
    const { notifyBot } = await import("../src/push/index.js");
    const chat = new BotChat(bots as never, () => AT, new MemoryTable());
    const dones: Array<{ kind: string; key: string; vars: Record<string, string>; data: Record<string, string> }> = [];
    const r = new Routines({
      store: new MemoryRoutineStore(), bots: bots as never, now: () => AT,
      notify: async (_u, msg) => { dones.push(msg); },
      // Wired as server.ts wires it: quiet (the push below is the one that goes), with the run's own card and links on the turn.
      note: async (userId, s, text, extra) => { await chat.note(userId, s, text, { quiet: true, ...(extra ? { extra } : {}) }); },
      askPush: (userId, p, key) => notifyBot(userId, "bot_ask", p as never, key),
    });
    const view = await r.create(A_, { task: "Check my email and tell me what matters", schedule: EVERY_DAY, tz: 330, bot: slug });
    return { r, chat, dones, id: view.id, run: () => r.runNow(A_, view.id) };
  }

  it("sends one bot_ask for a routine's answer while the switch is on, and keeps the answer in that bot's chat", async () => {
    switches({ on: true });
    const w = await routine();
    await w.run();
    // One push, the bot's own, with the words, the conversation and the key of this run.
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      userId: A_, kind: "bot_ask", key: `${w.id}:${AT}`,
      p: { slug: "nani", name: "Nani", line: "3 emails matter: the bank and the landlord.", thread: "nani", private: true, routineId: w.id },
    });
    // What the phone is handed: the category, the Reply button's data, and one notification per bot chat. `routineId` rides along so
    // "What pings you" can still tell a routine's answer from a bot speaking out of the blue (below).
    const m = askMessage(A_, pushes[0]!.kind as never, pushes[0]!.p as never, pushes[0]!.key);
    expect(m.category).toBe(BOT_REPLY_CATEGORY);
    expect(m.data).toEqual({ slug: "nani", thread: "nani", routineId: w.id });
    expect(m.collapseId).toBe(threadIdOf("nani"));
    // Aanya's own bot, so the lock screen says only that there is something to read.
    expect(m.vars).toEqual({ bot: "Nani", line: "Sent you a message." });
    // The answer is a turn in that bot's chat, so a reply typed into the notification has its subject — and it was quiet, so the
    // note itself pushed nothing (one push, above).
    const turns = await w.chat.recent(A_, "nani");
    expect(turns.map((t) => [t.role, t.text])).toEqual([["bot", "3 emails matter: the bank and the landlord."]]);
    // routine_done never went.
    expect(w.dones).toEqual([]);
  });

  it("says a built-in's words on the lock screen, says first that an answer needs a yes, and puts the card on that turn", async () => {
    switches({ on: true });
    const w = await routine({ slug: "plan", name: "Plan Ease", owner: null, answer: "Drafted the reply to Riya.", approvals: [{ taskId: "t1", connector: "gmail", tool: "send", preview: "To Riya" }] });
    await w.run();
    expect(pushes[0]!.p).toMatchObject({ slug: "plan", name: "Plan Ease", line: "It needs your OK. Drafted the reply to Riya.", thread: "plan" });
    expect(pushes[0]!.p.private).toBeUndefined();
    expect(askMessage(A_, "bot_ask", pushes[0]!.p as never, "k").vars.line).toBe("It needs your OK. Drafted the reply to Riya.");
    // The chat turn the push opens carries the run's own confirm card, so the yes is pressed where it works rather than typed as a
    // reply, which could only start a fresh turn and make a second card.
    const turns = await w.chat.recent(A_, "plan");
    expect(turns).toHaveLength(1);
    expect(turns[0]!.approvals).toEqual([{ taskId: "t1", connector: "gmail", preview: "To Riya" }]);
    expect(turns[0]!.paise).toBe(12);
  });

  it("sends routine_done exactly as before while the switch is off, and nothing of the bot's own", async () => {
    switches({ on: false });
    const w = await routine();
    await w.run();
    expect(pushes).toEqual([]);
    expect(w.dones).toEqual([{
      kind: "routine_done", key: `${w.id}:${AT}`,
      vars: { bot: "Nani", task: "Check my email and tell me what matters", line: "3 emails matter: the bank and the landlord." },
      data: { routineId: w.id },
    }]);
    // Off, the answer is on the routine and in Activity, as before: nothing is written into the chat.
    expect(await w.chat.recent(A_, "nani")).toEqual([]);
  });

  /**
   * The hook the server installs, not a copy of it: `botSaidPush` is what `server.ts` passes to `setBotSaidHook`, so what is read
   * back here is what a phone would really get (that is the whole point — a hook written out again in the test would pass whatever
   * the server did).
   */
  async function saidHook(known: Record<string, { name: string; owner: string | null }>) {
    const { notifyBot } = await import("../src/push/index.js");
    const bots = { resolve: async (_u: string, ref: string) => (known[ref] ? { def: defOf(ref, known[ref]!.name, known[ref]!.owner) } : null) };
    notifyReply.setBotSaidHook(notifyReply.botSaidPush(bots as never, notifyBot as never, () => AT));
    return new BotChat(bots as never, () => AT, new MemoryTable());
  }

  it("sends a bot_ask with the category for a note the bot made on its own, and nothing for a quiet one", async () => {
    switches({ on: true });
    const chat = await saidHook({ nani: { name: "Nani", owner: A_ } });
    try {
      await chat.note(A_, "nani", "Shall I book the 9am?");
      await Promise.resolve();
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ userId: A_, kind: "bot_ask", key: `said:nani:${AT}`, p: { slug: "nani", name: "Nani", line: "Shall I book the 9am?", thread: "nani" } });
      // Their own bot, so the words stay off the lock screen.
      expect(pushes[0]!.p.private).toBe(true);
      expect(askMessage(A_, "bot_ask", pushes[0]!.p as never, pushes[0]!.key).category).toBe(BOT_REPLY_CATEGORY);
      // A turn the person is already hearing (a call's opening line) pushes nothing, switch on or not.
      await chat.note(A_, "nani", "I'm on the call now.", { quiet: true });
      await Promise.resolve();
      expect(pushes).toHaveLength(1);
      // And with the switch off, a note of its own pushes nothing either (botSaid asks the switch itself).
      switches({ on: false });
      await chat.note(A_, "nani", "Shall I book the 10am?");
      await Promise.resolve();
      expect(pushes).toHaveLength(1);
    } finally {
      notifyReply.setBotSaidHook(null);
    }
  });

  it("says a built-in's words on the lock screen, and pushes nothing at all for a bot that is not the person's", async () => {
    switches({ on: true });
    const chat = await saidHook({ plan: { name: "Plan Ease", owner: null } });
    try {
      await chat.note(A_, "plan", "Your day is ready.");
      await Promise.resolve();
      expect(pushes).toHaveLength(1);
      // A built-in is nobody's own, so its line is shown.
      expect(pushes[0]!.p.private).toBeUndefined();
      expect(askMessage(A_, "bot_ask", pushes[0]!.p as never, pushes[0]!.key).vars.line).toBe("Your day is ready.");
      // A slug the platform does not hand over (another person's, or one that was deleted) is never pushed about.
      notifyReply.botSaidPush({ resolve: async () => null } as never, (await import("../src/push/index.js")).notifyBot as never)(A_, "someone-elses", "Hello?");
      await Promise.resolve();
      await Promise.resolve();
      expect(pushes).toHaveLength(1);
    } finally {
      notifyReply.setBotSaidHook(null);
    }
  });

  /** The real engine over one phone, with the person's own "What pings you" as the gate: what a phone would really be handed. */
  async function phone(settings: { botsOff?: string[] } = {}) {
    const { PushEngine } = await import("../src/push/engine.js");
    const { MemoryPushStore } = await import("../src/push/store.js");
    const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
    const store = new MemoryPushStore();
    store.candidatesList = [{ userId: A_, tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: 0 }], lastSeenAt: null, createdAt: 0, locale: null, entitled: false, tzOffsetMin: 0 }];
    const sent: Array<Record<string, any>> = [];
    const sender = { send: async (m: Array<Record<string, any>>) => { sent.push(...m); return m.map(() => ({ status: "ok" as const, id: "t" })); }, receipts: async () => ({}) };
    const engine = new PushEngine(store, sender, () => structuredClone(PUSH_DEFAULTS), { info: () => {}, warn: () => {} });
    const s = structuredClone(DEFAULT_SETTINGS);
    s.notify.botsOff = settings.botsOff ?? [];
    setPushGate((p) => verdict(s, p.kind, 12 * 60, p.data?.slug, p.data?.routineId));
    return { engine, sent };
  }

  /**
   * THE SWITCH CHANGES NOTHING IN "WHAT PINGS YOU". A routine's answer always went for a bot the person muted — they asked for it at
   * that time — and it still does now that it comes as a `bot_ask`, because the push says which routine it is (`data.routineId`).
   * Without that, turning the Reply box on would silently drop the answers of every routine on a muted bot.
   */
  it("still delivers a routine's answer for a bot the person muted, as routine_done always did", async () => {
    switches({ on: true });
    const w = await routine();
    await w.run();
    expect(pushes).toHaveLength(1);
    const { engine, sent } = await phone({ botsOff: ["nani"] });
    try {
      await engine.notify(A_, askMessage(A_, "bot_ask", pushes[0]!.p as never, pushes[0]!.key));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.categoryId).toBe(BOT_REPLY_CATEGORY);
      // And the same run with the switch off is the one push it always was, through the same muted setting.
      switches({ on: false });
      const off = await routine();
      await off.run();
      await engine.notify(A_, { kind: "routine_done", key: off.dones[0]!.key, vars: off.dones[0]!.vars, data: off.dones[0]!.data });
      expect(sent).toHaveLength(2);
    } finally {
      setPushGate(null);
    }
  });

  it("sends nothing at all for a bot the person muted in What pings you", async () => {
    switches({ on: true });
    // The person's own say, as the Bots app keeps it: this bot is off. A bot asking of its own accord is not a routine, so it stays
    // off — the switch does not make a muted bot speak.
    const { engine, sent } = await phone({ botsOff: ["nani"] });
    try {
      await engine.notify(A_, askMessage(A_, "bot_ask", { slug: "nani", name: "Nani", line: "Shall I book it?" }, "k1"));
      expect(sent).toEqual([]);
      // Another bot of theirs is untouched.
      await engine.notify(A_, askMessage(A_, "bot_ask", { slug: "plan", name: "Plan Ease", line: "Your day is ready." }, "k2"));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.categoryId).toBe(BOT_REPLY_CATEGORY);
    } finally {
      setPushGate(null);
    }
  });
});
