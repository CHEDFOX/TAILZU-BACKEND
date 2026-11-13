/**
 * THE CINEMA BOT'S PICTURES (src/cinema/pictures.ts):
 *
 *   - the ask is read into a kind, the words to spell, a frame and a brief; an edit needs photos; empty words are taken out
 *   - two candidates where faces or words are involved, the better passing one kept
 *   - when none passes, one more try on the next model with the fix; then the best, with a note
 *   - a logo goes to a vector model as SVG, and is not looked at (a vision model reads SVG badly)
 */
import { describe, expect, it } from "vitest";
import { candidates, makePicture, normalizeAsk, parseImageVerdict, picturePrompt, type PictureDeps } from "../src/cinema/pictures.js";
import type { Think } from "../src/cinema/plan.js";
import { imageModels } from "./cinema-rig.js";

const cast = [{ key: "ravi", name: "Ravi", look: "fifties", wardrobe: "kurta", ref: "sheet-ravi" }];

describe("reading the ask", () => {
  it("reads the kind, the words to spell and the frame, and cleans the brief", () => {
    const a = normalizeAsk({ kind: "poster", text: "MONSOON SALE", aspect: "9:16", prompt: "An epic poster of chai in the rain, stunning", cast: ["ravi", "nobody"] }, "a poster", { photos: 0, cast });
    expect(a).toMatchObject({ kind: "poster", text: "MONSOON SALE", aspect: "9:16", cast: ["ravi"] });
    expect(a.prompt).not.toMatch(/epic|stunning/i);
  });

  it("needs photos for an edit, and falls back to the person's words", () => {
    expect(normalizeAsk({ kind: "edit" }, "make it night", { photos: 0, cast: [] }).kind).toBe("photo");
    expect(normalizeAsk("not json", "make it night", { photos: 1, cast: [] })).toMatchObject({ kind: "edit", prompt: "make it night" });
    expect(normalizeAsk({ text: "null" }, "x", { photos: 0, cast: [] }).text).toBeNull();
  });

  it("names each reference's role and the rule on words", () => {
    const p = picturePrompt({ kind: "poster", text: "Ravi's Chai", aspect: "2:3", prompt: "A chai stall", cast: [] }, [{ role: "the face of Ravi" }]);
    expect(p).toContain("Reference image 1: the face of Ravi.");
    expect(p).toContain('"Ravi\'s Chai" appear exactly as written');
    expect(picturePrompt({ kind: "photo", text: null, aspect: "1:1", prompt: "x", cast: [] }, [])).toContain("No text");
  });

  it("makes two where faces or words are involved", () => {
    expect(candidates({ kind: "portrait", text: null })).toBe(2);
    expect(candidates({ kind: "illustration", text: "Hi" })).toBe(2);
    expect(candidates({ kind: "illustration", text: null })).toBe(1);
  });

  it("reads a verdict and decides in code", () => {
    expect(parseImageVerdict({ scores: { match: 9, quality: 8, text: 9, identity: 10 }, issues: [] })?.pass).toBe(true);
    expect(parseImageVerdict({ scores: { match: 9, quality: 9, text: 3, identity: 10 } })?.pass).toBe(false);
    expect(parseImageVerdict({ scores: { match: 9, quality: 9 }, major: true })?.pass).toBe(false);
    expect(parseImageVerdict("no")).toBeNull();
  });
});

describe("making a picture", () => {
  const rig = (verdicts: unknown[]) => {
    const made: { model: string; prompt: string; format?: string }[] = [];
    let v = 0;
    const think: Think = async () => ({ json: verdicts[Math.min(v++, verdicts.length - 1)], text: "", usd: 0.001 });
    const deps: PictureDeps = {
      think,
      models: imageModels(),
      dataUrl: (b, t) => `data:${t};base64,${b.toString("base64")}`,
      make: async (o) => { made.push(o); return { bytes: Buffer.from(`img${made.length}`), type: "image/png", usd: 0.04 }; },
    };
    return { deps, made };
  };
  const good = { scores: { match: 9, quality: 9, text: 10, identity: 10 } };
  const poor = (q: number) => ({ scores: { match: 8, quality: q, text: 10, identity: 10 }, issues: ["six fingers"], fix: "five fingers on each hand" });

  it("keeps the better of two passing candidates", async () => {
    const { deps, made } = rig([{ scores: { match: 7, quality: 7, text: 10, identity: 10 } }, good]);
    const out = await makePicture(deps, { words: "a portrait of Ravi", tier: "standard", refs: [], ask: { kind: "portrait", text: null, aspect: "1:1", prompt: "Ravi", cast: [] } });
    expect(made).toHaveLength(2);
    expect(out.bytes.toString()).toBe("img2");
    expect(out.note).toBeNull();
  });

  it("tries once more on the next model with the fix, then gives the best with a note", async () => {
    const { deps, made } = rig([poor(4), poor(5), poor(5), poor(3)]);
    const out = await makePicture(deps, { words: "a portrait", tier: "standard", refs: [], ask: { kind: "portrait", text: null, aspect: "1:1", prompt: "Ravi", cast: [] } });
    expect(made).toHaveLength(4);
    expect(made[2]!.model).not.toBe(made[0]!.model);
    expect(made[2]!.prompt).toContain("five fingers on each hand");
    expect(out.note).toMatch(/six fingers/);
    expect(out.tries).toBe(4);
  });

  it("makes a logo as SVG on a vector model, without looking", async () => {
    const { deps, made } = rig([good]);
    const out = await makePicture(deps, { words: "a logo", tier: "standard", refs: [], ask: { kind: "logo", text: null, aspect: "1:1", prompt: "a teacup mark", cast: [] } });
    expect(made[0]!.format).toBe("svg");
    expect(out.verdict).toBeNull();
  });
});
