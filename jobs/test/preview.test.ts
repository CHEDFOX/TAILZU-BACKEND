/**
 * THE PREVIEW (src/jobRoom.ts, src/previewDoor.ts, tulmi/src/code/live/preview.ts): the project's dev server runs on the job's runner, and a browser
 * sees it through the Worker and the job's room. The runner here is a fake client that plays a tiny app with ABSOLUTE paths (`/src/main.js`), over a
 * real WebSocket to the real Durable Object; the browser is `handlePreview` / the Worker's own `fetch`.
 */
import { introspectWorkflowInstance, runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mintPreviewToken, PREVIEW_COOKIE, previewUrl, type PreviewSite } from "../../tulmi/src/code/live/preview.js";
import { roomDeps } from "../src/jobRoom.js";
import worker from "../src/index.js";
import { handlePreview } from "../src/previewDoor.js";
import { roomOf } from "../src/rooms.js";
import { setWorldForTests } from "../src/world.js";
import { SECRET, scriptedWorld, testEnv, until } from "./helpers.js";
import { connect, newJob, openRoom, runnerFor, ticket, type Client } from "./live-helpers.js";

let h: ReturnType<typeof scriptedWorld>;
beforeEach(() => { h = scriptedWorld(); setWorldForTests(h.world); });
afterEach(() => { setWorldForTests(null); roomDeps.now = () => Date.now(); });

const WILD: PreviewSite = { domain: "tailzu-preview.test" };
const COOKIE: PreviewSite = { host: "preview.tailzu-preview.test" };
const OWNER = "user-owner-0001";
const enc = new TextEncoder();

interface Served { method: string; path: string; headers: Array<[string, string]>; body: string }
interface Answer { status?: number; headers?: Array<[string, string]>; body?: string | Uint8Array; delayMs?: number; hang?: boolean }

/** A runner that plays the dev server: answers `preview` when told to, and every `http` frame from `app`. */
function devServer(runner: Client, app: (r: Served) => Answer | Promise<Answer>, o: { ready?: boolean; error?: string; chunk?: number } = {}) {
  const served: Served[] = [];
  const stops: string[] = [];
  const previews: Array<Record<string, any>> = [];
  runner.ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data)) as Record<string, any>;
    if (m.t === "preview") {
      previews.push(m);
      if (o.ready === false) return;
      runner.send(o.error ? { t: "preview", id: m.id, ok: false, error: o.error } : { t: "preview", id: m.id, ok: true, port: 5173, ms: 40 });
    }
    if (m.t === "preview-stop") stops.push(String(m.reason ?? ""));
    if (m.t === "http") {
      const req: Served = { method: m.method, path: m.path, headers: m.headers, body: m.body ? atob(m.body) : "" };
      served.push(req);
      void (async () => {
        const a = await app(req);
        if (a.hang) return;
        if (a.delayMs) await new Promise((r) => setTimeout(r, a.delayMs));
        const bytes = typeof a.body === "string" ? enc.encode(a.body) : a.body ?? new Uint8Array();
        runner.send({ t: "res", id: m.id, status: a.status ?? 200, headers: a.headers ?? [["content-type", "text/plain"]] });
        const size = o.chunk ?? 192 * 1024;
        let at = 0;
        do {
          const piece = bytes.subarray(at, at + size);
          at += size;
          let bin = "";
          for (let i = 0; i < piece.length; i += 0x8000) bin += String.fromCharCode(...piece.subarray(i, i + 0x8000));
          runner.send({ t: "res-data", id: m.id, data: btoa(bin), last: at >= bytes.length });
        } while (at < bytes.length);
      })();
    }
  });
  return { served, stops, previews };
}

const APP = (r: Served): Answer => {
  const path = r.path.split("?")[0];
  if (path === "/") return { headers: [["content-type", "text/html"], ["x-frame-options", "DENY"], ["content-security-policy", "default-src 'self'; frame-ancestors 'none'"]], body: '<!doctype html><script type="module" src="/src/main.js"></script><h1>hello</h1>' };
  if (path === "/src/main.js") return { headers: [["content-type", "text/javascript"], ["cache-control", "max-age=999"]], body: 'import "/src/dep.js"; document.title = "main";' };
  if (path === "/src/dep.js") return { headers: [["content-type", "text/javascript"]], body: "export {};" };
  if (path === "/api/echo") return { headers: [["content-type", "application/json"]], body: JSON.stringify({ method: r.method, path: r.path, body: r.body, headers: Object.fromEntries(r.headers) }) };
  if (path === "/redirect") return { status: 302, headers: [["location", "http://localhost:5173/landed?x=1"]] };
  if (path === "/cookie") return { headers: [["content-type", "text/plain"], ["set-cookie", "a=1; Path=/; Domain=.tailzu-preview.test; HttpOnly"], ["set-cookie", "b=2; Path=/; SameSite=Lax"]], body: "cookies" };
  if (path === "/empty") return { status: 204, headers: [] };
  if (path === "/missing") return { status: 404, body: "nope" };
  if (path === "/slow") return { hang: true };
  return { status: 404 };
};

