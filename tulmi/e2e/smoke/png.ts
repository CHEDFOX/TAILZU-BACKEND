/**
 * A PICTURE WITH A KNOWN ANSWER, MADE AT RUN TIME: a red square, a blue circle and three green stripes on white. No file to keep, no font to draw with:
 * what a model has to read out of it is shapes and colours.
 */
import zlib from "node:zlib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGB pixels (row by row) as a PNG. */
export function encodePng(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x += 1) { const [r, g, b] = rgb(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export const SHAPES = { colours: ["red", "blue", "green"], shapes: ["square", "circle", "stripe"] } as const;

/** 240x160: a red square on the left, a blue circle on the right, three green stripes underneath. */
export function shapesPicture(): Buffer {
  return encodePng(240, 160, (x, y) => {
    if (x >= 30 && x < 90 && y >= 20 && y < 80) return [220, 38, 38];
    if ((x - 170) ** 2 + (y - 50) ** 2 <= 32 ** 2) return [37, 99, 235];
    for (const top of [104, 120, 136]) if (y >= top && y < top + 8 && x >= 30 && x < 210) return [22, 163, 74];
    return [255, 255, 255];
  });
}
