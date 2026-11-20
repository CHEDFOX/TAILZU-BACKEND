/**
 * THE BAR A PLACE HAS TO CLEAR TO BECOME A CARD. The feed is worth opening only because most places are not in it.
 *
 *   judge(card, against)  -> { ok, checks }
 *
 * Five things are asked of every card, whoever wrote it:
 *
 *   act          something to DO, at an hour that matters ("before anyone wakes", "kayak in", "at first light")
 *   history      or instead: a past with a date on it — a year, a century
 *   singular     not the same country and the same two leading tags as a card we already have, so the catalogue does
 *                not fill up with nine of the same fort
 *   season       it has months; a place that is no better in March than November has not been thought about
 *   exceptional  a moment worth the journey, or somewhere few people have heard of
 *   safe         no standing government Do Not Travel warning over it
 *
 * A card passes on (act OR history) AND singular AND season AND exceptional AND safe.
 *
 * EXCEPTIONAL IS A NUMBER, NOT A FEELING. A place that is beautiful and on every list is exactly what this feed is
 * not: being in it has to mean something. So a card needs either a high `wow` — it is a moment, whoever you are —
 * or a high `rarity` — most people have never heard of it. A photogenic bamboo grove on every itinerary in Japan
 * has neither, and is answered in words rather than given a card.
 *
 * SAFE IS NOT A JUDGEMENT CALL. A feed that says "go here, it is extraordinary" about a Do Not Travel zone is a
 * liability. The warning is written on the card (types.ts) rather than applied by hand, so the card survives the
 * advisory changing and cannot surface while it stands. Whitefield fails act and history and gets no card — the
 * bot still answers the question and still plans the trip. Photographs are not a gate: they can be found for any
 * place worth writing about, and a card with none still shows.
 *
 * This runs on BUILT cards before they are kept, and on ours in the tests, so the two tiers are held to one standard.
 */
import type { Card } from "./types.js";

/** Words that put an act at an hour. Cheap on purpose: the model is asked for the act, this only checks it is there. */
const HOUR = /\b(dawn|sunrise|first light|sunset|dusk|twilight|blue hour|midnight|night|nightfall|morning|evening|midwinter|midsummer|tide|before anyone|before the first|after dark|at six|at five|golden hour|winter|summer|spring|autumn)\b/i;

const ACT = /\b(walk|walks|walking|climb|climbs|climbing|kayak|kayaking|paddle|swim|swimming|dive|ride|riding|drive|driving|hike|hiking|camp|camping|sleep|sleeping|row|sail|ski|watch|watching|stand|standing|cross|crossing|descend|wander)\b/i;

/** The least a moment can be and still be a sentence about one. */
const MOMENT_MIN = 6;

/** A moment worth the journey on its own, whoever you are. */
const WOW_MIN = 0.88;
/** Or: few enough people have heard of it that being shown it is the service. */
const RARITY_MIN = 0.7;

/**
 * COUNTRIES UNDER A STANDING DO NOT TRAVEL WARNING, as ISO 3166-1 alpha-2.
 *
 * A list, not a judgement, and deliberately the blunt instrument: it catches a card nobody marked by hand, and it
 * catches a card the bot BUILT for somebody out of pages it read today — which per-card marking never could,
 * because the builder has no way to know what warning stands over a place.
 *
 * It goes stale. Advisories move and this is a file in a repository, so it wants reviewing; and `advisory` on the
 * card itself is how a region inside an otherwise fine country is handled — Ethiopia is Level 3, Afar is not.
 * Read against US State Department and Australian Smartraveller levels, November 2026.
 */
const DO_NOT_TRAVEL: ReadonlySet<string> = new Set([
  "af", "bf", "by", "cf", "cd", "ht", "ir", "iq", "ly", "ml",
  "mm", "ne", "kp", "ru", "so", "ss", "sd", "sy", "ua", "ve", "ye",
]);

/** A year (1066, 1565, the 1600s), or a century said in words. */
const DATED = /\b(\d{3,4}s?\s?(?:BCE|BC|AD|CE)?|\d{1,2}(?:st|nd|rd|th)\s+century)\b/i;

export interface Check {
  name: "act" | "history" | "singular" | "season" | "exceptional" | "safe";
  pass: boolean;
  /** Said plainly, because screen 6 shows these words to the person. */
  why: string;
}

export interface Verdict {
  ok: boolean;
  checks: Check[];
}

/** The two tags a card leads with, in a stable order, which is what "the same kind of place" means here. */
const leading = (card: Card): string => [...card.tags].slice(0, 2).sort().join("+");

export function judge(card: Card, against: readonly Card[] = []): Verdict {
  const words = `${card.title} ${card.hook} ${card.story}`;
  const moment = card.moment.trim();

  // A moment that was STATED is taken as stated: whoever wrote the card said when the place is itself, and no
  // word list can tell "after the lanterns come on" from "it is nice there" — that is a job for review, not a regex.
  // The prose is read only for a card written before the field existed.
  const act = moment.length >= MOMENT_MIN || (HOUR.test(words) && ACT.test(words));
  const history = card.dated ? DATED.test(card.dated) : DATED.test(words);
  const season = card.season !== 0;

  const twin = against.find((other) => other.slug !== card.slug && other.country === card.country && leading(other) === leading(card));
  const singular = !twin;

  const exceptional = card.wow >= WOW_MIN || card.rarity >= RARITY_MIN;
  const safe = !card.advisory && !DO_NOT_TRAVEL.has(card.country.toLowerCase());

  const checks: Check[] = [
    {
      name: "act",
      pass: act,
      why: act ? "Something to do, at an hour that matters" : "No one thing to do there, at an hour that matters",
    },
    {
      name: "history",
      pass: history,
      why: history ? "A history with dates" : "No history with a date on it",
    },
    {
      name: "singular",
      pass: singular,
      why: singular ? "Not a repeat of one we have" : `Too close to ${twin?.title ?? "a card we already have"}`,
    },
    {
      name: "season",
      pass: season,
      why: season ? "It has months when it is best" : "No months given",
    },
    {
      name: "exceptional",
      pass: exceptional,
      why: exceptional
        ? "A moment worth the journey, or somewhere few have heard of"
        : "Beautiful, but on every list — not a reason to open the app",
    },
    {
      name: "safe",
      pass: safe,
      why: safe ? "No standing travel warning" : "Under a government Do Not Travel warning",
    },
  ];

  return { ok: (act || history) && singular && season && exceptional && safe, checks };
}

/** The checks that failed, for the words on the screen and for the note in the review queue. */
export const failures = (v: Verdict): Check[] => v.checks.filter((c) => !c.pass);
