/**
 * WHERE BUILT CARDS AND SEARCHES ARE KEPT (migration 0099). The same small table shape the rest of the bots area
 * uses (botsBots/rows.ts), so this works in memory for the tests and in Supabase on the server, unchanged.
 *
 *   const s = store()
 *   await s.keep(card)                   a built card joins its own person's feed
 *   await s.mine(userId)                 -> Card[]        theirs, newest first
 *   await s.asked("hampi", userId, said) -> how many DIFFERENT people have now asked
 *   await s.toWrite(25)                  -> the places worth our own words, most asked first
 *   await s.written("hampi")             we wrote it: it leaves the queue
 *
 * A search is counted once a person, not once a search — a place cannot climb the queue because one person kept
 * typing it. Nothing is kept about the person but their id and what they asked for.
 */
import { table, type Row, type Table } from "../botsBots/rows.js";
import type { Card } from "./types.js";
import type { Signal } from "./signals.js";
import { emptyTaste, type Taste } from "./taste.js";

interface CardRow extends Row {
  id: string;
  owner_id: string;
  slug: string;
  card: Card;
  created_at?: string;
  opened_at?: string | null;
}

interface TasteRow extends Row {
  owner_id: string;
  taste: Taste;
  signals: number;
  version: number;
  updated_at?: string;
}

interface SignalRow extends Row {
  owner_id: string;
  kind: string;
  slug: string;
  ms?: number | null;
  rank?: number | null;
  of_n?: number | null;
  at?: string;
}

interface AskRow extends Row {
  slug: string;
  owner_id: string;
  said?: string | null;
  first_at?: string;
  last_at?: string;
  written_at?: string | null;
}

export interface DiscoverStore {
  /** Their profile, or an empty one. Never null, so a caller never has to decide what "no taste yet" means. */
  taste(userId: string): Promise<Taste>;
  /** The folded profile, written back. */
  saveTaste(userId: string, taste: Taste): Promise<void>;
  /** What they did, kept so the profile can be rebuilt if the weights change. "shown" is not kept. */
  note(userId: string, signal: Signal, at: Date): Promise<void>;
  keep(card: Card): Promise<void>;
  mine(userId: string): Promise<Card[]>;
  one(userId: string, slug: string): Promise<Card | null>;
  opened(userId: string, slug: string): Promise<void>;
  asked(slug: string, userId: string, said?: string): Promise<number>;
  toWrite(threshold: number): Promise<Array<{ slug: string; people: number }>>;
  written(slug: string): Promise<void>;
}

export interface StoreDeps {
  cards?: Table<CardRow>;
  asks?: Table<AskRow>;
  taste?: Table<TasteRow>;
  signals?: Table<SignalRow>;
  now?: () => Date;
}

const slugOf = (s: string): string => s.trim().toLowerCase();

export function store(deps: StoreDeps = {}): DiscoverStore {
  // Asked for on first use, not at construction: the server builds a Discover at boot, and a test builds one with
  // no Supabase in sight. Neither should touch the config until something is actually read or written.
  let cardsT = deps.cards ?? null;
  let asksT = deps.asks ?? null;
  let tasteT = deps.taste ?? null;
  let signalsT = deps.signals ?? null;
  const cards = (): Table<CardRow> => (cardsT ??= table<CardRow>("discover_cards"));
  const asks = (): Table<AskRow> => (asksT ??= table<AskRow>("discover_asks"));
  const tasteRows = (): Table<TasteRow> => (tasteT ??= table<TasteRow>("discover_taste"));
  const signalRows = (): Table<SignalRow> => (signalsT ??= table<SignalRow>("discover_signals"));
  const now = deps.now ?? (() => new Date());

  return {
    async taste(userId) {
      const rows = await tasteRows().select({ owner_id: userId });
      return rows[0]?.taste ?? emptyTaste(now().toISOString());
    },

    async saveTaste(userId, taste) {
      await tasteRows().upsert(
        { owner_id: userId, taste, signals: taste.signals, version: taste.version, updated_at: now().toISOString() },
        ["owner_id"],
      );
    },

    async note(userId, signal, at) {
      // A "shown" is counted inside the profile and nowhere else: one row per tile per scroll would dwarf every
      // other table in the product and tell us nothing the shown count does not.
      if (signal.kind === "shown") return;
      await signalRows().insert({
        owner_id: userId,
        kind: signal.kind,
        slug: signal.slug,
        ...(signal.ms !== undefined ? { ms: Math.round(signal.ms) } : {}),
        ...(signal.rank !== undefined ? { rank: signal.rank } : {}),
        ...(signal.of !== undefined ? { of_n: signal.of } : {}),
        at: at.toISOString(),
      });
    },

    async keep(card) {
      if (!card.forUserId) return;
      await cards().upsert(
        {
          id: card.id,
          owner_id: card.forUserId,
          slug: card.slug,
          card,
          created_at: now().toISOString(),
        },
        ["owner_id", "slug"],
      );
    },

    async mine(userId) {
      const rows = await cards().select({ owner_id: userId }, { order: "created_at", desc: true });
      return rows.map((r) => r.card);
    },

    async one(userId, slug) {
      const rows = await cards().select({ owner_id: userId, slug: slugOf(slug) });
      return rows[0]?.card ?? null;
    },

    async opened(userId, slug) {
      await cards().update({ owner_id: userId, slug: slugOf(slug) }, { opened_at: now().toISOString() });
    },

    async asked(slug, userId, said) {
      const key = slugOf(slug);
      const at = now().toISOString();
      const mine = await asks().select({ slug: key, owner_id: userId });
      if (mine.length) await asks().update({ slug: key, owner_id: userId }, { last_at: at });
      else await asks().insert({ slug: key, owner_id: userId, ...(said ? { said: said.slice(0, 120) } : {}), first_at: at, last_at: at });
      const all = await asks().select({ slug: key });
      return new Set(all.map((r) => r.owner_id)).size;
    },

    async toWrite(threshold) {
      const all = await asks().select({});
      const people = new Map<string, Set<string>>();
      for (const row of all) {
        if (row.written_at) continue;
        const who = people.get(row.slug) ?? new Set<string>();
        who.add(row.owner_id);
        people.set(row.slug, who);
      }
      return [...people.entries()]
        .filter(([, who]) => who.size >= threshold)
        .map(([slug, who]) => ({ slug, people: who.size }))
        .sort((a, b) => b.people - a.people || a.slug.localeCompare(b.slug));
    },

    async written(slug) {
      await asks().update({ slug: slugOf(slug) }, { written_at: now().toISOString() });
    },
  };
}