/** A job with an open session, a runner playing `app`, an owner watching, and the preview started and ready. */
async function ready(n: number, o: { site?: PreviewSite; app?: (r: Served) => Answer | Promise<Answer>; idleSec?: number; idleMs?: number; remainingMs?: number; chunk?: number } = {}) {
  const id = newJob(n);
  const room = await openRoom(id, { idleMs: o.idleMs ?? 120_000, remainingMs: o.remainingMs ?? 20 * 60_000 });
  const runner = await runnerFor(id);
  const dev = devServer(runner, o.app ?? APP, { ...(o.chunk ? { chunk: o.chunk } : {}) });
  const view = await connect(`/v1/rooms/${id}/watch`, { ticket: ticket({ kind: "viewer", user: OWNER, job: id, ttlMs: 60_000 }) });
  if (!view.ok) throw new Error("viewer refused");
  const started = await room.startPreview({ jobId: id, userId: OWNER, cmd: "npm run dev", readySec: 90, idleSec: o.idleSec ?? 300, overlay: [{ path: "src/a.ts", content: "x" }], site: o.site ?? WILD });
  if (!started.ok) throw new Error(`not started: ${started.message}`);
  const ev = await view.client.next((m) => m.t === "preview-ready");
  return { id, room, runner, dev, viewer: view.client, url: String(ev.url), started };
}

