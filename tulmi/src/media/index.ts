/**
 * MEDIA AND FILES INGESTION. The story is in docs/media.md; the worker is media-worker/.
 *
 *   types.ts       kinds, caps, MediaError, MediaItem
 *   sniff.ts       a file's kind from its magic bytes, never its name
 *   zip.ts         a zip reader with the guards against a bomb
 *   strip.ts       a picture's metadata taken out, and its size read
 *   sigv4.ts       AWS Signature V4, our own, for R2
 *   blob.ts        where the bytes are kept: R2 (S3 API), or memory
 *   store.ts       media_items and media_chunks (migration 0035): Supabase, or memory
 *   chunk.ts       text in pieces, and the search over them (the memory twin of Postgres full-text search)
 *   tabular.ts     CSV and TSV into rows, facts over every row, and a DataTable
 *   pdf.ts         unpdf for a PDF with a text layer
 *   speech.ts      Deepgram
 *   worker.ts      the signed call to the Python worker
 *   service.ts     MediaService: ingest, excerpt, keep, remove, sweep
 *   untrusted.ts   a file's text as it goes into a prompt
 *   dataartifact.ts  a chart or a table artifact from rows, by code
 *   attach.ts      the front door's attachment handler and the typer
 *   assets.ts      "add this logo to the project" through the workspace
 *
 * Off unless MEDIA_INGEST=true (config.ts). Nothing here reaches a network or a store unless it is called to; every piece takes its dependencies
 * as arguments, so the tests drive it with fakes.
 */
import { getConfig } from "../config.js";
import { blobStoreFromConfig, type BlobStore } from "./blob.js";
import { MediaService, type MediaDeps } from "./service.js";
import { transcriberFromConfig } from "./speech.js";
import { MemoryMediaStore, mediaStore } from "./store.js";
import { workerFromConfig } from "./worker.js";

export * from "./types.js";
export { sniff, decodeText, looksLikeText, tableDelimiter } from "./sniff.js";
export { readZip, readEntry, unsafeName } from "./zip.js";
export { stripMetadata, imageSize } from "./strip.js";
export { sign, presign, signingKey } from "./sigv4.js";
export { MemoryBlobStore, R2BlobStore, blobKey, blobStoreFromConfig } from "./blob.js";
export type { BlobStore } from "./blob.js";
export { MemoryMediaStore, SupabaseMediaStore, mediaStore, resetMediaStoreForTests } from "./store.js";
export type { MediaStore, NewItem } from "./store.js";
export { chunkText, chunkSections, chunkLines, findChunks, queryTerms, tokens } from "./chunk.js";
export { readDelimited, parseDelimited, toNumber, makeTable } from "./tabular.js";
export { readPdf, looksHard } from "./pdf.js";
export { DeepgramTranscriber, transcriberFromConfig } from "./speech.js";
export type { Transcriber } from "./speech.js";
export { HttpWorker, workerFromConfig, workerSignature } from "./worker.js";
export type { WorkerClient } from "./worker.js";
export { MediaService, EXCERPT_CHARS, htmlToText, splitSlides, splitPages } from "./service.js";
export { asUntrustedFile } from "./untrusted.js";
export { makeDataArtifact, chartable, chartSource, tableSource } from "./dataartifact.js";
export { mediaHandler, registerMedia, retypeFromBytes } from "./attach.js";
export { insertAsset, habitsOf, unsafeSvg, ASSET_USES, isAssetUse } from "./assets.js";

export interface MediaOptions extends Partial<MediaDeps> {
  /** Make it even when MEDIA_INGEST is off (tests). */
  force?: boolean;
}

/** The media service from the environment (R2, the worker, Deepgram, Supabase), or null while MEDIA_INGEST is off. */
export function createMedia(o: MediaOptions = {}): MediaService | null {
  const cfg = getConfig();
  if (!cfg.MEDIA_INGEST && !o.force) return null;
  const { force: _force, ...rest } = o;
  void _force;
  const store = rest.store ?? mediaStore();
  // Bytes in a bucket with an index in memory would outlive the only thing that knows they are there (a restart forgets it, and the sweep never finds them).
  let blobs: BlobStore | null;
  if ("blobs" in rest) blobs = rest.blobs ?? null;
  else {
    blobs = blobStoreFromConfig();
    if (blobs && store instanceof MemoryMediaStore) {
      console.warn("[media] R2 is configured but there is no database (SUPABASE_SERVICE_KEY): the bytes of files are NOT kept, because nothing would remember where they are.");
      blobs = null;
    }
  }
  return new MediaService({
    store, blobs,
    worker: "worker" in rest ? rest.worker ?? null : workerFromConfig(),
    speech: "speech" in rest ? rest.speech ?? null : transcriberFromConfig(),
    keepDays: rest.keepDays ?? cfg.MEDIA_KEEP_DAYS,
    ...(rest.now ? { now: rest.now } : {}), ...(rest.log ? { log: rest.log } : {}),
  });
}

/** Deletes the files whose time is up, now and then, for as long as the server runs. Returns the stop. */
export function startMediaSweep(media: MediaService, o: { everyMs?: number; log?: { warn(o: object, msg: string): void } } = {}): () => void {
  const timer = setInterval(() => {
    media.sweep().catch((err) => o.log?.warn({ error: (err as Error)?.name }, "media: sweep failed"));
  }, o.everyMs ?? 60 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
