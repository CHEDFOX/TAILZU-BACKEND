import { describe, expect, it } from "vitest";
import { OPEN_URL_MAX, openableUrl } from "../lib/links.js";

describe("openableUrl", () => {
  it("passes absolute http(s) addresses, normalised", () => {
    expect(openableUrl("https://example.com/docs?x=1#top")).toBe("https://example.com/docs?x=1#top");
    expect(openableUrl("  http://Example.com  ")).toBe("http://example.com/");
    expect(openableUrl("HTTPS://example.com:8443/a")).toBe("https://example.com:8443/a");
    expect(openableUrl("//example.net/proto")).toBe("https://example.net/proto");
  });
  it("refuses everything else", () => {
    for (const bad of [
      "", "   ", "foo", "/foo", "?x=1", "#top", "mailto:a@b.example", "tel:123", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd",
      "ftp://example.com/", "blob:https://example.com/1", "https://", "https:///x", "https://bank.example@evil.example/", "https://u:p@example.com/", "https://exa mple.com/",
      "https://example.com/a b", "https://exa\nmple.com/", "https://example.com/\u0009x", "https://example.com/\u0000", "\u0001https://example.com/", "http:example.com", "https:/example.com",
      `https://example.com/${"x".repeat(OPEN_URL_MAX)}`,
    ]) expect(openableUrl(bad), JSON.stringify(bad)).toBeNull();
    for (const bad of [undefined, null, 12, {}, [], true]) expect(openableUrl(bad)).toBeNull();
  });
});