const tokenOf = (url: string): string => (/^https:\/\/([a-z2-7]{61})\./.exec(url) ?? /\/p\/([a-z2-7]{61})\//.exec(url))![1]!;
const get = (url: string, init: RequestInit = {}) => new Request(url, init);

describe("starting a preview", () => {
  it("tells the runner to start the dev server with the staged edits, and when it answers makes the address, tells the owner's view, and wakes the job", async () => {
    const id = newJob(500);
    h.agent.script(id, [{ next: "wait", waitingOn: "runner", waitMs: 600_000 }, { next: "end", why: "finished" }]);
    await using inst = await introspectWorkflowInstance(testEnv.AGENT_JOB, id);
    await testEnv.AGENT_JOB.create({ id, params: { jobId: id } });
    await until(() => h.agent.calls.length === 1);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    const dev = devServer(runner, APP);
    const view = await connect(`/v1/rooms/${id}/watch`, { ticket: ticket({ kind: "viewer", user: OWNER, job: id, ttlMs: 60_000 }) });
    if (!view.ok) throw new Error("viewer");
    const r = await room.startPreview({ jobId: id, userId: OWNER, cmd: "pnpm dev", port: 3000, prepare: "pnpm install", readySec: 60, idleSec: 300, overlay: [{ path: "src/a.ts", content: "staged" }], site: WILD });
    expect(r).toMatchObject({ ok: true, state: "starting" });
    expect(r.ok && r.url).toMatch(/^https:\/\/[a-z2-7]{61}\.tailzu-preview\.test\/$/);
    await until(() => dev.previews.length === 1);
    expect(dev.previews[0]).toMatchObject({ t: "preview", cmd: "pnpm dev", port: 3000, prepare: "pnpm install", readySec: 60, idleSec: 300, overlay: [{ path: "src/a.ts", content: "staged" }] });
    // Ready: the owner's view is sent the address, and the job's Workflow, which was waiting for the runner, goes on.
    const ev = await view.client.next((m) => m.t === "preview-ready");
    expect(ev.url).toBe(r.ok && r.url);
    expect(await room.previewStatus()).toMatchObject({ state: "ready", port: 5173, url: ev.url });
    await inst.waitForStatus("complete");
    expect(h.agent.calls).toHaveLength(2);
  });

  it("is refused without a session, without a site, and with a job that is not a job", async () => {
    const id = newJob(501);
    const room = roomOf(testEnv, id);
    expect(await room.startPreview({ jobId: id, userId: OWNER, cmd: "npm run dev", readySec: 60, idleSec: 300, overlay: [], site: WILD })).toMatchObject({ ok: false, reason: "no_session" });
    await openRoom(id);
    await runnerFor(id);
    expect(await room.startPreview({ jobId: id, userId: OWNER, cmd: "npm run dev", readySec: 60, idleSec: 300, overlay: [], site: {} })).toMatchObject({ ok: false, reason: "off" });
    expect(await room.startPreview({ jobId: id, userId: OWNER, cmd: "  ", readySec: 60, idleSec: 300, overlay: [], site: WILD })).toMatchObject({ ok: false, reason: "bad_request" });
    expect(await room.previewStatus()).toMatchObject({ state: "none" });
  });

  it("when the dev server will not start: the owner's view is told, the error is kept, the job is woken, and the address is dead", async () => {
    const id = newJob(502);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    devServer(runner, APP, { error: "The dev server stopped (exit 1) before it answered. The end of what it printed: boom" });
    const view = await connect(`/v1/rooms/${id}/watch`, { ticket: ticket({ kind: "viewer", user: OWNER, job: id, ttlMs: 60_000 }) });
    if (!view.ok) throw new Error("viewer");
    const r = await room.startPreview({ jobId: id, userId: OWNER, cmd: "npm run dev", readySec: 60, idleSec: 300, overlay: [], site: WILD });
    expect(r.ok).toBe(true);
    const closed = await view.client.next((m) => m.t === "preview-closed");
    expect(closed.reason).toBe("failed");
    expect(await room.previewStatus()).toMatchObject({ state: "closed", closeReason: "failed", error: expect.stringContaining("boom") });
    const url = (r as { url: string }).url;
    expect((await handlePreview(get(url), testEnv, WILD))!.status).toBe(410);
  });

  it("answers 503 with retry-after while the dev server is still starting", async () => {
    const id = newJob(503);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    devServer(runner, APP, { ready: false });
    const r = await room.startPreview({ jobId: id, userId: OWNER, cmd: "npm run dev", readySec: 60, idleSec: 300, overlay: [], site: WILD });
    const res = (await handlePreview(get((r as { url: string }).url), testEnv, WILD))!;
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.json()).toMatchObject({ code: "preview_starting" });
  });

  it("gives up on a dev server that never says it is ready, by an alarm, and tells the runner to stop", async () => {
    const id = newJob(504);
    const room = await openRoom(id);
    const runner = await runnerFor(id);
    const dev = devServer(runner, APP, { ready: false });
    const view = await connect(`/v1/rooms/${id}/watch`, { ticket: ticket({ kind: "viewer", user: OWNER, job: id, ttlMs: 60_000 }) });
    if (!view.ok) throw new Error("viewer");
    await room.startPreview({ jobId: id, userId: OWNER, cmd: "npm run dev", readySec: 30, idleSec: 300, overlay: [], site: WILD });
    roomDeps.now = () => Date.now() + (30 + 330) * 1000 + 5000;
    expect(await runDurableObjectAlarm(room)).toBe(true);
    expect((await view.client.next((m) => m.t === "preview-closed")).reason).toBe("failed");
    await until(() => dev.stops.length === 1);
    expect(await room.previewStatus()).toMatchObject({ state: "closed", error: expect.stringContaining("did not answer") });
  });
});

