/**
 * TALK REACHES WHAT THE PERSON CONNECTED (docs/talk-door.md section 6b): the bot answering in Talk may use every app they
 * connected, not only those on its own list; it is told which apps and which signed-in sites it can reach; it may watch a
 * page on a site (read only, nothing pressed); and an ask about something they connected that no bot fits goes to Talk's
 * own bot rather than the front door's road with no tools.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { ALICE, brain, toolCall, rig } = await import("./bots-rig.js");
const { runBot } = await import("../src/bots/run.js");
const { builtinBot } = await import("../src/bots/builtin.js");
const { MemoryBotStore } = await import("../src/bots/store.js");
const { touchesWhatTheyConnected } = await import("../src/bots/service.js");

type Ports = import("../src/bots/ports.js").BotPorts;

/** A person with Gmail connected and Notion not, and one tool on Gmail. */
function connectors() {
  const used: Array<{ connector: string; tool: string; args: Record<string, unknown> }> = [];
  const port: NonNullable<Ports["connectors"]> = {
    catalog: async () => [
      { id: "gmail", name: "Gmail", oneLine: "Read and send email.", connected: true },
      { id: "notion", name: "Notion", oneLine: "Pages and databases.", connected: false },
    ],
    status: async (_u, ids) => ids.map((id) => ({ id, name: id === "gmail" ? "Gmail" : id, status: id === "gmail" ? "connected" as const : "not_connected" as const })),
    tools: async (_u, id) => (id === "gmail" ? [{ name: "search_mail", description: "Search their mail.", inputSchema: { type: "object", properties: { q: { type: "string" } } } }] : []),
    use: async (_u, _r, _s, line) => { used.push(line); return { kind: "result", text: "1 message from HDFC: statement for October." }; },
    settle: async () => undefined,
  };
  return { port, used };
}

/** Signed in to Amazon, with one order being watched. */
function sites() {
  const watched: Array<{ url: string; label: string }> = [];
  const port = () => ({
    snapshot: async () => ({
      logins: [{ site: "amazon.in" }],
      watches: [{ id: "w1", site: "amazon.in", label: "Headphones order", state: "open", card: { title: "Sony WH-1000XM6", line: "Out for delivery · arriving 6 pm" }, readAt: Date.now() - 10 * 60_000 }],
    }),
    watch: async (_u: string, url: string, label: string) => { watched.push({ url, label }); return { id: "w2", site: "amazon.in", label }; },
  });
  return { port, watched };
}

const talk = builtinBot("talk")!;
const ask = (ports: Ports, model: ReturnType<typeof brain>, everyApp: boolean, message = "anything from HDFC in my Gmail?") =>
  runBot({ store: new MemoryBotStore(), ports, call: model.call }, { bot: talk, userId: ALICE, message, surface: "test", capPaise: talk.budgets.perRequestPaise, ...(everyApp ? { everyApp: true } : {}) });

describe("in Talk, the bot reaches every app they connected", () => {
  it("is handed Gmail's tools though Gmail is on no bot's own list, and uses them", async () => {
    const c = connectors();
    const model = brain((_s, n) => (n === 0 ? { toolCalls: [toolCall("gmail__search_mail", { q: "HDFC" })] } : "One from HDFC: your October statement."));
    const a = await ask({ connectors: c.port }, model, true);
    const first = model.of("bot.run")[0]!;
    expect(first.tools.map((t) => t.name)).toContain("gmail__search_mail");
    expect(c.used).toEqual([{ connector: "gmail", tool: "search_mail", args: { q: "HDFC" } }]);
    expect(a.text).toContain("HDFC");
  });

  it("is told which apps it can reach, and never one they have not connected", async () => {
    const model = brain(() => "ok");
    await ask({ connectors: connectors().port }, model, true);
    const user = model.of("bot.run")[0]!.user;
    expect(user).toContain("Apps they connected");
    expect(user).toContain("Gmail");
    expect(user).not.toContain("Notion");
  });

  it("outside Talk, a bot keeps to its own list", async () => {
    const model = brain(() => "ok");
    await ask({ connectors: connectors().port }, model, false);
    const first = model.of("bot.run")[0]!;
    expect(first.tools.map((t) => t.name)).not.toContain("gmail__search_mail");
    expect(first.user).not.toContain("Apps they connected");
  });
});

