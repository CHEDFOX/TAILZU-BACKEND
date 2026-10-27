/**
 * A ZIP READER THAT DOES NOT TRUST THE ZIP: THE CENTRAL DIRECTORY, THE GUARDS AGAINST A BOMB, AND NOTHING WRITTEN TO DISK.
 *
 * Used for a plain .zip (list it, read the text and code inside) and, before the worker ever sees it, for the zip every docx, xlsx, pptx,
 * odt and epub is. Nothing is extracted to a path: a name is only ever a label, and one that would leave the folder (`..`, a leading `/`,
 * a backslash, a drive letter) is marked `unsafe` and never read.
 *
 * THE GUARDS (limits in types.ts ZIP), all checked on the directory before one byte is inflated:
 *   - at most `entriesMax` entries (the directory is walked only that far, whatever count it claims);
 *   - the sizes the entries SAY they have add up to at most `declaredTotalMax`;
 *   - no entry expands more than `ratioMax` times (once it is over a megabyte), and nor does the archive as a whole (over 10 MB);
 *   - a size of 4 GB or more (the zip64 marker) is refused as it stands.
 * And while inflating: the output is cut off at the most asked for (`maxOutputLength`), and an entry that turns out bigger than it said
 * is a lie about its size, so a bomb. An entry that is encrypted is a password-protected archive: refused with that said.
 *
 * Zip64 is read for the counts and offsets (an archive of a few thousand files); the zip64 extra field is read for sizes. Spanned and
 * split archives are not supported. Pure: the bytes in, a listing or a MediaError out.
 */
import { crc32, inflateRawSync } from "node:zlib";
import { MediaError, ZIP } from "./types.js";

export interface ZipEntry {
  path: string;
  compressed: number;
  size: number;
  method: number;
  crc: number;
  offset: number;
  dir: boolean;
  /** A name that would leave the folder it is extracted to: never read. */
  unsafe: boolean;
}

export interface ZipListing {
  entries: ZipEntry[];
}

export interface ZipLimits {
  entriesMax: number;
  declaredTotalMax: number;
  ratioMax: number;
  totalRatioMax: number;
}

const U32_MAX = 0xffffffff;
const RATIO_FROM = 1024 * 1024;
const TOTAL_RATIO_FROM = 10 * 1024 * 1024;

const corrupt = (): MediaError => new MediaError("corrupt", "That zip file is damaged, so I could not open it.");
const bomb = (why: string): MediaError => new MediaError("bomb", `I did not open that archive: ${why} That is what a zip bomb looks like, and opening one could take the server down.`);

/** A name that would leave the folder it is extracted into. */
export function unsafeName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.startsWith("/") || name.includes("\\") || /(?:^|\/)\.\.(?:\/|$)/.test(name) || /^[A-Za-z]:/.test(name) || /[\u0000-\u001f]/.test(name);
}

