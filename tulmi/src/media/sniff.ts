/**
 * WHAT A FILE IS, FROM ITS BYTES. NEVER FROM ITS NAME, AND NEVER FROM WHAT THE CLIENT SAID.
 *
 * A name and a MIME type are claims. A file called `holiday.png` can be a zip, one called `invoice.pdf` an executable, and `notes.txt` a
 * picture, so the kind comes from the signature at the head of the bytes (the magic bytes), and for the container formats from what is in
 * them (a docx is a zip with `word/document.xml`). The one use of a name is to choose WITHIN plain text, where there are no magic bytes:
 * whether a text file is code or prose, or a table. It can never turn anything binary into anything.
 *
 * Refused here, with a sentence a person can read: a password-protected office file (an encrypted OLE container), a password-protected or
 * damaged zip, a zip bomb (zip.ts). Reported as `unsupported`, with why: old binary Office files, HEIC and AVIF pictures, RTF, and bytes
 * that are none of the things we read.
 *
 * Pure: bytes in, a verdict out. It never decodes more than a few kilobytes of anything.
 */
import { MediaError, type MediaKind, type Sniffed } from "./types.js";
import { peekEntry, readEntry, readZip, type ZipListing } from "./zip.js";

export interface SniffResult extends Sniffed {
  /** The zip's directory, when the file is a zip or one of the formats made of one: so it is read once. */
  zip?: ZipListing;
}

const MIME: Record<string, string> = {
  png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip", html: "text/html",
  csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", xml: "application/xml", txt: "text/plain", md: "text/markdown",
  code: "text/plain",
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", aac: "audio/aac", m4a: "audio/mp4", amr: "audio/amr", aiff: "audio/aiff",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", flv: "video/x-flv",
  zip: "application/zip",
};

const sure = (kind: MediaKind, format: string): SniffResult => ({ kind, format, mime: MIME[format] ?? "application/octet-stream" });
const no = (why: string, format = "unknown"): SniffResult => ({ kind: "unsupported", format, mime: "application/octet-stream", why });

const starts = (b: Buffer, sig: number[] | string, at = 0): boolean => {
  const s = typeof sig === "string" ? Buffer.from(sig, "latin1") : Buffer.from(sig);
  return b.length >= at + s.length && b.subarray(at, at + s.length).equals(s);
};

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|dart|vue|svelte|php|rb|c|h|cc|cpp|hpp|cs|sh|bash|zsh|sql|css|scss|less|yaml|yml|toml|ini|cfg|conf|gradle|lua|r|scala|ex|exs|clj|hs|tf|proto|graphql|dockerfile|makefile|env\.example|gitignore)$/i;
const TABLE_EXT = /\.(?:csv|tsv)$/i;

// ------------------------------------------------------------------ text

/** The text of bytes known to be text: a byte-order mark is honoured, UTF-8 is tried, and Windows-1252 (what a spreadsheet exports) is the fallback. */
export function decodeText(data: Buffer): string {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return data.subarray(3).toString("utf8");
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return data.subarray(2).toString("utf16le");
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    const swapped = Buffer.from(data.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("windows-1252").decode(data);
  }
}

/** Whether the head of some bytes reads as text: no NUL, few control characters, and (past a byte-order mark) decodable. */
export function looksLikeText(data: Buffer): boolean {
  if (!data.length) return true;
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) return true;
  const head = data.subarray(0, 8192);
  let odd = 0;
  for (const c of head) {
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) odd += 1;
  }
  return odd / head.length < 0.05;
}

/** A line's fields counted the way a CSV reader does: a delimiter inside quotes is not one. */
function delimiters(line: string, d: string): number {
  let n = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === d && !quoted) n += 1;
  }
  return n;
}

/** The delimiter of a table of text, or null: the one that splits at least 85% of the first lines (and at least three) into the same number of fields. */
export function tableDelimiter(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 25);
  if (lines.length < 3) return null;
  let best: { d: string; share: number; n: number } | null = null;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = lines.map((l) => delimiters(l.slice(0, 2000), d));
    const tally = new Map<number, number>();
    for (const c of counts) if (c > 0) tally.set(c, (tally.get(c) ?? 0) + 1);
    for (const [n, k] of tally) {
      const share = k / lines.length;
      if (k >= 3 && (!best || share > best.share || (share === best.share && n > best.n))) best = { d, share, n };
    }
  }
  return best && best.share >= 0.85 ? best.d : null;
}

