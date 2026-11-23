import { describe, expect, it } from "vitest";
import { PAGE_CSP, page } from "../src/routes/connectors/connectors.js";
import { logUrl } from "../src/observability.js";

// The browser's done page prints an app's name, which a person chose (an app added by link), and the request log keeps
// every address the server is asked for. Neither may carry what it should not.

describe("the done page", () => {
  it("prints an app's name as text, never as markup", () => {
    const html = page("You're connected", `<a href="https://evil.example">Click</a> is ready.`);
    expect(html).not.toContain(`<a href="https://evil.example">`);
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt; is ready.");
  });

  it("allows no form, base or framing", () => {
    expect(PAGE_CSP).toContain("form-action 'none'");
    expect(PAGE_CSP).toContain("base-uri 'none'");
    expect(PAGE_CSP).toContain("frame-ancestors 'none'");
  });
});

describe("a link that is itself the key is logged without its query", () => {
  it.each([
    ["/v1/you/export/file?t=u.1.sig", "/v1/you/export/file"],
    ["/v1/connectors/callback?code=abc&state=xyz", "/v1/connectors/callback"],
    ["/v1/code/github/signin/callback?code=abc&state=xyz", "/v1/code/github/signin/callback"],
    ["/pay?u=1&e=2&t=3", "/pay"],
    ["/v1/artifacts/a1/shots/s1?exp=1&sig=abc", "/v1/artifacts/a1/shots/s1"],
  ])("%s", (url, logged) => expect(logUrl(url)).toBe(logged));

  it("keeps an ordinary query", () => {
    expect(logUrl("/v1/discover/feed?tags=warm&month=3")).toBe("/v1/discover/feed?tags=warm&month=3");
  });
});
