/**
 * THE SENTENCE BANK: REAL SENTENCES, WRITTEN BY PEOPLE, SHARED BY EVERYONE.
 *
 * A pair of sentences IS an exercise. "I would like a coffee" against its translation is already a thing to type, a
 * thing to hear, and a set of words to put in order — with no exercise written by anybody. So the quickest way to a
 * good lesson is not to invent sentences but to pour in a public corpus and pick well from it.
 *
 * Nobody owns these rows. They are not a person's data, they have no user_id, and they go in once for everybody
 * (migration 0089, poured in by scripts/lingo-seed.ts).
 *
 * THE LICENCE AND THE AUTHOR ARE KEPT PER ROW, because in a corpus they differ per row: it is thousands of people's
 * writing, each under whatever they chose. `usable()` is what decides whether a row may be shown in a product
 * somebody pays for, and `credits()` is what makes crediting them possible. Getting this wrong is not a bug that
 * shows up in a test, so it is decided in one place, here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { fold, spaceless } from "./grade.js";

export interface Sentence {
  id: number;
  /** The sentence in the language being learned. */
  text: string;
  /** What it means, in the language they are taught in. */
  gloss: string;
  words: number;
  licence: string;
  author: string;
  source: string;
}

export type NewSentence = Omit<Sentence, "id">;

/**
 * WHICH LICENCES MAY BE SHOWN IN SOMETHING PEOPLE PAY FOR.
 *
 * CC0 and the public domain ask for nothing. CC BY allows it and asks to be credited, which `credits()` makes
 * possible. Everything else — a non-commercial clause, a share-alike clause, or a blank licence, which in a corpus
 * usually means nobody said — is refused here rather than argued about later. A row that is not on this list is
 * never poured in and never shown.
 */
const USABLE = /^(CC0-1\.0|PD|CC-BY-2\.0(-FR)?|CC-BY-3\.0|CC-BY-4\.0)$/i;

export const usable = (licence: string): boolean => USABLE.test(licence.trim());

/** Whether a row has to be credited by name, as against asking for nothing at all. */
export const needsCredit = (licence: string): boolean => usable(licence) && !/^(CC0-1\.0|PD)$/i.test(licence.trim());

/**
 * Who to credit for a set of sentences, as one line per corpus. The screens word the rest; this only gathers the
 * names, de-duplicated and in order, so a credits page can be built from what was actually shown.
 */
export function credits(used: readonly Sentence[]): { source: string; licence: string; authors: string[] }[] {
  const by = new Map<string, { source: string; licence: string; authors: Set<string> }>();
  for (const s of used) {
    if (!needsCredit(s.licence)) continue;
    const corpus = s.source.split("#")[0] ?? s.source;
    const k = `${corpus}|${s.licence}`;
    const row = by.get(k) ?? { source: corpus, licence: s.licence, authors: new Set<string>() };
    if (s.author.trim()) row.authors.add(s.author.trim());
    by.set(k, row);
  }
  return [...by.values()].map((r) => ({ source: r.source, licence: r.licence, authors: [...r.authors].sort() }));
}

/**
 * How long a sentence is, as a number a level can be compared against.
 *
 * Words, where the script separates them. Characters, where it does not — Chinese, Japanese, Thai and the rest
 * cannot be split on spaces at all. It is decided by the SCRIPT and never by whether this particular string happens
 * to contain a space, because a one-word answer in any language contains none either.
 */
export function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 1;
  if (spaceless(t)) return Math.max(1, Math.min(60, [...t].length));
  return Math.max(1, t.split(/\s+/).filter(Boolean).length);
}

/** A row ready to be poured in, or null when its licence is not one we may show. */
export function readyToStore(s: NewSentence): (NewSentence & { folded: string }) | null {
  const text = s.text.trim();
  const gloss = s.gloss.trim();
  if (!text || !gloss || text.length > 400 || gloss.length > 400) return null;
  if (!usable(s.licence)) return null;
  return { ...s, text, gloss, words: wordCount(text), folded: fold(text) };
}

