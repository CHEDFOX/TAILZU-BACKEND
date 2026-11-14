/**
 * THE CINEMA BOT'S EDIT (src/cinema/cut.ts, src/cinema/ffmpeg.ts):
 *
 *   - the timeline: plain cuts add up, a dissolve overlaps two shots by half a second
 *   - the subtitles: the voice-over over its shot, the lines spread across theirs
 *   - the frame for each aspect ratio
 *   - and, where ffmpeg is installed, a real cut: three clips (one silent, one dissolve), a voice-over and music, to one MP4 of the right
 *     length and frame, with a subtitle track; and frames and the last frame read from a take
 */
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cuesOf, cutArgs, frameOf, musicLevel, PEAK_CEILING, readLoudness, readPeak, readSeconds, srtOf, timeline, trim, type CutShot } from "../src/cinema/cut.js";
import { blackSpans, contactSheet, cut, frames, probe, seconds } from "../src/cinema/ffmpeg.js";

const shot = (over: Partial<CutShot> = {}): CutShot => ({ video: "a.mp4", seconds: 4, hasAudio: true, link: "cut", vo: null, lines: [], ...over });

describe("the timeline and the words", () => {
  it("adds plain cuts and overlaps a dissolve", () => {
    expect(timeline([shot(), shot({ seconds: 5 }), shot({ seconds: 3, link: "dissolve" })])).toEqual({ starts: [0, 4, 8.5], total: 11.5 });
  });

  it("holds a line long enough to read, by the script it is written in", () => {
    // Spaces are not read: 5 characters at 15 a second, plus the pause to notice it.
    expect(readSeconds("Chai?")).toBeCloseTo(5 / 15 + 1.2, 2);
    // A line too short to need its own reading time falls back to the floor.
    expect(readSeconds("Ji")).toBe(1.4);
    // 27 letters and a full stop.
    expect(readSeconds("Har baarish ki ek kahani hoti hai.")).toBeCloseTo(28 / 15 + 1.2, 2);
    // The same sentence in Devanagari is fewer characters but read more slowly, so it stays up about as long.
    expect(readSeconds("हर बारिश की एक कहानी होती है।")).toBeGreaterThan(readSeconds("Har baarish"));
    // Chinese: each character carries a word, so the rate is far lower.
    expect(readSeconds("每场雨都有自己的故事")).toBeCloseTo(10 / 4.5 + 1.2, 2);
  });

  it("never puts two subtitles on screen at once", () => {
    const cues = trim([
      { from: 0, to: 6, text: "a voice-over that runs long" },
      { from: 2, to: 4, text: "a line in the next shot" },
    ]);
    expect(cues[0]!.to).toBeCloseTo(1.96, 2);
    expect(cues[0]!.to).toBeLessThanOrEqual(cues[1]!.from);
  });

  it("keeps a squeezed cue rather than dropping it", () => {
    const cues = trim([{ from: 0, to: 5, text: "squeezed" }, { from: 0.1, to: 2, text: "next" }]);
    expect(cues[0]!.to).toBeGreaterThan(cues[0]!.from);
    expect(cues).toHaveLength(2);
  });

  it("times a voice-over to the speech when it was measured word by word", () => {
    const words = [{ word: "Har", start: 0, end: 0.4 }, { word: "baarish", start: 0.4, end: 1.1 }];
    const [cue] = cuesOf([shot({ seconds: 9, vo: { file: "v.mp3", text: "Har baarish", seconds: 8, words } })]);
    // The clip is 8 s long but the words end at 1.1 s: the subtitle is held for the reading time, not the clip.
    expect(cue!.to).toBeCloseTo(0.15 + readSeconds("Har baarish"), 2);
  });

  it("times the voice-over and the lines to their shots", () => {
    const srt = srtOf([shot({ vo: { file: "v.mp3", text: "Har baarish ki ek kahani hoti hai.", seconds: 2.5 } }), shot({ lines: ["Chai?", "Haan, ek."] })])!;
    // The voice-over runs 2.5 s but needs about 3.1 s to be read, and is held that long: it still ends before the next shot's first line.
    expect(srt).toContain("00:00:00,150 --> 00:00:03,220\nHar baarish ki ek kahani hoti hai.");
    expect(srt).toContain("00:00:04,000 --> 00:00:05,950\nChai?");
    expect(srt).toContain("00:00:06,000 --> 00:00:07,950\nHaan, ek.");
    expect(srtOf([shot()])).toBeNull();
  });

  it("frames each aspect ratio", () => {
    expect(frameOf("16:9", 1080)).toEqual({ w: 1920, h: 1080 });
    expect(frameOf("9:16", 1080)).toEqual({ w: 1080, h: 1920 });
    expect(frameOf("1:1", 720)).toEqual({ w: 720, h: 720 });
  });

  it("ducks the music under the voice-over and brings the mix to -16 LUFS", () => {
    const args = cutArgs({ shots: [shot({ vo: { file: "v.mp3", text: "x", seconds: 2 } })], music: "m.mp3", aspect: "16:9", height: 1080, out: "o.mp4", srt: null }).join(" ");
    expect(args).toContain("sidechaincompress");
    expect(args).toContain("loudnorm=I=-16");
    expect(args).toContain("-stream_loop -1 -i m.mp3");
    // Four times the sample rate, so the limiter sees the peaks between samples, with its look-ahead given back.
    expect(args).toContain("aresample=192000,alimiter=");
    expect(args).toContain("latency=1");
  });

  it("lets the music carry a film with no narration, and keeps it well under one that has it", () => {
    expect(musicLevel(false)).toBeGreaterThan(musicLevel(true));
    const withVoice = cutArgs({ shots: [shot({ vo: { file: "v.mp3", text: "x", seconds: 2 } })], music: "m.mp3", aspect: "16:9", height: 1080, out: "o.mp4", srt: null }).join(" ");
    const without = cutArgs({ shots: [shot()], music: "m.mp3", aspect: "16:9", height: 1080, out: "o.mp4", srt: null }).join(" ");
    expect(withVoice).toContain(`volume=${musicLevel(true)}`);
    expect(without).toContain(`volume=${musicLevel(false)}`);
  });

  it("listens to the mix first, then normalises with what it heard", () => {
    const plan = { shots: [shot()], music: null, aspect: "16:9" as const, height: 1080 as const, out: "o.mp4", srt: null };
    const listen = cutArgs(plan, { measureOnly: true }).join(" ");
    expect(listen).toContain("print_format=json");
    expect(listen).toContain("-f null -");
    expect(listen).not.toContain("libx264");
    const measured = { input_i: "-19.4", input_tp: "-2.1", input_lra: "7.2", input_thresh: "-29.6", target_offset: "0.3" };
    const second = cutArgs(plan, { measured }).join(" ");
    expect(second).toContain("measured_I=-19.4");
    expect(second).toContain("linear=true");
    expect(second).toContain("libx264");
  });

  it("reads what ffmpeg heard, and refuses what it cannot use", () => {
    const json = 'something\n{\n"input_i" : "-19.40",\n"input_tp" : "-2.10",\n"input_lra" : "7.20",\n"input_thresh" : "-29.60",\n"target_offset" : "0.30"\n}\n';
    expect(readLoudness(json)).toMatchObject({ input_i: "-19.40", target_offset: "0.30" });
    expect(readLoudness("no json here")).toBeNull();
    expect(readLoudness('{"input_i":"-inf","input_tp":"0","input_lra":"0","input_thresh":"0","target_offset":"0"}')).toBeNull();
  });

  it("reads the loudest peak of a finished file, and silence as no peak at all", () => {
    expect(readPeak("Peak: -0.4 dBFS\nPeak: -3.2 dBFS")).toBe(-0.4);
    expect(readPeak("Peak: -inf dBFS")).toBe(-99);
    expect(readPeak("nothing")).toBeNull();
  });
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** A test clip made by ffmpeg itself: a test pattern, with or without a tone. */
function clip(secs: number, audio: boolean, size = "640x360"): Buffer {
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=24:duration=${secs}`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac", "-shortest"] : []), "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1");
  const r = spawnSync("ffmpeg", args, { maxBuffer: 50 * 1024 * 1024 });
  return r.stdout;
}

function tone(secs: number, freq: number): Buffer {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${secs}`, "-c:a", "libmp3lame", "-f", "mp3", "pipe:1"], { maxBuffer: 10 * 1024 * 1024 });
  return r.stdout;
}