describe("the wildcard address: <token>.<domain>, absolute paths just work", () => {
  it("serves the page and what it asks for next by absolute path, with the dev server's own headers cleaned and the door's added", async () => {
    const p = await ready(510);
    expect(p.url).toMatch(/^https:\/\/[a-z2-7]{61}\.tailzu-preview\.test\/$/);
    const page = (await handlePreview(get(p.url), testEnv, WILD))!;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<h1>hello</h1>");
    expect(page.headers.get("content-type")).toBe("text/html");
    // The project said no framing and no cache; the door says what framing and caching a preview has.
    expect(page.headers.get("x-frame-options")).toBeNull();
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("x-robots-tag")).toMatch(/noindex/);
    const csp = page.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors https://x0bot.com https://www.x0bot.com https://tailzu.space https://www.tailzu.space");
    expect(csp).not.toContain("frame-ancestors 'none'");

    // The page asks for /src/main.js and that asks for /src/dep.js: the same host, so the absolute paths are served.
    const base = new URL(p.url);
    const js = (await handlePreview(get(`${base.origin}/src/main.js`), testEnv, WILD))!;
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("text/javascript");
    expect(js.headers.get("cache-control")).toBe("no-store");
    expect(await js.text()).toContain('import "/src/dep.js"');
    expect((await handlePreview(get(`${base.origin}/src/dep.js`), testEnv, WILD))!.status).toBe(200);
    expect((await handlePreview(get(`${base.origin}/missing`), testEnv, WILD))!.status).toBe(404);
    expect((await handlePreview(get(`${base.origin}/empty`), testEnv, WILD))!.status).toBe(204);
    // The runner saw plain paths, never the token or the public host as its own.
    expect(p.dev.served.map((r) => r.path)).toEqual(["/", "/src/main.js", "/src/dep.js", "/missing", "/empty"]);
  });

  it("passes the method, query, body and headers on; tells the app its public host; hides the Worker's and Cloudflare's headers", async () => {
    const p = await ready(511);
    const base = new URL(p.url);
    const res = (await handlePreview(get(`${base.origin}/api/echo?a=1&b=%20x`, {
      method: "POST", body: '{"hello":"world"}',
      headers: { "content-type": "application/json", "x-custom": "yes", cookie: `k=v; ${PREVIEW_COOKIE}=zzz; z=9`, origin: base.origin, referer: `${base.origin}/page?q=1`, "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9", "accept-encoding": "br" },
    }), testEnv, WILD))!;
    const echo = (await res.json()) as { method: string; path: string; body: string; headers: Record<string, string> };
    expect(echo).toMatchObject({ method: "POST", path: "/api/echo?a=1&b=%20x", body: '{"hello":"world"}' });
    expect(echo.headers).toMatchObject({ "x-custom": "yes", "content-type": "application/json", cookie: "k=v; z=9", origin: "http://localhost:5173", referer: "http://localhost:5173/page?q=1", "x-forwarded-host": base.host, "x-forwarded-proto": "https" });
    for (const k of ["cf-connecting-ip", "x-forwarded-for", "accept-encoding", "host", "content-length"]) expect(echo.headers[k], k).toBeUndefined();
  });

  it("keeps redirects on the preview, and a cookie to the one host", async () => {
    const p = await ready(512);
    const base = new URL(p.url);
    const red = (await handlePreview(get(`${base.origin}/redirect`), testEnv, WILD))!;
    expect(red.status).toBe(302);
    expect(red.headers.get("location")).toBe("/landed?x=1");
    const c = (await handlePreview(get(`${base.origin}/cookie`), testEnv, WILD))!;
    expect(c.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/; SameSite=Lax"]);
  });

  it("refuses an upgrade (HMR's WebSocket) in words, and a method a browser does not send", async () => {
    const p = await ready(513);
    const base = new URL(p.url);
    const ws = (await handlePreview(get(`${base.origin}/`, { headers: { upgrade: "websocket", connection: "Upgrade" } }), testEnv, WILD))!;
    expect(ws.status).toBe(426);
    expect(((await ws.json()) as { message: string }).message).toMatch(/reload the page/);
    expect((await handlePreview(get(`${base.origin}/`, { method: "TRACE" }), testEnv, WILD))!.status).toBe(405);
    expect(p.dev.served).toHaveLength(0);
  });

  it("is not for hosts that are not tokens, and lets the API's hosts through", async () => {
    await ready(514);
    expect(await handlePreview(get("https://jobs.example/v1/health"), testEnv, WILD)).toBeNull();
    expect(await handlePreview(get("https://other.test/"), testEnv, WILD)).toBeNull();
    expect((await handlePreview(get("https://www.tailzu-preview.test/"), testEnv, WILD))!.status).toBe(404);
    expect((await handlePreview(get("https://tailzu-preview.test/"), testEnv, WILD))!.status).toBe(404);
    expect((await handlePreview(get("https://short.tailzu-preview.test/"), testEnv, WILD))!.status).toBe(404);
  });
});

