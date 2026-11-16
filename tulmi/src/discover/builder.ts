/**
 * BUILDING A CARD FOR A PLACE SOMEBODY SEARCHED, END TO END.
 *
 *   const b = builder({ resolve, research, call, photos })
 *   await b.build("hampi", { userId, against })   -> Built
 *
 * Five steps, and the order is the honesty:
 *
 *   1. RESOLVE   the words become one point (src/places), so "hampi" and "Hampi, Karnataka" are never two cards
 *   2. READ      src/web/research reads several pages and answers with CITED sources
 *   3. FILL      the model fills the card's slots FROM THAT ANSWER, and from nothing else
 *   4. JUDGE     parseBuilt checks every slot; bar.ts asks whether it belongs in a feed at all
 *   5. LOOK      photographs from Commons, each with its licence and its credit
 *
 * THE MODEL NEVER SUPPLIES THE SOURCES. They are taken from the pages the researcher actually read and cited, with
 * the day they were read, and handed to parseBuilt. A model asked for its own citations will write plausible ones;
 * this way a source on a card is a page that was really fetched, really today.
 *
 * Nor does the model place the point, name the country, or decide whether the card is kept: the geocoder settles
 * where, and bar.ts settles whether. It fills words into slots, which is the one thing it is good at.
 *
 * Every step can fail softly. No geocoder, no research, no model, no photographs — each gives back a plain reason
 * the Travel bot can say out loud, never a half-built card.
 */
import { z } from "zod";
import type { CallFn } from "./deps.js";
import { judge } from "./bar.js";
import { parseBuilt, type Built, type Resolved } from "./build.js";
import type { Card, Photo, Source } from "./types.js";
import { TAGS } from "./taxonomy.js";

/** What the model is asked for. The sources are NOT in here on purpose (see the note above). */
const Slots = z.object({
  title: z.string().min(8).max(70),
  hook: z.string().min(20).max(120),
  moment: z.string().max(90),
  dated: z.string().max(140).nullable().optional(),
  story: z.string().min(80).max(1200),
  tags: z.array(z.enum(TAGS)).min(3).max(5),
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12),
  budget: z.enum(["budget", "moderate", "premium", "luxury"]),
  effort: z.number().int().min(1).max(5),
  rarity: z.number().min(0).max(1),
  wow: z.number().min(0).max(1),
});

export type Slots = z.infer<typeof Slots>;

const RULES = [
  "You fill in a card about ONE place for a travel app. Everything you write must come from the notes you are given; if the notes do not say it, leave it out.",
  "title is the ACT, never the place name: 'The bamboo grove before anyone wakes', not 'Arashiyama'.",
  "hook is one line a person reads on a tile: something seen or heard, and the hour it happens. Under 120 characters.",
  "moment is the hour, tide or turn of the season when the place is itself: 'first light, before the first coach'. If the notes show no such moment, return an empty string.",
  "dated is its past with a date in it, from the notes: 'a capital of half a million until 1565'. Null when the notes give no date.",
  "story is two or three short paragraphs. No superlatives you cannot source, no 'must-see', no second person plural.",
  "months are the months it is at its BEST, not the months it is open.",
  "rarity is 0 when everyone has heard of it and 1 when almost nobody has.",
  "Write plainly, in the voice of someone who has been there and is not selling anything.",
].join("\n");

/** A place the geocoder found, in the shape the builder needs. */
export interface Found extends Resolved {
  /** What the geocoder called it, for the research question and the photograph search. */
  label: string;
}

export type Fail =
  | { ok: false; why: string; reason: "unknown_place" | "no_reading" | "no_answer" | "refused" };

export interface BuilderDeps {
  /** src/places: words to one point. */
  resolve(query: string): Promise<Found | null>;
  /** src/web/research: an answer with the pages it was read from. */
  research(question: string, place: string): Promise<{ answer: string; sources: Source[] }>;
  /** The model, for the slots only. */
  call: CallFn;
  /** Commons. Left out, the card goes out without photographs. */
  photos?(place: string, want: number): Promise<Photo[]>;
  userId?: string;
  /** Paise this build may cost, all calls together. */
  maxPaise?: number;
}

export interface BuildAsk {
  /** Who it is being built for: it joins their feed and nobody else's. */
  userId: string;
  /** The cards it must not be a repeat of. */
  against?: readonly Card[];
  /** How many photographs to look for. */
  wantPhotos?: number;
}

const WANT_PHOTOS = 6;
const MAX_PAISE = 200;

/** The question put to the researcher. Narrow on purpose: a broad one comes back as a brochure. */
const questionFor = (label: string): string =>
  `About ${label}: what is there to do at a particular hour or season, what is its history with dates, what months are best to visit, and how expensive and how hard is it to reach? Give dates and facts, not opinions.`;

export function builder(deps: BuilderDeps) {
  return {
    async build(query: string, ask: BuildAsk): Promise<Built | Fail> {
      const found = await deps.resolve(query).catch(() => null);
      if (!found) {
        return { ok: false, reason: "unknown_place", why: `I could not find anywhere called "${query.trim().slice(0, 60)}".` };
      }

      const read = await deps.research(questionFor(found.label), found.label).catch(() => null);
      if (!read || read.sources.length < 2) {
        return { ok: false, reason: "no_reading", why: `I could not read enough about ${found.label} to write anything honest.` };
      }

      const answer = await deps
        .call<Slots>({
          tier: "cheap",
          purpose: "discover_card",
          budget: { maxPaise: deps.maxPaise ?? MAX_PAISE },
          json: Slots,
          ...(deps.userId ? { userId: deps.userId } : {}),
          messages: [
            { role: "system", content: RULES },
            {
              role: "user",
              content: [
                `Place: ${found.label} (${found.where}).`,
                "",
                "Notes read from the web just now — everything you write must come from these:",
                read.answer,
              ].join("\n"),
            },
          ],
        })
        .catch(() => null);

      const slots = answer?.json;
      if (!slots) {
        return { ok: false, reason: "no_answer", why: `I could not put ${found.label} into a card.` };
      }

      // The sources are the pages that were really read, not the model's idea of them.
      const built = parseBuilt({ ...slots }, found, ask.userId, ask.against ?? [], read.sources);
      if (!built.ok) return built;

      if (deps.photos) {
        const pictures = await deps.photos(found.label, ask.wantPhotos ?? WANT_PHOTOS).catch(() => []);
        if (pictures.length) built.card.photos = pictures;
      }

      return built;
    },
  };
}

/** Research sources, into ours: the host, the page, and the day it was read. */
export function sourcesFrom(rows: ReadonlyArray<{ url: string; fetchedAt: number; cited?: boolean }>, onlyCited = true): Source[] {
  const out: Source[] = [];
  for (const row of rows) {
    if (onlyCited && row.cited === false) continue;
    let host: string;
    try {
      const u = new URL(row.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      host = u.host.replace(/^www\./, "");
    } catch { continue; }
    if (out.some((s) => s.host === host)) continue;
    out.push({ host, url: row.url, readAt: new Date(row.fetchedAt).toISOString().slice(0, 10) });
  }
  return out;
}

export { judge };
