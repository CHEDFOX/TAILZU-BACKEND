/**
 * THE WORDS OF MEDIA AND FILES INGESTION: WHAT A FILE IS, HOW BIG IT MAY BE, AND WHAT BECAME OF IT.
 *
 * Plain shapes, the caps, and MediaError (a refusal written for a person). Nothing here reads the environment, a store or a network.
 * The story is in docs/media.md.
 */
import type { AttachmentKind } from "../front/types.js";

/** What a file IS, found from its bytes (sniff.ts), never from its name or what the client said. */
export const MEDIA_KINDS = [
  "image", "pdf", "document", "presentation", "spreadsheet", "data", "text", "code", "audio", "video", "archive", "unsupported",
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** The kind the front door's attachment registry files it under. */
export function attachmentKindOf(kind: MediaKind): AttachmentKind {
  switch (kind) {
    case "image": case "pdf": case "audio": case "video": case "text": case "code": case "archive": return kind;
    case "document": case "presentation": return "document";
    case "spreadsheet": case "data": return "data";
    default: return "other";
  }
}

const MB = 1024 * 1024;

/**
 * The most bytes of a file of each kind. A file over its cap is refused before anything is read from it. Text and code match the front
 * door's own (a megabyte); the rest are what the worker and the speech and vision providers can take in one go. Nothing is over 50 MB, which is
 * what an attachment ref (front/attachments.ts refFromBody) and the upload route's multipart limit (server.ts) allow.
 */
export const CAPS: Readonly<Record<Exclude<MediaKind, "unsupported">, number>> = {
  image: 10 * MB,
  pdf: 25 * MB,
  document: 25 * MB,
  presentation: 25 * MB,
  spreadsheet: 25 * MB,
  data: 10 * MB,
  text: 1 * MB,
  code: 1 * MB,
  audio: 50 * MB,
  video: 50 * MB,
  archive: 50 * MB,
};

/** The biggest file of any kind: what a route must be ready to hold. */
export const CAP_MAX = Math.max(...Object.values(CAPS));

/** A vision call is sent at most this many bytes of picture; a bigger one is made smaller by the worker first. */
export const VISION_BYTES_MAX = 4 * MB;

/** The most text kept from one file, and the most chunks it is cut into. */
export const TEXT_CHARS_MAX = 400_000;
export const CHUNKS_MAX = 600;

/** How long a file is kept unless the person keeps it. */
export const KEEP_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** A video longer than this is not read (the worker also holds it). */
export const VIDEO_SECONDS_MAX = 20 * 60;
/** Key frames of a video: at most this many are kept, and at most this many are shown to the vision tier. */
export const FRAMES_MAX = 8;
export const FRAMES_LOOKED_AT = 3;

/** A zip: what it may hold before it is taken for a bomb, and how much of it is read. */
export const ZIP = {
  entriesMax: 500,
  /** The sum of the sizes the entries SAY they have. */
  declaredTotalMax: 200 * MB,
  /** One entry's uncompressed size over its compressed size. */
  ratioMax: 100,
  /** The whole archive's, uncompressed over compressed (for archives big enough for the ratio to mean something). */
  totalRatioMax: 100,
  /** Text and code inside are read: this many files, this much of each, this much in all. */
  readFiles: 40,
  readPerFile: 256 * 1024,
  readTotal: 2 * MB,
} as const;

export type MediaErrorCode =
  | "empty" | "too_big" | "unsupported" | "password" | "bomb" | "corrupt" | "too_long" | "not_configured" | "worker_down" | "not_found" | "bad_request" | "failed";

/** A refusal or a failure with a sentence a person can read. */
export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode, message: string, readonly status = 400) {
    super(message);
    this.name = "MediaError";
  }
}

export const isMediaError = (e: unknown): e is MediaError => e instanceof MediaError;

/** What sniffing found. */
export interface Sniffed {
  kind: MediaKind;
  /** The format inside the kind: png, jpeg, webp, gif, pdf, docx, odt, epub, html, pptx, xlsx, csv, json, mp3, mp4, zip, ... */
  format: string;
  mime: string;
  /** For `unsupported`: why, in words. */
  why?: string;
}

/** A table read from a spreadsheet or a CSV: the rows a chart or a table artifact is made from. */
export interface DataTable {
  name: string;
  columns: string[];
  /** Cells are text or numbers; at most ROWS_MAX rows are kept. */
  rows: Array<Array<string | number | null>>;
  /** The number of rows the file had, which may be more than `rows` holds. */
  totalRows: number;
  /** Which columns are numbers throughout (by index). */
  numeric: number[];
}

export const ROWS_MAX = 500;
export const COLUMNS_MAX = 40;
export const TABLES_MAX = 6;

/** What is known of a file apart from its text. */
export interface MediaMeta {
  pages?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  language?: string;
  /** Archive: the entries listed. */
  entries?: Array<{ path: string; bytes: number; kind: MediaKind; read: boolean }>;
  /** Video: the key frames kept, as blobs. */
  frames?: Array<{ t: number; key: string }>;
  framesDescribed?: boolean;
  tables?: DataTable[];
  /** Said to the person alongside the answer ("scanned pages were read by the layout reader"). */
  notes?: string[];
  /** How many chunks were withheld because they looked like they held a secret. */
  withheld?: number;
  /** The way the text was got: unpdf, docling, markitdown, deepgram, vision, text. */
  via?: string;
  /** How many chunks the text is in. */
  chunks?: number;
}

export interface MediaItem {
  id: string;
  userId: string;
  /** Hex SHA-256 of the file as it came. What a read is kept under. */
  sha256: string;
  kind: MediaKind;
  format: string;
  mime: string;
  name: string;
  bytes: number;
  /**
   * The text taken out of it (a transcript, a description, a file's text), with what looked like a secret taken out. EMPTY when the item
   * was fetched without its text (the store's `light` reads), whatever `chars` says.
   */
  text: string;
  /** How many characters the text has. */
  chars: number;
  meta: MediaMeta;
  /** The blob's key in the store, or null when the file's bytes are not kept. */
  blobKey: string | null;
  keep: boolean;
  expiresAt: number;
  createdAt: number;
}

/** A piece of a file's text: what retrieval returns. */
export interface Chunk {
  seq: number;
  text: string;
  heading?: string;
  page?: number;
}

export interface FoundChunk extends Chunk {
  /** Higher is closer to the question. */
  score: number;
}

/** What the person is shown of a file: never its text or its storage key. */
export interface MediaView {
  id: string;
  name: string;
  kind: MediaKind;
  format: string;
  mime: string;
  bytes: number;
  sha256: string;
  chars: number;
  keep: boolean;
  expiresAt: number;
  createdAt: number;
  notes: string[];
  pages?: number;
  durationSeconds?: number;
  tables: Array<{ name: string; columns: string[]; totalRows: number }>;
}

export function viewOf(i: MediaItem): MediaView {
  return {
    id: i.id, name: i.name, kind: i.kind, format: i.format, mime: i.mime, bytes: i.bytes, sha256: i.sha256, chars: i.chars, keep: i.keep,
    expiresAt: i.expiresAt, createdAt: i.createdAt, notes: i.meta.notes ?? [],
    ...(i.meta.pages !== undefined ? { pages: i.meta.pages } : {}),
    ...(i.meta.durationSeconds !== undefined ? { durationSeconds: i.meta.durationSeconds } : {}),
    tables: (i.meta.tables ?? []).map((t) => ({ name: t.name, columns: t.columns, totalRows: t.totalRows })),
  };
}
