/**
 * WHAT A PERSON SEES OF A FILM: their film, never the machinery behind it. The routes answer with these shapes only (service.ts view,
 * overview), so no screen, and nobody reading the app's traffic, sees which models made a film, the prompts we wrote for them, the provider's
 * jobs, the models a retake passed over, the checker's numbers, a provider's own error text, or what anything cost (the person's plan
 * covers their films; the budgets are our guard rails). The prompts are our craft, and the models are
 * ours to change from one day to the next; what the person needs is their film, where it stands, and what the checker said in plain words.
 *
 *   publicFilm(film)       the film with each take reduced to where it stands and what the checker said, each shot's progress without the
 *                          models it blamed, the fix line or the checker's marks on its still, each card without a pinned model, and
 *                          no budget or spend
 *   publicPicture(picture) a picture without its model, its storage key or its cost
 */
import type { Picture } from "./store.js";
import type { Film, ShotCard, ShotState, Take, TakeStatus } from "./types.js";

/** A take as the person sees it. */
export interface TakeView {
  id: string;
  n: number;
  status: TakeStatus;
  seconds: number;
  /** What the checker made of it, in words; null until it has looked. */
  check: { pass: boolean; notes: string[] } | null;
  startedAt: number;
  endedAt: number | null;
}

export type ShotView = Omit<ShotState, "blamed" | "fix" | "stillVerdict">;
export type CardView = Omit<ShotCard, "pin">;
export type FilmPublic = Omit<Film, "takes" | "shots" | "script" | "budgetPaise" | "spentPaise"> & {
  script: (Omit<NonNullable<Film["script"]>, "shots"> & { shots: CardView[] }) | null;
  shots: ShotView[];
  takes: TakeView[];
};
export type PictureView = Omit<Picture, "model" | "key" | "ownerId" | "paise"> & { url: string };

const takeView = (t: Take): TakeView => ({
  id: t.id, n: t.n, status: t.status, seconds: t.seconds, startedAt: t.startedAt, endedAt: t.endedAt,
  check: t.verdict ? { pass: t.verdict.pass, notes: t.verdict.issues.map((i) => i.note).filter(Boolean).slice(0, 3) } : null,
});

export function publicFilm(f: Film): FilmPublic {
  const { takes, shots, script, budgetPaise: _budget, spentPaise: _spent, ...rest } = f;
  return {
    ...rest,
    script: script ? { ...script, shots: script.shots.map(({ pin: _pin, ...card }) => card) } : null,
    shots: shots.map(({ blamed: _blamed, fix: _fix, stillVerdict: _seen, ...s }) => s),
    takes: takes.map(takeView),
  };
}

export function publicPicture(p: Picture, url: string): PictureView {
  const { model: _model, key: _key, ownerId: _owner, paise: _paise, ...rest } = p;
  return { ...rest, url };
}
