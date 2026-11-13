/**
 * THE CINEMA BOT'S ENGINE ROOM (docs/cinema.md): runs what flow.ts says each film needs, keeps the money, and answers the routes.
 *
 * A TICK every few seconds reads the films with work to do (store.working), asks flow.steps what each needs now, and starts those steps,
 * so many at once (flow.LIMITS), one of each kind per shot (a lock per step). A step does its slow work (a model, a provider, ffmpeg) with
 * no lock held, then takes the film's own lock, reads the film again and writes only what it made. So a person editing a shot while a take
 * of another shot finishes loses nothing, and a server restart picks every film up where it was (the steps are all decided from the film).
 *
 * Every step runs AS THE FILM'S OWNER (privacy/aiGate asPerson): their AI consent is asked for each call to OpenRouter, and what it cost
 * is put on their meter (usage/cost chargeUsd, as the "cinema" bot) and on the film (spentPaise). Before a paid step starts, what it will
 * cost is set aside (`reserved`), so steps running at once cannot pass the film's budget.
 *
 * The person never sees a cost (their plan covers the films): they say go twice, Make the storyboard and Film it, and the budget is ours,
 * a guard rail set from the quotes (quote.ts):
 *   approveScript   the storyboard's quote (boardQuote, plus a quarter for stills the eye sends back)
 *   approveBoard    the film's quote (filmQuote: the takes, a reserve for retakes, the music)
 *   extend          when the retakes need more, by itself (a quarter more at a time), as long as the plan's allowance says yes and it
 *                   stays under CINEMA_FILM_MAX_PAISE for the film and CINEMA_DAILY_PAISE for the person's day; past those the film waits
 *                   (hold "budget") and its page says it carries on tomorrow
 * Writing the script and the bot's own reading of a picture are on the person's meter but not the film's budget.
 *
 * Pushes (push/engine): the storyboard is ready (cinema_board), the film waits for them (cinema_hold), the film is ready (cinema_ready).
 * Never a word of the film in a push: its title only.
 */
import { randomUUID } from "node:crypto";
import { usdToPaise } from "../code/brain/money.js";
import { asPerson } from "../privacy/aiGate.js";
import { characterSheetPrompt, lookPrompt, motionPrompt, placeSheetPrompt, stillPrompt, stillRefs, voicePrint } from "./compile.js";
import { blankShot, prints, refresh, shotOf, stepKey, steps, type Step } from "./flow.js";
import { stillModel, type CatalogImageModel } from "./imageModels.js";
import { castKey, filmKey, pictureKey, signMedia } from "./media.js";
import type { CatalogModel } from "./models.js";
import { makePicture, readAsk } from "./pictures.js";
import { publicFilm, publicPicture, type FilmPublic, type PictureView } from "./public.js";
import { direct, revise, type Think } from "./plan.js";
import { afterCheck, checkBrief, parseVerdict, PROVIDER_FAILS } from "./qc.js";
import { boardQuote, candidatesFor, filmQuote } from "./quote.js";
import { route, whyNone } from "./route.js";
import type { Picture, CinemaStore } from "./store.js";
import { ASPECTS, TIERS, type Aspect, type Character, type Film, type FilmRow, type ShotCard, type Take, type Tier, type Verdict } from "./types.js";

export const TICK_MS = 5_000;
/** Longer than any script takes to write. */
export const WRITING_MS = 10 * 60_000;
/** A storyboard's price is the quote plus this share, for stills the eye sends back. */
export const BOARD_SPARE = 0.25;
/** Frames the eye is shown from each take. */
const EYE_FRAMES = 5;
const MAX_FILMS_LISTED = 30;

export class CinemaError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
    this.name = "CinemaError";
  }
}

