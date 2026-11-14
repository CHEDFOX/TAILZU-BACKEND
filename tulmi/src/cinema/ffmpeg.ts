/**
 * FFMPEG FOR THE CINEMA BOT, run on the server (its image has ffmpeg; pipeline/tts.ts uses it the same way). Four jobs:
 *
 *   probe(bytes)          what a clip or a sound is: its container, length, size, whether it has sound
 *   frames(bytes, n)      n frames spread across a take for the eye (qc.ts), and its very last frame (the next shot's first, when it continues)
 *   seconds(bytes)        how long a voice-over runs
 *   cut(plan, files)      the whole film (cut.ts cutArgs), to MP4: the mix listened to, then cut, then the finished file listened to again
 *                         and its sound encoded once more, lower, while it still peaks too high (AAC adds peaks no filter saw)
 *
 * The clips come from the video providers, not from people, but they are still read carefully: only real media containers (checked with
 * ffprobe first), `-protocol_whitelist file` so a container cannot make ffmpeg open another address, `-nostdin`, a time limit, and every
 * file in a folder of the job's own that is removed afterwards.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cutArgs, PEAK_CEILING, readLoudness, readPeak, srtOf, type CutPlan, type CutShot } from "./cut.js";

const FORMATS_OK = new Set(["mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm", "mp3", "wav", "ogg", "aac", "flac", "image2", "png_pipe", "jpeg_pipe", "webp_pipe"]);
const COMMON = ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file"];

export class CutError extends Error {
  readonly status = 502;
  readonly code = "cut_failed";
  constructor(message: string) {
    super(message);
    this.name = "CutError";
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => { if (err.length < 8000) err += d.toString("utf8"); });
    child.on("error", (e) => { clearTimeout(timer); reject(new CutError(e.message.includes("ENOENT") ? `${cmd} is not installed on this server.` : `${cmd} could not start.`)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err }); });
  });
}

async function inFolder<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cinema-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface Probe { format: string; seconds: number; width: number; height: number; hasAudio: boolean }

async function probeFile(path: string): Promise<Probe> {
  const r = await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_format", "-show_streams", path], 30_000);
  if (r.code !== 0) throw new CutError("That clip could not be read.");
  let info: { format?: { format_name?: string; duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[] };
  try {
    info = JSON.parse(r.stdout.toString("utf8") || "{}");
  } catch {
    throw new CutError("That clip could not be read.");
  }
  const names = String(info.format?.format_name ?? "").split(",");
  if (!names.some((n) => FORMATS_OK.has(n))) throw new CutError("That is not a clip we read.");
  const video = info.streams?.find((s) => s.codec_type === "video");
  const seconds = Number(info.format?.duration ?? video?.duration ?? 0) || 0;
  return { format: names[0] ?? "", seconds, width: video?.width ?? 0, height: video?.height ?? 0, hasAudio: !!info.streams?.some((s) => s.codec_type === "audio") };
}

export async function probe(bytes: Buffer, ext = "mp4"): Promise<Probe> {
  return inFolder(async (dir) => {
    const p = join(dir, `in.${ext}`);
    await writeFile(p, bytes);
    return probeFile(p);
  });
}

/** How long a sound runs, in seconds. */
export async function seconds(bytes: Buffer, ext = "mp3"): Promise<number> {
  return (await probe(bytes, ext)).seconds;
}

/** How wide one frame is on the contact sheet, and how many across. */
const SHEET_TILE = 512;
const SHEET_COLS = 3;

/**
 * Several frames as one picture, in time order, left to right and top to bottom. The checker is shown this instead of a frame at a time:
 * one picture instead of five, and it can see the whole movement at once, which is what catches a shot that morphs or runs backwards.
 * Null when the frames cannot be tiled, and then the caller sends them as they are.
 */
export async function contactSheet(shots: readonly Buffer[]): Promise<Buffer | null> {
  if (shots.length < 2) return null;
  return inFolder(async (dir) => {
    for (const [i, b] of shots.entries()) await writeFile(join(dir, `f${String(i).padStart(2, "0")}.jpg`), b);
    const cols = Math.min(SHEET_COLS, shots.length);
    const rows = Math.ceil(shots.length / cols);
    const out = join(dir, "sheet.jpg");
    const r = await run("ffmpeg", [...COMMON, "-i", join(dir, "f%02d.jpg"),
      "-vf", `scale=${SHEET_TILE}:-2,tile=${cols}x${rows}:margin=6:padding=4:color=#14161a`, "-frames:v", "1", "-q:v", "4", "-y", out], 60_000);
    if (r.code !== 0) return null;
    return readFile(out).catch(() => null);
  });
}

/** `n` frames spread across a take (JPEG, 768 wide at most) and its last frame (PNG, full size). */
export async function frames(bytes: Buffer, n: number): Promise<{ frames: Buffer[]; last: Buffer; seconds: number }> {
  return inFolder(async (dir) => {
    const src = join(dir, "take.mp4");
    await writeFile(src, bytes);
    const info = await probeFile(src);
    const d = Math.max(0.5, info.seconds);
    const shots: Buffer[] = [];
    for (let i = 0; i < n; i++) {
      const at = ((i + 0.5) * d) / n;
      const out = join(dir, `f${i}.jpg`);
      const r = await run("ffmpeg", [...COMMON, "-ss", at.toFixed(3), "-i", src, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "4", "-y", out], 60_000);
      if (r.code === 0) shots.push(await readFile(out).catch(() => Buffer.alloc(0)));
    }
    const lastOut = join(dir, "last.png");
    const r = await run("ffmpeg", [...COMMON, "-sseof", "-0.3", "-i", src, "-update", "1", "-frames:v", "100", "-y", lastOut], 60_000);
    if (r.code !== 0) throw new CutError("The take's last frame could not be read.");
    return { frames: shots.filter((b) => b.length > 0), last: await readFile(lastOut), seconds: info.seconds };
  });
}

