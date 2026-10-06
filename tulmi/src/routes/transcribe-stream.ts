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
 * DUAL MODE (STT_LIVE_DUAL): both engines hear the audio, and BOTH produce a
 * live transcript — the second is a full streaming engine, not a file job. So
 * which one reaches the cursor is a decision, made once per utterance rather
 * than once in config: the primary streams until a committed segment comes
 * back in a native Indic script from one engine and not the other, and from
 * then on the engine that recognised the language is the one being watched.
 * Once, at a segment boundary, because swapping per partial makes the text
 * jitter between two readings.
 *
 * At stop, when the two transcripts disagree, `done` carries the other reading
 * as `{ type:"done", alternative }` — the client forwards it to /v1/refine,
 * which reconciles them before writing (the same fusion the one-shot path
 * runs). The field is additive: older clients ignore it.
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
  type SegmentTiming,
} from "./live-engines.js";
import { resolveUser, type AuthedUser } from "../auth/supabase.js";
import { getPersonality } from "../personality/store.js";
import { sttPrompt } from "../pipeline/stt.js";
import { enforceQuota, recordUsage } from "../usage/metering.js";
import {
  sanitizePlainTranscript, transcriptsAgree, isUsableAlternative, readsAsRomanHindi,
  detectScript, INDIC_SCRIPTS, leadsOnScript, scrubAndGate,
} from "../pipeline/stt.js";
import { LiveSpeechMeter } from "../pipeline/speechPresence.js";

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

/**
 * THE LIVE RECOGNIZER IS TOLD WHO IS TALKING, AS THE ONE-SHOT ONE ALWAYS WAS.
 *
 * The in-app mic's clip goes to Whisper with a run-up: a line in each
 * language on the person's Languages card, their dictionary, their own words
 * (stt.sttPrompt). The live socket sent none, so the keyboard's recognizer
 * met every sentence cold: "kem cho bhai" from a Gujarati speaker came back
 * "kemchobi", one word it had never heard of, where the in-app mic got it
 * right. Same run-up here — a hint, never a pinned language.
 *
 * Read while the session opens, and given up on quickly: the audio is held
 * meanwhile (see `early`), and a slow read must cost the hint, not the start.
 */
