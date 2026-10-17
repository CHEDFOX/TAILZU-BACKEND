/**
 * A stream error is read by a person, so it is written for one.
 *
 * The app toasts a stream error's `message` and the desktop puts it in a
 * notification, as it stands. It used to be the developer's note: "idle
 * timeout", "stream closed abnormally (1006)", the speech provider's own error
 * text. These tests pin the words, and pin that nothing technical reaches the
 * wire in their place.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

type H = { onReady(): void; onPartial(t: string): void; onFinal(t: string): void; onError(m: string): void; onClose(c?: number): void };
const engines: { primary?: H } = {};

vi.mock("../src/routes/live-engines.js", () => ({
  liveEngineConfigured: () => true,
  openLiveEngine: (_o: unknown, h: H) => {
    engines.primary = h;
    setTimeout(() => h.onReady(), 0);
    return { label: "test:primary", send: () => {}, close: () => setTimeout(() => h.onClose(), 0) };
  },
  openShadowEngine: () => ({ label: "test:shadow", send: () => {}, close: () => {} }),
}));

const { STREAM_ERROR_TEXT } = await import("../src/routes/transcribe-stream.js");
const { buildApp } = await import("../src/server.js");

/**
 * The same test the app applies (app/modules/tulmi-stream/index.ts,
 * readsAsSentence) to decide whether a stream error's text can be shown or
 * must be replaced by its own words. A message that fails it is never seen by
 * anyone on the phone, so every message the server writes has to pass it.
 */
function readsAsSentence(s: string): boolean {
  const t = s.trim();
  if (t.split(/\s+/).length < 3) return false;
  if (!/^[A-Z]/.test(t) || !/[.!?]$/.test(t)) return false;
  if (/[:;/\\{}[\]<>=_|@#$%^*~`]/.test(t)) return false;
  return !/\b(error|exception|errno|null|nil|undefined|nan|socket|websocket|https?|wss?|url|json|stt|token|timeout|timed out|abnormal(ly)?|domain|status|code|stream|frames?)\b/i.test(t);
}

const { unauthorized, ...worded } = STREAM_ERROR_TEXT;

describe("stream error words", () => {
  it.each(Object.entries(worded))("%s is a sentence a person can act on", (_k, text) => {
    expect(readsAsSentence(text)).toBe(true);
    for (const jargon of [/timeout/i, /\bSTT\b/i, /token/i, /abnormal/i, /\(\d+\)/, /cap reached/i, /not received/i, /not configured/i, /\bserver\b/i]) {
      expect(text).not.toMatch(jargon);
    }
  });

  it("the old developer notes would all have been refused", () => {
    // Guards the check itself: if it let these through, the test above would
    // prove nothing.
    for (const old of [
      "start message not received", "idle timeout", "streaming STT not configured on server",
      "stream closed abnormally (1006)", "stream size cap reached", "invalid or missing token",
      "Mic start: Error Domain=NSOSStatusErrorDomain Code=-10868", "Audio session: The operation couldn't be completed.",
      "Bad server URL", "stream error", "stream failed", "Socket closed", "Failed to connect to /10.0.2.2:8770",
    ]) expect(readsAsSentence(old), old).toBe(false);
  });

  it("the quota refusal, already written for people, passes too", () => {
    for (const q of [
      "Couldn't verify your usage right now — please try again in a moment.",
      "Monthly voice cap reached (40 min). Resets 2026-10-01.",
      "You've used your 2,800 words this month (2,500 free + 300 earned). Upgrade for unlimited, or wait until 2026-10-01.",
    ]) expect(readsAsSentence(q), q).toBe(true);
  });

  it("the sign-in refusal keeps the text the installed keyboards match", () => {
    // Both keyboards spot an expired sign-in by this substring and ask the
    // person to open Tailzu; they never show it. See STREAM_ERROR_TEXT.
    expect(unauthorized.toLowerCase()).toContain("invalid or missing token");
  });
});

let app: FastifyInstance;
let port: number;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await app.listen({ port: 0, host: "127.0.0.1" });
  port = (app.server.address() as AddressInfo).port;
});
afterAll(async () => { await app.close(); });

const tick = () => new Promise((r) => setTimeout(r, 20));

async function openStream(): Promise<{ ws: WebSocket; got: Array<Record<string, unknown>> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/transcribe-stream`);
  const got: Array<Record<string, unknown>> = [];
  ws.on("message", (d) => got.push(JSON.parse(String(d))));
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "start", token: "t", sampleRate: 16000 }));
  await tick(); await tick();
  return { ws, got };
}

describe("stream errors on the wire", () => {
  it("an engine failure sends the sentence, never the provider's text", async () => {
    const { ws, got } = await openStream();
    engines.primary!.onError('Deepgram error: 400 {"err_code":"INVALID_AUTH"}');
    await tick();
    const err = got.find((m) => m.type === "error");
    expect(err).toEqual({ type: "error", code: "stt_failed", message: STREAM_ERROR_TEXT.engineFailed });
    expect(JSON.stringify(got)).not.toMatch(/Deepgram|INVALID_AUTH|400/);
    ws.close();
  });

  it("an abnormal engine close sends the sentence, never the close code", async () => {
    const { ws, got } = await openStream();
    engines.primary!.onClose(1006);
    await tick();
    const err = got.find((m) => m.type === "error");
    expect(err).toEqual({ type: "error", code: "stt_failed", message: STREAM_ERROR_TEXT.dropped });
    expect(JSON.stringify(got)).not.toMatch(/1006|abnormal/i);
    ws.close();
  });
});
