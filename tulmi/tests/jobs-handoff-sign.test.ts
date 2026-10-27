/**
 * The signature between the VPS and the jobs Worker (src/code/jobs/handoff/sign.ts): HMAC-SHA256 over method, path, timestamp,
 * nonce and body; five minutes; a nonce used once. The same file runs on the Worker, so its own tests (jobs/test) repeat the
 * cases that matter against the real Durable Object.
 */
import { describe, expect, it } from "vitest";
import {
  MemoryNonceStore, NONCE_HEADER, SIGNATURE_HEADER, SIGNATURE_WINDOW_MS, TIMESTAMP_HEADER, signRequest, signingString, verifyRequest, type VerifyOptions,
} from "../src/code/jobs/handoff/sign.js";

const SECRET = "s".repeat(40);
const BODY = JSON.stringify({ jobId: "00000000-0000-4000-8000-000000000001" });
const NOW = 1_800_000_000_000;

function check(headers: Record<string, string>, over: Partial<VerifyOptions> = {}) {
  return verifyRequest({
    secret: SECRET, method: "POST", path: "/v1/start", body: BODY, header: (n) => headers[n], nonces: new MemoryNonceStore(() => NOW), now: NOW, ...over,
  });
}
const sign = (over: Partial<Parameters<typeof signRequest>[0]> = {}) => signRequest({ secret: SECRET, method: "POST", path: "/v1/start", body: BODY, now: NOW, ...over });

describe("signing a request", () => {
  it("writes the three headers, and the signature is a hex HMAC over method, path, timestamp, nonce and body", () => {
    const h = sign({ nonce: "nonce-0123456789abcdef" });
    expect(h[TIMESTAMP_HEADER]).toBe(String(NOW));
    expect(h[NONCE_HEADER]).toBe("nonce-0123456789abcdef");
    expect(h[SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
    expect(signingString("post", "/v1/start", "1", "n", "{}")).toBe("POST\n/v1/start\n1\nn\n{}");
  });

  it("is different for every part of what it covers", () => {
    const base = sign({ nonce: "nonce-0123456789abcdef" })[SIGNATURE_HEADER];
    const sigs = [
      sign({ nonce: "nonce-0123456789abcdef", secret: "t".repeat(40) }), sign({ nonce: "nonce-0123456789abcdef", method: "PUT" }), sign({ nonce: "nonce-0123456789abcdef", path: "/v1/event" }),
      sign({ nonce: "nonce-0123456789abcdef", body: "{}" }), sign({ nonce: "nonce-0123456789abcdef", now: NOW + 1 }), sign({ nonce: "nonce-9123456789abcdef" }),
    ].map((h) => h[SIGNATURE_HEADER]);
    for (const s of sigs) expect(s).not.toBe(base);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("makes a new nonce for every request", () => {
    expect(sign()[NONCE_HEADER]).not.toBe(sign()[NONCE_HEADER]);
    expect(sign()[NONCE_HEADER]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe("verifying one", () => {
  it("takes a good signature", async () => {
    expect(await check(sign())).toEqual({ ok: true });
  });

  it("refuses the wrong secret, a changed body, path or method, and a changed nonce or timestamp", async () => {
    const h = sign({ nonce: "nonce-0123456789abcdef" });
    expect(await check(h, { secret: "x".repeat(40) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check(h, { body: BODY.replace("1", "2") })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check(h, { path: "/v1/event" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check(h, { method: "GET" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ ...h, [NONCE_HEADER]: "nonce-9123456789abcdef" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ ...h, [TIMESTAMP_HEADER]: String(NOW + 1) })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a signature that is not hex, is short or is empty", async () => {
    const h = sign();
    expect(await check({ ...h, [SIGNATURE_HEADER]: "zz".repeat(32) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ ...h, [SIGNATURE_HEADER]: h[SIGNATURE_HEADER]!.slice(0, 32) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check({ ...h, [SIGNATURE_HEADER]: "" })).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses a request with a header missing, a nonce that is not one, or a timestamp that is not a time", async () => {
    const h = sign();
    for (const drop of [TIMESTAMP_HEADER, NONCE_HEADER, SIGNATURE_HEADER]) {
      const { [drop]: _gone, ...rest } = h;
      expect(await check(rest)).toEqual({ ok: false, reason: "missing" });
    }
    expect(await check(sign({ nonce: "short" }))).toEqual({ ok: false, reason: "missing" });
    expect(await check({ ...h, [TIMESTAMP_HEADER]: "yesterday" })).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(await check({ ...h, [TIMESTAMP_HEADER]: "-5" })).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("takes the window either way, and not a second more", async () => {
    expect(await check(sign({ now: NOW - SIGNATURE_WINDOW_MS }))).toEqual({ ok: true });
    expect(await check(sign({ now: NOW + SIGNATURE_WINDOW_MS }))).toEqual({ ok: true });
    expect(await check(sign({ now: NOW - SIGNATURE_WINDOW_MS - 1 }))).toEqual({ ok: false, reason: "expired" });
    expect(await check(sign({ now: NOW + SIGNATURE_WINDOW_MS + 1 }))).toEqual({ ok: false, reason: "expired" });
    expect(SIGNATURE_WINDOW_MS).toBe(5 * 60_000);
  });

  it("refuses the same request twice (a replay), and the nonce can be used by nothing else", async () => {
    const nonces = new MemoryNonceStore(() => NOW);
    const h = sign();
    expect(await check(h, { nonces })).toEqual({ ok: true });
    expect(await check(h, { nonces })).toEqual({ ok: false, reason: "replayed" });
    // A different request with the same nonce is a replayed nonce too.
    expect(await check(sign({ nonce: h[NONCE_HEADER]!, body: "{}" }), { nonces, body: "{}" })).toEqual({ ok: false, reason: "replayed" });
  });

  it("writes a nonce down only for a request that passed everything else", async () => {
    const nonces = new MemoryNonceStore(() => NOW);
    const forged = sign({ nonce: "nonce-0123456789abcdef", secret: "t".repeat(40) });
    expect(await check(forged, { nonces })).toEqual({ ok: false, reason: "bad_signature" });
    expect(await check(sign({ nonce: "nonce-0123456789abcdef" }), { nonces })).toEqual({ ok: true });
  });

  it("forgets a nonce once its time is up, so memory does not grow", async () => {
    let t = NOW;
    const nonces = new MemoryNonceStore(() => t);
    expect(nonces.claim("a", t + 1_000)).toBe(true);
    expect(nonces.claim("a", t + 1_000)).toBe(false);
    t += 2_000;
    expect(nonces.claim("a", t + 1_000)).toBe(true);
  });

  it("holds at most its cap, dropping the oldest", () => {
    const nonces = new MemoryNonceStore(() => NOW, 3);
    for (const n of ["a", "b", "c", "d"]) expect(nonces.claim(n, NOW + 10_000)).toBe(true);
    expect(nonces.claim("a", NOW + 10_000)).toBe(true); // "a" was dropped to make room, so it reads as new
    expect(nonces.claim("d", NOW + 10_000)).toBe(false);
  });
});
