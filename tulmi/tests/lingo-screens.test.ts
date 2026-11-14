/**
 * LINGO'S SCREENS (src/experience/bots/screens/bots/lingoPage.ts):
 *
 *   - every tree passes the kit's own check (lint.ts), which is what keeps a screen drawing the same on the phone and
 *     in the window — and it is VOCABULARY 1, so every installed build draws it and a lesson can never be the screen
 *     that answers "Open X0 again"
 *   - the territory is a card per language with a Continue of its own, not a jump back into a lesson
 *   - the picker names every language in ITSELF as well as in English
 *   - leaving one offers BOTH a reason and no reason: "Just clean up" sends an empty one and still removes it
 *   - an exercise never carries the answer to the client, and the client never says whether it was right
 *   - the verdict is said with the app's own marks, because the palette has no green and no red
 */
import { describe, expect, it } from "vitest";
import type { Node } from "../../shared/types/sdui.js";
import { ctxFor, sampleLive } from "../src/experience/bots/fixtures.js";
import { lintTree } from "../src/experience/bots/lint.js";
import { SCREENS } from "../src/experience/bots/ids.js";
import { botRoute } from "../src/experience/bots/ids.js";
import {
  LINGO_SCREENS, leaving, picker, setScreen, territory, whyWords,
  type CourseView, type PickerData, type SetData,
} from "../src/experience/bots/screens/bots/lingoPage.js";
import { freshMemory } from "../src/lingo/schedule.js";
import type { Exercise } from "../src/lingo/session.js";
import type { ExerciseKind } from "../src/lingo/types.js";

const live = sampleLive();
const ctx = (client: "phone" | "desktop" = "phone") => ctxFor(SCREENS.lingo, client, live);

const course = (over: Partial<CourseView> = {}): CourseView => ({
  target: "es", from: "en", level: "a1", goalMin: 10, calls: false, voice: null,
  streakDays: 14, lastDay: null, usedMs: 0, updatedMs: 0,
  progress: { items: 41, learned: 3, due: 12, unseen: 4, held: 0.34 },
  mastery: { value: 0.3, learned: 3, spoken: 9, held: 0.34, met: 37 },
  ...over,
});

const ex = (kind: ExerciseKind, over: Partial<Exercise> = {}): Exercise => ({
  kind, item: "café", ref: "0123456789abcdef", prompt: "coffee", accepted: ["café"], options: [], correct: 0, chips: [], spoken: false, sentence: "", ...over,
});

const json = (n: Node[]): string => JSON.stringify(n);
const clean = (n: Node[]): string[] => n.flatMap((x) => lintTree(x));

describe("every tree the kit would draw", () => {
  it("passes the kit's own check, on both clients", () => {
    for (const client of ["phone", "desktop"] as const) {
      const c = ctxFor(SCREENS.lingo, client, live);
      expect(clean(territory(c, { courses: [course()] })), client).toEqual([]);
      expect(clean(territory(c, { courses: [] })), `${client} empty`).toEqual([]);
      expect(clean(picker(c, { from: "en", fromName: "English", suggested: [{ tag: "es", name: "Español", en: "Spanish" }], languages: [{ tag: "ta", name: "தமிழ்", en: "Tamil" }] })), client).toEqual([]);
      expect(clean(leaving(c, "es", "Español")), client).toEqual([]);
      for (const k of ["choose", "blank", "write", "listen", "chips", "say", "talk"] as ExerciseKind[]) {
        const data: SetData = {
          exercises: [ex(k, { options: ["coffee", "dog", "book"], chips: ["un", "café"], sentence: "Quiero un ——— con leche" })],
          progress: course().progress, mastery: course().mastery,
        };
        expect(clean(setScreen(c, "es", data)), `${client} ${k}`).toEqual([]);
      }
      expect(clean(setScreen(c, "es", { exercises: [], progress: course().progress, mastery: course().mastery })), `${client} nothing due`).toEqual([]);
    }
  });

  it("declares no vocabulary-2 block, so every installed build draws it", () => {
    for (const s of LINGO_SCREENS) {
      const built = s.build(ctx(), undefined);
      expect(built.needs ?? [], s.id).toEqual([]);
    }
  });

  it("is four screens, and Lingo's tile in the bots list opens the first of them", () => {
    expect(LINGO_SCREENS.map((s) => s.id)).toEqual([SCREENS.lingo, SCREENS.lingoAdd, SCREENS.lingoSet, SCREENS.lingoLeave]);
    expect(botRoute("lingo")).toMatchObject({ kind: "navigate", screenId: SCREENS.lingo });
    // A bot with no page of its own still goes to the shared one.
    expect(botRoute("gym-bot")).toMatchObject({ kind: "navigate", screenId: SCREENS.bot, params: { slug: "gym-bot" } });
  });
});

