/**
 * THE PATH: WHAT EVERY COURSE TEACHES, IN WHAT ORDER.
 *
 * A bag of words is not a course. A course is a path with a place on it: you know what you are learning, why, what
 * you can do once it is done, and what comes next. This is that path, and it is the same path for every pair of
 * languages in the world.
 *
 * WHY THE PATH IS UNIVERSAL AND THE CONTENT IS NOT. Writing a course for a pair of languages is months of work, and
 * there are more pairs than anybody will ever write. But the ORDER is not the hard part and it barely differs:
 * everybody needs hello before they need the past tense, and ordering food before arguing about politics. So the
 * order, the goals and the shape of each unit are written once, here, in no language at all — and what fills them
 * is made for the pair when the first person on that pair reaches it, and kept for everybody after (lessons.ts).
 *
 * WHAT A UNIT IS. A thing you can DO at the end of it, in plain words, in the second person: "you can order food and
 * drink, and say what you do not want". Not a grammar heading. Somebody who finishes a unit should be able to say
 * what they can now do that they could not do an hour ago, and a unit that cannot be written that way is not a unit.
 *
 * `about` is what the unit needs to cover, and it is the brief handed to whatever makes the content: it is read by a
 * model, so it is written for one — plain, specific, and about meaning rather than about words.
 */
import type { Level } from "./types.js";

export interface Unit {
  /** Stable, and never translated: it is a key in a table and in a learner's row. */
  key: string;
  /** What they can DO at the end of it, in their own language, second person. Shown to them. */
  goal: string;
  /** The brief for whatever fills the unit for a pair. Never shown to anybody. */
  about: string;
  level: Level;
  /** Roughly how many things this unit is made of. Short units early: finishing one is the point. */
  size: number;
}

/**
 * THE UNITS, in order. The first six are deliberately tiny — somebody should finish something on the first day —
 * and they get longer as the person gets further, because by then finishing is no longer the thing that is hard.
 *
 * Nothing here is about a country, and nothing assumes what somebody already speaks.
 */
