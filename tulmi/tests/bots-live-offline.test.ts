/**
 * Two of the apps' abilities, the server's side (docs/bots-app.md "Live views" and "Offline"):
 *
 *   - the live artifact: the host page the apps run an artifact in (src/artifacts/livehost.ts): the viewer framed and sandboxed, its one
 *     script allowed by hash, the protocol answered (load, point and change, errors, links, "not here" for saved data); GET
 *     /v1/artifacts/:id/live; Design and Live preview drawing a LiveView for a build that has one, and the parts for one that has not
 *   - the outbox: an ask from the apps' outbox is answered once (src/shell/sentAsks.ts, POST /v1/shell/ask with a clientId); the Offline
 *     screen and Home read the outbox from state; the bootstrap's offline flags
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { liveHostHtml, liveViewerOf, DEFAULT_APP_ORIGIN } = await import("../src/artifacts/livehost.js");
const { registerArtifactRoutes } = await import("../src/routes/artifacts.js");
const { Guard } = await import("../src/guard/index.js");
const { rig } = await import("./artifacts-rig.js");
const { MemorySentAskStore, STALE_MS, keptReply } = await import("../src/shell/sentAsks.js");
const { MemoryEventStore } = await import("../src/shell/events.js");
const { registerBotsShellRoutes } = await import("../src/routes/botsShell.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { BOTS_OFFLINE_FLAGS } = await import("../src/experience/bots/screens/outbox.js");
const { FACE } = await import("../src/experience/bots/kit.js");
const { ART, CODEWORK_API } = await import("./bots-codework-data.js");

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const VIEWER = "https://viewer.example";
const json = (n: unknown): string => JSON.stringify(n);

/** Every action reachable from a tree (on.*, and inside sequences and conditions). */
function actionsOf(root: Node): ActionSpec[] {
  const out: ActionSpec[] = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const x = a as ActionSpec & Record<string, unknown>;
    out.push(x);
    if (Array.isArray(x.actions)) (x.actions as unknown[]).forEach(visit);
    for (const k of ["then", "else", "onSuccess", "onError"]) visit(x[k]);
  };
  for (const n of walk(root)) for (const a of Object.values(n.on ?? {})) visit(a);
  return out;
}

// ------------------------------------------------------------------ the host page

const ARTIFACT = { id: "a1", type: "react" as const, title: "Pricing card", content: "export default () => <h1>Hi</h1>; // </script><script>alert(1)</script>", version: 2 };

/** The host page's script run in a small stand-in for its window: what it sends down to the viewer and up to the app. */
function runHost(html: string) {
  const js = /<script>([\s\S]*)<\/script><\/body>/.exec(html)![1]!;
  const down: unknown[] = [];
  const up: unknown[] = [];
  const viewer = { postMessage: (m: unknown) => down.push(m) };
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const frameListeners: Record<string, Array<() => void>> = {};
  const timers: Array<() => void> = [];
  const win: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (s: string) => up.push(JSON.parse(s)) },
    addEventListener: (t: string, f: (e: unknown) => void) => { (listeners[t] ??= []).push(f); },
  };
  const document = { getElementById: () => ({ contentWindow: viewer, addEventListener: (t: string, f: () => void) => { (frameListeners[t] ??= []).push(f); } }) };
  runInNewContext(js, { window: win, document, setTimeout: (f: () => void) => { timers.push(f); return 0; }, JSON, String, Math });
  const fromViewer = (data: unknown, source: unknown = viewer) => listeners.message!.forEach((f) => f({ source, data }));
  return { down, up, fromViewer, win, timers, frameLoad: () => frameListeners.load!.forEach((f) => f()) };
}

