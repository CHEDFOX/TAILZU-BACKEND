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
  LINGO_SCREENS, doneScreen, leaving, picker, saidScreen, setScreen, territory, whyScreen, whyWords,
  type CourseView, type PickerData, type SetData,
} from "../src/experience/bots/screens/bots/lingoPage.js";
import { freshMemory } from "../src/lingo/schedule.js";
import { UNITS } from "../src/lingo/course.js";
import type { Exercise } from "../src/lingo/session.js";
import { EXERCISE_KINDS, type ExerciseKind } from "../src/lingo/types.js";

const live = sampleLive();
const ctx = (client: "phone" | "desktop" = "phone") => ctxFor(SCREENS.lingo, client, live);
/** A build that draws the living bot and plays the catalog's moments; the plain `ctx` above is one that draws neither. */
const ALIVE = new Set(["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"]);
const livelyCtx = (client: "phone" | "desktop" = "phone") => ctxFor(SCREENS.lingo, client, live, { can: ALIVE });
const buddies = (n: Node[]): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") {
      const node = x as { type?: string; props?: Record<string, unknown> };
      if (node.type === "BotBuddy") out.push(node.props ?? {});
      Object.values(x as Record<string, unknown>).forEach(walk);
    }
  };
  walk(n);
  return out;
};

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
      expect(clean(territory(livelyCtx(client), { courses: [course()] })), `${client} alive`).toEqual([]);
      expect(clean(picker(c, { from: "en", fromName: "English", suggested: [{ tag: "es", name: "Español", en: "Spanish" }], languages: [{ tag: "ta", name: "தமிழ்", en: "Tamil" }] })), client).toEqual([]);
      expect(clean(leaving(c, "es", "Español")), client).toEqual([]);
      expect(clean(whyScreen(c, "es", "Español")), `${client} why`).toEqual([]);
      // EVERY kind, from the list itself and not a copy of it: a kind added without a screen to draw it would
      // otherwise reach a person as a blank page, and the copy would go on passing.
      for (const k of EXERCISE_KINDS) {
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

  it("is seven screens, and Lingo's tile in the bots list opens the first of them", () => {
    expect(LINGO_SCREENS.map((s) => s.id)).toEqual([SCREENS.lingo, SCREENS.lingoAdd, SCREENS.lingoSet, SCREENS.lingoWhy, SCREENS.lingoDone, SCREENS.lingoSaid, SCREENS.lingoLeave]);
    expect(botRoute("lingo")).toMatchObject({ kind: "navigate", screenId: SCREENS.lingo });
    // A bot with no page of its own still goes to the shared one.
    expect(botRoute("gym-bot")).toMatchObject({ kind: "navigate", screenId: SCREENS.bot, params: { slug: "gym-bot" } });
  });
});

