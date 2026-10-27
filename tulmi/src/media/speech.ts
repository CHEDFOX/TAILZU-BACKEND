/**
 * SOUND TO TEXT: DEEPGRAM'S PRE-RECORDED API, THE ONE THE PIPELINE ALREADY USES (pipeline/stt.ts, notes/speakers.ts).
 *
 * The same key (DEEPGRAM_API_KEY), model (DEEPGRAM_STT_MODEL) and language rule (DEEPGRAM_LANGUAGE: empty means detect the language, which
 * is what Hindi and Hinglish need) as the dictation path, but for a whole file rather than a clip: paragraphs and timestamps are asked for,
 * and the transcript is kept as `[m:ss] what was said`, one line a paragraph, so a question about "the part around three minutes in" can
 * find it. The audio is sent as it is (Deepgram reads mp3, wav, flac, ogg, m4a and webm); a video's sound track arrives here already cut out
 * by the worker. Nothing is stored at Deepgram's end by us.
 */
import { getConfig } from "../config.js";
import { MediaError } from "./types.js";

export interface Transcript {
  text: string;
  seconds: number;
  language?: string;
}

export interface Transcriber {
  transcribe(audio: Buffer, mime: string, o?: { signal?: AbortSignal }): Promise<Transcript>;
}

export interface DeepgramConfig {
  apiKey: string;
  model: string;
  /** Empty: detect the language. */
  language: string;
  fetchFn?: typeof fetch;
}

interface DgParagraph { start?: number; sentences?: Array<{ text?: string; start?: number }> }
interface DgResponse {
  metadata?: { duration?: number };
  results?: { channels?: Array<{ detected_language?: string; alternatives?: Array<{ transcript?: string; paragraphs?: { paragraphs?: DgParagraph[] } }> }> };
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export class DeepgramTranscriber implements Transcriber {
  constructor(private readonly c: DeepgramConfig) {}

  async transcribe(audio: Buffer, mime: string, o: { signal?: AbortSignal } = {}): Promise<Transcript> {
    const params = new URLSearchParams({ smart_format: "true", punctuate: "true", paragraphs: "true", numerals: "true" });
    if (this.c.model) params.set("model", this.c.model);
    if (this.c.language) params.set("language", this.c.language);
    else params.set("detect_language", "true");
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
    let res: Response;
    try {
      res = await (this.c.fetchFn ?? fetch)(`https://api.deepgram.com/v1/listen?${params}`, {
        method: "POST", headers: { Authorization: `Token ${this.c.apiKey}`, "Content-Type": mime }, body: new Uint8Array(audio), signal,
      });
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError" && o.signal?.aborted) throw err;
      throw new MediaError("failed", "I could not reach the speech service just now. Try again in a moment.", 503);
    }
    if (!res.ok) {
      await res.text().catch(() => "");
      throw new MediaError("failed", res.status === 401 || res.status === 403 ? "The speech service did not accept this server's key." : "The speech service could not read that recording.", 502);
    }
    const json = (await res.json().catch(() => ({}))) as DgResponse;
    const channel = json.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    const paragraphs = alt?.paragraphs?.paragraphs ?? [];
    const lines = paragraphs
      .map((p) => {
        const said = (p.sentences ?? []).map((s) => (s.text ?? "").trim()).filter(Boolean).join(" ");
        return said ? `[${clock(p.start ?? p.sentences?.[0]?.start ?? 0)}] ${said}` : "";
      })
      .filter(Boolean);
    const text = (lines.length ? lines.join("\n\n") : (alt?.transcript ?? "")).trim();
    return { text, seconds: json.metadata?.duration ?? 0, ...(channel?.detected_language ? { language: channel.detected_language } : {}) };
  }
}

/** Deepgram as the dictation path is configured, or null when there is no key. */
export function transcriberFromConfig(fetchFn?: typeof fetch): Transcriber | null {
  const c = getConfig();
  if (!c.DEEPGRAM_API_KEY) return null;
  return new DeepgramTranscriber({ apiKey: c.DEEPGRAM_API_KEY, model: c.DEEPGRAM_STT_MODEL, language: c.DEEPGRAM_LANGUAGE, ...(fetchFn ? { fetchFn } : {}) });
}
