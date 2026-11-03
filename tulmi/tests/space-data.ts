/**
 * Your space, as routes/bots/botsYouSpace.ts answers it for one person: Aanya, who talks to Plan Ease, Travel, Xode and her own Gym bot.
 * The screens' tests and the render samples (scripts/bots-render) read these.
 */
import { FIXED_NOW } from "../src/experience/bots/fixtures.js";
import type { SectionView, SpaceLine, SpaceOverview } from "../src/experience/bots/screens/you/space.js";

const H = 3_600_000, D = 24 * H;
const NOW = FIXED_NOW;

const line = (key: string, text: string, section: SpaceLine["section"], from: string[], ago: number, o: { pinned?: boolean; forAll?: boolean } = {}): SpaceLine =>
  ({ key, text, section, from, forAll: o.forAll ?? true, at: NOW - ago, pinned: o.pinned ?? false });

export const LINES: SpaceLine[] = [
  line("a1b2c3d4e5f6", "Prefers short replies, in English with a little Hindi", "likes", ["Plan Ease", "Travel"], 2 * H, { pinned: true }),
  line("b1b2c3d4e5f6", "Goes to the gym at 6:30 am on weekdays", "day", ["Gym bot"], 5 * H),
  line("c1b2c3d4e5f6", "Her sister Meera lives in Pune", "people", ["Travel"], D + 3 * H),
  line("d1b2c3d4e5f6", "Works as a product designer at a fintech startup", "work", ["Xode", "Plan Ease"], 2 * D),
  line("e1b2c3d4e5f6", "Lives in Indiranagar, Bangalore", "places", ["Plan Ease"], 3 * D),
  line("f1b2c3d4e5f6", "Vegetarian, loves South Indian breakfast", "likes", ["Travel"], 4 * D),
  line("a2b2c3d4e5f6", "Speaks Kannada, Hindi and English", "about", [], 6 * D),
  line("a3b2c3d4e5f6", "Pays rent on the 5th of every month", "money", ["Plan Ease"], 9 * D, { forAll: false }),
  line("a4b2c3d4e5f6", "Her dad's birthday is on 14 March", "people", ["Plan Ease"], 12 * D),
];

export const SPACE: SpaceOverview = {
  on: true, total: LINES.length,
  sections: [
    { id: "about", name: "About you", count: 1, peek: "Speaks Kannada, Hindi and English", off: false },
    { id: "day", name: "Your day", count: 4, peek: "Goes to the gym at 6:30 am on weekdays", off: false },
    { id: "people", name: "People", count: 4, peek: "Her sister Meera lives in Pune", off: false },
    { id: "places", name: "Places", count: 3, peek: "Lives in Indiranagar, Bangalore", off: false },
    { id: "likes", name: "Likes", count: 2, peek: "Prefers short replies, in English with a little Hindi", off: false },
    { id: "money", name: "Money", count: 1, peek: "Pays rent on the 5th of every month", off: true },
    { id: "work", name: "Work", count: 3, peek: "Works as a product designer at a fintech startup", off: false },
    { id: "bots", name: "Bots", count: 4, peek: "Plan Ease, Travel, Xode", off: false },
    { id: "files", name: "Files & notes", count: 6, peek: "Design review with Kabir", off: false },
    { id: "timeline", name: "Timeline", count: LINES.length, peek: "Prefers short replies, in English with a little Hindi", off: false },
  ],
};

const of = (id: SectionView["id"], o: Partial<SectionView>): SectionView => ({
  id, name: SPACE.sections.find((s) => s.id === id)!.name, line: "", use: true, canAdd: true, on: true, lines: [], things: [], ...o,
});

export const SECTIONS: Record<string, SectionView> = {
  about: of("about", { line: "Who you are, and how you like to be talked to.", lines: LINES.filter((l) => l.section === "about"), me: { name: "Aanya Sharma", gender: "female" }, groups: [{ id: "s1", name: "Sharma family" }, { id: "s2", name: "Flat 4B" }] }),
  day: of("day", {
    line: "Your routine, and what's on next.", lines: LINES.filter((l) => l.section === "day"),
    things: [
      { kind: "event", ref: "e:1", title: "Design review with Kabir", line: "Event", at: NOW + 3 * H },
      { kind: "event", ref: "e:2", title: "Dinner at Meera's", line: "Event", at: NOW + D + 9 * H },
      { kind: "todo", ref: "t:1", title: "Book the Pune cab", line: "To-do", at: null },
    ],
  }),
  people: of("people", {
    line: "The people in your life, and your groups.", lines: LINES.filter((l) => l.section === "people"),
    things: [{ kind: "group", ref: "s1", title: "Sharma family", line: "Mom, Dad, Meera", at: null }, { kind: "group", ref: "s2", title: "Flat 4B", line: "Rohan, Ishita", at: null }],
  }),
  money: of("money", { line: "Only the bot you told keeps these. Your other bots never see them.", use: false, canAdd: false, lines: LINES.filter((l) => l.section === "money") }),
  timeline: of("timeline", { line: "Everything your bots learned, newest first.", use: null, canAdd: false, lines: [...LINES].sort((a, b) => b.at - a.at) }),
};

/** The answers, by "METHOD path", for fakeDeps and the render samples. */
export const SPACE_API: Record<string, unknown> = {
  "GET /v1/bots/you/space": SPACE,
  ...Object.fromEntries(Object.entries(SECTIONS).map(([id, v]) => [`GET /v1/bots/you/space/${id}`, v])),
};