describe("in Talk, the bot knows their signed-in sites, read only", () => {
  it("is told what they are signed in to and what is being watched, with its latest card, and that it cannot press or pay", async () => {
    const model = brain(() => "Your headphones are out for delivery, arriving at 6.");
    await ask({ sites: sites().port }, model, true, "where is my amazon order?");
    const user = model.of("bot.run")[0]!.user;
    expect(user).toContain("amazon.in");
    expect(user).toContain("Out for delivery · arriving 6 pm");
    expect(user).toMatch(/read only[\s\S]*cannot press, type, order or pay/);
  });

  it("may watch one more page: the one thing it does with a site, and it only reads", async () => {
    const s = sites();
    const model = brain((_x, n) => (n === 0 ? { toolCalls: [toolCall("site_watch", { url: "https://www.amazon.in/gp/your-account/order-details?orderID=1", label: "Charger order" })] } : "I'll keep an eye on it."));
    await ask({ sites: s.port }, model, true, "keep an eye on my charger order");
    expect(model.of("bot.run")[0]!.tools.map((t) => t.name)).toContain("site_watch");
    expect(s.watched).toEqual([{ url: "https://www.amazon.in/gp/your-account/order-details?orderID=1", label: "Charger order" }]);
    const tool = model.of("bot.run")[0]!.tools.find((t) => t.name === "site_watch")!;
    expect(tool.description).toMatch(/READ ONLY/);
  });

  it("a page that is not an https address is refused, and nothing is watched", async () => {
    const s = sites();
    const model = brain((_x, n) => (n === 0 ? { toolCalls: [toolCall("site_watch", { url: "javascript:alert(1)", label: "x" })] } : "ok"));
    await ask({ sites: s.port }, model, true, "watch this");
    expect(s.watched).toEqual([]);
  });

  it("outside Talk there is no site tool and nothing about their sites", async () => {
    const model = brain(() => "ok");
    await ask({ sites: sites().port }, model, false, "where is my amazon order?");
    const first = model.of("bot.run")[0]!;
    expect(first.tools.map((t) => t.name)).not.toContain("site_watch");
    expect(first.user).not.toContain("amazon.in");
  });
});

describe("an ask about something they connected (bots/service.ts touchesWhatTheyConnected)", () => {
  const apps = [{ id: "gmail", name: "Gmail" }, { id: "google-calendar", name: "Google Calendar" }, { id: "notion", name: "Notion" }];
  it("names an app, a site, or what they hold", () => {
    for (const m of ["anything from HDFC in my Gmail?", "add this to notion", "what's in my inbox", "move my 3pm meeting to Friday", "reply to Riya's email"]) {
      expect(touchesWhatTheyConnected(m, apps, []), m).toBe(true);
    }
    for (const m of ["where is my order?", "track my swiggy delivery", "is my amazon refund done?"]) {
      expect(touchesWhatTheyConnected(m, [], ["amazon.in", "swiggy.com"]), m).toBe(true);
    }
  });
  it("is not plain chat, and nothing at all when they have connected nothing", () => {
    for (const m of ["tell me a joke", "what is the capital of Peru?", "translate good morning to Hindi", "explain google's history"]) {
      expect(touchesWhatTheyConnected(m, apps, ["amazon.in"]), m).toBe(false);
    }
    expect(touchesWhatTheyConnected("what's in my inbox", [], [])).toBe(false);
  });
});

describe("which bot answers, from Talk (bots/service.ts target, everyApp)", () => {
  const ctx = { attachments: [], recent: [], mode: "text" as const };
  const withSites = { sites: () => ({ snapshot: async () => ({ logins: [{ site: "amazon.in" }], watches: [] }), watch: async () => ({ id: "w", site: "amazon.in", label: "x" }) }) };

  it("an ask about a site they are signed in to that no bot fits is Talk's own bot's, with what it can reach", async () => {
    const r = await rig(() => "ok", { ports: withSites });
    const t = await r.bots.target(ALICE, "any", "is my amazon refund done?", ctx, undefined, { everyApp: true });
    expect(t.kind).toBe("bot");
    expect(t.bot?.slug).toBe("talk");
    expect(t.reasons).toContain("connected");
  });

  it("the same ask outside Talk keeps the road it always had", async () => {
    const r = await rig(() => "ok", { ports: withSites });
    const t = await r.bots.target(ALICE, "any", "is my amazon refund done?", ctx);
    expect(t.reasons).not.toContain("connected");
  });

  it("plain chat from Talk keeps the front door's road", async () => {
    const r = await rig(() => "ok", { ports: withSites });
    const t = await r.bots.target(ALICE, "any", "tell me a joke about cats", ctx, undefined, { everyApp: true });
    expect(t.reasons).not.toContain("connected");
  });
});