describe("the live artifact: the host page", () => {
  it("frames the app's viewer in a sandbox, keeps the artifact's text inside its script, and allows only that script", () => {
    const html = liveHostHtml({ viewerUrl: `${VIEWER}/any/path`, artifact: ARTIFACT, theme: "dark", pick: true, kit: { css: ":root{--tz-primary:#7c3aed}" } });
    expect(html).toContain(`src="${VIEWER}/?type=react"`);
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    // The artifact's "</script>" cannot close the page's script.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script>");
    const js = /<script>([\s\S]*)<\/script><\/body>/.exec(html)![1]!;
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(csp).toContain(`script-src 'sha256-${createHash("sha256").update(js, "utf8").digest("base64")}'`);
    for (const d of ["default-src 'none'", `frame-src ${VIEWER}`, "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) expect(csp).toContain(d);
    expect(() => liveHostHtml({ viewerUrl: "file:///x", artifact: ARTIFACT })).toThrow();
  });

  it("answers the viewer: load on ready, point and change, a pick and an error passed up, a link offered, saved data refused at once", () => {
    const h = runHost(liveHostHtml({ viewerUrl: VIEWER, artifact: ARTIFACT, theme: "light", pick: true }));
    h.fromViewer({ t: "ready", protocol: 1 });
    expect(h.down).toEqual([
      { t: "load", artifact: { id: "a1", version: 2, type: "react", title: "Pricing card", content: ARTIFACT.content }, theme: "light", kit: undefined },
      { t: "select-mode", on: true },
    ]);
    h.fromViewer({ t: "ready", protocol: 1 });
    expect(h.down).toHaveLength(2);   // ready is answered once
    h.fromViewer({ t: "rendered", version: 2, ms: 40 });
    h.fromViewer({ t: "select", elementId: "5:86", tag: "BUTTON", text: "  Choose   Pro ", rect: { x: 0, y: 0, w: 1, h: 1 } });
    h.fromViewer({ t: "error", kind: "runtime", message: "x is not defined", line: 3, col: 9, stack: "secret stack" });
    h.fromViewer({ t: "open", url: "https://example.com/a" });
    h.fromViewer({ t: "open", url: "javascript:alert(1)" });
    expect(h.up).toEqual([
      { t: "ready" },
      { t: "select", id: "5:86", tag: "button", text: "Choose Pro", name: "Button · Choose Pro" },
      { t: "error", kind: "runtime", message: "x is not defined", line: 3, col: 9 },
      { t: "open", url: "https://example.com/a" },
    ]);
    h.fromViewer({ t: "storage", reqId: "r1", op: "get", key: "k" });
    h.fromViewer({ t: "ask", reqId: "r2", prompt: "hi" });
    expect(h.down.slice(2)).toMatchObject([{ t: "storage-result", reqId: "r1", ok: false }, { t: "ask-result", reqId: "r2", ok: false }]);
    // The app switches point and change off and on, through window.tzLive, without a reload.
    (h.win.tzLive as (m: unknown) => void)({ pick: false });
    (h.win.tzLive as (m: unknown) => void)({ pick: "yes" });
    expect(h.down.at(-1)).toEqual({ t: "select-mode", on: false });
    // A message from anyone but the viewer's frame is ignored.
    h.fromViewer({ t: "select", elementId: "1:1", tag: "div", text: "" }, {});
    expect(h.up).toHaveLength(4);
  });

  it("says it failed when the viewer never starts, or is sent somewhere else", () => {
    const slow = runHost(liveHostHtml({ viewerUrl: VIEWER, artifact: ARTIFACT }));
    slow.timers.forEach((f) => f());
    expect(slow.up).toEqual([{ t: "failed", message: "The preview did not start." }]);
    const moved = runHost(liveHostHtml({ viewerUrl: VIEWER, artifact: ARTIFACT }));
    moved.frameLoad();
    moved.frameLoad();
    moved.fromViewer({ t: "rendered", version: 2, ms: 1 });
    expect(moved.up).toEqual([{ t: "failed", message: "The page went somewhere else." }]);
  });

  it("the apps' viewer comes from the settings: none, a bad address or a plain-http origin is no viewer", () => {
    expect(liveViewerOf({})).toBeNull();
    expect(liveViewerOf({ ARTIFACT_VIEWER_URL: "ftp://x" })).toBeNull();
    expect(liveViewerOf({ ARTIFACT_VIEWER_URL: VIEWER })).toEqual({ url: VIEWER, appOrigin: DEFAULT_APP_ORIGIN });
    expect(liveViewerOf({ ARTIFACT_VIEWER_URL: VIEWER, ARTIFACT_APP_ORIGIN: "https://apps.example/some/path" })).toEqual({ url: VIEWER, appOrigin: "https://apps.example" });
    expect(liveViewerOf({ ARTIFACT_VIEWER_URL: VIEWER, ARTIFACT_APP_ORIGIN: "http://apps.example" })).toBeNull();
  });
});

describe("GET /v1/artifacts/:id/live", () => {
  async function served(viewer: { url: string; appOrigin: string } | null) {
    const r = rig();
    const app = Fastify();
    registerArtifactRoutes(app, { guard: new Guard(), rateLimit: RL, artifacts: { service: r.service }, viewer });
    await app.ready();
    const made = await app.inject({ method: "POST", url: "/v1/artifacts", headers: who("alice"), payload: { type: "html", title: "Poll", content: "<main><h1>Poll</h1><button>Vote</button></main>" } });
    return { app, id: made.json().artifact.id as string };
  }

  it("is the owner's: the page with the viewer framed, and the origin it runs as", async () => {
    const { app, id } = await served({ url: VIEWER, appOrigin: DEFAULT_APP_ORIGIN });
    const r = await app.inject({ method: "GET", url: `/v1/artifacts/${id}/live?pick=1&theme=dark`, headers: who("alice") });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    const b = r.json();
    expect(b).toMatchObject({ origin: DEFAULT_APP_ORIGIN, version: 1 });
    expect(b.html).toContain(`src="${VIEWER}/?type=html"`);
    expect(b.html).toContain('"pick":true');
    expect(b.html).toContain('"theme":"dark"');
    expect((await app.inject({ method: "GET", url: `/v1/artifacts/${id}/live`, headers: who("bob") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/artifacts/${id}/live` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/artifacts/${id}/live?version=x`, headers: who("alice") })).statusCode).toBe(400);
  });

  it("is 404 viewer_off while no viewer is set for the apps", async () => {
    const { app, id } = await served(null);
    const r = await app.inject({ method: "GET", url: `/v1/artifacts/${id}/live`, headers: who("alice") });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("viewer_off");
  });
});

// ------------------------------------------------------------------ the outbox: answered once

describe("an ask from the outbox is answered once", () => {
  it("the store: the first send takes the id, another while it runs is told so, a retry after it gets the answer", async () => {
    const s = new MemorySentAskStore();
    expect(await s.claim("u", "client-0001", 1000)).toEqual({ state: "new" });
    expect(await s.claim("u", "client-0001", 2000)).toEqual({ state: "sending" });
    expect(await s.claim("v", "client-0001", 2000)).toEqual({ state: "new" });   // ids are per person
    await s.done("u", "client-0001", { shell: { text: "ok" } }, 3000);
    expect(await s.claim("u", "client-0001", 4000)).toEqual({ state: "sent", reply: { shell: { text: "ok" } } });
    await s.release("u", "client-0001");   // a sent one is not let go
    expect((await s.claim("u", "client-0001", 5000)).state).toBe("sent");
    // A failed one is let go, so trying again does try again; one that never finished can be taken again later.
    await s.release("v", "client-0001");
    expect(await s.claim("v", "client-0001", 6000)).toEqual({ state: "new" });
    expect(await s.claim("v", "client-0001", 6000 + STALE_MS + 1)).toEqual({ state: "new" });
    expect(keptReply({ shell: { text: "x" }, big: "y".repeat(40_000) })).toEqual({ shell: { text: "x" } });
  });

  function served(o: { status?: () => number; wait?: () => Promise<void> } = {}) {
    const app = Fastify();
    const events = new MemoryEventStore();
    const sentAsks = new MemorySentAskStore();
    const asked: Array<{ body: unknown; key: unknown }> = [];
    app.post("/v1/ask", async (req, reply) => {
      asked.push({ body: req.body, key: req.headers["idempotency-key"] });
      await o.wait?.();
      const status = o.status?.() ?? 200;
      return reply.code(status).send(status === 200 ? { result: { text: "Moved it to 7 am.", paise: 120 }, bot: { slug: "plan", name: "Plan bot" } } : { code: "busy", message: "Busy" });
    });
    registerBotsShellRoutes(app, { rateLimit: RL, bots: null } as never, { events, sentAsks, now: () => FIXED_NOW });
    const send = (payload: Record<string, unknown>, user = "u1") => app.inject({ method: "POST", url: "/v1/shell/ask", headers: who(user), payload });
    return { app, events, asked, send };
  }

  it("a retry of an answered ask gets the same answer, and the bot is asked once", async () => {
    const t = served();
    const ask = { message: "Move gym to 7 am on Thursday", bot: "any", device: "phone", mode: "text", clientId: "3f1c6a52-9b0e-4c1a-8f7d-2b9e5d4c1a01", typedAt: FIXED_NOW - 5 * 60_000 };
    const first = await t.send(ask);
    expect(first.statusCode).toBe(200);
    expect(first.json().shell).toMatchObject({ text: "Moved it to 7 am.", clientId: ask.clientId, typedAt: ask.typedAt });
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]!.key).toBe(`ask:${ask.clientId}`);
    expect(t.asked[0]!.body).toEqual({ message: ask.message, device: "phone", mode: "text" });   // the id and the time stay with the shell
    const again = await t.send(ask);
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.json()).toEqual(first.json());
    expect(t.asked).toHaveLength(1);
    expect(await t.events.list("u1", 0)).toHaveLength(1);
    // Someone else's ask with the same id is their own.
    expect((await t.send(ask, "u2")).statusCode).toBe(200);
    expect(t.asked).toHaveLength(2);
  });

  it("a failed ask lets its id go, so the retry asks again; a send while it is still out is 409", async () => {
    let n = 0;
    const t = served({ status: () => (n++ === 0 ? 503 : 200) });
    const ask = { message: "Cab to the airport, Sat 4:30 am", clientId: "q_ask-00000002" };
    expect((await t.send(ask)).statusCode).toBe(503);
    expect((await t.send(ask)).statusCode).toBe(200);
    expect(t.asked).toHaveLength(2);

    let open!: () => void;
    const held = new Promise<void>((r) => { open = r; });
    const slow = served({ wait: () => held });
    const out = slow.send({ message: "Book the train", clientId: "q_ask-00000003" });
    await new Promise((r) => setTimeout(r, 20));
    const second = await slow.send({ message: "Book the train", clientId: "q_ask-00000003" });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("ask_in_flight");
    open();
    expect((await out).statusCode).toBe(200);
    expect(slow.asked).toHaveLength(1);
  });

  it("a bad id is refused before anything is asked; a time that cannot be true is not kept; no id asks as before", async () => {
    const t = served();
    expect((await t.send({ message: "x", clientId: "short" })).statusCode).toBe(400);
    expect((await t.send({ message: "x", clientId: 42 })).statusCode).toBe(400);
    expect(t.asked).toHaveLength(0);
    const future = await t.send({ message: "x", clientId: "q_ask-00000004", typedAt: FIXED_NOW + 86_400_000 });
    expect(future.json().shell.typedAt).toBeUndefined();
    const plain = await t.send({ message: "x" });
    expect(plain.json().shell.clientId).toBeUndefined();
    expect(t.asked[1]!.key).toBeUndefined();
  });
});

