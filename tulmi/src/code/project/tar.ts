/**
 * A TAR READER, AS SMALL AS GITHUB'S TARBALLS NEED, AND NO SMALLER THAN SAFE.
 *
 * GitHub gives a repo at a commit as one gzipped tarball
 * (`GET /repos/{o}/{r}/tarball/{sha}`, a redirect to codeload): the whole code
 * in a single request, where the contents API would be one request a file. There
 * is no tar library in this project and none is added, so this reads the format
 * itself: a stream of 512-byte header blocks, each followed by its file's bytes
 * padded to a block.
 *
 * What it understands:
 *
 *   ustar            name, size (octal, or base-256 for a big one), type flag,
 *                    and the `prefix` field that continues a long name. The
 *                    prefix is used only where the magic really says ustar:
 *                    GNU's own format keeps other things in that place
 *   pax              `x` headers (the next entry's `path`, `linkpath`, `size`
 *                    and the rest, as "length key=value\n" records) and `g`
 *                    headers (global; GitHub writes one holding the commit)
 *   GNU long names   `L` (and `K`) entries: the next entry's name, as data
 *
 * Everything else (devices, fifos, sparse files, hard links) is passed on by
 * kind with its data skipped. A header whose checksum is wrong is a TarError,
 * and so is an archive that ends in the middle of an entry.
 *
 * It is a STREAM reader: it holds a block or two plus the file it is reading.
 * `want` decides, from the header alone, whether a file's bytes are kept; the
 * rest are skipped without being buffered, which is what makes a 300 MB
 * tarball cost memory for the few megabytes of source in it. Two limits are
 * enforced as the bytes go by, so a bomb is stopped, not waited for: the
 * compressed size (`gunzipStream`) and the inflated size (`maxExpanded`).
 *
 * Nothing here logs, and an error says what kind of thing was wrong, never a
 * path or the bytes.
 */
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

export type TarErrorCode = "bad_tar" | "truncated" | "compressed_too_large" | "expanded_too_large";

export class TarError extends Error {
  constructor(readonly code: TarErrorCode) {
    super(`tar: ${code}`);
    this.name = "TarError";
  }
}

export type TarKind = "file" | "dir" | "symlink" | "other";

export interface TarEntry {
  /** The name as the archive gives it (the pax path, or the long name, or prefix and name). Without a trailing slash. */
  path: string;
  kind: TarKind;
  /** The file's size in bytes (0 for anything but a file). */
  size: number;
  /** The file's bytes, when `want` said to keep them. */
  data?: Buffer;
}

export interface TarOptions {
  /** From the header only: keep this file's bytes? Default: none are. */
  want?: (e: { path: string; size: number }) => boolean;
  /** Stop with TarError("expanded_too_large") once this many bytes have come out of the gunzip. */
  maxExpanded?: number;
}

const BLOCK = 512;
/** pax and GNU long-name headers are small; a "header" of megabytes is an attack. */
const META_MAX = 1024 * 1024;
/** A file bigger than this is not an archive we are reading, whatever the header claims. */
const SIZE_MAX = 64 * 1024 * 1024 * 1024;

/** A queue of byte chunks that gives back exact lengths. */
class ByteQueue {
  private parts: Buffer[] = [];
  length = 0;
  push(b: Buffer): void { if (b.length) { this.parts.push(b); this.length += b.length; } }
  /** Exactly `n` bytes (the caller has checked there are that many). */
  take(n: number): Buffer {
    if (n === 0) return Buffer.alloc(0);
    const first = this.parts[0]!;
    if (first.length >= n) {
      const out = first.subarray(0, n);
      if (first.length === n) this.parts.shift(); else this.parts[0] = first.subarray(n);
      this.length -= n;
      return out;
    }
    const out = Buffer.allocUnsafe(n);
    let at = 0;
    while (at < n) {
      const p = this.parts[0]!;
      const use = Math.min(p.length, n - at);
      p.copy(out, at, 0, use);
      at += use;
      if (use === p.length) this.parts.shift(); else this.parts[0] = p.subarray(use);
    }
    this.length -= n;
    return out;
  }
  /** Drops up to `n` bytes; returns how many went. */
  drop(n: number): number {
    let left = n;
    while (left > 0 && this.parts.length) {
      const p = this.parts[0]!;
      const use = Math.min(p.length, left);
      if (use === p.length) this.parts.shift(); else this.parts[0] = p.subarray(use);
      left -= use;
    }
    const dropped = n - left;
    this.length -= dropped;
    return dropped;
  }
}

/** A header field as text: up to the first NUL. */
function field(b: Buffer, from: number, to: number): string {
  const end = b.indexOf(0, from);
  return b.toString("utf8", from, end >= 0 && end < to ? end : to);
}

/** An octal field (or a base-256 one, where the top bit of the first byte is set). NaN when it is neither. */
function number(b: Buffer, from: number, to: number): number {
  if ((b[from]! & 0x80) !== 0) {
    // base-256, big-endian, the top bit is the marker
    let n = b[from]! & 0x7f;
    for (let i = from + 1; i < to; i += 1) n = n * 256 + b[i]!;
    return n;
  }
  const s = field(b, from, to).replace(/[\s]+/g, "");
  if (s === "") return 0;
  return /^[0-7]+$/.test(s) ? parseInt(s, 8) : NaN;
}

