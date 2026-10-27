/**
 * WHAT A FILE IS, FROM ITS BYTES (src/media/sniff.ts): magic bytes decide, never the name, never what the client said.
 *
 *   - every kind we read is recognised by its signature, and a name that lies changes nothing
 *   - the container formats (docx, xlsx, pptx, odt, ods, odp, epub) are told from a plain zip by what is in them
 *   - text is told from binary by its bytes; the name only chooses between prose, code and a table, and can never turn a binary into anything
 *   - a password-protected Office file and a zip bomb are refused with words; old binary Office files, HEIC and the like are "unsupported", with why
 */
import { describe, expect, it } from "vitest";
import { attachmentKindOf } from "../src/media/types.js";
import { decodeText, looksLikeText, sniff, tableDelimiter } from "../src/media/sniff.js";
import { docx, epub, gif, jpeg, odf, pdf, png, pptx, webp, xlsx, zip } from "./ingest-rig.js";

const kind = (b: Buffer, name = "") => { const r = sniff(b, name); return `${r.kind}/${r.format}`; };

describe("pictures, documents and sound, by their signatures", () => {
  it("knows each picture format", () => {
    expect(kind(png())).toBe("image/png");
    expect(kind(jpeg())).toBe("image/jpeg");
    expect(kind(gif())).toBe("image/gif");
    expect(kind(webp())).toBe("image/webp");
  });

  it("knows a PDF, even with junk in front of the header", () => {
    expect(kind(pdf(["x"]))).toBe("pdf/pdf");
    expect(kind(Buffer.concat([Buffer.from("junk\n"), pdf(["x"])]))).toBe("pdf/pdf");
  });

  it("knows sound and video by their headers", () => {
    const riff = (id: string) => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from(id), Buffer.alloc(8)]);
    const ftyp = (brand: string) => Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(8)]);
    expect(kind(riff("WAVE"))).toBe("audio/wav");
    expect(kind(riff("AVI "))).toBe("video/avi");
    expect(kind(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]))).toBe("audio/mp3");
    expect(kind(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]))).toBe("audio/mp3");
    expect(kind(Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0]))).toBe("audio/aac");
    expect(kind(Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(8)]))).toBe("audio/flac");
    expect(kind(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(8)]))).toBe("audio/ogg");
    expect(kind(ftyp("isom"))).toBe("video/mp4");
    expect(kind(ftyp("qt  "))).toBe("video/mov");
    expect(kind(ftyp("M4A "))).toBe("audio/m4a");
    expect(kind(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("....webm....")]))).toBe("video/webm");
  });

  it("maps its kinds to the front door's attachment kinds", () => {
    expect(attachmentKindOf("image")).toBe("image");
    expect(attachmentKindOf("document")).toBe("document");
    expect(attachmentKindOf("presentation")).toBe("document");
    expect(attachmentKindOf("spreadsheet")).toBe("data");
    expect(attachmentKindOf("data")).toBe("data");
    expect(attachmentKindOf("archive")).toBe("archive");
    expect(attachmentKindOf("unsupported")).toBe("other");
  });
});

describe("the name never decides", () => {
  it("a PDF called a picture is a PDF; a picture called a PDF is a picture", () => {
    expect(kind(pdf(["x"]), "holiday.png")).toBe("pdf/pdf");
    expect(kind(png(), "invoice.pdf")).toBe("image/png");
  });

  it("a zip called a text file is an archive, and a docx called a zip is a docx", () => {
    expect(kind(zip([{ name: "a.txt", data: "hi" }]), "notes.txt")).toBe("archive/zip");
    expect(kind(docx(), "backup.zip")).toBe("document/docx");
  });

  it("text called a docx, an exe or a png is still text; binary called a .txt or a .csv is not text", () => {
    expect(kind(Buffer.from("just some words\nin a file\n"), "report.docx")).toBe("text/txt");
    expect(kind(Buffer.from("just some words\n"), "setup.exe")).toBe("text/txt");
    expect(kind(Buffer.from("just some words\n"), "photo.png")).toBe("text/txt");
    expect(sniff(Buffer.concat([Buffer.alloc(100, 0), Buffer.from("MZ")]), "notes.txt").kind).toBe("unsupported");
    expect(sniff(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x00, 0x00]), "data.csv").kind).toBe("unsupported");
  });

  it("a program is refused whatever it is called", () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]);
    const r = sniff(exe, "holiday.jpg");
    expect(r.kind).toBe("unsupported");
    expect(r.why).toMatch(/never run anything/);
    expect(sniff(Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(100)]), "a.pdf").kind).toBe("unsupported");
  });
});

