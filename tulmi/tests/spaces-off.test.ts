/**
 * SPACES SWITCHED OFF, AND BACK ON (SPACES_ENABLED, src/botsBots/spacesSwitch.ts; docs/spaces.md "Turning Spaces off").
 *
 * Off, the app simply has no Spaces:
 *   - every Spaces and Work in space route answers 404 spaces_off, before the session; reporting and blocking stay on
 *   - a link or a notification into one of its screens opens Home; Home has no Space card, You and Settings no Spaces, a bot's page
 *     no Work in space, a thing no "Share with a space or person"; the bootstrap neither warms its pages nor offers it on a long press
 *   - none of its pushes or invite mails go; the widgets have no From your people; nothing a space gave someone shows on their days
 * On again, everything is there as it was: nothing was deleted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const pushes = vi.hoisted(() => [] as Array<{ userId: string; kind: string; vars: Record<string, string>; data: Record<string, string> }>);
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  const { signedIn } = await import("./spaces-rig.js");
  return { ...real, resolveUser: async (h: string | undefined) => signedIn(h) };
});
vi.mock("../src/push/index.js", () => ({
  pushEngine: () => ({ notify: async (userId: string, msg: { kind: string; vars: Record<string, string>; data: Record<string, string> }) => { pushes.push({ userId, kind: msg.kind, vars: msg.vars, data: msg.data }); return null; } }),
}));

const { resetConfigForTests } = await import("../src/config.js");
const { A_, M_, AREA, spacesServer } = await import("./spaces-rig.js");
const { spacesOn, isSpacesScreen, isSpacePush } = await import("../src/botsBots/spacesSwitch.js");
const { buildBotsScreen, botsWarmScreenIds } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, ctxFor } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { shareButtonsFor } = await import("../src/experience/bots/shareAction.js");
const { buildBootstrap } = await import("../src/experience/bootstrap/bootstrap.js");
const { PushEngine, setPushGate } = await import("../src/push/engine.js");
const { MemoryPushStore } = await import("../src/push/store.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { MailOutbox } = await import("../src/botsBots/mail.js");
const { MemoryPaged } = await import("../src/botsBots/spaceRows.js");
const { buildNow } = await import("../src/widgets/now.js");
const { WIDGETS_DEFAULTS } = await import("../src/widgets/defaults.js");
const { Calendar, resetCalendarForTests } = await import("../src/calendar/index.js");
const { sampleApi } = await import("./bots-bots-data.js");
const D = await import("./spaces-data.js");

/** SPACES_ENABLED=false, as deploy/set-env.sh writes it; the config is read afresh. */
const switchOff = () => { vi.stubEnv("SPACES_ENABLED", "false"); resetConfigForTests(); };
const switchOn = () => { vi.unstubAllEnvs(); resetConfigForTests(); };
afterEach(switchOn);

describe("the switch", () => {
  it("is on unless SPACES_ENABLED says false", () => {
    expect(spacesOn()).toBe(true);
    switchOff();
    expect(spacesOn()).toBe(false);
    vi.stubEnv("SPACES_ENABLED", "true");
    resetConfigForTests();
    expect(spacesOn()).toBe(true);
  });

  it("knows Spaces' own screens and pushes, those added later too", () => {
    for (const id of ["bots.spaces", "bots.space.tasks", "bots.space.item", "bots.space.anything-new", "bots.share", "bots.work", "bots.chats", "bots.thread", "bots.person"]) expect(isSpacesScreen(id), id).toBe(true);
    for (const id of ["bots.home", "bots.you", "bots.plan", "bots.share-in", "bots.report", "bots.blocked", "bots.you.space", "bots.notes"]) expect(isSpacesScreen(id), id).toBe(false);
    for (const k of ["space_task", "space_plan", "space_message", "space_joined", "space_request", "space_accepted", "space_feed", "space_ask"]) expect(isSpacePush(k), k).toBe(true);
    for (const k of ["approval", "plan_reminder", "code_job_done", "bots_summary"]) expect(isSpacePush(k), k).toBe(false);
  });
});

