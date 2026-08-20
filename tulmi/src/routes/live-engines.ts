/**
 * Live-dictation speech engines behind one interface.
 *
 * The phone's wire protocol (/v1/transcribe-stream) never changes: it sends
 * PCM frames and receives ready/partial/final/done/error. WHICH engine is
 * behind that socket is a SERVER decision — so switching Deepgram ⇄ Sarvam is
 * a config change on the VPS, never an app update. That's the whole point of
 * this file.
 *
 *   • Deepgram — strong English/European, mature streaming, VAD endpointing.
 *   • Sarvam   — purpose-built for Indian languages and code-mixed speech,
 *                which is where Deepgram is weakest.
 *
 * Neither is pinned to a language: the backend identifies the speech (the
 * product rule), so both are opened in their multilingual/auto-detect mode.
 */
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import WebSocket from "ws";
import { getConfig } from "../config.js";

/** What the route needs from any engine. */
export interface LiveEngine {
  /** Forward one PCM frame. Must never throw — a closed engine window is normal. */
  send(chunk: Buffer): void;
  /** Ask the engine to flush and close. Its close callback ends the session. */
  close(): void;
  /** Identifier recorded on the usage row (e.g. "deepgram:nova-2"). */
  readonly label: string;
}

export interface EngineHandlers {
  onReady(): void;
  /** Provisional text — replaced by the next partial or final. */
  onPartial(text: string): void;
  /** A committed segment. Empty string is meaningful: it clears a stale partial. */
  onFinal(text: string): void;
  onError(message: string): void;
  /** Engine closed. `abnormalCode` is set only when the close was NOT clean. */
  onClose(abnormalCode?: number): void;
}

export interface EngineOptions {
  sampleRate: number;
  channels: number;
}

/** Which live engine the server is configured to use. */
export function liveProvider(): "deepgram" | "sarvam" {
  const cfg = getConfig();
  if (cfg.STT_LIVE_PROVIDER === "sarvam" && cfg.SARVAM_API_KEY) return "sarvam";
  return "deepgram";
}

/** True when the configured engine actually has credentials to run. */
export function liveEngineConfigured(): boolean {
  const cfg = getConfig();
  return liveProvider() === "sarvam" ? !!cfg.SARVAM_API_KEY : !!cfg.DEEPGRAM_API_KEY;
}

export function openLiveEngine(opts: EngineOptions, h: EngineHandlers): LiveEngine {
  return liveProvider() === "sarvam" ? openSarvam(opts, h) : openDeepgram(opts, h);
}

// --- Deepgram ---------------------------------------------------------------

function openDeepgram(opts: EngineOptions, h: EngineHandlers): LiveEngine {
  const cfg = getConfig();
  const model = cfg.DEEPGRAM_STT_MODEL || "nova-2";
  const dg = createClient(cfg.DEEPGRAM_API_KEY!).listen.live({
    model,
    // NEVER pinned from user input — "multi" is Deepgram's multilingual +
    // code-switching mode. DEEPGRAM_LANGUAGE is a server-side debug override.
    language: cfg.DEEPGRAM_LANGUAGE || "multi",
    encoding: "linear16",
    sample_rate: opts.sampleRate,
    channels: opts.channels,
    interim_results: true,
    smart_format: true,
    punctuate: true,
    numerals: true,
    // Let Deepgram's own VAD do endpointing so we cut on natural pauses and
    // don't hold a final open waiting for silence a noisy room never delivers.
    endpointing: 300,
    utterance_end_ms: 1000,
    vad_events: true,
  });

  dg.on(LiveTranscriptionEvents.Open, () => h.onReady());
  dg.on(LiveTranscriptionEvents.Transcript, (data: any) => {
    const raw = data?.channel?.alternatives?.[0]?.transcript ?? "";
    if (!raw) return;
    if (data.is_final) h.onFinal(raw);
    else h.onPartial(raw);
  });
  dg.on(LiveTranscriptionEvents.Error, (e: any) => h.onError(String(e?.message ?? e)));
  dg.on(LiveTranscriptionEvents.Close, (event: any) => {
    const code = typeof event?.code === "number" ? event.code
      : typeof event?.target?.code === "number" ? event.target.code : undefined;
    // 1000 = normal, 1005 = no status (also normal in practice).
    h.onClose(code !== undefined && code !== 1000 && code !== 1005 ? code : undefined);
  });

  return {
    label: `deepgram:${model}`,
    send(chunk) {
      // Deepgram's typings want an ArrayBuffer-family value; a Node Buffer is
      // a Uint8Array view, so hand over its exact byte range.
      try {
        dg.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
      } catch { /* engine window closed */ }
    },
    close() {
      try {
        const anyDg = dg as any;
        if (typeof anyDg.requestClose === "function") anyDg.requestClose();
        else if (typeof anyDg.finish === "function") anyDg.finish();
      } catch { /* ignore */ }
    },
  };
}

