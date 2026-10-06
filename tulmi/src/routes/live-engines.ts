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
 *   • OpenAI   — the realtime API in transcription mode, on the same key as
 *                the one-shot path (gpt-4o-mini-transcribe by default).
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
  /** A committed segment. Empty string is meaningful: it clears a stale partial.
   *  `timing` is where in the stream the segment lies (seconds), when the
   *  engine says — the route measures the voice in exactly that window. */
  onFinal(text: string, timing?: SegmentTiming): void;
  onError(message: string): void;
  /** Engine closed. `abnormalCode` is set only when the close was NOT clean. */
  onClose(abnormalCode?: number): void;
}

export interface EngineOptions {
  sampleRate: number;
  channels: number;
  /**
   * What the recognizer is told before it listens: a line in each language
   * this person speaks, and their own words (stt.sttPrompt — the same run-up
   * the one-shot path gives Whisper). Never a pinned language. Used by the
   * OpenAI engine; the others take no such hint.
   */
  prompt?: string;
}

/** A committed segment's place in the audio stream, in seconds. */
export interface SegmentTiming {
  start: number;
  duration: number;
}

type LiveName = "deepgram" | "sarvam" | "openai";

/** Which live engine the server is configured to use. */
export function liveProvider(): LiveName {
  const cfg = getConfig();
  if (cfg.STT_LIVE_PROVIDER === "sarvam" && cfg.SARVAM_API_KEY) return "sarvam";
  if (cfg.STT_LIVE_PROVIDER === "openai" && cfg.OPENAI_API_KEY) return "openai";
  return "deepgram";
}

function keyFor(name: LiveName): boolean {
  const cfg = getConfig();
  return name === "sarvam" ? !!cfg.SARVAM_API_KEY : name === "openai" ? !!cfg.OPENAI_API_KEY : !!cfg.DEEPGRAM_API_KEY;
}

function open(name: LiveName, opts: EngineOptions, h: EngineHandlers): LiveEngine {
  return name === "sarvam" ? openSarvam(opts, h) : name === "openai" ? openOpenAI(opts, h) : openDeepgram(opts, h);
}

/** True when the configured engine actually has credentials to run. */
export function liveEngineConfigured(): boolean {
  return keyFor(liveProvider());
}

export function openLiveEngine(opts: EngineOptions, h: EngineHandlers): LiveEngine {
  return open(liveProvider(), opts, h);
}

/**
 * The OTHER engine — opened alongside the primary as a silent second listener.
 *
 * Live audio can't be fused the way a finished file can: partials stream in
 * continuously from both engines with different segment boundaries, so
 * reconciling them mid-flight would either add lag (wait for both) or make the
 * text flicker (swap between them). Instead the primary streams to the user
 * exactly as before, the shadow's transcript accumulates silently, and the two
 * are reconciled ONCE at stop — which is also where the refine step already
 * runs. Same fusion the one-shot path uses, just applied at the end of the
 * stream instead of to a file.
 *
 * Returns null when dual mode is off or the second engine has no credentials.
 */
export function openShadowEngine(opts: EngineOptions, h: EngineHandlers): LiveEngine | null {
  const cfg = getConfig();
  if (!cfg.STT_LIVE_DUAL) return null;
  // Sarvam listens beside Deepgram or OpenAI; beside Sarvam, Deepgram.
  const other: LiveName = liveProvider() === "sarvam" ? "deepgram" : "sarvam";
  if (!keyFor(other)) return null;
  try {
    return open(other, opts, h);
  } catch {
    // A shadow that won't open must never take the session down — the user
    // still gets the primary engine's live dictation.
    return null;
  }
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
    // Deepgram says where the segment sits in the stream; the route measures
    // the voice in that window before the words reach the cursor.
    const timing = typeof data.start === "number" && typeof data.duration === "number"
      ? { start: data.start, duration: data.duration } : undefined;
    if (data.is_final) h.onFinal(raw, timing);
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
  // AUDIO BEFORE THE SOCKET IS OPEN IS HELD, NOT DROPPED. It is the first
  // words of the sentence, and this engine is the one that reads Indian
  // languages: dropping them is how a first dictation came back wrong and the
  // same sentence said again came back right. Deepgram's client and the
  // OpenAI engine already hold theirs. Bounded at ten seconds.
  const held: Buffer[] = [];
  let heldBytes = 0;
  const HOLD_MAX = opts.sampleRate * 2 * Math.max(1, opts.channels) * 10;
  let stopAsked = false;
  const sendAudio = (chunk: Buffer) => {
    try {
      ws.send(JSON.stringify({ event: "audio", audio: { data: chunk.toString("base64") } }));
    } catch { /* engine window closed */ }
  };
  const stop = () => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "stop" }));
    } catch { /* ignore */ }
    // Give the engine a beat to flush its tail before tearing the socket
    // down, then close regardless so a silent engine can't strand the route.
    setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 300);
  };

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
    for (const b of held.splice(0)) sendAudio(b);
    heldBytes = 0;
    h.onReady();
    // Stopped before it ever connected: what was held has gone, now finish.
    if (stopAsked) stop();
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
      if (!ready) {
        if (heldBytes + chunk.length <= HOLD_MAX) { held.push(Buffer.from(chunk)); heldBytes += chunk.length; }
        return;
      }
      if (ws.readyState === WebSocket.OPEN) sendAudio(chunk);
    },
    close() {
      if (ready) { stop(); return; }
      // Not connected yet: send what is held when it opens, then stop. One
      // that never opens is closed anyway, so it cannot strand the route.
      stopAsked = true;
      setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 5000);
    },
  };
}

