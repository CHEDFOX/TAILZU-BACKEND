/**
 * THE CALL SERVICE'S LINK TO CLOUDFLARE (src/rooms/sfu.ts) AND A CALL'S LINKS (src/rooms/link.ts): a session made, a person's own tracks
 * published by the mids of their offer, someone else's pulled into their session, the answer sent back, tracks closed; the App Secret in
 * the header and never in an error; a refusal, a busy session and a network failure each in words for a person; a link's code made, read
 * back from whatever a person pastes, and sealed.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { sfu } = await import("../src/rooms/sfu.js");
const { newCode, codeOf, hashOf, linkOf, sealer } = await import("../src/rooms/link.js");
const { RoomsError } = await import("../src/rooms/types.js");

const KEYS = { appId: "app-123", appSecret: "sfu-test-secret-0123456789abcdef" };
const AT = "https://rtc.live.cloudflare.com/v1/apps/app-123";

function fake(answers: unknown[], status = 200) {
  const calls: Array<{ url: string; method: string; auth: string; body: unknown }> = [];
  let i = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({
      url, method: String(init.method), auth: String((init.headers as Record<string, string>).authorization),
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(answers[i++] ?? {}), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe("the SFU client", () => {
  it("is off without both settings", () => {
    expect(sfu({ keys: null })).toBeNull();
  });

  it("makes a session, publishes a person's own tracks and sends the answer back", async () => {
    const f = fake([
      { sessionId: "sess-1" },
      { sessionDescription: { type: "answer", sdp: "ANSWER" } },
      {},
    ]);
    const s = sfu({ keys: KEYS, fetchFn: f.fetchFn })!;
    expect(await s.newSession()).toBe("sess-1");
    const answer = await s.publish("sess-1", { type: "offer", sdp: "OFFER" }, [
      { mid: "0", trackName: "h_a-audio" }, { mid: "1", trackName: "h_a-video" },
    ]);
    expect(answer).toEqual({ type: "answer", sdp: "ANSWER" });
    await s.answer("sess-1", "MY-ANSWER");

    expect(f.calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", `${AT}/sessions/new`],
      ["POST", `${AT}/sessions/sess-1/tracks/new`],
      ["PUT", `${AT}/sessions/sess-1/renegotiate`],
    ]);
    expect(f.calls[1]!.body).toEqual({
      sessionDescription: { type: "offer", sdp: "OFFER" },
      tracks: [
        { location: "local", mid: "0", trackName: "h_a-audio" },
        { location: "local", mid: "1", trackName: "h_a-video" },
      ],
    });
    expect(f.calls[2]!.body).toEqual({ sessionDescription: { type: "answer", sdp: "MY-ANSWER" } });
    // The App Secret is the only credential there is, so every call carries it and nothing else does.
    expect(f.calls.every((c) => c.auth === `Bearer ${KEYS.appSecret}`)).toBe(true);
  });

  it("pulls someone else's tracks into a session, with the offer to answer", async () => {
    const f = fake([{
      sessionDescription: { type: "offer", sdp: "THEIR-OFFER" },
      requiresImmediateRenegotiation: true,
      tracks: [{ trackName: "g_b-audio", mid: "2" }, { trackName: "g_b-video", error: { errorDescription: "gone" } }],
    }]);
    const out = await sfu({ keys: KEYS, fetchFn: f.fetchFn })!.pull("sess-1", [
      { sessionId: "sess-2", trackName: "g_b-audio" }, { sessionId: "sess-2", trackName: "g_b-video" },
    ]);
    expect(f.calls[0]!.body).toEqual({
      tracks: [
        { location: "remote", sessionId: "sess-2", trackName: "g_b-audio" },
        { location: "remote", sessionId: "sess-2", trackName: "g_b-video" },
      ],
    });
    expect(out.offer).toEqual({ type: "offer", sdp: "THEIR-OFFER" });
    expect(out.mustAnswer).toBe(true);
    expect(out.tracks).toEqual([{ trackName: "g_b-audio", mid: "2" }, { trackName: "g_b-video", error: "gone" }]);
  });

  it("closes tracks, and asks for nothing when there are none", async () => {
    const f = fake([{}]);
    const s = sfu({ keys: KEYS, fetchFn: f.fetchFn })!;
    await s.closeTracks("sess-1", []);
    expect(f.calls).toEqual([]);
    await s.closeTracks("sess-1", ["0", "1"]);
    expect(f.calls[0]).toMatchObject({ method: "PUT", url: `${AT}/sessions/sess-1/tracks/close` });
    expect(f.calls[0]!.body).toEqual({ tracks: [{ mid: "0" }, { mid: "1" }], force: true });
  });

  it("says a refusal, a busy session and a failure in words for a person, never the secret", async () => {
    const refused = sfu({ keys: KEYS, fetchFn: fake([{}], 401).fetchFn })!.newSession();
    await expect(refused).rejects.toBeInstanceOf(RoomsError);
    await expect(refused).rejects.toMatchObject({ status: 503, code: "room_service" });
    await expect(refused).rejects.not.toThrow(KEYS.appSecret);

    // 406: a second change while the first is unanswered. The service holds a lock per seat, so this is a lost race.
    await expect(sfu({ keys: KEYS, fetchFn: fake([{}], 406).fetchFn })!.newSession())
      .rejects.toMatchObject({ status: 409, code: "room_busy" });

    // The SFU answers 200 with an errorDescription when it refuses the body itself.
    await expect(sfu({ keys: KEYS, fetchFn: fake([{ errorDescription: "no such track" }]).fetchFn })!.newSession())
      .rejects.toMatchObject({ status: 502 });

    const down = sfu({ keys: KEYS, fetchFn: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch })!;
    await expect(down.newSession()).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/couldn't be reached/) });
  });

  it("refuses an answer that is not one", async () => {
    await expect(sfu({ keys: KEYS, fetchFn: fake([{ sessionId: "" }]).fetchFn })!.newSession()).rejects.toMatchObject({ status: 502 });
    await expect(sfu({ keys: KEYS, fetchFn: fake([{ sessionDescription: { type: "offer", sdp: "x" } }]).fetchFn })!
      .publish("s", { type: "offer", sdp: "o" }, [{ mid: "0", trackName: "t" }])).rejects.toMatchObject({ status: 502 });
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