export type CinemaPushKind = "cinema_ready" | "cinema_board" | "cinema_hold";
export type CinemaNotify = (userId: string, msg: { kind: CinemaPushKind; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;

export interface MediaPorts {
  image: (o: { model: string; prompt: string; aspect: string; refs?: string[]; format?: "png" | "jpeg" | "svg" }) => Promise<{ bytes: Buffer; type: string; usd: number }>;
  startVideo: (a: { model: string; prompt: string; seconds: number; res: string; aspect: Aspect; first: string; last?: string | null; audio: boolean }) => Promise<string>;
  videoStatus: (job: string) => Promise<{ status: "running" } | { status: "done"; url: string; usd: number | null } | { status: "failed"; error: string }>;
  fetchVideo: (url: string) => Promise<Buffer>;
  music: (prompt: string, seconds: number) => Promise<{ bytes: Buffer; usd: number } | null>;
  tts: (text: string, voice: string) => Promise<{ audio: Buffer; usd: number }>;
  frames: (bytes: Buffer, n: number) => Promise<{ frames: Buffer[]; last: Buffer; seconds: number }>;
  seconds: (bytes: Buffer) => Promise<number>;
  cut: (input: {
    shots: { video: Buffer; link: ShotCard["link"]; lines: string[]; vo: { audio: Buffer; text: string; seconds: number } | null }[];
    music: Buffer | null; aspect: Aspect; height: 720 | 1080;
  }) => Promise<{ video: Buffer; srt: string | null; seconds: number }>;
}

export interface CinemaDeps {
  store: CinemaStore;
  blobs: { put(key: string, data: Buffer, type: string): Promise<void>; get(key: string): Promise<Buffer | null>; delete(key: string): Promise<void> };
  /** The model gateway, as the person (callModel with json: true). */
  think: (userId: string) => Think;
  models: () => Promise<{ video: CatalogModel[]; image: CatalogImageModel[] }>;
  media: MediaPorts;
  /** Onto the person's usage meter, in dollars. */
  charge: (userId: string, usd: number) => void;
  aiAllowed: (userId: string) => Promise<boolean>;
  /** The plan's allowance: its refusal in words, or null (usage/metering enforceQuota). Asked before a film is extended by itself. */
  allowance?: (userId: string) => Promise<string | null>;
  notify: CinemaNotify;
  /** Tells the person's open screens to read again. */
  live: (userId: string) => void;
  fx: number;
  filmMaxPaise: number;
  dailyPaise: number;
  now?: () => number;
  id?: () => string;
  log?: (line: string) => void;
}

/** A film as a screen reads it: the film as the person sees it (public.ts: never a model, a prompt, a provider's job or a cost), and
 *  links to everything it made. Never a cost: the person's plan covers their films. */
export interface FilmView {
  film: FilmPublic;
  title: string;
  /** Signed links, by media key. */
  links: Record<string, string>;
}

export interface CinemaOverview {
  films: FilmRow[];
  pictures: PictureView[];
  cast: (Character & { url: string | null })[];
}

const dataUrl = (bytes: Buffer, type: string): string => `data:${type};base64,${bytes.toString("base64")}`;
const dayOf = (ms: number): number => Math.floor(ms / 86_400_000);

export class CinemaService {
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly busy = new Map<string, Set<string>>();
  private readonly reserved = new Map<string, number>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly day = new Map<string, { day: number; paise: number }>();
  private readonly frameCache = new Map<string, Buffer[]>();
  private readonly work = new Set<Promise<unknown>>();
  /** Films whose script this server is writing now. */
  private readonly writing = new Set<string>();
  private ticking = false;

  constructor(private readonly d: CinemaDeps) {
    this.now = d.now ?? Date.now;
    this.id = d.id ?? randomUUID;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------
  // What the routes call.

  async overview(userId: string): Promise<CinemaOverview> {
    const [films, pictures, cast] = await Promise.all([this.d.store.listFilms(userId, MAX_FILMS_LISTED), this.d.store.listPictures(userId, 24), this.d.store.cast(userId)]);
    return {
      films: films.map(rowOf),
      pictures: pictures.map((p) => publicPicture(p, signMedia(p.key))),
      cast: cast.map((c) => ({ ...c, url: c.ref ? signMedia(c.ref) : null })),
    };
  }

  /** A new film from an idea. `language` is the one the person writes in: the director writes in it unless the idea says otherwise. */
  async create(userId: string, o: { idea: string; length?: number; aspect?: string; tier?: string; voice?: string; cast?: string[]; language?: string }): Promise<FilmView> {
    const idea = o.idea.trim();
    if (idea.length < 3) throw new CinemaError(400, "Say what the film is about.", "bad_request");
    if (idea.length > 4000) throw new CinemaError(400, "That is too long for one film. Keep it under 4,000 characters.", "bad_request");
    await this.consent(userId);
    const now = this.now();
    const aspect = (ASPECTS as readonly string[]).includes(o.aspect ?? "") ? (o.aspect as Aspect) : "16:9";
    const tier = (TIERS as readonly string[]).includes(o.tier ?? "") ? (o.tier as Tier) : "standard";
    const length = Math.max(5, Math.min(180, Math.round(o.length ?? 30)));
    const film: Film = {
      id: this.id(), ownerId: userId, status: "writing", hold: null, idea, aspect, tier, length, voice: o.voice || "nova",
      budgetPaise: 0, spentPaise: 0, script: null, shots: [], takes: [], cut: { video: null, srt: null, seconds: 0, of: null }, notes: [], error: null,
      createdAt: now, updatedAt: now,
    };
    await this.d.store.createFilm(film);
    const all = await this.d.store.cast(userId);
    const cast = all.filter((c) => o.cast?.includes(c.key));
    const language = o.language && o.language !== "auto" ? o.language : "en";
    this.writing.add(film.id);
    this.track(film.id, async () => {
      try {
        const r = await asPerson(userId, () => direct(this.d.think(userId), { idea, length, aspect, language, cast }));
        await this.update(userId, film.id, (f) => {
          f.script = r.script;
          f.shots = r.script.shots.map((s) => blankShot(s.n));
          f.notes = r.notes;
          f.status = "script";
        });
      } catch (err) {
        await this.update(userId, film.id, (f) => {
          f.status = "failed";
          f.error = err instanceof Error && "code" in err ? err.message : "The director could not write this film. Try again.";
        });
      } finally {
        this.writing.delete(film.id);
      }
    });
    return this.view(film);
  }

  async film(userId: string, id: string): Promise<FilmView> {
    const f = await this.mine(userId, id);
    // A script being written when the server restarted is never finished: after WRITING_MS it is said to have failed, to be tried again.
    if (f.status === "writing" && this.now() - f.updatedAt > WRITING_MS && !this.writing.has(f.id)) {
      return this.view(await this.update(userId, id, (x) => { x.status = "failed"; x.error = "The script wasn't finished. Start the film again."; }));
    }
    return this.view(f);
  }

  /** The person agrees to the storyboard's price: the stills begin. */
  async approveScript(userId: string, id: string): Promise<FilmView> {
    const f = await this.mine(userId, id);
    if (f.status !== "script" || !f.script) throw new CinemaError(409, "The script is not ready to approve.", "wrong_status");
    const models = await this.d.models();
    const q = boardQuote(f.script, stillModel(models.image, 3), this.d.fx);
    const budget = Math.ceil(q.paise * (1 + BOARD_SPARE));
    this.canAgree(userId, f, budget);
    await this.consent(userId);
    const out = await this.update(userId, id, (x) => {
      x.status = "boarding";
      x.budgetPaise = Math.max(x.budgetPaise, x.spentPaise + budget);
    });
    this.addDay(userId, budget);
    return this.view(out);
  }

  /** The person agrees to the film's price: the takes begin. */
  async approveBoard(userId: string, id: string): Promise<FilmView> {
    const f = await this.mine(userId, id);
    if (f.status !== "board" || !f.script) throw new CinemaError(409, "The storyboard is not ready to approve.", "wrong_status");
    const models = await this.d.models();
    const q = filmQuote(f.script, f, models.video, this.d.fx);
    if (q.missing.length) {
      const card = f.script.shots.find((s) => s.n === q.missing[0])!;
      throw new CinemaError(409, `Shot ${card.n}: ${whyNone({ card, style: f.script.bible.style, aspect: f.aspect, tier: f.tier, models: models.video })}`, "no_model");
    }
    this.canAgree(userId, f, q.paise);
    await this.consent(userId);
    const out = await this.update(userId, id, (x) => {
      x.status = "rendering";
      x.hold = null;
      x.budgetPaise = x.spentPaise + q.paise;
    });
    this.addDay(userId, q.paise);
    return this.view(out);
  }

  /** A change in plain words, to the whole film or to one shot. Only what it touches is made again. */
  async revise(userId: string, id: string, o: { note: string; n?: number }): Promise<FilmView> {
    const f = await this.mine(userId, id);
    if (!f.script || f.status === "writing" || f.status === "stopped") throw new CinemaError(409, "The film cannot be changed just now.", "wrong_status");
    const note = o.note.trim();
    if (!note) throw new CinemaError(400, "Say what to change.", "bad_request");
    if (o.n !== undefined && !f.script.shots.some((s) => s.n === o.n)) throw new CinemaError(404, "There is no such shot.", "not_found");
    await this.consent(userId);
    const r = await asPerson(userId, () => revise(this.d.think(userId), f.script!, note, { length: f.length, ...(o.n !== undefined ? { n: o.n } : {}) }));
    const out = await this.update(userId, id, (x) => {
      x.script = r.script;
      x.shots = r.script.shots.map((s) => {
        const was = shotOf(x, s.n) ?? blankShot(s.n);
        const p = prints({ ...x, script: r.script });
        return was.takeOf !== p.take.get(s.n) ? { ...was, blamed: [], fix: null, error: null, failedOf: null } : was;
      });
      x.notes = [...r.notes, ...x.notes].slice(0, 20);
      if (x.status === "done") x.status = "rendering";
      if (x.status === "failed") x.status = "script";
      // A change to the storyboard redraws what it touched, then shows the storyboard again (the tick moves only films being made).
      if (x.status === "board") x.status = "boarding";
    });
    return this.view(out);
  }

  /** Try a shot that gave up again. (`model` pins one for it: for an operator, never offered on a screen.) */
  async retry(userId: string, id: string, n: number, o: { model?: string | null } = {}): Promise<FilmView> {
    const f = await this.mine(userId, id);
    if (!f.script?.shots.some((s) => s.n === n)) throw new CinemaError(404, "There is no such shot.", "not_found");
    const out = await this.update(userId, id, (x) => {
      const card = x.script!.shots.find((s) => s.n === n)!;
      if (o.model !== undefined) card.pin = o.model || null;
      const st = shotOf(x, n);
      if (st) Object.assign(st, { failedOf: null, error: null, blamed: [], fix: null, take: null, takeOf: null });
      if (x.hold === "shot") x.hold = null;
      if (x.status === "done") x.status = "rendering";
    });
    return this.view(out);
  }

  async stop(userId: string, id: string): Promise<FilmView> {
    await this.mine(userId, id);
    return this.view(await this.update(userId, id, (x) => { x.status = "stopped"; x.hold = null; }));
  }

  async remove(userId: string, id: string): Promise<void> {
    const f = await this.mine(userId, id);
    await this.d.store.deleteFilm(userId, id);
    for (const key of filmKeysOf(f)) await this.d.blobs.delete(key).catch(() => undefined);
    this.d.live(userId);
  }

  /** Keeps a character of a film in the person's cast, with their sheet. */
  async keep(userId: string, id: string, key: string): Promise<Character> {
    const f = await this.mine(userId, id);
    const c = f.script?.bible.characters.find((x) => x.key === key);
    if (!c) throw new CinemaError(404, "There is no such person in the film.", "not_found");
    let ref: string | null = null;
    if (c.ref) {
      const bytes = await this.d.blobs.get(c.ref);
      if (bytes) {
        ref = castKey(userId, c.key, this.id().slice(0, 8), "image/png");
        await this.d.blobs.put(ref, bytes, "image/png");
      }
    }
    const kept = { ...c, ref };
    await this.d.store.putCast(userId, kept);
    return kept;
  }

  async dropCast(userId: string, key: string): Promise<void> {
    const c = (await this.d.store.cast(userId)).find((x) => x.key === key);
    await this.d.store.dropCast(userId, key);
    if (c?.ref) await this.d.blobs.delete(c.ref).catch(() => undefined);
  }

  /** A picture, made now. `photos` are the person's own (data URLs), for an edit. */
  async picture(userId: string, o: { words: string; photos?: { url: string; type: string }[]; tier?: string }): Promise<PictureView> {
    const words = o.words.trim();
    if (words.length < 2) throw new CinemaError(400, "Say what the picture should show.", "bad_request");
    await this.consent(userId);
    if (this.spentToday(userId) >= this.d.dailyPaise) throw new CinemaError(429, "Today's films and pictures are used up. It starts again tomorrow, or see the plans.", "cinema_day");
    const tier = (TIERS as readonly string[]).includes(o.tier ?? "") ? (o.tier as Tier) : "standard";
    const cast = await this.d.store.cast(userId);
    const photos = (o.photos ?? []).slice(0, 4);
    const think = this.d.think(userId);
    const usd = { total: 0 };
    const counted: Think = async (x) => {
      const r = await think(x);
      usd.total += r.usd ?? 0;
      return r;
    };
    const { out, kind } = await asPerson(userId, async () => {
      const ask = await readAsk(counted, words, { photos: photos.length, cast });
      const refs = photos.map((p, i) => ({ url: p.url, role: `photo ${i + 1} they sent: ${ask.kind === "edit" ? "change it as asked, keep everything else" : "use it as asked"}` }));
      for (const key of ask.cast) {
        const c = cast.find((x) => x.key === key);
        const bytes = c?.ref ? await this.d.blobs.get(c.ref) : null;
        if (c && bytes) refs.push({ url: dataUrl(bytes, "image/png"), role: `the face, hair, build and clothes of ${c.name}` });
      }
      const models = await this.d.models();
      return { out: await makePicture({ think: counted, make: this.d.media.image, models: models.image, dataUrl }, { words, tier, refs, ask }), kind: ask.kind };
    });
    const total = out.usd + usd.total;
    this.d.charge(userId, total);
    const paise = usdToPaise(total, this.d.fx);
    this.addDay(userId, paise);
    const id = this.id();
    const key = pictureKey(userId, id, out.type);
    await this.d.blobs.put(key, out.bytes, out.type);
    const p: Picture = { id, ownerId: userId, words, kind, model: out.model, key, type: out.type, paise, note: out.note, createdAt: this.now() };
    await this.d.store.addPicture(p);
    this.d.live(userId);
    return publicPicture(p, signMedia(key));
  }

  async deletePicture(userId: string, id: string): Promise<void> {
    const p = await this.d.store.getPicture(userId, id);
    if (!p) throw new CinemaError(404, "There is no such picture.", "not_found");
    await this.d.store.deletePicture(userId, id);
    await this.d.blobs.delete(p.key).catch(() => undefined);
  }

  /** A stored file, for the signed media route (the link was checked there). */
  async file(key: string): Promise<Buffer | null> {
    return this.d.blobs.get(key);
  }

  async forAccountDelete(userId: string): Promise<void> {
    for (const key of await this.d.store.forAccountDelete(userId)) await this.d.blobs.delete(key).catch(() => undefined);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------
  // The tick.

  start(): () => void {
    const timer = setInterval(() => { void this.tick(); }, TICK_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /** One look at every film with work to do. Exported for tests, which run it by hand. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const films = await this.d.store.working(200);
      const models = await this.d.models().catch(() => ({ video: [], image: [] }));
      for (const f of films) {
        try {
          await this.advance(f, models);
        } catch (err) {
          this.d.log?.(`[cinema] a film could not move on: ${err instanceof Error ? err.name : "error"}`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Waits for every step started so far (tests). */
  async idle(): Promise<void> {
    while (this.work.size) await Promise.allSettled([...this.work]);
  }

  private async advance(f: Film, models: { video: CatalogModel[]; image: CatalogImageModel[] }): Promise<void> {
    const busy = this.busy.get(f.id) ?? new Set<string>();
    const still = stillModel(models.image, 3);
    const stillPaise = usdToPaise(still?.usd ?? 0.05, this.d.fx);
    const cost = (s: Step): number | null => {
      switch (s.kind) {
        case "sheet": return stillPaise;
        case "still": return stillPaise * candidatesFor(f.script?.shots.find((c) => c.n === s.n)?.cast ?? []);
        case "voice": return usdToPaise(((f.script?.shots.find((c) => c.n === s.n)?.vo?.length ?? 0) / 1000) * 0.03, this.d.fx);
        case "render": {
          const card = f.script?.shots.find((c) => c.n === s.n);
          if (!card || !f.script) return null;
          const best = route({ card, style: f.script.bible.style, aspect: f.aspect, tier: f.tier, models: models.video, blamed: shotOf(f, s.n)?.blamed ?? [] })[0];
          return best ? usdToPaise(best.usd * best.seconds, this.d.fx) : null;
        }
        default: return 0;
      }
    };
    const left = f.budgetPaise - f.spentPaise - (this.reserved.get(f.id) ?? 0);
    for (const s of steps(f, { now: this.now(), busy, cost, left })) {
      if (s.kind === "move") {
        // Short of budget: extended by itself within the limits, and the next tick carries on; past them, the film waits.
        if (s.hold === "budget" && f.hold !== "budget" && (await this.extend(f))) continue;
        await this.move(f, s.status, s.hold);
        continue;
      }
      const key = stepKey(s);
      if (busy.has(key)) continue;
      busy.add(key);
      this.busy.set(f.id, busy);
      const hold = cost(s) ?? 0;
      this.reserved.set(f.id, (this.reserved.get(f.id) ?? 0) + hold);
      this.track(f.id, async () => {
        try {
          await asPerson(f.ownerId, () => this.run(f, s, models));
        } catch (err) {
          this.d.log?.(`[cinema] ${s.kind} failed: ${err instanceof Error ? err.name : "error"}`);
        } finally {
          busy.delete(key);
          this.reserved.set(f.id, Math.max(0, (this.reserved.get(f.id) ?? 0) - hold));
        }
      });
    }
  }

  private async move(f: Film, status: Film["status"], hold: Film["hold"]): Promise<void> {
    const before = { status: f.status, hold: f.hold };
    const out = await this.update(f.ownerId, f.id, (x) => {
      x.status = status;
      x.hold = hold;
    });
    const title = out.script?.bible.title || "Your film";
    const data = { f: out.id };
    if (status === "board" && before.status !== "board") await this.push(out.ownerId, { kind: "cinema_board", key: `${out.id}:board:${out.shots.map((s) => s.still ?? "").join(",").slice(-400)}`, vars: { title }, data });
    if (status === "done" && before.status !== "done") await this.push(out.ownerId, { kind: "cinema_ready", key: `${out.id}:ready:${out.cut.of ?? ""}`, vars: { title }, data });
    if (hold && hold !== before.hold) await this.push(out.ownerId, { kind: "cinema_hold", key: `${out.id}:hold:${hold}:${out.updatedAt}`, vars: { title }, data });
  }

  private async run(f: Film, s: Step, models: { video: CatalogModel[]; image: CatalogImageModel[] }): Promise<void> {
    switch (s.kind) {
      case "sheet": return this.sheet(f, s.of, s.key, models.image);
      case "still": return this.still(f, s.n, models.image);
      case "voice": return this.voice(f, s.n);
      case "render": return this.render(f, s.n, models.video);
      case "poll": return this.poll(f, s.take);
      case "check": return this.check(f, s.take);
      case "cut": return this.cutFilm(f);
      default: return;
    }
  }

  /** Spends on a film: onto the person's meter and the film's spend. */
  private spend(f: Film, x: Film, usd: number): void {
    if (!(usd > 0)) return;
    this.d.charge(f.ownerId, usd);
    x.spentPaise += usdToPaise(usd, this.d.fx);
  }

  private async sheet(f: Film, of: "character" | "place" | "look", key: string, images: CatalogImageModel[]): Promise<void> {
    const b = f.script!.bible;
    const m = stillModel(images, 0);
    if (!m) throw new CinemaError(503, "Pictures can't be made just now. Try again in a few minutes.", "no_model");
    const prompt = of === "look" ? lookPrompt(b) : of === "character" ? characterSheetPrompt(b.characters.find((c) => c.key === key)!, b) : placeSheetPrompt(b.places.find((p) => p.key === key)!, b);
    const aspect = of === "look" ? f.aspect : of === "character" ? "3:2" : "16:9";
    const img = await this.d.media.image({ model: m.id, prompt, aspect });
    const mediaKey = filmKey(f.ownerId, f.id, `${of}-${key}-${this.id().slice(0, 8)}`, img.type);
    await this.d.blobs.put(mediaKey, img.bytes, img.type);
    await this.update(f.ownerId, f.id, (x) => {
      this.spend(f, x, img.usd);
      const bible = x.script!.bible;
      if (of === "look") bible.lookRef = mediaKey;
      else if (of === "character") { const c = bible.characters.find((c) => c.key === key); if (c) c.ref = mediaKey; }
      else { const p = bible.places.find((p) => p.key === key); if (p) p.ref = mediaKey; }
    });
  }

  private async still(f: Film, n: number, images: CatalogImageModel[]): Promise<void> {
    const card = f.script!.shots.find((c) => c.n === n)!;
    const b = f.script!.bible;
    const m = stillModel(images, 3);
    if (!m) throw new CinemaError(503, "Pictures can't be made just now. Try again in a few minutes.", "no_model");
    const refs = stillRefs(card, b, m.maxRefs);
    const refUrls: string[] = [];
    for (const r of refs) {
      const bytes = await this.d.blobs.get(r.key);
      if (bytes) refUrls.push(dataUrl(bytes, "image/png"));
    }
    const think = this.d.think(f.ownerId);
    let usd = 0;
    let best: { bytes: Buffer; type: string; verdict: Verdict | null } | null = null;
    let fix: string | null = null;
    for (let round = 0; round < 2; round++) {
      const prompt = stillPrompt(fix ? { ...card, frame: `${card.frame} ${fix}` } : card, b, m.maxRefs);
      const made = await Promise.allSettled(Array.from({ length: candidatesFor(card.cast) }, () => this.d.media.image({ model: m.id, prompt, aspect: f.aspect, refs: refUrls })));
      for (const r of made) {
        if (r.status !== "fulfilled") continue;
        usd += r.value.usd;
        const brief = checkBrief(card, b, "still");
        const seen = await think({
          purpose: "cinema.check.still", tier: "vision", system: brief, maxTokens: 600, capPaise: 50,
          user: [{ type: "text", text: "Check this still." }, { type: "image_url", image_url: { url: dataUrl(r.value.bytes, r.value.type) } }, ...refUrls.map((u) => ({ type: "image_url" as const, image_url: { url: u } }))],
        }).catch(() => null);
        usd += seen?.usd ?? 0;
        const verdict = seen ? parseVerdict(seen.json ?? seen.text, card.cast.length > 0) : null;
        if (!best || (verdict && (!best.verdict || mean5(verdict) > mean5(best.verdict)))) best = { bytes: r.value.bytes, type: r.value.type, verdict };
      }
      if (!best || !best.verdict || best.verdict.pass) break;
      fix = best.verdict.fix;
    }
    if (!best) throw new CinemaError(502, "The still could not be made.", "still_failed");
    const mediaKey = filmKey(f.ownerId, f.id, `still-${n}-${this.id().slice(0, 8)}`, best.type);
    await this.d.blobs.put(mediaKey, best.bytes, best.type);
    const made = best;
    await this.update(f.ownerId, f.id, (x) => {
      this.spend(f, x, usd);
      const st = shotOf(x, n);
      const p = prints(x);
      if (!st || !x.script) return;
      if (st.still && st.still !== mediaKey) void this.d.blobs.delete(st.still).catch(() => undefined);
      Object.assign(st, { still: mediaKey, stillVerdict: made.verdict, stillOf: p.still.get(n) ?? null });
    });
  }

  private async voice(f: Film, n: number): Promise<void> {
    const card = f.script!.shots.find((c) => c.n === n)!;
    if (!card.vo) return;
    const out = await this.d.media.tts(card.vo, f.voice);
    const secs = await this.d.media.seconds(out.audio).catch(() => card.vo!.split(/\s+/).length / 2.6);
    const mediaKey = filmKey(f.ownerId, f.id, `voice-${n}-${this.id().slice(0, 8)}`, "audio/mpeg");
    await this.d.blobs.put(mediaKey, out.audio, "audio/mpeg");
    await this.update(f.ownerId, f.id, (x) => {
      this.spend(f, x, out.usd);
      const c = x.script!.shots.find((s) => s.n === n);
      const st = shotOf(x, n);
      if (!c || !st) return;
      const need = Math.min(15, Math.ceil(secs + 0.5));
      if (need > c.seconds) {
        c.seconds = need;
        x.notes = [`Shot ${n}: given ${need} seconds so its voice-over fits.`, ...x.notes].slice(0, 20);
      }
      Object.assign(st, { voice: mediaKey, voiceOf: voicePrint(c, x.script!.bible, x.voice), voiceSeconds: Math.round(secs * 100) / 100 });
    });
  }

  private async render(f: Film, n: number, video: CatalogModel[]): Promise<void> {
    const script = f.script!;
    const card = script.shots.find((c) => c.n === n)!;
    const st = shotOf(f, n)!;
    const p = prints(f);
    const of = p.take.get(n)!;
    const pick = route({ card, style: script.bible.style, aspect: f.aspect, tier: f.tier, models: video, blamed: st.blamed })[0];
    if (!pick) {
      await this.update(f.ownerId, f.id, (x) => {
        const s = shotOf(x, n);
        if (s) Object.assign(s, { failedOf: of, error: whyNone({ card, style: script.bible.style, aspect: f.aspect, tier: f.tier, models: video }) });
      });
      return;
    }
    const stillBytes = st.still ? await this.d.blobs.get(st.still) : null;
    if (!stillBytes) throw new CinemaError(500, "The shot's still is missing.", "still_missing");
    let first = dataUrl(stillBytes, "image/png");
    let last: string | null = null;
    if (card.link === "continue") {
      const prevCard = script.shots[script.shots.indexOf(card) - 1];
      const prevTake = prevCard ? f.takes.find((t) => t.id === shotOf(f, prevCard.n)?.take) : undefined;
      const lf = prevTake?.lastFrame ? await this.d.blobs.get(prevTake.lastFrame) : null;
      if (lf) {
        first = dataUrl(lf, "image/png");
        last = pick.model.last ? dataUrl(stillBytes, "image/png") : null;
      }
    }
    const prompt = motionPrompt(card, script.bible, { dialect: pick.model.dialect, maxChars: pick.model.maxPrompt, audio: pick.audio, seconds: pick.seconds, fix: st.fix });
    const take: Take = {
      id: this.id(), n, model: pick.model.id, of, job: null, prompt, seconds: pick.seconds, status: "running", paise: usdToPaise(pick.usd * pick.seconds, this.d.fx),
      video: null, lastFrame: null, verdict: null, error: null, startedAt: this.now(), endedAt: null, polledAt: null,
    };
    try {
      take.job = await this.d.media.startVideo({ model: pick.model.id, prompt, seconds: pick.seconds, res: pick.res, aspect: f.aspect, first, last, audio: pick.audio });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "busy" || code === "no_credit") throw err;
      take.status = "failed";
      take.error = err instanceof Error ? err.message.slice(0, 200) : "The take did not start.";
      take.endedAt = this.now();
      take.paise = 0;
    }
    await this.update(f.ownerId, f.id, (x) => {
      x.takes.push(take);
      if (take.status === "failed") this.afterFailure(x, n, of);
    });
  }

  /** A take that failed at the provider: tried again, the model blamed after PROVIDER_FAILS, the shot given up after twice that. */
  private afterFailure(x: Film, n: number, of: string): void {
    const st = shotOf(x, n);
    if (!st) return;
    const failed = x.takes.filter((t) => t.n === n && t.of === of && t.status === "failed");
    const last = failed.at(-1);
    if (last && failed.filter((t) => t.model === last.model).length >= PROVIDER_FAILS && !st.blamed.includes(last.model)) st.blamed.push(last.model);
    if (failed.length >= PROVIDER_FAILS * 2) Object.assign(st, { failedOf: of, error: `Shot ${n} couldn't be made just now. Try again, or change its words.` });
  }

  private async poll(f: Film, takeId: string): Promise<void> {
    const t = f.takes.find((x) => x.id === takeId);
    if (!t?.job) return;
    const state = await this.d.media.videoStatus(t.job);
    if (state.status === "running") {
      await this.update(f.ownerId, f.id, (x) => { const y = x.takes.find((k) => k.id === takeId); if (y) y.polledAt = this.now(); });
      return;
    }
    if (state.status === "failed") {
      await this.update(f.ownerId, f.id, (x) => {
        const y = x.takes.find((k) => k.id === takeId);
        if (!y) return;
        Object.assign(y, { status: "failed", error: state.error, endedAt: this.now(), paise: 0 });
        this.afterFailure(x, y.n, y.of);
      });
      return;
    }
    const bytes = await this.d.media.fetchVideo(state.url);
    const shots = await this.d.media.frames(bytes, EYE_FRAMES);
    const videoKey = filmKey(f.ownerId, f.id, `take-${takeId}`, "video/mp4");
    const lastKey = filmKey(f.ownerId, f.id, `last-${takeId}`, "image/png");
    await this.d.blobs.put(videoKey, bytes, "video/mp4");
    await this.d.blobs.put(lastKey, shots.last, "image/png");
    this.frameCache.set(takeId, shots.frames);
    const usd = state.usd ?? (t.paise / this.d.fx / 100);
    await this.update(f.ownerId, f.id, (x) => {
      const y = x.takes.find((k) => k.id === takeId);
      if (!y) return;
      this.spend(f, x, usd);
      Object.assign(y, { status: "done", video: videoKey, lastFrame: lastKey, endedAt: this.now(), paise: usdToPaise(usd, this.d.fx) });
    });
  }

  private async check(f: Film, takeId: string): Promise<void> {
    const t = f.takes.find((x) => x.id === takeId);
    const script = f.script!;
    const card = script.shots.find((c) => c.n === t?.n);
    if (!t || !card || !t.video) return;
    let frameBytes = this.frameCache.get(takeId);
    if (!frameBytes) {
      const v = await this.d.blobs.get(t.video);
      frameBytes = v ? (await this.d.media.frames(v, EYE_FRAMES)).frames : [];
    }
    const st = shotOf(f, t.n)!;
    const still = st.still ? await this.d.blobs.get(st.still) : null;
    const idx = script.shots.indexOf(card);
    const prevCard = idx > 0 ? script.shots[idx - 1] : undefined;
    const prevTake = prevCard && (card.link === "continue" || prevCard.place === card.place) ? f.takes.find((x) => x.id === shotOf(f, prevCard.n)?.take) : undefined;
    const prevLast = prevTake?.lastFrame ? await this.d.blobs.get(prevTake.lastFrame) : null;
    const user: Exclude<Parameters<Think>[0]["user"], string> = [{ type: "text", text: `Check this take.${prevLast ? " The last image is the previous shot's last frame." : ""}` }];
    if (still) user.push({ type: "image_url", image_url: { url: dataUrl(still, "image/png") } });
    for (const fr of frameBytes) user.push({ type: "image_url", image_url: { url: dataUrl(fr, "image/jpeg") } });
    if (prevLast) user.push({ type: "image_url", image_url: { url: dataUrl(prevLast, "image/png") } });
    let verdict: Verdict | null = null;
    let usd = 0;
    for (let i = 0; i < 2 && !verdict; i++) {
      const r = await this.d.think(f.ownerId)({ purpose: "cinema.check.take", tier: "vision", system: checkBrief(card, script.bible, "take"), user, maxTokens: 700, capPaise: 80 }).catch(() => null);
      usd += r?.usd ?? 0;
      verdict = r ? parseVerdict(r.json ?? r.text, card.cast.length > 0) : null;
    }
    this.frameCache.delete(takeId);
    await this.update(f.ownerId, f.id, (x) => {
      this.spend(f, x, usd);
      const y = x.takes.find((k) => k.id === takeId);
      const s = shotOf(x, t.n);
      const c = x.script?.shots.find((k) => k.n === t.n);
      if (!y || !s || !c) return;
      y.verdict = verdict ?? { scores: { identity: 7, action: 7, camera: 7, quality: 7, continuity: 7 }, issues: [], fix: null, pass: true };
      if (!verdict) x.notes = [`Shot ${t.n}: kept without a check (the checker did not answer).`, ...x.notes].slice(0, 20);
      if (y.of !== prints(x).take.get(t.n)) return;
      const mine = x.takes.filter((k) => k.n === t.n && k.of === y.of && k.status === "done");
      const left = x.budgetPaise - x.spentPaise;
      const next = afterCheck(c, s, mine, y, left >= y.paise);
      if (next.kind === "keep") Object.assign(s, { take: next.take, takeOf: y.of, error: null });
      else if (next.kind === "best") {
        Object.assign(s, { take: next.take, takeOf: y.of, error: null });
        x.notes = [next.note, ...x.notes].slice(0, 20);
      } else if (next.kind === "retake") {
        s.fix = next.fix;
        if (next.blame && !s.blamed.includes(next.blame)) s.blamed.push(next.blame);
      } else Object.assign(s, { failedOf: y.of, error: next.why });
    });
  }

  private async cutFilm(f: Film): Promise<void> {
    const script = f.script!;
    const p = prints(f);
    const shots = [];
    for (const card of script.shots) {
      const st = shotOf(f, card.n)!;
      const take = f.takes.find((t) => t.id === st.take);
      const video = take?.video ? await this.d.blobs.get(take.video) : null;
      if (!video) throw new CinemaError(500, "A take is missing.", "take_missing");
      const audio = st.voice ? await this.d.blobs.get(st.voice) : null;
      const who = (k: string) => script.bible.characters.find((c) => c.key === k)?.name ?? k;
      shots.push({ video, link: card.link, lines: card.lines.map((l) => `${who(l.who)}: ${l.text}`), vo: card.vo && audio ? { audio, text: card.vo, seconds: st.voiceSeconds } : null });
    }
    let music: Buffer | null = null;
    let musicUsd = 0;
    if (script.bible.music) {
      const total = shots.length ? script.shots.reduce((n, c) => n + c.seconds, 0) : 30;
      const m = await this.d.media.music(`${script.bible.music}. Mood: ${script.bible.tone}.`, total).catch(() => null);
      if (m) { music = m.bytes; musicUsd = m.usd; }
    }
    const height = f.tier === "draft" ? 720 : 1080;
    const out = await this.d.media.cut({ shots, music, aspect: f.aspect, height });
    const videoKey = filmKey(f.ownerId, f.id, `film-${p.cut}`, "video/mp4");
    await this.d.blobs.put(videoKey, out.video, "video/mp4");
    let srtKey: string | null = null;
    if (out.srt) {
      srtKey = filmKey(f.ownerId, f.id, `words-${p.cut}`, "text/plain");
      await this.d.blobs.put(srtKey, Buffer.from(out.srt, "utf8"), "text/plain");
    }
    await this.update(f.ownerId, f.id, (x) => {
      this.spend(f, x, musicUsd);
      for (const old of [x.cut.video, x.cut.srt]) if (old && old !== videoKey && old !== srtKey) void this.d.blobs.delete(old).catch(() => undefined);
      x.cut = { video: videoKey, srt: srtKey, seconds: Math.round(out.seconds * 10) / 10, of: p.cut };
    });
  }

  // -------------------------------------------------------------------------------------------------------------------------------------
  // Helpers.

  private async mine(userId: string, id: string): Promise<Film> {
    const f = await this.d.store.getFilm(userId, id);
    if (!f) throw new CinemaError(404, "There is no such film.", "not_found");
    return f;
  }

  private async consent(userId: string): Promise<void> {
    if (!(await this.d.aiAllowed(userId))) throw new CinemaError(403, "X0 Bot needs your OK before it sends anything to AI services. Turn it on in You › Privacy.", "ai_consent_needed");
  }

  /** One film's changes, one at a time: read it again, change it, save it, tell the screens. */
  private async update(userId: string, id: string, change: (f: Film) => void): Promise<Film> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let out!: Film;
    const next = prev.catch(() => undefined).then(async () => {
      const f = await this.d.store.getFilm(userId, id);
      if (!f) throw new CinemaError(404, "There is no such film.", "not_found");
      change(f);
      f.updatedAt = this.now();
      out = refresh(f, this.busy.get(id));
      await this.d.store.saveFilm(out);
    });
    this.locks.set(id, next);
    try {
      await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
    this.d.live(userId);
    return out;
  }

  private track(_filmId: string, work: () => Promise<void>): void {
    const p = work().catch((err) => this.d.log?.(`[cinema] background work failed: ${err instanceof Error ? err.name : "error"}`));
    this.work.add(p);
    void p.finally(() => this.work.delete(p));
  }

  private async push(userId: string, msg: Parameters<CinemaNotify>[1]): Promise<void> {
    try {
      await this.d.notify(userId, msg);
    } catch {
      /* a missed push is not a lost film: it is on the film's page */
    }
  }

  private spentToday(userId: string): number {
    const d = this.day.get(userId);
    return d && d.day === dayOf(this.now()) ? d.paise : 0;
  }

  private addDay(userId: string, paise: number): void {
    const today = dayOf(this.now());
    const d = this.day.get(userId);
    this.day.set(userId, { day: today, paise: (d && d.day === today ? d.paise : 0) + paise });
  }

  private canAgree(userId: string, f: Film, add: number): void {
    if (f.budgetPaise + add > this.d.filmMaxPaise) throw new CinemaError(402, "This film is bigger than one film can be. Make it shorter or choose a lower quality.", "cinema_film_cap");
    if (this.spentToday(userId) + add > this.d.dailyPaise) throw new CinemaError(429, "Today's films and pictures are used up. It starts again tomorrow, or see the plans.", "cinema_day");
  }

  /** A quarter more budget for a film whose retakes need it, within the film's and the day's limits and the plan's allowance. */
  private async extend(f: Film): Promise<boolean> {
    const add = Math.min(Math.max(500, Math.ceil(f.budgetPaise * 0.25)), this.d.filmMaxPaise - f.budgetPaise, this.d.dailyPaise - this.spentToday(f.ownerId));
    if (add < 100) return false;
    if (this.d.allowance && (await this.d.allowance(f.ownerId).catch(() => null))) return false;
    await this.update(f.ownerId, f.id, (x) => { x.budgetPaise += add; });
    this.addDay(f.ownerId, add);
    return true;
  }

  private async view(f: Film): Promise<FilmView> {
    const links: Record<string, string> = {};
    const link = (k: string | null | undefined) => { if (k) links[k] = signMedia(k); };
    const b = f.script?.bible;
    link(b?.lookRef);
    b?.characters.forEach((c) => link(c.ref));
    b?.places.forEach((p) => link(p.ref));
    f.shots.forEach((s) => { link(s.still); link(s.voice); });
    f.takes.forEach((t) => { if (f.shots.some((s) => s.take === t.id)) link(t.video); });
    link(f.cut.video);
    link(f.cut.srt);
    return { film: publicFilm(f), title: b?.title || "New film", links };
  }
}

const mean5 = (v: Verdict): number => (v.scores.identity + v.scores.action + v.scores.camera + v.scores.quality + v.scores.continuity) / 5;

function filmKeysOf(f: Film): string[] {
  const keys = [f.script?.bible.lookRef, ...(f.script?.bible.characters.map((c) => c.ref) ?? []), ...(f.script?.bible.places.map((p) => p.ref) ?? []),
    ...f.shots.flatMap((s) => [s.still, s.voice]), ...f.takes.flatMap((t) => [t.video, t.lastFrame]), f.cut.video, f.cut.srt];
  return [...new Set(keys.filter((k): k is string => !!k))];
}

export function rowOf(f: Film): FilmRow {
  const done = f.shots.filter((s) => s.status === "ok").length;
  const poster = f.shots.find((s) => s.still)?.still ?? f.script?.bible.lookRef ?? null;
  return {
    id: f.id, title: f.script?.bible.title || "New film", status: f.status, hold: f.hold, aspect: f.aspect, shots: f.script?.shots.length ?? 0, done,
    seconds: f.cut.seconds || (f.script?.shots.reduce((n, s) => n + s.seconds, 0) ?? 0),
    poster: poster ? signMedia(poster) : null, updatedAt: f.updatedAt,
  };
}

let shared: CinemaService | null | undefined;
/** The server's own service, made by routes/bots/cinema.ts when the bot is on (setCinemaService); null when it is not. */
export function cinemaService(): CinemaService | null {
  return shared ?? null;
}
export function setCinemaService(s: CinemaService | null): void {
  shared = s;
}
