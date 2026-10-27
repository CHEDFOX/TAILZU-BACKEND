/**
 * MEDIA AND FILES INGESTION: ONE FILE IN, ITS TEXT IN PIECES OUT, READ ONCE.
 *
 *   ingest(user, { name, data })
 *      1. type it by its bytes (sniff.ts); a password-protected or damaged file, and a bomb, are refused here with words
 *      2. hold it to the cap for its kind (types.ts CAPS)
 *      3. look for it by SHA-256 for this person: a file read before is not read again (and its expiry is renewed)
 *      4. take its text out, by kind:
 *           image     the metadata is stripped (strip.ts); what it shows is described later, once, by the vision tier (attach.ts)
 *           pdf       unpdf in Node; a scanned or garbled one goes to the worker (Docling)
 *           docx xlsx pptx odt ods odp epub html     the worker (MarkItDown, or our own ODF reader); spreadsheets also give rows
 *           csv tsv   parsed here: facts over every row, then the rows, and a DataTable for a chart or a table artifact
 *           text code decoded, cut to size
 *           audio     Deepgram
 *           video     the worker: key frames (at most 8) and the sound track; Deepgram for the words
 *           zip       listed, with the guards against a bomb (zip.ts); the text and code inside are read
 *      5. cut the text into chunks (chunk.ts) and take out any chunk that looks like it holds a secret (the policy's scanner)
 *      6. keep the bytes (R2) and write the row and the chunks (store.ts)
 *   excerpt(user, item, question)   the few chunks a question is about, found by full-text search, wrapped as untrusted data
 *
 * Nothing in a file is ever run or followed: its text is data. The worker has no way out to the network, and every call to it is signed.
 */
import { createHash } from "node:crypto";
import { scanForSecrets } from "../code/policy.js";
import { blobKey, type BlobStore } from "./blob.js";
import { chunkLines, chunkSections, queryTerms, type Section } from "./chunk.js";
import { looksHard, readPdf } from "./pdf.js";
import { decodeText, sniff, sniffEntry, type SniffResult } from "./sniff.js";
import type { Transcriber } from "./speech.js";
import type { MediaStore } from "./store.js";
import { imageSize, stripMetadata } from "./strip.js";
import { readDelimited } from "./tabular.js";
import {
  CAPS, CHUNKS_MAX, DAY_MS, KEEP_DAYS, MediaError, TEXT_CHARS_MAX, VIDEO_SECONDS_MAX, ZIP,
  type Chunk, type DataTable, type MediaItem, type MediaKind, type MediaMeta,
} from "./types.js";
import { asUntrustedFile } from "./untrusted.js";
import type { WorkerClient } from "./worker.js";
import { readEntry } from "./zip.js";

export interface MediaDeps {
  store: MediaStore;
  blobs?: BlobStore | null;
  worker?: WorkerClient | null;
  speech?: Transcriber | null;
  now?: () => number;
  keepDays?: number;
  log?: { warn(o: object, msg: string): void };
}

export interface IngestInput {
  name: string;
  data: Buffer;
}

export interface IngestOptions {
  signal?: AbortSignal;
  /** Send a PDF to the layout reader even if it has a text layer. */
  hardPdf?: boolean;
}

export interface Ingested {
  item: MediaItem;
  /** True when the file had been read before and nothing was read again. */
  cached: boolean;
}

/** The most characters of a file's text that go to a model for one question. */
export const EXCERPT_CHARS = 3_500;
export const WITHHELD = "(withheld: this part looked like it held a secret)";
const MAX_PIXELS = 100_000_000;

interface Extraction {
  sections: Section[];
  /** Cut by line rather than by paragraph. */
  lines?: boolean;
  meta: MediaMeta;
  /** What is kept as the file's bytes, if not the file as it came. */
  stored?: { data: Buffer; mime: string };
  /** More objects to keep beside the file (a video's frames). */
  extra?: Array<{ suffix: string; data: Buffer; mime: string }>;
}

const sha256Of = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** The slides of a deck, from MarkItDown's `<!-- Slide number: N -->` marks: one section each, with its number as the page. */
export function splitSlides(markdown: string): Section[] {
  const parts = markdown.split(/<!--\s*Slide number:\s*(\d+)\s*-->/i);
  if (parts.length < 3) return [{ text: markdown }];
  const out: Section[] = [];
  if (parts[0]!.trim()) out.push({ text: parts[0]! });
  for (let i = 1; i < parts.length; i += 2) out.push({ text: parts[i + 1] ?? "", page: Number(parts[i]) });
  return out;
}

