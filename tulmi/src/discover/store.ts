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

interface CardRow extends Row {
  id: string;
  owner_id: string;
  slug: string;
  card: Card;
  created_at?: string;
  opened_at?: string | null;
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
  now?: () => Date;
}

const slugOf = (s: string): string => s.trim().toLowerCase();

export function store(deps: StoreDeps = {}): DiscoverStore {
  // Asked for on first use, not at construction: the server builds a Discover at boot, and a test builds one with
  // no Supabase in sight. Neither should touch the config until something is actually read or written.
  let cardsT = deps.cards ?? null;
  let asksT = deps.asks ?? null;
  const cards = (): Table<CardRow> => (cardsT ??= table<CardRow>("discover_cards"));
  const asks = (): Table<AskRow> => (asksT ??= table<AskRow>("discover_asks"));
  const now = deps.now ?? (() => new Date());

  return {
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
