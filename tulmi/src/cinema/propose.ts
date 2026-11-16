/**
 * WHAT THE BOT THINKS YOU WANT, read from the conversation (docs/cinema.md, the session's card).
 *
 * The person talks; nobody fills in a form. When enough has been said, a cheap model reads the talk and answers with a PROPOSAL - the
 * film in a sentence or two, how many seconds, and what shape - and the session's screen draws it as a card with those already chosen.
 * The person nudges a chip or says what to change; `Create` makes the film from it.
 *
 * Three rules keep it honest:
 *
 *   NOT YET      it says so rather than guessing. One line ("something for my stall") is not a film; the bot asks instead, and no card
 *                is drawn. `ready` false is a normal answer, not a failure.
 *   THEIR WORDS  the length and the shape come from what the person said where they said it ("under half a minute" -> 24s, "for reels"
 *                -> 9:16), and only from the kind of film otherwise. Never a house default dressed up as a choice.
 *   IN RANGE     whatever comes back is clamped here, not trusted: 5 to 180 seconds, a shape we actually make (types.ts ASPECTS), a
 *                concept of a few hundred characters. A model that answers nonsense proposes nothing.
 *
 * Only the words are read. Nothing is made, nothing is charged, and no model that costs real money is asked until `Create`.
 */
import { plain } from "./compile.js";
import type { Think } from "./plan.js";
import { ASPECTS, type Aspect } from "./types.js";

/** The seconds a film may be. The card offers a ladder; anything in between can be asked for in words. */
export const SECONDS_MIN = 5;
export const SECONDS_MAX = 180;
/** The lengths the card offers, with whatever was proposed slotted into its place among them. */
export const LADDER: readonly number[] = [10, 15, 20, 30, 45, 60, 90, 120];
const CONCEPT_MAX = 400;

export interface Proposal {
  /** The film in a sentence or two, as the card shows it. */
  concept: string;
  seconds: number;
  aspect: Aspect;
  /** Why these seconds and this shape, in a few words, when the person said something that decided it. */
  because: string;
}

export const PROPOSE_SYSTEM = `You read a conversation between a person and a film-making bot, and say whether the person has said enough for a film to be made.

Answer with JSON only: {"ready":true|false,"concept":"","seconds":0,"aspect":"16:9|9:16|1:1|4:5|5:4|4:3|3:4|21:9","because":""}

ready is true only when you know WHAT the film shows and WHO or WHAT it is for. A single vague line ("something for my shop", "a video") is not enough: answer ready false and nothing else matters.

concept: the film in one or two plain sentences, as you would describe it back to them - what happens, where, the feeling. Concrete nouns, no empty words (cinematic, stunning, epic). Never promise a shot you were not told about.

seconds: from what they said. "Under half a minute" is not 30: pick what the film needs inside what they said. A single moment is 8 to 15 seconds; an ad with a few beats is 20 to 30; a story with a turn is 45 to 90. Between 5 and 180.

aspect: from where they said it goes. Reels, Shorts, stories, "for the feed on my phone" -> 9:16. Instagram feed, "square" -> 1:1 or 4:5. YouTube, a screen, a TV, a website header -> 16:9. Something wide and filmic -> 21:9. If they did not say, choose by what it is for: an ad for a phone audience is 9:16, anything else 16:9.

because: a few words naming what in their own message decided the length and the shape ("you said under half a minute, and reels"). Empty if they said neither.`;

/** A number of seconds we will actually film. */
export const clampSeconds = (n: unknown): number | null => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.max(SECONDS_MIN, Math.min(SECONDS_MAX, v)) : null;
};

/** The model's answer into a proposal, or null when it is not ready or not usable. Nothing here trusts the model. */
export function readProposal(raw: unknown): Proposal | null {
  let r: Record<string, unknown> = {};
  if (raw && typeof raw === "object") r = raw as Record<string, unknown>;
  else if (typeof raw === "string") {
    try {
      const m = /\{[\s\S]*\}/.exec(raw);
      if (m) r = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (r.ready !== true) return null;
  const concept = plain(typeof r.concept === "string" ? r.concept.trim() : "").slice(0, CONCEPT_MAX);
  if (concept.length < 12) return null;
  const seconds = clampSeconds(r.seconds);
  if (seconds === null) return null;
  const aspect = typeof r.aspect === "string" && (ASPECTS as readonly string[]).includes(r.aspect) ? (r.aspect as Aspect) : "9:16";
  const because = plain(typeof r.because === "string" ? r.because.trim() : "").slice(0, 120);
  return { concept, seconds, aspect, because };
}

/** The lengths the card shows: the ladder, with what was proposed in its place among them. */
export const lengthsFor = (seconds: number): number[] =>
  [...new Set([...LADDER, seconds])].filter((n) => n >= SECONDS_MIN && n <= SECONDS_MAX).sort((a, b) => a - b);

/** Reads the talk so far. `turns` are oldest first, as the session screen shows them. */
export async function propose(think: Think, turns: readonly { role: "me" | "bot"; text: string }[]): Promise<{ proposal: Proposal | null; usd: number }> {
  // Nothing worth reading yet: no model is asked at all, so an opening hello costs nothing.
  const said = turns.filter((t) => t.role === "me").map((t) => t.text).join(" ").trim();
  if (said.length < 12) return { proposal: null, usd: 0 };
  const user = turns.slice(-12).map((t) => `${t.role === "me" ? "THEM" : "BOT"}: ${t.text.slice(0, 600)}`).join("\n");
  const r = await think({ purpose: "cinema.propose", tier: "cheap", system: PROPOSE_SYSTEM, user, maxTokens: 500, capPaise: 40 }).catch(() => null);
  return { proposal: r ? readProposal(r.json ?? r.text) : null, usd: r?.usd ?? 0 };
}
