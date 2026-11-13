/**
 * THE MEETING BOT OVER HTTP (routes/bots/meet.ts): off without BOTS or its service; the person's routes passing their own id and only
 * the validated fields (a space admin's forUser too, only as an id), a bad id refused, the service's errors in their own words; Recall's status webhook refused unsigned, never twice for one
 * id; its live webhook answered at once and processed in order per meeting; the stage page with its policy, its clips, its done, and its
 * event stream closed when the page goes.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const Fastify = (await import("fastify")).default;
const { registerMeetRoutes } = await import("../src/routes/bots/meet.js");
const { signRecall } = await import("../src/meet/recall.js");

type Deps = import("../src/routes/bots/meet.js").MeetRouteDeps;
type Service = import("../src/routes/bots/meet.js").MeetRoutesService;
type Hub = import("../src/meet/types.js").StageHub;

const SECRET = `whsec_${Buffer.from("meet-routes-test-secret-0123456789").toString("base64")}`;
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
const MID = "3f2b8c1e-5a47-4d0e-9b61-0c7d2e8a1f44";
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const CLIP = "0123456789abcdef";
const VIEW = { id: MID, title: "Standup" };

class MeetErr extends Error { constructor(readonly status: number, message: string, readonly code: string) { super(message); } }

function fakeService(o: { fail?: boolean; onLive?: (token: string, body: unknown) => Promise<unknown> } = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const rec = <T>(fn: string, out: T) => async (...args: unknown[]): Promise<T> => {
    calls.push({ fn, args });
    if (o.fail) throw new MeetErr(402, "No minutes left today.", "meet_minutes");
    return out;
  };
  const service = {
    overview: rec("overview", { botName: "X0 Bot" }),
    join: rec("join", VIEW),
    meeting: async (...args: unknown[]) => { calls.push({ fn: "meeting", args }); return args[1] === MID ? { meeting: VIEW, asks: [] } : null; },
    leave: rec("leave", VIEW),
    setVoice: rec("setVoice", VIEW),
    cancel: async (...args: unknown[]) => { calls.push({ fn: "cancel", args }); return args[1] === MID; },
    saveSettings: rec("saveSettings", { autoJoin: true, voice: true, botName: "Sam" }),
    onLive: async (token: string, body: unknown) => { calls.push({ fn: "onLive", args: [token, body] }); return o.onLive?.(token, body); },
    onStatus: rec("onStatus", undefined),
    stageFor: async (token: string) => (token === TOKEN ? { meetingId: MID, botName: "Sam", owner: "Aanya" } : null),
  } as unknown as Service;
  return { calls, service };
}

function fakeHub() {
  const log: string[] = [];
  const hub = {
    open: (id: string, send: (e: "say" | "stop" | "state", d: Record<string, unknown>) => void) => { log.push(`open:${id}`); send("state", { label: "Listening" }); return () => { log.push("closed"); }; },
    clip: (_id: string, clip: string) => (clip === CLIP ? { audio: Buffer.from("mp3"), contentType: "audio/mpeg" } : null),
    done: (id: string, clip: string, how: string) => { log.push(`done:${id}:${clip}:${how}`); },
  } as unknown as Hub;
  return { log, hub };
}

async function app(o: Partial<Deps> & { service?: Service | null } = {}) {
  const a = Fastify();
  const svc = fakeService();
  const h = fakeHub();
  registerMeetRoutes(a, {
    rateLimit: {}, bots: {}, service: svc.service, stage: h.hub, secret: SECRET, now: () => NOW,
    calendarConnected: async () => true, ...o,
  });
  await a.ready();
  return { a, svc, h };
}

function signed(url: string, body: unknown, o: { id?: string; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = o.id ?? `msg_${Math.random().toString(16).slice(2)}`;
  const ts = Math.floor(NOW / 1000);
  return {
    method: "POST" as const, url, payload: raw,
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": signRecall(o.secret ?? SECRET, id, ts, raw) },
  };
}

const open: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

describe("off", () => {
  it("is 404 meet_off without BOTS or without its service", async () => {
    for (const o of [{ bots: null }, { service: null }]) {
      const { a } = await app(o);
      const r = await a.inject({ method: "GET", url: "/v1/meet/overview" });
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ code: "meet_off", message: "The meeting bot is not switched on." });
      expect((await a.inject(signed("/v1/meet/recall", {}))).statusCode).toBe(404);
      expect((await a.inject({ method: "GET", url: `/v1/meet/stage/${TOKEN}` })).statusCode).toBe(404);
    }
  });
});

describe("the person's routes", () => {
  it("pass their own id and the validated fields", async () => {
    const { a, svc } = await app();
    const ov = await a.inject({ method: "GET", url: "/v1/meet/overview" });
    expect(ov.statusCode).toBe(200);
    expect(ov.headers["cache-control"]).toBe("no-store");
    expect(svc.calls[0]).toEqual({ fn: "overview", args: ["dev-user", { calendar: true }] });

    const j = await a.inject({ method: "POST", url: "/v1/meet/join", payload: { url: " https://meet.google.com/abc-defg-hij ", title: "Standup", voice: false, extra: 1 } });
    expect(j.statusCode).toBe(201);
    expect(j.json()).toEqual({ meeting: VIEW });
    expect(svc.calls[1]).toEqual({ fn: "join", args: ["dev-user", { url: "https://meet.google.com/abc-defg-hij", title: "Standup", voice: false }] });

    expect((await a.inject({ method: "GET", url: `/v1/meet/meetings/${MID}` })).json()).toEqual({ meeting: VIEW, asks: [] });
    await a.inject({ method: "POST", url: `/v1/meet/meetings/${MID}/leave` });
    const v = await a.inject({ method: "PUT", url: `/v1/meet/meetings/${MID}`, payload: { voice: true } });
    expect(v.json()).toEqual({ meeting: VIEW });
    expect((await a.inject({ method: "DELETE", url: `/v1/meet/meetings/${MID}` })).json()).toEqual({ ok: true });
    const s = await a.inject({ method: "PUT", url: "/v1/meet/settings", payload: { autoJoin: true, botName: "  Sam  ", junk: 1 } });
    expect(s.json()).toEqual({ settings: { autoJoin: true, voice: true, botName: "Sam" } });
    expect(svc.calls.map((c) => c.fn)).toEqual(["overview", "join", "meeting", "leave", "setVoice", "cancel", "saveSettings"]);
    expect(svc.calls[3]!.args).toEqual(["dev-user", MID]);
    expect(svc.calls[4]!.args).toEqual(["dev-user", MID, true]);
    expect(svc.calls[6]!.args).toEqual(["dev-user", { autoJoin: true, botName: "Sam" }]);
  });

  it("pass the member a space's admin sends the bot for, and the service's refusal in its own words", async () => {
    const { a, svc } = await app();
    const member = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const r = await a.inject({ method: "POST", url: "/v1/meet/join", payload: { url: "https://meet.google.com/abc-defg-hij", forUser: member } });
    expect(r.statusCode).toBe(201);
    expect(svc.calls[0]).toEqual({ fn: "join", args: ["dev-user", { url: "https://meet.google.com/abc-defg-hij", forUser: member }] });

    const refusing = fakeService();
    (refusing.service as unknown as { join: () => Promise<never> }).join = async () => {
      throw new MeetErr(404, "You can send it only for someone in a space you look after.", "not_your_person");
    };
    const no = await app({ service: refusing.service });
    const res = await no.a.inject({ method: "POST", url: "/v1/meet/join", payload: { url: "https://meet.google.com/abc-defg-hij", forUser: member } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "not_your_person", message: "You can send it only for someone in a space you look after." });

    // The page sends its "For" chip as it is: "" (Me) is the person's own meeting, as no forUser is.
    const self = await app();
    const mine = await self.a.inject({ method: "POST", url: "/v1/meet/join", payload: { url: "https://meet.google.com/abc-defg-hij", forUser: "" } });
    expect(mine.statusCode).toBe(201);
    expect(self.svc.calls[0]).toEqual({ fn: "join", args: ["dev-user", { url: "https://meet.google.com/abc-defg-hij" }] });
  });

  it("says calendar false when it is not asked about", async () => {
    const { a, svc } = await app({ calendarConnected: undefined });
    await a.inject({ method: "GET", url: "/v1/meet/overview" });
    expect(svc.calls[0]!.args[1]).toEqual({ calendar: false });
  });

  it("refuse bad bodies before the service hears of them", async () => {
    const { a, svc } = await app();
    const bodies: Array<[string, string, unknown]> = [
      ["POST", "/v1/meet/join", {}], ["POST", "/v1/meet/join", { url: "" }], ["POST", "/v1/meet/join", { url: "x".repeat(2001) }],
      ["POST", "/v1/meet/join", { url: "https://x.y", title: "t".repeat(201) }], ["POST", "/v1/meet/join", { url: "https://x.y", voice: "yes" }],
      ["POST", "/v1/meet/join", { url: "https://x.y", forUser: "not-an-id" }], ["POST", "/v1/meet/join", { url: "https://x.y", forUser: 7 }],
      ["PUT", `/v1/meet/meetings/${MID}`, {}], ["PUT", `/v1/meet/meetings/${MID}`, { voice: "on" }],
      ["PUT", "/v1/meet/settings", { botName: "n".repeat(41) }], ["PUT", "/v1/meet/settings", { autoJoin: "yes" }],
    ];
    for (const [method, url, payload] of bodies) {
      const r = await a.inject({ method: method as "POST", url, payload: payload as object });
      expect(r.statusCode, `${method} ${url}`).toBe(400);
    }
    expect(svc.calls).toEqual([]);
  });

  it("answer 404 for an id that is not a uuid, or a meeting that is not theirs", async () => {
    const { a, svc } = await app();
    for (const [method, url] of [["GET", "/v1/meet/meetings/nope"], ["POST", "/v1/meet/meetings/1/leave"], ["PUT", "/v1/meet/meetings/..%2f"], ["DELETE", "/v1/meet/meetings/x"]] as const) {
      expect((await a.inject({ method, url, payload: method === "PUT" ? { voice: true } : undefined })).statusCode, url).toBe(404);
    }
    expect(svc.calls).toEqual([]);
    const other = "3f2b8c1e-5a47-4d0e-9b61-0c7d2e8a1f45";
    expect((await a.inject({ method: "GET", url: `/v1/meet/meetings/${other}` })).statusCode).toBe(404);
    expect((await a.inject({ method: "DELETE", url: `/v1/meet/meetings/${other}` })).statusCode).toBe(404);
  });

  it("show the service's errors in their own words", async () => {
    const f = fakeService({ fail: true });
    const { a } = await app({ service: f.service });
    const r = await a.inject({ method: "POST", url: "/v1/meet/join", payload: { url: "https://meet.google.com/abc-defg-hij" } });
    expect(r.statusCode).toBe(402);
    expect(r.json()).toEqual({ code: "meet_minutes", message: "No minutes left today." });
  });
});

describe("Recall's status webhook", () => {
  it("is 503 without a secret and 401 when not signed", async () => {
    const none = await app({ secret: "" });
    const prev = process.env.RECALL_WEBHOOK_SECRET; delete process.env.RECALL_WEBHOOK_SECRET;
    try {
      const r = await none.a.inject({ method: "POST", url: "/v1/meet/recall", payload: {} });
      expect(r.statusCode).toBe(503);
      expect(r.json().code).toBe("meet_unsigned");
    } finally { if (prev !== undefined) process.env.RECALL_WEBHOOK_SECRET = prev; }
    const { a, svc } = await app();
    const bad = signed("/v1/meet/recall", { event: "bot.done" }, { secret: `whsec_${Buffer.from("another-secret").toString("base64")}` });
    expect((await a.inject(bad)).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/v1/meet/recall", payload: { event: "bot.done" } })).statusCode).toBe(401);
    expect(svc.calls).toEqual([]);
  });

  it("hands a signed one to the service once, however often Recall repeats it", async () => {
    const { a, svc } = await app();
    const req = signed("/v1/meet/recall", { event: "bot.done", data: { bot: { id: "b1" } } }, { id: "msg_one" });
    for (let i = 0; i < 3; i++) {
      const r = await a.inject(req);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ok: true });
    }
    expect(svc.calls.filter((c) => c.fn === "onStatus")).toEqual([{ fn: "onStatus", args: [{ event: "bot.done", data: { bot: { id: "b1" } } }] }]);
    await a.inject(signed("/v1/meet/recall", { event: "bot.fatal" }, { id: "msg_two" }));
    expect(svc.calls.filter((c) => c.fn === "onStatus")).toHaveLength(2);
  });
});

describe("Recall's live webhook", () => {
  it("is 404 for a token that cannot be one and 401 when not signed", async () => {
    const { a, svc } = await app();
    expect((await a.inject(signed("/v1/meet/live/short/", { event: "x" }))).statusCode).toBe(404);
    expect((await a.inject(signed(`/v1/meet/live/${"a".repeat(65)}/`, { event: "x" }))).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: `/v1/meet/live/${TOKEN}/`, payload: { event: "x" } })).statusCode).toBe(401);
    expect((await a.inject(signed(`/v1/meet/live/${TOKEN}/`, { event: "x" }, { secret: `whsec_${Buffer.from("no").toString("base64")}` }))).statusCode).toBe(401);
    expect(svc.calls).toEqual([]);
  });

  it("answers at once, with and without the slash, and passes the token and the body on", async () => {
    const { a, svc } = await app();
    const one = await a.inject(signed(`/v1/meet/live/${TOKEN}/`, { event: "transcript.data", n: 1 }));
    const two = await a.inject(signed(`/v1/meet/live/${TOKEN}`, { event: "transcript.data", n: 2 }));
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    await vi.waitFor(() => expect(svc.calls.filter((c) => c.fn === "onLive")).toHaveLength(2));
    expect(svc.calls[0]).toEqual({ fn: "onLive", args: [TOKEN, { event: "transcript.data", n: 1 }] });
  });

  it("does not wait for the work, and keeps one meeting's events in order", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakeService({
      onLive: async (_t, body) => {
        const n = (body as { n: number }).n;
        order.push(`start${n}`);
        if (n === 1) await gate;
        order.push(`end${n}`);
      },
    });
    const { a } = await app({ service: f.service });
    const r1 = await a.inject(signed(`/v1/meet/live/${TOKEN}/`, { n: 1 }));
    const r2 = await a.inject(signed(`/v1/meet/live/${TOKEN}/`, { n: 2 }));
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    await vi.waitFor(() => expect(order).toEqual(["start1"]));
    release();
    await vi.waitFor(() => expect(order).toEqual(["start1", "end1", "start2", "end2"]));
  });

  it("does not process a replayed id twice, and a failed event does not stop the next", async () => {
    let n = 0;
    const f = fakeService({ onLive: async () => { if (n++ === 0) throw new Error("boom"); } });
    const { a } = await app({ service: f.service });
    const req = signed(`/v1/meet/live/${TOKEN}/`, { n: 1 }, { id: "msg_live" });
    expect((await a.inject(req)).statusCode).toBe(200);
    expect((await a.inject(req)).statusCode).toBe(200);
    expect((await a.inject(signed(`/v1/meet/live/${TOKEN}/`, { n: 2 }))).statusCode).toBe(200);
    await vi.waitFor(() => expect(f.calls.filter((c) => c.fn === "onLive")).toHaveLength(2));
  });

  it("takes the token alone when no secret is configured", async () => {
    const { a, svc } = await app({ secret: "" });
    const prev = process.env.RECALL_WEBHOOK_SECRET; delete process.env.RECALL_WEBHOOK_SECRET;
    try {
      expect((await a.inject({ method: "POST", url: `/v1/meet/live/${TOKEN}/`, payload: { event: "x" } })).statusCode).toBe(200);
    } finally { if (prev !== undefined) process.env.RECALL_WEBHOOK_SECRET = prev; }
    await vi.waitFor(() => expect(svc.calls.filter((c) => c.fn === "onLive")).toHaveLength(1));
  });
});

describe("the stage", () => {
  it("is 404 for an unknown token", async () => {
    const { a } = await app();
    for (const url of ["/v1/meet/stage/unknown-token-0123456789", "/v1/meet/stage/x", `/v1/meet/stage/${"z".repeat(30)}/events`, `/v1/meet/stage/${"z".repeat(30)}/clips/${CLIP}`]) {
      expect((await a.inject({ method: "GET", url })).statusCode, url).toBe(404);
    }
    expect((await a.inject({ method: "POST", url: `/v1/meet/stage/${"z".repeat(30)}/clips/${CLIP}/done`, payload: { how: "ended" } })).statusCode).toBe(404);
  });

  it("serves its page under a policy that lets it fetch nothing but its own", async () => {
    const { a } = await app();
    const r = await a.inject({ method: "GET", url: `/v1/meet/stage/${TOKEN}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-robots-tag"]).toBe("noindex");
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src 'self'; connect-src 'self'");
    expect(r.body).toContain("<html");
  });

  it("serves a clip while it is wanted, and 404s once it is gone", async () => {
    const { a } = await app();
    const r = await a.inject({ method: "GET", url: `/v1/meet/stage/${TOKEN}/clips/${CLIP}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("audio/mpeg");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).toBe("mp3");
    expect((await a.inject({ method: "GET", url: `/v1/meet/stage/${TOKEN}/clips/ffffffffffffffff` })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: `/v1/meet/stage/${TOKEN}/clips/not-a-clip` })).statusCode).toBe(404);
  });

  it("tells the hub when a clip ended or was stopped", async () => {
    const { a, h } = await app();
    const done = (how: unknown) => a.inject({ method: "POST", url: `/v1/meet/stage/${TOKEN}/clips/${CLIP}/done`, payload: { how } as object });
    expect((await done("ended")).json()).toEqual({ ok: true });
    expect((await done("stopped")).statusCode).toBe(200);
    expect((await done("paused")).statusCode).toBe(400);
    expect(h.log).toEqual([`done:${MID}:${CLIP}:ended`, `done:${MID}:${CLIP}:stopped`]);
  });

  it("streams events, and lets the hub go when the page does", async () => {
    const { a, h } = await app();
    await a.listen({ port: 0, host: "127.0.0.1" });
    open.push(a);
    const port = (a.server.address() as AddressInfo).port;
    const { chunk, headers, req } = await new Promise<{ chunk: string; headers: http.IncomingHttpHeaders; req: http.ClientRequest }>((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path: `/v1/meet/stage/${TOKEN}/events` }, (res) => {
        res.once("data", (d: Buffer) => resolve({ chunk: d.toString("utf8"), headers: res.headers, req }));
      });
      req.on("error", reject);
    });
    expect(headers["content-type"]).toBe("text/event-stream");
    expect(headers["x-accel-buffering"]).toBe("no");
    expect(chunk).toBe('event: state\ndata: {"label":"Listening"}\n\n');
    expect(h.log).toEqual([`open:${MID}`]);
    req.destroy();
    await vi.waitFor(() => expect(h.log).toEqual([`open:${MID}`, "closed"]));
  });
});

describe("the meeting bot among the bots", () => {
  afterEach(async () => { delete process.env.RECALL_API_KEY; (await import("../src/config.js")).resetConfigForTests(); });

  it("is listed only where Recall is set up, and its slug is reserved", async () => {
    const { resetConfigForTests } = await import("../src/config.js");
    const { builtinBots, isBuiltinSlug } = await import("../src/bots/builtin.js");
    const { RESERVED_SLUGS } = await import("../src/bots/types.js");
    resetConfigForTests();
    expect(builtinBots().some((b) => b.slug === "meet")).toBe(false);
    process.env.RECALL_API_KEY = "k"; resetConfigForTests();
    const meet = builtinBots().find((b) => b.slug === "meet");
    expect(meet).toMatchObject({ name: "Meetings", colour: "moss", ownerId: null, visibility: "private" });
    expect(isBuiltinSlug("meet")).toBe(true);
    expect(RESERVED_SLUGS).toContain("meet");
  });

  it("is what the front door picks for a call and its notes, never for a meeting to be planned or an invite written", async () => {
    const { resetConfigForTests } = await import("../src/config.js");
    const { builtinBots } = await import("../src/bots/builtin.js");
    const { scoreBots } = await import("../src/bots/door.js");
    process.env.RECALL_API_KEY = "k"; resetConfigForTests();
    const bots = builtinBots();
    const points = (m: string) => scoreBots(m, bots, { attachments: [], recent: [] } as never).find((s) => s.bot.slug === "meet")?.points ?? 0;
    for (const m of ["join my meeting https://meet.google.com/abc-defg-hij", "notes from today's standup", "summary of yesterday's call", "what did we decide in the meeting", "meeting bot"]) {
      expect(points(m), m).toBeGreaterThanOrEqual(8);
    }
    for (const m of ["schedule a meeting with Rahul", "write a meeting invite", "meeting at 5pm tomorrow"]) expect(points(m), m).toBe(0);
  });
});
