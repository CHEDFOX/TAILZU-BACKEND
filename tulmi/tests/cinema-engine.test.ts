/**
 * THE CINEMA BOT'S ENGINE, THE PURE PARTS (src/cinema): the models as OpenRouter lists them, the router, the prompts, the price.
 *
 *   - OpenRouter's three ways of writing a price are all read, and the one that fits what we render wins
 *   - a model is used only when we have judged it and it animates from a first frame
 *   - the router never asks a model for what it cannot do (aspect, lines without sound, a continued shot without a last frame, a dearer tier)
 *     and a retake goes past a blamed model
 *   - the motion prompt describes what changes, not the still; a long one loses the sound before the action
 *   - a change to a card only changes the fingerprints of what it touches
 *   - the price: sheets only for who is seen twice, a reserve for retakes, shots no model can make listed
 */
import { describe, expect, it } from "vitest";
import { motionPrompt, stillPrint, stillPrompt, stillRefs, takePrint } from "../src/cinema/compile.js";
import { routeImage, stillModel } from "../src/cinema/imageModels.js";
import { catalog, frameSize, renderRes, snapSeconds, usdPerSecond } from "../src/cinema/models.js";
import { boardQuote, filmQuote, RESERVE, sheetsNeeded } from "../src/cinema/quote.js";
import { needs, route, wantsAudio, whyNone } from "../src/cinema/route.js";
import { bible, card, imageModels, liveVideo, shots, videoModels } from "./cinema-rig.js";

const FX = 88;

describe("the models as OpenRouter lists them", () => {
  const live = liveVideo();
  const byId = (id: string) => live.find((m) => m.id === id)!;

  it("reads durations, frames, sound and the passthrough parameters", () => {
    const kling = byId("kwaivgi/kling-v3.0-pro");
    expect(kling.durations[0]).toBe(3);
    expect(kling.durations.at(-1)).toBe(15);
    expect(kling.first && kling.last && kling.audio).toBe(true);
    expect(kling.passthrough).toContain("negative_prompt");
    expect(byId("runway/gen-4.5").last).toBe(false);
  });

  it("reads dollars a second, with and without sound, by resolution", () => {
    const veo = byId("google/veo-3.1");
    expect(usdPerSecond(veo, { res: "1080p", audio: true, aspect: "16:9" })).toBe(0.4);
    expect(usdPerSecond(veo, { res: "1080p", audio: false, aspect: "16:9" })).toBe(0.2);
    expect(usdPerSecond(veo, { res: "4K", audio: true, aspect: "16:9" })).toBe(0.6);
    const fast = byId("google/veo-3.1-fast");
    expect(usdPerSecond(fast, { res: "720p", audio: true, aspect: "16:9" })).toBe(0.1);
    expect(usdPerSecond(fast, { res: "1080p", audio: true, aspect: "16:9" })).toBe(0.12);
  });

  it("reads cents a second", () => {
    expect(usdPerSecond(byId("runway/gen-4.5"), { res: "720p", audio: false, aspect: "16:9" })).toBe(0.12);
  });

  it("reads Seedance's price per video token from the frame's pixels at 24 frames a second", () => {
    const usd = usdPerSecond(byId("bytedance/seedance-2.5"), { res: "720p", audio: true, aspect: "16:9" })!;
    expect(usd).toBeCloseTo((0.0000107 * 1280 * 720 * 24) / 1024, 5);
    expect(frameSize("720p", "9:16")).toEqual({ w: 720, h: 1280 });
  });

  it("prefers the image-to-video price to a price with no mode", () => {
    const m = { skus: { duration_seconds: "0.2", image_to_video_duration_seconds_720p: "0.1", text_to_video_duration_seconds_720p: "0.05" } };
    expect(usdPerSecond(m, { res: "720p", audio: false, aspect: "16:9" })).toBe(0.1);
  });

  it("uses only models we have judged, that start from a first frame", () => {
    const ids = catalog(live).map((m) => m.id);
    expect(ids).toContain("kwaivgi/kling-v3.0-std");
    expect(ids).toContain("alibaba/happyhorse-1.1");
    expect(ids).not.toContain("heygen/avatar-iv");
    expect(ids).not.toContain("x-ai/grok-imagine-video");
  });

  it("snaps a duration to the nearest the model makes, and clamps the resolution to what it has", () => {
    expect(snapSeconds({ durations: [4, 6, 8] }, 5)).toBe(6);
    expect(snapSeconds({ durations: [4, 6, 8] }, 12)).toBe(8);
    expect(renderRes({ resolutions: ["720p"] }, "premium")).toBe("720p");
    expect(renderRes({ resolutions: ["480p", "768p"] }, "standard")).toBe("480p");
    expect(renderRes({ resolutions: ["2K"] }, "draft")).toBe("2K");
  });
});