describe("the formats that are zips", () => {
  it("tells docx, xlsx, pptx, odt, ods, odp and epub from a plain zip", () => {
    expect(kind(docx())).toBe("document/docx");
    expect(kind(xlsx())).toBe("spreadsheet/xlsx");
    expect(kind(pptx())).toBe("presentation/pptx");
    expect(kind(odf("application/vnd.oasis.opendocument.text"))).toBe("document/odt");
    expect(kind(odf("application/vnd.oasis.opendocument.spreadsheet"))).toBe("spreadsheet/ods");
    expect(kind(odf("application/vnd.oasis.opendocument.presentation"))).toBe("presentation/odp");
    expect(kind(epub())).toBe("document/epub");
    expect(kind(zip([{ name: "a.txt", data: "hi" }]))).toBe("archive/zip");
  });

  it("hands back the zip's directory so it is read once", () => {
    const r = sniff(zip([{ name: "a.txt", data: "hi" }, { name: "b/c.md", data: "yo" }]));
    expect(r.zip?.entries.map((e) => e.path)).toEqual(["a.txt", "b/c.md"]);
  });

  it("a docx that is really a bomb is refused before the worker ever sees it", () => {
    const bomb = zip([{ name: "[Content_Types].xml", data: "<Types/>" }, { name: "word/document.xml", data: Buffer.alloc(3 * 1024 * 1024) }]);
    expect(() => sniff(bomb, "report.docx")).toThrowError(/zip bomb/);
  });
});

describe("files that are refused", () => {
  it("an empty file", () => {
    expect(() => sniff(Buffer.alloc(0))).toThrowError(/empty/);
  });

  it("a password-protected Office file (an encrypted OLE container) says so", () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512), Buffer.from("EncryptedPackage", "utf16le"), Buffer.alloc(64)]);
    try { sniff(ole, "salary.xlsx"); expect.unreachable(); } catch (e) {
      expect((e as { code: string }).code).toBe("password");
      expect((e as Error).message).toMatch(/password-protected/);
    }
  });

  it("an old binary Office file is unsupported, with how to fix it", () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
    const r = sniff(ole, "old.doc");
    expect(r.kind).toBe("unsupported");
    expect(r.why).toMatch(/docx, xlsx or pptx/);
  });

  it("HEIC and AVIF pictures, RTF, gzip, 7z, RAR and tar are unsupported, each with a way forward", () => {
    const ftyp = (brand: string) => Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(8)]);
    expect(sniff(ftyp("heic")).why).toMatch(/JPEG or a PNG/);
    expect(sniff(ftyp("avif")).why).toMatch(/AVIF/);
    expect(sniff(Buffer.from("{\\rtf1\\ansi hello")).why).toMatch(/RTF/);
    expect(sniff(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0])).why).toMatch(/gzip/);
    expect(sniff(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0])).why).toMatch(/7z/);
    expect(sniff(Buffer.from("Rar!\x1a\x07\x00....")).why).toMatch(/RAR/);
  });

  it("bytes that are none of these are unsupported", () => {
    expect(sniff(Buffer.from([0x01, 0x02, 0x00, 0x04, 0x05, 0x06, 0x00, 0x08, 0x09])).kind).toBe("unsupported");
  });
});

describe("plain text", () => {
  it("is prose, a table, code, JSON, XML, HTML or SVG, by its content (and its name only for prose against code)", () => {
    expect(kind(Buffer.from("Dear team,\nplease find the plan below.\n"), "note.md")).toBe("text/md");
    expect(kind(Buffer.from("a,b,c\n1,2,3\n4,5,6\n7,8,9\n"), "x")).toBe("data/csv");
    expect(kind(Buffer.from("a\tb\n1\t2\n3\t4\n5\t6\n"), "x")).toBe("data/tsv");
    expect(kind(Buffer.from("name,age\nasha,31\n"), "people.csv")).toBe("data/csv");
    expect(kind(Buffer.from("export const a = 1;\n"), "a.ts")).toBe("code/code");
    expect(kind(Buffer.from("#!/bin/sh\necho hi\n"), "run")).toBe("code/code");
    expect(kind(Buffer.from('{"a": 1, "b": [1, 2]}'), "x")).toBe("code/json");
    expect(kind(Buffer.from('<?xml version="1.0"?><root><a/></root>'), "x")).toBe("code/xml");
    expect(kind(Buffer.from("<!DOCTYPE html><html><body>Hi</body></html>"), "x")).toBe("document/html");
    expect(kind(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'), "logo.svg")).toBe("code/svg");
  });

  it("a prose file with a few commas is not a table", () => {
    expect(kind(Buffer.from("Hello, I wrote this, and it has commas.\nLater, as I said, there are more.\nThe end.\n"), "letter.txt")).toBe("text/txt");
  });

  it("a bracket that does not close is text, not JSON", () => {
    expect(kind(Buffer.from("[draft] remember to call Asha"), "n.txt")).toBe("text/txt");
  });

  it("reads UTF-8, UTF-16 and Windows-1252", () => {
    expect(decodeText(Buffer.from("नमस्ते duniya", "utf8"))).toBe("नमस्ते duniya");
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("héllo", "utf16le")]))).toBe("héllo");
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("ok")]))).toBe("ok");
  });

  it("finds a table's delimiter and counts a quoted one as no delimiter", () => {
    expect(tableDelimiter('a;b\n1;2\n3;4\n')).toBe(";");
    expect(tableDelimiter('"a,b"\n"1,2"\n"3,4"\n')).toBeNull();
    expect(looksLikeText(Buffer.from("plain"))).toBe(true);
    expect(looksLikeText(Buffer.from([0, 1, 2]))).toBe(false);
  });
});