describe("Lingo in the bots list", () => {
  it("appears on Home once the platform lists it, beside the five that always show", async () => {
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
    expect(model.bots.slice(0, 5).map((b) => b.slug)).toEqual(["code", "keybot", "plan", "travel", "talk"]);
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

  it("puts Lingo itself at the top, alive, instead of a heading", () => {
    const n = territory(livelyCtx(), { courses: [course()] });
    const [bot, ...rest] = buddies(n);
    expect(rest).toEqual([]);
    expect(bot?.life).toBe("page.lingo");
    // The first thing on the page is the bot, not a title: the back bar already says Lingo.
    expect((n[0] as { type?: string }).type).toBe("BotBuddy");
    expect(json(n)).not.toContain("Your languages");
  });

  it("mutters while a word is due anywhere and hums once nothing is", () => {
    const quiet = course({ progress: { items: 8, learned: 0, due: 0, unseen: 0, held: 0.5 } });
    expect(buddies(territory(livelyCtx(), { courses: [course()] }))[0]?.moment).toBe("l.mutter");
    expect(buddies(territory(livelyCtx(), { courses: [quiet] }))[0]?.moment).toBe("l.hum");
    // One language with nothing due does not quieten it while another still has words waiting.
    expect(buddies(territory(livelyCtx(), { courses: [quiet, course()] }))[0]?.moment).toBe("l.mutter");
    expect(buddies(territory(livelyCtx(), { courses: [course()] }))[0]?.momentMode).toBe("loop");
  });

  it("gives a build that cannot draw him the words instead, so the page is never headless", () => {
    const n = territory(ctx(), { courses: [course()] });
    expect(buddies(n)).toEqual([]);
    expect(json(n)).toContain("Your languages");
  });
});

describe("the new rungs draw with nodes every build already has", () => {
  it("draws a reply as a list of things you could say, and never says which is right", () => {
    const data: SetData = {
      exercises: [ex("reply", { prompt: "a coffee please", options: ["un café por favor", "la cuenta por favor", "buenos días"] })],
      progress: course().progress, mastery: course().mastery,
    };
    const s = json(setScreen(ctx(), "es", data));
    expect(s).toContain("What would you say?");
    expect(s).toContain("un café por favor");
    expect(s).not.toContain("correct");
  });

  it("asks for the whole thing out loud for speak, and for something of their own for talk", () => {
    const one = (k: ExerciseKind) => json(setScreen(ctx(), "es", {
      exercises: [ex(k, { prompt: "coffee", spoken: true })], progress: course().progress, mastery: course().mastery,
    }));
    expect(one("say")).toContain("Say it out loud");
    expect(one("speak")).toContain("Say the whole thing out loud");
    expect(one("talk")).toContain("Say something that uses it");
    // All three take a voice, and none of them puts the answer on the screen.
    for (const k of ["say", "speak", "talk"] as ExerciseKind[]) {
      expect(one(k), k).toContain("Hold to speak");
      expect(one(k), k).not.toContain("café");
    }
  });
});

describe("what the language is for", () => {
  it("asks once, as the language is added, and never makes them answer", () => {
    const n = whyScreen(ctx(), "es", "Español");
    const s = json(n);
    expect(s).toContain("What's Español for?");
    // Seven reasons, none of them a country or a region, and the same seven for every language.
    for (const w of ["Someone I love", "A trip", "Living there", "Work", "My family speaks it", "Studying it", "Just because"]) {
      expect(s, w).toContain(w);
    }
    // Their own words matter more than the code, so there is a real box for them, not a picture of one.
    const fields: Array<{ bind?: { value?: string } }> = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === "object") {
        if ((x as { type?: string }).type === "TextField") fields.push(x as { bind?: { value?: string } });
        Object.values(x as Record<string, unknown>).forEach(walk);
      }
    };
    walk(n);
    expect(fields.length).toBe(1);
    expect(fields[0]?.bind?.value).toBe("note");
    // Skip is one tap and still starts the course.
    expect(s).toContain("Skip");
    expect(s).toContain("/v1/lingo/course");
  });

  it("is where picking a language goes, instead of straight into a set with nothing in it", () => {
    const s = json(picker(ctx(), { from: "en", fromName: "English", suggested: [{ tag: "es", name: "Español", en: "Spanish" }], languages: [] }));
    expect(s).toContain(SCREENS.lingoWhy);
    expect(s).not.toContain(SCREENS.lingoSet);
  });
});

describe("which language it is taught in", () => {
  it("lets them pick the language they speak, instead of handing them English", () => {
    // Every meaning in every exercise is written in this language. Deciding it for somebody because nobody asked is
    // the one assumption this app does not make.
    const n = whyScreen(ctxFor(SCREENS.lingoWhy, "phone", live, { params: { target: "es", name: "Español" } }), "es", "Español");
    const s = json(n);
    expect(s).toContain("Taught in");
    expect(s).toContain(SCREENS.lingoAdd);
    expect(s).toContain('"pick":"from"');
  });

  it("sends the one they picked, and shows it by name", () => {
    const ctxWith = ctxFor(SCREENS.lingoWhy, "phone", live, { params: { target: "es", name: "Español", from: "hi", fromName: "हिन्दी" } });
    const s = json(whyScreen(ctxWith, "es", "Español"));
    expect(s).toContain("हिन्दी");
    expect(s).toContain('"from":"hi"');
  });

  it("asks the picker the other way round, and picking goes back with the answer", () => {
    const asking = ctxFor(SCREENS.lingoAdd, "phone", live, { params: { pick: "from", target: "es", name: "Español" } });
    const s = json(picker(asking, { from: null, fromName: null, suggested: [], languages: [{ tag: "hi", name: "हिन्दी", en: "Hindi" }] }));
    expect(s).toContain("Which language do you speak?");
    // It must not start a course: it carries the answer back to the question that does.
    expect(s).toContain(SCREENS.lingoWhy);
    expect(s).toContain('"from":"hi"');
    expect(s).toContain('"target":"es"');
  });
});

