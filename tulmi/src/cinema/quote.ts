/**
 * WHAT A FILM WILL COST, BEFORE ANY OF IT IS MADE. The person agrees to a price twice, and never pays for more than they agreed to:
 *
 *   the storyboard   (boardQuote) the look frame, the reference sheets, the stills (two for a shot with people in it: the eye keeps the
 *                    better) and the voice-over. Cheap, and shown when they approve the script.
 *   the film         (filmQuote) every shot animated by the model the router picks, a reserve for retakes, and the music. Shown with the
 *                    storyboard, before a second of video is bought.
 *
 * The reserve is what retakes may cost: the quality check (qc.ts) throws away takes that fail, and a failed take was still paid for. It is
 * shown as "up to": a film whose takes pass first time spends less than its price, and what was not spent was never taken. The cap is the
 * agreed total; a film that would go past it stops and asks (Film.hold = "budget").
 *
 * Prices are the models' own dollars (models.ts) turned into paise at the server's rate (code/brain/money.ts usdToPaise), rounded up.
 */
import { usdToPaise } from "../code/brain/money.js";
import type { CatalogImageModel } from "./imageModels.js";
import type { CatalogModel } from "./models.js";
import { route } from "./route.js";
import type { Aspect, Script, Tier } from "./types.js";

/** The share of the video's price kept back for retakes. */
export const RESERVE = 0.4;
/** Music: one generated clip a film (Lyria's 30-second clip, looped and cut to length). */
export const MUSIC_USD = 0.04;
/** Voice-over, a rough dollar a thousand characters, the dearest of the voices we use. */
export const VO_USD_PER_KCHAR = 0.03;

/** Who appears in two shots or more: only they get a reference sheet (a face seen once has nothing to stay the same as). */
export function sheetsNeeded(script: Script): { characters: string[]; places: string[] } {
  const count = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const cast = count(script.shots.flatMap((s) => [...new Set(s.cast)]));
  const places = count(script.shots.map((s) => s.place));
  return {
    characters: script.bible.characters.filter((c) => (cast[c.key] ?? 0) >= 2).map((c) => c.key),
    places: script.bible.places.filter((p) => (places[p.key] ?? 0) >= 2).map((p) => p.key),
  };
}

/** Stills made for a shot: two candidates when someone is in it (a face is where a still most often goes wrong), else one. */
export const candidatesFor = (cast: readonly string[]): number => (cast.length ? 2 : 1);

export interface BoardQuote { sheets: number; stills: number; paise: number }

export function boardQuote(script: Script, still: Pick<CatalogImageModel, "usd"> | null, fx: number): BoardQuote {
  const need = sheetsNeeded(script);
  const sheets = need.characters.length + need.places.length + (script.shots.length > 1 ? 1 : 0);
  const stills = script.shots.reduce((n, s) => n + candidatesFor(s.cast), 0);
  const each = still?.usd ?? 0.05;
  const voChars = script.shots.reduce((n, s) => n + (s.vo?.length ?? 0), 0);
  return { sheets, stills, paise: usdToPaise((sheets + stills) * each + (voChars / 1000) * VO_USD_PER_KCHAR, fx) };
}

export interface ShotPrice { n: number; model: string | null; seconds: number; paise: number }

export interface FilmQuote {
  shots: ShotPrice[];
  /** Shots no model can make as written (route.ts whyNone says why). */
  missing: number[];
  video: number;
  reserve: number;
  extras: number;
  paise: number;
  seconds: number;
}

export function filmQuote(script: Script, f: { aspect: Aspect; tier: Tier }, models: readonly CatalogModel[], fx: number): FilmQuote {
  const shots: ShotPrice[] = [];
  const missing: number[] = [];
  let videoUsd = 0;
  let seconds = 0;
  for (const card of script.shots) {
    const best = route({ card, style: script.bible.style, aspect: f.aspect, tier: f.tier, models })[0];
    if (!best) {
      missing.push(card.n);
      shots.push({ n: card.n, model: null, seconds: card.seconds, paise: 0 });
      continue;
    }
    const usd = best.usd * best.seconds;
    videoUsd += usd;
    seconds += best.seconds;
    shots.push({ n: card.n, model: best.model.id, seconds: best.seconds, paise: usdToPaise(usd, fx) });
  }
  const extrasUsd = script.bible.music ? MUSIC_USD : 0;
  const video = usdToPaise(videoUsd, fx);
  const reserve = usdToPaise(videoUsd * RESERVE, fx);
  const extras = usdToPaise(extrasUsd, fx);
  return { shots, missing, video, reserve, extras, paise: video + reserve + extras, seconds };
}