export const UNITS: readonly Unit[] = [
  { key: "hello", level: "a1", size: 8, goal: "You can greet someone and say goodbye.",
    about: "Greetings and goodbyes at different times of day, and the polite words that go with them." },
  { key: "you", level: "a1", size: 8, goal: "You can say who you are and ask who someone else is.",
    about: "Giving your name, asking someone theirs, saying where you are from and asking the same back." },
  { key: "yesno", level: "a1", size: 8, goal: "You can say yes, no, please and thank you, and apologise.",
    about: "Yes, no, please, thank you, sorry, excuse me, and the short answers people actually give." },
  { key: "lost", level: "a1", size: 10, goal: "You can say you did not understand, and ask for it again.",
    about: "Saying you don't understand, asking someone to repeat or slow down, asking how to say something, and asking whether they speak your language." },
  { key: "numbers", level: "a1", size: 12, goal: "You can count, say how many, and ask what something costs.",
    about: "Numbers to a hundred, how much, how many, and the words for money and paying." },
  { key: "food", level: "a1", size: 14, goal: "You can order food and drink, and say what you do not want.",
    about: "Ordering in a cafe or restaurant, asking for the bill, saying you would like something, and saying you cannot eat something." },

  { key: "where", level: "a1", size: 14, goal: "You can ask where something is and follow the answer.",
    about: "Asking where a place is, left, right, straight on, near, far, and the names of everyday places." },
  { key: "time", level: "a1", size: 14, goal: "You can say when something happens.",
    about: "Telling the time, days of the week, today, tomorrow, yesterday, and making an arrangement to meet." },
  { key: "people", level: "a1", size: 14, goal: "You can talk about your family and the people around you.",
    about: "Family members, friends, who someone is to you, and saying how many people there are." },
  { key: "home", level: "a1", size: 14, goal: "You can say where you live and what it is like.",
    about: "Where you live, the rooms and things in a home, and saying what a place is like." },
  { key: "day", level: "a2", size: 16, goal: "You can describe an ordinary day.",
    about: "Waking, eating, working, going out, coming home: the verbs of a normal day in the present." },
  { key: "liking", level: "a2", size: 14, goal: "You can say what you like, want and need.",
    about: "Liking, not liking, preferring, wanting, needing, and asking someone else what they like." },

  { key: "past", level: "a2", size: 18, goal: "You can say what you did.",
    about: "Talking about finished events in the past: what you did yesterday, where you went, what happened." },
  { key: "plans", level: "a2", size: 16, goal: "You can say what you are going to do.",
    about: "Talking about the future: plans, intentions, what is going to happen, and arranging something with someone." },
  { key: "feel", level: "a2", size: 14, goal: "You can say how you feel and ask after someone.",
    about: "Feelings and states: tired, happy, ill, worried, and asking someone how they are and meaning it." },
  { key: "body", level: "a2", size: 14, goal: "You can say something is wrong and get help.",
    about: "Parts of the body, saying something hurts, asking for a doctor or a chemist, and an emergency." },
  { key: "travel", level: "a2", size: 16, goal: "You can get yourself from one place to another.",
    about: "Tickets, trains, buses, airports, asking what time something leaves, and a place to stay." },
  { key: "shops", level: "a2", size: 14, goal: "You can buy what you need and say what is wrong with it.",
    about: "Shopping, sizes, colours, trying something on, asking for something else, and returning something." },

  { key: "work", level: "b1", size: 16, goal: "You can talk about what you do.",
    about: "Work and study: what you do, where, how long for, and asking someone the same." },
  { key: "stories", level: "b1", size: 18, goal: "You can tell someone what happened to you.",
    about: "Telling a story: joining events, saying what was happening when something else happened, and reacting to someone else's story." },
  { key: "opinion", level: "b1", size: 16, goal: "You can say what you think and agree or disagree.",
    about: "Giving an opinion, agreeing, disagreeing politely, and saying why you think something." },
  { key: "ifs", level: "b1", size: 16, goal: "You can talk about what would happen.",
    about: "Conditions and consequences: if this, then that, and what you would do." },
  { key: "polite", level: "b1", size: 14, goal: "You can ask for something awkward without being rude.",
    about: "Softening a request, asking permission, complaining politely, and saying no to someone kindly." },
  { key: "longtalk", level: "b2", size: 18, goal: "You can keep a conversation going without it drying up.",
    about: "Holding a conversation: asking a question back, changing the subject, buying yourself time to think, and the small words people use to keep talking." },
];

export const FIRST_UNIT = UNITS[0]!.key;

export const unitOf = (key: string): Unit | undefined => UNITS.find((u) => u.key === key);
export const unitAt = (i: number): Unit | undefined => UNITS[i];
export const indexOf = (key: string): number => UNITS.findIndex((u) => u.key === key);

/** The unit after this one, or null at the end of the path. */
export function after(key: string): Unit | null {
  const i = indexOf(key);
  return i < 0 ? UNITS[0]! : (UNITS[i + 1] ?? null);
}

/** Where somebody is, as "3 of 24", for a screen to show. */
export const placeOf = (key: string): { at: number; of: number } => ({ at: Math.max(1, indexOf(key) + 1), of: UNITS.length });

/**
 * HAS THIS UNIT BEEN DONE? Not "were its items shown" — whether the person can now do the thing the goal says.
 *
 * A unit is done when most of what it taught is HELD and has been SAID. Most, not all: one stubborn word must not
 * hold somebody at unit 3 for a fortnight, and the word is not lost by moving on — the scheduler keeps asking for
 * it wherever they are. Saying it is required because the goal is always something you can say, never something
 * you can recognise.
 */
export const DONE_SHARE = 0.75;

export function unitDone(items: readonly { unit?: string; spoken: number }[], unit: string, held: (i: { unit?: string }) => number): boolean {
  const mine = items.filter((i) => i.unit === unit);
  if (!mine.length) return false;
  const have = mine.filter((i) => i.spoken > 0 && held(i) >= 0.8).length;
  return have / mine.length >= DONE_SHARE;
}
