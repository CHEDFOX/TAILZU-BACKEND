/**
 * WHAT IS ATTACHED: A REGISTRY OF HANDLERS BY KIND, A READ THAT HAPPENS ONCE, AND ONLY THE PART THAT MATTERS GOES TO A MODEL.
 *
 *   image       the VISION tier, once: "describe what is there" (role front_look). The description is what a reply is made from
 *   text, code  read directly (no model), capped, decoded as text; for a question, only the relevant windows of it are sent on
 *   audio, video, pdf, other
 *               a clear "coming soon" until the media feature ships; no model is called and nothing is guessed
 *
 * An AttachmentRef is the file's metadata: id, kind, mime, bytes, sha256, name. The bytes themselves come with the request (`data`,
 * base64) the first time. What was read is KEPT BY SHA-256 (per person), so the same file in a later message is read once: a follow-up
 * question about it sends only its ref, and the cached text is searched again for the new question, for nothing. A checksum the
 * client gives is checked against the bytes when there are bytes; the one the cache is keyed on is always the computed one.
 *
 * Caps keep a file from being a way to spend money or memory: at most 4 files a message, images up to 4 MB, text and code up to
 * 1 MB (the first 200,000 characters are read), at most 3,500 characters of a file reach a model, and a text the secret scan flags
 * is not sent at all (code/work/model.ts forModel).
 *
 * The handlers are a registry, so the media feature adds a kind by registering one. Nothing here reads the environment or a store.
 */
import { createHash } from "node:crypto";
import type { Budget } from "../code/brain/gateway.js";
import { forModel } from "../code/work/model.js";
import { CAP_PAISE } from "../artifacts/types.js";
import { askText, type FrontModel } from "./model.js";
import { comingSoon, type Lang } from "./words.js";
import { ATTACHMENT_KINDS, type AttachmentKind, type AttachmentRef, type FileNote } from "./types.js";

export const ATTACHMENTS_MAX = 4;
export const IMAGE_BYTES_MAX = 4 * 1024 * 1024;
export const TEXT_BYTES_MAX = 1024 * 1024;
export const TEXT_CHARS_READ = 200_000;
/** The most of one file that is sent to a model. */
export const RELEVANT_CHARS = 3_500;
const WINDOW_LINES = 10;
const HEAD_LINES = 8;
const IMAGE_MIME = /^image\/(?:png|jpe?g|webp|gif)$/i;

/** One attachment as it arrives: its ref, and its bytes the first time. */
export interface AttachmentInput {
  ref: AttachmentRef;
  data?: Buffer;
}

export interface ReadCtx {
  question: string;
  lang: Lang;
  model: FrontModel;
  /** The most the reading of one file may cost. */
  budget: Budget;
}

export interface Extracted {
  /** The text a reply is made from: a file's text, or an image's description. */
  text: string;
  /** "unreadable": the bytes are not text (or not a picture) and nothing was made of them. */
  status: "read" | "described" | "unreadable";
  note?: string;
  paise: number;
}

export interface AttachmentHandler {
  readonly kinds: readonly AttachmentKind[];
  extract(input: { ref: AttachmentRef; data: Buffer }, ctx: ReadCtx): Promise<Extracted>;
  /** The part of the extracted text that matters for the question; the text cut to size when a handler has no better idea. */
  relevant?(text: string, question: string, max: number, kind: AttachmentKind): string;
}

// ------------------------------------------------------------------ the kinds

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|dart|vue|svelte|php|rb|c|h|cc|cpp|hpp|cs|sh|bash|zsh|sql|css|scss|html|xml|json|ya?ml|toml|ini|gradle|lua|r|scala|ex|exs|clj|hs|tf)$/i;
const TEXT_EXT = /\.(?:txt|md|markdown|csv|tsv|log|rtf|tex|srt|vtt|env\.example)$/i;

