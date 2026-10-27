/**
 * THE RIG FOR THE MEDIA AND FILES TESTS (ingest-*.test.ts): FILES MADE ON THE FLY, AND A FAKE WORKER, A FAKE SPEECH SERVICE AND A MEMORY SERVICE.
 *
 * No binary file is kept in the repo: every zip, PDF, picture and office container here is built from bytes by the functions below, so a test says
 * exactly what is in the file it reads. Nothing reaches a network, a model, a database or the real worker.
 */
import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import type { Converted, ImageOptions, OptimisedImage, VideoRead, WorkerClient } from "../src/media/worker.js";
import type { Transcriber } from "../src/media/speech.js";

// ------------------------------------------------------------------ zip

export interface ZipEntrySpec {
  name: string;
  data?: Buffer | string;
  /** 0 stored, 8 deflated (the default). */
  method?: 0 | 8;
  /** General-purpose flag bits, e.g. 1 for encrypted. */
  flags?: number;
  /** What the central directory SAYS the uncompressed size is, when it is not the truth. */
  claimSize?: number;
  /** What it says the compressed size is. */
  claimCompressed?: number;
  /** Written as a directory. */
  dir?: boolean;
}

/** A zip file. The central directory can be made to lie about sizes, which is what a bomb does. */
export function zip(entries: ZipEntrySpec[], o: { claimCount?: number; zip64?: boolean } = {}): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "utf8");
    const method = e.dir ? 0 : e.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name + (e.dir && !e.name.endsWith("/") ? "/" : ""), "utf8");
    const flags = (e.flags ?? 0) | 0x800;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    local.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.claimCompressed ?? body.length, 20);
    ch.writeUInt32LE(o.zip64 ? 0xffffffff : e.claimSize ?? raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    const extra = o.zip64 ? Buffer.concat([Buffer.from([0x01, 0x00, 0x08, 0x00]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(e.claimSize ?? raw.length)); return b; })()]) : Buffer.alloc(0);
    ch.writeUInt16LE(extra.length, 30);
    central.push(ch, name, extra);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(o.claimCount ?? entries.length, 8); end.writeUInt16LE(o.claimCount ?? entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// ------------------------------------------------------------------ office containers (just enough parts to be recognised)

const OOXML_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';
export const docx = (text = "Hello"): Buffer => zip([{ name: "[Content_Types].xml", data: OOXML_TYPES }, { name: "word/document.xml", data: `<w:document><w:body><w:p><w:t>${text}</w:t></w:p></w:body></w:document>` }]);
export const xlsx = (): Buffer => zip([{ name: "[Content_Types].xml", data: OOXML_TYPES }, { name: "xl/workbook.xml", data: "<workbook/>" }]);
export const pptx = (): Buffer => zip([{ name: "[Content_Types].xml", data: OOXML_TYPES }, { name: "ppt/presentation.xml", data: "<presentation/>" }]);
export const odf = (mime: string): Buffer => zip([{ name: "mimetype", data: mime, method: 0 }, { name: "content.xml", data: "<office:document-content/>" }]);
export const epub = (): Buffer => zip([{ name: "mimetype", data: "application/epub+zip", method: 0 }, { name: "OEBPS/ch1.xhtml", data: "<html/>" }]);

// ------------------------------------------------------------------ a PDF

/** A small PDF with one line of text a page. With `encrypt`, a standard-security dictionary whose password nobody has. */
export function pdf(pages: string[], o: { encrypt?: boolean } = {}): Buffer {
  const objs: string[] = [];
  const kids: number[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let n = 4;
  for (const text of pages) {
    const content = text ? `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET` : "";
    objs[n] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${n + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[n + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    kids.push(n);
    n += 2;
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  if (o.encrypt) objs[n] = `<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -4 >>`;
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i += 1) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((x) => `${String(x).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R${o.encrypt ? ` /Encrypt ${n} 0 R /ID [<${"11".repeat(16)}> <${"11".repeat(16)}>]` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ------------------------------------------------------------------ pictures

const be32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const be16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

function pngChunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "latin1");
  return Buffer.concat([be32(data.length), t, data, be32(crc32(Buffer.concat([t, data])))]);
}

/** A real PNG (w by h, one colour), with the given text chunks and an EXIF chunk if asked. */
export function png(w = 4, h = 4, o: { text?: Record<string, string>; exif?: string; rgb?: [number, number, number] } = {}): Buffer {
  const ihdr = Buffer.concat([be32(w), be32(h), Buffer.from([8, 2, 0, 0, 0])]);
  const [r, g, b] = o.rgb ?? [200, 30, 30];
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const idat = deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr),
    ...Object.entries(o.text ?? {}).map(([k, v]) => pngChunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1"))),
    ...(o.exif ? [pngChunk("eXIf", Buffer.from(o.exif, "latin1"))] : []),
    pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A PNG whose pixel data is `bytes` of noise, so it is about that big and does not shrink: a picture too large for the vision tier. */
export function bigPng(bytes: number): Buffer {
  const side = 1500;
  const ihdr = Buffer.concat([be32(side), be32(side), Buffer.from([8, 2, 0, 0, 0])]);
  const noise = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) noise[i] = (i * 2654435761) >>> 24;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", noise), pngChunk("IEND", Buffer.alloc(0))]);
}

/** An EXIF block (big-endian) holding the orientation and some text a camera would write, e.g. "GPSLatitude 12.97". */
export function exifBlock(orientation: number, secret: string): Buffer {
  const text = Buffer.from(`${secret}\0`, "latin1");
  // IFD0: Orientation (0x0112) and ImageDescription (0x010e) pointing at the text.
  const ifd = Buffer.concat([be16(2), Buffer.concat([be16(0x010e), be16(2), be32(text.length), be32(8 + 2 + 24 + 4)]), Buffer.concat([be16(0x0112), be16(3), be32(1), be16(orientation), be16(0)]), be32(0)]);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from("MM\0*", "latin1"), be32(8), ifd, text]);
}

/** A JPEG made of its markers, not a picture a decoder would show: JFIF, EXIF with an orientation and a secret, XMP, a comment, then the scan. */
export function jpeg(o: { w?: number; h?: number; orientation?: number; secret?: string } = {}): Buffer {
  const seg = (marker: number, payload: Buffer): Buffer => Buffer.concat([Buffer.from([0xff, marker]), be16(payload.length + 2), payload]);
  const sof = Buffer.concat([Buffer.from([8]), be16(o.h ?? 6), be16(o.w ?? 8), Buffer.from([1, 1, 0x11, 0])]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    seg(0xe1, exifBlock(o.orientation ?? 1, o.secret ?? "GPSLatitude 12.9716 N, GPSLongitude 77.5946 E, Owner Asha")),
    seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>asha@example.com</x:xmpmeta>", "latin1")),
    seg(0xed, Buffer.from("Photoshop 3.0\0iptc caption", "latin1")),
    seg(0xfe, Buffer.from("shot at the farm", "latin1")),
    seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 3)])),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]), // entropy-coded data, with a stuffed 0xFF
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A WebP made of its chunks: VP8X (with the EXIF and XMP flags), the image, EXIF and XMP. */
export function webp(secret = "GPS 12.97N"): Buffer {
  const chunk = (id: string, data: Buffer): Buffer => { const h = Buffer.alloc(8); h.write(id, 0, "latin1"); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04; // EXIF and XMP present
  vp8x.writeUIntLE(7, 4, 3); vp8x.writeUIntLE(5, 7, 3); // canvas 8 x 6
  const vp8 = Buffer.alloc(30); vp8.writeUInt16LE(8, 6); vp8.writeUInt16LE(6, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("VP8X", vp8x), chunk("VP8 ", vp8), chunk("EXIF", Buffer.from(secret, "latin1")), chunk("XMP ", Buffer.from("<xmp>asha</xmp>", "latin1"))]);
  const head = Buffer.alloc(8); head.write("RIFF", 0, "latin1"); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** A GIF with a comment, an XMP application block and the animation loop block. */
export function gif(): Buffer {
  const sub = (s: string): Buffer => Buffer.concat([Buffer.from([s.length]), Buffer.from(s, "latin1"), Buffer.from([0])]);
  return Buffer.concat([
    Buffer.from("GIF89a", "latin1"), Buffer.from([2, 0, 2, 0, 0x80, 0, 0]), Buffer.from([0, 0, 0, 255, 255, 255]),
    Buffer.from([0x21, 0xff, 11]), Buffer.from("NETSCAPE2.0", "latin1"), Buffer.from([3, 1, 0, 0, 0]),
    Buffer.from([0x21, 0xff, 11]), Buffer.from("XMP DataXMP", "latin1"), sub("<xmp>asha@example.com</xmp>"),
    Buffer.from([0x21, 0xfe]), sub("made at the farm"),
    Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0, 2]), sub("D\x01"),
    Buffer.from([0x3b]),
  ]);
}

// ------------------------------------------------------------------ fakes

export interface WorkerCalls {
  convert: Array<{ format: string; bytes: number }>;
  pdf: number;
  image: Array<ImageOptions & { bytes: number }>;
  video: number;
}

/** A worker that answers from canned results and writes down what it was asked. `over` replaces any of them. */
export function fakeWorker(over: Partial<WorkerClient> = {}): { worker: WorkerClient; calls: WorkerCalls } {
  const calls: WorkerCalls = { convert: [], pdf: 0, image: [], video: 0 };
  const worker: WorkerClient = {
    async convert(data, format): Promise<Converted> {
      calls.convert.push({ format, bytes: data.length });
      if (format === "pptx") return { markdown: "<!-- Slide number: 1 -->\n# Launch plan\n\nWe ship in March.\n\n<!-- Slide number: 2 -->\n# Budget\n\nThe budget is four lakh rupees.", pages: 2, tables: [], notes: [] };
      if (format === "xlsx") {
        return {
          markdown: "## Sales\n\n| Month | Revenue |\n| --- | --- |\n| Jan | 100 |\n| Feb | 150 |\n| Mar | 120 |",
          notes: [],
          tables: [{ name: "Sales", columns: ["Month", "Revenue"], rows: [["Jan", 100], ["Feb", 150], ["Mar", 120]], totalRows: 3, numeric: [1] }],
        };
      }
      return { markdown: "# Employee handbook\n\nThe notice period is sixty days.\n\n## Leave\n\nEvery employee gets twenty four days of paid leave a year.", tables: [], notes: [] };
    },
    async pdf(): Promise<Converted> {
      calls.pdf += 1;
      return { markdown: "# Scanned invoice\n\nTotal due: 4,500 rupees\f# Page two\n\nPay by the fifth.", pages: 2, tables: [], notes: [] };
    },
    async image(data, o): Promise<OptimisedImage> {
      calls.image.push({ ...o, bytes: data.length });
      const fmt = o.format === "auto" ? "webp" : o.format;
      return { data: Buffer.from(`OPT-${fmt}-${o.maxSide}`), mime: `image/${fmt}`, width: o.maxSide, height: o.maxSide, format: fmt };
    },
    async video(): Promise<VideoRead> {
      calls.video += 1;
      return {
        durationSeconds: 95, width: 1280, height: 720,
        frames: [{ t: 0, data: Buffer.from("frame-a") }, { t: 12.5, data: Buffer.from("frame-b") }, { t: 40, data: Buffer.from("frame-c") }, { t: 80, data: Buffer.from("frame-d") }],
        audio: { mime: "audio/mpeg", data: Buffer.from("fake-mp3") }, notes: [],
      };
    },
    ...over,
  };
  return { worker, calls };
}

/** A speech service that returns a canned transcript and writes down what it was given. */
export function fakeSpeech(text = "[0:00] Welcome everyone. [0:20] The refund window is thirty days.", over: Partial<Transcriber> = {}) {
  const calls: Array<{ bytes: number; mime: string }> = [];
  const speech: Transcriber = {
    async transcribe(audio, mime) { calls.push({ bytes: audio.length, mime }); return { text, seconds: 95, language: "en" }; },
    ...over,
  };
  return { speech, calls };
}
