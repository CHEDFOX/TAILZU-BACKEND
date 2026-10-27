/**
 * PICTURES, WITHOUT WHAT THEY KNOW ABOUT WHO TOOK THEM: METADATA STRIPPED BEFORE A PICTURE IS KEPT.
 *
 * A phone photo carries where it was taken (GPS), when, with what, sometimes the owner's name, and a thumbnail of the uncropped original.
 * A picture is stored (media/blob.ts) only after this has taken that out. It works on the file's own structure and never decodes a pixel,
 * so it is fast, adds no dependency, and cannot change what the picture looks like:
 *
 *   JPEG  keeps the image itself, JFIF, the ICC colour profile and Adobe's colour tag; drops EXIF, XMP, IPTC, Photoshop, maker notes, comments.
 *         The one thing kept of the EXIF is the ORIENTATION, rewritten into a bare 34-byte EXIF block, because dropping it would turn a phone
 *         photo taken sideways onto its side.
 *   PNG   drops text chunks (tEXt, zTXt, iTXt), eXIf and tIME.
 *   WebP  drops the EXIF and XMP chunks and clears their flags.
 *   GIF   drops comments and every application block but the animation loop's.
 *
 * Anything that does not parse as the format it says is refused (MediaError corrupt) rather than stored unstripped.
 */
import { MediaError } from "./types.js";

export interface Stripped {
  data: Buffer;
  /** What was taken out, in words: "EXIF", "XMP", "text chunks", "comments". Empty when there was nothing. */
  removed: string[];
}

const damaged = (what: string): MediaError => new MediaError("corrupt", `That ${what} is damaged, so I did not keep it.`);

// ------------------------------------------------------------------ JPEG

function exifOrientation(seg: Buffer): number {
  // seg is the APP1 payload: "Exif\0\0" then a TIFF block.
  if (seg.length < 14 || seg.toString("latin1", 0, 6) !== "Exif\0\0") return 1;
  const t = seg.subarray(6);
  const le = t.toString("latin1", 0, 2) === "II";
  if (!le && t.toString("latin1", 0, 2) !== "MM") return 1;
  const u16 = (o: number): number => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number): number => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const n = u16(ifd);
    for (let i = 0; i < n && i < 64; i += 1) {
      const at = ifd + 2 + i * 12;
      if (u16(at) === 0x0112) {
        const v = u16(at + 8);
        return v >= 2 && v <= 8 ? v : 1;
      }
    }
  } catch { /* an EXIF that does not hold together has no orientation we trust */ }
  return 1;
}

/** An APP1 segment holding nothing but the orientation. */
function orientationOnly(o: number): Buffer {
  return Buffer.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // marker, length 34, "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, first IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00, // Orientation, SHORT, 1, value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

function stripJpeg(b: Buffer): Stripped {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw damaged("picture");
  const out: Buffer[] = [b.subarray(0, 2)];
  const removed = new Set<string>();
  let orientation = 1;
  let p = 2;
  let placed = false;
  const place = (): void => {
    if (!placed && orientation > 1) out.push(orientationOnly(orientation));
    placed = true;
  };
  while (p < b.length) {
    if (b[p] !== 0xff) throw damaged("picture");
    while (b[p] === 0xff && p < b.length) p += 1; // fill bytes
    const marker = b[p]!;
    p += 1;
    if (marker === 0xd9) { place(); out.push(Buffer.from([0xff, 0xd9])); break; } // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(Buffer.from([0xff, marker])); continue; }
    if (p + 2 > b.length) throw damaged("picture");
    const len = b.readUInt16BE(p);
    if (len < 2 || p + len > b.length) throw damaged("picture");
    const payload = b.subarray(p + 2, p + len);
    const whole = b.subarray(p - 2, p + len);
    if (marker === 0xda) {
      // Start of scan: the compressed image follows to the end, untouched.
      place();
      out.push(b.subarray(p - 2));
      p = b.length;
      break;
    }
    let keep = true;
    if (marker === 0xe1) {
      keep = false;
      removed.add(payload.toString("latin1", 0, 4) === "Exif" ? "EXIF" : "XMP");
      if (payload.toString("latin1", 0, 4) === "Exif") orientation = Math.max(orientation, exifOrientation(payload));
    } else if (marker === 0xe2) {
      keep = payload.toString("latin1", 0, 11) === "ICC_PROFILE";
      if (!keep) removed.add("extra profile data");
    } else if (marker === 0xed) { keep = false; removed.add("IPTC"); }
    else if (marker === 0xfe) { keep = false; removed.add("comments"); }
    else if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) { keep = false; removed.add("application data"); }
    if (keep) {
      // The orientation block goes in ahead of the first segment that is not an application one, so a reader looks no further than it must.
      if (marker < 0xe0 || marker > 0xef) place();
      out.push(whole);
    }
    p += len;
  }
  if (p < b.length && out.length === 1) throw damaged("picture");
  const data = Buffer.concat(out);
  return { data, removed: [...removed] };
}

