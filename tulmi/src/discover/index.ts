/**
 * PLACES WORTH KEEPING: the catalogue behind the Travel bot (docs/discover.md).
 *
 *   const d = new Discover()
 *   await d.ask({ tags: ["warm", "solitude"], month: 3, userId })   -> Chosen[]   what to show, in order
 *   await d.count({ ... })                                         -> how many there were before the limit
 *   await d.open("erg-chebbi-silence", userId)                     -> one card
 *   await d.keep(card)                                             a built card joins that person's feed
 *   await d.searched("hampi", userId)                              -> how many people have now asked for it
 *   await d.toWrite()                                              the places asked for often enough to write
 *
 * TWO TIERS, ONE BAR. What we wrote by hand (catalog.ts) is everyone's, and ships with the code because it is
 * reviewed the way code is. What the bot built for one person (builder.ts) is theirs alone, in their own rows
 * (migration 0099), until enough DIFFERENT people search the same place — then we write it by hand and it becomes
 * everyone's. The catalogue grows where it is wanted, in the order it is wanted, and nobody has to guess which
 * fifty places to write next.
 */
import { CURATED, curatedCountries } from "./catalog.js";
import { pick, countFor } from "./query.js";
import { judge } from "./bar.js";
import type { Built } from "./build.js";
import type { Fail } from "./builder.js";
import { store as makeStore, type DiscoverStore } from "./store.js";
import { decayAll, fold, known, likes, dislikes, type Taste, type TasteLine } from "./taste.js";
import { weightOf, type Signal } from "./signals.js";
import type { Experiences } from "./experiences.js";
import type { Ask, Card, Chosen } from "./types.js";

export * from "./types.js";
export * from "./taxonomy.js";
export { judge, failures, type Check, type Verdict } from "./bar.js";
export { parseBuilt, BUILD_SLOTS, type Built, type Resolved } from "./build.js";
export { builder, sourcesFrom, type BuilderDeps, type BuildAsk, type Found } from "./builder.js";
export { commonsPhotos, photosFromConfig, parseCommons, COMMONS_URL, type PhotoSource } from "./photos.js";
export { CURATED, curatedBySlug, curatedCountries } from "./catalog.js";
export { store, type DiscoverStore } from "./store.js";
export { pick, countFor } from "./query.js";
export { experiences, FORUMS, KINDS, type Experiences, type Point, type Kind } from "./experiences.js";
export { DISCOVER_TOOLS, runDiscover, discoverFor } from "./tools.js";
export * from "./taste.js";
export * from "./signals.js";
export type { Fail } from "./builder.js";

export interface DiscoverOptions {
  /** The written catalogue. Handed in by the tests; the real one by default. */
  curated?: readonly Card[];
  /** Where built cards and searches are kept. In memory without Supabase, as everything in the bots area is. */
  store?: DiscoverStore;
  /** How many different people must search a place before it is worth writing ourselves. */
  writeAt?: number;
  /**
   * Makes a builder for one person (server.ts): the geocoder, the researcher and the model behind their own
   * limits. Left out — no model, a test — and `build` says so instead of pretending.
   */
  makeBuilder?: (userId: string) => { build(query: string, ask: { userId: string; against?: readonly Card[] }): Promise<Built | Fail> };
  /**
   * Makes a reader of forum threads for one person (server.ts), behind their own limits. Left out — a test, no
   * model — and `felt` says so rather than returning an empty list, which would read as "nobody has been".
   */
  makeExperiences?: (userId: string) => { about(place: string, o?: { userId?: string }): Promise<Experiences> };
}

const WRITE_AT = 25;

export class Discover {
  private readonly curated: readonly Card[];
  private readonly store: DiscoverStore;
  private readonly writeAt: number;
  private readonly makeBuilder: DiscoverOptions["makeBuilder"];
  private readonly makeExperiences: DiscoverOptions["makeExperiences"];

  constructor(o: DiscoverOptions = {}) {
    this.curated = o.curated ?? CURATED;
    this.store = o.store ?? makeStore();
    this.writeAt = o.writeAt ?? WRITE_AT;
    this.makeBuilder = o.makeBuilder;
    this.makeExperiences = o.makeExperiences;
  }

  /** Whether a place we have not written can be built at all right now. */
  get canBuild(): boolean {
    return !!this.makeBuilder;
  }

  /** Whether forum threads can be read at all right now. */
  get canFeel(): boolean {
    return !!this.makeExperiences;
  }

  /**
   * What people who actually went say about a place (experiences.ts). Our own words and the builder's both come
   * off editorial pages; this is the only thing in the product that goes looking for somebody who was there.
   *
   * Takes a SLUG, because this is offered from an opened card: the card's own `where` is what gets searched, so
   * a thread about a different place of the same name is not what comes back.
   */
  async felt(slug: string, userId: string): Promise<Experiences> {
    const make = this.makeExperiences;
    if (!make) return { ok: false, reason: "off", why: "Reading what other people said is switched off here." };

    const card = await this.open(slug, userId);
    if (!card) return { ok: false, reason: "nothing_found", why: "Nothing of ours by that name." };

    return make(userId).about(`${card.title} — ${card.where}`, { userId });
  }