export interface SentenceBank {
  /** Sentences of this pair that use `word`, shortest first. */
  using(lang: string, glossLang: string, word: string, limit: number): Promise<Sentence[]>;
  /** Sentences of this pair of about this length, for a level. */
  around(lang: string, glossLang: string, maxWords: number, limit: number): Promise<Sentence[]>;
  /** Pour rows in. Returns how many were new; the same sentence twice is one row. */
  put(lang: string, glossLang: string, rows: readonly NewSentence[], now: number): Promise<number>;
  count(lang: string, glossLang: string): Promise<number>;
}

/** What `like` means to Postgres, so a word with a percent or an underscore in it is still looked up literally. */
const likeSafe = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class MemorySentenceBank implements SentenceBank {
  private readonly rows: (Sentence & { lang: string; glossLang: string; folded: string })[] = [];
  private next = 1;

  async using(lang: string, glossLang: string, word: string, limit: number): Promise<Sentence[]> {
    const needle = fold(word);
    if (!needle) return [];
    return this.rows
      .filter((r) => r.lang === lang && r.glossLang === glossLang && r.folded.includes(needle))
      .sort((a, b) => a.words - b.words)
      .slice(0, limit);
  }

  async around(lang: string, glossLang: string, maxWords: number, limit: number): Promise<Sentence[]> {
    return this.rows
      .filter((r) => r.lang === lang && r.glossLang === glossLang && r.words <= maxWords)
      .sort((a, b) => b.words - a.words)
      .slice(0, limit);
  }

  async put(lang: string, glossLang: string, rows: readonly NewSentence[], _now: number): Promise<number> {
    let added = 0;
    for (const raw of rows) {
      const r = readyToStore(raw);
      if (!r) continue;
      if (this.rows.some((x) => x.lang === lang && x.glossLang === glossLang && x.text === r.text && x.gloss === r.gloss)) continue;
      this.rows.push({ ...r, id: this.next++, lang, glossLang });
      added++;
    }
    return added;
  }

  async count(lang: string, glossLang: string): Promise<number> {
    return this.rows.filter((r) => r.lang === lang && r.glossLang === glossLang).length;
  }
}

const COLS = "id, text, gloss, words, licence, author, source";

export class SupabaseSentenceBank implements SentenceBank {
  constructor(private readonly db: SupabaseClient) {}

  async using(lang: string, glossLang: string, word: string, limit: number): Promise<Sentence[]> {
    const needle = fold(word);
    if (!needle) return [];
    const { data, error } = await this.db.from("lingo_sentences").select(COLS)
      .eq("lang", lang).eq("gloss_lang", glossLang)
      .like("folded", `%${likeSafe(needle)}%`)
      .order("words", { ascending: true }).limit(limit);
    if (error) throw new Error("lingo_sentences read failed");
    return (data ?? []) as unknown as Sentence[];
  }

  async around(lang: string, glossLang: string, maxWords: number, limit: number): Promise<Sentence[]> {
    const { data, error } = await this.db.from("lingo_sentences").select(COLS)
      .eq("lang", lang).eq("gloss_lang", glossLang).lte("words", maxWords)
      .order("words", { ascending: false }).limit(limit);
    if (error) throw new Error("lingo_sentences read failed");
    return (data ?? []) as unknown as Sentence[];
  }

  async put(lang: string, glossLang: string, rows: readonly NewSentence[], now: number): Promise<number> {
    const ready = rows.map(readyToStore).filter((r): r is NewSentence & { folded: string } => r !== null);
    if (!ready.length) return 0;
    const { data, error } = await this.db.from("lingo_sentences")
      .upsert(ready.map((r) => ({
        lang, gloss_lang: glossLang, text: r.text, gloss: r.gloss, folded: r.folded,
        words: r.words, licence: r.licence, author: r.author, source: r.source, created_ms: now,
      })), { onConflict: "lang,gloss_lang,text,gloss", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error("lingo_sentences write failed");
    return (data ?? []).length;
  }

  async count(lang: string, glossLang: string): Promise<number> {
    const { count, error } = await this.db.from("lingo_sentences").select("id", { count: "exact", head: true })
      .eq("lang", lang).eq("gloss_lang", glossLang);
    if (error) throw new Error("lingo_sentences count failed");
    return count ?? 0;
  }
}

let shared: SentenceBank | null = null;

/** The server's bank: Supabase when it is set up, else the memory twin. */
export function sentenceBank(): SentenceBank {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseSentenceBank(db) : new MemorySentenceBank();
  }
  return shared;
}