// --- Sarvam -----------------------------------------------------------------

/**
 * Sarvam streaming STT over its WebSocket API.
 *
 * WIRE FORMAT: Sarvam's streaming contract has moved as the product has
 * evolved, so the frame shapes are kept in ONE place here and are
 * env-overridable (SARVAM_WS_URL). Verify against their current docs before
 * flipping STT_LIVE_PROVIDER=sarvam in production; the route falls back to
 * Deepgram when Sarvam isn't configured, and an engine error surfaces to the
 * client rather than hanging the socket.
 *
 * Audio is sent as base64 PCM in a JSON envelope (their documented shape);
 * transcripts arrive as JSON with a text field and a final/partial marker. We
 * read several plausible field names so a minor rename in their API doesn't
 * silently produce an empty transcript.
 */
function openSarvam(opts: EngineOptions, h: EngineHandlers): LiveEngine {
  const cfg = getConfig();
  const model = cfg.SARVAM_STT_MODEL;
  const url = `${cfg.SARVAM_WS_URL}?model=${encodeURIComponent(model)}&language-code=unknown`;
  const ws = new WebSocket(url, { headers: { "api-subscription-key": cfg.SARVAM_API_KEY! } });

  let ready = false;

  ws.on("open", () => {
    // Announce the audio format. Sarvam infers most of it, but sending the
    // rate explicitly avoids a resample mismatch with the phone's capture.
    try {
      ws.send(JSON.stringify({
        event: "start",
        audio_format: { encoding: "audio/wav", sample_rate: opts.sampleRate, channels: opts.channels },
      }));
    } catch { /* the message handler will surface a real failure */ }
    ready = true;
    h.onReady();
  });

  ws.on("message", (raw: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }
    if (msg?.type === "error" || msg?.error) {
      h.onError(String(msg?.error?.message ?? msg?.message ?? "sarvam stream error"));
      return;
    }
    // Tolerate field-name drift across API versions.
    const text: string =
      msg?.data?.transcript ?? msg?.transcript ?? msg?.text ?? msg?.data?.text ?? "";
    if (typeof text !== "string" || !text) return;
    const isFinal =
      msg?.is_final === true || msg?.final === true ||
      msg?.type === "final" || msg?.event === "final" || msg?.data?.is_final === true;
    if (isFinal) h.onFinal(text);
    else h.onPartial(text);
  });

  ws.on("error", (e: Error) => h.onError(e.message));
  ws.on("close", (code: number) => {
    h.onClose(code !== 1000 && code !== 1005 ? code : undefined);
  });

  return {
    label: `sarvam:${model}`,
    send(chunk) {
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({
          event: "audio",
          audio: { data: chunk.toString("base64") },
        }));
      } catch { /* engine window closed */ }
    },
    close() {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "stop" }));
      } catch { /* ignore */ }
      // Give the engine a beat to flush its tail before tearing the socket
      // down, then close regardless so a silent engine can't strand the route.
      setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 300);
    },
  };
}