describe("the cookie mode: one dedicated host, /p/<token>/ sets a cookie and the rest follows it", () => {
  it("redirects the first visit to the same path without the token, with a host-only HttpOnly SameSite=Lax cookie; then routes by the cookie", async () => {
    const p = await ready(520, { site: COOKIE });
    expect(p.url).toMatch(/^https:\/\/preview\.tailzu-preview\.test\/p\/[a-z2-7]{61}\/$/);
    const token = tokenOf(p.url);
    const entry = (await handlePreview(get(`https://preview.tailzu-preview.test/p/${token}/dash/board?x=1`), testEnv, COOKIE))!;
    expect(entry.status).toBe(302);
    expect(entry.headers.get("location")).toBe("/dash/board?x=1");
    const cookie = entry.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^${PREVIEW_COOKIE}=${token}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
    expect(cookie).not.toMatch(/Domain/i);
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect(p.dev.served).toHaveLength(0);

    // The root-relative requests that follow carry the cookie.
    const jar = `${PREVIEW_COOKIE}=${token}`;
    const page = (await handlePreview(get("https://preview.tailzu-preview.test/", { headers: { cookie: jar } }), testEnv, COOKIE))!;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<h1>hello</h1>");
    const js = (await handlePreview(get("https://preview.tailzu-preview.test/src/main.js", { headers: { cookie: `other=1; ${jar}` } }), testEnv, COOKIE))!;
    expect(js.status).toBe(200);
    // The project never sees our cookie.
    const echo = (await (await handlePreview(get("https://preview.tailzu-preview.test/api/echo", { headers: { cookie: `${jar}; mine=1` } }), testEnv, COOKIE))!.json()) as { headers: Record<string, string> };
    expect(echo.headers.cookie).toBe("mine=1");
    // The path /p/<token> with no slash, and with a query, both enter.
    expect((await handlePreview(get(`https://preview.tailzu-preview.test/p/${token}`), testEnv, COOKIE))!.headers.get("location")).toBe("/");
    expect((await handlePreview(get(`https://preview.tailzu-preview.test/p/${token}?x=1`), testEnv, COOKIE))!.headers.get("location")).toBe("/?x=1");
  });

  it("answers 404 with no cookie, a wrong one or a cookie from another job; a path that only looks like the entry is the project's", async () => {
    const a = await ready(521, { site: COOKIE });
    const b = await ready(522, { site: COOKIE });
    const host = "https://preview.tailzu-preview.test";
    expect((await handlePreview(get(`${host}/`), testEnv, COOKIE))!.status).toBe(404);
    expect((await handlePreview(get(`${host}/`, { headers: { cookie: `${PREVIEW_COOKIE}=nope` } }), testEnv, COOKIE))!.status).toBe(404);
    expect((await handlePreview(get(`${host}/`, { headers: { cookie: `${PREVIEW_COOKIE}=${tokenOf(a.url).replace(/.$/, (c) => (c === "a" ? "b" : "a"))}` } }), testEnv, COOKIE))!.status).toBe(404);
    // A cookie for job B reaches job B's dev server only.
    const viaB = (await handlePreview(get(`${host}/api/echo`, { headers: { cookie: `${PREVIEW_COOKIE}=${tokenOf(b.url)}` } }), testEnv, COOKIE))!;
    expect(viaB.status).toBe(200);
    expect(b.dev.served).toHaveLength(1);
    expect(a.dev.served).toHaveLength(0);
    // /p/ with something that is not a token is a path of the project's (and has no cookie, so 404 here).
    expect((await handlePreview(get(`${host}/p/hello/world`), testEnv, COOKIE))!.status).toBe(404);
    expect(b.dev.served).toHaveLength(1);
  });
});