describe("the router", () => {
  const models = videoModels();
  const b = bible();

  it("keeps Kling's takes silent unless someone speaks: its sound cannot be told no music", () => {
    const kling = models.find((m) => m.id === "kwaivgi/kling-v3.0-std")!;
    const veo = models.find((m) => m.id === "google/veo-3.1-fast")!;
    expect(wantsAudio(card(1), kling)).toBe(false);
    expect(wantsAudio(card(1), veo)).toBe(true);
    expect(wantsAudio(card(1, { lines: [{ who: "ravi", text: "Haan" }] }), kling)).toBe(true);
  });

  it("puts a dialogue close-up on a model that speaks, and never on one without sound", () => {
    const c = card(1, { size: "close", lines: [{ who: "ravi", text: "Chai?" }] });
    const picks = route({ card: c, style: "live", aspect: "16:9", tier: "premium", models });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => p.model.audio)).toBe(true);
    expect(picks[0]!.audio).toBe(true);
  });

  it("only uses models that take a last frame for a shot that continues the one before", () => {
    const picks = route({ card: card(2, { link: "continue" }), style: "live", aspect: "16:9", tier: "premium", models });
    expect(picks.map((p) => p.model.id)).not.toContain("runway/gen-4.5");
    expect(picks.every((p) => p.model.last)).toBe(true);
  });

  it("keeps a film within its tier and its aspect ratio", () => {
    const draft = route({ card: card(1), style: "live", aspect: "16:9", tier: "draft", models });
    expect(draft.every((p) => p.model.tier === "draft")).toBe(true);
    const square = route({ card: card(1), style: "live", aspect: "1:1", tier: "premium", models });
    expect(square.map((p) => p.model.id)).not.toContain("google/veo-3.1");
  });

  it("goes past a blamed model on a retake, and still uses it when nothing else is left", () => {
    const first = route({ card: card(1), style: "live", aspect: "16:9", tier: "standard", models })[0]!.model.id;
    const again = route({ card: card(1), style: "live", aspect: "16:9", tier: "standard", models, blamed: [first] });
    expect(again[0]!.model.id).not.toBe(first);
    const only = models.filter((m) => m.id === first);
    expect(route({ card: card(1), style: "live", aspect: "16:9", tier: "standard", models: only, blamed: [first] })[0]!.model.id).toBe(first);
  });

  it("puts a pinned model first, even above the film's tier", () => {
    const picks = route({ card: card(1, { pin: "google/veo-3.1" }), style: "live", aspect: "16:9", tier: "draft", models });
    expect(picks[0]!.model.id).toBe("google/veo-3.1");
  });

  it("reads what a shot needs from its card", () => {
    const n = needs(card(1, { size: "close", motion: 3, physics: true, move: "orbit" }), "live");
    expect(n.faces).toBeGreaterThan(1);
    expect(n.motion).toBe(1);
    expect(n.camera).toBe(1);
    expect(needs(card(1, { cast: [] }), "animated").faces).toBe(0);
  });

  it("says why when no model can make a shot", () => {
    const silent = models.filter((m) => !m.audio);
    const c = card(1, { lines: [{ who: "ravi", text: "Haan" }] });
    expect(route({ card: c, style: "live", aspect: "16:9", tier: "premium", models: silent })).toEqual([]);
    expect(whyNone({ card: c, style: "live", aspect: "16:9", tier: "premium", models: silent })).toMatch(/speak lines/);
  });

  it("uses the picture models that spell for words, and a vector model for a logo", () => {
    const imgs = imageModels();
    const poster = routeImage({ kind: "poster", text: "MONSOON SALE", refs: 0, aspect: "9:16", tier: "premium" }, imgs);
    expect(["openai/gpt-image-2", "qwen/qwen-image-3-pro", "google/gemini-nano-banana-2.1"]).toContain(poster[0]!.model.id);
    const logo = routeImage({ kind: "logo", text: "Ravi's", refs: 0, aspect: "1:1", tier: "standard" }, imgs);
    expect(logo[0]!.model.s.vector).toBe(5);
    const edit = routeImage({ kind: "edit", text: null, refs: 2, aspect: "1:1", tier: "standard" }, imgs);
    expect(edit.every((c) => c.model.maxRefs >= 1)).toBe(true);
    expect(stillModel(imgs, 3)?.id).toBe("google/gemini-nano-banana-2.1");
  });
});