// ------------------------------------------------------------------ the screens

type Client = "phone" | "desktop";
async function build(screenId: string, client: Client, can: string[], params: Record<string, string> = {}, api: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya Sharma" }, can: new Set(["BotsKit", ...can]), desk: { pages: false, notes: false } },
    fakeDeps({ jobs: [], tasks: [], api, calls }));
  return { s, calls, words: walk(s.root!).map((n) => String(n.props?.content ?? "")).filter(Boolean) };
}
const LIVE_API = { ...CODEWORK_API, [`GET /v1/artifacts/${ART}/live?pick=1`]: { html: "<!doctype html><p>host</p>", origin: DEFAULT_APP_ORIGIN, version: 3 } };

describe("Design and Live preview run the artifact", () => {
  it("draw a LiveView for a build that has one: the page, point and change, the pick into sel, errors reported", async () => {
    for (const id of ["bots.code.design", "bots.code.preview"]) {
      for (const client of ["phone", "desktop"] as const) {
        const { s, words } = await build(id, client, ["LiveView"], { id: ART }, LIVE_API);
        expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        const live = walk(s.root!).filter((n) => n.type === "LiveView");
        expect(live, `${id} ${client}`).toHaveLength(1);
        expect(live[0]!.props).toMatchObject({ html: "<!doctype html><p>host</p>", origin: DEFAULT_APP_ORIGIN, messagePath: "live", waitForReady: true, title: "Pricing card" });
        expect(live[0]!.bind).toEqual({ send: "liveSend" });
        expect(s.state).toMatchObject({ liveSend: { pick: true }, sel: "" });
        const acts = actionsOf(s.root!);
        expect(acts.some((a) => a.kind === "setState" && a.path === "sel" && a.value === "$state.live.id")).toBe(true);
        expect(acts.find((a) => a.kind === "callEndpoint" && a.path === `/v1/artifacts/${ART}/errors`)).toMatchObject({ body: { version: 3, kind: "$state.live.kind", message: "$state.live.message" } });
        // The drawn parts are not drawn as well.
        expect(words).not.toContain("Choose Pro");
        if (id === "bots.code.preview") {
          expect(words).toEqual(expect.arrayContaining(["Use it", "Point to change"]));
          expect(acts.some((a) => a.kind === "setState" && a.path === "liveSend.pick" && a.value === false)).toBe(true);
        }
      }
    }
  });

  it("draw the parts, as before, for a build without one, or while no viewer is set", async () => {
    const older = await build("bots.code.design", "phone", [], { id: ART }, LIVE_API);
    expect(walk(older.s.root!).some((n) => n.type === "LiveView")).toBe(false);
    expect(older.calls.some((c) => c.path.includes("/live"))).toBe(false);
    expect(older.words).toContain("Choose Pro");
    const noViewer = await build("bots.code.preview", "desktop", ["LiveView"], { id: ART }, CODEWORK_API);
    expect(walk(noViewer.s.root!).some((n) => n.type === "LiveView")).toBe(false);
    expect(noViewer.words).toContain("Choose Pro");
    expect(lintTree(noViewer.s.root!)).toEqual([]);
  });
});

