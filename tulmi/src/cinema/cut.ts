/**
 * THE EDIT: how the takes become one film. Pure: it works out the timeline, the subtitles and ffmpeg's arguments; ffmpeg.ts runs them.
 *
 *   picture   every take scaled and padded to the film's frame, 24 frames a second; a plain cut between shots, a half-second dissolve where
 *             the shot list says so (a shot that continues the one before is a plain cut: it already starts on that shot's last frame); a
 *             short fade in at the start and out at the end
 *   sound     three layers, as a mixer would keep them: each take's own sound (its lines and ambience, or silence), the voice-over placed at
 *             the start of its shot, and the music looped to length and ducked under the voice (a sidechain compressor), the whole mix brought
 *             to -16 LUFS, the loudness phones and social apps play at
 *   words     the lines and the voice-over as subtitles, timed to their shots: a soft subtitle track in the film and an .srt beside it
 *
 * Output is H.264 and AAC in MP4 with the index at the front, which every phone and browser plays.
 */
import type { Aspect, Link } from "./types.js";

export const DISSOLVE = 0.5;
const FADE_IN = 0.4;
const FADE_OUT = 0.6;
/** The voice-over starts this long after its shot does, so it never clips the cut. */
const VO_LEAD = 0.15;

export interface CutShot {
  /** The take's file. */
  video: string;
  /** How long the take really is, in seconds (probed). */
  seconds: number;
  hasAudio: boolean;
  link: Link;
  vo: { file: string; text: string; seconds: number } | null;
  lines: string[];
}

export interface CutPlan {
  shots: CutShot[];
  music: string | null;
  aspect: Aspect;
  /** "1080" for the finished film, "720" for a quick one. */
  height: 720 | 1080;
  out: string;
  srt: string | null;
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

/** The subtitles: the voice-over over its shot for as long as it is spoken, the lines spread across their shot. Null when nothing is said. */
export function srtOf(shots: readonly CutShot[]): string | null {
  const { starts } = timeline(shots);
  const cues: { from: number; to: number; text: string }[] = [];
  shots.forEach((s, i) => {
    const at = starts[i]!;
    if (s.vo) cues.push({ from: at + VO_LEAD, to: at + VO_LEAD + Math.min(s.vo.seconds, s.seconds + 2), text: s.vo.text });
    if (s.lines.length) {
      const each = s.seconds / s.lines.length;
      s.lines.forEach((l, k) => cues.push({ from: at + k * each, to: at + (k + 1) * each - 0.05, text: l }));
    }
  });
  if (!cues.length) return null;
  cues.sort((a, b) => a.from - b.from);
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

/** ffmpeg's arguments for the whole cut. Inputs: the takes, then the voice-overs, then the music, then the subtitles. */
export function cutArgs(p: CutPlan): string[] {
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
    f.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,trim=0:${d},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`);
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
  f.push(`[${v}]fade=t=in:st=0:d=${FADE_IN},fade=t=out:st=${Math.max(0, total - FADE_OUT).toFixed(3)}:d=${FADE_OUT}[vout]`);

  const layers = [`[${a}]`];
  if (voIdx.length) {
    voIdx.forEach((x, k) => f.push(`[${x.input}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${Math.round(x.start * 1000)}:all=1[vo${k}]`));
    f.push(`${voIdx.map((_, k) => `[vo${k}]`).join("")}amix=inputs=${voIdx.length}:normalize=0:duration=longest,apad=whole_dur=${T},atrim=0:${T},asplit=2[vomix][vokey]`);
    layers.push("[vomix]");
  }
  if (musicIdx >= 0) {
    f.push(`[${musicIdx}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${T},asetpts=PTS-STARTPTS,volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[mus]`);
    if (voIdx.length) {
      f.push(`[mus][vokey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck]`);
      layers.push("[duck]");
    } else {
      layers.push("[mus]");
    }
  } else if (voIdx.length) {
    f.push(`[vokey]anullsink`);
  }
  f.push(`${layers.join("")}amix=inputs=${layers.length}:normalize=0:duration=first,atrim=0:${T},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

  args.push("-filter_complex", f.join(";"), "-map", "[vout]", "-map", "[aout]");
  if (srtIdx >= 0) args.push("-map", `${srtIdx}:s`, "-c:s", "mov_text", "-metadata:s:s:0", "language=und");
  args.push(
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "24",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-t", T, "-movflags", "+faststart", "-y", p.out,
  );
  return args;
}
