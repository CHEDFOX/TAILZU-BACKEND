/**
 * THE MAIL BOT'S SCREENS (screens/bots/mailPage.ts, mailCards.ts, mailScreens.ts, mailInbox.ts, mailAliases.ts): with no business, its first
 * card asks for the business; a business not yet set up gets the records, then its company personality (read from its website as the records
 * are kept, theirs to change now or later), then how it answers, one card after another, each kept as it is answered; a set-up business shows
 * its mailbox (all mail, the main address's own, each alias's), what needs a person, what was answered and filed, and a chip per domain; the
 * mailbox reads a folder, a conversation and writes mail from any address; a domain's addresses and rules are its own screens; a reply is the
 * message beside its draft, with Send, Keep, Throw away and "write it again"; a business's settings open its addresses, personality, rules and
 * records, and remove it only on a second yes. Every tree is drawn by the shipped app (the linter), on the phone and in the window.
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
  overview?: unknown; runs?: unknown[]; spaces?: boolean; reply?: unknown; business?: unknown; brief?: unknown; folders?: unknown; api?: Record<string, unknown>;
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
      "GET /v1/mail/businesses/leaf-co/brief": o.brief ?? BRIEF,
      "GET /v1/mail/businesses/leaf-co": { business: o.business ?? BIZ() },
      ...(o.folders ? { "GET /v1/mail/businesses/leaf-co/folders": { folders: o.folders } } : {}),
      ...(o.reply ? { "GET /v1/mail/businesses/leaf-co/replies/7": o.reply } : {}),
      ...(o.api ?? {}),
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: o.client ?? "phone", params: { slug: "mail", ...(o.params ?? {}) }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, ...(o.spaces === false ? { spaces: false } : {}), can: new Set(o.can ?? DRAWS), desk: { pages: false, notes: false },
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

describe("there is a way off the screen", () => {
  it("draws the Back itself, so a build already out there has one without waiting for a release", async () => {
    const p = await build();
    const back = walk(p.card!).find((n) => (n.props as { accessibilityLabel?: string })?.accessibilityLabel === "Back");
    expect(back).toBeDefined();
    expect(back!.on?.onPress).toEqual({ kind: "navigateBack" });
    // and it is always there, not behind a step's own condition
    expect(back!.visibleIf).toBeUndefined();
  });

  it("the set-up card carries a way back, because a card over the page is a modal with no back and no swipe of its own", async () => {
    const p = await build();
    expect(p.card).toBeDefined();
    expect(p.card!.on?.onDismiss).toEqual({ kind: "navigateBack" });
  });

  it("shows a clear only once there is something to clear, so an x is never mistaken for the way out", async () => {
    const p = await build();
    const clears = p.nodes.filter((n) => String((n.props as { accessibilityLabel?: string })?.accessibilityLabel ?? "").startsWith("Clear "));
    expect(clears.length).toBeGreaterThan(0);
    for (const c of clears) expect(c.visibleIf, String((c.props as { accessibilityLabel?: string }).accessibilityLabel)).toBeDefined();
  });

  it("leaving keeps what was answered: it does not close the cards or undo a step", async () => {
    const p = await build();
    expect(JSON.stringify(p.card!.on?.onDismiss)).not.toContain("mc_closed");
    expect(JSON.stringify(p.card!.on?.onDismiss)).not.toContain("callEndpoint");
  });
});

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

  it("then the records with Copy, the company personality, and how it answers, each kept as it is answered", async () => {
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
    // The records' Next keeps them and reads the domain's website: the company personality fills in from it.
    const next = p.every().find((a) => a.kind === "sequence" && JSON.stringify(a).includes('"mc_dns"') && JSON.stringify(a).includes("/brief/draft"));
    expect(next).toBeTruthy();
    const fill = callsOf(p.every()).find((c) => c.path.endsWith("/brief/draft"))!;
    expect(fill).toMatchObject({ method: "POST", assignTo: "mc_draft" });
    // The personality, after the records, shown as read (no fields on the card: no room for them with a keyboard up). Keep keeps it;
    // Change it keeps it too, then opens its own page in the card's place.
    expect(p.texts).toEqual(expect.arrayContaining(["Company personality", "Keep", "Change it", "Analysing leafandco.in…", "About", "Voice", "Facts", "Rules"]));
    expect(p.fields.some((f) => f.startsWith("mc_draft"))).toBe(false);
    const shown = p.nodes.filter((n) => n.type === "Text" && (n.bind as { content?: string } | undefined)?.content?.startsWith("mc_draft.draft.")).map((n) => (n.bind as { content: string }).content);
    expect(shown).toEqual(["mc_draft.draft.about", "mc_draft.draft.voice", "mc_draft.draft.knowledge", "mc_draft.draft.policies"]);
    const keeps = callsOf(p.every()).filter((c) => c.method === "PUT" && c.path === "/v1/mail/businesses/leaf-co/brief");
    expect(keeps).toHaveLength(2);
    for (const keep of keeps) expect(keep.body).toEqual({ about: "$state.mc_draft.draft.about", knowledge: "$state.mc_draft.draft.knowledge", voice: "$state.mc_draft.draft.voice", policies: "$state.mc_draft.draft.policies" });
    expect(keeps.map((k) => k.onSuccess)).toEqual(expect.arrayContaining([{ kind: "navigate", screenId: "bots.mail.brief", params: { b: "leaf-co", from: "setup" }, replace: true }]));
    // Not while the website is still being read: what it reads would land after the card moved on.
    const guarded = p.every().filter((a) => a.kind === "condition" && JSON.stringify((a as { if: unknown }).if) === JSON.stringify({ truthy: "mc_busy" }));
    expect(guarded).toHaveLength(2);
    // The order: the records, the personality once they are kept, how it answers once both are.
    const steps = p.nodes.map((n) => (n as { visibleIf?: unknown }).visibleIf).filter(Boolean).map((c) => JSON.stringify(c));
    expect(steps).toContain(JSON.stringify({ all: [{ truthy: "mc_dns" }, { falsy: "mc_brief" }] }));
    expect(steps).toContain(JSON.stringify({ all: [{ truthy: "mc_dns" }, { truthy: "mc_brief" }, { falsy: "mc_mode" }] }));
    // The brief's careful defaults start the fields, so keeping them never empties the rules.
    expect(p.state.mc_draft).toEqual({ draft: { about: "", knowledge: "", voice: "Warm, clear and brief.", policies: "Never promise refunds." } });
    expect(p.card?.props).toMatchObject({ overlay: true, doneWhen: { all: [{ truthy: "mc_dns" }, { truthy: "mc_mode" }, { truthy: "mc_brief" }] } });
  });

  it("does not read the website again when set up again with a personality kept, unless they ask", async () => {
    const p = await build({ params: { b: "leaf-co", setup: "1" }, overview: { businesses: [BIZ()], waiting: [], today: ZERO }, brief: { ...BRIEF, saved: true } });
    expect(p.lint).toEqual([]);
    const next = p.every().filter((a) => a.kind === "sequence" && JSON.stringify(a).includes('"mc_dns"'));
    expect(next.length).toBeGreaterThan(0);
    expect(next.some((a) => JSON.stringify(a).includes("/brief/draft"))).toBe(false);
    expect(p.texts).toContain("Read leafandco.in again");
  });

  it("opens at how it answers after the personality was changed on its own page, which goes on there kept or not", async () => {
    const p = await build({ params: { b: "leaf-co", setup: "1", step: "mode" }, overview: { businesses: [BIZ()], waiting: [], today: ZERO }, brief: { ...BRIEF, saved: true } });
    expect(p.lint).toEqual([]);
    expect(p.state).toMatchObject({ mc_dns: true, mc_brief: true, mc_mode: false });
    expect(p.texts).toContain("How should it answer?");
    const brief = await build({ screen: "bots.mail.brief", params: { b: "leaf-co", from: "setup" } });
    expect(brief.lint).toEqual([]);
    const toMode = { kind: "navigate", screenId: "bots.bot", params: { slug: "mail", b: "leaf-co", setup: "1", step: "mode" }, replace: true };
    const keep = callsOf(brief.every()).find((c) => c.method === "PUT" && c.path === "/v1/mail/businesses/leaf-co/brief")!;
    expect(JSON.stringify(keep.onSuccess)).toContain(JSON.stringify(toMode));
    expect(JSON.stringify(brief.s)).toContain(JSON.stringify(toMode));
    // Opened from the settings, it stays a page of its own.
    const plain = await build({ screen: "bots.mail.brief", params: { b: "leaf-co" } });
    expect(JSON.stringify(plain.s)).not.toContain('"step":"mode"');
  });

  it("gives a build without the living card the same steps in a plain card", async () => {
    const p = await build({ can: ["BotsKit"], overview: { businesses: [BIZ({ ready: false })], waiting: [], today: ZERO } });
    expect(p.card).toBeUndefined();
    expect(p.texts).toEqual(expect.arrayContaining(["Point leafandco.in here", "Company personality", "How should it answer?"]));
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

  // Now is FIXED_NOW, 7:40 pm in IST on 28 October: mail this morning and this afternoon, yesterday, three days ago, and on 2 October.
  const at = (daysAgo: number, hour: number) => {
    const day = new Date(FIXED_NOW + IST * 60_000); day.setUTCHours(hour, 5, 0, 0);
    return day.getTime() - IST * 60_000 - daysAgo * 86_400_000;
  };
  const msg = (id: string, from: string, subject: string, when: number, o: Record<string, unknown> = {}) => ({
    id, threadId: `t${id}`, from: { name: from, email: `${from.toLowerCase()}@customer.test` }, to: [{ name: "", email: "hello@leafandco.in" }],
    subject, preview: `About ${subject.toLowerCase()}`, at: when, unread: false, starred: false, count: 1, ...o,
  });
  const today = [msg("2", "Kabir", "Gift wrapping", at(0, 14)), msg("1", "Asha", "Where is my order?", at(0, 9), { unread: true, ai: { run: 7, status: "needs_person" } })];
  const MAIL = {
    folder: { key: "inbox", id: "in", name: "Inbox", role: "inbox", kind: "system", unread: 1, total: 6 }, folders: [], page: 0, more: true, total: 6,
    messages: [...today, msg("4", "Dev", "Invoice 88", at(1, 11)), msg("5", "Neha", "Return", at(3, 10), { starred: true }), msg("6", "Om", "Our autumn sale", Date.UTC(2026, 9, 2, 6))],
  };
  const withMail = { "GET /v1/mail/businesses/leaf-co/messages?folder=inbox": MAIL };

  it("is a plain inbox: a thin round search, the folders and Write, then the mail under its day, today by the part of the day", async () => {
    const p = await build({ overview, runs, api: withMail });
    expect(p.lint).toEqual([]);
    expect(p.card).toBeUndefined();
    const t = p.texts;
    // The search is the first thing under the head: one thin round field, finding in all mail.
    const search = p.nodes.find((n) => n.type === "TextField" && (n.bind as { value: string }).value === "mailQ")!;
    expect(search.props).toMatchObject({ placeholder: "Search mail", returnKeyType: "search" });
    const find = JSON.stringify(search.on?.onSubmit);
    expect(find).toContain('"screenId":"bots.mail.inbox"');
    expect(find).toContain('"q":"$state.mailQ"');
    // Today by the part of the day, then Yesterday, the weekday, and the date.
    const heads = t.filter((x) => /^(This morning|This afternoon|This evening|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d+ \w+)$/.test(x));
    expect(heads).toEqual(["This afternoon", "This morning", "Yesterday", "Sunday", "2 October"]);
    expect(t).toEqual(expect.arrayContaining(["Asha", "Where is my order?", "Needs you", "Starred", "Our autumn sale"]));
    // Each opens its conversation; More mail, the mailbox's next page.
    expect(navTo(p.every(), "bots.mail.thread").map((a) => (a as { params: Record<string, string> }).params.tid)).toEqual(MAIL.messages.map((m) => m.threadId));
    expect(t).toContain("More mail");
    // What waits for a person is one line, opening the first.
    expect(t).toContain("2 replies wait for you");
    expect(navTo(p.every(), "bots.mail.reply").map((a) => (a as { params: Record<string, string> }).params)).toEqual([{ b: "leaf-co", run: "7" }]);
    // None of the old page: no numbers of the day, no Answered and Filed lists, no starters.
    for (const gone of ["Last 24 hours", "Answered", "Filed", "Mailbox", "What needs me today?"]) expect(t, gone).not.toContain(gone);
    expect(p.fields).toContain("say");
    expect(navTo(p.every(), "bots.mail.settings").length).toBeGreaterThan(0);
    expect(p.calls.some((c) => c.path.endsWith("/dns"))).toBe(false);
  });

  it("says that mail comes once the domain points here, before anything arrived", async () => {
    const p = await build({ overview: { businesses: [BIZ()], waiting: [], today: ZERO }, api: { "GET /v1/mail/businesses/leaf-co/messages?folder=inbox": { ...MAIL, messages: [], more: false } } });
    expect(p.texts).toContain("Nothing has arrived yet. Mail starts once leafandco.in points here.");
    expect(navTo(p.every(), "bots.mail.dns")).toHaveLength(1);
  });

  it("shows the folders as one row of chips, with what is unread, and Write as a small + in the head", async () => {
    const folders = [
      { key: "inbox", id: "in", name: "Inbox", role: "inbox", kind: "system", unread: 3, total: 40 },
      { key: "main", id: "in", name: "Hello", role: null, kind: "address", unread: 0, total: 0, email: "hello@leafandco.in" },
      { key: "f-sup", id: "sup", name: "Support", role: null, kind: "address", unread: 2, total: 9, email: "support@leafandco.in" },
      { key: "sent", id: "snt", name: "Sent", role: "sent", kind: "system", unread: 0, total: 12 },
    ];
    const p = await build({ overview, runs, folders, api: withMail });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["All mail · 3", "Hello", "Support · 2", "Sent and more"]));
    const opens = navTo(p.every(), "bots.mail.inbox").map((a) => (a as { params: Record<string, string> }).params.folder);
    expect(opens).toEqual(expect.arrayContaining(["inbox", "main", "f-sup", "sent"]));
    expect(navTo(p.every(), "bots.mail.compose").length).toBeGreaterThan(0);
    // One address alone has no chip of its own: All mail is its mail.
    const one = await build({ overview, runs, folders: [folders[0], folders[1], folders[3]], api: withMail });
    expect(one.texts).not.toContain("Hello");
  });

  it("opens All mail and Sent even when the folders couldn't be read", async () => {
    const p = await build({ overview, runs });
    expect(p.texts).toEqual(expect.arrayContaining(["All mail", "Sent and more"]));
    expect(p.texts).toContain("Your mail couldn't be read just now. Pull to try again.");
  });

  it("shows a chip per domain only when there are several; another is added in Settings", async () => {
    const two = { ...overview, businesses: [BIZ(), BIZ({ id: "tea-house", name: "Tea House", domain: "teahouse.in", email: "hello@teahouse.in" })] };
    const p = await build({ overview: two, runs, api: withMail });
    expect(p.texts).toEqual(expect.arrayContaining(["leafandco.in", "teahouse.in"]));
    const one = await build({ overview, runs, api: withMail });
    expect(one.texts).not.toContain("leafandco.in");
    expect(one.texts).not.toContain("Add a domain");
  });

  it("draws in the window too", async () => {
    const p = await build({ overview, runs, client: "desktop", api: withMail });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("This afternoon");
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
  it("opens its addresses, personality, rules and records, sets it up again, adds a domain, and removes it only on a second yes", async () => {
    const p = await build({ screen: "bots.mail.settings", params: { b: "leaf-co" }, business: BIZ({ addresses: [address(1, "hello"), address(2, "support", { aiMode: "send" })] }) });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Addresses", "Company personality", "Rules", "Domain records", "Set it up again", "Add a domain"]));
    const to = p.every().filter((a) => a.kind === "navigate").map((a) => (a as { screenId: string }).screenId);
    expect(to).toEqual(expect.arrayContaining(["bots.mail.addresses", "bots.mail.brief", "bots.mail.rules", "bots.mail.dns"]));
    const params = p.every().filter((a) => a.kind === "navigate").map((a) => (a as { params?: Record<string, string> }).params ?? {});
    expect(params.some((x) => x.setup === "1" && x.b === "leaf-co")).toBe(true);
    expect(params.some((x) => x.add === "1")).toBe(true);
    expect(p.texts).toContain("Remove Leaf & Co");
    expect(p.state.ms_sure).toBe(false);
    const remove = callsOf(p.every()).find((c) => c.method === "DELETE" && c.path === "/v1/mail/businesses/leaf-co")!;
    expect(remove).toBeTruthy();
    // The mail app's servers, for a phone's or a computer's mail app.
    expect(p.texts.some((t) => t.includes("mx.mail.example.online") && t.includes("hello@leafandco.in"))).toBe(true);
  });

  it("lists the domain's records with their checks, and the company personality with Fill from the website", async () => {
    const dns = await build({ screen: "bots.mail.dns", params: { b: "leaf-co" } });
    expect(dns.lint).toEqual([]);
    expect(dns.texts).toContain("1 of 4 in place");
    const brief = await build({ screen: "bots.mail.brief", params: { b: "leaf-co" } });
    expect(brief.lint).toEqual([]);
    expect(brief.texts).toContain("Company personality");
    expect(brief.fields).toEqual(expect.arrayContaining(["mb.draft.about", "mb.draft.voice", "mb.draft.knowledge", "mb.draft.policies", "mb_sig"]));
    expect(callsOf(brief.every()).find((c) => c.path.endsWith("/brief/draft"))).toMatchObject({ assignTo: "mb" });
  });
});

describe("the mail bot's look", () => {
  const ORACLE_P = "Reads your birth chart and the world's divination traditions to answer what you ask about your life, love, work and timing.";
  const withBoth = [...SAMPLE_BOTS.slice(0, 4), { slug: "oracle", name: "Chamen", colour: "plum", purpose: ORACLE_P, builtin: true },
    { slug: "mail", name: "Mail", colour: "sand", purpose: PURPOSE, builtin: true }, SAMPLE_BOTS[4]!];
  const home = async (can: string[]) => {
    const s = await buildBotsScreen({ screenId: "bots.home", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(can), desk: { pages: false, notes: false } },
      fakeDeps({ bots: withBoth }));
    return walk(s.root as Node);
  };

  it("puts Chamen and the mail bot on Home's grid, the mail bot as the postie filing letters on a loop; one bot a row, so none is a chip", async () => {
    const nodes = await home([...DRAWS, "BotTilesStrip"]);
    const grid = nodes.find((n) => n.type === "BotTiles")!;
    const tiles = (grid.props as { tiles: Array<Record<string, unknown>> }).tiles;
    expect(tiles.map((t) => t.slug)).toEqual(expect.arrayContaining(["oracle", "mail"]));
    expect(tiles.find((t) => t.slug === "mail")).toMatchObject({ avatar: "postie", moment: "m.sort", momentMode: "loop", sub: "Answers your business mail" });
    expect(tiles.find((t) => t.slug === "oracle")).toMatchObject({ sub: "Reads your sky" });
    // These used to be chips: the grid had four slots, so Chamen and the mail bot took the last of them and the
    // rest fell through to "More bots". One bot a row fits them all, so they are tiles now and the chip row is gone.
    expect(tiles.map((t) => t.slug)).toEqual(expect.arrayContaining(["travel", "gym-bot"]));
    // A tile's name lives in the BotTiles props, not in a Text node — the names only became text when they were
    // chips. So the check is that the chip section is gone; the tiles themselves are asserted above.
    const words = nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content));
    expect(words).not.toContain("More bots");
    expect(lintTree(nodes[0]!)).toEqual([]);
  });

  it("gives a build that cannot play looks plain tiles, Chamen and the mail bot still among them", async () => {
    const nodes = await home(["BotsKit"]);
    const texts = nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content));
    expect(texts).toEqual(expect.arrayContaining(["Chamen", "Reads your sky", "Mail", "Answers your business mail"]));
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

const OWNER = { id: "u7", name: "Ravi Kumar" };
const FOLDERS_OWN = [
  { key: "inbox", id: "in", name: "Inbox", role: "inbox", kind: "system", unread: 3, total: 40 },
  { key: "main", id: "in", name: "Hello", role: null, kind: "address", unread: 0, total: 0, email: "hello@leafandco.in" },
  { key: "f-sup", id: "sup", name: "Support", role: null, kind: "address", unread: 2, total: 9, email: "support@leafandco.in" },
  { key: "sent", id: "snt", name: "Sent", role: "sent", kind: "system", unread: 0, total: 12 },
];
const navTo = (acts: ActionSpec[], screenId: string) => acts.filter((a) => a.kind === "navigate" && (a as { screenId: string }).screenId === screenId);

describe.each(["phone", "desktop"] as const)("the mail page for a space's admin and for a handler, on the %s", (client) => {
  const mine = BIZ({ id: "mine-co", name: "Mine", domain: "mine.in" });
  const theirs = BIZ({ id: "leaf-co", access: "admin", owner: OWNER });
  const given = BIZ({
    id: "tea-co", name: "Tea House", domain: "teahouse.in", access: "handler", owner: { id: "u8", name: "Meera Rao" },
    addresses: [["orders", 5], ["help", 6], ["bills", 7]].map(([l, id]) => ({ ...address(id as number, l as string), email: `${l}@teahouse.in`, isPrimary: false })),
  });

  it("gives every business its chip: own by its domain, a member's with the owner's first name, a handler's with the first address and +N", async () => {
    const p = await build({ client, overview: { businesses: [mine, theirs, given], waiting: [], today: ZERO }, params: { b: "leaf-co" } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["mine.in", "Ravi · leafandco.in", "Meera · orders@teahouse.in +2"]));
    expect(p.texts).not.toContain("leafandco.in");
  });

  it("tells the admin whose business it is, and keeps everything: settings, set-up, All mail, Sent", async () => {
    const p = await build({ client, overview: { businesses: [theirs], waiting: [], today: ZERO }, runs: [RUN(1)], folders: FOLDERS_OWN, params: { b: "leaf-co" } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Ravi's business. As their space's admin you can see and change everything.");
    expect(navTo(p.every(), "bots.mail.settings")).toHaveLength(1);
    expect(p.texts).toContain("Sent and more");
    expect(navTo(p.every(), "bots.mail.compose").length).toBeGreaterThan(0);
    expect(p.texts.some((t) => t.startsWith("All mail"))).toBe(true);
    // The day in numbers is the admin's own mail: it is not shown on Ravi's page.
    expect(p.texts).not.toContain("Last 24 hours");
    expect(p.texts).not.toContain("Every domain, last 24 hours");
  });

  it("tells a handler which addresses are theirs, and shows no settings, no set-up, no All mail, no Sent: only their addresses' folders and Write", async () => {
    const folders = [
      { key: "f-o", id: "o", name: "Orders", role: null, kind: "address", unread: 4, total: 9, email: "orders@teahouse.in" },
      { key: "f-h", id: "h", name: "Help", role: null, kind: "address", unread: 0, total: 2, email: "help@teahouse.in" },
    ];
    // Not set up (ready: false) and with a setup param: still nothing of the owner's set-up is offered.
    const p = await build({ client, overview: { businesses: [{ ...given, ready: false }], waiting: [], today: ZERO }, runs: [], folders, params: { b: "tea-co", setup: "1" },
      api: { "GET /v1/mail/businesses/tea-co/activity?limit=40": { runs: [] }, "GET /v1/mail/businesses/tea-co/folders": { folders } } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Meera gave you orders@teahouse.in, help@teahouse.in and bills@teahouse.in to answer.");
    expect(navTo(p.every(), "bots.mail.settings")).toHaveLength(0);
    expect(p.card).toBeUndefined();
    expect(p.texts).not.toContain("Point teahouse.in here");
    expect(p.texts).not.toContain("Domain records");
    expect(p.texts).not.toEqual(expect.arrayContaining(["All mail"]));
    expect(p.texts).not.toContain("Sent and more");
    expect(p.texts).not.toContain("Last 24 hours");
    expect(p.texts).toEqual(expect.arrayContaining(["Orders · 4", "Help"]));
    // Their list is their first address's mail: they have no All mail.
    expect(p.calls.some((c) => c.path === "/v1/mail/businesses/tea-co/messages?folder=f-o")).toBe(true);
    const opens = navTo(p.every(), "bots.mail.inbox").map((a) => (a as { params: Record<string, string> }).params.folder);
    expect([...new Set(opens)].sort()).toEqual(["f-h", "f-o"]);
  });
});