describe("a course with nothing in it", () => {
  const bare = { items: 0, learned: 0, due: 0, unseen: 0, held: 0 };

  it("does not tell somebody they are up to date on a language they cannot speak", () => {
    const s = json(setScreen(ctx(), "es", { exercises: [], progress: bare, mastery: course().mastery }));
    expect(s).not.toContain("Nothing due");
    expect(s).toContain("Nothing to learn yet");
    // The way out is the one thing that always works, whatever the shared bank has in it.
    expect(s).toContain(SCREENS.chat);
  });

  it("still says nothing is due when they have met things and are holding them", () => {
    const held = { items: 20, learned: 3, due: 0, unseen: 0, held: 0.9 };
    const s = json(setScreen(ctx(), "es", { exercises: [], progress: held, mastery: course().mastery }));
    expect(s).toContain("Nothing due");
    expect(s).not.toContain("Nothing to learn yet");
  });

  /**
   * THE CARD STILL OPENS THE LESSON. Opening one is what makes the first unit for the pair, so a card that sent an
   * empty course anywhere else was the reason a new language never got any lessons: the only screen that builds the
   * first unit was the only screen the card would not open.
   */
  it("sends them to the lesson, which is what makes their first one", () => {
    const s = json(territory(ctx(), { courses: [course({ progress: bare })] }));
    expect(s).toContain("Start learning");
    expect(s).toContain(SCREENS.lingoSet);
    expect(s).toContain("no words yet");
    // "0% of what you've met" is a measurement of nothing, drawn as though it were a fact about them.
    expect(s).not.toContain("you'd still have now");
    expect(s).not.toContain("Practise anyway");
    expect(s).not.toContain("nothing due");
  });

  /**
   * A THIRD EMPTY, and the only one that ends by itself: the unit for this pair is being written this moment. Told
   * "nothing due" they would think they were finished; told "nothing to learn yet" they would go and talk to it for
   * no reason. Both were wrong for the ten seconds that matter most, which are somebody's first ten.
   */
  const waiting: SetData = { exercises: [], progress: bare, mastery: course().mastery, building: true };

  it("says the first lesson is being got ready, rather than that there is nothing", () => {
    const s = json(setScreen(livelyCtx(), "es", waiting));
    expect(s).toContain("Getting your first lesson ready");
    expect(s).not.toContain("Nothing to learn yet");
    expect(s).not.toContain("Nothing due");
  });

  /**
   * NOTHING TO PRESS AND NOTHING TO READ. A button that only means "ask again" makes somebody who is already
   * waiting do the waiting's work, and our model call is ours to carry, not theirs to read about.
   */
  it("gives them nothing to press and no explanation to read", () => {
    const s = json(setScreen(livelyCtx(), "es", waiting));
    expect(s).not.toContain("Check again");
    expect(s).not.toContain('"refresh"');
    expect(s, "no talk of pairs of languages, or of how long a model takes").not.toContain("pair of languages");
    expect(s).not.toContain("Talk to Lingo");
  });

  /** Lingo mutters over it — its own idling, and exactly what is happening — until the unit lands. */
  it("has Lingo working over it on a loop, not a still pose", () => {
    const bot = buddies(setScreen(livelyCtx(), "es", waiting))[0];
    expect(bot, "the waiting screen is the bot, not an empty state").toBeTruthy();
    expect(bot).toMatchObject({ state: "working" });
    expect(JSON.stringify(bot)).toContain("l.mutter");
    expect(JSON.stringify(bot)).toContain("loop");
  });

  /** A build that cannot draw him still says what is happening rather than drawing nothing. */
  it("still says it on a build with no living bot", () => {
    const s = json(setScreen(ctx(), "es", waiting));
    expect(s).toContain("Getting your first lesson ready");
    expect(s).not.toContain("Check again");
  });

  /**
   * AND IT ENDS BY ITSELF. The screen with no button on it only works because it is listening: the server says when
   * the unit has settled (src/live/topics.ts) and the open screen reloads into the first exercise. A set in progress
   * must NOT listen — a live event mid-exercise would pull the question out from under somebody — so the topic is
   * named while it waits and at no other time.
   */
  const setDef = LINGO_SCREENS.find((sc) => sc.id === SCREENS.lingoSet)!;
  const built = (data: SetData) => setDef.build(ctxFor(SCREENS.lingoSet, "phone", live, { params: { target: "es" } }), data);

  it("listens for the unit to land, so it needs nothing pressed", () => {
    expect(built(waiting).liveTopics).toContain("lingo:es");
  });

  it("stops listening the moment there is a set to do", () => {
    const going: SetData = { exercises: [ex("choose", { options: ["coffee", "dog"], correct: 0 })], progress: course().progress, mastery: course().mastery };
    expect(built(going).liveTopics ?? []).not.toContain("lingo:es");
    expect(built({ ...waiting, building: false }).liveTopics ?? []).not.toContain("lingo:es");
  });
});

