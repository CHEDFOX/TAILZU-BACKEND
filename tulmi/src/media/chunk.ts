/**
 * A FILE'S TEXT IN PIECES, AND A WAY TO FIND THE PIECES A QUESTION IS ABOUT.
 *
 * A question about a 200-page PDF must not send 200 pages to a model. The text is cut into chunks of about 900 characters at the seams the
 * text already has (a heading, a blank line, a table's rows), each remembering the heading it sits under and the page it came from, and a
 * question pulls the few chunks that share its words. In production that search is Postgres full-text search (the `tsv` column of
 * media_chunks and the media_search function of migration 0035); in memory it is the same idea written out here, so tests and a server with
 * no database find the same chunks for the same words:
 *
 *   - the words of the question: letters, marks and digits of any script, lower case, no stop words, at most 16;
 *   - a word of three letters or more matches any word that starts with it ("refund" finds "refunds" and "refunded"): Postgres `word:*`;
 *   - a chunk's score is BM25 over the matched words; a word in a heading counts one and a half times.
 *
 * No stemming and no language guessing, on purpose: the 'simple' text-search configuration is the only one that treats English, Hindi and
 * Hinglish alike. Pure: text in, chunks out.
 */
import { CHUNKS_MAX, type Chunk, type FoundChunk } from "./types.js";

export const CHUNK_TARGET = 900;
export const CHUNK_MAX = 1400;

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "what", "which", "where", "when", "how", "does", "are", "was", "were", "from", "have", "has", "had", "can", "could",
  "about", "into", "any", "all", "you", "your", "its", "not", "but", "who", "whom", "why", "will", "would", "should", "there", "their", "them", "then", "than",
  "is", "it", "in", "on", "of", "to", "a", "an", "as", "at", "by", "be", "or", "if", "do", "me", "my", "we", "us",
  "kya", "hai", "hain", "mein", "yeh", "woh", "kaun", "kaise", "kab", "kahan", "kyun", "ka", "ki", "ke", "ko", "se", "par", "aur", "ya", "tha", "thi", "hota",
  "में", "है", "हैं", "का", "की", "के", "को", "से", "पर", "और", "या", "क्या", "यह", "वह", "कैसे", "कब", "कहाँ",
]);

/** The words of some text, as a search sees them. */
export function tokens(text: string): string[] {
  return (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);
}

/**
 * An English word cut back to a stem that its other forms start with: refunded, refunding and refunds all give refund. A word search matches by
 * prefix, so the stem finds every form. Only plain ASCII words with at least four letters left are cut; Hindi and Hinglish are left as they are.
 */
