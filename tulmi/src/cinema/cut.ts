/**
 * THE EDIT: how the takes become one film. Pure: it works out the timeline, the subtitles and ffmpeg's arguments; ffmpeg.ts runs them.
 *
 *   picture   every take scaled and padded to the film's frame, 24 frames a second; a plain cut between shots, a half-second dissolve where
 *             the shot list says so (a shot that continues the one before is a plain cut: it already starts on that shot's last frame); a
 *             short fade in at the start and out at the end
 *   sound     three layers, as a mixer would keep them: each take's own sound (its lines and ambience, or silence), the voice-over placed at
 *             the start of its shot, and the music looped to length and ducked under the voice (a sidechain compressor), the whole mix brought
 *             to -16 LUFS, the loudness phones and social apps play at.
 *
 *             MEASURED, NOT GUESSED. The mix is listened to once (`measureArgs`) and then normalised with what that heard
 *             (`linear=true`): one pass on its own is about half a loudness unit out, which is audible between one film and the next.
 *             The limiter after it runs at four times the sample rate, so it sees the peaks that appear between samples, and its
 *             look-ahead is compensated so the sound stays level with the picture. Even then AAC adds peaks of its own that no filter can
 *             see before encoding, so ffmpeg.ts listens to the FINISHED file and encodes the sound again, lower, if it is still too loud.
 *   words     the lines and the voice-over as subtitles, timed to their shots, each held long enough to be read and never two at once
 *             (readable, trimmed): a soft subtitle track in the film and an .srt beside it
 *
 * Output is H.264 and AAC in MP4 with the index at the front, which every phone and browser plays.
 */
import type { Aspect, Link } from "./types.js";

export const DISSOLVE = 0.5;
const FADE_IN = 0.4;
const FADE_OUT = 0.6;
/** The voice-over starts this long after its shot does, so it never clips the cut. */
const VO_LEAD = 0.15;

/**
 * HOW LONG A SUBTITLE MUST STAY UP TO BE READ. A line is held for the time it takes to read it plus a moment to notice it and look away:
 * characters divided by a rate for the script it is written in, plus READ_PAD, and never less than READ_MIN. The rates are the usual
 * reading speeds: an alphabet is read fastest, Devanagari a little slower (longer words, and the matras are read as one unit), and the
 * Han and kana scripts slowest per character because each character carries far more.
 */
const READ_PAD = 1.2;
const READ_MIN = 1.4;
const CPS = { latin: 15, indic: 11, cjk: 4.5 } as const;

/** How long this text needs on screen, in seconds. */
export function readSeconds(text: string): number {
  const s = text.replace(/\s+/g, " ").trim();
  let cjk = 0, indic = 0, other = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === " ") continue;
    // Han, hiragana, katakana, hangul: one character is a word's worth.
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff)) cjk++;
    // Devanagari, and the other Indian scripts beside it.
    else if (c >= 0x0900 && c <= 0x0dff) indic++;
    else other++;
  }
  const need = cjk / CPS.cjk + indic / CPS.indic + other / CPS.latin + READ_PAD;
  return Math.max(READ_MIN, Math.round(need * 100) / 100);
}

export interface CutShot {
  /** The take's file. */
  video: string;
  /** How long the take really is, in seconds (probed). */
  seconds: number;
  hasAudio: boolean;
  link: Link;
  vo: { file: string; text: string; seconds: number; words?: { word: string; start: number; end: number }[] } | null;
  lines: string[];
  /** Where the subject sits across the frame: -1 at the left, 0 in the middle, 1 at the right. Only used when the picture is cropped. */
  bias?: number;
}

/** What listening to the mix heard (ffmpeg's loudnorm, first pass). */
export interface Loudness { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }

