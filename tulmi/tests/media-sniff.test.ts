import { describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { sniffContentType } from "../src/routes/media.js";

/** First bytes only — sniffing never reads past the header. */
function head(...parts: Array<string | number[]>): Buffer {
  const bufs = parts.map((p) =>
    typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p),
  );
  return Buffer.concat([...bufs, Buffer.alloc(32)]);
}

describe("sniffContentType", () => {
  it("recognises an mp4 a client failed to label", () => {
    // The real case: curl sent no mimetype, the route stored
    // application/octet-stream, and the clip rendered as an Image and never
    // played. The bytes said mp4 the whole time.
    expect(sniffContentType(head("\0\0\0\x18", "ftyp", "isom"), "application/octet-stream"))
      .toBe("video/mp4");
  });

  it("separates QuickTime from the mp4 family by brand", () => {
    expect(sniffContentType(head("\0\0\0\x14", "ftyp", "qt  "), "")).toBe("video/quicktime");
  });

  it("recognises png, jpeg, gif and webp", () => {
    expect(sniffContentType(head([0x89], "PNG\r\n\x1a\n"), "")).toBe("image/png");
    expect(sniffContentType(head([0xff, 0xd8, 0xff, 0xe0]), "")).toBe("image/jpeg");
    expect(sniffContentType(head("GIF89a"), "")).toBe("image/gif");
    expect(sniffContentType(head("RIFF", "\0\0\0\0", "WEBP"), "")).toBe("image/webp");
  });

  it("trusts a specific declared type over its own guess", () => {
    // svg+xml and json carry detail the first bytes do not; a client that
    // bothered to be specific knows more than the sniffer does.
    expect(sniffContentType(head("<svg "), "image/svg+xml")).toBe("image/svg+xml");
    expect(sniffContentType(head([0x89], "PNG\r\n\x1a\n"), "image/apng")).toBe("image/apng");
  });

  it("leaves an unrecognisable file alone rather than inventing a type", () => {
    expect(sniffContentType(head("not a real file"), "application/octet-stream"))
      .toBe("application/octet-stream");
  });
});