/** What kind of file this is, from what the client says it is and what it is called. */
export function kindOf(mime: string, name: string): AttachmentKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (CODE_EXT.test(name) || /(?:javascript|typescript|json|xml|yaml|x-sh|x-python|sql)/.test(m)) return "code";
  if (m.startsWith("text/") || TEXT_EXT.test(name)) return "text";
  return "other";
}

/** One attachment from a request's body, or why not. */
export function refFromBody(v: unknown): { ok: true; input: AttachmentInput } | { ok: false; why: string } {
  if (!v || typeof v !== "object") return { ok: false, why: "an attachment is an object" };
  const o = v as Record<string, unknown>;
  const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.length > 0 && x.length <= max ? x : null);
  const id = str(o.id, 100);
  const name = str(o.name, 200);
  const mime = typeof o.mime === "string" && o.mime.length <= 100 ? o.mime : "";
  if (!id || !name) return { ok: false, why: "an attachment needs an id and a name" };
  if (!Number.isFinite(o.bytes) || (o.bytes as number) < 0 || (o.bytes as number) > 50 * 1024 * 1024) return { ok: false, why: "bytes is the file's size, up to 50 MB" };
  const sha = typeof o.sha256 === "string" && /^[0-9a-f]{64}$/i.test(o.sha256) ? o.sha256.toLowerCase() : null;
  if (!sha) return { ok: false, why: "sha256 is the file's SHA-256, in hex" };
  const kind = (ATTACHMENT_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as AttachmentKind) : kindOf(mime, name);
  let data: Buffer | undefined;
  if (o.data !== undefined) {
    if (typeof o.data !== "string" || o.data.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/=\s]*$/.test(o.data)) return { ok: false, why: "data is the file's bytes, in base64, up to 6 MB" };
    data = Buffer.from(o.data, "base64");
  }
  return { ok: true, input: { ref: { id, kind, mime, bytes: Math.round(o.bytes as number), sha256: sha, name }, ...(data ? { data } : {}) } };
}

// ------------------------------------------------------------------ the relevant part

