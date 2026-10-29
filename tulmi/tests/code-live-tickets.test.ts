/**
 * The passes for the live session's WebSockets (src/code/live/tickets.ts, offers.ts), and the frames those sockets carry (protocol.ts). Tickets are
 * built here at run time: no token-shaped value is written in this file.
 */
import { describe, expect, it } from "vitest";
import { sessionOffers, roomRunnerUrl } from "../src/code/live/offers.js";
import {
  SESSION_COMMAND, isId, isSessionCommands, parseFromDevice, parseFromRunner, parseFromViewer, parseToRunner,
} from "../src/code/live/protocol.js";
import { readTicket, signTicket, ticketOf } from "../src/code/live/tickets.js";

const SECRET = ["live", "ticket", "secret", "x".repeat(40)].join("-");
const NOW = 1_800_000_000_000;

describe("a ticket", () => {
  const device = () => signTicket({ secret: SECRET, kind: "device", user: "user-1", device: "laptop-0001", ttlMs: 60_000, now: NOW });

  it("is signed, carries what it is for and when it ends, and is read back", () => {
    const { ticket, claims } = device();
    expect(ticket).toMatch(/^t1\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    expect(claims).toMatchObject({ k: "device", u: "user-1", d: "laptop-0001", x: NOW + 60_000 });
    const r = readTicket(SECRET, ticket, "device", NOW + 1000);
    expect(r).toEqual({ ok: true, claims });
  });

  it("is a runner's for one job, one step and one lease, a viewer's for one person and job", () => {
    const run = signTicket({ secret: SECRET, kind: "runner", job: "job-1", step: 4, epoch: 7, ttlMs: 900_000, now: NOW });
    expect(readTicket(SECRET, run.ticket, "runner", NOW)).toMatchObject({ ok: true, claims: { k: "runner", j: "job-1", s: 4, e: 7 } });
    const view = signTicket({ secret: SECRET, kind: "viewer", user: "u", job: "job-1", ttlMs: 60_000, now: NOW });
    expect(readTicket(SECRET, view.ticket, "viewer", NOW)).toMatchObject({ ok: true, claims: { k: "viewer", u: "u", j: "job-1" } });
  });

  it("is refused after it ends, and while it ends exactly", () => {
    const { ticket } = device();
    expect(readTicket(SECRET, ticket, "device", NOW + 60_000).ok).toBe(true);
    expect(readTicket(SECRET, ticket, "device", NOW + 60_001)).toEqual({ ok: false, reason: "expired" });
  });

  it("is refused for another kind, another secret, a changed body, a changed MAC, and nonsense", () => {
    const { ticket } = device();
    expect(readTicket(SECRET, ticket, "viewer", NOW)).toEqual({ ok: false, reason: "wrong_kind" });
    expect(readTicket(SECRET, ticket, "runner", NOW)).toEqual({ ok: false, reason: "wrong_kind" });
    expect(readTicket(`${SECRET}x`, ticket, "device", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const [prefix, body, mac] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "device", u: "someone-else", d: "laptop-0001", x: NOW + 60_000, n: "n" })).toString("base64url");
    expect(readTicket(SECRET, `${prefix}.${forged}.${mac}`, "device", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(readTicket(SECRET, `${prefix}.${body}.${"0".repeat(64)}`, "device", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    for (const junk of ["", "t1.", "t1.abc", "t2.abc.def", "x".repeat(5000), "t1.***.***", null, undefined, 42]) {
      expect(readTicket(SECRET, junk, "device", NOW), String(junk).slice(0, 12)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("cannot be taken for a signed call between the VPS and the Worker, whose MAC is over something else", async () => {
    const { signRequest } = await import("../src/code/jobs/handoff/sign.js");
    const call = signRequest({ secret: SECRET, method: "GET", path: "/v1/devices/connect", body: "", now: NOW, nonce: "n".repeat(20) });
    const body = Buffer.from(JSON.stringify({ k: "device", u: "u", d: "laptop-0001", x: NOW + 60_000, n: "n".repeat(20) })).toString("base64url");
    expect(readTicket(SECRET, `t1.${body}.${call["x-tailzu-signature"]}`, "device", NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("has a fresh nonce each time, unless one is given", () => {
    const a = device().claims.n;
    const b = device().claims.n;
    expect(a).not.toBe(b);
    expect(signTicket({ secret: SECRET, kind: "device", user: "u", device: "d", ttlMs: 5000, nonce: "fixed" }).claims.n).toBe("fixed");
  });

  it("is lifted from a WebSocket request: the Authorization header, else the query", () => {
    const req = (url: string, auth?: string) => ({ url, headers: { get: (n: string) => (n.toLowerCase() === "authorization" ? auth ?? null : null) } });
    expect(ticketOf(req("https://j.example/v1/devices/connect", "Bearer abc"))).toBe("abc");
    expect(ticketOf(req("https://j.example/v1/devices/connect?ticket=xyz"))).toBe("xyz");
    expect(ticketOf(req("https://j.example/v1/devices/connect?ticket=xyz", "Bearer abc"))).toBe("abc");
    expect(ticketOf(req("https://j.example/v1/devices/connect", "Basic abc"))).toBeNull();
    expect(ticketOf(req("https://j.example/v1/devices/connect"))).toBeNull();
  });
});

describe("the way into a room that a runner is handed", () => {
  const offer = sessionOffers({ secret: SECRET, jobsUrl: "https://tailzu-jobs.example.workers.dev/", idleSec: 120, now: () => NOW });

  it("is the room's runner address, a ticket for this step and lease, and the session's limits", () => {
    const o = offer({ id: "11111111-1111-4111-8111-111111111111", leaseEpoch: 3 }, { idx: 5, timeoutSec: 1200 });
    expect(o).toMatchObject({ url: "wss://tailzu-jobs.example.workers.dev/v1/rooms/11111111-1111-4111-8111-111111111111/runner", idleSec: 120, maxSec: 1200, expiresAt: NOW + 15 * 60_000 });
    const t = readTicket(SECRET, o.ticket, "runner", NOW);
    expect(t.ok && t.claims).toMatchObject({ j: "11111111-1111-4111-8111-111111111111", s: 5, e: 3 });
    // another lease is another ticket
    expect(offer({ id: "11111111-1111-4111-8111-111111111111", leaseEpoch: 4 }, { idx: 5, timeoutSec: 1200 }).ticket).not.toBe(o.ticket);
  });

  it("is a wss address from an https one, and a ws one from http", () => {
    expect(roomRunnerUrl("https://a.example", "j")).toBe("wss://a.example/v1/rooms/j/runner");
    expect(roomRunnerUrl("http://localhost:8787/", "j")).toBe("ws://localhost:8787/v1/rooms/j/runner");
  });
});

describe("the frames", () => {
  it("know a session step by its one command", () => {
    expect(isSessionCommands([SESSION_COMMAND])).toBe(true);
    expect(isSessionCommands(["npm test"])).toBe(false);
    expect(isSessionCommands([SESSION_COMMAND, "npm test"])).toBe(false);
    expect(isSessionCommands([])).toBe(false);
  });

  it("take ids a socket can carry", () => {
    for (const ok of ["call_1_0", "verify:1", "baseline", "a.b-c/d@e"]) expect(isId(ok), ok).toBe(true);
    for (const bad of ["", "has space", "x".repeat(201), "new\nline", 5, null]) expect(isId(bad), String(bad)).toBe(false);
  });

  it("read a runner's frames, and refuse the ones that are wrong", () => {
    expect(parseFromRunner('{"t":"hello","v":1,"kind":"github","os":"linux","node":"v22.1.0"}')).toEqual({ t: "hello", v: 1, kind: "github", os: "linux", node: "v22.1.0" });
    expect(parseFromRunner('{"t":"hello","v":1,"kind":"desktop","name":"Work laptop"}')).toMatchObject({ kind: "desktop", name: "Work laptop" });
    expect(parseFromRunner('{"t":"out","id":"x","data":"hi\\n"}')).toEqual({ t: "out", id: "x", data: "hi\n" });
    expect(parseFromRunner('{"t":"done","id":"x","exitCode":2,"ms":150.4,"timedOut":true}')).toEqual({ t: "done", id: "x", exitCode: 2, ms: 150, timedOut: true });
    expect(parseFromRunner('{"t":"found","id":"s","ok":true,"text":"a.ts:1:x","matches":1,"files":1,"partial":false}')).toMatchObject({ t: "found", ok: true, text: "a.ts:1:x", matches: 1 });
    expect(parseFromRunner('{"t":"found","id":"s","ok":false,"error":"bad"}')).toEqual({ t: "found", id: "s", ok: false, error: "bad" });
    expect(parseFromRunner('{"t":"error","id":"x","code":"busy","message":"a command is running"}')).toMatchObject({ code: "busy" });
    expect(parseFromRunner('{"t":"bye","reason":"idle"}')).toEqual({ t: "bye", reason: "idle" });
    for (const bad of ['{"t":"hello","v":2,"kind":"github"}', '{"t":"hello","v":1,"kind":"phone"}', '{"t":"out","id":"x"}', '{"t":"done","id":"x","exitCode":"0","ms":1}', '{"t":"done","id":"x","exitCode":0,"ms":-1}',
      '{"t":"nope"}', "[]", "null", "not json", '{"id":"x"}', '{"t":"out","id":"has space","data":"x"}']) {
      expect(parseFromRunner(bad), bad).toBeNull();
    }
    expect(parseFromRunner("x".repeat(3 * 1024 * 1024))).toBeNull();
  });

  it("read the room's frames to a runner (what the desktop app must accept), and refuse the ones that are wrong", () => {
    expect(parseToRunner('{"t":"ready","v":1,"jobId":"j","idleSec":120,"maxSec":1200}')).toEqual({ t: "ready", v: 1, jobId: "j", idleSec: 120, maxSec: 1200 });
    const exec = '{"t":"exec","id":"c1","commands":["npm test","echo ok"],"timeoutSec":600,"overlay":[{"path":"a.ts","content":"x"},{"path":"b.ts","content":null}],"discard":true}';
    expect(parseToRunner(exec)).toEqual({ t: "exec", id: "c1", commands: ["npm test", "echo ok"], timeoutSec: 600, overlay: [{ path: "a.ts", content: "x" }, { path: "b.ts", content: null }], discard: true });
    expect(parseToRunner('{"t":"cancel","id":"c1"}')).toEqual({ t: "cancel", id: "c1" });
    expect(parseToRunner('{"t":"grep","id":"s","pattern":"TODO","glob":"*.ts","context":2,"filesOnly":true}')).toMatchObject({ t: "grep", pattern: "TODO", glob: "*.ts", context: 2, filesOnly: true });
    expect(parseToRunner('{"t":"glob","id":"s","pattern":"src/**"}')).toEqual({ t: "glob", id: "s", pattern: "src/**" });
    expect(parseToRunner('{"t":"close","reason":"needs_you"}')).toEqual({ t: "close", reason: "needs_you" });
    expect(parseToRunner('{"t":"close","reason":"???"}')).toEqual({ t: "close", reason: "error" });
    expect(parseToRunner('{"t":"ping","at":5}')).toEqual({ t: "ping", at: 5 });
    for (const bad of ['{"t":"exec","id":"c","commands":[],"timeoutSec":5,"overlay":[]}', '{"t":"exec","id":"c","commands":["x"],"timeoutSec":0,"overlay":[]}',
      '{"t":"exec","id":"c","commands":["x"],"timeoutSec":5,"overlay":[{"path":"","content":"x"}]}', '{"t":"exec","id":"c","commands":["x"],"timeoutSec":5,"overlay":[{"path":"a","content":5}]}', '{"t":"x"}']) {
      expect(parseToRunner(bad), bad).toBeNull();
    }
  });

  it("read a PC's presence frames", () => {
    const hello = parseFromDevice('{"t":"hello","v":1,"deviceId":"laptop-0001","name":"  Work laptop ","allowRun":true,"projects":["p1","p2"],"busy":false,"app":"X0 Bot 1.2"}');
    expect(hello).toEqual({ t: "hello", v: 1, deviceId: "laptop-0001", name: "Work laptop", allowRun: true, projects: ["p1", "p2"], busy: false, app: "X0 Bot 1.2" });
    expect(parseFromDevice('{"t":"hello","v":1,"deviceId":"laptop-0001","allowRun":false,"projects":"all"}')).toMatchObject({ name: "This computer", busy: false, projects: "all" });
    expect(parseFromDevice('{"t":"state","busy":true}')).toEqual({ t: "state", busy: true });
    expect(parseFromDevice('{"t":"state","projects":"all","allowRun":false}')).toEqual({ t: "state", projects: "all", allowRun: false });
    expect(parseFromDevice('{"t":"decline","jobId":"j","epoch":3,"reason":"busy"}')).toEqual({ t: "decline", jobId: "j", epoch: 3, reason: "busy" });
    expect(parseFromDevice('{"t":"bye"}')).toEqual({ t: "bye" });
    for (const bad of ['{"t":"hello","v":1,"deviceId":"short","allowRun":true,"projects":"all"}', '{"t":"hello","v":1,"deviceId":"laptop-0001","allowRun":"yes","projects":"all"}',
      '{"t":"hello","v":1,"deviceId":"laptop-0001","allowRun":true,"projects":[1]}', '{"t":"state","busy":"no"}', '{"t":"state","projects":"some"}', '{"t":"nope"}']) {
      expect(parseFromDevice(bad), bad).toBeNull();
    }
  });

  it("read the app's frames: the person's words, and a ping, nothing else", () => {
    expect(parseFromViewer('{"t":"message","text":"also the README"}')).toEqual({ t: "message", text: "also the README" });
    expect(parseFromViewer('{"t":"ping"}')).toEqual({ t: "ping" });
    for (const bad of ['{"t":"exec","commands":["rm -rf /"]}', '{"t":"message"}', '{"t":"message","text":5}', "nope"]) expect(parseFromViewer(bad), bad).toBeNull();
  });
});
