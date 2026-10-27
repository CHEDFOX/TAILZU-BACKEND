/**
 * UNPACKING A TARBALL INTO A JOB'S COPY, AS IT STREAMS, WITH THE BRAIN'S SKIP RULES AND A CAP.
 *
 * The room (jobs/src/jobRoom.ts) hands this a response body and a sink that writes into its SQLite; a test hands it a map. Each entry
 * is decided from its header (rules.ts skipReason), so a file that is not wanted is never buffered; a wanted one is decoded, hashed
 * as git hashes a blob (the sha a tree would show), and given to the sink. Nothing is held beyond the file being read.
 *
 * THE CAP. A copy holds at most 50 MB of text (WORKSPACE_MAX_BYTES) and 20,000 files. The moment the next file would pass either, or the
 * tarball turns out to be over 300 MB compressed or to inflate past 2 GB, reading STOPS and the result is `remote`: the room keeps nothing
 * (the caller clears the sink), and grep and glob are answered by the runner, which has the whole checkout. This is a size decision, not
 * an error: a repo that large is a repo whose checkout a runner is the right place to search.
 *
 * Anything else that goes wrong (a download that is cut short, a file that is not a tar) is thrown as it is, for the caller to say.
 */
import { createHash } from "node:crypto";
import { TarError, gunzipStream, readTar } from "../project/tar.js";
import { stripTop } from "../project/snapshot.js";
import { SKIPPED_MAX, TARBALL_EXPANDED_MAX_BYTES, TARBALL_MAX_BYTES, WORKSPACE_FILES_MAX, WORKSPACE_MAX_BYTES } from "./limits.js";
import { skipReason, textOf, type SkipReason } from "./rules.js";

export interface HeldWrite {
  path: string;
  /** The git blob id of the bytes. */
  sha: string;
  /** Bytes, as the archive gives them. */
  size: number;
  content: string;
  /** Seconds since the epoch when the archive says so, else 0. */
  mtime: number;
}

export interface WorkspaceSink {
  file(f: HeldWrite): void;
  /** A file that is in the repo and is not held (not a secret: those are not named at all). */
  skipped(path: string, size: number, reason: SkipReason): void;
}

export interface Unpacked {
  files: number;
  /** Bytes of text held. */
  bytes: number;
  skipped: number;
  /** The repo did not fit: nothing should be kept. */
  remote: boolean;
  /** Why it is remote, in a few words. */
  note?: string;
}

/** git's blob id of some bytes: sha1 of `blob <length>\0` and the bytes. */
export function blobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

export interface UnpackOptions {
  maxBytes?: number;
  maxFiles?: number;
  maxCompressed?: number;
  maxExpanded?: number;
}

export async function unpackTarball(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, sink: WorkspaceSink, o: UnpackOptions = {}): Promise<Unpacked> {
  const maxBytes = o.maxBytes ?? WORKSPACE_MAX_BYTES;
  const maxFiles = o.maxFiles ?? WORKSPACE_FILES_MAX;
  const result: Unpacked = { files: 0, bytes: 0, skipped: 0, remote: false };
  const remote = (note: string): Unpacked => ({ ...result, remote: true, note });

  const stream = gunzipStream(body, { maxCompressed: o.maxCompressed ?? TARBALL_MAX_BYTES });
  const entries = readTar(stream, {
    maxExpanded: o.maxExpanded ?? TARBALL_EXPANDED_MAX_BYTES,
    want: (e) => {
      const p = stripTop(e.path);
      return p !== null && skipReason(p, e.size) === null;
    },
  });
  try {
    for await (const e of entries) {
      if (e.kind !== "file") continue;
      const path = stripTop(e.path);
      if (path === null) continue;
      const why = skipReason(path, e.size);
      if (why === "secret") continue;
      if (why !== null) {
        if (result.skipped < SKIPPED_MAX) { sink.skipped(path, e.size, why); result.skipped += 1; }
        continue;
      }
      const data = e.data;
      if (!data) continue;
      const text = textOf(path, data);
      if (text === null) {
        if (result.skipped < SKIPPED_MAX) { sink.skipped(path, e.size, "binary"); result.skipped += 1; }
        continue;
      }
      if (result.bytes + e.size > maxBytes) return remote(`The code is over ${Math.round(maxBytes / (1024 * 1024))} MB of text.`);
      if (result.files + 1 > maxFiles) return remote(`The repo has more than ${maxFiles} files to hold.`);
      sink.file({ path, sha: blobSha(data), size: e.size, content: text, mtime: e.mtime ?? 0 });
      result.files += 1;
      result.bytes += e.size;
    }
  } catch (err) {
    if (err instanceof TarError && (err.code === "compressed_too_large" || err.code === "expanded_too_large")) return remote("The repo is too big to hold a copy of.");
    throw err;
  }
  return result;
}
