/**
 * THE BAR A PLACE HAS TO CLEAR TO BECOME A CARD. The feed is worth opening only because most places are not in it.
 *
 *   judge(card, against)  -> { ok, checks }
 *
 * Three things are asked of every card, whoever wrote it:
 *
 *   act        something to DO, at an hour that matters ("before anyone wakes", "kayak in", "at first light")
 *   history    or instead: a past with a date on it — a year, a century
 *   singular   not the same country and the same two leading tags as a card we already have, so the catalogue does
 *              not fill up with nine of the same fort
 *   season     it has months; a place that is no better in March than November has not been thought about
 *
 * A card passes on (act OR history) AND singular AND season. Whitefield fails act and history and gets no card — the
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

/** A year (1066, 1565, the 1600s), or a century said in words. */
const DATED = /\b(\d{3,4}s?\s?(?:BCE|BC|AD|CE)?|\d{1,2}(?:st|nd|rd|th)\s+century)\b/i;

export interface Check {
  name: "act" | "history" | "singular" | "season";
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
  ];

  return { ok: (act || history) && singular && season, checks };
}

/** The checks that failed, for the words on the screen and for the note in the review queue. */
export const failures = (v: Verdict): Check[] => v.checks.filter((c) => !c.pass);
