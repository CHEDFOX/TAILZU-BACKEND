/**
 * SRIBBU (screens/bots/sribbu.ts): the mail bot, the meeting bot and Notes as ONE bot, slug "mail". One entry wherever bots
 * are listed, one page with Inbox, Meetings and Notes under its name, and an ask about a meeting goes to it. Talk is the
 * screen every bot answers in, not one of the bots, so no list of bots shows it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { resetConfigForTests } = await import("../src/config.js");
const { builtinBots, builtinBot } = await import("../src/bots/builtin.js");
const { scoreBots } = await import("../src/bots/door.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { walk } = await import("../src/experience/bots/lint.js");
const { sribbuParts } = await import("../src/experience/bots/screens/bots/sribbu.js");

const CTX = { attachments: [], recent: [], mode: "text" as const };
const ENV = { MAIL_WORKER_URL: "https://mail.test", MAIL_WORKER_SECRET: "s", RECALL_API_KEY: "r" } as const;
const on = (keys: ReadonlyArray<keyof typeof ENV>) => { for (const k of Object.keys(ENV)) delete process.env[k]; for (const k of keys) process.env[k] = ENV[k]; resetConfigForTests(); };
afterEach(() => on([]));

const BOT = { slug: "mail", name: "Sribbu", colour: "sand", builtin: true, publicCard: false, tone: "", principles: [], purpose: "x", skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] } };
const API = {
  "GET /v1/bots/mail": { bot: BOT }, "GET /v1/bots/mail/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/mail/connectors": { connectors: [] },
  "GET /v1/notes?limit=100": { notes: [{ id: "n1", title: "Weekly sync", summary: "Launch moved.", startedAt: "2026-11-20T10:00:00Z", durationSeconds: 1800, status: "ready", todos: 1, openTodos: 1, decisions: 0, people: [] }] },
};
const screen = (client: "phone" | "desktop", params: Record<string, string>, bots = [{ slug: "mail", name: "Sribbu", colour: "sand", purpose: "x", builtin: true }]) => buildBotsScreen({
  screenId: SCREENS.bot, client, params, tzOffsetMinutes: IST, user: { id: "u-aanya", name: "Aanya" },
  can: { has: () => true } as unknown as Set<string>, desk: { pages: client === "desktop", notes: true },
}, fakeDeps({ api: API, bots }));
const words = (n: unknown) => JSON.stringify(n);

describe("one bot", () => {
  it("is listed once, as Sribbu, where its mail or its meetings are set up; the meeting bot is never listed on its own", () => {
    on(["MAIL_WORKER_URL", "MAIL_WORKER_SECRET", "RECALL_API_KEY"]);
    const listed = builtinBots();
    expect(listed.filter((b) => b.slug === "mail").map((b) => b.name)).toEqual(["Sribbu"]);
    expect(listed.map((b) => b.slug)).not.toContain("meet");
    on(["RECALL_API_KEY"]);
    expect(builtinBots().map((b) => b.slug)).toContain("mail");
    on([]);
    expect(builtinBots().map((b) => b.slug)).not.toContain("mail");
  });

  it("the meeting bot still opens by its slug, with Sribbu's name, so an old link or notice still works", () => {
    on(["RECALL_API_KEY"]);
    expect(builtinBot("meet")?.name).toBe("Sribbu");
  });

  it("an ask about a meeting goes to Sribbu, and so does an ask by its name", () => {
    on(["MAIL_WORKER_URL", "MAIL_WORKER_SECRET", "RECALL_API_KEY"]);
    const defs = builtinBots();
    expect(scoreBots("summarise the notes from yesterday's meeting with Riya", defs, CTX)[0]?.bot.slug).toBe("mail");
    expect(scoreBots("Sribbu, what needs me today?", defs, CTX)[0]?.bot.slug).toBe("mail");
  });
});

describe("one page", () => {
  it("has Inbox, Meetings and Notes as parts where each is set up", () => {
    on(["MAIL_WORKER_URL", "MAIL_WORKER_SECRET", "RECALL_API_KEY"]);
    const ctx = { client: "phone", desk: { pages: false, notes: false } } as never;
    expect(sribbuParts(ctx)).toEqual(["inbox", "meetings", "notes"]);
    on(["RECALL_API_KEY"]);
    expect(sribbuParts(ctx)).toEqual(["meetings", "notes"]);
    expect(sribbuParts({ client: "desktop", desk: { pages: true, notes: false } } as never)).toEqual(["meetings"]);
  });

  it("opens on the inbox with the parts as tabs, and Notes is a tap away under the same name", async () => {
    on(["MAIL_WORKER_URL", "MAIL_WORKER_SECRET"]);
    const inbox = await screen("phone", { slug: "mail" });
    expect(words(inbox)).toContain("Sribbu");
    expect(words(inbox)).toContain("\"part\":\"notes\"");
    const notes = await screen("phone", { slug: "mail", part: "notes" });
    expect(words(notes)).toContain("Weekly sync");
    expect(words(notes)).toContain("Sribbu");
    expect(words(notes)).toContain("\"part\":\"inbox\"");
  });
});

describe("the lists", () => {
  const bots = [
    { slug: "talk", name: "Talk", colour: "slate", purpose: "x", builtin: true },
    { slug: "plan", name: "Nudj", colour: "ochre", purpose: "x", builtin: true },
    { slug: "mail", name: "Sribbu", colour: "sand", purpose: "x", builtin: true },
  ];
  it("the window's sidebar shows no Talk among the bots, and no Notes of its own once Sribbu is there", async () => {
    const s = await buildBotsScreen({
      screenId: SCREENS.start, client: "desktop", params: {}, tzOffsetMinutes: IST, user: { id: "u-aanya", name: "Aanya" },
      can: { has: () => true } as unknown as Set<string>, desk: { pages: true, notes: true },
    }, fakeDeps({ bots }));
    const labels = walk(s.root!).filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
    expect(labels).toContain("Nudj");
    expect(labels).toContain("Sribbu");
    // Talk is the first tab, once; never again among the bots.
    expect(labels.filter((l) => l === "Talk")).toHaveLength(1);
    expect(labels).not.toContain("Notes");
  });
});
