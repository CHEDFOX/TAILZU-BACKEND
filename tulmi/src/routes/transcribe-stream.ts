/**
 * Tulmi live dictation — /v1/transcribe-stream.
 *
 * Implements the WebSocket protocol documented in STREAMING.md:
 *   client → { type:"start", token, ... } then raw 16 kHz mono PCM frames,
 *            then { type:"stop" }
 *   server → { type:"ready" | "partial" | "final" | "done" | "error" }
 *
 * Speech engine: chosen SERVER-SIDE (see live-engines.ts) — Deepgram or
 * Sarvam. The wire protocol to the phone never changes, so switching engines
 * is a config change on the VPS, never an app update.
 *
 * DUAL MODE (STT_LIVE_DUAL): both engines hear the audio. The primary streams
 * partials/finals to the user as usual; the second listens silently. At stop,
 * when their transcripts disagree, `done` carries the second reading as
 * `{ type:"done", alternative }` — the client forwards it to /v1/refine, which
 * reconciles the two before writing (the same fusion the one-shot path runs).
 * The field is additive: older clients ignore it.
 *
 * SECURITY: this endpoint verifies the caller's Supabase JWT before opening a
 * Deepgram session so an unauthenticated client can never burn Deepgram credit.
 * The JWT is accepted from EITHER the WS upgrade `Authorization` header OR the
 * `start` message's `token` field (some browser/native clients can't set
 * upgrade headers).
 *
 * Requires:  npm i @fastify/websocket @deepgram/sdk
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import websocket from "@fastify/websocket";
import { getConfig } from "../config.js";
import {
  openLiveEngine,
  openShadowEngine,
  liveEngineConfigured,
  type LiveEngine,
} from "./live-engines.js";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { enforceQuota, recordUsage } from "../usage/metering.js";
import { sanitizePlainTranscript, transcriptsAgree, isUsableAlternative } from "../pipeline/stt.js";

interface StartMessage {
  type: "start";
  token?: string;
  targetApp?: string;
  /** Accepted for wire compatibility with older clients, but DELIBERATELY
   *  IGNORED: the backend detects the language (see openEngine). */
  language?: string;
  sampleRate?: number;
  encoding?: string;
  channels?: number;
}

/** Count whitespace-delimited words in a transcript segment. */
function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Cap the total bytes a single stream may push before we hard-close it.
 *  30 MB of 16 kHz mono PCM is ~15 minutes of dictation — far beyond a real
 *  session; anything past that is either buggy or hostile. */
const MAX_STREAM_BYTES = 30 * 1024 * 1024;

/** Close the socket if no audio arrives for this long after `ready`. */
const IDLE_TIMEOUT_MS = 60_000;