describe("the prompts", () => {
  const b = bible({
    characters: bible().characters.map((c) => ({ ...c, ref: `ref-${c.key}` })),
    places: bible().places.map((p) => ({ ...p, ref: `ref-${p.key}` })),
  });

  it("names each reference image by its number and gives it one role; the look frame last", () => {
    const c = card(4, { cast: ["ravi", "meera"] });
    const withLook = { ...b, lookRef: "ref-look" };
    expect(stillRefs(c, withLook, 14).map((r) => r.key)).toEqual(["ref-ravi", "ref-meera", "ref-stall", "ref-look"]);
    expect(stillRefs(c, withLook, 2).map((r) => r.key)).toEqual(["ref-ravi", "ref-meera"]);
    const p = stillPrompt(c, withLook, 14);
    expect(p).toContain("Reference image 1: the face, hair, build and clothes of Ravi");
    expect(p).toContain("Reference image 3: the place, the chai stall");
    expect(p).toContain("Reference image 4: the colour grade, the light and the film texture only");
    expect(p).toContain("No text");
    expect(p).not.toContain("16:9");
  });

  it("takes out the words that make a picture generic", () => {
    const p = stillPrompt(card(1, { frame: "An epic, cinematic shot of the stall, stunning" }), b, 14);
    expect(p).not.toMatch(/epic|cinematic|stunning/i);
  });

  it("names how the shot ends, and writes a busy Seedance shot as a timeline", () => {
    expect(motionPrompt(card(1), b, { dialect: "kling", maxChars: 2000, audio: false, seconds: 5 })).toContain("Ends on: Ravi looks up at the rain, smiling.");
    const busy = motionPrompt(card(3, { motion: 3, cast: ["meera"] }), b, { dialect: "seedance", maxChars: 2000, audio: true, seconds: 8 });
    expect(busy).toContain("TIMELINE: [0-6s]");
    expect(busy).toContain("[6-8s] The movement settles");
    expect(busy).toContain("ENDING STATE");
    expect(busy).toContain("no music");
  });

  it("writes lines the way Kling reads them", () => {
    const c = card(4, { lines: [{ who: "ravi", text: "Andar aa jao" }, { who: "meera", text: "Shukriya" }] });
    expect(motionPrompt(c, b, { dialect: "kling", maxChars: 2000, audio: true, seconds: 6 })).toContain('[Ravi, low, warm, unhurried Mumbai Hindi]: "Andar aa jao" Immediately, [Meera, quick, bright, a little breathless]: "Shukriya"');
  });

  it("asks for the words in frame when a shot has them", () => {
    expect(stillPrompt(card(1, { text: "RAVI CHAI" }), b, 14)).toContain('"RAVI CHAI"');
  });

  it("describes what moves, not the still, and writes lines the way the model reads them", () => {
    const c = card(4, { lines: [{ who: "ravi", text: "Andar aa jao" }] });
    const p = motionPrompt(c, b, { dialect: "veo", maxChars: 1800, audio: true, seconds: 6 });
    expect(p).toContain('Ravi says in a low, warm, unhurried Mumbai Hindi voice: "Andar aa jao"');
    expect(p).not.toContain("indigo cotton kurta");
    expect(p).toContain("Audio:");
    expect(p).toContain("No music");
    expect(motionPrompt(c, b, { dialect: "runway", maxChars: 1000, audio: false, seconds: 6 })).not.toContain("Audio:");
  });

  it("drops the sound and the light before the action and the ending when a prompt is too long", () => {
    const c = card(1, { action: "Ravi pours chai ".repeat(8), sound: "rain ".repeat(30) });
    const p = motionPrompt(c, b, { dialect: "seedance", maxChars: 360, audio: true, seconds: 5 });
    expect(p.length).toBeLessThanOrEqual(360);
    expect(p).toContain("Ravi pours chai");
    expect(p).toContain("Ends on:");
    expect(p).not.toContain("Audio:");
  });

  it("carries the fix from a failed take", () => {
    expect(motionPrompt(card(1), b, { dialect: "kling", maxChars: 2000, audio: false, seconds: 5, fix: "keep his left hand on the kettle" })).toContain("Important: Keep his left hand on the kettle.");
  });

  it("puts everything that is seen into the still: lens and depth, layers, people in full, atmosphere, light, grade, texture, purpose, a quality lock", () => {
    const p = stillPrompt(card(2, { size: "close" }), b, 14);
    for (const want of [
      "Close-up, eye-level, 35mm lens, shallow depth of field, focus on the eyes",
      "Composition: The kettle and tumblers in the foreground left",
      "a small scar on his left eyebrow",
      "Wearing: A faded indigo cotton kurta",
      "Setting: The chai stall, a tin-roofed wooden stall",
      "Atmosphere: Steam curling from the kettle",
      "Lighting: Soft cool daylight from the street behind, a bare 3200K bulb",
      "Colour grade: Warm highlights, teal shadows",
      "Texture: 35mm film; fine grain, soft halation",
      "Purpose: The viewer feels the comfort of a hot chai",
      "anatomically correct hands with five fingers",
    ]) expect(p).toContain(want);
  });

  it("puts everything that moves into the motion: the acting, the camera in detail, the air, the physics, the purpose, the sound", () => {
    const p = motionPrompt(card(2, { physics: true, crowd: true }), b, { dialect: "veo", maxChars: 1500, audio: true, seconds: 6 });
    for (const want of [
      "Camera: A slow push-in from medium to medium-close over the shot, focus holding on his hands then racking to his face",
      "Performance: He glances up at the roof, a small smile",
      "Atmosphere: Steam curling",
      "Physics: real weight and momentum",
      "Background people move naturally and independently",
      "Purpose: The viewer feels the comfort",
      "Audio: Rain on tin, kettle. No music, no subtitles.",
      "Ends on: Ravi looks up at the rain, smiling.",
    ]) expect(p).toContain(want);
    expect(p.length).toBeLessThanOrEqual(1500);
  });

  it("writes a busy Seedance shot beat by beat, each beat with its own share of the seconds", () => {
    const c = card(4, { action: "Ravi hands Meera a glass. She wraps both hands round it. She takes a first sip.", motion: 2 });
    const p = motionPrompt(c, b, { dialect: "seedance", maxChars: 2000, audio: true, seconds: 8 });
    expect(p).toContain("[0-2s] Ravi hands Meera a glass. [2-4s] She wraps both hands round it. [4-6s] She takes a first sip. [6-8s] The movement settles and holds.");
    expect(p).toContain("PERFORMANCE:");
    expect(p).toContain("CONTINUITY:");
  });

  it("keeps every prompt within the length its model reads best, and keeps what matters most", () => {
    for (const m of videoModels()) {
      const p = motionPrompt(card(3, { cast: ["meera"], lines: [{ who: "meera", text: "Ek chai, please!" }], physics: true }), b, { dialect: m.dialect, maxChars: m.maxPrompt, audio: m.audio, seconds: 6 });
      expect(p.length, m.id).toBeLessThanOrEqual(m.maxPrompt);
      expect(p, m.id).toContain("Ravi pours chai");
      expect(p, m.id).toMatch(/Ends on:|ENDING STATE/);
    }
  });

  it("still writes a prompt for a card from before the detailed fields", () => {
    const old = { ...card(1) } as Record<string, unknown>;
    for (const k of ["intent", "performance", "camera", "composition", "atmosphere"]) delete old[k];
    const c = old as unknown as Parameters<typeof motionPrompt>[0];
    expect(motionPrompt(c, b, { dialect: "veo", maxChars: 1500, audio: false, seconds: 5 })).toContain("Camera: The camera holds completely still");
    expect(stillPrompt(c, b, 14)).not.toContain("undefined");
  });

  it("changes only the fingerprints a change touches", () => {
    const c = card(2);
    const still = stillPrint(c, b, "16:9");
    const take = takePrint(c, b, "16:9", null);
    const newLine = { ...c, lines: [{ who: "ravi", text: "Garam chai!" }] };
    expect(stillPrint(newLine, b, "16:9")).toBe(still);
    expect(takePrint(newLine, b, "16:9", null)).not.toBe(take);
    const newCoat = bible({ characters: b.characters.map((x) => (x.key === "ravi" ? { ...x, wardrobe: "a red shawl" } : x)) });
    expect(stillPrint(c, newCoat, "16:9")).not.toBe(still);
    expect(stillPrint(c, b, "9:16")).not.toBe(still);
  });
});

