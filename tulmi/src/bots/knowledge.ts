/**
 * A BOT'S KNOWLEDGE: THE FILES ITS OWNER GAVE IT, ANSWERED FROM A FEW RELEVANT CHUNKS AT A TIME.
 *
 *   retrieve(media, userId, fileIds, question, max?) -> { text, files, chunks, notes }
 *
 * The files are the owner's own, read once by the media layer (docs/media.md, migration 0036): the text is already in pieces, and a question
 * finds its pieces by full-text search. This sends a model only the chunks that share the question's words (at most four a file, in the
 * order they come in the file, 3,500 characters in all, the file that covers more of the question's words first), and NOTHING from a file with no word in common, nor from a
 * question with no word worth searching for ("hi"). It is not the media layer's excerpt(): that always adds the file's first chunk to orient
 * a reader, and a bot that answers about invoices has no use for the first page of the holiday policy. What is sent is wrapped as untrusted
 * data (media/untrusted.ts): a file is whatever its maker wrote, and may say "ignore your instructions".
 *
 * A file that is not the owner's is not found (the store is asked as the owner), so a bot cannot be made to read someone else's.
 */
import { queryTerms, tokens } from "../media/chunk.js";
import type { MediaStore } from "../media/store.js";
import type { Chunk } from "../media/types.js";
import { asUntrustedFile } from "../media/untrusted.js";

export type KnowledgeMedia = { store: Pick<MediaStore, "get" | "search"> };

/** The most characters of files that reach a model for one question. */
export const KNOWLEDGE_CHARS = 3_500;
const PER_FILE_CHUNKS = 4;

export interface Retrieved {
  /** The excerpts, wrapped as data; empty when nothing in the files is about the question. */
  text: string;
  files: number;
  chunks: number;
  notes: string[];
}

const EMPTY: Retrieved = { text: "", files: 0, chunks: 0, notes: [] };

export async function retrieve(media: KnowledgeMedia | null | undefined, userId: string, fileIds: readonly string[], question: string, max = KNOWLEDGE_CHARS): Promise<Retrieved> {
  if (!media || !fileIds.length) return EMPTY;
  const terms = queryTerms(question);
  if (!terms.length) return EMPTY;
  const notes: string[] = [];
  const hits: Array<{ name: string; kind: string; total: number; covered: number; best: number; at: number; chunks: Array<Chunk & { score: number }> }> = [];
  for (const id of fileIds.slice(0, 10)) {
    let item;
    try { item = await media.store.get(userId, id, { light: true }); } catch { notes.push("A file could not be read just now."); continue; }
    if (!item) { notes.push("A file this bot answers from is no longer there."); continue; }
    let found;
    try { found = await media.store.search(userId, id, terms, PER_FILE_CHUNKS); } catch { notes.push("A file could not be searched just now."); continue; }
    if (!found.length) continue;
    // How many of the question's words this file has between its chunks: comparable from file to file, which a search score is not.
    const have = new Set(found.flatMap((c) => tokens(`${c.heading ?? ""} ${c.text}`)));
    const covered = terms.filter((t) => [...have].some((w) => w.startsWith(t))).length;
    hits.push({ name: item.name, kind: item.kind, total: item.meta.chunks ?? Math.max(1, Math.ceil(item.chars / 900)), covered, best: Math.max(...found.map((c) => c.score)), at: hits.length, chunks: found });
  }
  hits.sort((a, b) => b.covered - a.covered || b.best - a.best || a.at - b.at);
  let used = 0;
  let chunks = 0;
  const blocks: string[] = [];
  for (const h of hits) {
    const taken: Chunk[] = [];
    for (const c of [...h.chunks].sort((a, b) => b.score - a.score)) {
      const size = c.text.length + 60;
      if (used + size > max) continue;
      taken.push(c);
      used += size;
    }
    if (!taken.length) continue;
    taken.sort((a, b) => a.seq - b.seq);
    chunks += taken.length;
    const body = taken.map((c, i) => {
      const gap = i > 0 && c.seq > taken[i - 1]!.seq + 1 ? "[… skipped …]\n" : "";
      const where = c.page !== undefined ? `page ${c.page}` : `part ${c.seq + 1}`;
      return `${gap}[${where}${c.heading ? ` · ${c.heading.slice(0, 80)}` : ""}]\n${c.text}`;
    }).join("\n\n");
    blocks.push(asUntrustedFile({ name: h.name, kind: h.kind, parts: `${taken.length} of ${h.total}`, body }));
  }
  return { text: blocks.join("\n"), files: blocks.length, chunks, notes: [...new Set(notes)] };
}