/** Reject the whole session if `start` never arrives within this window. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

async function transcribeStream(fastify: FastifyInstance): Promise<void> {
  if (!fastify.hasDecorator("websocketServer")) {
    await fastify.register(websocket);
  }

  const cfg = getConfig();
  // Engine credentials are resolved per-connection (see openEngine) so a key
  // added to the environment takes effect on the next dictation, not the next
  // process restart.

  fastify.get(
    "/v1/transcribe-stream",
    {
      websocket: true,
      // Throttle the HTTP upgrade like every authed route — otherwise an
      // anonymous connect flood amplifies per-connection auth lookups.
      config: { rateLimit: { max: cfg.RATE_LIMIT_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS } },
    },
    (socket: any, req: FastifyRequest) => {
      let engine: LiveEngine | null = null;
      // The SECOND live engine, when dual mode is on. It hears the same audio
      // but never reaches the user mid-stream — its transcript accumulates and
      // is handed over at "done" so the client's refine step can reconcile the
      // two readings (see live-engines.openShadowEngine).
      let shadow: LiveEngine | null = null;
      // Committed segments from each engine, joined at stop.
      const primaryFinals: string[] = [];
      const shadowFinals: string[] = [];
      let closed = false;
      let user: AuthedUser | null = null;
      let bytes = 0;
      let sampleRate = 16000;
      let handshakeTimer: NodeJS.Timeout | null = setTimeout(() => {
        send({ type: "error", code: "bad_request", message: "start message not received" });
        safeClose();
      }, HANDSHAKE_TIMEOUT_MS);
      let idleTimer: NodeJS.Timeout | null = null;
      // Guards the single terminal "done" — set once, whether it fires from the
      // engine's Close (the flush-complete path) or the stop fallback timer.
      let doneSent = false;
      let doneFallback: NodeJS.Timeout | null = null;
      // Metering guard — bytes/words processed are billed EXACTLY once, on
      // whatever teardown path fires first (stop, cancel, app-switch, drop,
      // idle, engine close). Without this, only a graceful "stop" billed and a
      // user who always exits by switching apps streamed paid STT for free.
      let metered = false;
      // Real word count for word-based quotas (was hardcoded 0 → never tripped).
      let totalWords = 0;
      // Set when the stream ended in an error/abnormal close, so we don't mask
      // a failure as a successful "done".
      let errored = false;

      const send = (obj: unknown) => {
        if (!closed && socket.readyState === 1) socket.send(JSON.stringify(obj));
      };

      const closeEngine = () => {
        try { engine?.close(); } catch { /* ignore */ }
        try { shadow?.close(); } catch { /* ignore */ }
      };

      // Bill the audio + words processed so far — EXACTLY once, guarded, and
      // called from every teardown path (via safeClose) so a cancel /
      // app-switch / network drop bills just like a graceful stop. Without
      // this, only "stop" metered and every other exit streamed for free.
      const meterOnce = () => {
        if (metered) return;
        metered = true;
        if (!user || bytes <= 0) return;
        // linear16 mono → 2 bytes/sample. Rough seconds of audio processed.
        const seconds = bytes / (sampleRate * 2);
        recordUsage({
          user,
          source: "stream",
          audioSeconds: Number(seconds.toFixed(2)),
          words: totalWords,
          model: engine?.label ?? "live:unknown",
        }).catch(() => { /* metering must never break the close path */ });
      };

      const safeClose = () => {
        closed = true;
        if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        if (doneFallback) { clearTimeout(doneFallback); doneFallback = null; }
        meterOnce(); // bill on EVERY teardown, not just graceful stop
        closeEngine();
        try { socket.close(); } catch { /* ignore */ }
      };

      // Terminal "done" for a graceful/engine close: tell the client we're done
      // (unless we already errored) and close. safeClose does the metering.
      const finishDone = () => {
        if (doneSent) return;
        doneSent = true;
        if (doneFallback) { clearTimeout(doneFallback); doneFallback = null; }
        if (!errored) {
          // Hand the client BOTH readings. The engines segment differently, so
          // they can't be merged blind — the refine step reconciles them the
          // same way the one-shot path does (see pipeline/stt.ts fusion). Only
          // send the alternative when it's a real disagreement; identical
          // readings carry no information. Older clients ignore the extra
          // field, so this stays wire-compatible.
          const primaryText = primaryFinals.join(" ").trim();
          const shadowText = shadowFinals.join(" ").trim();
          const useAlternative =
            !!shadowText &&
            !!primaryText &&
            !transcriptsAgree(primaryText, shadowText) &&
            isUsableAlternative(primaryText, shadowText);
          send(useAlternative ? { type: "done", alternative: shadowText } : { type: "done" });
        }
        safeClose();
      };

      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          send({ type: "error", code: "bad_request", message: "idle timeout" });
          safeClose();
        }, IDLE_TIMEOUT_MS);
      };

      const openEngine = (start: StartMessage) => {
        if (!liveEngineConfigured()) {
          send({ type: "error", code: "internal", message: "streaming STT not configured on server" });
          safeClose();
          return;
        }
        sampleRate = start.sampleRate ?? 16000;

        // WHICH engine (Deepgram / Sarvam) is decided server-side in
        // live-engines.ts. Neither is pinned to a language — the backend
        // identifies the speech, so both open in multilingual/auto-detect
        // mode. The client's `language` field is ignored on purpose: it
        // carries a preference the user set once on the onboarding screen,
        // and honoring it locked the recognizer to that single language,
        // breaking code-switching.
        engine = openLiveEngine(
          { sampleRate, channels: start.channels ?? 1 },
          {
            onReady: () => {
              send({ type: "ready" });
              armIdle();
            },
            onPartial: (text) => {
              // Provisional — forward as-is for the live effect; the final
              // below is the sanitized commit point.
              send({ type: "partial", text });
            },
            onFinal: (raw) => {
              // Sanitize the finalized segment before it reaches the cursor:
              // strip STT hallucinations / boilerplate. The engine's VAD
              // already gated on speech, so trust it (don't nuke ambiguous
              // one-word fillers). We ALWAYS send a final — an empty one tells
              // the client to clear whatever provisional partial it was
              // showing, so a noise partial can't get stranded at the cursor.
              // The meta guard belongs on LLM refine output, not raw STT.
              const text = sanitizePlainTranscript(raw, { trustSpeech: true });
              // Sum words from finalized segments only (partials are supersets
              // that get replaced) so word-based quotas meter the real transcript.
              if (text) {
                totalWords += countWords(text);
                primaryFinals.push(text);
              }
              send({ type: "final", text });
            },
            onError: (message) => {
              errored = true;
              send({ type: "error", code: "stt_failed", message });
            },
            onClose: (abnormalCode) => {
              // The engine closed. Normally this fires AFTER it flushes its
              // final tail segment(s) in response to close(), so routing
              // "done" through here (not a fixed timer) guarantees the last
              // words reach the client. An abnormal close must NOT be masked
              // as a successful "done".
              if (abnormalCode !== undefined && !errored) {
                errored = true;
                send({ type: "error", code: "stt_failed", message: `stream closed abnormally (${abnormalCode})` });
              }
              finishDone();
            },
          },
        );

        // Second listener (dual mode). Its partials are ignored entirely — only
        // committed segments matter for the end-of-stream reconciliation — and
        // every one of its callbacks is inert toward the user's session, so a
        // shadow that dies mid-stream costs nothing.
        shadow = openShadowEngine(
          { sampleRate, channels: start.channels ?? 1 },
          {
            onReady: () => { /* the user's session is already live */ },
            onPartial: () => { /* provisional; never displayed */ },
            onFinal: (raw) => {
              const text = sanitizePlainTranscript(raw, { trustSpeech: true });
              if (text) shadowFinals.push(text);
            },
            onError: () => { /* best-effort second opinion */ },
            onClose: () => { /* the primary owns session teardown */ },
          },
        );
      };

      socket.on("message", async (raw: Buffer, isBinary: boolean) => {
        if (closed) return;

        if (isBinary) {
          // Never accept audio before auth + start. Silent drop is safer than
          // opening a Deepgram session behind the caller's back.
          if (!user || !engine) return;
          bytes += raw.length;
          if (bytes > MAX_STREAM_BYTES) {
            send({ type: "error", code: "audio_too_long", message: "stream size cap reached" });
            safeClose();
            return;
          }
          engine.send(raw);
          // The shadow hears the same audio; a failure there must never
          // disturb the stream the user is actually watching.
          try { shadow?.send(raw); } catch { /* shadow is best-effort */ }
          armIdle();
          return;
        }

        // Text frames are JSON control messages.
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === "start") {
          // Extract JWT: prefer header, fall back to inline token.
          const headerAuth = req.headers["authorization"];
          const inlineAuth = typeof msg.token === "string" && msg.token
            ? `Bearer ${msg.token}` : undefined;
          user = await resolveUser(headerAuth ?? inlineAuth);
          if (!user) {
            send({ type: "error", code: "unauthorized", message: "invalid or missing token" });
            safeClose();
            return;
          }
          // Pre-flight quota check — refuse before we bill Deepgram anything.
          const over = await enforceQuota(user);
          if (over) {
            send({ type: "error", code: "quota_exceeded", message: over });
            safeClose();
            return;
          }
          if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
          openEngine(msg as StartMessage);
          return;
        }

        if (msg.type === "stop") {
          // Ask Deepgram to flush + finalize the tail. Its Close event fires
          // AFTER it emits the final tail segment(s), and THAT drives
          // finishDone() — so the last words always reach the client before we
          // close. Cutting the socket on a fixed 300 ms timer (the old code)
          // dropped whatever Deepgram hadn't flushed yet → every dictation's
          // tail got truncated. The fallback timer only fires if the engine's
          // Close never arrives (wedged/dropped), so we don't hang.
          closeEngine();
          if (!doneFallback && !doneSent) {
            doneFallback = setTimeout(finishDone, 1500);
          }
        }
      });

      socket.on("close", () => safeClose());
      socket.on("error", () => safeClose());
    },
  );
}

export default fp(transcribeStream, { name: "tulmi-transcribe-stream" });