// ------------------------------------------------------------------ PNG

const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(b: Buffer): Stripped {
  if (b.length < 20) throw damaged("picture");
  const out: Buffer[] = [b.subarray(0, 8)];
  const removed = new Set<string>();
  let p = 8;
  let ended = false;
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    if (len > b.length - p - 12) throw damaged("picture");
    const chunk = b.subarray(p, p + 12 + len);
    if (PNG_DROP.has(type)) removed.add(type === "eXIf" ? "EXIF" : type === "tIME" ? "timestamp" : "text chunks");
    else out.push(chunk);
    p += 12 + len;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended) throw damaged("picture");
  return { data: Buffer.concat(out), removed: [...removed] };
}

// ------------------------------------------------------------------ WebP

function stripWebp(b: Buffer): Stripped {
  if (b.length < 20 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") throw damaged("picture");
  const riffEnd = Math.min(b.length, 8 + b.readUInt32LE(4));
  const chunks: Buffer[] = [];
  const removed = new Set<string>();
  let p = 12;
  while (p + 8 <= riffEnd) {
    const fourcc = b.toString("latin1", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    const padded = size + (size & 1);
    if (p + 8 + padded > b.length) throw damaged("picture");
    if (fourcc === "EXIF" || fourcc === "XMP ") { removed.add(fourcc === "EXIF" ? "EXIF" : "XMP"); }
    else if (fourcc === "VP8X" && size >= 10) {
      const c = Buffer.from(b.subarray(p, p + 8 + padded));
      c[8] = c[8]! & ~0x0c; // no EXIF (0x08), no XMP (0x04)
      chunks.push(c);
    } else chunks.push(b.subarray(p, p + 8 + padded));
    p += 8 + padded;
  }
  if (!chunks.length) throw damaged("picture");
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "latin1");
  return { data: Buffer.concat([head, body]), removed: [...removed] };
}

// ------------------------------------------------------------------ GIF

function stripGif(b: Buffer): Stripped {
  if (b.length < 14) throw damaged("picture");
  let p = 13;
  const flags = b[10]!;
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
  const out: Buffer[] = [b.subarray(0, p)];
  const removed = new Set<string>();
  const subBlocks = (from: number): number => {
    let q = from;
    for (;;) {
      if (q >= b.length) throw damaged("picture");
      const n = b[q]!;
      q += 1 + n;
      if (n === 0) return q;
    }
  };
  for (;;) {
    if (p >= b.length) throw damaged("picture");
    const t = b[p]!;
    if (t === 0x3b) { out.push(b.subarray(p, p + 1)); break; }
    if (t === 0x21) {
      const label = b[p + 1]!;
      const end = subBlocks(p + 2);
      if (label === 0xfe) removed.add("comments");
      else if (label === 0xff) {
        const id = b.toString("latin1", p + 3, p + 14);
        if (id === "NETSCAPE2.0" || id === "ANIMEXTS1.0") out.push(b.subarray(p, end));
        else removed.add("application data");
      } else out.push(b.subarray(p, end));
      p = end;
    } else if (t === 0x2c) {
      const f = b[p + 9]!;
      let q = p + 10;
      if (f & 0x80) q += 3 * (1 << ((f & 7) + 1));
      q += 1; // LZW minimum code size
      const end = subBlocks(q);
      out.push(b.subarray(p, end));
      p = end;
    } else throw damaged("picture");
  }
  return { data: Buffer.concat(out), removed: [...removed] };
}

/** The picture with its metadata taken out. `format` is the sniffed one (sniff.ts): png, jpeg, webp or gif. */
export function stripMetadata(data: Buffer, format: string): Stripped {
  switch (format) {
    case "jpeg": return stripJpeg(data);
    case "png": return stripPng(data);
    case "webp": return stripWebp(data);
    case "gif": return stripGif(data);
    default: throw new MediaError("unsupported", "I can strip PNG, JPEG, WebP and GIF pictures.");
  }
}

// ------------------------------------------------------------------ size

/** A picture's width and height from its header, without decoding it. Null when the header does not say. */
export function imageSize(b: Buffer, format: string): { width: number; height: number } | null {
  try {
    if (format === "png" && b.length >= 24) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (format === "gif" && b.length >= 10) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (format === "jpeg") {
      let p = 2;
      while (p + 9 < b.length) {
        if (b[p] !== 0xff) { p += 1; continue; }
        const m = b[p + 1]!;
        if (m === 0xff) { p += 1; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
        p += 2 + b.readUInt16BE(p + 2);
      }
      return null;
    }
    if (format === "webp" && b.length >= 30) {
      const kind = b.toString("latin1", 12, 16);
      if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }; }
      if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
  } catch { /* a header that does not hold together has no size we trust */ }
  return null;
}