describe("Offline and the outbox on screen", () => {
  it("the Offline screen keeps asks in the outbox (POST /v1/shell/ask, once) and reads them from state", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s, words } = await build("bots.offline", client, ["Outbox"]);
      expect(lintTree(s.root!)).toEqual([]);
      expect(s.state).toMatchObject({ later: "" });
      expect(s.state).not.toHaveProperty("queued");
      expect(s.cacheTtlSeconds).toBe(86_400);   // the one Bots page a build keeps, to show it without a connection
      const keep = actionsOf(s.root!).find((a) => a.kind === "outbox" && a.op === "add");
      expect(keep).toEqual({ kind: "outbox", op: "add", path: "/v1/shell/ask", body: { message: "$state.later", bot: "any", device: client, mode: "text" }, label: "$state.later", sub: "Any bot · asked {time}" });
      expect(words).toEqual(expect.arrayContaining(["Nothing is lost. Your asks wait here and go out on their own when you're back.", "1 ask will send when you're back", "Waiting to send", "Sent"]));
      const j = json(s.root);
      expect(j).toContain('"bind":{"content":"outbox.0.label"}');
      expect(j).toContain('"truthy":"outbox.4.id"');
      const cancel = actionsOf(s.root!).filter((a) => a.kind === "outbox" && a.op === "remove");
      expect(cancel.length > 0).toBe(client === "desktop");   // DOffline's Edit and Cancel
    }
  });

  it("a build without an outbox gets the Offline screen as it was", async () => {
    const { s } = await build("bots.offline", "phone", []);
    expect(s.state).toMatchObject({ queued: [], later: "" });
    expect(s.cacheTtlSeconds).toBe(0);
    expect(actionsOf(s.root!).some((a) => a.kind === "outbox")).toBe(false);
  });

  it("Home shows the asks going out once the connection is back, and only for a build with an outbox", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const { s } = await build("bots.home", client, ["Outbox"]);
      expect(lintTree(s.root!)).toEqual([]);
      expect(json(s.root)).toContain('"truthy":"outbox.0.id"');
      expect(actionsOf(s.root!).some((a) => a.kind === "outbox" && a.op === "clear")).toBe(true);
      const older = await build("bots.home", client, []);
      expect(json(older.s.root)).not.toContain("outbox.0");
    }
  });

  it("the bootstrap's offline flags: Home becomes Offline while the connection is down; elsewhere a line", () => {
    expect(BOTS_OFFLINE_FLAGS).toEqual({
      "offline.screenId": "bots.offline", "offline.roots": ["bots.home"],
      "offline.bar": "You're offline · I'll keep working and catch you up", "offline.bar.font": FACE.regular, "offline.sentToast": "Sent. The answers are in Activity.",
    });
  });
});
