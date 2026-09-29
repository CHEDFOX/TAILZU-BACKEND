/**
 * Words nobody said.
 *
 * "Thank you." and "Okay." kept arriving at the end of dictations. Two
 * sources: the writer closing politely, and the recogniser answering a breath
 * — the desktop uploads the pause between sentences as its own clip, in webm,
 * whose length cannot be read from a header, so it was always trusted.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { stripAddedClosing, stripEdgeFiller } from "../src/pipeline/cleanup.js";
import { isAmbiguousPhrase, speechSeconds } from "../src/pipeline/stt.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const clip = (src: string): Buffer => execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", src, "-t", "1.2", "-c:a", "libopus", "-f", "webm", "pipe:1",
]);

describe("a closing the writer added", () => {
  it("comes off when they never said it", () => {
    expect(stripAddedClosing("Hello, as you can see in this line. Okay.", "hello as you can see in this line"))
      .toBe("Hello, as you can see in this line.");
    expect(stripAddedClosing("Hi Priya, the deck is done. Thank you.", "hi priya the deck is done"))
      .toBe("Hi Priya, the deck is done.");
  });

  it("stays when they did", () => {
    expect(stripAddedClosing("Hi Priya, the deck is done. Thank you.", "hi priya the deck is done thank you"))
      .toBe("Hi Priya, the deck is done. Thank you.");
    expect(stripAddedClosing("Okay.", "okay")).toBe("Okay.");
  });

  it("leaves a sentence that only starts like one", () => {
    expect(stripAddedClosing("Got it. Okay, see you at five.", "got it see you at five"))
      .toBe("Got it. Okay, see you at five.");
  });
});

describe("a clip that is only a breath", () => {
  it("knows the phrases a recogniser answers noise with", () => {
    for (const t of ["Thank you.", "Okay.", "ok", "You.", "Bye!"]) expect(isAmbiguousPhrase(t), t).toBe(true);
    expect(isAmbiguousPhrase("Okay, see you at five.")).toBe(false);
  });

  it.skipIf(!hasFfmpeg)("measures silence as no speech and sound as speech", async () => {
    expect(await speechSeconds(clip("anullsrc=r=16000:cl=mono"), "webm")).toBeLessThan(0.3);
    expect(await speechSeconds(clip("sine=frequency=300:sample_rate=16000"), "webm")).toBeGreaterThan(0.8);
  });

  it("says unknown, not silent, when it cannot read the clip", async () => {
    expect(await speechSeconds(Buffer.from("not audio"), "webm")).toBe(-1);
  });
});

describe("hesitation at the edges, in any alphabet", () => {
  it("drops a hmm the recogniser wrote in Bengali or Devanagari", () => {
    expect(stripEdgeFiller("হুম হুম Why is the keyboard so slow and stuck up?")).toBe("Why is the keyboard so slow and stuck up?");
    expect(stripEdgeFiller("हम्म, मैं कल आऊंगा।")).toBe("मैं कल आऊंगा।");
  });

  it("drops it in English letters, at either end, and gives the sentence its capital", () => {
    expect(stripEdgeFiller("Hmm, hmm. let me check the file.")).toBe("Let me check the file.");
    expect(stripEdgeFiller("Umm I think so, uh.")).toBe("I think so.");
  });

  it("keeps words that only start like one", () => {
    expect(stripEdgeFiller("हम कल मिलेंगे।")).toBe("हम कल मिलेंगे।");      // "we"
    expect(stripEdgeFiller("Hummus for lunch?")).toBe("Hummus for lunch?");
    expect(stripEdgeFiller("Umbrella is in the car.")).toBe("Umbrella is in the car.");
    expect(stripEdgeFiller("Mmm, that was good.")).toBe("Mmm, that was good.");
  });

  it("leaves a message that is only the sound alone", () => {
    expect(stripEdgeFiller("hmm")).toBe("hmm");
  });
});