// ===================================================================== the routes

describe("the routes", () => {
  /** A route's path with every :param filled: the family's space where it is a space, else a word. */
  const fill = (url: string, home: string) => url.replace(/:id\b/g, home).replace(/:[A-Za-z]+/g, "x");
  /** Reporting and blocking (routes/bots/safety.ts) are registered with Spaces' parts but are not Spaces: they stay on. */
  const SAFETY = /^(\/v1\/botsapp\/bots\/(people|blocks|reports)|\/v1\/admin\/)/;

  it("off: every Spaces and Work in space route answers 404 spaces_off, signed in or not; on again, the family is all there", async () => {
    const routes: Array<{ method: string; url: string }> = [];
    const s = await spacesServer({ pushes, routes });
    const home = await s.family();
    const listed = routes.filter((r) => r.method !== "HEAD" && !SAFETY.test(r.url) && r.url.startsWith("/v1/"));
    // The whole area: the spaces, the invite page, sharing, shared things, payments, tasks, chats, and Work in space.
    expect(listed.length).toBeGreaterThan(50);
    for (const prefix of [`${AREA}/spaces`, `${AREA}/invite/`, `${AREA}/share/targets`, `${AREA}/shares`, `${AREA}/items/`, `${AREA}/tasks/given`, `${AREA}/threads`, `${AREA}/work/`]) {
      expect(listed.some((r) => r.url.startsWith(prefix)), prefix).toBe(true);
    }

    switchOff();
    for (const r of listed) {
      const url = fill(r.url, home);
      const body = r.method === "GET" || r.method === "DELETE" ? undefined : {};
      for (const who of [A_, null]) {
        const res = await s.call(r.method as "GET", url, who, body);
        expect(res.status, `${r.method} ${url}`).toBe(404);
        expect(res.body, `${r.method} ${url}`).toEqual({ code: "spaces_off", message: "Spaces isn't on yet." });
      }
    }
    // Reporting and blocking are not Spaces' and stay on.
    expect((await s.call("GET", `${AREA}/blocks`, A_)).status).toBe(200);
    // The browser's page for an invite's link is still a page, saying it doesn't work: it names no space.
    const page = await s.call("GET", "/s/bots.spaces?join=ABC234", null);
    expect(page.status).toBe(200);
    expect(String(page.body)).toContain("This invite doesn't work any more.");
    expect(String(page.body)).not.toContain("Open in X0 Bot");

    switchOn();
    const back = await s.call("GET", `${AREA}/spaces`, M_);
    expect(back.status).toBe(200);
    expect(back.body.spaces.map((x: { id: string; name: string }) => [x.id, x.name])).toEqual([[home, "Home"]]);
    expect(back.body.spaces[0].members).toHaveLength(3);
    expect((await s.call("GET", `${AREA}/spaces/${home}/feed`, M_)).status).toBe(200);
    expect(String((await s.call("GET", "/s/bots.spaces?join=ABC234", null)).body)).toContain("Open in X0 Bot");
  });
});

// ===================================================================== the screens

type Client = "phone" | "desktop";
const NEW = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "PersonBot", "FontBricolage"];
const canOf = (client: Client): string[] => [...NEW, client === "phone" ? "ActionParams" : "DeskTalkTo"];

async function draw(screenId: string, client: Client, o: { params?: Record<string, string> } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const s = await buildBotsScreen(
    { screenId, client, params: o.params ?? {}, tzOffsetMinutes: IST, user: { id: "u", name: "Aanya" }, can: new Set(canOf(client)), desk: { pages: client === "desktop", notes: client === "desktop" } },
    fakeDeps({ api: { ...(await sampleApi()), ...D.spacesApi() }, calls }),
  );
  const nodes = walk(s.root!);
  expect(lintTree(s.root!), `${screenId} ${client}`).toEqual([]);
  const texts = nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
  return { s, nodes, texts, paths: calls.map((c) => c.path) };
}
const tilesOf = (nodes: Node[]) => (nodes.find((n) => n.type === "BotTiles")?.props?.tiles ?? []) as Array<{ slug: string; name: string }>;
const spacesReads = (paths: string[]) => paths.filter((p) => p.startsWith(`${AREA}/spaces`) || p.startsWith(`${AREA}/work`) || p.startsWith(`${AREA}/threads`));