function sniffText(data: Buffer, name: string): SniffResult {
  const text = decodeText(data.subarray(0, Math.min(data.length, 64 * 1024)));
  const head = text.replace(/^\s+/, "").slice(0, 1200);
  const lower = head.toLowerCase();
  if (/^<!doctype\s+html|^<html[\s>]|^<head[\s>]|^<body[\s>]/.test(lower) || (lower.startsWith("<") && /<html[\s>]/.test(lower))) return sure("document", "html");
  if (/^<\?xml[^>]*\?>\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/.test(lower) || /^<svg[\s>]/.test(lower)) return { kind: "code", format: "svg", mime: MIME.svg! };
  if (head.startsWith("{\\rtf")) return no("RTF files are not supported. Save it as a docx or a PDF and send it again.", "rtf");
  if (head.startsWith("{") || head.startsWith("[")) {
    // Valid JSON only when the whole file parses; the head alone cannot say. A file too big to parse here is read as text.
    if (data.length <= 1024 * 1024) {
      try { JSON.parse(decodeText(data)); return { kind: "code", format: "json", mime: MIME.json! }; } catch { /* plain text that starts with a bracket */ }
    }
  }
  if (lower.startsWith("<?xml")) return { kind: "code", format: "xml", mime: MIME.xml! };
  if (head.startsWith("#!")) return { kind: "code", format: "code", mime: MIME.code! };
  const d = tableDelimiter(text);
  if (d !== null && TABLE_EXT.test(name)) return { kind: "data", format: d === "\t" ? "tsv" : "csv", mime: d === "\t" ? MIME.tsv! : MIME.csv! };
  if (d !== null && d !== "|" && d !== ";") return { kind: "data", format: d === "\t" ? "tsv" : "csv", mime: d === "\t" ? MIME.tsv! : MIME.csv! };
  if (TABLE_EXT.test(name) && text.trim()) return { kind: "data", format: /\.tsv$/i.test(name) ? "tsv" : "csv", mime: /\.tsv$/i.test(name) ? MIME.tsv! : MIME.csv! };
  if (CODE_EXT.test(name)) return { kind: "code", format: "code", mime: MIME.code! };
  return sure("text", /\.md|\.markdown$/i.test(name) ? "md" : "txt");
}

// ------------------------------------------------------------------ containers

const ftypBrand = (b: Buffer): string => b.subarray(8, 12).toString("latin1");

function sniffZip(data: Buffer): SniffResult {
  const zip = readZip(data);
  const names = new Set(zip.entries.map((e) => e.path));
  const first = zip.entries[0];
  if (first && first.path === "mimetype" && first.method === 0 && first.size < 100) {
    const type = readEntry(data, first, 100).toString("latin1").trim();
    if (type === "application/epub+zip") return { ...sure("document", "epub"), zip };
    if (type === "application/vnd.oasis.opendocument.text") return { ...sure("document", "odt"), zip };
    if (type === "application/vnd.oasis.opendocument.spreadsheet") return { ...sure("spreadsheet", "ods"), zip };
    if (type === "application/vnd.oasis.opendocument.presentation") return { ...sure("presentation", "odp"), zip };
  }
  if (names.has("[Content_Types].xml")) {
    if (names.has("word/document.xml")) return { ...sure("document", "docx"), zip };
    if (names.has("xl/workbook.xml")) return { ...sure("spreadsheet", "xlsx"), zip };
    if (names.has("ppt/presentation.xml")) return { ...sure("presentation", "pptx"), zip };
  }
  return { ...sure("archive", "zip"), zip };
}