export interface CutPlan {
  shots: CutShot[];
  music: string | null;
  aspect: Aspect;
  /** "1080" for the finished film, "720" for a quick one. */
  height: 720 | 1080;
  out: string;
  srt: string | null;
  /**
   * How a take that is not the film's shape is fitted. `pad` leaves bars, which is right for the film itself: nothing of the frame is lost.
   * `crop` fills the frame and loses the edges, which is right for another shape of the same film (a 9:16 of a 16:9): bars on a phone look
   * like a mistake. The crop follows the subject (CutShot.bias) rather than sitting in the middle.
   */
  fit?: "pad" | "crop";
  /** A styled subtitle file (ASS) drawn into the picture, for the places that play without sound. Soft subtitles are kept as well. */
  burn?: string | null;
}

export function frameOf(aspect: Aspect, height: 720 | 1080): { w: number; h: number } {
  if (aspect === "1:1") return { w: height, h: height };
  const long = height === 1080 ? 1920 : 1280;
  return aspect === "9:16" ? { w: height, h: long } : { w: long, h: height };
}

/** When each shot starts in the film, and how long the film is. A dissolve overlaps the two shots by DISSOLVE. */
export function timeline(shots: readonly Pick<CutShot, "seconds" | "link">[]): { starts: number[]; total: number } {
  const starts: number[] = [];
  let t = 0;
  shots.forEach((s, i) => {
    const overlap = i > 0 && s.link === "dissolve" ? Math.min(DISSOLVE, s.seconds / 2, shots[i - 1]!.seconds / 2) : 0;
    t -= overlap;
    starts.push(round(t));
    t += s.seconds;
  });
  return { starts, total: round(t) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

const stamp = (s: number): string => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

export interface Cue { from: number; to: number; text: string }

/**
 * The subtitles: the voice-over over its shot for as long as it is spoken, the lines spread across their shot, each held long enough to be
 * read (readSeconds) and then trimmed so that two are never on screen at once. Null when nothing is said.
 *
 * `words`, when the voice-over was measured word by word (voiceCheck.ts), times its subtitle to the speech instead of the clip's length.
 */
export function cuesOf(shots: readonly CutShot[]): Cue[] {
  const { starts } = timeline(shots);
  const cues: Cue[] = [];
  shots.forEach((s, i) => {
    const at = starts[i]!;
    if (s.vo) {
      const spoken = s.vo.words?.length ? s.vo.words[s.vo.words.length - 1]!.end : s.vo.seconds;
      cues.push({ from: at + VO_LEAD, to: at + VO_LEAD + Math.max(spoken, readSeconds(s.vo.text)), text: s.vo.text });
    }
    if (s.lines.length) {
      const each = s.seconds / s.lines.length;
      s.lines.forEach((l, k) => cues.push({ from: at + k * each, to: at + k * each + Math.max(each - 0.05, readSeconds(l)), text: l }));
    }
  });
  return trim(cues);
}

/**
 * In time order, with no two on screen at once: a cue that runs into the next one ends where that one starts. A cue left shorter than it
 * takes to read is kept as it is, held as long as there is room: the line is still better seen than dropped.
 */
export function trim(cues: readonly Cue[]): Cue[] {
  const out = [...cues].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 0; i < out.length - 1; i++) {
    const next = out[i + 1]!;
    if (out[i]!.to > next.from) out[i] = { ...out[i]!, to: Math.max(next.from - 0.04, out[i]!.from + 0.2) };
  }
  return out;
}

export function srtOf(shots: readonly CutShot[]): string | null {
  const cues = cuesOf(shots);
  if (!cues.length) return null;
  return cues.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${wrap(c.text)}\n`).join("\n");
}

/** Two lines at most, broken near the middle at a space. */
function wrap(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= 42) return t;
  const mid = Math.floor(t.length / 2);
  const left = t.lastIndexOf(" ", mid);
  const right = t.indexOf(" ", mid);
  const at = left < 0 ? right : right < 0 ? left : mid - left <= right - mid ? left : right;
  return at < 0 ? t : `${t.slice(0, at)}\n${t.slice(at + 1)}`;
}

/**
 * The picture into the frame. Padded: the whole frame, bars where it does not fill. Cropped: filled, the edges lost, the crop moved towards
 * the subject by at most CROP_LEAN of the room there is - never all the way to the edge, which would cut the subject in half.
 */
const CROP_LEAN = 0.6;

export function fitFilter(w: number, h: number, fit: "pad" | "crop", bias: number): string {
  if (fit === "pad") return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  const lean = Math.max(-1, Math.min(1, bias)) * CROP_LEAN;
  const x = `(iw-${w})/2${lean ? `${lean > 0 ? "+" : "-"}(iw-${w})/2*${Math.abs(lean).toFixed(2)}` : ""}`;
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:${x}:(ih-${h})/2`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// CAPTIONS DRAWN INTO THE PICTURE, for the feeds that play without sound. Not the same thing as subtitles: a few words at a time, big, in
// the middle of the lower third, timed to the speech where the recogniser gave us the words (voiceCheck.ts). A soft subtitle track is kept
// as well, so a player that offers subtitles still has them.

/** At most this many words and this many characters in one caption: what can be read at a glance. */
const CAP_WORDS = 3;
const CAP_CHARS = 16;

/** The caption's size and how far above the bottom it sits, as a share of the frame's height. */
const CAP_SIZE = 1 / 22;
const CAP_LIFT = 1 / 7;

const assTime = (s: number): string => {
  const cs = Math.max(0, Math.round(s * 100));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${Math.floor(cs / 360_000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};

/** ASS keeps one event on one line, and reads { } as an override. */
const assText = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/[{}]/g, "").replace(/\\/g, "\\\u200b");

/**
 * The captions, a few words at a time. A voice-over measured word by word is split on its own timings, so the words appear as they are
 * said; anything else (a spoken line, a voice-over we could not measure) is split evenly across the time its cue holds.
 */
export function capsOf(shots: readonly CutShot[]): Cue[] {
  const { starts } = timeline(shots);
  const out: Cue[] = [];
  shots.forEach((s, i) => {
    const at = starts[i]!;
    if (s.vo?.words?.length) out.push(...chunkWords(s.vo.words, at + VO_LEAD));
    else if (s.vo) out.push(...chunkEvenly(s.vo.text, at + VO_LEAD, Math.max(s.vo.seconds, readSeconds(s.vo.text))));
    if (s.lines.length) {
      const each = s.seconds / s.lines.length;
      s.lines.forEach((l, k) => out.push(...chunkEvenly(said(l), at + k * each, each)));
    }
  });
  return trim(out);
}

/** A caption carries the words, not who said them: a subtitle's "Ravi: Lo, garam chai" is read on screen as "Lo, garam chai". */
const said = (line: string): string => line.replace(/^[^:]{1,24}:\s+/, "");

/** Words into captions, each held from its first word to its last. */
function chunkWords(words: readonly { word: string; start: number; end: number }[], at: number): Cue[] {
  const out: Cue[] = [];
  let held: { word: string; start: number; end: number }[] = [];
  const flush = () => {
    if (!held.length) return;
    out.push({ from: at + held[0]!.start, to: at + held[held.length - 1]!.end + 0.08, text: held.map((w) => w.word).join(" ") });
    held = [];
  };
  for (const w of words) {
    const would = [...held, w].map((x) => x.word).join(" ");
    if (held.length >= CAP_WORDS || would.length > CAP_CHARS) flush();
    held.push(w);
  }
  flush();
  return out;
}

/** Text into captions over a stretch of time, each given its share of it by length. */
function chunkEvenly(text: string, at: number, seconds: number): Cue[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const groups: string[][] = [[]];
  for (const w of words) {
    const g = groups[groups.length - 1]!;
    if (g.length >= CAP_WORDS || [...g, w].join(" ").length > CAP_CHARS) groups.push([w]);
    else g.push(w);
  }
  const chars = groups.reduce((n, g) => n + g.join(" ").length, 0) || 1;
  const out: Cue[] = [];
  let t = at;
  for (const g of groups) {
    const share = (g.join(" ").length / chars) * seconds;
    out.push({ from: t, to: t + Math.max(0.3, share), text: g.join(" ") });
    t += share;
  }
  return out;
}

/**
 * The captions as an ASS file, sized to the frame: white, heavy, with a black outline that holds up over any picture, in the lower third
 * and clear of a phone's own buttons. The font is left to fontconfig ("Sans"), which is what lets a Devanagari or CJK line draw at all.
 */
export function assOf(shots: readonly CutShot[], w: number, h: number): string | null {
  const caps = capsOf(shots);
  if (!caps.length) return null;
  const size = Math.round(h * CAP_SIZE);
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Sans,${size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 9))},0,2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${Math.round(h * CAP_LIFT)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = caps.map((c) => `Dialogue: 0,${assTime(c.from)},${assTime(c.to)},Cap,,0,0,0,,${assText(c.text)}`);
  return `${[...head, ...events].join("\n")}\n`;
}

/** How loud the music sits under a voice. A film with narration keeps the music well under it; without one, the music carries the film. */
export const musicLevel = (hasVoice: boolean): number => (hasVoice ? 0.22 : 0.5);
/** The loudness every film is brought to, and the ceiling the limiter holds. */
export const TARGET_LUFS = -16;
const LIMIT_DB = -1.6;

/** What the mix must not pass in the finished file, measured after encoding. Above this, the sound is encoded again, lower. */
export const PEAK_CEILING = -1;

export interface CutOpts {
  /** What the first pass heard, so the second can be exact. Absent: one pass, which is about half a unit out. */
  measured?: Loudness;
  /** The limiter's ceiling in dB, lowered on each re-encode (ffmpeg.ts). */
  limit?: number;
  /** Build the arguments for listening to the mix only: no picture, no file written. */
  measureOnly?: boolean;
}

/**
 * ffmpeg's arguments for the whole cut. Inputs: the takes, then the voice-overs, then the music, then the subtitles.
 * With `measureOnly`, the same sound is built but nothing is written: ffmpeg prints what it heard and exits.
 */
export function cutArgs(p: CutPlan, o: CutOpts = {}): string[] {
  const { w, h } = frameOf(p.aspect, p.height);
  const { starts, total } = timeline(p.shots);
  const args: string[] = [];
  const f: string[] = [];
  p.shots.forEach((s) => args.push("-i", s.video));
  const voIdx: { input: number; start: number }[] = [];
  p.shots.forEach((s, i) => {
    if (!s.vo) return;
    voIdx.push({ input: args.filter((a) => a === "-i").length, start: starts[i]! + VO_LEAD });
    args.push("-i", s.vo.file);
  });
  let musicIdx = -1;
  if (p.music) {
    musicIdx = args.filter((a) => a === "-i").length;
    args.push("-stream_loop", "-1", "-i", p.music);
  }
  let srtIdx = -1;
  if (p.srt) {
    srtIdx = args.filter((a) => a === "-i").length;
    args.push("-i", p.srt);
  }

  p.shots.forEach((s, i) => {
    const d = s.seconds.toFixed(3);
    f.push(`[${i}:v]${fitFilter(w, h, p.fit ?? "pad", s.bias ?? 0)},setsar=1,fps=24,format=yuv420p,trim=0:${d},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`);
    f.push(s.hasAudio
      ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${d},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });

  let v = "v0";
  let a = "a0";
  let t = p.shots[0]?.seconds ?? 0;
  for (let i = 1; i < p.shots.length; i++) {
    const s = p.shots[i]!;
    if (s.link === "dissolve") {
      const d = Math.min(DISSOLVE, s.seconds / 2, p.shots[i - 1]!.seconds / 2);
      f.push(`[${v}][v${i}]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${(t - d).toFixed(3)},settb=AVTB[vj${i}]`);
      f.push(`[${a}][a${i}]acrossfade=d=${d.toFixed(3)}[aj${i}]`);
      t += s.seconds - d;
    } else {
      f.push(`[${v}][v${i}]concat=n=2:v=1:a=0,settb=AVTB[vj${i}]`);
      f.push(`[${a}][a${i}]concat=n=2:v=0:a=1[aj${i}]`);
      t += s.seconds;
    }
    v = `vj${i}`;
    a = `aj${i}`;
  }
  const T = total.toFixed(3);
  const drawn = p.burn ? `,ass=${p.burn}` : "";
  f.push(`[${v}]fade=t=in:st=0:d=${FADE_IN},fade=t=out:st=${Math.max(0, total - FADE_OUT).toFixed(3)}:d=${FADE_OUT}${drawn}[vout]`);

  const layers = [`[${a}]`];
  if (voIdx.length) {
    voIdx.forEach((x, k) => f.push(`[${x.input}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(x.start * 1000)}:all=1[vo${k}]`));
    f.push(`${voIdx.map((_, k) => `[vo${k}]`).join("")}amix=inputs=${voIdx.length}:normalize=0:duration=longest,apad=whole_dur=${T},atrim=0:${T},asplit=2[vomix][vokey]`);
    layers.push("[vomix]");
  }
  if (musicIdx >= 0) {
    f.push(`[${musicIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${T},asetpts=PTS-STARTPTS,volume=${musicLevel(voIdx.length > 0)},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[mus]`);
    if (voIdx.length) {
      f.push(`[mus][vokey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck]`);
      layers.push("[duck]");
    } else {
      layers.push("[mus]");
    }
  } else if (voIdx.length) {
    f.push(`[vokey]anullsink`);
  }
  const m = o.measured;
  const heard = m ? `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true` : "";
  const norm = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11${o.measureOnly ? ":print_format=json" : heard}`;
  // Four times the sample rate, so the limiter sees the peaks that fall between samples; latency=1 gives back its look-ahead, so the
  // sound stays level with the picture.
  const limit = `aresample=192000,alimiter=limit=${(o.limit ?? LIMIT_DB).toFixed(2)}dB:attack=10:release=200:level=disabled:latency=1,aresample=48000`;
  f.push(`${layers.join("")}amix=inputs=${layers.length}:normalize=0:duration=first,atrim=0:${T},${norm}${o.measureOnly ? "" : `,${limit}`}[aout]`);

  args.push("-filter_complex", f.join(";"));
  if (o.measureOnly) {
    args.push("-map", "[aout]", "-t", T, "-f", "null", "-");
    return args;
  }
  args.push("-map", "[vout]", "-map", "[aout]");
  if (srtIdx >= 0) args.push("-map", `${srtIdx}:s`, "-c:s", "mov_text", "-metadata:s:s:0", "language=und");
  args.push(
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "24",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-t", T, "-movflags", "+faststart", "-y", p.out,
  );
  return args;
}

/** What ffmpeg printed after listening to the mix, or null when it said nothing we can use. */
export function readLoudness(stderr: string): Loudness | null {
  const at = stderr.lastIndexOf("{");
  if (at < 0) return null;
  try {
    const got = JSON.parse(stderr.slice(at, stderr.lastIndexOf("}") + 1)) as Record<string, string>;
    const need = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"] as const;
    if (need.some((k) => typeof got[k] !== "string" || !Number.isFinite(Number(got[k])))) return null;
    return { input_i: got.input_i!, input_tp: got.input_tp!, input_lra: got.input_lra!, input_thresh: got.input_thresh!, target_offset: got.target_offset! };
  } catch {
    return null;
  }
}

/** The true peak ffmpeg measured in a finished file, in dB, or null when it reported none. */
export function readPeak(stderr: string): number | null {
  const all = [...stderr.matchAll(/Peak:\s*(-?[\d.]+|-inf)\s*dBFS/gi)].map((x) => (x[1] === "-inf" ? -99 : Number(x[1])));
  const ok = all.filter((n) => Number.isFinite(n));
  return ok.length ? Math.max(...ok) : null;
}