describe("the screens", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`on the ${client}: Home has its Space card while on, and none (nor a read of Spaces) while off`, async () => {
      const on = await draw("bots.home", client);
      expect(tilesOf(on.nodes).filter((t) => t.name === "Space")).toHaveLength(1);
      expect(on.paths).toContain(`${AREA}/spaces?last=1`);
      switchOff();
      const off = await draw("bots.home", client);
      expect(tilesOf(off.nodes).some((t) => t.name === "Space" || t.slug.startsWith("space"))).toBe(false);
      expect(spacesReads(off.paths)).toEqual([]);
      // The rest of Home is as it was: the bots and Make a bot.
      expect(tilesOf(off.nodes).length).toBe(tilesOf(on.nodes).length - 1);
    });

    it(`on the ${client}: a link or a notification into Spaces opens Home while off`, async () => {
      for (const [id, params] of [
        ["bots.spaces", { id: "s1" }], ["bots.space.tasks", { id: "s1" }], ["bots.space.item", { item: "i-groceries" }], ["bots.chats", {}],
        ["bots.thread", { id: "th-home" }], ["bots.work", { bot: "plan", space: "s1", owner: "m" }], ["bots.share", { kind: "text", title: "Hi" }],
      ] as const) {
        expect((await draw(id, client, { params })).s.screenId, id).toBe(id);
        switchOff();
        const off = await draw(id, client, { params });
        expect(off.s.screenId, id).toBe("bots.home");
        expect(spacesReads(off.paths), id).toEqual([]);
        switchOn();
      }
    });

    it(`on the ${client}: Settings lists Spaces and chats only while on`, async () => {
      expect((await draw("bots.settings", client)).texts).toContain("Spaces and chats");
      switchOff();
      expect((await draw("bots.settings", client)).texts).not.toContain("Spaces and chats");
    });

    it(`on the ${client}: Plan Ease's week page has Work in space only while on, and reads nothing of it while off`, async () => {
      // The week page is what Plan Ease's simpler page (PLAN_V2_PAGE) replaced: that one has no Work in space at all (below).
      vi.stubEnv("PLAN_V2_PAGE", "false"); resetConfigForTests();
      const on = await draw("bots.plan", client);
      expect(on.texts).toContain("Work in space");
      switchOff();
      const off = await draw("bots.plan", client);
      expect(off.texts).not.toContain("Work in space");
      expect(off.texts).not.toContain("Notes from your space");
      expect(spacesReads(off.paths)).toEqual([]);
    });

    it(`on the ${client}: Plan Ease's simpler page has no Work in space, and reads nothing of Spaces either way`, async () => {
      const on = await draw("bots.plan", client);
      expect(on.texts).not.toContain("Work in space");
      expect(spacesReads(on.paths)).toEqual([]);
      switchOff();
      expect(spacesReads((await draw("bots.plan", client)).paths)).toEqual([]);
    });

    it(`on the ${client}: a bot's answer has Share only while on, and Report always`, async () => {
      const on = await draw("bots.chat", client, { params: { slug: "gym-bot" } });
      expect(on.texts).toEqual(expect.arrayContaining(["Share", "Report"]));
      switchOff();
      const off = await draw("bots.chat", client, { params: { slug: "gym-bot" } });
      expect(off.texts).toContain("Report");
      expect(off.texts).not.toContain("Share");
    });

    it(`on the ${client}: something shared in goes to a bot; to a space or a person only while on`, async () => {
      const on = await draw("bots.share-in", client, { params: { text: "Dinner at 8" } });
      expect(on.texts).toContain("Share with a space or person");
      switchOff();
      const off = await draw("bots.share-in", client, { params: { text: "Dinner at 8" } });
      expect(off.texts).not.toContain("Share with a space or person");
      expect(off.texts).toContain("Send");
    });
  }

  it("on the phone: You lists Spaces and chats only while on; Blocked people has no way into Spaces while off", async () => {
    expect((await draw("bots.you", "phone")).texts).toContain("Spaces and chats");
    expect((await draw("bots.blocked", "phone")).texts).toContain("Spaces and chats");
    switchOff();
    expect((await draw("bots.you", "phone")).texts).not.toContain("Spaces and chats");
    const blocked = await draw("bots.blocked", "phone");
    expect(blocked.texts).not.toContain("Spaces and chats");
    expect(blocked.texts.join(" ")).not.toMatch(/space/i);
  });

  it("a thing's Share pill: there while on, none while off", () => {
    const item = { kind: "note" as const, title: "Standup" };
    expect(shareButtonsFor(ctxFor("bots.note", "phone"), item)).toHaveLength(1);
    expect(shareButtonsFor(ctxFor("bots.note", "phone", undefined, { spaces: false }), item)).toEqual([]);
  });
});

