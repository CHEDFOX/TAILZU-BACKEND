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
import { describe, expect, it } from "vitest";
import { cutArgs, frameOf, srtOf, timeline, type CutShot } from "../src/cinema/cut.js";
import { cut, frames, probe, seconds } from "../src/cinema/ffmpeg.js";

const shot = (over: Partial<CutShot> = {}): CutShot => ({ video: "a.mp4", seconds: 4, hasAudio: true, link: "cut", vo: null, lines: [], ...over });

describe("the timeline and the words", () => {
  it("adds plain cuts and overlaps a dissolve", () => {
    expect(timeline([shot(), shot({ seconds: 5 }), shot({ seconds: 3, link: "dissolve" })])).toEqual({ starts: [0, 4, 8.5], total: 11.5 });
  });

  it("times the voice-over and the lines to their shots", () => {
    const srt = srtOf([shot({ vo: { file: "v.mp3", text: "Har baarish ki ek kahani hoti hai.", seconds: 2.5 } }), shot({ lines: ["Chai?", "Haan, ek."] })])!;
    expect(srt).toContain("00:00:00,150 --> 00:00:02,650\nHar baarish ki ek kahani hoti hai.");
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

describe.skipIf(!hasFfmpeg)("with ffmpeg", () => {
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
});