async function liveHint(user: AuthedUser): Promise<string | undefined> {
  const read = getPersonality(user).then((p) => sttPrompt(
    p.vocabulary,
    undefined,
    p.languages?.map(String),
    p.stylePortrait?.core,
    p.stylePortrait?.words,
  ));
  const late = new Promise<undefined>((r) => setTimeout(() => r(undefined), 800));
  return Promise.race([read, late]).catch(() => undefined);
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
/**
 * Audio held while a session is being verified, before the engine exists.
 * Ten seconds of 48 kHz mono; far more than a sign-in check ever takes.
 */
const EARLY_MAX_BYTES = 48_000 * 2 * 10;

/** Close the socket if no audio arrives for this long after `ready`. */
const IDLE_TIMEOUT_MS = 60_000;

/** Reject the whole session if `start` never arrives within this window. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * The audio format a client may declare, clamped. Every client sends 16 kHz
 * mono, and the value goes straight to the engine and into the metering sum
 * (bytes ÷ rate): a declared rate of a billion would meter a minute of speech
 * as nothing, and a nonsense one would have the engine decode noise.
 */
function audioFormat(start: StartMessage): { sampleRate: number; channels: number } {
  const clamp = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def;
  return { sampleRate: clamp(start.sampleRate, 8000, 48000, 16000), channels: clamp(start.channels, 1, 2, 1) };
}

/**
 * WHAT A STREAM ERROR SAYS, WRITTEN FOR THE PERSON WHO WAS TALKING.
 *
 * Clients show `message` as it stands: the app's toast, the desktop's
 * notification. It used to be a developer's note ("idle timeout", "stream
 * closed abnormally (1006)", the speech provider's own error text), and that
 * is what people read. So each one is a sentence that says what to do, and
 * the detail goes to the server log instead. `code` is unchanged; it is the
 * stable part a client branches on.
 *
 * The app tells these apart from its own native layer's text by their shape
 * (a full sentence, no colons, no jargon), so tests/stream-errors.test.ts
 * pins that shape for every entry.
 */
export const STREAM_ERROR_TEXT = {
  /** `start` never arrived. */
  noStart: "Voice couldn't start. Try again.",
  /** No audio for IDLE_TIMEOUT_MS after `ready`. */
  idle: "Stopped listening because nothing was heard. Tap the mic to start again.",
  /** No speech engine configured on this server. */
  unavailable: "Voice isn't available right now. Try again later.",
  /** The speech engine reported an error. */
  engineFailed: "Voice stopped working. Try again.",
  /** The speech engine's socket closed abnormally. */
  dropped: "The connection dropped while listening. Try again.",
  /** MAX_STREAM_BYTES reached (about 15 minutes of speech). */
  tooLong: "That recording reached the length limit. Start a new one to keep going.",
  /**
   * LEFT AS IT WAS, ON PURPOSE. Both keyboards (iOS and Android, every build
   * in the stores) detect an expired sign-in by finding "invalid or missing
   * token" or "unauthorized" in this text, and then tell the person to open
   * Tailzu and sign in again. They never show the text itself. Rewording it
   * would turn that prompt into a silent dead mic until a keyboard build that
   * reads `code` is the oldest one in use. The app and the desktop show
   * their own words for code "unauthorized" instead of this.
   */
  unauthorized: "invalid or missing token",
} as const;

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
      // WHOSE TEXT THE USER IS WATCHING. Both engines produce a live
      // transcript — the shadow is a full streaming engine, not a file job —
      // so keeping the user pinned to the primary for a whole utterance is a
      // choice, and for an Indic speaker it was the wrong one: they watched
      // Deepgram guess at Devanagari for the entire dictation and only got
      // Sarvam's reading after they stopped.
      //
      // So the lead is decided ONCE, mid-stream, on the first committed
      // segment that shows a native Indic script from one engine and not the
      // other. Once, and at a segment boundary, because that is what keeps
      // this from flickering: swapping per partial would make the text jitter
      // between two readings and switching back later would undo words the
      // user already watched land.
      let lead: "primary" | "shadow" = "primary";
      let leadLocked = false;
      // WHAT IS ALREADY AT THE CURSOR. Every client — both keyboards and the
      // desktop — APPENDS each final it is sent; none of them replaces. So a
      // final is only ever new words, never a correction of old ones, and
      // what was sent is tracked to keep it that way.
      const sentFinals: string[] = [];
      // How many of the primary's segments had reached the cursor when the
      // shadow took the lead. The shadow's own segments up to that count
      // cover the same audio in another reading; sending them typed the
      // sentence twice.
      let sentAtSwitch = 0;
      let closed = false;
      // One `start` per socket. A second one used to open a second engine over
      // the first, which was never closed: a paid provider session left
      // running, whose eventual close then ended the user's live one.
      let started = false;
      let user: AuthedUser | null = null;
      let bytes = 0;
      // THE FIRST WORDS ARRIVE BEFORE THE SESSION IS READY, AND WERE DROPPED.
      //
      // The clients send audio the moment the socket opens, right behind
      // `start` — the Android keyboard does not wait for "ready". Checking the
      // sign-in is a round trip to Supabase, and every frame that landed
      // during it was thrown away. That trip is slowest on the first dictation
      // after a pause, so the first dictation lost its opening words and the
      // same sentence said again a moment later came through whole: a
      // non-English sentence missing its start is easily heard as something
      // else, and the writer then repairs what was never said.
      //
      // So once a `start` has arrived, audio is held — bounded — until the
      // engine exists, then handed over in order. Before any `start` it is
      // still refused: nothing is kept for a socket that has not asked.
      const early: Buffer[] = [];
      let earlyBytes = 0;
      let format = { sampleRate: 16000, channels: 1 };
      let handshakeTimer: NodeJS.Timeout | null = setTimeout(() => {
        send({ type: "error", code: "bad_request", message: STREAM_ERROR_TEXT.noStart });
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
      // The voice in the audio this socket has received, frame by frame —
      // the live half of the no-speech gate (see judgeFinal).
      let meter: LiveSpeechMeter | null = null;
      // Where each engine's last committed segment ended, for an engine that
      // does not say where its segments lie.
      const lastEnd = { primary: 0, shadow: 0 };

      /**
       * NO SPEECH IN, NO TEXT OUT — ON THE LIVE STREAM TOO.
       *
       * Finals used to be trusted outright, on the theory that the engine's
       * own voice detection had already gated them. It gates on sound, not on
       * voice: a cough or a chair between two sentences committed as "Okay."
       * or "Thank you." and went straight to the cursor. Each final is now
       * judged against the voice measured in its own stretch of the stream —
       * Deepgram says where that is; for an engine that does not, it is
       * everything since that engine's last final, which can only find MORE
       * voice, never less. With no audio to measure (nothing received yet),
       * it is trusted as before.
       */
      const judgeFinal = (raw: string, who: "primary" | "shadow", timing?: SegmentTiming): string => {
        const to = timing ? timing.start + timing.duration : meter?.seconds ?? 0;
        // An untimed engine commits late: a short phrase spoken while its
        // previous final was still on the way sits BEFORE that final's end,
        // so the window reaches back two seconds. Wider only finds more voice.
        const from = timing ? timing.start : lastEnd[who] - 2;
        lastEnd[who] = Math.max(lastEnd[who], to);
        // Slack either side: an engine's segment edges are not frame-exact.
        const measure = meter?.measure(from - 0.25, to + 0.25) ?? null;
        if (!measure) return sanitizePlainTranscript(raw, { trustSpeech: true });
        const gate = scrubAndGate(raw, { measure });
        if (gate.dropped) {
          // The reason and the size, never the words.
          req.log.info({ engine: who, dropped: gate.dropped, voicedSeconds: measure.voicedSeconds }, "live final withheld");
        }
        return gate.text;
      };

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
        // linear16 → 2 bytes per sample per channel. Seconds of audio processed.
        const seconds = bytes / (format.sampleRate * 2 * format.channels);
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

      /**
       * Hand the lead to whichever engine understood the language.
       *
       * Called on every committed segment from either side. A native Indic
       * script is the signal, because it is the one thing that cannot be
       * faked: the generalist does not spontaneously emit Devanagari, so when
       * one engine does and the other does not, the one that did is the one
       * that recognised the speech rather than approximating it.
       *
       * Romanized Hinglish has no script to see, so leadsOnScript falls back
       * to the words themselves — the Hindi function words one engine writes
       * and the other approximates into English. Same evidence the stop-time
       * reconciliation uses, and the reason neither depends any more on which
       * engine an operator happened to name primary.
       */
      const considerLead = (mine: "primary" | "shadow", text: string) => {
        if (leadLocked) return;
        const theirs = (mine === "primary" ? shadowFinals : primaryFinals).join(" ");
        if (!leadsOnScript(text, theirs)) return;
        if (mine === "shadow") sentAtSwitch = sentFinals.length;
        lead = mine;
        leadLocked = true;
      };

      // Terminal "done" for a graceful/engine close: tell the client we're done
      // (unless we already errored) and close. safeClose does the metering.
      const finishDone = () => {
        if (doneSent) return;
        doneSent = true;
        if (doneFallback) { clearTimeout(doneFallback); doneFallback = null; }

        // RESCUE: the primary engine produced nothing — it errored, dropped, or
        // heard silence — but the shadow heard the user perfectly. Discarding
        // its transcript would lose a dictation we actually have, so promote it
        // to a real final and send it to the cursor. Runs even when `errored`
        // is set: real words beat an error message.
        //
        // Skipped when the shadow already HAS the lead, because then every one
        // of those segments has already been sent and re-sending the joined
        // transcript would type the whole sentence at the cursor a second time.
        const primaryDry = primaryFinals.join(" ").trim();
        const shadowDry = shadowFinals.join(" ").trim();
        if (!primaryDry && shadowDry && lead !== "shadow") {
          totalWords += countWords(shadowDry);
          send({ type: "final", text: shadowDry });
          sentFinals.push(shadowDry);
          errored = false;   // we recovered; don't report a failure to the user
        } else if (!primaryDry && shadowDry) {
          errored = false;   // the shadow carried the session; that is not a failure
        }

        if (!errored) {
          // Hand the client BOTH readings. The engines segment differently, so
          // they can't be merged blind — the refine step reconciles them the
          // same way the one-shot path does (see pipeline/stt.ts fusion). Only
          // send the alternative when it's a real disagreement; identical
          // readings carry no information. Older clients ignore the extra
          // field, so this stays wire-compatible.
          //
          // WHICH READING LEADS is decided by the TEXT, not by which engine
          // happened to be primary — the same rule the one-shot path uses.
          // It matters because the refine step is told candidate 1 is the more
          // reliable recognizer: hand it Deepgram's attempt at a Devanagari
          // sentence as candidate 1 and it will trust the wrong one. Whichever
          // engine came back in a native Indic script is the one that actually
          // understood the speech, so it leads and the other rides along.
          //
          // ROMANIZED HINGLISH HAS NO SCRIPT, and used to fall through to
          // whichever engine an operator had named primary — so for that one
          // case recognition quality depended on a guess about traffic, and a
          // guess is wrong for everybody on the other side of it.
          //
          // It is decided on evidence now too. Both engines heard the same
          // audio: the one that understood "yeh kaam nahi ho raha" wrote those
          // words, and the one that did not wrote English that sounds like
          // them. readsAsRomanHindi measures that difference, and demands a
          // clear margin — leading with the wrong engine is the expensive
          // mistake, because the refine is told candidate 1 is the more
          // reliable recognizer.
          //
          // Script still wins where there is one. It is the stronger signal,
          // and it cannot be faked by a name or a loanword.
          const primaryIndic = INDIC_SCRIPTS.has(detectScript(primaryDry));
          const shadowIndic = INDIC_SCRIPTS.has(detectScript(shadowDry));
          const flip = !!shadowDry && !primaryIndic &&
            (shadowIndic || readsAsRomanHindi(primaryDry, shadowDry));
          const better = flip ? shadowDry : primaryDry;
          const worse = flip ? primaryDry : shadowDry;
          // THE BETTER READING GOES IN `done`, NEVER AS ONE MORE FINAL.
          //
          // This used to "correct the cursor" by sending the shadow's whole
          // line as a final. No client corrects: each appends. So a Hinglish
          // dictation arrived as the primary's reading followed by the
          // shadow's, the refine step was handed the sentence twice, and the
          // field got raw words beside the written ones.
          //
          // The alternative is whichever reading differs from what the user
          // was actually sent, better one first. The refine step decides which
          // leads from the text itself (cleanup.assist), so candidate order
          // here does not have to be right for older clients to be right.
          const typed = sentFinals.join(" ").trim();
          const differs = (x: string) => !!x && !!typed && !transcriptsAgree(typed, x) && isUsableAlternative(typed, x);
          const alternative = differs(better) ? better : differs(worse) ? worse : "";
          send(alternative ? { type: "done", alternative } : { type: "done" });
        }
        safeClose();
      };

      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          send({ type: "error", code: "bad_request", message: STREAM_ERROR_TEXT.idle });
          safeClose();
        }, IDLE_TIMEOUT_MS);
      };

      const openEngine = (start: StartMessage, prompt?: string) => {
        if (!liveEngineConfigured()) {
          req.log.error("live dictation refused: no streaming speech engine is configured");
          send({ type: "error", code: "internal", message: STREAM_ERROR_TEXT.unavailable });
          safeClose();
          return;
        }
        format = audioFormat(start);
        meter = new LiveSpeechMeter(format.sampleRate, format.channels);

        // WHICH engine (Deepgram / Sarvam) is decided server-side in
        // live-engines.ts. Neither is pinned to a language — the backend
        // identifies the speech, so both open in multilingual/auto-detect
        // mode. The client's `language` field is ignored on purpose: it
        // carries a preference the user set once on the onboarding screen,
        // and honoring it locked the recognizer to that single language,
        // breaking code-switching.
        engine = openLiveEngine(
          prompt ? { ...format, prompt } : format,
          {
            onReady: () => {
              send({ type: "ready" });
              armIdle();
            },
            onPartial: (text) => {
              // Provisional — forward as-is for the live effect; the final
              // below is the sanitized commit point. Silent once the shadow
              // has taken the lead: two engines' partials at one cursor is
              // the flicker this design exists to avoid.
              if (lead === "primary") send({ type: "partial", text });
            },
            onFinal: (raw, timing) => {
              // Judge the finalized segment before it reaches the cursor:
              // boilerplate goes, and words the measured voice in its window
              // cannot account for go (judgeFinal). We ALWAYS send a final —
              // an empty one tells the client to clear whatever provisional
              // partial it was showing, so a noise partial can't get stranded
              // at the cursor. The meta guard belongs on LLM refine output,
              // not raw STT.
              const text = judgeFinal(raw, "primary", timing);
              // Sum words from finalized segments only (partials are supersets
              // that get replaced) so word-based quotas meter the real transcript.
              if (text) {
                totalWords += countWords(text);
                primaryFinals.push(text);
              }
              considerLead("primary", text);
              // Both readings are still kept for the stop-time reconciliation;
              // the lead only decides which one the user WATCHES.
              if (lead === "primary") {
                send({ type: "final", text });
                if (text) sentFinals.push(text);
              }
            },
            onError: (message) => {
              errored = true;
              // The provider's own words are for us, not for the person.
              req.log.warn({ engine: engine?.label, detail: message }, "live engine error");
              send({ type: "error", code: "stt_failed", message: STREAM_ERROR_TEXT.engineFailed });
            },
            onClose: (abnormalCode) => {
              // The engine closed. Normally this fires AFTER it flushes its
              // final tail segment(s) in response to close(), so routing
              // "done" through here (not a fixed timer) guarantees the last
              // words reach the client. An abnormal close must NOT be masked
              // as a successful "done".
              if (abnormalCode !== undefined && !errored) {
                errored = true;
                req.log.warn({ engine: engine?.label, closeCode: abnormalCode }, "live engine closed abnormally");
                send({ type: "error", code: "stt_failed", message: STREAM_ERROR_TEXT.dropped });
              }
              finishDone();
            },
          },
        );

        // Second listener (dual mode). Silent UNTIL it earns the lead by
        // returning a native Indic script the primary did not — from then on
        // its segments are the ones the user watches. Its failures stay inert
        // toward the session either way: a shadow that dies mid-stream costs
        // nothing but the lead going back to nobody.
        shadow = openShadowEngine(
          format,
          {
            onReady: () => { /* the user's session is already live */ },
            onPartial: (text) => {
              if (lead === "shadow") send({ type: "partial", text });
            },
            onFinal: (raw, timing) => {
              const text = judgeFinal(raw, "shadow", timing);
              if (text) shadowFinals.push(text);
              considerLead("shadow", text);
              // Words are metered off whatever the user actually receives, so
              // the count follows the lead rather than the primary engine.
              if (lead === "shadow") {
                // Audio the primary's segments already put at the cursor is
                // not typed again in the shadow's reading. An empty final
                // still goes, so the client drops the partial it was showing.
                const fresh = !!text && shadowFinals.length > sentAtSwitch;
                if (fresh) {
                  totalWords += countWords(text);
                  sentFinals.push(text);
                }
                send({ type: "final", text: fresh ? text : "" });
                // The refine step at stop reconciles the whole line from both
                // readings (see `done`), so nothing skipped here is lost.
              }
            },
            onError: () => { /* best-effort second opinion */ },
            onClose: () => { /* the primary owns session teardown */ },
          },
        );
      };

      /** One frame of audio, to the engines, once the session is live. */
      const acceptAudio = (raw: Buffer) => {
        if (closed || !engine) return;
        bytes += raw.length;
        if (bytes > MAX_STREAM_BYTES) {
          send({ type: "error", code: "audio_too_long", message: STREAM_ERROR_TEXT.tooLong });
          safeClose();
          return;
        }
        engine.send(raw);
        // The shadow hears the same audio; a failure there must never
        // disturb the stream the user is actually watching.
        try { shadow?.send(raw); } catch { /* shadow is best-effort */ }
        // Measured as it arrives, so a final can be judged the moment it
        // commits. push() never throws.
        meter?.push(raw);
        armIdle();
      };

      socket.on("message", async (raw: Buffer, isBinary: boolean) => {
        if (closed) return;

        if (isBinary) {
          // Never before a `start`: no engine is opened behind the caller's
          // back. Between `start` and the engine, held (see `early`).
          if (!started) return;
          if (!user || !engine) {
            if (earlyBytes + raw.length <= EARLY_MAX_BYTES) {
              early.push(raw);
              earlyBytes += raw.length;
            }
            return;
          }
          acceptAudio(raw);
          return;
        }

        // Text frames are JSON control messages.
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "start") {
          if (started) return;
          started = true; // before the first await, so a second start can't slip in
          try {
            // Extract JWT: prefer header, fall back to inline token.
            const headerAuth = req.headers["authorization"];
            const inlineAuth = typeof msg.token === "string" && msg.token
              ? `Bearer ${msg.token}` : undefined;
            user = await resolveUser(headerAuth ?? inlineAuth);
            if (!user) {
              send({ type: "error", code: "unauthorized", message: STREAM_ERROR_TEXT.unauthorized });
              safeClose();
              return;
            }
            // Pre-flight quota check — refuse before we bill Deepgram anything.
            const over = await enforceQuota(user);
            if (over) {
              // Already written for the person (metering.enforceQuota): the
              // number, the reset date and the way out.
              send({ type: "error", code: "quota_exceeded", message: over });
              safeClose();
              return;
            }
          } catch (err) {
            // A transient auth/database failure. This handler is async and
            // nothing awaits it, so an escape would be an unhandled rejection;
            // fail this socket only.
            req.log.error({ err }, "live dictation: could not verify the session");
            send({ type: "error", code: "internal", message: STREAM_ERROR_TEXT.unavailable });
            safeClose();
            return;
          }
          const hint = await liveHint(user);
          // The socket may have gone while auth was in flight.
          if (closed) return;
          if (handshakeTimer) { clearTimeout(handshakeTimer); handshakeTimer = null; }
          openEngine(msg as StartMessage, hint);
          // What was said while the sign-in was checked, in the order it was
          // said. The engines hold it until they are connected.
          const backlog = early.splice(0);
          earlyBytes = 0;
          if (engine && !closed) for (const b of backlog) acceptAudio(b);
          // Until the engine says ready, the idle window covers the wait: an
          // engine that never opens must not strand the socket.
          if (!closed) armIdle();
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