// ===================================================================== the bootstrap

describe("the bootstrap", () => {
  const ids = (b: ReturnType<typeof buildBootstrap>, k: string) => ((b.flags?.[k] ?? []) as Array<{ id: string }>).map((a) => a.id);

  it("warms Spaces' pages and offers Spaces on a long press only while on", () => {
    const on = buildBootstrap({ onboarded: true, botsApp: true });
    expect(on.warmScreenIds).toEqual(expect.arrayContaining(["bots.spaces", "bots.chats"]));
    expect(ids(on, "app.quickActions.ios")).toContain("spaces");
    expect(ids(on, "app.quickActions.android")).toContain("spaces");
    switchOff();
    const off = buildBootstrap({ onboarded: true, botsApp: true });
    expect(off.warmScreenIds).not.toContain("bots.spaces");
    expect(off.warmScreenIds).not.toContain("bots.chats");
    expect(off.warmScreenIds).toEqual(expect.arrayContaining(["bots.home", "bots.you", "bots.plan"]));
    expect(ids(off, "app.quickActions.ios")).toEqual(ids(on, "app.quickActions.ios").filter((x) => x !== "spaces"));
    expect(ids(off, "app.quickActions.android")).toEqual(ids(on, "app.quickActions.android").filter((x) => x !== "spaces"));
    expect(botsWarmScreenIds(true)).toContain("bots.spaces");
  });
});

// ===================================================================== what reaches the person