const STOP = new Set(["the", "and", "for", "that", "this", "with", "what", "which", "where", "when", "how", "does", "are", "was", "from", "have", "has", "can", "about", "kya", "hai", "mein", "yeh", "woh", "kaun", "kaise"]);
const wordsOf = (q: string): string[] => [...new Set((q.toLowerCase().match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 12);

/**
 * The windows of a text that share the most words with the question, in the order they come, with the head of the file first for
 * orientation, and what was left out marked. A text that fits is returned whole. `numbered` puts line numbers in front, so a reply can cite a line.
 * A window too big for the room that is left is cut down around the line that matches best, so a file of long lines still yields its answer.
 */
export function relevantPart(text: string, question: string, max: number, numbered: boolean): string {
  const lines = text.split("\n");
  const label = (i: number, l: string): string => `${numbered ? `${i + 1}: ` : ""}${l.length > 300 ? `${l.slice(0, 299)}…` : l}`;
  const rendered = lines.map((l, i) => label(i, l));
  const whole = rendered.join("\n");
  if (whole.length <= max) return whole;
  const q = wordsOf(question);
  const hits = (i: number): number => { const l = lines[i]!.toLowerCase(); return q.reduce((n, w) => n + (l.includes(w) ? 1 : 0), 0); };
  const MARK = 40;
  const span = (from: number, to: number): string => rendered.slice(from, to).join("\n");

  const head = { from: 0, to: Math.min(lines.length, HEAD_LINES) };
  const chosen: Array<{ from: number; to: number }> = [head];
  let size = span(head.from, head.to).length;

  const windows: Array<{ from: number; to: number; score: number; best: number }> = [];
  for (let from = head.to; from < lines.length; from += WINDOW_LINES) {
    const to = Math.min(lines.length, from + WINDOW_LINES);
    let score = 0;
    let best = from;
    let bestHits = -1;
    for (let i = from; i < to; i += 1) {
      const h = hits(i);
      if (h > 0) score += h;
      if (h > bestHits) { bestHits = h; best = i; }
    }
    if (score > 0) windows.push({ from, to, score, best });
  }
  for (const w of windows.sort((a, b) => b.score - a.score || a.from - b.from)) {
    let { from, to } = w;
    // Too big for the room: the lines nearest the best match, as many as fit.
    while (to - from > 1 && size + span(from, to).length + MARK > max) {
      if (w.best - from >= to - 1 - w.best) from += 1; else to -= 1;
    }
    const part = span(from, to);
    if (size + part.length + MARK > max) continue;
    chosen.push({ from, to });
    size += part.length + MARK;
  }

  // With nothing matching, the start of the file is what there is.
  if (chosen.length === 1) {
    const extra = rendered.slice(head.to).join("\n");
    return `${span(head.from, head.to)}\n${extra.slice(0, Math.max(0, max - size - MARK))}\n[… the rest is left out]`;
  }
  chosen.sort((a, b) => a.from - b.from);
  const out: string[] = [];
  let at = 0;
  for (const w of chosen) {
    if (w.from > at) out.push(`[… lines ${at + 1}-${w.from} left out …]`);
    out.push(span(w.from, w.to));
    at = w.to;
  }
  if (at < lines.length) out.push(`[… lines ${at + 1}-${lines.length} left out …]`);
  return out.join("\n");
}

// ------------------------------------------------------------------ the handlers

/** Text and code: decoded, capped, no model. */
export const textHandler: AttachmentHandler = {
  kinds: ["text", "code"],
  async extract({ data }) {
    const head = data.subarray(0, 8_000);
    if (head.includes(0)) return { text: "", status: "unreadable", paise: 0 };
    let text = data.subarray(0, TEXT_BYTES_MAX).toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const cut = text.length > TEXT_CHARS_READ;
    return { text: cut ? text.slice(0, TEXT_CHARS_READ) : text, status: "read", ...(cut ? { note: "only the first 200,000 characters were read" } : {}), paise: 0 };
  },
  // Code is cited by line, so it is numbered; prose is not.
  relevant: (text, question, max, kind) => relevantPart(text, question, max, kind === "code"),
};

/** An image: described once by the vision tier. */
export const imageHandler: AttachmentHandler = {
  kinds: ["image"],
  async extract({ ref, data }, ctx) {
    const mime = IMAGE_MIME.test(ref.mime) ? ref.mime : "image/png";
    const url = `data:${mime};base64,${data.toString("base64")}`;
    const r = await askText(ctx.model, {
      role: "front_look", tier: "vision", purpose: "front.look", maxTokens: 500, budget: ctx.budget,
      user: [{ type: "text", text: `Question: ${forModel(ctx.question).slice(0, 600)}` }, { type: "image_url", image_url: { url } }],
    });
    return { text: r.text, status: "described", paise: r.paise };
  },
  relevant: (text, _q, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text),
};

// ------------------------------------------------------------------ the cache

interface Kept { text: string; status: "read" | "described"; note?: string; kind: AttachmentKind }

/** What was read, by person and checksum: bounded in files and in characters, and forgotten after half an hour. */
export class AttachmentCache {
  private readonly entries = new Map<string, Kept & { at: number }>();
  private chars = 0;

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 30 * 60_000, private readonly maxEntries = 200, private readonly maxChars = 4_000_000) {}

  get(userId: string, sha: string): Kept | undefined {
    const k = `${userId}:${sha}`;
    const e = this.entries.get(k);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.drop(k); return undefined; }
    this.entries.delete(k);
    this.entries.set(k, e);
    return e;
  }

  set(userId: string, sha: string, v: Kept): void {
    const k = `${userId}:${sha}`;
    this.drop(k);
    this.entries.set(k, { ...v, at: this.now() });
    this.chars += v.text.length;
    while (this.entries.size > this.maxEntries || this.chars > this.maxChars) this.drop(this.entries.keys().next().value!);
  }

  private drop(k: string): void {
    const e = this.entries.get(k);
    if (e) { this.chars -= e.text.length; this.entries.delete(k); }
  }

  get size(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); this.chars = 0; }
}