describe("the token", () => {
  it("is refused when it is forged, expired, for another job's room, or an earlier preview's of the same job", async () => {
    const p = await ready(530);
    const token = tokenOf(p.url);
    const host = (t: string) => `https://${t}.tailzu-preview.test/`;
    // Not signed by us: one letter changed.
    const forged = token.slice(0, 30) + (token[30] === "a" ? "b" : "a") + token.slice(31);
    expect((await handlePreview(get(host(forged)), testEnv, WILD))!.status).toBe(404);
    // Signed with another secret.
    const other = mintPreviewToken({ secret: "another-secret-0123456789abcdef0123456789", jobId: newJob(530), ttlMs: 60_000 });
    expect((await handlePreview(get(host(other.token)), testEnv, WILD))!.status).toBe(404);
    // Ours, for a job whose room has no preview: the room says there is none.
    const noRoom = mintPreviewToken({ secret: SECRET, jobId: newJob(531), ttlMs: 60_000 });
    expect((await handlePreview(get(host(noRoom.token)), testEnv, WILD))!.status).toBe(404);
    // Ours and for this job, with a nonce of its own: not this preview's.
    const wrongNonce = mintPreviewToken({ secret: SECRET, jobId: p.id, ttlMs: 60_000 });
    expect((await handlePreview(get(host(wrongNonce.token)), testEnv, WILD))!.status).toBe(404);
    // Ours, this preview's, but past its time.
    expect((await handlePreview(get(host(token)), testEnv, WILD, { now: () => Date.now() + 21 * 60_000 }))!.status).toBe(410);
    // And the real one works, and still does after all that.
    expect((await handlePreview(get(host(token)), testEnv, WILD))!.status).toBe(200);
    // A new preview of the same job makes the old address dead.
    const again = await p.room.startPreview({ jobId: p.id, userId: OWNER, cmd: "npm run dev", readySec: 60, idleSec: 300, overlay: [], site: WILD });
    expect(again.ok).toBe(true);
    await until(async () => (await p.room.previewStatus()).state === "ready");
    expect((await handlePreview(get(host(token)), testEnv, WILD))!.status).toBe(404);
    expect((await handlePreview(get((again as { url: string }).url), testEnv, WILD))!.status).toBe(200);
    await until(() => p.dev.stops.includes("replaced"));
  });

  it("is made for the job's owner: only the owner is handed the address, and the live view that shows it is the owner's", async () => {
    const p = await ready(531);
    expect(await p.room.previewFor(OWNER)).toEqual({ ok: true, url: p.url });
    expect(await p.room.previewFor("user-someone-else")).toEqual({ ok: false });
    expect(await p.room.previewFor("")).toEqual({ ok: false });
    // A viewer's ticket for another job, or for no job, cannot watch this one (and so is never sent the address).
    const other = newJob(532);
    expect(await connect(`/v1/rooms/${p.id}/watch`, { ticket: ticket({ kind: "viewer", user: OWNER, job: other, ttlMs: 60_000 }) })).toMatchObject({ ok: false, code: "wrong_job" });
    expect(tokenOf(p.url)).toHaveLength(61);
  });

  it("is checked at the door without waking any room: a token that is not ours is a 404 even when no Durable Object exists for it", async () => {
    await ready(533);
    const res = await handlePreview(get(`https://${"a".repeat(61)}.tailzu-preview.test/`), testEnv, WILD);
    expect(res!.status).toBe(404);
    expect(await res!.json()).toMatchObject({ code: "preview_not_found" });
  });
});

describe("the size cap", () => {
  it("passes 10 MB, refuses more with 502 preview_too_large, and the preview goes on", async () => {
    const big = (mb: number) => new Uint8Array(mb * 1024 * 1024).fill(97);
    const p = await ready(540, { app: (r) => (r.path.startsWith("/big") ? { body: big(Number(new URL(r.path, "http://x").searchParams.get("mb"))) } : APP(r)) });
    const base = new URL(p.url);
    const ok = (await handlePreview(get(`${base.origin}/big?mb=10`), testEnv, WILD))!;
    expect(ok.status).toBe(200);
    expect((await ok.arrayBuffer()).byteLength).toBe(10 * 1024 * 1024);
    const over = (await handlePreview(get(`${base.origin}/big?mb=11`), testEnv, WILD))!;
    expect(over.status).toBe(502);
    expect(await over.json()).toMatchObject({ code: "preview_too_large" });
    expect((await handlePreview(get(`${base.origin}/`), testEnv, WILD))!.status).toBe(200);
    await until(() => p.runner.frames.length >= 0 && p.dev.served.length >= 3);
  }, 60000);

  it("takes a request body of 1 MB and refuses more, with the body never read into the room", async () => {
    const p = await ready(541);
    const base = new URL(p.url);
    const post = (n: number, headers: Record<string, string> = {}) => handlePreview(get(`${base.origin}/api/echo`, { method: "POST", body: "x".repeat(n), headers }), testEnv, WILD);
    const ok = (await post(1024 * 1024))!;
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { body: string }).body.length).toBe(1024 * 1024);
    const served = p.dev.served.length;
    const over = (await post(1024 * 1024 + 1))!;
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ code: "request_too_large" });
    expect((await post(5, { "content-length": String(50 * 1024 * 1024) }))!.status).toBe(413);
    expect(p.dev.served.length).toBe(served);
  });

  it("holds at most 32 requests at once, and answers the rest 503", async () => {
    const p = await ready(542, { app: (r) => (r.path === "/slow" ? { hang: true } : APP(r)) });
    const base = new URL(p.url);
    const held = Array.from({ length: 32 }, () => handlePreview(get(`${base.origin}/slow`), testEnv, WILD));
    await until(() => p.dev.served.length === 32);
    const extra = (await handlePreview(get(`${base.origin}/`), testEnv, WILD))!;
    expect(extra.status).toBe(503);
    expect(await extra.json()).toMatchObject({ code: "preview_busy" });
    // Closing the preview answers the ones in flight, 502.
    await p.room.stopPreview("test");
    for (const r of await Promise.all(held)) expect(r!.status).toBe(502);
  });
});