describe("where the film goes blank", () => {
  it("reads the spans ffmpeg found, and leaves out the fades at either end", () => {
    const said = [
      "[blackdetect @ 0x1] black_start:0 black_end:0.45 black_duration:0.45",
      "[blackdetect @ 0x1] black_start:3.5 black_end:4.2 black_duration:0.7",
      "[blackdetect @ 0x1] black_start:19.4 black_end:20 black_duration:0.6",
    ].join("\n");
    expect(blackSpans(said, 20)).toEqual([3.5]);
    expect(blackSpans("nothing", 20)).toEqual([]);
  });
});

describe.skipIf(!hasFfmpeg)("with ffmpeg", () => {
  it("tiles a take's frames into one picture for the checker", async () => {
    const { frames: shots } = await frames(clip(3, false), 5);
    const sheet = (await contactSheet(shots))!;
    expect(sheet.length).toBeGreaterThan(0);
    const info = await probe(sheet, "jpg");
    // Three across and two down, at 512 a tile.
    expect(info.width).toBeGreaterThan(1500);
    expect(info.height).toBeGreaterThan(500);
    expect(await contactSheet(shots.slice(0, 1))).toBeNull();
  }, 120_000);

  it("reads frames and the last frame from a take", async () => {
    const out = await frames(clip(3, false), 4);
    expect(out.frames).toHaveLength(4);
    expect(out.last.subarray(1, 4).toString()).toBe("PNG");
    expect(out.seconds).toBeGreaterThan(2.5);
  }, 60_000);

  it("measures a voice-over", async () => {
    expect(await seconds(tone(2, 300))).toBeCloseTo(2, 0);
  }, 30_000);

  it("cuts three takes, a voice-over and music into one film with subtitles", async () => {
    const out = await cut({
      shots: [
        { video: clip(3, true), link: "cut", lines: [], vo: { audio: tone(2, 300), text: "Har baarish ki ek kahani hoti hai.", seconds: 2 } },
        { video: clip(2, false, "480x480"), link: "cut", lines: ["Chai?"], vo: null },
        { video: clip(3, true), link: "dissolve", lines: [], vo: null },
      ],
      music: tone(4, 220),
      aspect: "16:9",
      height: 720,
    });
    const info = await probe(out.video);
    expect(info.width).toBe(1280);
    expect(info.height).toBe(720);
    expect(info.hasAudio).toBe(true);
    expect(info.seconds).toBeGreaterThan(7.2);
    expect(info.seconds).toBeLessThan(7.8);
    expect(out.srt).toContain("Chai?");
  }, 180_000);

  it("leaves the finished film under the peak ceiling, which one normalising pass does not", async () => {
    const out = await cut({
      // A loud take and a loud voice together: a single pass clips this, the loop brings it down.
      shots: [{ video: clip(3, true), link: "cut", lines: [], vo: { audio: tone(3, 440), text: "Loud", seconds: 3 } }],
      music: tone(3, 220),
      aspect: "16:9",
      height: 720,
    });
    const file = join(tmpdir(), `peak-${process.pid}.mp4`);
    writeFileSync(file, out.video);
    try {
      const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
      const peak = readPeak(r.stderr ?? "");
      expect(peak).not.toBeNull();
      expect(peak!).toBeLessThanOrEqual(PEAK_CEILING);
    } finally {
      rmSync(file, { force: true });
    }
  }, 240_000);
});