// --- OpenAI -----------------------------------------------------------------

/** OpenAI's realtime API takes 16-bit mono PCM at 24 kHz, and nothing else
 *  that is lossless. */
export const OPENAI_RATE = 24_000;

/**
 * 16-bit PCM at any rate and channel count, to mono at another rate, a chunk
 * at a time. Linear interpolation, carried across chunks so a frame boundary
 * makes no click: the last sample and the read position survive the call.
 */
export function createResampler(inRate: number, outRate: number, channels: number): (chunk: Buffer) => Buffer {
  const step = inRate / outRate;
  const frameBytes = 2 * Math.max(1, channels);
  let pos = 0;
  let prev: number | null = null;
  let carry: Buffer = Buffer.alloc(0);
  return (chunk: Buffer): Buffer => {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const frames = Math.floor(buf.length / frameBytes);
    carry = Buffer.from(buf.subarray(frames * frameBytes));
    if (!frames) return Buffer.alloc(0);
    const head = prev === null ? 0 : 1;
    const x = new Float32Array(frames + head);
    if (prev !== null) x[0] = prev;
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += buf.readInt16LE(f * frameBytes + c * 2);
      x[f + head] = sum / Math.max(1, channels);
    }
    if (inRate === outRate) {
      prev = null;
      const same = Buffer.alloc(frames * 2);
      for (let f = 0; f < frames; f++) same.writeInt16LE(Math.round(x[f + head]!), f * 2);
      return same;
    }
    const out: number[] = [];
    // Every point before the last sample: what lies past it needs the next chunk.
    while (pos < x.length - 1) {
      const i = Math.floor(pos), t = pos - i;
      out.push(x[i]! + (x[i + 1]! - x[i]!) * t);
      pos += step;
    }
    prev = x[x.length - 1]!;
    pos -= x.length - 1;
    const o = Buffer.alloc(out.length * 2);
    out.forEach((v, k) => o.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), k * 2));
    return o;
  };
}

/**
 * OpenAI realtime transcription.
 *
 * A transcription session over the realtime WebSocket: audio goes up as
 * base64 PCM (`input_audio_buffer.append`), the server's own voice-activity
 * detection cuts it into turns, and each turn comes back as deltas and then a
 * completed transcript. Turns can complete out of order, so they are released
 * in the order they were committed. No language is pinned: the model hears it.
 *
 * Audio arriving before the session is configured is held (a few seconds at
 * most) rather than dropped: the first words are usually in it.
 */