describe("what reaches the person", () => {
  it("no push of Spaces goes while off; every other push does; on again, they go", async () => {
    const store = new MemoryPushStore();
    store.candidatesList = [{ userId: "u", tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: 0 }], lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: 0 }];
    const sent: unknown[] = [];
    const engine = new PushEngine(store, { send: async (m) => { sent.push(...m); return m.map(() => ({ status: "ok" as const, id: "t" })); }, receipts: async () => ({}) }, () => structuredClone(PUSH_DEFAULTS), { info: () => {}, warn: () => {} });
    setPushGate(null);
    switchOff();
    for (const kind of ["space_feed", "space_task", "space_message", "space_request"] as const) {
      expect(await engine.notify("u", { kind, key: `off-${kind}`, vars: { name: "Mom", space: "Home" }, data: { id: "s1" } }), kind).toBeNull();
    }
    expect(sent).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
    await engine.notify("u", { kind: "code_needs_you", key: "j1" });
    expect(sent).toHaveLength(1);
    switchOn();
    await engine.notify("u", { kind: "space_feed", key: "on-1", vars: { name: "Mom", space: "Home" }, data: { id: "s1" } });
    expect(sent).toHaveLength(2);
  });

  it("invite mails wait in the outbox while off and never hold up the rest; on again, they go", async () => {
    const clock = { t: Date.UTC(2026, 10, 10, 6, 0) };
    const outbox = new MailOutbox(new MemoryPaged(), () => clock.t);
    const subjects: string[] = [];
    const mailer = { configured: true, async send(m: { subject: string }) { subjects.push(m.subject); } };
    await outbox.queue({ to: "mom@example.in", subject: "Aanya invited you to Home", text: "Join us", kind: "space_invite", ref: "INV12345" });
    await outbox.queue({ to: "team@example.in", subject: "A report", text: "Look at this", kind: "safety_report", ref: "r1" });
    switchOff();
    expect(await outbox.sendDue(mailer)).toBe(1);
    expect(subjects).toEqual(["A report"]);
    expect(await outbox.byRef("space_invite", "INV12345")).toMatchObject({ status: "queued", attempts: 0 });
    // Still off an hour later: it waits again.
    clock.t += 3600_000;
    expect(await outbox.sendDue(mailer)).toBe(0);
    switchOn();
    clock.t += 3600_000;
    expect(await outbox.sendDue(mailer)).toBe(1);
    expect(subjects).toEqual(["A report", "Aanya invited you to Home"]);
  });

  it("the widgets have no From your people while off, and read nothing of it", () => {
    const now = Date.UTC(2026, 9, 28, 12);
    const input = {
      now, tzOffsetMinutes: 330, inSpaces: true, tokenReady: true,
      people: { messages: [{ threadId: "t", messageId: "m", chat: "Home", chatKind: "space" as const, from: "Mom", text: "Dinner at 8?", at: now - 60_000, unread: true }], shared: [], tasks: [] },
      needs: { jobs: [], approvals: [], tasks: [], codeBotName: "Xode" },
    };
    const on = buildNow(input, WIDGETS_DEFAULTS);
    expect(on.people.on).toBe(true);
    expect(on.people.rows).toHaveLength(1);
    const off = buildNow({ ...input, spacesOff: true }, WIDGETS_DEFAULTS);
    expect(off.people).toMatchObject({ on: false, rows: [], count: 0, newCount: 0 });
    expect(off.needs.on).toBe(true);
  });

  it("what a space gave someone is off their days while off, never reminded of, and back when on", async () => {
    resetCalendarForTests();
    const clock = { t: Date.UTC(2026, 10, 10, 6, 0) };
    const cal = new Calendar({ now: () => clock.t, publish: () => undefined });
    const at = Date.UTC(2026, 10, 12, 13, 30);
    await cal.landSpace(M_, { taskId: "t1", spaceId: "s1", spaceName: "Home", kind: "plan", title: "Pick Kabir up", notes: "", place: "", at, end: at + 3600_000, allDay: false, by: A_, name: "Aanya", done: false });
    await cal.landSpace(M_, { taskId: "t2", spaceId: "s1", spaceName: "Home", kind: "task", title: "Buy milk", notes: "", place: "", at: null, end: null, allDay: false, by: A_, name: "Aanya", done: false });
    await cal.addTask(M_, { title: "Call the bank" });
    const days = { from: "2026-11-10", to: "2026-11-14", tz: 330 };
    const titles = async () => {
      const l = await cal.list(M_, days);
      return { events: l.events.map((e) => e.title), tasks: [...l.tasks, ...l.open].map((t) => t.title), open: (await cal.openTasks(M_)).map((t) => t.title) };
    };
    expect(await titles()).toEqual({ events: ["Pick Kabir up"], tasks: expect.arrayContaining(["Buy milk", "Call the bank"]), open: expect.arrayContaining(["Buy milk", "Call the bank"]) });
    switchOff();
    expect(await titles()).toEqual({ events: [], tasks: ["Call the bank"], open: ["Call the bank"] });
    // Its reminder comes due while off: nothing is sent.
    clock.t = at - 10 * 60_000;
    const sent: string[] = [];
    await cal.remind(async (_u, m) => { sent.push(m.vars.title!); });
    expect(sent).toEqual([]);
    switchOn();
    expect(await titles()).toEqual({ events: ["Pick Kabir up"], tasks: expect.arrayContaining(["Buy milk", "Call the bank"]), open: expect.arrayContaining(["Buy milk", "Call the bank"]) });
  });
});