/**
 * A SET IS WALKED, AND IT ENDS. It used to be one exercise and a refresh: the counter read "1 of 12" for ever, no
 * set ever ended, and everything that hangs off the end of one — the gesture, the shape of the next set, finishing
 * a unit — was server-side work nothing ever asked for.
 */
describe("a set, from the first exercise to the last", () => {
  const three = [ex("choose", { options: ["coffee", "dog"], correct: 0 }), ex("write"), ex("say")];
  const set = (): SetData => ({ exercises: three, progress: course().progress, mastery: course().mastery });

  it("holds the whole set and draws the one they are on", () => {
    const s = json(setScreen(ctx(), "es", set()));
    // Each exercise is in the tree behind its own place in the set, so moving on is not a trip to the server.
    // THE PATH IS BARE. Both clients prefix it themselves, so "$state.i" is looked up as "$state.$state.i",
    // comes back undefined, and every step hides: the screen drew nothing at all. lint.ts says so now.
    for (const i of [0, 1, 2]) expect(s, `step ${i}`).toContain(`"eq":["i",${i}]`);
    expect(s, "and never the prefixed form").not.toContain('"eq":["$state.');
    expect(s).toContain("1 of 3");
    expect(s).toContain("3 of 3");
    expect(s).toContain('"incrementState","path":"i"');
  });

  it("asks the server once, at the end, and sends nothing but which course", () => {
    const s = json(setScreen(ctx(), "es", set()));
    expect(s).toContain("Finish");
    expect(s).toContain('"path":"/v1/lingo/set"');
    // The app reports no answers at all: every verdict is the server's own, written as it was marked.
    expect(s).not.toContain('"answers"');
    expect(s).not.toContain('"verdict"');
  });

  it("celebrates only when the server says to, and goes where the server points", () => {
    const s = json(setScreen(ctx(), "es", set()));
    expect(s).toContain('"truthy":"done.gesture.cheer"');
    expect(s).toContain('"confetti"');
    // A finished unit goes to the celebration; anything else goes straight into the next set, shaped by this one.
    expect(s).toContain('"truthy":"done.finished"');
    expect(s).toContain(SCREENS.lingoDone);
    expect(s).toContain('"shape":"$state.done.next"');
  });

  it("every step passes the kit's own check", () => {
    for (const client of ["phone", "desktop"] as const) {
      expect(clean(setScreen(ctx(client), "es", set())), client).toEqual([]);
    }
  });
});

describe("finishing a unit", () => {
  const d = { unit: "food", goal: "You can order food and drink.", mark: "celebrate", at: 6, of: 24,
    canDo: ["You can greet someone.", "You can say who you are.", "You can order food and drink."] };

  /**
   * THE NEXT UNIT IS BEING WRITTEN WHILE THIS IS ON SCREEN. So Continue is not drawn yet and the moment LOOPS: the
   * seconds a model takes are spent being congratulated, instead of at the start of the next session in front of a
   * screen with nothing on it. Stop for now stays, because waiting must never be a room with no door.
   */
  it("holds Continue back while the next unit is written, and keeps him going", () => {
    const waiting = json(doneScreen(livelyCtx(), d, "es", { ready: false }));
    expect(waiting).not.toContain("Keep going");
    expect(waiting).toContain("Stop for now");
    expect(waiting).toContain('"loop"');
    const ready = json(doneScreen(livelyCtx(), d, "es", { ready: true }));
    expect(ready).toContain("Keep going");
    expect(ready).toContain(SCREENS.lingoSet);
  });

  it("listens for the next unit only while it is being written", () => {
    const def = LINGO_SCREENS.find((sc) => sc.id === SCREENS.lingoDone)!;
    const built = (data: { ready: boolean }) => def.build(ctxFor(SCREENS.lingoDone, "phone", live, { params: { target: "es", done: d } }), data);
    expect(built({ ready: false }).liveTopics).toContain("lingo:es");
    expect(built({ ready: true }).liveTopics ?? []).not.toContain("lingo:es");
  });

  it("says what they can DO, not what they scored", () => {
    const s = json(doneScreen(livelyCtx(), d, "es"));
    expect(s).toContain("You can order food and drink.");
    expect(s).toContain("Unit 6 of 24");
    // Everything they could already do, so the list getting longer is the reward.
    expect(s).toContain("You can greet someone.");
    expect(s).not.toMatch(/\bXP\b|points|score/i);
  });

  it("plays THIS unit's gesture, so the first and the fourteenth do not feel the same", () => {
    const buddy = buddies(doneScreen(livelyCtx(), d, "es"))[0];
    expect(buddy?.moment).toBe("celebrate");
    const other = buddies(doneScreen(livelyCtx(), { ...d, mark: "l.earcup" }, "es"))[0];
    expect(other?.moment).toBe("l.earcup");
  });

  it("borrows no other bot's props", () => {
    // juggle is Xode's binary digits and w.wave is the Wanderer's poncho: either would put another bot's things
    // in Lingo's hands, which is the one rule the look of these bots has.
    for (const u of UNITS) expect(["juggle", "w.wave"], u.key).not.toContain(u.mark);
  });

  it("carries on into the next set rather than dropping them at the front", () => {
    const s = json(doneScreen(livelyCtx(), d, "es"));
    expect(s).toContain("Keep going");
    expect(s).toContain(SCREENS.lingoSet);
    expect(s).toContain('"target":"es"');
  });

  it("holds up for the very first unit, where there is nothing earlier", () => {
    const first = { ...d, unit: "hello", at: 1, canDo: ["You can greet someone."] };
    const s = json(doneScreen(livelyCtx(), first, "es"));
    expect(s).toContain("Unit 1 of 24");
    expect(s).not.toContain("And already");
  });
});

