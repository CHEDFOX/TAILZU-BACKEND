/**
 * THE CINEMA BOT'S DIRECTOR (src/cinema/plan.ts): a model's script made safe to spend money on.
 *
 *   - unknown sizes, moves and links fall back to ones the engine knows; people and places that do not exist are dropped
 *   - lines only from people in the shot; the first shot is a cut; "continue" only in the same place
 *   - the seconds brought to the length asked for; a shot given the seconds its words need, and the person told
 *   - a model that answers badly is asked once more, then the person is told plainly
 *   - a note about one shot changes that shot only, whatever the model sends back; sheets survive a revision that keeps a look
 *   - people from the person's cast keep their own looks and sheets
 */
import { describe, expect, it } from "vitest";
import { direct, fitLength, lint, normalize, revise, type Think } from "../src/cinema/plan.js";
import { bible, shots } from "./cinema-rig.js";

const raw = (over: Record<string, unknown> = {}) => ({
  bible: {
    title: "Chai in the Rain", logline: "x", genre: "ad", tone: "warm", style: "live", language: "hi",
    look: { palette: "amber", light: "soft", lens: "anamorphic", stock: "35mm" },
    characters: [{ key: "Ravi", name: "Ravi", look: "fifties", wardrobe: "kurta" }, { key: "meera", name: "Meera", look: "student", wardrobe: "raincoat" }],
    places: [{ key: "stall", name: "the stall", look: "tin roof" }, { key: "street", name: "the street", look: "puddles" }],
    music: "tabla",
  },
  shots: [
    { size: "wide", angle: "eye", move: "drone", lens: 24, cast: [], place: "street", action: "rain", frame: "lane", end: "rain hits", seconds: 5, link: "continue" },
    { size: "close-up", angle: "sideways", move: "whip", lens: 400, cast: ["ravi", "ghost"], place: "stall", action: "pours", frame: "counter", seconds: 6,
      lines: [{ who: "ravi", text: "Chai?" }, { who: "meera", text: "Haan" }], link: "continue" },
    { size: "medium", cast: ["meera"], place: "nowhere", action: "runs", frame: "lane", seconds: 4, link: "continue" },
  ],
  ...over,
});

describe("making a script safe to spend money on", () => {
  it("falls back to what the engine knows, and drops what does not exist", () => {
    const { script } = normalize(raw(), { length: 15, language: "en" });
    const [a, b, c] = script.shots;
    expect(a!.link).toBe("cut");
    expect(b!.size).toBe("medium");
    expect(b!.angle).toBe("eye");
    expect(b!.move).toBe("static");
    expect(b!.lens).toBe(200);
    expect(b!.cast).toEqual(["ravi"]);
    expect(b!.lines).toEqual([{ who: "ravi", text: "Chai?" }]);
    expect(b!.link).toBe("cut");
    expect(c!.place).toBe("stall");
    expect(c!.link).toBe("continue");
    expect(script.bible.characters[0]!.key).toBe("ravi");
    expect(script.bible.lookRef).toBeNull();
  });

  it("keeps the detailed fields the prompts are written from, and drops acting from a shot with nobody in it", () => {
    const r = raw();
    ((r.bible as Record<string, unknown>).look as Record<string, unknown>).grade = "warm highlights, teal shadows";
    ((r.bible as Record<string, unknown>).look as Record<string, unknown>).texture = "fine grain";
    ((r.bible as Record<string, unknown>).characters as Record<string, unknown>[])[0]!.voice = "low and warm";
    Object.assign((r.shots as Record<string, unknown>[])[1]!, {
      intent: "comfort", performance: "a small smile", camera: "slow push-in, focus racks to his face", composition: "kettle foreground left", atmosphere: "steam curling",
    });
    Object.assign((r.shots as Record<string, unknown>[])[0]!, { performance: "nobody to act" });
    const { script } = normalize(r, { length: 15, language: "hi" });
    expect(script.bible.look).toMatchObject({ grade: "warm highlights, teal shadows", texture: "fine grain" });
    expect(script.bible.characters[0]!.voice).toBe("low and warm");
    expect(script.shots[1]).toMatchObject({ intent: "comfort", performance: "a small smile", camera: "slow push-in, focus racks to his face", composition: "kettle foreground left", atmosphere: "steam curling" });
    expect(script.shots[0]!.performance).toBe("");
  });

  it("asks the director for every detail the prompts need", async () => {
    const { DIRECTOR_SYSTEM } = await import("../src/cinema/plan.js");
    for (const field of ['"intent"', '"performance"', '"camera"', '"composition"', '"atmosphere"', '"grade"', '"texture"', '"voice"']) expect(DIRECTOR_SYSTEM).toContain(field);
  });

  it("brings the seconds to the length asked for", () => {
    const { script } = normalize(raw(), { length: 30, language: "en" });
    const total = script.shots.reduce((n, s) => n + s.seconds, 0);
    expect(Math.abs(total - 30)).toBeLessThanOrEqual(3);
    expect(fitLength(shots(), 20)).toEqual(shots());
  });

  it("gives a shot the seconds its words need, and says so", () => {
    const long = raw();
    (long.shots as Record<string, unknown>[])[0]!.vo = "Har baarish ki ek kahani hoti hai, aur har kahani mein ek garam chai ka cup hota hai jo sabko jod deta hai.";
    const { script, notes } = normalize(long, { length: 15, language: "hi", keepLength: true });
    expect(script.shots[0]!.seconds).toBeGreaterThan(5);
    expect(notes[0]).toMatch(/^Shot 1: given \d+ seconds/);
  });

  it("refuses an answer with no shots", () => {
    expect(() => normalize({ bible: {} }, { length: 10, language: "en" })).toThrow();
    expect(() => normalize("I cannot help with that", { length: 10, language: "en" })).toThrow();
  });

  it("reads a script out of prose around it", () => {
    const { script } = normalize(`Here is the film:\n${JSON.stringify(raw())}\nEnjoy`, { length: 15, language: "en" });
    expect(script.shots).toHaveLength(3);
  });

  it("notes a missing establishing shot and three of a size running", () => {
    const flat = shots().map((s) => ({ ...s, size: "close" as const }));
    const notes = lint({ bible: bible(), shots: flat });
    expect(notes.some((n) => n.startsWith("No establishing shot"))).toBe(true);
    expect(notes.some((n) => n.includes("all close"))).toBe(true);
  });
});

