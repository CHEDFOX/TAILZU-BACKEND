/**
 * CALLS' LINK TO LIVEKIT (src/rooms/livekit.ts) AND THEIR LINKS (src/rooms/link.ts): a pass signed for one room, a host's with the room's
 * admin and a guest's without, short-lived; a JWT refused when tampered, unsigned, expired or of another key; LiveKit's webhook taken only
 * when signed over the exact body; the server's calls to LiveKit, each signed for just what it does, a room already gone taken as gone, a
 * refusal or a network failure in words that never hold the secret; a link's code made, read back from what a person pastes, and sealed.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { passFor, readJwt, signJwt, verifyLivekit, signLivekit, livekit, httpBaseOf } = await import("../src/rooms/livekit.js");
const { newCode, codeOf, hashOf, linkOf, sealer } = await import("../src/rooms/link.js");
const { RoomsError } = await import("../src/rooms/types.js");

const KEYS = { url: "wss://x0-test.livekit.cloud", key: "APIx0test", secret: "livekit-test-secret-0123456789abcdef" };
const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);
const SEC = Math.floor(NOW / 1000);

describe("a pass", () => {
  it("is signed for one room, a host's with the room's admin, a guest's without", () => {
    const host = readJwt(passFor({ room: "x0-r1", identity: "h_abc", name: "Aanya", host: true, ttlSec: 600 }, KEYS, SEC), KEYS.secret, SEC)!;
    expect(host).toMatchObject({ iss: KEYS.key, sub: "h_abc", name: "Aanya", exp: SEC + 600 });
    expect(host.video).toEqual({ room: "x0-r1", roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false, roomAdmin: true });
    expect(JSON.parse(String(host.metadata))).toEqual({ role: "host" });

    const guest = readJwt(passFor({ room: "x0-r1", identity: "g_xyz", name: "Ravi", host: false, ttlSec: 300 }, KEYS, SEC), KEYS.secret, SEC)!;
    expect(guest.video).not.toHaveProperty("roomAdmin");
    expect(guest.video).not.toHaveProperty("roomCreate");
    expect(JSON.parse(String(guest.metadata))).toEqual({ role: "guest" });
  });

  it("is refused tampered, unsigned, expired or signed with another secret", () => {
    const good = passFor({ room: "x0-r1", identity: "g_xyz", name: "Ravi", host: false, ttlSec: 300 }, KEYS, SEC);
    expect(readJwt(good, KEYS.secret, SEC)).not.toBeNull();
    expect(readJwt(good, "another-secret", SEC)).toBeNull();
    expect(readJwt(good, KEYS.secret, SEC + 300 + 120)).toBeNull();
    const [h, , s] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ iss: KEYS.key, sub: "h_me", video: { room: "x0-r1", roomJoin: true, roomAdmin: true } })).toString("base64url");
    expect(readJwt(`${h}.${forged}.${s}`, KEYS.secret, SEC)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    expect(readJwt(`${none}.${forged}.`, KEYS.secret, SEC)).toBeNull();
    expect(readJwt("not a jwt", KEYS.secret, SEC)).toBeNull();
    expect(readJwt(signJwt({ nbf: SEC + 3600 }, KEYS.secret), KEYS.secret, SEC)).toBeNull();
  });
});

describe("LiveKit's webhook", () => {
  const body = JSON.stringify({ event: "participant_joined", id: "EV_1", room: { name: "x0-r1" } });

  it("is taken signed over the exact body, with or without Bearer", () => {
    const auth = signLivekit(body, KEYS, SEC);
    expect(verifyLivekit(auth, body, KEYS, SEC)).toBe(true);
    expect(verifyLivekit(`Bearer ${auth}`, body, KEYS, SEC)).toBe(true);
  });

  it("is refused unsigned, for another body, by another key, or old", () => {
    const auth = signLivekit(body, KEYS, SEC);
    expect(verifyLivekit(undefined, body, KEYS, SEC)).toBe(false);
    expect(verifyLivekit(auth, `${body} `, KEYS, SEC)).toBe(false);
    expect(verifyLivekit(auth, body, { ...KEYS, key: "APIother" }, SEC)).toBe(false);
    expect(verifyLivekit(auth, body, { ...KEYS, secret: "other-secret" }, SEC)).toBe(false);
    expect(verifyLivekit(auth, body, KEYS, SEC + 3600)).toBe(false);
    // A pass is not a webhook: it carries no body's hash.
    expect(verifyLivekit(passFor({ room: "x0-r1", identity: "h_a", name: "A", host: true, ttlSec: 600 }, KEYS, SEC), body, KEYS, SEC)).toBe(false);
  });
});

describe("the server's calls to LiveKit", () => {
  function fake(status = 200) {
    const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) });
      return new Response("{}", { status });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it("is off without the three settings", () => {
    expect(livekit({ keys: null })).toBeNull();
  });

  it("makes, closes and sends people away, each call signed for just what it does", async () => {
    const f = fake();
    const lk = livekit({ keys: KEYS, fetchFn: f.fetchFn, now: () => NOW })!;
    expect(lk.url).toBe(KEYS.url);
    await lk.ensureRoom("x0-r1", { maxPeople: 10 });
    await lk.removeParticipant("x0-r1", "g_xyz");
    await lk.deleteRoom("x0-r1");
    expect(f.calls.map((c) => [c.url, c.body])).toEqual([
      ["https://x0-test.livekit.cloud/twirp/livekit.RoomService/CreateRoom", { name: "x0-r1", empty_timeout: 600, departure_timeout: 30, max_participants: 10 }],
      ["https://x0-test.livekit.cloud/twirp/livekit.RoomService/RemoveParticipant", { room: "x0-r1", identity: "g_xyz" }],
      ["https://x0-test.livekit.cloud/twirp/livekit.RoomService/DeleteRoom", { room: "x0-r1" }],
    ]);
    const grants = f.calls.map((c) => readJwt(c.auth.replace(/^Bearer /, ""), KEYS.secret, SEC)!.video);
    expect(grants).toEqual([{ roomCreate: true }, { roomAdmin: true, room: "x0-r1" }, { roomCreate: true }]);
  });

  it("takes a room already gone as gone, and says a refusal or a failure in words without the secret", async () => {
    await expect(livekit({ keys: KEYS, fetchFn: fake(404).fetchFn })!.deleteRoom("x0-r1")).resolves.toBeUndefined();
    const refused = livekit({ keys: KEYS, fetchFn: fake(401).fetchFn })!.ensureRoom("x0-r1", { maxPeople: 4 });
    await expect(refused).rejects.toBeInstanceOf(RoomsError);
    await expect(refused).rejects.toMatchObject({ status: 503, code: "room_service" });
    await expect(refused).rejects.not.toThrow(KEYS.secret);
    const down = livekit({ keys: KEYS, fetchFn: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch })!;
    await expect(down.ensureRoom("x0-r1", { maxPeople: 4 })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/couldn't be reached/) });
  });

  it("reaches the server API on the same host as the apps' address", () => {
    expect(httpBaseOf("wss://x.livekit.cloud/")).toBe("https://x.livekit.cloud");
    expect(httpBaseOf("ws://localhost:7880")).toBe("http://localhost:7880");
  });
});

describe("a call's link", () => {
  it("has a fresh code, read back from whatever a person pastes", () => {
    const code = newCode();
    expect(code).toMatch(/^[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}$/);
    expect(code).not.toMatch(/[01ilo]/);
    expect(newCode()).not.toBe(code);
    expect(codeOf(code.toUpperCase())).toBe(code);
    expect(codeOf(code.replace(/-/g, ""))).toBe(code);
    expect(codeOf(`https://x0bot.com/m/${code}?from=mail`)).toBe(code);
    expect(codeOf(linkOf(code, "https://x0bot.com/"))).toBe(code);
    expect(linkOf(code, "https://x0bot.com/")).toBe(`https://x0bot.com/m/${code}`);
    for (const bad of ["", "abc", "abc-defg-hi0", "../../etc", 42, null]) expect(codeOf(bad)).toBe("");
  });

  it("is found by its hash and kept sealed", () => {
    const code = newCode();
    expect(hashOf(code)).toMatch(/^[0-9a-f]{64}$/);
    const s = sealer(Buffer.alloc(32, 7));
    const sealed = s.seal(code);
    expect(sealed).not.toContain(code);
    expect(s.open(sealed)).toBe(code);
    expect(() => sealer(Buffer.alloc(32, 8)).open(sealed)).toThrow();
  });
});
