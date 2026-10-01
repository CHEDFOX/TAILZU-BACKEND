/**
 * WHO SAID WHAT — keeping a meeting's voices apart.
 *
 * The desktop records two tracks and never mixes them: the microphone (the
 * person at the computer, and anyone in the room with them) and the computer's
 * own sound (everyone on the call). So "you" and "them" are told apart by
 * where the sound came from, which no model can get wrong.
 *
 * While it records, each stretch is labelled by its track: "You" or "Others".
 * When it stops, each track is sent once, whole, to Deepgram with diarization
 * on, so a speaker keeps one label for the whole meeting rather than one per
 * stretch. Those labels replace the live ones.
 *
 * Echo: on laptop speakers the microphone hears the call too, and the same
 * sentence arrives twice, once from each track. The microphone's copy is the
 * one dropped — the computer's sound is the clean recording of it.
 */
import type { AudioFormat, NoteSegment } from "../../../shared/types/api.js";
import { getConfig } from "../config.js";

export type Track = "mic" | "system";

/** One speaker's turn, from the diarization pass. Seconds from the track's start. */
export interface Utterance {
  speaker: number;
  start: number;
  end: number;
  text: string;
}

const words = (s: string): string[] =>
  s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);

/** How much of the shorter text the longer one also says, 0..1. */
export function overlap(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const pool = new Map<string, number>();
  for (const w of big) pool.set(w, (pool.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of small) {
    const c = pool.get(w) ?? 0;
    if (c > 0) { hit++; pool.set(w, c - 1); }
  }
  return hit / small.length;
}

/** The same words, heard twice: once from the call, once through the room. */
export const ECHO_OVERLAP = 0.6;

/**
 * Add a live stretch to the transcript, unless it is the echo of one already
 * there. `windowSec` is how far apart two stretches can start and still be
 * the same sentence (about one stretch's length).
 *
 * A microphone stretch that repeats the computer's is dropped. A computer
 * stretch that arrives after the microphone's copy replaces it.
 */
export function appendHeard(
  transcript: NoteSegment[],
  seg: NoteSegment & { track: Track },
  windowSec: number,
): { transcript: NoteSegment[]; kept: boolean } {
  const { track, ...plain } = seg;
  const label = track === "mic" ? "You" : "Others";
  const other = track === "mic" ? "Others" : "You";
  const near = (s: NoteSegment) => s.speaker === other && Math.abs(s.at - seg.at) <= windowSec
    && overlap(s.text, seg.text) >= ECHO_OVERLAP;
  if (track === "mic" && transcript.some(near)) return { transcript, kept: false };
  const kept = track === "system" ? transcript.filter((s) => !near(s)) : transcript.slice();
  kept.push({ ...plain, speaker: label });
  kept.sort((a, b) => a.at - b.at);
  return { transcript: kept, kept: true };
}

/** A speaker with less than this share of a track's talk is diarization
 *  noise (a cough, a crosstalk word) and is folded into the track's main one. */
const MINOR_SHARE = 0.08;

function shares(us: Utterance[]): Map<number, number> {
  const t = new Map<number, number>();
  let all = 0;
  for (const u of us) {
    const d = Math.max(0.1, u.end - u.start);
    t.set(u.speaker, (t.get(u.speaker) ?? 0) + d);
    all += d;
  }
  for (const [k, v] of t) t.set(k, all ? v / all : 0);
  return t;
}

/**
 * The final transcript, from the two diarized tracks.
 *
 * Labels: on a call (the computer's sound has speech), the microphone's main
 * voice is "You". Everyone else — another voice in the room, each voice on the
 * call — is "Speaker 1", "Speaker 2"… in the order they first spoke. With no
 * call, nobody can be assumed to be the person at the computer, so a single
 * voice is "You" and several are all "Speaker n".
 *
 * `micAt` / `systemAt`: when each track started, in seconds from the note's
 * start. Consecutive turns by one speaker are joined.
 */
export function labelSpeakers(
  mic: Utterance[] | null,
  system: Utterance[] | null,
  micAt = 0,
  systemAt = 0,
): NoteSegment[] {
  const sys = (system ?? []).filter((u) => u.text.trim());
  let mc = (mic ?? []).filter((u) => u.text.trim());
  // Echo first, on the tracks' own clocks brought to the note's.
  mc = mc.filter((m) => !sys.some((s) =>
    (m.start + micAt) < (s.end + systemAt) + 2 && (s.start + systemAt) < (m.end + micAt) + 2
    && overlap(m.text, s.text) >= ECHO_OVERLAP));

  const fold = (us: Utterance[]): Utterance[] => {
    const sh = shares(us);
    const main = [...sh.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return us.map((u) => ((sh.get(u.speaker) ?? 0) < MINOR_SHARE && main != null ? { ...u, speaker: main } : u));
  };
  mc = fold(mc);
  const sy = fold(sys);

  const onCall = sy.length > 0;
  const micMain = [...shares(mc).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const micVoices = new Set(mc.map((u) => u.speaker)).size;

  type Turn = { at: number; text: string; key: string };
  const turns: Turn[] = [
    ...mc.map((u) => ({ at: u.start + micAt, text: u.text.trim(), key: `m${u.speaker}` })),
    ...sy.map((u) => ({ at: u.start + systemAt, text: u.text.trim(), key: `s${u.speaker}` })),
  ].sort((a, b) => a.at - b.at);

  const names = new Map<string, string>();
  if (micMain != null && (onCall || micVoices === 1)) names.set(`m${micMain}`, "You");
  let next = 1;
  for (const t of turns) if (!names.has(t.key)) names.set(t.key, `Speaker ${next++}`);

  const out: NoteSegment[] = [];
  for (const t of turns) {
    const speaker = names.get(t.key)!;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text = `${last.text} ${t.text}`;
    else out.push({ at: Math.round(t.at * 10) / 10, text: t.text, speaker });
  }
  return out;
}

/**
 * One track, whole, with each speaker's turns: Deepgram first, and OpenAI's
 * diarizing model when Deepgram is not configured or fails (an expired key).
 * Null when neither can — the live labels stand then, which is a worse note
 * but never a lost one.
 */
export async function diarize(audio: Buffer, format: AudioFormat): Promise<Utterance[] | null> {
  if (audio.length < 1024) return null;
  return (await diarizeDeepgram(audio, format)) ?? (await diarizeOpenAI(audio, format));
}

/** OpenAI's diarizing transcription. Its speakers are letters ("A", "B"),
 *  numbered here in the order they first speak. Files over 25 MB are refused
 *  by OpenAI, which reads as null. */
export async function diarizeOpenAI(audio: Buffer, format: AudioFormat): Promise<Utterance[] | null> {
  const cfg = getConfig();
  if (!cfg.OPENAI_API_KEY || !cfg.NOTES_DIARIZE_OPENAI_MODEL) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: `audio/${format}` }), `track.${format}`);
    form.append("model", cfg.NOTES_DIARIZE_OPENAI_MODEL);
    form.append("response_format", "diarized_json");
    form.append("chunking_strategy", "auto");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { segments?: Array<{ speaker?: string; start?: number; end?: number; text?: string }> };
    const ids = new Map<string, number>();
    return (json.segments ?? [])
      .map((s) => {
        const who = String(s.speaker ?? "A");
        if (!ids.has(who)) ids.set(who, ids.size);
        return { speaker: ids.get(who)!, start: s.start ?? 0, end: s.end ?? s.start ?? 0, text: (s.text ?? "").trim() };
      })
      .filter((u) => u.text);
  } catch {
    return null;
  }
}

async function diarizeDeepgram(audio: Buffer, format: AudioFormat): Promise<Utterance[] | null> {
  const cfg = getConfig();
  if (!cfg.DEEPGRAM_API_KEY) return null;
  const params = new URLSearchParams({
    model: cfg.NOTES_DIARIZE_MODEL,
    language: cfg.DEEPGRAM_LANGUAGE || "multi",
    diarize: "true",
    utterances: "true",
    smart_format: "true",
    punctuate: "true",
  });
  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${cfg.DEEPGRAM_API_KEY}`, "Content-Type": `audio/${format}` },
      body: new Uint8Array(audio),
      // A long meeting is a long file; Deepgram reads an hour in well under a minute.
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: { utterances?: Array<{ speaker?: number; start?: number; end?: number; transcript?: string }> };
    };
    return (json.results?.utterances ?? [])
      .map((u) => ({ speaker: u.speaker ?? 0, start: u.start ?? 0, end: u.end ?? u.start ?? 0, text: (u.transcript ?? "").trim() }))
      .filter((u) => u.text);
  } catch {
    return null;
  }
}