describe("activity: the preview counts only while it is used, and the session's minutes cap it", () => {
  it("closes after 300 seconds without a request, tells the runner and the owner, and the session follows because the preview's use was its last activity", async () => {
    const p = await ready(550, { idleMs: 120_000, idleSec: 300 });
    const base = new URL(p.url);
    // 130 s with nothing: the session's own idle time (120 s) has passed, but a preview that is open holds it.
    roomDeps.now = () => Date.now() + 130_000;
    await runDurableObjectAlarm(p.room);
    expect((await p.room.sessionInfo()).state).toBe("open");
    expect((await p.room.previewStatus()).state).toBe("ready");
    // A request at 130 s: the preview is used, so the session is awake from then.
    expect((await handlePreview(get(`${base.origin}/`), testEnv, WILD))!.status).toBe(200);
    // 290 s after that: still inside the preview's idle time.
    roomDeps.now = () => Date.now() + 130_000 + 290_000;
    await runDurableObjectAlarm(p.room);
    expect((await p.room.previewStatus()).state).toBe("ready");
    // 301 s after that: the preview closes, and the session, whose last activity was the request, closes right behind it.
    roomDeps.now = () => Date.now() + 130_000 + 301_000;
    await runDurableObjectAlarm(p.room);
    expect((await p.viewer.next((m) => m.t === "preview-closed")).reason).toBe("idle");
    await until(() => p.dev.stops.includes("idle"));
    expect((await p.room.previewStatus())).toMatchObject({ state: "closed", closeReason: "idle" });
    expect((await p.room.sessionInfo()).state).toBe("closed");
    expect((await handlePreview(get(`${base.origin}/`), testEnv, WILD))!.status).toBe(410);
  });

  it("a request just before the idle time keeps it open another full idle time", async () => {
    const p = await ready(551, { idleSec: 300 });
    const base = new URL(p.url);
    roomDeps.now = () => Date.now() + 280_000;
    expect((await handlePreview(get(`${base.origin}/`), testEnv, WILD))!.status).toBe(200);
    roomDeps.now = () => Date.now() + 280_000 + 200_000;
    await runDurableObjectAlarm(p.room);
    expect((await p.room.previewStatus()).state).toBe("ready");
  });

  it("is inside the job's minute cap: when the session reaches it the preview closes, and the address stops", async () => {
    const p = await ready(552, { remainingMs: 100_000, idleSec: 3600 });
    const base = new URL(p.url);
    roomDeps.now = () => Date.now() + 110_000;
    await runDurableObjectAlarm(p.room);
    expect((await p.room.sessionInfo())).toMatchObject({ state: "closed", closeReason: "cap" });
    expect((await p.room.previewStatus()).state).toBe("closed");
    // The address was made to stop with the session's time, so that is what ends it.
    expect((await p.viewer.next((m) => m.t === "preview-closed")).reason).toBe("expired");
    expect((await handlePreview(get(`${base.origin}/`), testEnv, WILD))!.status).toBe(410);
    // The address never outlived the session's time: it was made to stop with it.
    const t = tokenOf(p.url);
    expect((await handlePreview(get(`https://${t}.tailzu-preview.test/`), testEnv, WILD, { now: () => Date.now() + 25 * 60_000 }))!.status).toBe(410);
  });

  it("closes when the session is closed for the person's sake or the job's end, and when the runner goes", async () => {
    const a = await ready(553);
    await a.room.closeSession("needs_you");
    expect((await a.viewer.next((m) => m.t === "preview-closed")).reason).toBe("session_needs_you");
    const b = await ready(554);
    b.runner.ws.close(1000, "gone");
    expect((await b.viewer.next((m) => m.t === "preview-closed")).reason).toBe("runner_gone");
    expect((await b.room.previewStatus()).state).toBe("closed");
    const c = await ready(555);
    await c.room.endJob();
    // Nothing is left: a room that was wiped has no preview.
    expect((await roomOf(testEnv, c.id).previewStatus()).state).toBe("none");
  });

  it("the runner saying the dev server is gone closes the preview too", async () => {
    const p = await ready(556);
    p.runner.send({ t: "preview-ended", id: (p.dev.previews[0] as { id: string }).id, reason: "the dev server exited (1)" });
    expect((await p.viewer.next((m) => m.t === "preview-closed")).reason).toBe("the dev server exited (1)");
    expect((await handlePreview(get(p.url), testEnv, WILD))!.status).toBe(410);
  });

  it("a request that is out when the runner goes is answered 502", async () => {
    const p = await ready(557, { app: (r) => (r.path === "/slow" ? { hang: true } : APP(r)) });
    const base = new URL(p.url);
    const pending = handlePreview(get(`${base.origin}/slow`), testEnv, WILD);
    await until(() => p.dev.served.length === 1);
    p.runner.ws.close(1000, "gone");
    expect((await pending)!.status).toBe(502);
  });
});