/** The kind and format of a file's bytes. Throws MediaError for a password-protected or damaged container, or a bomb. */
export function sniff(data: Buffer, name = ""): SniffResult {
  if (!data.length) throw new MediaError("empty", "That file is empty.");
  // Pictures
  if (starts(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return sure("image", "png");
  if (starts(data, [0xff, 0xd8, 0xff])) return sure("image", "jpeg");
  if (starts(data, "GIF87a") || starts(data, "GIF89a")) return sure("image", "gif");
  if (starts(data, "RIFF") && starts(data, "WEBP", 8)) return sure("image", "webp");
  if (starts(data, "RIFF") && starts(data, "WAVE", 8)) return sure("audio", "wav");
  if (starts(data, "RIFF") && starts(data, "AVI ", 8)) return sure("video", "avi");
  // PDF: the header may follow up to a kilobyte of junk.
  if (data.subarray(0, 1024).includes("%PDF-")) return sure("pdf", "pdf");
  // The ISO base media family: mp4, mov, m4a, and the pictures that share the container.
  if (starts(data, "ftyp", 4)) {
    const brand = ftypBrand(data);
    if (/^(?:heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(brand)) return no("HEIC pictures are not supported yet. Export it as a JPEG or a PNG and send it again.", "heic");
    if (/^(?:avif|avis)/.test(brand)) return no("AVIF pictures are not supported yet. Export it as a JPEG or a PNG and send it again.", "avif");
    if (/^(?:M4A |M4B |M4P |F4A )/.test(brand)) return sure("audio", "m4a");
    return sure("video", brand === "qt  " ? "mov" : "mp4");
  }
  if (starts(data, [0x1a, 0x45, 0xdf, 0xa3])) return sure("video", data.subarray(0, 64).includes("webm") ? "webm" : "mkv");
  if (starts(data, "FLV\x01")) return sure("video", "flv");
  // Sound
  if (starts(data, "ID3")) return sure("audio", "mp3");
  if (starts(data, "fLaC")) return sure("audio", "flac");
  if (starts(data, "OggS")) return sure("audio", "ogg");
  if (starts(data, "#!AMR")) return sure("audio", "amr");
  if (starts(data, "FORM") && starts(data, "AIFF", 8)) return sure("audio", "aiff");
  if (data.length > 3 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) {
    if ((data[1]! & 0xf6) === 0xf0) return sure("audio", "aac");
    if (((data[1]! >> 3) & 3) !== 1 && ((data[1]! >> 1) & 3) !== 0 && (data[2]! >> 4) !== 0xf) return sure("audio", "mp3");
  }
  // Containers
  if (starts(data, "PK\x03\x04") || starts(data, "PK\x05\x06")) return sniffZip(data);
  if (starts(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    if (data.includes(Buffer.from("EncryptedPackage", "utf16le"))) {
      throw new MediaError("password", "That Office file is password-protected. I can't open it. Save a copy without the password and send it again.");
    }
    return no("Old binary Office files (.doc, .xls, .ppt) are not supported. Save it as docx, xlsx or pptx and send it again.", "ole");
  }
  if (starts(data, [0x1f, 0x8b])) return no("gzip files are not supported. Send a zip, or the file inside.", "gzip");
  if (starts(data, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return no("7z archives are not supported. Send a zip.", "7z");
  if (starts(data, "Rar!\x1a\x07")) return no("RAR archives are not supported. Send a zip.", "rar");
  if (data.length > 262 && starts(data, "ustar", 257)) return no("tar archives are not supported. Send a zip.", "tar");
  if (starts(data, [0x4d, 0x5a]) || starts(data, [0x7f, 0x45, 0x4c, 0x46]) || starts(data, [0xcf, 0xfa, 0xed, 0xfe]) || starts(data, [0xca, 0xfe, 0xba, 0xbe])) {
    return no("That is a program, not a document. I never run anything, and I don't read programs.", "executable");
  }
  if (looksLikeText(data)) return sniffText(data, name);
  return no("I don't know what kind of file that is, so I did not read it.");
}

/** The first kilobytes of an entry of a zip, typed: what a file inside an archive is. */
export function sniffEntry(zipBytes: Buffer, listing: ZipListing, index: number, name: string): Sniffed {
  const e = listing.entries[index]!;
  const head = peekEntry(zipBytes, e, 4096);
  if (!head.length) return no("empty", "empty");
  if (starts(head, "PK\x03\x04")) return sure("archive", "zip");
  try {
    const r = sniff(head, name);
    return { kind: r.kind, format: r.format, mime: r.mime, ...(r.why ? { why: r.why } : {}) };
  } catch {
    return no("not readable", "unknown");
  }
}