describe("the director", () => {
  const thinking = (answers: unknown[]): { think: Think; asked: string[] } => {
    const asked: string[] = [];
    let i = 0;
    return { asked, think: async (o) => { asked.push(typeof o.user === "string" ? o.user : ""); const a = answers[Math.min(i++, answers.length - 1)]; return { json: a, text: "" }; } };
  };

  it("asks once more when the first answer is not a script, then gives up plainly", async () => {
    const ok = thinking(["nonsense", raw()]);
    const r = await direct(ok.think, { idea: "a chai ad", length: 15, aspect: "16:9", language: "hi" });
    expect(r.script.shots).toHaveLength(3);
    expect(ok.asked[1]).toMatch(/not usable JSON/);
    const bad = thinking(["nonsense"]);
    await expect(direct(bad.think, { idea: "x", length: 15, aspect: "16:9", language: "hi" })).rejects.toThrow(/could not write/);
  });

  it("keeps the person's own cast as they are", async () => {
    const t = thinking([raw()]);
    const cast = [{ key: "ravi", name: "Ravi", look: "his real look", wardrobe: "his real kurta", ref: "sheet-ravi" }];
    const r = await direct(t.think, { idea: "a chai ad", length: 15, aspect: "16:9", language: "hi", cast });
    expect(r.script.bible.characters[0]).toMatchObject({ look: "his real look", ref: "sheet-ravi" });
    expect(t.asked[0]).toContain("his real look");
  });

  it("changes only the shot a note is about, whatever comes back", async () => {
    const before = normalize(raw(), { length: 15, language: "hi" }).script;
    const back = raw();
    (back.shots as Record<string, unknown>[])[0]!.action = "a different rain";
    (back.shots as Record<string, unknown>[])[1]!.action = "pours slowly, smiling";
    const r = await revise(thinking([back]).think, before, "make him smile", { length: 15, n: 2 });
    expect(r.script.shots[1]!.action).toBe("pours slowly, smiling");
    expect(r.script.shots[0]!.action).toBe(before.shots[0]!.action);
    expect(r.script.bible).toBe(before.bible);
  });

  it("keeps the sheets and the look frame through a revision that keeps their looks", async () => {
    const before = normalize(raw(), { length: 15, language: "hi" }).script;
    before.bible.characters[0]!.ref = "sheet-ravi";
    before.bible.characters[1]!.ref = "sheet-meera";
    before.bible.lookRef = "look";
    const back = raw();
    ((back.bible as Record<string, unknown>).characters as Record<string, unknown>[])[1]!.wardrobe = "a red raincoat";
    const r = await revise(thinking([back]).think, before, "give Meera a red raincoat", { length: 15 });
    expect(r.script.bible.characters[0]!.ref).toBe("sheet-ravi");
    expect(r.script.bible.characters[1]!.ref).toBeNull();
    expect(r.script.bible.lookRef).toBe("look");
  });
});