describe("Lingo in the bots list", () => {
  it("appears on Home once the platform lists it, beside the four that always show", async () => {
    const { liveFrom } = await import("../src/experience/bots/live.js");
    const { SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
    const withLingo = [...SAMPLE_BOTS, { slug: "lingo", name: "Lingo", colour: "ash", purpose: "Teaches you a language by talking with you.", builtin: true }];
    const model = liveFrom({ bots: withLingo, jobs: [], tasks: [], minutesSaved: 0, budgetPaise: 0, now: Date.UTC(2026, 9, 28), tzOffsetMinutes: 330 });
    const lingo = model.bots.find((b) => b.slug === "lingo");
    expect(lingo, "Lingo is in the Home list").toBeTruthy();
    expect(lingo!.name).toBe("Lingo");
    // Its own colour, not the fallback grey every unknown bot wears.
    const { PALETTE_HEX } = await import("../src/experience/bots/palette.js");
    expect(lingo!.color).toBe(PALETTE_HEX.ash);
    expect(lingo!.color).not.toBe(PALETTE_HEX.stone);
  });

  it("is simply absent when the platform does not list it, and nothing else moves", async () => {
    const { liveFrom } = await import("../src/experience/bots/live.js");
    const { SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
    const model = liveFrom({ bots: SAMPLE_BOTS, jobs: [], tasks: [], minutesSaved: 0, budgetPaise: 0, now: Date.UTC(2026, 9, 28), tzOffsetMinutes: 330 });
    expect(model.bots.find((b) => b.slug === "lingo")).toBeUndefined();
    // The four that are always there are still the first four, in order.
    expect(model.bots.slice(0, 4).map((b) => b.slug)).toEqual(["code", "keybot", "plan", "travel"]);
  });
});

describe("the territory", () => {
  it("gives each language its own Continue, rather than dropping them into a lesson", () => {
    const s = json(territory(ctx(), { courses: [course(), course({ target: "ja", streakDays: 2, progress: { items: 8, learned: 0, due: 0, unseen: 8, held: 0.06 } })] }));
    expect(s).toContain("Continue");
    expect(s).toContain("Add a language");
    expect(s).toContain("12 due");
  });

  it("says nothing is due instead of a zero", () => {
    const s = json(territory(ctx(), { courses: [course({ progress: { items: 8, learned: 0, due: 0, unseen: 0, held: 0.5 } })] }));
    expect(s).toContain("nothing due");
  });

  it("asks which language when there is none, instead of showing an empty list", () => {
    const s = json(territory(ctx(), { courses: [] }));
    expect(s).toContain("Which language");
    expect(s).toContain("Add a language");
  });

  it("offers a way out of each language", () => {
    expect(json(territory(ctx(), { courses: [course()] }))).toContain(SCREENS.lingoLeave);
  });
});

describe("the picker", () => {
  it("names a language in itself as well as in English", () => {
    const data: PickerData = {
      from: "en", fromName: "English",
      suggested: [{ tag: "es", name: "Español", en: "Spanish" }],
      languages: [{ tag: "ta", name: "தமிழ்", en: "Tamil" }, { tag: "zh", name: "中文", en: "Mandarin Chinese" }],
    };
    const s = json(picker(ctx(), data));
    for (const w of ["Español", "Spanish", "தமிழ்", "Tamil", "中文", "Mandarin Chinese"]) expect(s, w).toContain(w);
  });

  it("does not ask what they already speak: it says it", () => {
    const s = json(picker(ctx(), { from: "en", fromName: "English", suggested: [], languages: [] }));
    expect(s).toContain("Taught in English");
  });

  it("says so plainly when a search finds nothing", () => {
    expect(json(picker(ctx(), { from: null, fromName: null, suggested: [], languages: [] }))).toContain("Nothing by that name");
  });
});

describe("leaving a language", () => {
  it("offers a reason AND a way out without one", () => {
    const s = json(leaving(ctx(), "es", "Español"));
    expect(s).toContain("Just clean up");
    expect(s).toContain("Stop learning");
    expect(s).toContain("Optional");
  });

  it("sends an empty reason for Just clean up, and what they wrote for the other", () => {
    const s = json(leaving(ctx(), "es", "Español"));
    expect(s).toContain('"reason":""');
    expect(s).toContain('"reason":"$state.why"');
  });

  it("keeps a way back that removes nothing", () => {
    expect(json(leaving(ctx(), "es", "Español"))).toContain("Keep learning");
  });
});

describe("an exercise gives nothing away", () => {
  it("never sends the answer to the client for a typed or spoken one", () => {
    for (const k of ["write", "listen", "say", "talk"] as ExerciseKind[]) {
      const s = json(setScreen(ctx(), "es", { exercises: [ex(k)], progress: course().progress, mastery: course().mastery }));
      // "café" is the answer. The prompt is its meaning, and the item is named by its opaque ref, so the word must
      // not be in the tree at all. `listen` is the exception: it has to reach the phone to be spoken aloud.
      if (k !== "listen") expect(s, k).not.toContain("café");
      if (k !== "listen") expect(s, k).toContain("0123456789abcdef");
    }
  });

  it("sends what the person DID and never whether it was right", () => {
    const s = json(setScreen(ctx(), "es", { exercises: [ex("choose", { options: ["coffee", "dog"], correct: 0 })], progress: course().progress, mastery: course().mastery }));
    expect(s).toContain('"picked"');
    expect(s).not.toContain('"verdict"');
    expect(s).not.toContain('"correct":0');
  });

  it("says a verdict with the app's own marks, since the palette has no green and no red", () => {
    const s = json(setScreen(ctx(), "es", { exercises: [ex("write")], progress: course().progress, mastery: course().mastery }));
    // statusMark draws an SVG labelled with the mark's own words. `close` is "waiting", not "failed".
    for (const w of ["done", "waiting", "needs you"]) expect(s, w).toContain(w);
    expect(s).not.toMatch(/green|red|#0f0|#f00/i);
  });

  it("words every reason the grader can give, so no English leaves the grader", () => {
    for (const why of ["accent", "spelling", "order", "word", "silence"]) {
      expect(whyWords(why), why).toBeTruthy();
      expect(whyWords(why), why).not.toBe(why);
    }
    expect(whyWords("accent")).toContain("accent");
  });
});