/** A page-broken text (the layout reader separates pages with a form feed) as sections with page numbers. */
export function splitPages(markdown: string): Section[] {
  const pages = markdown.split("\f");
  return pages.length > 1 ? pages.map((text, i) => ({ text, page: i + 1 })) : [{ text: markdown }];
}

/** HTML as plain text when there is no worker: scripts, styles and comments dropped, tags to spaces, entities decoded. Nothing is executed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:p|div|section|article|h[1-6]|ul|ol|table|blockquote|pre)\s*>/gi, "\n\n").replace(/<\/(?:li|tr)\s*>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const needWorker = (what: string): MediaError =>
  new MediaError("not_configured", `Reading ${what} needs the file reader service, which is not switched on on this server yet.`, 503);

export class MediaService {
  readonly store: MediaStore;
  readonly blobs: BlobStore | null;
  readonly worker: WorkerClient | null;
  readonly speech: Transcriber | null;
  private readonly now: () => number;
  private readonly keepDays: number;
  private readonly log: MediaDeps["log"];
  private readonly flying = new Map<string, Promise<Ingested>>();

  constructor(d: MediaDeps) {
    this.store = d.store;
    this.blobs = d.blobs ?? null;
    this.worker = d.worker ?? null;
    this.speech = d.speech ?? null;
    this.now = d.now ?? Date.now;
    this.keepDays = d.keepDays ?? KEEP_DAYS;
    this.log = d.log;
  }

  private expiry(): number { return this.now() + this.keepDays * DAY_MS; }

  // ------------------------------------------------------------------ in

  /** Reads a file once. The same bytes for the same person a second time are not read again, and are kept for another stretch. */
  ingest(userId: string, input: IngestInput, o: IngestOptions = {}): Promise<Ingested> {
    const key = `${userId}:${sha256Of(input.data)}`;
    const going = this.flying.get(key);
    if (going) return going;
    const run = this.ingestOnce(userId, input, o).finally(() => { this.flying.delete(key); });
    this.flying.set(key, run);
    return run;
  }

  private async ingestOnce(userId: string, input: IngestInput, o: IngestOptions): Promise<Ingested> {
    const { data } = input;
    const name = input.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "file";
    const sniffed = sniff(data, name);
    if (sniffed.kind === "unsupported") throw new MediaError("unsupported", sniffed.why ?? "I don't read that kind of file.");
    const cap = CAPS[sniffed.kind];
    if (data.length > cap) throw new MediaError("too_big", `That ${sniffed.kind === "text" || sniffed.kind === "code" ? "file" : sniffed.kind} is over ${Math.round(cap / 1024 / 1024)} MB, which is the most I read of its kind.`, 413);

    const sha = sha256Of(data);
    const had = await this.store.find(userId, sha, { light: true });
    if (had) {
      // Read before: nothing is read again, and the file is kept for another stretch.
      const item = had.keep ? had : (await this.store.update(userId, had.id, { expiresAt: this.expiry() })) ?? had;
      return { item, cached: true };
    }

    const ex = await this.extract(sniffed, data, name, o);
    const { chunks: cut, truncated } = ex.lines ? chunkLines(ex.sections.map((s) => s.text).join("\n")) : chunkSections(ex.sections);
    const { chunks, withheld } = this.withhold(cut);
    const text = chunks.map((c) => c.text).join("\n\n").slice(0, TEXT_CHARS_MAX);
    const notes = [...(ex.meta.notes ?? [])];
    if (truncated) notes.push("The file is longer than I keep, so only the first part can be searched.");
    if (withheld) notes.push(`${withheld === 1 ? "One part" : `${withheld} parts`} of the file looked like they held a secret, so ${withheld === 1 ? "it was" : "they were"} left out.`);
    const meta: MediaMeta = { ...ex.meta, chunks: chunks.length, ...(notes.length ? { notes } : {}), ...(withheld ? { withheld } : {}) };

    const key = this.blobs ? blobKey(userId, sha) : null;
    let stored: string | null = null;
    if (this.blobs && key) {
      try {
        const keep = ex.stored ?? { data, mime: sniffed.mime };
        await this.blobs.put(key, keep.data, keep.mime);
        stored = key;
        for (const x of ex.extra ?? []) await this.blobs.put(`${key}${x.suffix}`, x.data, x.mime);
      } catch (err) {
        this.log?.warn({ error: (err as Error)?.name }, "media: bytes not kept");
        meta.notes = [...(meta.notes ?? []), "I could not keep a copy of the file itself, but I read it."];
        if (meta.frames) delete meta.frames;
      }
    }
    const item = await this.store.put({
      userId, sha256: sha, kind: sniffed.kind, format: sniffed.format, mime: sniffed.mime, name, bytes: data.length, text, meta, blobKey: stored, keep: false, expiresAt: this.expiry(),
    }, chunks);
    return { item, cached: false };
  }

  /** Chunks with anything that looks like a secret taken out: it is never stored, so it can never be found or shown. */
  private withhold(chunks: readonly Chunk[]): { chunks: Chunk[]; withheld: number } {
    let withheld = 0;
    const out = chunks.map((c) => {
      if (!scanForSecrets([{ path: "extracted.txt", content: c.text }]).length) return c;
      withheld += 1;
      return { ...c, text: WITHHELD };
    });
    return { chunks: out, withheld };
  }

  // ------------------------------------------------------------------ the readers

  private async extract(s: SniffResult, data: Buffer, name: string, o: IngestOptions): Promise<Extraction> {
    switch (s.kind) {
      case "image": return this.image(s, data);
      case "pdf": return this.pdf(data, o);
      case "document": case "presentation": case "spreadsheet": return this.office(s, data);
      case "data": return this.delimited(s, data, name);
      case "text": case "code": return this.plain(s, data);
      case "audio": return this.audio(s, data, o);
      case "video": return this.video(s, data, o);
      case "archive": return this.archive(s, data, name);
      default: throw new MediaError("unsupported", "I don't read that kind of file.");
    }
  }

  private image(s: SniffResult, data: Buffer): Extraction {
    const size = imageSize(data, s.format);
    if (size && size.width * size.height > MAX_PIXELS) throw new MediaError("bomb", "That picture is far bigger than its file size suggests (it would be over 100 megapixels), so I did not open it.");
    const clean = stripMetadata(data, s.format);
    const notes = clean.removed.length ? [`Details like location and camera (${clean.removed.join(", ")}) were taken out of the copy that is kept.`] : [];
    return { sections: [], meta: { ...(size ? { width: size.width, height: size.height } : {}), via: "vision", ...(notes.length ? { notes } : {}) }, stored: { data: clean.data, mime: s.mime } };
  }

  private async pdf(data: Buffer, o: IngestOptions): Promise<Extraction> {
    let pages: string[] = [];
    let numPages = 0;
    let damaged: MediaError | null = null;
    try {
      const r = await readPdf(data);
      pages = r.pages;
      numPages = r.numPages;
    } catch (err) {
      if (!(err instanceof MediaError) || err.code === "password" || err.code === "too_long") throw err;
      damaged = err;
    }
    const verdict = damaged ? { hard: true, why: "damaged" } : looksHard(pages);
    const notes: string[] = [];
    if ((verdict.hard || o.hardPdf) && this.worker) {
      try {
        const r = await this.worker.pdf(data);
        if (r.markdown.trim()) {
          notes.push(verdict.why === "scanned" ? "These pages are pictures of text, so the layout reader read them." : verdict.hard ? "The text layer was broken, so the layout reader read the pages." : "The layout reader read this PDF, so tables and columns are kept.");
          return { sections: splitPages(r.markdown), meta: { pages: r.pages ?? numPages, via: "docling", notes: [...notes, ...r.notes] } };
        }
      } catch (err) {
        if (err instanceof MediaError && err.code === "password") throw err;
        if (!pages.join("").trim()) throw err;
        notes.push("The layout reader could not read this PDF, so only its own text is used.");
      }
    } else if (verdict.hard) {
      if (damaged && !pages.join("").trim()) throw damaged;
      if (!pages.join("").trim()) throw new MediaError("not_configured", "That PDF is pages of pictures, with no text to read, and the reader for scanned pages is not switched on on this server yet.", 503);
      notes.push("Parts of this PDF are pictures or broken text, and the reader for those is not switched on here, so I could only read what text there is.");
    }
    return { sections: pages.map((text, i) => ({ text, page: i + 1 })), meta: { pages: numPages, via: "unpdf", ...(notes.length ? { notes } : {}) } };
  }

  private async office(s: SniffResult, data: Buffer): Promise<Extraction> {
    if (!this.worker) {
      if (s.format === "html") return { sections: [{ text: htmlToText(decodeText(data.subarray(0, 2 * 1024 * 1024))) }], meta: { via: "html" } };
      throw needWorker(s.format === "docx" || s.format === "odt" ? "Word documents" : s.format === "xlsx" || s.format === "ods" ? "spreadsheets" : s.format === "pptx" || s.format === "odp" ? "slide decks" : "this kind of file");
    }
    const r = await this.worker.convert(data, s.format);
    if (!r.markdown.trim() && !r.tables.length) throw new MediaError("unsupported", "I found no text in that file.");
    const sections = s.kind === "presentation" ? splitSlides(r.markdown) : [{ text: r.markdown }];
    return { sections, meta: { ...(r.pages !== undefined ? { pages: r.pages } : {}), ...(r.tables.length ? { tables: r.tables } : {}), via: "markitdown", ...(r.notes.length ? { notes: r.notes } : {}) } };
  }

  private delimited(s: SniffResult, data: Buffer, name: string): Extraction {
    const parsed = readDelimited(decodeText(data), s.format === "tsv" ? "\t" : this.delimiterOf(data), name.replace(/\.[^.]+$/, "") || "Table");
    if (!parsed.text.trim()) throw new MediaError("unsupported", "That table has no rows.");
    const notes: string[] = [];
    if (parsed.truncated) notes.push("The table is bigger than I keep, so only its first rows can be searched. The facts for each column count every row I read.");
    if (parsed.columnsDropped) notes.push(`${parsed.columnsDropped} columns past the 40th were left out.`);
    return { sections: [{ text: parsed.text }], meta: { tables: [parsed.table], via: "csv", ...(notes.length ? { notes } : {}) } };
  }

  private delimiterOf(data: Buffer): string {
    const head = decodeText(data.subarray(0, 8192)).split(/\r?\n/).find((l) => l.trim()) ?? "";
    const counts = [",", ";", "\t", "|"].map((d) => [d, head.split(d).length - 1] as const).sort((a, b) => b[1] - a[1]);
    return counts[0]![1] > 0 ? counts[0]![0] : ",";
  }

  private plain(s: SniffResult, data: Buffer): Extraction {
    const text = decodeText(data).slice(0, TEXT_CHARS_MAX * 2);
    if (!text.trim()) throw new MediaError("unsupported", "That file has no text in it.");
    return { sections: [{ text }], lines: s.kind === "code", meta: { via: "text" } };
  }

  private async audio(s: SniffResult, data: Buffer, o: IngestOptions): Promise<Extraction> {
    if (!this.speech) throw new MediaError("not_configured", "Turning recordings into text isn't switched on on this server yet.", 503);
    const t = await this.speech.transcribe(data, s.mime, o.signal ? { signal: o.signal } : {});
    const notes = t.text.trim() ? [] : ["No speech was found in that recording."];
    return { sections: [{ text: t.text }], meta: { durationSeconds: t.seconds, ...(t.language ? { language: t.language } : {}), via: "deepgram", ...(notes.length ? { notes } : {}) } };
  }

  private async video(_s: SniffResult, data: Buffer, o: IngestOptions): Promise<Extraction> {
    if (!this.worker) throw needWorker("videos");
    const v = await this.worker.video(data);
    if (v.durationSeconds > VIDEO_SECONDS_MAX) throw new MediaError("too_long", `That video is ${Math.round(v.durationSeconds / 60)} minutes long, and I read ${VIDEO_SECONDS_MAX / 60} at most.`);
    const notes = [...v.notes];
    let text = "";
    let language: string | undefined;
    if (v.audio) {
      if (this.speech) {
        const t = await this.speech.transcribe(v.audio.data, v.audio.mime, o.signal ? { signal: o.signal } : {});
        text = t.text;
        language = t.language;
        if (!text.trim()) notes.push("No speech was found in the video.");
      } else notes.push("The video has sound, but turning speech into text isn't switched on on this server, so I only have the pictures.");
    } else notes.push("The video has no sound.");
    if (!text.trim() && !v.frames.length) throw new MediaError("unsupported", "I could not get a picture or any words out of that video.");
    const frames = v.frames.map((f, i) => ({ t: f.t, key: `/f${i}.jpg` }));
    return {
      sections: [{ text }], meta: { durationSeconds: v.durationSeconds, width: v.width, height: v.height, frames, via: "worker", ...(language ? { language } : {}), ...(notes.length ? { notes } : {}) },
      extra: v.frames.map((f, i) => ({ suffix: `/f${i}.jpg`, data: f.data, mime: "image/jpeg" })),
    };
  }

  private archive(s: SniffResult, data: Buffer, name: string): Extraction {
    const listing = s.zip;
    if (!listing) throw new MediaError("corrupt", "That zip file is damaged, so I could not open it.");
    const entries: NonNullable<MediaMeta["entries"]> = [];
    const sections: Section[] = [];
    const notes: string[] = [];
    let files = 0;
    let read = 0;
    let unsafe = 0;
    const lines: string[] = [];
    for (const [i, e] of listing.entries.entries()) {
      if (e.dir) continue;
      if (e.unsafe) { unsafe += 1; continue; }
      const t = sniffEntry(data, listing, i, e.path);
      let got = false;
      if ((t.kind === "text" || t.kind === "code" || t.kind === "data") && files < ZIP.readFiles) {
        if (e.size > ZIP.readPerFile) notes.push(`${e.path.slice(0, 80)} is too big to read here.`);
        else if (read + e.size > ZIP.readTotal) notes.push("The archive holds more text than I read, so some files are listed but not read.");
        else {
          const body = decodeText(readEntry(data, e, ZIP.readPerFile));
          if (body.trim()) {
            sections.push({ text: `## ${e.path.slice(0, 150)}\n\n${body}` });
            files += 1;
            read += e.size;
            got = true;
          }
        }
      }
      if (entries.length < 200) entries.push({ path: e.path.slice(0, 200), bytes: e.size, kind: t.kind as MediaKind, read: got });
      lines.push(`- ${e.path.slice(0, 150)} (${e.size < 1024 ? `${e.size} B` : `${Math.round(e.size / 1024)} KB`}, ${t.kind === "unsupported" ? "not read" : t.format})`);
    }
    if (unsafe) notes.push(`${unsafe} ${unsafe === 1 ? "entry has" : "entries have"} a name that points outside the folder, so I skipped ${unsafe === 1 ? "it" : "them"}.`);
    const nonText = entries.filter((e) => !e.read).length;
    if (nonText) notes.push(`${nonText} ${nonText === 1 ? "file was" : "files were"} listed but not read: only text and code inside a zip are read.`);
    sections.unshift({ text: `# ${name}\n\n${lines.length} files in the archive:\n\n${lines.slice(0, 300).join("\n")}` });
    return { sections, meta: { entries, via: "zip", ...(notes.length ? { notes } : {}) } };
  }

  // ------------------------------------------------------------------ a picture or a video's frames, described

  /** Replaces a file's text (a picture described, a video's frames read) and cuts it into chunks again. */
  async attachText(userId: string, id: string, text: string, metaPatch: Partial<MediaMeta> = {}): Promise<MediaItem | null> {
    const had = await this.store.get(userId, id, { light: true });
    if (!had) return null;
    const { chunks } = chunkSections([{ text }]);
    const { chunks: safe, withheld } = this.withhold(chunks);
    const joined = safe.map((c) => c.text).join("\n\n").slice(0, TEXT_CHARS_MAX);
    const meta: MediaMeta = { ...had.meta, ...metaPatch, chunks: safe.length, ...(withheld ? { withheld: (had.meta.withheld ?? 0) + withheld } : {}) };
    return this.store.setText(userId, id, joined, safe, meta);
  }

  /** A blob of an item, or null. */
  async bytesOf(item: MediaItem, suffix = ""): Promise<Buffer | null> {
    if (!this.blobs || !item.blobKey) return null;
    return this.blobs.get(`${item.blobKey}${suffix}`);
  }

  // ------------------------------------------------------------------ out

  /**
   * The part of a file a question is about, wrapped as untrusted data. A file whose text fits is given whole. Otherwise: the first chunk (for
   * orientation), then the chunks the full-text search ranks highest for the words of the question, in the order they come in the file, up to
   * `max` characters, with what was left out said. With no word in common, the start of the file.
   */
  async excerpt(userId: string, item: MediaItem, question: string, max = EXCERPT_CHARS): Promise<string> {
    if (item.chars === 0) return "";
    const total = item.meta.chunks ?? Math.ceil(item.chars / 900);
    let chosen: Chunk[];
    let note = "";
    if (item.chars <= max - 150) {
      chosen = await this.store.chunks(userId, item.id, CHUNKS_MAX);
    } else {
      const terms = queryTerms(question);
      const found = terms.length ? await this.store.search(userId, item.id, terms, 8) : [];
      const head = (await this.store.chunks(userId, item.id, 1))[0];
      chosen = [];
      let used = 0;
      const take = (c: Chunk): void => {
        const size = c.text.length + 60;
        if (chosen.some((x) => x.seq === c.seq) || used + size > max) return;
        chosen.push(c);
        used += size;
      };
      if (head) take(head);
      for (const c of found) take(c);
      if (!found.length) {
        for (const c of await this.store.chunks(userId, item.id, 4)) take(c);
        note = "[no part of the file shares words with the question: this is the start of it]";
      }
      chosen.sort((a, b) => a.seq - b.seq);
    }
    const body = chosen.map((c, i) => {
      const gap = i > 0 && c.seq > chosen[i - 1]!.seq + 1 ? "[… skipped …]\n" : "";
      const where = c.page !== undefined ? `page ${c.page}` : `part ${c.seq + 1}`;
      return `${gap}[${where}${c.heading ? ` · ${c.heading.slice(0, 80)}` : ""}]\n${c.text}`;
    });
    const parts = chosen.length >= total ? undefined : `${chosen.length} of ${total}`;
    return asUntrustedFile({ name: item.name, kind: item.kind, ...(parts ? { parts } : {}), body: [...(note ? [note] : []), ...body].join("\n\n") });
  }

  /** The chunks closest to some words, with no wrapper: for a caller that composes its own prompt. */
  async find(userId: string, id: string, question: string, limit = 6): Promise<Chunk[]> {
    const terms = queryTerms(question);
    return terms.length ? this.store.search(userId, id, terms, limit) : [];
  }

  // ------------------------------------------------------------------ keeping and letting go

  async keep(userId: string, id: string, keep: boolean): Promise<MediaItem | null> {
    return this.store.update(userId, id, { keep, expiresAt: this.expiry() });
  }

  private async drop(item: MediaItem): Promise<void> {
    await this.store.remove(item.userId, item.id);
    await this.dropBlobs(item);
  }

  private async dropBlobs(item: MediaItem): Promise<void> {
    if (!this.blobs || !item.blobKey) return;
    const keys = [item.blobKey, ...(item.meta.frames ?? []).map((f) => `${item.blobKey}${f.key}`)];
    for (const k of keys) {
      try { await this.blobs.delete(k); } catch (err) { this.log?.warn({ error: (err as Error)?.name }, "media: blob not deleted"); }
    }
  }

  /** Deletes a file of the person's, with its bytes. False when it is not theirs. */
  async remove(userId: string, id: string): Promise<boolean> {
    const item = await this.store.remove(userId, id);
    if (!item) return false;
    await this.dropBlobs(item);
    return true;
  }

  /** Deletes the files whose time is up (not the kept ones), with their bytes. Returns how many. */
  async sweep(limit = 200): Promise<number> {
    const old = await this.store.expired(this.now(), limit);
    let n = 0;
    for (const i of old) {
      try { await this.drop(i); n += 1; } catch (err) { this.log?.warn({ error: (err as Error)?.name }, "media: expired file not deleted"); }
    }
    return n;
  }

  /** A person's account is being deleted: their bytes go from the bucket (the rows go with the account). */
  async forAccountDelete(userId: string): Promise<number> {
    const all = await this.store.forUser(userId);
    for (const i of all) await this.dropBlobs(i);
    return all.length;
  }
}

/** A table of a stored item, for a chart or a table artifact: its first. */
export const firstTable = (i: Pick<MediaItem, "meta">): DataTable | null => i.meta.tables?.[0] ?? null;