describe("the price", () => {
  const script = { bible: bible(), shots: shots() };

  it("makes reference sheets only for who is seen in two shots or more", () => {
    expect(sheetsNeeded(script)).toEqual({ characters: ["ravi", "meera"], places: ["stall", "street"] });
    const once = { bible: bible(), shots: shots().slice(0, 2) };
    expect(sheetsNeeded(once)).toEqual({ characters: [], places: [] });
  });

  it("prices the storyboard: the look frame, the sheets, two stills for a shot with people, and the voice-over", () => {
    const q = boardQuote(script, { usd: 0.04 }, FX);
    expect(q.sheets).toBe(5);
    expect(q.stills).toBe(7);
    const vo = (script.shots[0]!.vo!.length / 1000) * 0.03;
    expect(q.paise).toBe(Math.ceil(Number(((12 * 0.04 + vo) * FX * 100).toFixed(6))));
  });

  it("prices the film shot by shot with a reserve for retakes", () => {
    const q = filmQuote(script, { aspect: "16:9", tier: "standard" }, videoModels(), FX);
    expect(q.missing).toEqual([]);
    expect(q.shots.every((s) => s.model && s.paise > 0)).toBe(true);
    expect(q.reserve).toBeGreaterThanOrEqual(Math.floor(q.video * RESERVE) - 1);
    expect(q.paise).toBe(q.video + q.reserve + q.extras);
    expect(q.extras).toBeGreaterThan(0);
  });

  it("lists the shots no model can make", () => {
    const silent = videoModels().filter((m) => !m.audio);
    const q = filmQuote(script, { aspect: "16:9", tier: "premium" }, silent, FX);
    expect(q.missing).toEqual([4]);
  });
});