// ------------------------------------------------------------------ the registry

export interface ReadFile {
  name: string;
  kind: AttachmentKind;
  /** The part to send a model. */
  text: string;
}

export interface ReadResult {
  files: ReadFile[];
  notes: FileNote[];
  paise: number;
}

export const sha256Of = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

export class AttachmentRegistry {
  private readonly handlers = new Map<AttachmentKind, AttachmentHandler>();
  readonly cache: AttachmentCache;

  constructor(o: { cache?: AttachmentCache; handlers?: readonly AttachmentHandler[] } = {}) {
    this.cache = o.cache ?? new AttachmentCache();
    for (const h of o.handlers ?? [textHandler, imageHandler]) this.register(h);
  }

  /** A handler for the kinds it names; the media feature registers its own for audio, video and PDFs. */
  register(h: AttachmentHandler): void {
    for (const k of h.kinds) this.handlers.set(k, h);
  }

  handles(kind: AttachmentKind): boolean { return this.handlers.has(kind); }

  async read(userId: string, inputs: readonly AttachmentInput[], ctx: ReadCtx): Promise<ReadResult> {
    const out: ReadResult = { files: [], notes: [], paise: 0 };
    for (const [i, input] of inputs.entries()) {
      const { ref, data } = input;
      const note = (status: FileNote["status"], words?: string): void => { out.notes.push({ id: ref.id, name: ref.name, kind: ref.kind, status, ...(words ? { note: words } : {}) }); };
      if (i >= ATTACHMENTS_MAX) { note("too_big", `Only the first ${ATTACHMENTS_MAX} files of a message are read.`); continue; }
      const handler = this.handlers.get(ref.kind);
      if (!handler) { note("coming_soon", comingSoon(ref.kind, ctx.lang)); continue; }

      // The checksum the cache is keyed on is the computed one. A client's that does not match the bytes is a file that is not what it says.
      const sha = data ? sha256Of(data) : ref.sha256;
      if (data && sha !== ref.sha256) { note("unreadable", "The file does not match its checksum, so it was not read."); continue; }

      let kept = this.cache.get(userId, sha);
      let cached = true;
      if (!kept) {
        cached = false;
        if (!data) { note("missing", "I no longer have that file. Attach it again."); continue; }
        const cap = ref.kind === "image" ? IMAGE_BYTES_MAX : TEXT_BYTES_MAX;
        if (data.length > cap) { note("too_big", `That file is over ${Math.round(cap / 1024 / 1024)} MB, which is the most I read.`); continue; }
        if (ref.kind === "image" && !IMAGE_MIME.test(ref.mime)) { note("unreadable", "I can read PNG, JPEG, WebP and GIF pictures."); continue; }
        const got = await handler.extract({ ref, data }, ctx);
        out.paise += got.paise;
        if (got.status === "unreadable" || !got.text.trim()) { note("unreadable", "I could not read that file as text."); continue; }
        kept = { text: got.text, status: got.status, kind: ref.kind, ...(got.note ? { note: got.note } : {}) };
        this.cache.set(userId, sha, kept);
      }
      const part = (handler.relevant ?? ((t: string, _q: string, m: number) => t.slice(0, m)))(kept.text, ctx.question, RELEVANT_CHARS, ref.kind);
      out.files.push({ name: ref.name, kind: ref.kind, text: forModel(part) });
      note(cached ? "cached" : kept.status, kept.note);
    }
    return out;
  }
}

/** What a vision call may cost: the artifact core's own cap for one. */
export const LOOK_CAP_PAISE = CAP_PAISE.vision;
