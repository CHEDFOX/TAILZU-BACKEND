/**
 * A PICTURE'S METADATA IS TAKEN OUT BEFORE IT IS KEPT (src/media/strip.ts), and its size is read from its header.
 *
 * The files are made from bytes in tests/ingest-rig.ts: a JPEG carrying GPS text, an owner's name, an XMP packet, an IPTC caption and a comment; a PNG with
 * text and EXIF chunks; a WebP with EXIF and XMP chunks and their flags; a GIF with a comment, an XMP block and the animation loop. What comes out has none
 * of that text, is still the same picture (its image data is byte-for-byte what it was), and keeps what a viewer needs (JFIF, the orientation, the loop).
 */
import { describe, expect, it } from "vitest";
import { imageSize, stripMetadata } from "../src/media/strip.js";
import { gif, jpeg, png, webp } from "./ingest-rig.js";

const has = (b: Buffer, s: string): boolean => b.includes(Buffer.from(s, "latin1"));

describe("JPEG", () => {
  it("loses its GPS, owner, XMP, IPTC and comment, and keeps its picture", () => {
    const src = jpeg({ orientation: 1 });
    expect(has(src, "GPSLatitude")).toBe(true);
    const out = stripMetadata(src, "jpeg");
    for (const s of ["GPSLatitude", "Asha", "asha@example.com", "iptc caption", "shot at the farm", "Exif", "xmpmeta"]) expect(has(out.data, s), s).toBe(false);
    expect(has(out.data, "JFIF")).toBe(true);
    expect(out.removed).toEqual(expect.arrayContaining(["EXIF", "XMP", "IPTC", "comments"]));
    // The compressed data, from the start of the scan to the end, is untouched.
    const scan = Buffer.from([0xff, 0xda]);
    expect(out.data.subarray(out.data.indexOf(scan))).toEqual(src.subarray(src.indexOf(scan)));
    expect(out.data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(out.data.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it("keeps the orientation, and nothing else of the EXIF, so a phone photo is not turned on its side", () => {
    const out = stripMetadata(jpeg({ orientation: 6 }), "jpeg").data;
    const at = out.indexOf(Buffer.from("Exif\0\0", "latin1"));
    expect(at).toBeGreaterThan(0);
    // 34 bytes: marker (2), length (2), "Exif\0\0", TIFF header, one entry. The orientation is the entry's value.
    expect(out.readUInt16BE(at - 2)).toBe(34);
    expect(out.readUInt16BE(at + 6 + 8 + 2 + 8)).toBe(6);
    expect(has(out, "GPSLatitude")).toBe(false);
  });

  it("an upright picture gets no EXIF block at all", () => {
    expect(has(stripMetadata(jpeg({ orientation: 1 }), "jpeg").data, "Exif")).toBe(false);
  });

  it("is refused when it is not a JPEG that holds together", () => {
    expect(() => stripMetadata(Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78]), "jpeg")).toThrowError(/damaged/);
    expect(() => stripMetadata(jpeg().subarray(0, 30), "jpeg")).toThrowError(/damaged/);
    expect(() => stripMetadata(Buffer.from("not a picture"), "jpeg")).toThrowError(/damaged/);
  });
});

describe("PNG", () => {
  it("loses its text, EXIF and timestamp chunks and keeps its picture", () => {
    const src = png(6, 5, { text: { Author: "Asha Rao", Comment: "GPS 12.97N" }, exif: "GPSLatitude 12.97" });
    expect(has(src, "Asha Rao")).toBe(true);
    const out = stripMetadata(src, "png");
    for (const s of ["Asha Rao", "GPS 12.97N", "GPSLatitude", "tEXt", "eXIf"]) expect(has(out.data, s), s).toBe(false);
    expect(out.removed).toEqual(expect.arrayContaining(["text chunks", "EXIF"]));
    expect(has(out.data, "IHDR") && has(out.data, "IDAT") && has(out.data, "IEND")).toBe(true);
    expect(imageSize(out.data, "png")).toEqual({ width: 6, height: 5 });
  });

  it("is refused when it is cut short", () => {
    expect(() => stripMetadata(png().subarray(0, 40), "png")).toThrowError(/damaged/);
  });
});

describe("WebP", () => {
  it("loses its EXIF and XMP chunks and their flags, and the file's length stays right", () => {
    const src = webp("GPS 12.97N secret");
    const out = stripMetadata(src, "webp");
    expect(has(out.data, "GPS 12.97N")).toBe(false);
    expect(has(out.data, "<xmp>")).toBe(false);
    expect(out.removed).toEqual(expect.arrayContaining(["EXIF", "XMP"]));
    expect(out.data.readUInt32LE(4)).toBe(out.data.length - 8);
    const vp8x = out.data.indexOf(Buffer.from("VP8X"));
    expect(out.data[vp8x + 8]! & 0x0c).toBe(0);
    expect(imageSize(out.data, "webp")).toEqual({ width: 8, height: 6 });
  });
});

describe("GIF", () => {
  it("loses its comment and its XMP block and keeps the animation loop", () => {
    const out = stripMetadata(gif(), "gif");
    expect(has(out.data, "made at the farm")).toBe(false);
    expect(has(out.data, "asha@example.com")).toBe(false);
    expect(has(out.data, "NETSCAPE2.0")).toBe(true);
    expect(out.removed).toEqual(expect.arrayContaining(["comments", "application data"]));
    expect(out.data.subarray(-1)).toEqual(Buffer.from([0x3b]));
    expect(imageSize(out.data, "gif")).toEqual({ width: 2, height: 2 });
  });
});

describe("sizes, and what is not a picture", () => {
  it("reads a JPEG's size from its frame header", () => {
    expect(imageSize(jpeg({ w: 321, h: 123 }), "jpeg")).toEqual({ width: 321, height: 123 });
  });

  it("says nothing for a header that does not hold together", () => {
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]), "jpeg")).toBeNull();
    expect(imageSize(Buffer.alloc(4), "png")).toBeNull();
  });

  it("refuses a format it cannot strip", () => {
    expect(() => stripMetadata(Buffer.from("x"), "bmp")).toThrowError(/PNG, JPEG, WebP and GIF/);
  });
});
