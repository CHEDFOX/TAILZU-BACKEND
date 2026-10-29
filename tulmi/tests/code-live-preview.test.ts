/**
 * The preview's address, token and header rules (src/code/live/preview.ts): pure functions, the same on the Worker and here.
 */
import { describe, expect, it } from "vitest";
import {
  PREVIEW_COOKIE, base32, cookieValue, cookieWithoutDomain, doorHeaders, guardSite, isPreviewToken, mintPreviewToken, previewParents, previewSite, previewTarget, previewUrl,
  readPreviewToken, requestHeadersFor, responseHeadersFor, rewriteLocation, routingCookie, siteOf, unbase32, withoutCookie,
} from "../src/code/live/preview.js";

const JOB = "3f9a1c2b-7d4e-4a10-9c3b-0123456789ab";
const SECRET = ["preview", "test", "secret", "0123456789abcdef0123456789abcdef"].join("-");

describe("base32", () => {
  it("round trips any bytes, in lower case letters and 2 to 7", () => {
    for (const len of [0, 1, 2, 5, 16, 38, 39]) {
      const b = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      const text = base32(b);
      expect(text).toMatch(/^[a-z2-7]*$/);
      expect([...unbase32(text)!]).toEqual([...b]);
    }
    expect(unbase32("abc1")).toBeNull();
    expect(unbase32("ABC")).toBeNull();
  });
});