export interface CutInput {
  shots: (Omit<CutShot, "video" | "seconds" | "hasAudio" | "vo"> & {
    video: Buffer;
    vo: { audio: Buffer; text: string; seconds: number; words?: { word: string; start: number; end: number }[] } | null;
  })[];
  music: Buffer | null;
  aspect: CutPlan["aspect"];
  height: CutPlan["height"];
}

/** Cuts the film. Returns the MP4 and the subtitles (or null when nothing is said). */
export async function cut(input: CutInput): Promise<{ video: Buffer; srt: string | null; seconds: number; blanks?: number[] }> {
  return inFolder(async (dir) => {
    const shots: CutShot[] = [];
    for (let i = 0; i < input.shots.length; i++) {
      const s = input.shots[i]!;
      const video = join(dir, `s${i}.mp4`);
      await writeFile(video, s.video);
      const info = await probeFile(video);
      let vo: CutShot["vo"] = null;
      if (s.vo) {
        const file = join(dir, `vo${i}.mp3`);
        await writeFile(file, s.vo.audio);
        vo = { file, text: s.vo.text, seconds: s.vo.seconds, ...(s.vo.words?.length ? { words: s.vo.words } : {}) };
      }
      shots.push({ video, seconds: Math.max(0.5, info.seconds), hasAudio: info.hasAudio, link: s.link, vo, lines: s.lines });
    }
    let music: string | null = null;
    if (input.music) {
      music = join(dir, "music.mp3");
      await writeFile(music, input.music);
      await probeFile(music);
    }
    const srt = srtOf(shots);
    const srtFile = srt ? join(dir, "words.srt") : null;
    if (srtFile && srt) await writeFile(srtFile, srt, "utf8");
    const out = join(dir, "film.mp4");
    const plan: CutPlan = { shots, music, aspect: input.aspect, height: input.height, out, srt: srtFile };

    // 1. Listen to the mix, so the normalising is exact rather than half a unit out. A measure that fails is not fatal: the cut goes
    //    ahead with a single pass, which is what it did before.
    const heard = await run("ffmpeg", [...COMMON.filter((x) => x !== "error"), "-loglevel", "info", ...cutArgs(plan, { measureOnly: true })], 5 * 60_000);
    const measured = heard.code === 0 ? readLoudness(heard.stderr) : null;

    // 2. The film.
    const r = await run("ffmpeg", [...COMMON, ...cutArgs(plan, measured ? { measured } : {})], 15 * 60_000);
    if (r.code !== 0) throw new CutError("The film could not be cut.");

    // 3. AAC adds peaks that no filter saw before encoding. Listen to the finished file; while it is still too loud, encode the sound
    //    again (the picture copied, which is quick) with the limiter lower by as much as it was over.
    let limit = -1.6;
    for (let round = 0; round < 3; round++) {
      const peak = readPeak((await run("ffmpeg", [...COMMON, "-i", out, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"], 3 * 60_000)).stderr);
      if (peak === null || peak <= PEAK_CEILING) break;
      limit -= peak + 1.3;
      const lower = join(dir, `film-${round}.mp4`);
      const again = await run("ffmpeg", [...COMMON, "-i", out, "-map", "0", "-c", "copy", "-c:a", "aac", "-b:a", "160k",
        "-af", `aresample=192000,alimiter=limit=${limit.toFixed(2)}dB:attack=10:release=200:level=disabled:latency=1,aresample=48000`,
        "-movflags", "+faststart", "-y", lower], 5 * 60_000);
      if (again.code !== 0) break;
      await rename(lower, out);
    }

    // 4. A blank stretch in the middle of the film: a take that came back black, or a dissolve that went through nothing. The checker
    //    looks at each take on its own and cannot see this by construction. The opening and closing fades are expected.
    const black = await run("ffmpeg", [...COMMON.filter((x) => x !== "error"), "-loglevel", "info", "-i", out, "-vf", "blackdetect=d=0.25:pix_th=0.10", "-f", "null", "-"], 3 * 60_000);
    const info = await probeFile(out);
    const blanks = blackSpans(black.stderr, info.seconds);

    const video = await readFile(out);
    return { video, srt, seconds: info.seconds, ...(blanks.length ? { blanks } : {}) };
  });
}

/**
 * Where the finished film goes blank, in seconds, leaving out the fades it is supposed to have at either end. ffmpeg prints a line a
 * span: "black_start:3.5 black_end:4.2 black_duration:0.7".
 */
export function blackSpans(stderr: string, total: number, fadeIn = 0.6, fadeOut = 0.9): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (to <= fadeIn || from >= total - fadeOut) continue;   // the fades at either end
    out.push(Math.round(from * 100) / 100);
  }
  return out;
}

