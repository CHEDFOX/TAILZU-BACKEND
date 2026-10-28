/**
 * THE "TURN ON NOTIFICATIONS" ASK IN THE BOTS APP (screens/pushAsk.ts, routes/botsPushAsk.ts; docs/bots-gaps.md A5), and the
 * first-day Home's living header (A9):
 *
 *   - on a phone's Home, once a bot is working or needs the person: a card that says why, then the system's own ask; it reads the
 *     phone's answer as the page appears and shows only while notifications are not allowed
 *   - answered (allowed or Not now) it never comes back; never on a window, never with nothing going on, never over the first-arrival card
 *   - What pings you says when this phone has notifications off, with a way to turn them on
 *   - the first-day Home has Home's own header: the greeting, the bold time-aware line, the living mark and the compact bar
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { registerBotsPushAskRoutes, PUSH_ASK_ROUTE } = await import("../src/routes/botsPushAsk.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { dayLineAfterGreeting } = await import("../src/experience/settingsWords.js");
const { dayPart } = await import("../src/experience/touches.js");
const { FIXED_NOW, SAMPLE_BOTS, SAMPLE_JOBS } = await import("../src/experience/bots/fixtures.js");

const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
const json = (n: unknown): string => JSON.stringify(n);
const req = (screenId: string, client: "phone" | "desktop", can: string[] = []) => ({
  screenId, client, params: {}, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya Sharma" },
  can: new Set(["BotsKit", ...can]), desk: { pages: client === "desktop", notes: false },
});
const HOME = { "GET /v1/shell/started": { started: true }, "GET /v1/bots/first-run/arrival": { due: false }, "GET /v1/bots/push-ask": { due: true } };
const appearing = (n: Node) => walk(n).map((x) => x.on?.onAppear).filter(Boolean) as ActionSpec[];
const flat = (a: unknown): Array<Record<string, unknown>> => {
  if (!a || typeof a !== "object") return [];
  const o = a as Record<string, unknown>;
  return [o, ...(Array.isArray(o.actions) ? o.actions.flatMap(flat) : []), ...flat(o.onGranted), ...flat(o.onDenied)];
};

describe("the routes", () => {
  it("are due until answered, once, and need a session", async () => {
    const app = Fastify();
    registerBotsPushAskRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } } });
    const auth = { authorization: "Bearer push-u1" };
    expect((await app.inject({ method: "GET", url: PUSH_ASK_ROUTE })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: PUSH_ASK_ROUTE, headers: auth })).json()).toEqual({ due: true });
    expect((await app.inject({ method: "PUT", url: PUSH_ASK_ROUTE, headers: auth, payload: { answer: "dismissed" } })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: PUSH_ASK_ROUTE, headers: auth })).json()).toEqual({ due: false });
    expect((await app.inject({ method: "GET", url: PUSH_ASK_ROUTE, headers: { authorization: "Bearer push-u2" } })).json()).toEqual({ due: true });
  });
});

describe("Home's ask", () => {
  it("on a phone with a bot working: reads the phone's answer as Home appears, asks the system, and is answered for good", async () => {
    const s = await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: HOME }));
    expect(lintTree(s.root!)).toEqual([]);
    expect(s.state).toMatchObject({ pushGranted: null, pushAsked: false });
    expect(appearing(s.root!)).toContainEqual({ kind: "checkPermission", permission: "notifications", assignTo: "pushGranted" });
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Get a ping when a bot needs you", "Turn on notifications", "Not now"]));
    const working = await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: HOME, tasks: [], jobs: SAMPLE_JOBS.filter((j) => j.state !== "waiting_for_you") }));
    expect(texts(working.root!)).toContain("Get a ping when it's done");
    const card = walk(s.root!).find((n) => !!n.visibleIf && json(n.visibleIf).includes("pushGranted") && texts(n).includes("Turn on notifications"))!;
    expect(card.visibleIf).toEqual({ all: [{ eq: ["pushGranted", false] }, { falsy: "pushAsked" }] });
    const all = walk(card).flatMap((n) => flat(n.on?.onPress));
    const ask = all.find((a) => a.kind === "requestPushPermission")!;
    expect(flat(ask.onGranted)).toContainEqual(expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/bots/push-ask", body: { answer: "granted" } }));
    expect(flat(ask.onDenied)).toContainEqual(expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/bots/push-ask", body: { answer: "dismissed" } }));
    expect(all).toContainEqual(expect.objectContaining({ kind: "callEndpoint", method: "PUT", path: "/v1/bots/push-ask", body: { answer: "dismissed" } }));
  });

  it("not once answered, not on a window, not with nothing going on, not over the first-arrival card", async () => {
    const none = (s: { root?: Node }) => !texts(s.root!).some((t) => t.startsWith("Get a ping")) && !appearing(s.root!).some((a) => a.kind === "checkPermission");
    expect(none(await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: { ...HOME, "GET /v1/bots/push-ask": { due: false } } })))).toBe(true);
    expect(none(await buildBotsScreen(req("bots.home", "desktop"), fakeDeps({ api: HOME })))).toBe(true);
    expect(none(await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: HOME, jobs: [], tasks: [] })))).toBe(true);
    expect(none(await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: { ...HOME, "GET /v1/bots/first-run/arrival": { due: true } } })))).toBe(true);
    // A read that failed: not due.
    expect(none(await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: { "GET /v1/shell/started": { started: true } } })))).toBe(true);
  });
});

describe("What pings you", () => {
  it("says when this phone has notifications off, and turns them on without answering the Home ask", async () => {
    const api = { [`GET /v1/you/notify?tz=${IST}`]: { settings: { monthLimitPaise: 50000, stopAtLimit: false, notify: { done: "quiet", summary: true, summaryAt: 1260, quiet: true, quietFrom: 1380, quietTo: 420, botsOff: [] }, privacy: { screenPictures: "ask" } }, today: null, line: null } };
    const s = await buildBotsScreen(req("bots.notify", "phone"), fakeDeps({ api }));
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts(s.root!)).toContain("Notifications are off on this phone");
    expect(appearing(s.root!)).toContainEqual({ kind: "checkPermission", permission: "notifications", assignTo: "pushGranted" });
    const ask = walk(s.root!).flatMap((n) => flat(n.on?.onPress)).find((a) => a.kind === "requestPushPermission")!;
    expect(json(ask)).not.toContain("/v1/bots/push-ask");
    const desk = await buildBotsScreen(req("bots.notify", "desktop"), fakeDeps({ api }));
    expect(texts(desk.root!)).not.toContain("Notifications are off on this phone");
  });
});

describe("the first-day Home", () => {
  it("has Home's own living header", async () => {
    const line = dayLineAfterGreeting(dayPart(IST, FIXED_NOW)).en;
    const fresh = { api: { "GET /v1/shell/started": { started: false } }, bots: SAMPLE_BOTS.filter((b) => b.builtin), jobs: [], tasks: [] };
    for (const client of ["phone", "desktop"] as const) {
      const live = await buildBotsScreen(req("bots.home", client, ["BotsMotion", "WriteOn", "LiveMark", "HeadBar"]), fakeDeps(fresh));
      expect(lintTree(live.root!)).toEqual([]);
      const nodes = walk(live.root!);
      expect(nodes.some((n) => n.type === "WriteOn" && json(n.props).includes(line.slice(0, 20)))).toBe(true);
      expect(nodes.some((n) => n.type === "LiveMark")).toBe(true);
      expect(json(live.root)).toContain('"type":"HeadBar"');
      expect(texts(live.root!)).toEqual(expect.arrayContaining(["Good evening, Aanya", "Hi Aanya, I'm Blip"]));
      // Still, for a build without the living header: the same words.
      const still = await buildBotsScreen(req("bots.home", client), fakeDeps(fresh));
      expect(lintTree(still.root!)).toEqual([]);
      expect(texts(still.root!)).toEqual(expect.arrayContaining(["Good evening, Aanya", line, "Make your first bot"]));
    }
  });
});