describe("the token", () => {
  it("is 61 letters, fits a DNS label, and reads back to its job, nonce and expiry", () => {
    const now = 1_800_000_000_000;
    const t = mintPreviewToken({ secret: SECRET, jobId: JOB, ttlMs: 20 * 60_000, now });
    expect(t.token).toHaveLength(61);
    expect(t.token.length).toBeLessThanOrEqual(63);
    expect(isPreviewToken(t.token)).toBe(true);
    expect(t.exp).toBe(Math.floor((now + 20 * 60_000) / 1000) * 1000);
    expect(readPreviewToken(SECRET, t.token, now + 1000)).toEqual({ ok: true, jobId: JOB, nonce: t.nonce, exp: t.exp });
  });

  it("is different every time, and cannot be guessed from the job or the time", () => {
    const a = mintPreviewToken({ secret: SECRET, jobId: JOB, ttlMs: 60_000, now: 1_800_000_000_000 });
    const b = mintPreviewToken({ secret: SECRET, jobId: JOB, ttlMs: 60_000, now: 1_800_000_000_000 });
    expect(a.token).not.toBe(b.token);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("is refused when it is malformed, signed with another secret, changed anywhere, or past its time", () => {
    const now = 1_800_000_000_000;
    const t = mintPreviewToken({ secret: SECRET, jobId: JOB, ttlMs: 60_000, now });
    expect(readPreviewToken(SECRET, t.token, now + 61_000)).toEqual({ ok: false, reason: "expired" });
    expect(readPreviewToken(["another", "secret", "x".repeat(32)].join("-"), t.token, now)).toEqual({ ok: false, reason: "bad_signature" });
    for (const bad of [undefined, null, 12, "", "short", t.token + "a", t.token.toUpperCase(), t.token.slice(1), `${t.token.slice(0, 60)}1`]) {
      expect(readPreviewToken(SECRET, bad, now), String(bad)).toMatchObject({ ok: false });
    }
    // Every position of the token is covered: changing one letter anywhere makes it unreadable (or a different, unsigned token).
    let accepted = 0;
    for (let i = 0; i < t.token.length; i += 1) {
      const swapped = t.token.slice(0, i) + (t.token[i] === "a" ? "b" : "a") + t.token.slice(i + 1);
      if (readPreviewToken(SECRET, swapped, now).ok) accepted += 1;
    }
    expect(accepted).toBe(0);
  });

  it("is made for a job, which is a UUID", () => {
    expect(() => mintPreviewToken({ secret: SECRET, jobId: "job-1", ttlMs: 1000 })).toThrow();
  });
});

describe("the address", () => {
  const token = mintPreviewToken({ secret: SECRET, jobId: JOB, ttlMs: 60_000 }).token;

  it("is <token>.<domain> in wildcard mode and <host>/p/<token>/ in cookie mode, and wildcard wins when both are set", () => {
    expect(previewUrl({ domain: "tailzu-preview.app" }, token)).toBe(`https://${token}.tailzu-preview.app/`);
    expect(previewUrl({ host: "preview.tailzu-preview.app" }, token)).toBe(`https://preview.tailzu-preview.app/p/${token}/`);
    expect(previewUrl({ domain: "a.example", host: "b.example" }, token)).toBe(`https://${token}.a.example/`);
    expect(previewUrl({}, token)).toBeNull();
  });

  it("reads the settings: only valid host names, never one under workers.dev", () => {
    expect(previewSite({ PREVIEW_DOMAIN: " Tailzu-Preview.App ", PREVIEW_HOST: "preview.tailzu-preview.app." })).toEqual({ domain: "tailzu-preview.app", host: "preview.tailzu-preview.app" });
    expect(previewSite({ PREVIEW_DOMAIN: "", PREVIEW_HOST: undefined })).toEqual({});
    expect(previewSite({ PREVIEW_DOMAIN: "not a host", PREVIEW_HOST: "localhost" })).toEqual({});
    expect(previewSite({ PREVIEW_DOMAIN: "tailzu-jobs.acct.workers.dev", PREVIEW_HOST: "x.workers.dev" })).toEqual({});
  });

  it("says what a request is for, from its host and path", () => {
    const wild = { domain: "tailzu-preview.app" };
    expect(previewTarget(new URL(`https://${token}.tailzu-preview.app/src/main.tsx?x=1`), wild)).toEqual({ kind: "wildcard", token, path: "/src/main.tsx?x=1" });
    // Host names are case-insensitive: a browser may send either, and the URL parser lower-cases it.
    expect(previewTarget(new URL(`https://${token.toUpperCase()}.TAILZU-PREVIEW.APP/`), wild)).toEqual({ kind: "wildcard", token, path: "/" });
    expect(previewTarget(new URL("https://www.tailzu-preview.app/"), wild)).toEqual({ kind: "none" });
    expect(previewTarget(new URL("https://tailzu-preview.app/"), wild)).toEqual({ kind: "none" });
    expect(previewTarget(new URL("https://a.b.tailzu-preview.app/"), wild)).toEqual({ kind: "none" });
    expect(previewTarget(new URL("https://jobs.example/"), wild)).toBeNull();
    const cookie = { host: "preview.tailzu-preview.app" };
    expect(previewTarget(new URL(`https://preview.tailzu-preview.app/p/${token}/a/b?c=1`), cookie)).toEqual({ kind: "entry", token, rest: "/a/b?c=1" });
    expect(previewTarget(new URL(`https://preview.tailzu-preview.app/p/${token}`), cookie)).toEqual({ kind: "entry", token, rest: "/" });
    expect(previewTarget(new URL(`https://preview.tailzu-preview.app/p/${token}?x=1`), cookie)).toEqual({ kind: "entry", token, rest: "/?x=1" });
    expect(previewTarget(new URL("https://preview.tailzu-preview.app/p/nottoken/x"), cookie)).toEqual({ kind: "cookie", path: "/p/nottoken/x" });
    expect(previewTarget(new URL("https://preview.tailzu-preview.app/src/main.js"), cookie)).toEqual({ kind: "cookie", path: "/src/main.js" });
    expect(previewTarget(new URL("https://other.example/"), cookie)).toBeNull();
  });

  it("takes out a preview site that shares a site with the app or the API", () => {
    const own = ["x0bot.com", "api.x0bot.com", "tailzu-jobs.acct.workers.dev"];
    expect(guardSite({ domain: "tailzu-preview.app" }, own)).toEqual({ site: { domain: "tailzu-preview.app" }, refused: [] });
    expect(guardSite({ domain: "preview.x0bot.com" }, own).site).toEqual({});
    expect(guardSite({ host: "www.x0bot.com" }, own).site).toEqual({});
    expect(guardSite({ domain: "x0bot.com", host: "p.tailzu-preview.app" }, own)).toMatchObject({ site: { host: "p.tailzu-preview.app" } });
    expect(guardSite({ domain: "a.co.uk" }, ["b.co.uk"]).site).toEqual({ domain: "a.co.uk" });
    expect(guardSite({ domain: "x.a.co.uk" }, ["y.a.co.uk"]).site).toEqual({});
    expect(siteOf("a.b.example.com")).toBe("example.com");
    expect(siteOf("a.b.example.co.uk")).toBe("example.co.uk");
    expect(guardSite({ domain: "x0bot.com" }, own).refused[0]).toMatch(/PREVIEW_DOMAIN shares a site/);
  });

  it("keeps the app's origins for framing: scheme and host (or one wildcard level), nothing else", () => {
    expect(previewParents("https://x0bot.com, https://www.x0bot.com/ http://localhost:3000 https://*.preview.x0bot.com")).toEqual(["https://x0bot.com", "https://www.x0bot.com", "http://localhost:3000", "https://*.preview.x0bot.com"]);
    expect(previewParents("*, null, https://*.com, https://a.b/path, ftp://x.y, javascript:alert(1)")).toEqual([]);
    expect(previewParents(undefined)).toEqual([]);
  });
});

describe("the cookie", () => {
  it("is host-only, HttpOnly, Secure and SameSite=Lax, for the life of the token", () => {
    const c = routingCookie("tok", 1234.9);
    expect(c).toBe(`${PREVIEW_COOKIE}=tok; Path=/; Max-Age=1234; HttpOnly; Secure; SameSite=Lax`);
    expect(c).not.toMatch(/domain/i);
    expect(routingCookie("tok", -5)).toContain("Max-Age=1;");
  });

  it("is read from a Cookie header and taken out of it before the project sees it", () => {
    expect(cookieValue(`a=1; ${PREVIEW_COOKIE}=abc; b=2`, PREVIEW_COOKIE)).toBe("abc");
    expect(cookieValue("a=1", PREVIEW_COOKIE)).toBeUndefined();
    expect(cookieValue(`x${PREVIEW_COOKIE}=1`, PREVIEW_COOKIE)).toBeUndefined();
    expect(cookieValue(null, PREVIEW_COOKIE)).toBeUndefined();
    expect(withoutCookie(`a=1; ${PREVIEW_COOKIE}=abc; b=2`, PREVIEW_COOKIE)).toBe("a=1; b=2");
    expect(withoutCookie(`${PREVIEW_COOKIE}=abc`, PREVIEW_COOKIE)).toBe("");
  });
});

describe("what crosses to the dev server", () => {
  it("drops the connection's and the edge's headers and our cookie, rewrites Origin and Referer as the dev server's own, and says the public host", () => {
    const out = requestHeadersFor([
      ["Host", "x.preview.app"], ["Connection", "keep-alive"], ["Content-Length", "5"], ["Accept-Encoding", "gzip"], ["CF-Connecting-IP", "1.2.3.4"], ["X-Forwarded-For", "1.2.3.4"],
      ["Cookie", `a=1; ${PREVIEW_COOKIE}=t`], ["Origin", "https://x.preview.app"], ["Referer", "https://x.preview.app/page?q=1"], ["Content-Type", "text/plain"], ["X-App", "yes"], ["Upgrade", "websocket"],
    ], { publicHost: "x.preview.app", port: 5173 });
    expect(Object.fromEntries(out)).toEqual({
      cookie: "a=1", origin: "http://localhost:5173", referer: "http://localhost:5173/page?q=1", "content-type": "text/plain", "x-app": "yes", "x-forwarded-host": "x.preview.app", "x-forwarded-proto": "https",
    });
    expect(requestHeadersFor([["referer", "not an address"]], { publicHost: "h", port: 1 }).find(([k]) => k === "referer")).toBeUndefined();
  });
});

describe("what crosses back to the browser", () => {
  it("sends a redirect to the dev server's own address to a root-relative one, and leaves the rest", () => {
    expect(rewriteLocation("http://localhost:5173/landed?x=1#a")).toBe("/landed?x=1#a");
    expect(rewriteLocation("https://127.0.0.1:3000")).toBe("/");
    expect(rewriteLocation("http://[::1]:8080/x")).toBe("/x");
    expect(rewriteLocation("http://0.0.0.0:3000/y")).toBe("/y");
    expect(rewriteLocation("/relative")).toBe("/relative");
    expect(rewriteLocation("https://accounts.example/login")).toBe("https://accounts.example/login");
  });

  it("takes Domain out of a cookie (it would reach every other preview under the domain) and never lets the project touch ours", () => {
    expect(cookieWithoutDomain("a=1; Path=/; Domain=.preview.app; HttpOnly")).toBe("a=1; Path=/; HttpOnly");
    expect(cookieWithoutDomain("a=1; domain = preview.app; Secure")).toBe("a=1; Secure");
    expect(cookieWithoutDomain("b=2; Path=/")).toBe("b=2; Path=/");
    expect(cookieWithoutDomain(`${PREVIEW_COOKIE}=evil; Path=/`)).toBeNull();
    expect(cookieWithoutDomain("garbage")).toBeNull();
  });

  it("cleans the headers: no framing rule, no HSTS, no connection headers, a CSP without frame-ancestors, cookies without Domain, redirects kept on the preview", () => {
    const out = responseHeadersFor([
      ["Content-Type", "text/html"], ["X-Frame-Options", "DENY"], ["Strict-Transport-Security", "max-age=1"], ["Connection", "close"], ["Transfer-Encoding", "chunked"], ["Content-Length", "9"],
      ["Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; img-src data:"], ["Set-Cookie", "a=1; Domain=.x"], ["Set-Cookie", "b=2"], ["Location", "http://localhost:3000/next"],
    ]);
    expect(out).toEqual([
      ["content-type", "text/html"], ["content-security-policy", "default-src 'self'; img-src data:"], ["set-cookie", "a=1"], ["set-cookie", "b=2"], ["location", "/next"],
    ]);
    // A CSP that was only a framing rule is dropped altogether.
    expect(responseHeadersFor([["Content-Security-Policy", "frame-ancestors 'self'"]])).toEqual([]);
  });

  it("adds the door's headers: no cache, no sniffing, no referrer, no indexing, framed only by the app", () => {
    const h = Object.fromEntries(doorHeaders(["https://x0bot.com"]));
    expect(h["cache-control"]).toBe("no-store");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["x-robots-tag"]).toMatch(/noindex/);
    expect(h["content-security-policy"]).toBe("frame-ancestors https://x0bot.com");
    expect(Object.fromEntries(doorHeaders([]))["content-security-policy"]).toBe("frame-ancestors 'none'");
  });
});
