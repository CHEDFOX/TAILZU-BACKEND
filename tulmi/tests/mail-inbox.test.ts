/**
 * THE MAIL BOT'S MAILBOX AND A DOMAIN'S ADDRESSES (screens/bots/mailInbox.ts, mailAliases.ts), as Xooteq Mail has them: a folder's
 * conversations under a chip per folder (all mail, the main address's own, each alias's, the system folders) and per domain, a page at a time;
 * one conversation read whole, with what to do with it and the AI's draft a tap away; mail written from any address, by hand or by the AI;
 * every address of a domain with its folder, its name, how the AI answers it and its auto-reply; an alias added and removed on a second yes;
 * rules as sentences. Every tree is drawn by the shipped app (the linter), on the phone and in the window.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const B = "/v1/mail/businesses/leaf-co";
const address = (id: number, local: string, o: Record<string, unknown> = {}) => ({ id, email: `${local}@leafandco.in`, label: "", isPrimary: id === 1, aiMode: "draft", displayName: "", autoReply: null, ...o });
const BIZ = (o: Record<string, unknown> = {}) => ({
  id: "leaf-co", name: "Leaf & Co", domain: "leafandco.in", email: "hello@leafandco.in", signature: "", ready: true,
  allowance: { spentUsd: 0, capUsd: 1 }, addresses: [address(1, "hello"), address(2, "support", { label: "Support", aiMode: "send" })], ...o,
});
const TEA = BIZ({ id: "tea-house", name: "Tea House", domain: "teahouse.in", email: "hello@teahouse.in", addresses: [] });
const FOLDERS = [
  { key: "inbox", id: "in", name: "Inbox", role: "inbox", kind: "system", unread: 2, total: 31 },
  { key: "main", id: "in", name: "Hello", role: null, kind: "address", unread: 0, total: 0, email: "hello@leafandco.in" },
  { key: "f-sup", id: "sup", name: "Support", role: null, kind: "address", unread: 1, total: 4, email: "support@leafandco.in" },
  { key: "drafts", id: "dr", name: "Drafts", role: "drafts", kind: "system", unread: 0, total: 0 },
  { key: "sent", id: "snt", name: "Sent", role: "sent", kind: "system", unread: 0, total: 9 },
  { key: "trash", id: "tr", name: "Trash", role: "trash", kind: "system", unread: 0, total: 1 },
];
const asha = { name: "Asha", email: "asha@customer.test" };
const MSG = (id: string, o: Record<string, unknown> = {}) => ({
  id, threadId: `t${id}`, from: asha, to: [{ name: "", email: "support@leafandco.in" }], subject: "Where is my order?", preview: "Hi, I ordered on Monday…",
  at: FIXED_NOW - 3_600_000, unread: false, starred: false, count: 1, ...o,
});
const MESSAGES = (folder = FOLDERS[0], o: Record<string, unknown> = {}) => ({
  folder, folders: FOLDERS, page: 0, more: false, total: 2,
  messages: [MSG("1", { unread: true, count: 3, ai: { run: 7, status: "drafted" } }), MSG("2", { subject: "Thanks!", starred: true, from: { name: "", email: "ravi@customer.test" } })], ...o,
});
const THREAD = (o: Record<string, unknown> = {}) => ({
  threadId: "t1", subject: "Where is my order?", starred: false, where: ["inbox"], ai: { run: 7, status: "drafted" },
  messages: [
    { id: "m1", from: asha, to: [{ name: "", email: "support@leafandco.in" }], cc: [], at: FIXED_NOW - 7_200_000, text: "Hi, I ordered on Monday. Where is it?", unread: false, mine: false, attachments: [{ name: "receipt.pdf", size: 52_000, type: "application/pdf" }] },
    { id: "m2", from: { name: "Leaf & Co", email: "support@leafandco.in" }, to: [asha], cc: [], at: FIXED_NOW - 3_600_000, text: "It ships tomorrow.", unread: false, mine: true, attachments: [] },
  ],
  ...o,
});
const RULES = [
  { id: 1, name: "", enabled: true, line: "When From contains \"invoice\": move to Billing" },
  { id: 2, name: "", enabled: false, line: "When Subject contains \"sale\": mark as read" },
];

async function build(screenId: string, params: Record<string, string>, o: { client?: "phone" | "desktop"; api?: Record<string, unknown> } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "mail", name: "Mail", colour: "sand", purpose: "Mail", builtin: true }], calls,
    api: {
      "GET /v1/mail/businesses": { businesses: [BIZ(), TEA] },
      [`GET ${B}`]: { business: BIZ() },
      [`GET ${B}/messages?folder=inbox`]: MESSAGES(),
      [`GET ${B}/threads/t1`]: THREAD(),
      [`GET ${B}/rules`]: { rules: RULES },
      ...(o.api ?? {}),
    },
  });
  const s = await buildBotsScreen({
    screenId, client: o.client ?? "phone", params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(DRAWS), desk: { pages: false, notes: false },
  }, deps);
  const root = s.root as Node;
  const nodes = walk(root);
  const flat = (a: unknown): ActionSpec[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as ActionSpec & { actions?: unknown[]; then?: unknown; else?: unknown; onSuccess?: unknown };
    return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else), ...flat(x.onSuccess)];
  };
  const fromPage = (s as unknown as { back?: unknown; backRight?: Node }).backRight;
  const all = fromPage ? [...nodes, ...walk(fromPage)] : nodes;
  return {
    s, calls, nodes: all, lint: lintTree(root),
    state: (s as unknown as { state?: Record<string, unknown> }).state ?? {},
    texts: all.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    fields: all.filter((n) => n.type === "TextField").map((n) => (n.bind as { value: string }).value),
    every: () => all.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat),
  };
}
const callsOf = (acts: ActionSpec[]) => acts.filter((a) => a.kind === "callEndpoint") as Array<Extract<ActionSpec, { kind: "callEndpoint" }>>;
const navs = (acts: ActionSpec[]) => acts.filter((a) => a.kind === "navigate") as Array<{ screenId: string; params: Record<string, string>; replace?: boolean }>;

describe("the mailbox", () => {
  it("shows a folder's conversations under a chip per folder and per domain, newest first, with who, what, when and what the AI did", async () => {
    const p = await build("bots.mail.inbox", { b: "leaf-co", folder: "inbox" });
    expect(p.lint).toEqual([]);
    expect(p.calls.some((c) => c.path === `${B}/messages?folder=inbox`)).toBe(true);
    const t = p.texts;
    // The folders, the Inbox read as All mail, with what is unread.
    expect(t).toEqual(expect.arrayContaining(["All mail 2", "Hello", "Support 1", "Drafts", "Sent", "Trash"]));
    // A chip per domain once there are several.
    expect(t).toEqual(expect.arrayContaining(["leafandco.in", "teahouse.in"]));
    // Each conversation: who, how many, the subject, the start of the last message, and the AI's tag or a star.
    expect(t).toEqual(expect.arrayContaining(["Asha", "3", "Where is my order?", "Hi, I ordered on Monday…", "AI draft", "ravi@customer.test", "Thanks!", "Starred"]));
    const opens = navs(p.every()).filter((a) => a.screenId === "bots.mail.thread");
    expect(opens.map((a) => a.params)).toEqual([{ b: "leaf-co", tid: "t1", folder: "inbox" }, { b: "leaf-co", tid: "t2", folder: "inbox" }]);
    // A folder chip replaces the screen, so going back leaves the mailbox.
    const sup = navs(p.every()).find((a) => a.screenId === "bots.mail.inbox" && a.params.folder === "f-sup")!;
    expect(sup).toMatchObject({ params: { b: "leaf-co", folder: "f-sup" }, replace: true });
    expect(navs(p.every()).some((a) => a.screenId === "bots.mail.compose")).toBe(true);
  });

  it("shows an alias's own mail, and pages through a long folder", async () => {
    const sup = FOLDERS[2]!;
    const p = await build("bots.mail.inbox", { b: "leaf-co", folder: "f-sup", page: "1" }, { api: { [`GET ${B}/messages?folder=f-sup&page=1`]: MESSAGES(sup, { page: 1, more: true }) } });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Support", "Mail to support@leafandco.in", "Newer", "Older"]));
    const pages = navs(p.every()).filter((a) => a.screenId === "bots.mail.inbox" && a.params.folder === "f-sup").map((a) => a.params.page ?? "0");
    expect(pages).toEqual(expect.arrayContaining(["0", "2"]));
  });

  it("says plainly when a folder is empty, and when the mailbox can't be read", async () => {
    const empty = await build("bots.mail.inbox", { b: "leaf-co", folder: "trash" }, { api: { [`GET ${B}/messages?folder=trash`]: MESSAGES(FOLDERS[5], { messages: [], total: 0 }) } });
    expect(empty.texts).toContain("Nothing in Trash.");
    const down = await build("bots.mail.inbox", { b: "leaf-co", folder: "junk" });
    expect(down.texts).toContain("The mailbox couldn't be read just now. Pull to try again.");
    expect(down.lint).toEqual([]);
  });

  it("never passes an unknown folder through: it reads All mail", async () => {
    const p = await build("bots.mail.inbox", { b: "leaf-co", folder: "../overview" });
    expect(p.calls.some((c) => c.path === `${B}/messages?folder=inbox`)).toBe(true);
    expect(p.calls.some((c) => c.path.includes("overview"))).toBe(false);
  });

  it("draws in the window too", async () => {
    const p = await build("bots.mail.inbox", { b: "leaf-co", folder: "inbox" }, { client: "desktop" });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Where is my order?");
  });
});

describe("one conversation", () => {
  it("reads oldest first, whole, with its attachments, what to do with it, and the AI's draft a tap away", async () => {
    const p = await build("bots.mail.thread", { b: "leaf-co", tid: "t1", folder: "inbox" });
    expect(p.lint).toEqual([]);
    const t = p.texts;
    expect(t.indexOf("Hi, I ordered on Monday. Where is it?")).toBeLessThan(t.indexOf("It ships tomorrow."));
    expect(t).toEqual(expect.arrayContaining(["receipt.pdf", "51 KB", "1 attachment", "Archive", "Delete", "Spam", "Mark unread", "Star", "The AI drafted a reply.", "See the draft", "Reply", "Forward"]));
    const posts = callsOf(p.every()).filter((c) => c.method === "POST").map((c) => c.path);
    expect(posts).toEqual(expect.arrayContaining([`${B}/threads/t1/archive`, `${B}/threads/t1/trash`, `${B}/threads/t1/junk`, `${B}/threads/t1/unread`, `${B}/threads/t1/star`]));
    expect(navs(p.every()).find((a) => a.screenId === "bots.mail.reply")?.params).toEqual({ b: "leaf-co", run: "7" });
    // A reply answers the last message someone else sent; a forward carries the last message.
    const writes = navs(p.every()).filter((a) => a.screenId === "bots.mail.compose").map((a) => a.params);
    expect(writes).toEqual(expect.arrayContaining([{ b: "leaf-co", tid: "t1", re: "m1" }, { b: "leaf-co", tid: "t1", fwd: "m2" }]));
  });

  it("offers Back to inbox for one in Trash or Spam", async () => {
    const p = await build("bots.mail.thread", { b: "leaf-co", tid: "t1", folder: "trash" }, { api: { [`GET ${B}/threads/t1`]: THREAD({ where: ["trash"], ai: undefined }) } });
    expect(p.texts).toContain("Back to inbox");
    expect(p.texts).not.toContain("Archive");
    expect(callsOf(p.every()).some((c) => c.path === `${B}/threads/t1/inbox`)).toBe(true);
  });

  it("says so when it was deleted", async () => {
    const p = await build("bots.mail.thread", { b: "leaf-co", tid: "gone1", folder: "inbox" });
    expect(p.texts).toContain("This conversation was deleted.");
    expect(p.lint).toEqual([]);
  });
});

describe("writing", () => {
  it("writes new mail from any of the domain's addresses, and the AI writes it from what they ask", async () => {
    const p = await build("bots.mail.compose", { b: "leaf-co" });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["New email", "hello@leafandco.in", "support@leafandco.in", "Write with AI", "Send"]));
    expect(p.fields).toEqual(expect.arrayContaining(["cm_to", "cm_cc", "cmw.subject", "cmw.text", "cm_ask"]));
    expect(p.state).toMatchObject({ cm_from: "hello@leafandco.in", cm_to: "", cmw: { text: "", subject: "" } });
    const send = callsOf(p.every()).find((c) => c.path === `${B}/send`)!;
    expect(send.body).toEqual({ from: "$state.cm_from", to: "$state.cm_to", cc: "$state.cm_cc", subject: "$state.cmw.subject", text: "$state.cmw.text" });
    const write = callsOf(p.every()).find((c) => c.path === `${B}/write`)!;
    expect(write).toMatchObject({ assignTo: "cmw", body: { instruction: "$state.cm_ask", from: "$state.cm_from" } });
  });

  it("replies from the address it was sent to, to the sender, with Re: and the AI's quick answers", async () => {
    const p = await build("bots.mail.compose", { b: "leaf-co", tid: "t1", re: "m1" });
    expect(p.lint).toEqual([]);
    expect(p.state).toMatchObject({ cm_from: "support@leafandco.in", cm_to: "Asha <asha@customer.test>", cm_subject: "Re: Where is my order?" });
    expect(p.texts).toEqual(expect.arrayContaining(["Reply", "Answer it", "Say no, kindly", "Hi, I ordered on Monday. Where is it?"]));
    expect(p.texts.some((x) => x.startsWith("Replying to Asha, "))).toBe(true);
    const send = callsOf(p.every()).find((c) => c.path === `${B}/send`)!;
    expect(send.body).toMatchObject({ subject: "$state.cm_subject", replyTo: "m1" });
    expect(callsOf(p.every()).filter((c) => c.path === `${B}/write`).every((c) => (c.body as { replyTo?: string }).replyTo === "m1")).toBe(true);
  });

  it("forwards with Fwd: and a note, without the AI", async () => {
    const p = await build("bots.mail.compose", { b: "leaf-co", tid: "t1", fwd: "m2" });
    expect(p.state).toMatchObject({ cm_to: "", cm_subject: "Fwd: Where is my order?" });
    expect(p.texts).toContain("Your note");
    expect(p.texts).not.toContain("Write with AI");
    expect(callsOf(p.every()).find((c) => c.path === `${B}/send`)?.body).toMatchObject({ forward: "m2" });
  });
});

describe("a domain's addresses and rules", () => {
  it("lists every address with its folder and how it answers, and adds an alias with its folder", async () => {
    const p = await build("bots.mail.addresses", { b: "leaf-co" });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Addresses", "leafandco.in", "hello@leafandco.in", "The main address · Drafts for you", "support@leafandco.in", "Support folder · Sends by itself", "Add address"]));
    // The domain in a sentence: a text that starts with "@" is read as a mention by the apps.
    expect(p.texts.some((t) => t.startsWith("@"))).toBe(false);
    expect(p.texts).toContain("The part before @leafandco.in, and its folder's name. Add as many as you need.");
    expect(p.fields).toEqual(expect.arrayContaining(["ma_local", "ma_label"]));
    expect(callsOf(p.every()).find((c) => c.method === "POST" && c.path === `${B}/addresses`)?.body).toEqual({ local: "$state.ma_local", label: "$state.ma_label" });
    expect(navs(p.every()).filter((a) => a.screenId === "bots.mail.address").map((a) => a.params.aid)).toEqual(["1", "2"]);
  });

  it("changes one address: its folder, its name, how the AI answers it and its auto-reply; removes an alias on a second yes", async () => {
    const withAuto = BIZ({ addresses: [address(1, "hello"), address(2, "support", { label: "Support", autoReply: { enabled: true, subject: "Got it", body: "Back soon.", days: 3 } })] });
    const p = await build("bots.mail.address", { b: "leaf-co", aid: "2" }, { api: { [`GET ${B}`]: { business: withAuto } } });
    expect(p.lint).toEqual([]);
    expect(p.state).toMatchObject({ ma_label: "Support", ma_auto: true, ma_subject: "Got it", ma_body: "Back soon.", ma_days: "3", ma_sure: false });
    const puts = callsOf(p.every()).filter((c) => c.method === "PUT" && c.path === `${B}/addresses/2`);
    expect(puts.map((c) => c.body)).toEqual(expect.arrayContaining([{ aiMode: "draft" }, { aiMode: "send" }, { aiMode: "off" }]));
    expect(puts.find((c) => "autoReplyEnabled" in (c.body as object))?.body).toEqual({
      label: "$state.ma_label", displayName: "$state.ma_name", autoReplyEnabled: "$state.ma_auto", autoReplySubject: "$state.ma_subject", autoReplyBody: "$state.ma_body", autoReplyDays: "$state.ma_days",
    });
    expect(p.texts).toContain("Remove support@leafandco.in");
    expect(callsOf(p.every()).some((c) => c.method === "DELETE" && c.path === `${B}/addresses/2`)).toBe(true);
    // The main address has no folder of its own to rename, and is never removed.
    const main = await build("bots.mail.address", { b: "leaf-co", aid: "1" });
    expect(main.fields).not.toContain("ma_label");
    expect(main.texts).not.toContain("Remove hello@leafandco.in");
  });

  it("shows each rule as a sentence, turned on or off and removed, and adds one from a condition and an action", async () => {
    const p = await build("bots.mail.rules", { b: "leaf-co" });
    expect(p.lint).toEqual([]);
    expect(p.texts).toEqual(expect.arrayContaining(["Rules for leafandco.in", "When From contains \"invoice\": move to Billing", "Turn off", "Turn on", "Add rule"]));
    const c = callsOf(p.every());
    expect(c.some((x) => x.method === "POST" && x.path === `${B}/rules/1/toggle`)).toBe(true);
    expect(c.some((x) => x.method === "DELETE" && x.path === `${B}/rules/2`)).toBe(true);
    expect(c.find((x) => x.method === "POST" && x.path === `${B}/rules`)?.body).toEqual({ field: "$state.mr_field", op: "contains", value: "$state.mr_value", action: "$state.mr_action", target: "$state.mr_target" });
  });
});
