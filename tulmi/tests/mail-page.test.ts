/**
 * THE MAIL BOT'S SCREENS (screens/bots/mailPage.ts, mailCards.ts, mailScreens.ts): with no business, its first card asks for the business; a
 * business not yet set up gets the records, how it answers and what it knows, one card after another, each kept as it is answered; a set-up
 * business shows what needs a person first, then what was answered and filed, and asks its chat about the mail; a reply is the message beside
 * its draft, with Send, Keep, Throw away and "write it again"; a business's settings change how each address answers and remove it only on a
 * second yes. Every tree is drawn by the shipped app (the linter), on the phone and in the window.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const PURPOSE = "Keeps your business's email: sorts what arrives, drafts the replies in your voice, and tells you what needs you.";
const BOT = {
  slug: "mail", name: "Mail", colour: "sand", builtin: true, publicCard: false, tone: "", principles: [], purpose: PURPOSE,
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const ZERO = { received: 0, answered: 0, drafted: 0, needsPerson: 0, filed: 0 };
const address = (id: number, local: string, o: Record<string, unknown> = {}) => ({ id, email: `${local}@leafandco.in`, label: "", isPrimary: id === 1, aiMode: "draft", displayName: "", autoReply: null, ...o });
const BIZ = (o: Record<string, unknown> = {}) => ({
  id: "leaf-co", name: "Leaf & Co", domain: "leafandco.in", email: "hello@leafandco.in", signature: "", ready: true,
  allowance: { spentUsd: 0.25, capUsd: 1 }, addresses: [address(1, "hello")], mailApp: { incoming: "mx.mail.example.online", outgoing: "smtp.mail.example.online", user: "hello@leafandco.in" }, ...o,
});
const RUN = (id: number, o: Record<string, unknown> = {}) => ({
  id, companyId: "leaf-co", address: "hello@leafandco.in", sender: "asha@customer.test", subject: "Where is my order?", kind: "order", priority: "normal",
  summary: "Asks when order 1234 will ship", status: "drafted", reason: "", sendAt: null, createdAt: FIXED_NOW - 3_600_000, ...o,
});
const DNS = { domain: "leafandco.in", records: [
  { kind: "MX", type: "MX", name: "leafandco.in", host: "@", value: "mx.mail.example.online", priority: 10, required: true, why: "", status: "ok" },
  { kind: "SPF", type: "TXT", name: "leafandco.in", host: "@", value: "v=spf1 mx include:spf.mail.example.online ~all", required: true, why: "", status: "missing" },
  { kind: "DKIM", type: "TXT", name: "x._domainkey.leafandco.in", host: "x._domainkey", value: "v=DKIM1; k=rsa; p=MIIB", required: true, why: "", status: "missing" },
  { kind: "DMARC", type: "TXT", name: "_dmarc.leafandco.in", host: "_dmarc", value: "v=DMARC1; p=quarantine", required: true, why: "", status: "missing" },
  { kind: "SRV", type: "SRV", name: "_imaps._tcp.leafandco.in", host: "_imaps._tcp", value: "0 1 993 mx.mail.example.online", required: false, why: "", status: "missing" },
] };
const BRIEF = { profile: { about: "", voice: "Warm, clear and brief.", knowledge: "", policies: "Never promise refunds.", signature: "", replyLanguage: "sender", sendDelayMinutes: 2 }, saved: false };

async function build(o: {
  screen?: string; params?: Record<string, string>; client?: "phone" | "desktop"; can?: string[];
  overview?: unknown; runs?: unknown[]; reply?: unknown; business?: unknown;
} = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "mail", name: "Mail", colour: "sand", purpose: PURPOSE, builtin: true }], calls,
    api: {
      "GET /v1/bots/mail": { bot: BOT }, "GET /v1/bots/mail/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/mail/connectors": { connectors: [] },
      "GET /v1/botsapp/bots/chat/mail?limit=1": { turns: [] }, "GET /v1/botsapp/bots/chat/mail?limit=30": { turns: [] },
      "GET /v1/mail/overview": o.overview ?? { businesses: [], waiting: [], today: ZERO },
      "GET /v1/mail/businesses/leaf-co/activity?limit=40": { runs: o.runs ?? [] },
      "GET /v1/mail/businesses/leaf-co/dns": DNS,
      "GET /v1/mail/businesses/leaf-co/brief": BRIEF,
      "GET /v1/mail/businesses/leaf-co": { business: o.business ?? BIZ() },
      ...(o.reply ? { "GET /v1/mail/businesses/leaf-co/replies/7": o.reply } : {}),
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: o.client ?? "phone", params: { slug: "mail", ...(o.params ?? {}) }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, can: new Set(o.can ?? DRAWS), desk: { pages: false, notes: false },
  }, deps);
  const root = s.root as Node;
  const nodes = walk(root);
  const flat = (a: unknown): ActionSpec[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as ActionSpec & { actions?: unknown[]; then?: unknown; else?: unknown; onSuccess?: unknown };
    return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else), ...flat(x.onSuccess)];
  };
  return {
    s, calls, nodes, root, lint: lintTree(root),
    card: nodes.find((n) => n.type === "BotCard"),
    state: (s as unknown as { state?: Record<string, unknown> }).state ?? {},
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    fields: nodes.filter((n) => n.type === "TextField").map((n) => (n.bind as { value: string }).value),
    every: () => nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat),
  };
}
const callsOf = (acts: ActionSpec[]) => acts.filter((a) => a.kind === "callEndpoint") as Array<Extract<ActionSpec, { kind: "callEndpoint" }>>;

describe("the mail bot's set-up", () => {
  it("asks for the business first, and makes it on our mail server", async () => {
    const p = await build();
    expect(p.lint).toEqual([]);
    expect(p.card).toBeTruthy();
    expect(p.texts).toContain("Your business's email");
    expect(p.fields).toEqual(expect.arrayContaining(["mc_name", "mc_domain"]));
    const make = callsOf(p.every()).find((c) => c.path === "/v1/mail/businesses")!;
    expect(make).toMatchObject({ method: "POST", body: { name: "$state.mc_name", domain: "$state.mc_domain" } });
    expect(p.state.mc_made).toBe(false);
    // Behind the card: what it is, and Set it up.
    expect(p.texts).toContain("Your business's email, answered");
  });

  it("then the records with Copy, how it answers, and what it knows, each kept as it is answered", async () => {
    const p = await build({ overview: { businesses: [BIZ({ ready: false, addresses: [address(1, "hello"), address(2, "support")] })], waiting: [], today: ZERO } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Point leafandco.in here");
    // Only the records it needs, each with its live check and Copy; the optional ones are in the records' own screen.
    expect(p.texts.filter((t) => t === "Copy")).toHaveLength(4);
    expect(p.texts).toContain("Found");
    expect(p.every().some((a) => (a.kind === "copyToClipboard" && (a as { text: string }).text === "v=spf1 mx include:spf.mail.example.online ~all"))).toBe(true);
    // Drafts or Sends: every address, one after the other, and only then the step is kept.
    const modes = callsOf(p.every()).filter((c) => /\/addresses\/\d+$/.test(c.path));
    expect(modes.map((c) => [c.path, c.body])).toEqual(expect.arrayContaining([
      ["/v1/mail/businesses/leaf-co/addresses/1", { aiMode: "draft" }], ["/v1/mail/businesses/leaf-co/addresses/2", { aiMode: "draft" }],
      ["/v1/mail/businesses/leaf-co/addresses/1", { aiMode: "send" }],
    ]));
    // What it knows: drafted from the website into the fields, then kept.
    const fill = callsOf(p.every()).find((c) => c.path.endsWith("/brief/draft"))!;
    expect(fill).toMatchObject({ method: "POST", assignTo: "mc_draft" });
    expect(p.fields).toEqual(expect.arrayContaining(["mc_draft.draft.about", "mc_draft.draft.knowledge"]));
    const keep = callsOf(p.every()).find((c) => c.method === "PUT" && c.path === "/v1/mail/businesses/leaf-co/brief" && Object.keys(c.body as object).length)!;
    expect(keep.body).toEqual({ about: "$state.mc_draft.draft.about", knowledge: "$state.mc_draft.draft.knowledge", voice: "$state.mc_draft.draft.voice", policies: "$state.mc_draft.draft.policies" });
    // The brief's careful defaults start the fields, so keeping them never empties the rules.
    expect(p.state.mc_draft).toEqual({ draft: { about: "", knowledge: "", voice: "Warm, clear and brief.", policies: "Never promise refunds." } });
    expect(p.card?.props).toMatchObject({ overlay: true, doneWhen: { all: [{ truthy: "mc_dns" }, { truthy: "mc_mode" }, { truthy: "mc_brief" }] } });
  });

  it("gives a build without the living card the same steps in a plain card", async () => {
    const p = await build({ can: ["BotsKit"], overview: { businesses: [BIZ({ ready: false })], waiting: [], today: ZERO } });
    expect(p.card).toBeUndefined();
    expect(p.texts).toEqual(expect.arrayContaining(["Point leafandco.in here", "How should it answer?", "What should it know?"]));
    expect(p.lint).toEqual([]);
  });
});

describe("the mail bot's page", () => {
  const overview = {
    businesses: [BIZ()],
    waiting: [
      RUN(7, { status: "needs_person", kind: "complaint", priority: "urgent", summary: "Bag arrived torn, wants a replacement", sender: "Asha <asha@customer.test>" }),
      RUN(8, { status: "drafted" }),
    ],
    today: { received: 9, answered: 4, drafted: 1, needsPerson: 1, filed: 3 },
  };
  const runs = [RUN(7, { status: "needs_person" }), RUN(8), RUN(5, { status: "sent", summary: "Asks about gift wrapping" }), RUN(4, { status: "skipped", kind: "notification", summary: "", subject: "Our autumn sale", reason: "a newsletter (List-Unsubscribe)" })];

  it("shows what needs a person first, then what was answered and filed, and the day in numbers", async () => {
    const p = await build({ overview, runs });
    expect(p.lint).toEqual([]);
    expect(p.card).toBeUndefined();
    const t = p.texts;
    // The sections in that order (the day's numbers above them have words of their own: "Answered", "Filed").
    const needs = t.indexOf("Needs you"), answered = t.indexOf("Answered", needs), filed = t.indexOf("Filed", answered);
    expect(needs).toBeGreaterThan(-1);
    expect(answered).toBeGreaterThan(needs);
    expect(filed).toBeGreaterThan(answered);
    expect(t).toEqual(expect.arrayContaining(["Bag arrived torn, wants a replacement", "Asks about gift wrapping", "Our autumn sale", "Newsletter"]));
    expect(t).toContain("Asha · Complaint");
    // An answered one carries no word of its own: its section says it.
    expect(t.filter((x) => x === "Answered")).toHaveLength(2);
    expect(t).toEqual(expect.arrayContaining(["9", "4", "2", "3", "hello@leafandco.in · Drafts for you"]));
    // A waiting message opens its reply; an answered one is a record.
    const opens = p.every().filter((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === "bots.mail.reply") as Array<{ params: Record<string, string> }>;
    expect(opens.map((o) => o.params)).toEqual([{ b: "leaf-co", run: "7" }, { b: "leaf-co", run: "8" }]);
    // The chat reads the same mail: its bar and the first questions.
    expect(p.fields).toContain("say");
    expect(t).toContain("What needs me today?");
    expect(p.every().some((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === "bots.mail.settings")).toBe(true);
    // No set-up read for a business that is set up.
    expect(p.calls.some((c) => c.path.endsWith("/dns"))).toBe(false);
  });

  it("says that mail comes once the domain points here, before anything arrived", async () => {
    const p = await build({ overview: { businesses: [BIZ()], waiting: [], today: ZERO } });
    expect(p.texts).toContain("Nothing has arrived yet. Mail starts once leafandco.in points here.");
    expect(p.every().some((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === "bots.mail.dns")).toBe(true);
  });

  it("shows one business at a time, with a chip for each", async () => {
    const two = { ...overview, businesses: [BIZ(), BIZ({ id: "tea-house", name: "Tea House", domain: "teahouse.in", email: "hello@teahouse.in" })] };
    const p = await build({ overview: two, runs });
    expect(p.texts).toEqual(expect.arrayContaining(["Leaf & Co", "Tea House", "Add", "Every business, last 24 hours"]));
  });

  it("draws in the window too", async () => {
    const p = await build({ overview, runs, client: "desktop" });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Needs you");
  });

  it("says so when the mail service cannot be reached", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const deps = fakeDeps({
      bots: [...SAMPLE_BOTS, { slug: "mail", name: "Mail", colour: "sand", purpose: PURPOSE, builtin: true }], calls,
      api: { "GET /v1/bots/mail": { bot: BOT }, "GET /v1/botsapp/bots/chat/mail?limit=1": { turns: [] } },
    });
    const s = await buildBotsScreen({ screenId: "bots.bot", client: "phone", params: { slug: "mail" }, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(DRAWS), desk: { pages: false, notes: false } }, deps);
    expect(walk(s.root as Node).some((n) => n.type === "Text" && /couldn't be reached/.test(String(n.props?.content)))).toBe(true);
  });
});

describe("a reply", () => {
  const reply = {
    status: "needs_person", reason: "an unhappy customer", sendAt: null, to: "Asha <asha@customer.test>", subject: "Re: My bag", text: "Hi Asha, I'm sorry.",
    kind: "complaint", priority: "urgent", summary: "Bag arrived torn", message: { from: "Asha <asha@customer.test>", subject: "My bag", date: new Date(FIXED_NOW - 600_000).toISOString(), text: "It arrived torn." },
  };

  it("is the message beside its draft, sent with their changes first, kept, or thrown away", async () => {
    const p = await build({ screen: "bots.mail.reply", params: { b: "leaf-co", run: "7" }, reply });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Asha", "My bag", "It arrived torn.", "Complaint", "Urgent", "Bag arrived torn", "A person should answer this. an unhappy customer"]));
    expect(p.fields).toEqual(expect.arrayContaining(["mr.text", "mr_ask"]));
    expect(p.state.mr).toEqual({ text: "Hi Asha, I'm sorry." });
    const send = p.every().find((a) => a.kind === "condition" && JSON.stringify((a as { if: unknown }).if).includes("mr.text")) as { if: unknown; then: ActionSpec; else: ActionSpec };
    // Unchanged: sent as it is (nothing to learn); changed: their words first, then sent.
    expect(send.if).toEqual({ eq: ["mr.text", "Hi Asha, I'm sorry."] });
    expect(send.then).toMatchObject({ kind: "callEndpoint", method: "POST", path: "/v1/mail/businesses/leaf-co/replies/7/send" });
    expect(send.else).toMatchObject({ kind: "callEndpoint", method: "PUT", path: "/v1/mail/businesses/leaf-co/replies/7", body: { text: "$state.mr.text" }, onSuccess: { path: "/v1/mail/businesses/leaf-co/replies/7/send" } });
    const rewrites = callsOf(p.every()).filter((c) => c.path.endsWith("/rewrite"));
    expect(rewrites.length).toBeGreaterThanOrEqual(4);
    expect(rewrites.every((c) => c.assignTo === "mr")).toBe(true);
    expect(callsOf(p.every()).some((c) => c.method === "DELETE" && c.path === "/v1/mail/businesses/leaf-co/replies/7")).toBe(true);
  });

  it("says when it goes by itself, with Stop", async () => {
    const p = await build({ screen: "bots.mail.reply", params: { b: "leaf-co", run: "7" }, reply: { ...reply, status: "scheduled", sendAt: FIXED_NOW + 120_000 } });
    expect(p.texts.some((t) => t.startsWith("Sends by itself at "))).toBe(true);
    expect(callsOf(p.every()).some((c) => c.path.endsWith("/stop"))).toBe(true);
  });

  it("says plainly when it was already sent or thrown away", async () => {
    const p = await build({ screen: "bots.mail.reply", params: { b: "leaf-co", run: "7" } });
    expect(p.texts).toContain("This reply was sent or thrown away.");
    expect(p.lint).toEqual([]);
  });
});

describe("a business's screens", () => {
  it("changes how each address answers, adds one, and removes the business only on a second yes", async () => {
    const p = await build({ screen: "bots.mail.settings", params: { b: "leaf-co" }, business: BIZ({ addresses: [address(1, "hello"), address(2, "support", { aiMode: "send" })] }) });
    expect(p.lint).toEqual([]);
    const modes = callsOf(p.every()).filter((c) => /addresses\/\d+$/.test(c.path) && c.method === "PUT");
    expect(modes).toHaveLength(6);
    expect(callsOf(p.every()).some((c) => c.method === "POST" && c.path === "/v1/mail/businesses/leaf-co/addresses")).toBe(true);
    expect(p.texts).toContain("Remove Leaf & Co");
    expect(p.state.ms_sure).toBe(false);
    const remove = callsOf(p.every()).find((c) => c.method === "DELETE" && c.path === "/v1/mail/businesses/leaf-co")!;
    expect(remove).toBeTruthy();
    // The mail app's servers, for a phone's or a computer's mail app.
    expect(p.texts.some((t) => t.includes("mx.mail.example.online") && t.includes("hello@leafandco.in"))).toBe(true);
  });

  it("lists the domain's records with their checks, and what the AI knows with Fill from the website", async () => {
    const dns = await build({ screen: "bots.mail.dns", params: { b: "leaf-co" } });
    expect(dns.lint).toEqual([]);
    expect(dns.texts).toContain("1 of 4 in place");
    const brief = await build({ screen: "bots.mail.brief", params: { b: "leaf-co" } });
    expect(brief.lint).toEqual([]);
    expect(brief.fields).toEqual(expect.arrayContaining(["mb.draft.about", "mb.draft.voice", "mb.draft.knowledge", "mb.draft.policies", "mb_sig"]));
    expect(callsOf(brief.every()).find((c) => c.path.endsWith("/brief/draft"))).toMatchObject({ assignTo: "mb" });
  });
});

describe("the mail bot's look", () => {
  const ORACLE_P = "Reads your birth chart and the world's divination traditions to answer what you ask about your life, love, work and timing.";
  const withBoth = [...SAMPLE_BOTS.slice(0, 4), { slug: "oracle", name: "Oracle", colour: "plum", purpose: ORACLE_P, builtin: true },
    { slug: "mail", name: "Mail", colour: "sand", purpose: PURPOSE, builtin: true }, SAMPLE_BOTS[4]!];
  const home = async (can: string[]) => {
    const s = await buildBotsScreen({ screenId: "bots.home", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(can), desk: { pages: false, notes: false } },
      fakeDeps({ bots: withBoth }));
    return walk(s.root as Node);
  };

  it("puts the Oracle and the mail bot on Home's grid, the mail bot as the postie filing letters on a loop; the rest stay chips", async () => {
    const nodes = await home([...DRAWS, "BotTilesStrip"]);
    const grid = nodes.find((n) => n.type === "BotTiles")!;
    const tiles = (grid.props as { tiles: Array<Record<string, unknown>> }).tiles;
    expect(tiles.map((t) => t.slug)).toEqual(expect.arrayContaining(["oracle", "mail"]));
    expect(tiles.find((t) => t.slug === "mail")).toMatchObject({ avatar: "postie", moment: "m.sort", momentMode: "loop", sub: "Answers your business mail" });
    expect(tiles.find((t) => t.slug === "oracle")).toMatchObject({ sub: "Reads your sky" });
    expect(tiles.some((t) => t.slug === "travel")).toBe(false);
    const chips = nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content));
    expect(chips).toEqual(expect.arrayContaining(["More bots", "Travel bot", "Gym bot"]));
    expect(lintTree(nodes[0]!)).toEqual([]);
  });

  it("gives a build that cannot play looks plain tiles, the Oracle and the mail bot still among them", async () => {
    const nodes = await home(["BotsKit"]);
    const texts = nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content));
    expect(texts).toEqual(expect.arrayContaining(["Oracle", "Reads your sky", "Mail", "Answers your business mail"]));
    expect(nodes.some((n) => n.type === "BotTiles")).toBe(false);
  });

  it("wears him on the set-up card (catching the first letter) and in the page's head (stamping one and sending it off)", async () => {
    const setup = await build({ overview: { businesses: [BIZ({ ready: false })], waiting: [], today: ZERO } });
    expect(setup.card?.props).toMatchObject({ avatar: "postie", moment: "m.catch" });
    const p = await build({ overview: { businesses: [BIZ()], waiting: [], today: ZERO } });
    const buddy = p.nodes.find((n) => n.type === "BotBuddy");
    expect(buddy?.props).toMatchObject({ avatar: "postie", moment: "m.stamp", life: "page.mail" });
  });
});

