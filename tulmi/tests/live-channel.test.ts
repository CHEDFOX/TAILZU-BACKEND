/**
 * WS /v1/live: signed in or closed, each person hears only their own changes, a cap on sockets per person (the oldest goes),
 * a heartbeat both ways, and nothing left listening once a socket closes.
 */
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { LiveBus } from "../src/live/bus.js";
import { CLOSE, LIVE_PATH, registerLiveRoutes, type LiveRouteOptions, type LiveRoutes } from "../src/routes/live.js";

const USERS: Record<string, string> = { "Bearer token-a": "user-a", "Bearer token-b": "user-b" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let app: FastifyInstance | null = null;
afterEach(async () => { await app?.close(); app = null; });

async function serve(o: Partial<LiveRouteOptions> = {}): Promise<{ url: string; bus: LiveBus; routes: LiveRoutes }> {
  const bus = new LiveBus();
  app = Fastify();
  await app.register(websocket);
  const routes = registerLiveRoutes(app, {
    bus, resolve: async (a) => (a && USERS[a] ? { id: USERS[a]! } : null), rateLimit: { max: 1000, timeWindow: 60_000 }, ...o,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return { url: `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}${LIVE_PATH}`, bus, routes };
}

interface Client { ws: WebSocket; got: Array<Record<string, unknown>>; closed: Promise<number> }
async function connect(url: string, o: { token?: string; header?: string; autoPong?: boolean } = {}): Promise<Client> {
  const ws = new WebSocket(url, { ...(o.header ? { headers: { authorization: o.header } } : {}), autoPong: o.autoPong ?? true });
  const got: Array<Record<string, unknown>> = [];
  ws.on("message", (d) => got.push(JSON.parse(String(d))));
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  await new Promise((r) => ws.once("open", r));
  if (o.token !== undefined) ws.send(JSON.stringify({ type: "auth", token: o.token }));
  return { ws, got, closed };
}
async function until(fn: () => boolean, ms = 1500): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error("timed out"); await wait(10); }
}
const ready = (c: Client) => until(() => c.got.some((m) => m.type === "ready"));
const events = (c: Client) => c.got.filter((m) => m.type === "event").map((m) => m.topic);

describe("signing in", () => {
  it("takes the token in the first message, and says ready with its heartbeat", async () => {
    const { url, routes } = await serve({ heartbeatMs: 5000 });
    const c = await connect(url, { token: "token-a" });
    await ready(c);
    expect(c.got[0]).toEqual({ type: "ready", heartbeatMs: 5000 });
    expect(routes.count("user-a")).toBe(1);
    c.ws.close();
  });

  it("takes the upgrade's Authorization header", async () => {
    const { url, routes } = await serve();
    const c = await connect(url, { header: "Bearer token-b" });
    await ready(c);
    expect(routes.count("user-b")).toBe(1);
    c.ws.close();
  });

  it("refuses a token that is no one's: an error, then 4401, and nothing listening", async () => {
    const { url, bus, routes } = await serve();
    const c = await connect(url, { token: "forged" });
    expect(await c.closed).toBe(CLOSE.unauthorized);
    expect(c.got).toEqual([{ type: "error", code: "unauthorized", message: "Sign in again to continue." }]);
    expect(routes.total()).toBe(0);
    expect(bus.count("user-a")).toBe(0);
  });

  it("closes a socket that never signs in", async () => {
    const { url } = await serve({ authTimeoutMs: 80 });
    const c = await connect(url);
    expect(await c.closed).toBe(CLOSE.unauthorized);
  });

  it("asks for the sign-in once: a second auth message changes nothing", async () => {
    const { url, routes } = await serve();
    const c = await connect(url, { token: "token-a" });
    c.ws.send(JSON.stringify({ type: "auth", token: "token-b" }));
    await ready(c);
    await wait(30);
    expect(routes.count("user-a")).toBe(1);
    expect(routes.count("user-b")).toBe(0);
    c.ws.close();
  });
});

describe("events", () => {
  it("reach every socket of the person they are for, and no one else's", async () => {
    const { url, bus } = await serve();
    const phone = await connect(url, { token: "token-a" });
    const desk = await connect(url, { token: "token-a" });
    const other = await connect(url, { token: "token-b" });
    await Promise.all([ready(phone), ready(desk), ready(other)]);
    bus.publish(["user-a"], "keybot", { why: "words" });
    bus.publish(["user-b"], "home");
    await until(() => events(phone).length === 1 && events(desk).length === 1 && events(other).length === 1);
    expect(events(phone)).toEqual(["keybot"]);
    expect(events(desk)).toEqual(["keybot"]);
    expect(events(other)).toEqual(["home"]);
    const e = phone.got.find((m) => m.type === "event")!;
    expect(e.data).toEqual({ why: "words" });
    expect(typeof e.at).toBe("number");
    for (const c of [phone, desk, other]) c.ws.close();
  });

  it("stop when the socket closes: nothing is left subscribed", async () => {
    const { url, bus, routes } = await serve();
    const c = await connect(url, { token: "token-a" });
    await ready(c);
    expect(bus.count("user-a")).toBe(1);
    c.ws.close();
    await until(() => bus.count("user-a") === 0 && routes.count("user-a") === 0);
  });
});

describe("the cap", () => {
  it("lets a person hold maxPerUser sockets; one more closes the oldest with 4008", async () => {
    const { url, bus, routes } = await serve({ maxPerUser: 2 });
    const first = await connect(url, { token: "token-a" });
    await ready(first);
    const second = await connect(url, { token: "token-a" });
    await ready(second);
    const third = await connect(url, { token: "token-a" });
    await ready(third);
    expect(await first.closed).toBe(CLOSE.tooMany);
    expect(routes.count("user-a")).toBe(2);
    expect(bus.count("user-a")).toBe(2);
    // Someone else's sockets are their own count.
    const b = await connect(url, { token: "token-b" });
    await ready(b);
    expect(routes.count("user-b")).toBe(1);
    bus.publish(["user-a"], "home");
    await until(() => events(second).length === 1 && events(third).length === 1);
    expect(events(first)).toEqual([]);
    for (const c of [second, third, b]) c.ws.close();
  });
});

describe("the heartbeat", () => {
  it("pings every heartbeatMs, and a client that answers stays", async () => {
    const { url, routes } = await serve({ heartbeatMs: 60 });
    const c = await connect(url, { token: "token-a" });
    await ready(c);
    await until(() => c.got.filter((m) => m.type === "ping").length >= 4);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    expect(routes.count("user-a")).toBe(1);
    c.ws.close();
  });

  it("an app-level pong is an answer too, with ping frames unanswered", async () => {
    const { url } = await serve({ heartbeatMs: 60 });
    const c = await connect(url, { token: "token-a", autoPong: false });
    c.ws.on("message", (d) => { if (JSON.parse(String(d)).type === "ping") c.ws.send(JSON.stringify({ type: "pong" })); });
    await ready(c);
    await wait(400);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });

  it("drops a socket that answers nothing, and lets go of its subscription", async () => {
    const { url, bus, routes } = await serve({ heartbeatMs: 60 });
    const c = await connect(url, { token: "token-a", autoPong: false });
    await ready(c);
    await c.closed;
    expect(routes.count("user-a")).toBe(0);
    expect(bus.count("user-a")).toBe(0);
  });

  it("renews a long-lived socket with 4000", async () => {
    const { url } = await serve({ maxLifetimeMs: 1000 });
    const c = await connect(url, { token: "token-a" });
    await ready(c);
    expect(await c.closed).toBe(CLOSE.renew);
  });
});

describe("stopping the server", () => {
  it("closes every socket", async () => {
    const { url, bus } = await serve();
    const c = await connect(url, { token: "token-a" });
    await ready(c);
    await app!.close();
    app = null;
    await c.closed;
    expect(bus.count("user-a")).toBe(0);
  });
});
