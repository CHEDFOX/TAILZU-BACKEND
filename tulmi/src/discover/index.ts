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
import { store as makeStore, type DiscoverStore } from "./store.js";
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
export { DISCOVER_TOOLS, runDiscover, discoverFor } from "./tools.js";

export interface DiscoverOptions {
  /** The written catalogue. Handed in by the tests; the real one by default. */
  curated?: readonly Card[];
  /** Where built cards and searches are kept. In memory without Supabase, as everything in the bots area is. */
  store?: DiscoverStore;
  /** How many different people must search a place before it is worth writing ourselves. */
  writeAt?: number;
}

const WRITE_AT = 25;

export class Discover {
  private readonly curated: readonly Card[];
  private readonly store: DiscoverStore;
  private readonly writeAt: number;

  constructor(o: DiscoverOptions = {}) {
    this.curated = o.curated ?? CURATED;
    this.store = o.store ?? makeStore();
    this.writeAt = o.writeAt ?? WRITE_AT;
  }

  /** Everything this person may see: what we wrote, plus what was built for them. */
  private async all(userId?: string | null): Promise<Card[]> {
    const mine = userId ? await this.store.mine(userId) : [];
    return [...this.curated, ...mine];
  }

  async ask(ask: Ask = {}): Promise<Chosen[]> {
    return pick(await this.all(ask.userId), ask);
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