describe("asking from anywhere, without losing your place", () => {
  const built = (id: string, params: Record<string, string>) => {
    const screen = LINGO_SCREENS.find((x) => x.id === id)!;
    return JSON.stringify(screen.build(ctxFor(id, "phone", live, { params }), undefined as never));
  };

  it("puts the ask box on every screen where there is a language to ask about", () => {
    // The moment somebody wants a word is the moment they are using the language — including mid-set.
    for (const [id, params] of [
      [SCREENS.lingo, {}],
      [SCREENS.lingoSet, { target: "es" }],
      [SCREENS.lingoSaid, { target: "es", say: "x", means: "y" }],
    ] as Array<[string, Record<string, string>]>) {
      expect(built(id, params), id).toContain("How do you say");
      expect(built(id, params), id).toContain("/v1/lingo/ask");
    }
  });

  it("does not offer it before the course exists, where it could only fail", () => {
    // Setting a language up, or choosing one: there is nothing yet to ask a question against, and an ask box that
    // answers "that course has not been started" is worse than no ask box.
    for (const [id, params] of [
      [SCREENS.lingoWhy, { target: "es", name: "Español" }],
      [SCREENS.lingoAdd, {}],
    ] as Array<[string, Record<string, string>]>) {
      expect(built(id, params), id).not.toContain("/v1/lingo/ask");
    }
  });

  it("sends them back to the set they asked from, not to the front", () => {
    const s = built(SCREENS.lingoSet, { target: "es" });
    expect(s).toContain(SCREENS.lingoSaid);
    expect(s).toContain(`"back":"${SCREENS.lingoSet}"`);
  });

  it("leads with the thing to say, and says it is already theirs", () => {
    const n = saidScreen(ctx(), { say: "estoy lleno", means: "I'm full", note: "After a meal.", target: "es", back: SCREENS.lingoSet });
    const s = json(n);
    expect(s).toContain("estoy lleno");
    expect(s).toContain("I'm full");
    expect(s).toContain("After a meal.");
    // They should not be left wondering whether to write it down themselves.
    expect(s).toContain("Added to your words");
    // Continue goes back to the set, carrying which language, so a word looked up mid-lesson costs nothing.
    expect(s).toContain(SCREENS.lingoSet);
    expect(s).toContain('"target":"es"');
  });

  it("leaves the note out rather than filling it", () => {
    const s = json(saidScreen(ctx(), { say: "hola", means: "hello", note: "", target: "es", back: SCREENS.lingo }));
    expect(s).toContain("hola");
    expect(s).not.toContain("Notice");
  });
});

describe("the picker", () => {
  it("has a search box that can actually be typed in, not a picture of one", () => {
    const n = picker(ctx(), { from: "en", fromName: "English", suggested: [], languages: [{ tag: "ta", name: "\u0ba4\u0bae\u0bbf\u0bb4\u0bcd", en: "Tamil" }] });
    const fields: Array<Record<string, unknown>> = [];
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === "object") {
        const node = x as { type?: string };
        if (node.type === "TextField") fields.push(x as Record<string, unknown>);
        Object.values(x as Record<string, unknown>).forEach(walk);
      }
    };
    walk(n);
    expect(fields.length, "one field to type the search into").toBe(1);
    expect((fields[0] as { bind?: { value?: string } }).bind?.value).toBe("q");
    // A binding drawn as words is the bug this is here for: it ships the string "$state.q" in the box.
    expect(json(n)).not.toContain('"content":"$state.q"');
    // Enter asks the server again, because the list of languages is the server's and never ships in the app.
    expect(json(n)).toContain(SCREENS.lingoAdd);
  });

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