describe("the Worker's fetch: which host is a preview and which is the API", () => {
  const env = (extra: Record<string, string | undefined>) => ({ ...testEnv, ...extra }) as typeof testEnv;
  const ctx = {} as ExecutionContext;
  const fetchWorker = (req: Request, e: typeof testEnv, c: ExecutionContext): Promise<Response> => (worker as unknown as { fetch(r: Request, e: unknown, c: unknown): Promise<Response> }).fetch(req, e, c);

  it("answers a preview host as the preview and every other host as the API, and the API never answers on a preview host", async () => {
    const p = await ready(560);
    const e = env({ PREVIEW_DOMAIN: "tailzu-preview.test" });
    const base = new URL(p.url);
    const page = await fetchWorker(get(`${base.origin}/`), e, ctx);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<h1>hello</h1>");
    // The API's routes are the API's on the API's host...
    const health = await fetchWorker(get("https://jobs.example/v1/health"), e, ctx);
    expect(await health.json()).toEqual({ ok: true });
    // ...and on a preview host the same path is the project's (here: its 404), never the API.
    const onPreview = await fetchWorker(get(`${base.origin}/v1/health`), e, ctx);
    expect(onPreview.status).toBe(404);
    expect(p.dev.served.map((r) => r.path)).toContain("/v1/health");
    // A preview's address on the API's host is nothing.
    const wrongHost = await fetchWorker(get(`https://jobs.example/p/${tokenOf(p.url)}/`), env({ PREVIEW_HOST: "preview.tailzu-preview.test" }), ctx);
    expect(wrongHost.status).toBe(404);
    expect(await wrongHost.json()).toMatchObject({ code: "not_found" });
  });

  it("with no preview site set, every host is the API's", async () => {
    const res = await fetchWorker(get("https://abc.tailzu-preview.test/v1/health"), testEnv, ctx);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("takes out a preview site that shares a site with the API or the app (it runs the person's code): the host is the API's again", async () => {
    // The API is https://jobs.example; the app is https://x0bot.com (and, from before the move, https://tailzu.space).
    for (const bad of [{ PREVIEW_DOMAIN: "preview.jobs.example" }, { PREVIEW_HOST: "p.jobs.example" }, { PREVIEW_DOMAIN: "preview.x0bot.com" }, { PREVIEW_HOST: "www.x0bot.com" }, { PREVIEW_DOMAIN: "preview.tailzu.space" }, { PREVIEW_HOST: "www.tailzu.space" }]) {
      const host = bad.PREVIEW_DOMAIN ? `${"a".repeat(61).replace(/./g, "b")}.${bad.PREVIEW_DOMAIN}` : bad.PREVIEW_HOST!;
      const res = await fetchWorker(get(`https://${host}/v1/health`), env(bad), ctx);
      expect(await res.json(), JSON.stringify(bad)).toEqual({ ok: true });
    }
    // A site of its own is taken.
    const good = await fetchWorker(get(`https://${"b".repeat(61)}.tailzu-preview.test/v1/health`), env({ PREVIEW_DOMAIN: "tailzu-preview.test" }), ctx);
    expect(good.status).toBe(404);
    expect(await good.json()).toMatchObject({ code: "preview_not_found" });
    void previewUrl;
  });
});