function checksumOk(h: Buffer): boolean {
  const stored = number(h, 148, 156);
  if (!Number.isFinite(stored)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 32 : h[i]!;
  return sum === stored;
}

/** pax records: "<length> <key>=<value>\n", the length counting the whole record. */
function paxRecords(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space < 0) break;
    const len = Number(data.toString("ascii", pos, space));
    if (!Number.isInteger(len) || len <= space - pos + 1 || pos + len > data.length) throw new TarError("bad_tar");
    const rec = data.toString("utf8", space + 1, pos + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    pos += len;
  }
  return out;
}

const kindOf = (flag: number): TarKind => {
  switch (String.fromCharCode(flag)) {
    case "0": case "\0": case "7": return "file";
    case "5": return "dir";
    case "2": return "symlink";
    default: return "other";
  }
};

/**
 * The entries of a tar stream, in order. A regular file `want` approved has its
 * `data`; every other entry is reported without any. Throws TarError.
 */
export async function* readTar(source: AsyncIterable<Uint8Array>, o: TarOptions = {}): AsyncGenerator<TarEntry, void, void> {
  const it = source[Symbol.asyncIterator]();
  const q = new ByteQueue();
  let expanded = 0;
  let ended = false;
  const max = o.maxExpanded ?? Number.POSITIVE_INFINITY;

  const more = async (): Promise<boolean> => {
    if (ended) return false;
    const r = await it.next();
    if (r.done) { ended = true; return false; }
    expanded += r.value.byteLength;
    if (expanded > max) throw new TarError("expanded_too_large");
    q.push(Buffer.from(r.value.buffer, r.value.byteOffset, r.value.byteLength));
    return true;
  };
  /** Exactly n bytes, or null at a clean end (nothing buffered); a short end is "truncated". */
  const read = async (n: number): Promise<Buffer | null> => {
    while (q.length < n) {
      if (!(await more())) {
        if (q.length === 0) return null;
        throw new TarError("truncated");
      }
    }
    return q.take(n);
  };
  const skip = async (n: number): Promise<void> => {
    let left = n;
    while (left > 0) {
      if (q.length === 0 && !(await more())) throw new TarError("truncated");
      left -= q.drop(left);
    }
  };
  const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

  let longName: string | null = null;
  let pax: Record<string, string> = {};

  try {
    for (;;) {
      const h = await read(BLOCK);
      if (h === null) return;
      // An all-zero block is the end of the archive (there are two; one is enough).
      if (h.every((b) => b === 0)) return;
      if (!checksumOk(h)) throw new TarError("bad_tar");

      const flag = h[156]!;
      let size = number(h, 124, 136);
      if (!Number.isFinite(size) || size < 0 || size > SIZE_MAX) throw new TarError("bad_tar");

      const letter = String.fromCharCode(flag);
      if (letter === "x" || letter === "g" || letter === "L" || letter === "K") {
        if (size > META_MAX) throw new TarError("bad_tar");
        const data = size ? await read(size) : Buffer.alloc(0);
        if (data === null) throw new TarError("truncated");
        await skip(padding(size));
        if (letter === "x") pax = { ...pax, ...paxRecords(data) };
        else if (letter === "L") longName = field(data, 0, data.length);
        // `g` is global and `K` is a link name: neither names a file, and nothing here uses them.
        continue;
      }

      // The name: a pax path beats a GNU long name, which beats prefix and name.
      let path = field(h, 0, 100);
      const magic = h.toString("latin1", 257, 263);
      const version = h.toString("latin1", 263, 265);
      if (magic === "ustar\0" && version === "00") {
        const prefix = field(h, 345, 500);
        if (prefix) path = `${prefix}/${path}`;
      }
      if (longName !== null) path = longName;
      if (typeof pax.path === "string" && pax.path) path = pax.path;
      if (typeof pax.size === "string" && /^\d+$/.test(pax.size)) size = Number(pax.size);
      longName = null;
      pax = {};
      path = path.replace(/\/+$/, "");

      const kind = kindOf(flag);
      const dataSize = kind === "file" || kind === "other" ? size : 0;
      if (kind === "file" && o.want?.({ path, size })) {
        const data = size ? await read(size) : Buffer.alloc(0);
        if (data === null) throw new TarError("truncated");
        await skip(padding(size));
        yield { path, kind, size, data };
      } else {
        await skip(dataSize + (dataSize ? padding(dataSize) : 0));
        yield { path, kind, size: kind === "file" ? size : 0 };
      }
    }
  } finally {
    // The caller stopped early or we did: let go of the source.
    await it.return?.().catch(() => undefined);
  }
}

/**
 * The bytes of a gzipped response, inflated as they arrive. More than
 * `maxCompressed` bytes of the gzip itself is TarError("compressed_too_large"),
 * raised as the bytes cross the line, not after the download.
 */
export function gunzipStream(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, o: { maxCompressed: number }): AsyncIterable<Buffer> {
  const source = typeof (body as ReadableStream<Uint8Array>).getReader === "function"
    ? Readable.fromWeb(body as never)
    : Readable.from(body as AsyncIterable<Uint8Array>, { objectMode: false });
  let seen = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > o.maxCompressed) cb(new TarError("compressed_too_large"));
      else cb(null, chunk);
    },
  });
  const gunzip = createGunzip();
  // pipeline destroys every stream with the first error, and the reader of `gunzip` hears it.
  void pipeline(source, counter, gunzip).catch(() => undefined);
  return gunzip as unknown as AsyncIterable<Buffer>;
}
