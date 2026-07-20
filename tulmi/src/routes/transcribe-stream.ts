/**
 * Tulmi live dictation — /v1/transcribe-stream.
 *
 * Implements the WebSocket protocol documented in STREAMING.md:
 *   client → { type:"start", token, ... } then raw 16 kHz mono PCM frames,
 *            then { type:"stop" }
 *   server → { type:"ready" | "partial" | "final" | "done" | "error" }
 *
 * Speech engine: Deepgram (streaming). Swappable — the wire protocol to the
 * phone stays the same.
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
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { getConfig } from "../config.js";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { enforceQuota, recordUsage } from "../usage/metering.js";
import { sanitizePlainTranscript } from "../pipeline/stt.js";

interface StartMessage {
  type: "start";
  token?: string;
  targetApp?: string;
  language?: string; // "auto" | "hi" | "en" | "multi" | ...
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
  const deepgram = cfg.DEEPGRAM_API_KEY ? createClient(cfg.DEEPGRAM_API_KEY) : null;

  fastify.get(
    "/v1/transcribe-stream",
    { websocket: true },
    (socket: any, req: FastifyRequest) => {
      let dg: any = null;
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
        try {
          if (typeof dg?.requestClose === "function") dg.requestClose();
          else if (typeof dg?.finish === "function") dg.finish();
        } catch {
          /* ignore */
        }
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
          model: `deepgram:${cfg.DEEPGRAM_STT_MODEL || "nova-2"}`,
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
        if (!errored) send({ type: "done" });
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
        if (!deepgram) {
          send({ type: "error", code: "internal", message: "streaming STT not configured on server" });
          safeClose();
          return;
        }
        sampleRate = start.sampleRate ?? 16000;
        const language = !start.language || start.language === "auto" ? "multi" : start.language;

        dg = deepgram.listen.live({
          model: cfg.DEEPGRAM_STT_MODEL || "nova-2",
          language,
          encoding: "linear16",
          sample_rate: sampleRate,
          channels: start.channels ?? 1,
          interim_results: true,
          smart_format: true,
          punctuate: true,
          numerals: true,
          // Robustness in noisy/real-world capture (Layer D): let Deepgram's
          // own VAD do endpointing so we cut on natural pauses, emit
          // UtteranceEnd events, and don't hold a final open waiting for
          // silence that a noisy room never delivers.
          //   endpointing      — ms of trailing silence that finalizes a
          //                      segment (300ms = snappy but not choppy).
          //   utterance_end_ms — fire UtteranceEnd after ~1s of no speech so
          //                      the client can commit even if the socket
          //                      stays open (requires interim_results, on).
          //   vad_events       — surface SpeechStarted so we could gate UI on
          //                      real speech rather than energy.
          endpointing: 300,
          utterance_end_ms: 1000,
          vad_events: true,
        });

        dg.on(LiveTranscriptionEvents.Open, () => {
          send({ type: "ready" });
          armIdle();
        });
        dg.on(LiveTranscriptionEvents.Transcript, (data: any) => {
          const raw = data?.channel?.alternatives?.[0]?.transcript ?? "";
          if (!raw) return;
          if (data.is_final) {
            // Sanitize the finalized segment before it reaches the cursor: strip
            // STT hallucinations / boilerplate, and drop a conversational meta
            // reply ("thanks for watching", "I didn't catch that"). Deepgram's
            // VAD already gated on speech, so trust it (don't nuke ambiguous
            // one-word fillers). We ALWAYS send a final — an empty one tells the
            // client to clear whatever provisional partial it was showing, so a
            // noise partial can't get stranded at the cursor.
            // Deepgram returns the user's ACTUAL words (it doesn't hallucinate
            // conversational filler), so we only strip STT hallucinations here —
            // NOT via the meta guard, which would drop a legit "say that again".
            // The meta guard belongs on LLM refine output, not raw STT.
            const text = sanitizePlainTranscript(raw, { trustSpeech: true });
            // Sum words from finalized segments only (partials are supersets that
            // get replaced) so word-based quotas meter the real transcript.
            if (text) totalWords += countWords(text);
            send({ type: "final", text });
          } else {
            // Partials are provisional — forward as-is for the live effect; the
            // final above is the sanitized commit point.
            send({ type: "partial", text: raw });
          }
        });
        dg.on(LiveTranscriptionEvents.Error, (e: any) => {
          errored = true;
          send({ type: "error", code: "stt_failed", message: String(e?.message ?? e) });
        });
        dg.on(LiveTranscriptionEvents.Close, (event: any) => {
          // Deepgram closed. Normally this fires AFTER it flushes its final tail
          // segment(s) in response to requestClose(), so routing "done" through
          // here (not a fixed timer) guarantees the last words reach the client.
          // BUT an abnormal close (e.g. 1011 server error) must NOT be masked as
          // a successful "done" — surface it as an error first.
          const code = typeof event?.code === "number" ? event.code
            : typeof event?.target?.code === "number" ? event.target.code : undefined;
          if (code !== undefined && code !== 1000 && code !== 1005 && !errored) {
            errored = true;
            send({ type: "error", code: "stt_failed", message: `stream closed abnormally (${code})` });
          }
          finishDone();
        });
      };

      socket.on("message", async (raw: Buffer, isBinary: boolean) => {
        if (closed) return;

        if (isBinary) {
          // Never accept audio before auth + start. Silent drop is safer than
          // opening a Deepgram session behind the caller's back.
          if (!user || !dg) return;
          bytes += raw.length;
          if (bytes > MAX_STREAM_BYTES) {
            send({ type: "error", code: "audio_too_long", message: "stream size cap reached" });
            safeClose();
            return;
          }
          try { dg.send(raw); } catch { /* engine window closed */ }
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