  /**
   * Somebody named a place nobody has written. Resolve it, read about it, fill the card, judge it — and when it
   * clears the bar, keep it in their feed and count the search. A place already written is returned as it is
   * rather than built again, and a place built for them before is not paid for twice.
   */
  async build(query: string, userId: string): Promise<Built | Fail> {
    const make = this.makeBuilder;
    if (!make) return { ok: false, reason: "no_answer", why: "Building a card for a new place is switched off here." };

    const already = await this.open(query, userId);
    if (already) return { ok: true, card: already, verdict: { ok: true, checks: [] } };

    const out = await make(userId).build(query, { userId, against: this.curated });
    if (out.ok) {
      await this.keep(out.card);
      await this.searched(out.card.slug, userId, query);
    }
    return out;
  }

  /** Everything this person may see: what we wrote, plus what was built for them. */
  /**
   * Every card the feed may draw on. The bar is applied HERE rather than at write time, so a card is never lost:
   * a place under a travel warning, or one whose scores put it below the exceptional line, stays written and
   * comes back the day the warning lifts or the scores are revisited (bar.ts). Nothing is deleted to be hidden.
   */
  private async all(userId?: string | null): Promise<Card[]> {
    const mine = userId ? await this.store.mine(userId) : [];
    return [...this.curated, ...mine].filter((c) => judge(c).ok);
  }

  /**
   * The feed. Their profile orders it when they have one; what they asked for still comes first (query.ts), and
   * every card that goes out is counted as SHOWN, which is what lets the next fold divide out our own bias.
   */
  async ask(ask: Ask = {}): Promise<Chosen[]> {
    const taste = ask.userId ? await this.load(ask.userId) : undefined;
    const out = pick(await this.all(ask.userId), ask, taste);
    if (ask.userId && taste) await this.counted(ask.userId, taste, out);
    return out;
  }

  /** Their profile, faded up to now (taste.ts decayAll): a year away should not rank like yesterday. */
  private async load(userId: string): Promise<Taste> {
    return decayAll(await this.store.taste(userId), Date.now());
  }

  /** Everything in a feed was shown. No evidence of taste, only of our choices — see taste.ts. */
  private async counted(userId: string, taste: Taste, shown: readonly Chosen[]): Promise<void> {
    if (shown.length === 0) return;
    const at = new Date().toISOString();
    let next = taste;
    for (const { card } of shown) next = fold(next, { tags: card.tags, weight: 0, at, onlyShown: true });
    await this.store.saveTaste(userId, next);
  }

  /** Their profile, in their own words: what they like, what they turn down, and how much of them we know. */
  async taste(userId: string): Promise<{ taste: Taste; likes: TasteLine[]; dislikes: TasteLine[]; known: number }> {
    const taste = await this.load(userId);
    return { taste, likes: likes(taste), dislikes: dislikes(taste), known: known(taste) };
  }

  /**
   * One thing they did. Kept as a row and folded into the profile at once — a feed that learned overnight would
   * feel broken, because a person who just said "not for me" expects the next screen to have heard it.
   */
  async did(userId: string, signal: Signal): Promise<Taste> {
    const card = await this.open(signal.slug, userId);
    const at = new Date();
    await this.store.note(userId, signal, at);

    const tags = card ? card.tags : [];
    const taste = await this.load(userId);
    if (tags.length === 0) return taste;

    const next = fold(taste, {
      tags,
      weight: weightOf(signal),
      at: at.toISOString(),
      ...(signal.kind === "shown" ? { onlyShown: true } : {}),
    });
    await this.store.saveTaste(userId, next);
    return next;
  }

  async count(ask: Ask = {}): Promise<number> {
    return countFor(await this.all(ask.userId), ask);
  }

  async open(slug: string, userId?: string | null): Promise<Card | null> {
    const want = slug.trim().toLowerCase();
    const written = this.curated.find((c) => c.slug === want);
    if (written) return written;
    if (!userId) return null;
    const mine = await this.store.one(userId, want);
    if (mine) await this.store.opened(userId, want);
    return mine;
  }

  /** A built card joins its person's feed, replacing an earlier one of theirs for the same place. */
  async keep(card: Card): Promise<void> {
    await this.store.keep(card);
  }

  /** The cards built for this person. */
  async built(userId: string): Promise<readonly Card[]> {
    return this.store.mine(userId);
  }

  /**
   * Somebody searched for a place. Counted by person, so one person asking twenty times does not put a place in
   * the queue; a place we have already written is not counted at all. Returns how many people have now asked.
   */
  async searched(slug: string, userId: string, said?: string): Promise<number> {
    if (this.curated.some((c) => c.slug === slug.trim().toLowerCase())) return 0;
    return this.store.asked(slug, userId, said);
  }

  /** Places asked for often enough to deserve our own words, most asked first. */
  async toWrite(threshold = this.writeAt): Promise<Array<{ slug: string; people: number }>> {
    const written = new Set(this.curated.map((c) => c.slug));
    const rows = await this.store.toWrite(threshold);
    return rows.filter((r) => !written.has(r.slug));
  }

  /** We wrote it by hand: it leaves the queue. */
  async wroteUp(slug: string): Promise<void> {
    await this.store.written(slug);
  }

  /** For "3 of 8 countries kept". */
  countries(): string[] {
    return curatedCountries();
  }
}