export function stemOf(word: string): string {
  if (!/^[a-z]+$/.test(word)) return word;
  for (const suffix of ["ations", "ation", "ings", "ing", "edly", "ed", "ies", "es", "ly", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

/** The words of a question worth searching for: no stop words, no single letters, stemmed, at most 16. */
export function queryTerms(question: string): string[] {
  const out: string[] = [];
  for (const t of tokens(question)) {
    if (STOP.has(t)) continue;
    if (t.length < 2 && !/^\p{N}$/u.test(t)) continue;
    if (t.length > 40) continue;
    const stem = stemOf(t);
    if (!out.includes(stem)) out.push(stem);
    if (out.length >= 16) break;
  }
  return out;
}

// ------------------------------------------------------------------ cutting

const HEADING = /^#{1,6}\s+(.{1,120})$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

function hardSplit(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s.trim();
  while (rest.length > max) {
    // The last sentence end or space before the limit, so a word is not cut in two.
    let cut = Math.max(rest.lastIndexOf(". ", max), rest.lastIndexOf("। ", max), rest.lastIndexOf("\n", max));
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.3) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** One block (a paragraph, a table, a list) split into pieces no longer than `max`; a table keeps its header row on every piece. */
function splitBlock(block: string, max: number): string[] {
  if (block.length <= max) return [block];
  const lines = block.split("\n");
  if (lines.length > 3 && lines.filter((l) => TABLE_ROW.test(l)).length >= lines.length * 0.8) {
    const head = lines.slice(0, 2).join("\n");
    const out: string[] = [];
    let cur = head;
    for (const l of lines.slice(2)) {
      if (cur.length + l.length + 1 > max && cur !== head) { out.push(cur); cur = head; }
      cur += `\n${l.length > max ? l.slice(0, max) : l}`;
    }
    if (cur !== head) out.push(cur);
    return out;
  }
  const out: string[] = [];
  let cur = "";
  for (const l of lines) {
    if (l.length > max) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(...hardSplit(l, max));
    } else if (cur.length + l.length + 1 > max) { out.push(cur); cur = l; }
    else cur = cur ? `${cur}\n${l}` : l;
  }
  if (cur) out.push(cur);
  return out;
}

export interface Section {
  text: string;
  page?: number;
}

/** Sections (the pages of a PDF, say) cut into chunks, numbered from 0. Stops at CHUNKS_MAX chunks and says so. */
export function chunkSections(sections: readonly Section[], o: { target?: number; max?: number } = {}): { chunks: Chunk[]; truncated: boolean } {
  const target = o.target ?? CHUNK_TARGET;
  const max = o.max ?? CHUNK_MAX;
  const chunks: Chunk[] = [];
  let truncated = false;
  let heading: string | undefined;

  for (const section of sections) {
    let cur: string[] = [];
    let curLen = 0;
    let curHeading = heading;
    const flush = (): void => {
      const text = cur.join("\n\n").trim();
      cur = []; curLen = 0;
      if (!text) return;
      if (chunks.length >= CHUNKS_MAX) { truncated = true; return; }
      chunks.push({ seq: chunks.length, text, ...(curHeading ? { heading: curHeading } : {}), ...(section.page !== undefined ? { page: section.page } : {}) });
    };
    for (const raw of section.text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
      const block = raw.trim();
      if (!block) continue;
      const h = HEADING.exec(block.split("\n")[0]!);
      if (h) {
        // A heading starts a new chunk, and is the heading of the ones under it.
        flush();
        heading = h[1]!.trim();
        curHeading = heading;
      }
      for (const piece of splitBlock(block, max)) {
        if (curLen > 0 && curLen + piece.length + 2 > target) { flush(); curHeading = heading; }
        cur.push(piece);
        curLen += piece.length + 2;
      }
      if (truncated) break;
    }
    flush();
    if (truncated) break;
  }
  return { chunks, truncated };
}

export function chunkText(text: string): { chunks: Chunk[]; truncated: boolean } {
  return chunkSections([{ text }]);
}

// ------------------------------------------------------------------ finding

/** Whether a word of the text matches a word of the question: the same word, or (for three letters or more) one that starts with it. */
const matches = (word: string, term: string): boolean => word === term || (term.length >= 3 && word.startsWith(term));

/**
 * The chunks closest to the question, best first: BM25 over the question's words. This is what the database does with full-text search; the
 * memory twin and the tests use it.
 */
export function findChunks(chunks: readonly Chunk[], terms: readonly string[], limit: number): FoundChunk[] {
  if (!terms.length || !chunks.length) return [];
  const K1 = 1.2;
  const B = 0.75;
  const docs = chunks.map((c) => ({ c, words: tokens(c.text), head: new Set(tokens(c.heading ?? "")) }));
  const avg = docs.reduce((n, d) => n + d.words.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of terms) df.set(t, docs.filter((d) => d.words.some((w) => matches(w, t))).length);
  const scored: FoundChunk[] = [];
  for (const d of docs) {
    let score = 0;
    for (const t of terms) {
      const n = df.get(t)!;
      if (!n) continue;
      const tf = d.words.reduce((k, w) => k + (matches(w, t) ? 1 : 0), 0);
      const inHead = [...d.head].some((w) => matches(w, t));
      if (!tf && !inHead) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.words.length) / avg))) * (inHead ? 1.5 : 1) + (tf === 0 ? idf * 0.3 : 0);
    }
    if (score > 0) scored.push({ ...d.c, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.seq - b.seq).slice(0, Math.max(1, Math.min(limit, 20)));
}

/** Code and other text where lines matter: pieces of whole lines, each headed `lines A-B` so an answer can cite them. */
export function chunkLines(text: string, o: { target?: number } = {}): { chunks: Chunk[]; truncated: boolean } {
  const target = o.target ?? CHUNK_TARGET;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const chunks: Chunk[] = [];
  let from = 0;
  let cur: string[] = [];
  let size = 0;
  let truncated = false;
  const flush = (to: number): void => {
    const body = cur.join("\n").trim();
    cur = []; size = 0;
    if (!body) return;
    if (chunks.length >= CHUNKS_MAX) { truncated = true; return; }
    chunks.push({ seq: chunks.length, text: body, heading: `lines ${from + 1}-${to}` });
  };
  lines.forEach((raw, i) => {
    if (truncated) return;
    const l = raw.length > 400 ? `${raw.slice(0, 399)}…` : raw;
    if (size + l.length + 1 > target && cur.length) { flush(i); from = i; }
    cur.push(l);
    size += l.length + 1;
  });
  flush(lines.length);
  return { chunks, truncated };
}