function findEocd(buf: Buffer): number {
  const from = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= from; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

export function readZip(buf: Buffer, limits: ZipLimits = ZIP): ZipListing {
  if (buf.length < 22) throw corrupt();
  const eocd = findEocd(buf);
  if (eocd < 0) throw corrupt();
  let total = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) throw new MediaError("unsupported", "Split zip files are not supported. Put it in one file and send it again.");

  if (total === 0xffff || cdSize === U32_MAX || cdOffset === U32_MAX) {
    // Zip64: the locator sits just before the end record and points at the zip64 end record.
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw corrupt();
    const rec = Number(buf.readBigUInt64LE(loc + 8));
    if (!Number.isSafeInteger(rec) || rec < 0 || rec + 56 > buf.length || buf.readUInt32LE(rec) !== 0x06064b50) throw corrupt();
    total = Number(buf.readBigUInt64LE(rec + 32));
    cdSize = Number(buf.readBigUInt64LE(rec + 40));
    cdOffset = Number(buf.readBigUInt64LE(rec + 48));
  }
  if (total > limits.entriesMax) throw bomb(`it says it holds ${total} files, and I read at most ${limits.entriesMax}.`);
  if (cdOffset + cdSize > buf.length) throw corrupt();

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  let declared = 0;
  let compressedTotal = 0;
  for (let n = 0; n < total; n += 1) {
    if (p + 46 > end || buf.readUInt32LE(p) !== 0x02014b50) throw corrupt();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let compressed = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > end) throw corrupt();
    const utf8 = (flags & 0x800) !== 0;
    const path = buf.subarray(p + 46, p + 46 + nameLen).toString(utf8 ? "utf8" : "latin1");
    if (flags & 1) throw new MediaError("password", "That zip file is password-protected. I can't open it. Take the password off and send it again.");
    if (size === U32_MAX || compressed === U32_MAX || offset === U32_MAX) {
      // The zip64 extra field holds the real values, in this order, for the fields that were 0xFFFFFFFF.
      const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      let q = 0;
      let found = false;
      while (q + 4 <= extra.length) {
        const id = extra.readUInt16LE(q);
        const len = extra.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          const take = (): number => { const v = Number(extra.readBigUInt64LE(r)); r += 8; return v; };
          try {
            if (size === U32_MAX) size = take();
            if (compressed === U32_MAX) compressed = take();
            if (offset === U32_MAX) offset = take();
          } catch { throw corrupt(); }
          found = true;
          break;
        }
        q += 4 + len;
      }
      if (!found) throw corrupt();
    }
    if (size >= 4 * 1024 * 1024 * 1024) throw bomb("one file in it says it is 4 GB or more.");
    declared += size;
    compressedTotal += compressed;
    if (declared > limits.declaredTotalMax) throw bomb(`its files add up to more than ${Math.round(limits.declaredTotalMax / 1024 / 1024)} MB once opened.`);
    if (size > RATIO_FROM && size / Math.max(compressed, 1) > limits.ratioMax) throw bomb(`"${path.slice(0, 80)}" would grow more than ${limits.ratioMax} times.`);
    const dir = path.endsWith("/");
    entries.push({ path, compressed, size, method, crc, offset, dir, unsafe: unsafeName(path) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (declared > TOTAL_RATIO_FROM && declared / Math.max(buf.length, 1) > limits.totalRatioMax) throw bomb(`the whole archive would grow more than ${limits.totalRatioMax} times.`);
  void compressedTotal;
  return { entries };
}

/** The bytes of one entry, inflated, never more than `max`. An entry bigger than it said it was is a lie about its size. */
export function readEntry(buf: Buffer, e: ZipEntry, max: number): Buffer {
  if (e.dir) return Buffer.alloc(0);
  if (e.unsafe) throw new MediaError("bad_request", "That file's name is not one I will open.");
  if (e.size > max) throw bomb(`"${e.path.slice(0, 80)}" is bigger than I read.`);
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw corrupt();
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  if (start + e.compressed > buf.length) throw corrupt();
  const raw = buf.subarray(start, start + e.compressed);
  let out: Buffer;
  if (e.method === 0) out = Buffer.from(raw);
  else if (e.method === 8) {
    try {
      // One byte over what it said: a longer output is caught below, and the inflater never builds more than that.
      out = inflateRawSync(raw, { maxOutputLength: Math.min(max, e.size) + 1 });
    } catch (err) {
      if ((err as { code?: string } | null)?.code === "ERR_BUFFER_TOO_LARGE") throw bomb(`"${e.path.slice(0, 80)}" is bigger than it says it is.`);
      throw corrupt();
    }
  } else throw new MediaError("unsupported", `"${e.path.slice(0, 80)}" is packed in a way I don't read.`);
  if (out.length !== e.size) throw bomb(`"${e.path.slice(0, 80)}" is not the size it says it is.`);
  if (crc32(out) !== e.crc) throw corrupt();
  return out;
}

/** The first bytes of an entry, for typing it, without inflating more than that. */
export function peekEntry(buf: Buffer, e: ZipEntry, n = 4096): Buffer {
  if (e.dir || e.unsafe || e.size === 0) return Buffer.alloc(0);
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw corrupt();
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  if (start + e.compressed > buf.length) throw corrupt();
  const raw = buf.subarray(start, start + e.compressed);
  if (e.method === 0) return Buffer.from(raw.subarray(0, n));
  if (e.method !== 8) return Buffer.alloc(0);
  try {
    // A truncated stream is fine here: the head of it is all that is wanted. A deflate stream cannot grow more than about 1,032 times, so a
    // kilobyte of it is a megabyte at the very most, which maxOutputLength holds it to.
    return inflateRawSync(raw.subarray(0, Math.min(raw.length, 1024)), { maxOutputLength: 2 * 1024 * 1024, finishFlush: 2 /* Z_SYNC_FLUSH */ }).subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  }
}