export function openOpenAI(opts: EngineOptions, h: EngineHandlers, socket?: (url: string, headers: Record<string, string>) => WebSocket): LiveEngine {
  const cfg = getConfig();
  const model = cfg.OPENAI_LIVE_STT_MODEL;
  const beta = cfg.OPENAI_REALTIME_PROTOCOL === "beta";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.OPENAI_API_KEY ?? ""}`,
    ...(beta ? { "OpenAI-Beta": "realtime=v1" } : {}),
  };
  const ws = socket ? socket(cfg.OPENAI_REALTIME_URL, headers) : new WebSocket(cfg.OPENAI_REALTIME_URL, { headers });
  const resample = createResampler(opts.sampleRate, OPENAI_RATE, opts.channels);

  let ready = false;
  let closing = false;
  let closed = false;
  let sentSinceCommit = false;
  const held: Buffer[] = [];
  let heldBytes = 0;
  const HOLD_MAX = OPENAI_RATE * 2 * 5;    // five seconds of 24 kHz audio

  /** Turns, in the order the server committed them. */
  const order: string[] = [];
  const text = new Map<string, string>();     // deltas so far, per turn
  const done = new Map<string, string>();     // completed transcripts
  const span = new Map<string, { start?: number; end?: number }>();

  const put = (pcm: Buffer) => {
    if (!pcm.length || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.toString("base64") }));
      sentSinceCommit = true;
    } catch { /* engine window closed */ }
  };

  const partial = () => {
    const p = order.filter((id) => !done.has(id)).map((id) => text.get(id) ?? "").join(" ").replace(/\s+/g, " ").trim();
    if (p) h.onPartial(p);
  };

  /** Release completed turns from the front of the queue, in order. */
  const release = () => {
    while (order.length && done.has(order[0]!)) {
      const id = order.shift()!;
      const t = done.get(id)!;
      done.delete(id); text.delete(id);
      const s = span.get(id); span.delete(id);
      const timing = s && typeof s.start === "number" && typeof s.end === "number" && s.end > s.start
        ? { start: s.start / 1000, duration: (s.end - s.start) / 1000 } : undefined;
      h.onFinal(t.trim(), timing);
    }
    partial();
    if (closing && !order.length) shut();
  };

  const shut = () => {
    if (closed) return;
    closed = true;
    try { ws.close(1000); } catch { /* already gone */ }
  };

  const vad = { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 };
  ws.on("open", () => {
    try {
      ws.send(JSON.stringify(beta
        ? {
            type: "transcription_session.update",
            session: {
              input_audio_format: "pcm16",
              input_audio_transcription: { model, ...(opts.prompt ? { prompt: opts.prompt } : {}) },
              input_audio_noise_reduction: { type: "near_field" },
              turn_detection: vad,
            },
          }
        : {
            type: "session.update",
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: OPENAI_RATE },
                  noise_reduction: { type: "near_field" },
                  transcription: { model, ...(opts.prompt ? { prompt: opts.prompt } : {}) },
                  turn_detection: vad,
                },
              },
            },
          }));
    } catch { /* the close handler reports it */ }
  });

  ws.on("message", (raw: Buffer) => {
    let m: any;
    try { m = JSON.parse(raw.toString("utf8")); } catch { return; }
    switch (m?.type) {
      case "session.updated":
      case "transcription_session.updated":
        if (ready) return;
        ready = true;
        h.onReady();
        for (const b of held.splice(0)) put(b);
        heldBytes = 0;
        return;
      case "input_audio_buffer.speech_started":
        if (m.item_id) span.set(m.item_id, { ...span.get(m.item_id), start: m.audio_start_ms });
        return;
      case "input_audio_buffer.speech_stopped":
        if (m.item_id) span.set(m.item_id, { ...span.get(m.item_id), end: m.audio_end_ms });
        return;
      case "input_audio_buffer.committed":
        sentSinceCommit = false;
        if (m.item_id && !order.includes(m.item_id)) order.push(m.item_id);
        return;
      case "conversation.item.input_audio_transcription.delta":
        if (!m.item_id) return;
        if (!order.includes(m.item_id)) order.push(m.item_id);
        text.set(m.item_id, (text.get(m.item_id) ?? "") + String(m.delta ?? ""));
        partial();
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (!m.item_id) return;
        if (!order.includes(m.item_id)) order.push(m.item_id);
        done.set(m.item_id, String(m.transcript ?? ""));
        release();
        return;
      case "conversation.item.input_audio_transcription.failed":
        // One turn the model could not transcribe: it leaves nothing, and the
        // turns after it still arrive.
        if (!m.item_id) return;
        done.set(m.item_id, "");
        release();
        return;
      case "error": {
        const code = String(m.error?.code ?? "");
        // Committing an empty buffer at the end is not a failure.
        if (code === "input_audio_buffer_commit_empty") { if (closing && !order.length) shut(); return; }
        h.onError(String(m.error?.message ?? "openai realtime error"));
        return;
      }
      default:
        return;
    }
  });

  ws.on("error", (e: Error) => h.onError(e.message));
  ws.on("close", (code: number) => {
    closed = true;
    h.onClose(code !== 1000 && code !== 1005 ? code : undefined);
  });

  return {
    label: `openai:${model}`,
    send(chunk) {
      const pcm = resample(chunk);
      if (ready) { put(pcm); return; }
      if (heldBytes + pcm.length > HOLD_MAX) return;
      held.push(pcm);
      heldBytes += pcm.length;
    },
    close() {
      if (closing) return;
      closing = true;
      // The words after the last pause are still in the buffer: commit them,
      // then close once every turn has come back, or after a deadline so a
      // silent engine cannot strand the route.
      if (ready && sentSinceCommit && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch { /* closing anyway */ }
      } else if (!order.length) {
        shut();
        return;
      }
      setTimeout(shut, getConfig().OPENAI_LIVE_FLUSH_MS);
    },
  };
}
