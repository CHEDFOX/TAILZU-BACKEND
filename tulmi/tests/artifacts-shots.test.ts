/**
 * Screenshots (src/artifacts/shots.ts, shothost.ts): the request Cloudflare's /screenshot endpoint is sent, the host page of an artifact, the local
 * Chrome fallback, the store a picture is kept in, and the signed link to it. Cloudflare is a fake `fetch`; nothing reaches a network.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const shots = await import("../src/artifacts/shots.js");
const { shotHostHtml, shotAllowPatterns, viewerOrigin, SHOT_SETTLE_MS } = await import("../src/artifacts/shothost.js");
const { encodePng, solid } = await import("../src/artifacts/pixels.js");
const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
const { ArtifactService } = await import("../src/artifacts/service.js");

const PNG = encodePng(solid(8, 8, [10, 20, 30]));
const TOKEN = ["cf", "api", "token", "for", "tests", String(Date.now())].join("-");
const VIEWER = "https://shots.viewer.example";

interface Seen { url: string; headers: Record<string, string>; body: Record<string, any> }

/** A fake Cloudflare: answers each call from `reply`, and keeps what it was sent. */
function cloudflare(reply: (seen: Seen, n: number) => Response | Promise<Response> = () => new Response(PNG, { headers: { "content-type": "image/png" } })) {
  const calls: Seen[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    const seen: Seen = { url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(String(init.body)) };
    calls.push(seen);
    return reply(seen, calls.length - 1);
  };
  const deps = { accountId: "acct123", apiToken: TOKEN, fetchFn, viewerUrl: VIEWER };
  return { calls, deps };
}

const ART = { id: "a1", type: "react" as const, title: "Pricing card", content: "export default function App() { return <h1>Hi</h1>; }" };

describe("shootArtifact: the request Cloudflare is sent", () => {
  it("is the host page as `html` (never a url), waits for #done, names the viewport, and may fetch only the viewer and the font hosts", async () => {
    const cf = cloudflare();
    const kit = { css: ":root{--tz-primary:#7c3aed}", fonts: ["https://fonts.googleapis.com/css2?family=Inter"] };
    const png = await shots.shootArtifact(ART, 3, kit, "mobile", cf.deps, { theme: "dark" });
    expect(Array.from(png)).toEqual(Array.from(PNG));
    expect(cf.calls).toHaveLength(1);
    const c = cf.calls[0]!;
    expect(c.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct123/browser-run/screenshot?cacheTTL=0");
    expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(c.body.url).toBeUndefined();
    expect(c.body.html).toContain(`src="${VIEWER}/?type=react"`);
    expect(c.body.html).toContain('sandbox="allow-scripts"');
    expect(c.body.html).toContain("width:390px;height:844px");
    expect(c.body.html).toContain('"theme":"dark"');
    expect(c.body.html).toContain("--tz-primary");
    expect(c.body.html).toContain("\\u003ch1>Hi\\u003c/h1>"); // the artifact's text, with < escaped so it cannot close the script
    expect(c.body.html).toContain('"version":3');
    // waitForSelector is an OBJECT in this API.
    expect(c.body.waitForSelector).toEqual({ selector: "#done", timeout: 25000 });
    expect(c.body.viewport).toEqual({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    expect(c.body.screenshotOptions).toEqual({ type: "png", fullPage: false });
    expect(c.body.gotoOptions).toMatchObject({ waitUntil: "load" });
    expect(c.body.gotoOptions.timeout).toBeLessThanOrEqual(60_000);
    expect(c.body.bestAttempt).toBe(true);
    const allow = (c.body.allowRequestPattern as string[]).map((p) => new RegExp(p));
    for (const ok of [`${VIEWER}/`, `${VIEWER}/vendor/react.js`, "https://fonts.googleapis.com/css2?family=Inter", "https://fonts.gstatic.com/s/inter.woff2", "data:image/png;base64,AAAA", "blob:https://x/1", "about:blank"]) {
      expect(allow.some((re) => re.test(ok)), ok).toBe(true);
    }
    for (const no of ["https://evil.example/", `${VIEWER}.evil.example/`, `https://x${VIEWER.slice(8)}/`, "http://169.254.169.254/", "https://cdn.example/pic.png"]) {
      expect(allow.some((re) => re.test(no)), no).toBe(false);
    }
  });

  it("is a desktop viewport for desktop, and a hostile artifact cannot close the script it is written into", async () => {
    const cf = cloudflare();
    const evil = { ...ART, content: `</script><script>window.pwned=1</script> // ${" "}` };
    await shots.shootArtifact(evil, 1, undefined, "desktop", cf.deps);
    const c = cf.calls[0]!;
    expect(c.body.viewport).toEqual({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    const html = String(c.body.html);
    // One script element, and the artifact's text is inside a JSON string in it.
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const json = /var DATA = (.*);\n/.exec(html)![1]!;
    expect(JSON.parse(json).artifact.content).toBe(evil.content);
  });

  it("tries the API reference's name for the endpoint when the product page's is a 404", async () => {
    const cf = cloudflare((_s, n) => (n === 0 ? new Response("{}", { status: 404 }) : new Response(PNG, { headers: { "content-type": "image/png" } })));
    await shots.shootArtifact(ART, 1, undefined, "mobile", cf.deps);
    expect(cf.calls.map((c) => c.url.match(/accounts\/acct123\/([a-z-]+)\//)![1])).toEqual(["browser-run", "browser-rendering"]);
  });

  it("is refused with a reason where there is no viewer for shots, or no browser", async () => {
    await expect(shots.shootArtifact(ART, 1, undefined, "mobile", { accountId: "a", apiToken: TOKEN })).rejects.toMatchObject({ code: "no_viewer" });
    await expect(shots.shootArtifact(ART, 1, undefined, "mobile", { viewerUrl: VIEWER })).rejects.toMatchObject({ code: "no_browser" });
    expect(shots.shootProblem({ viewerUrl: VIEWER })).toMatch(/No browser/);
    expect(shots.shootProblem({ accountId: "a", apiToken: TOKEN }, { artifact: true })).toMatch(/No viewer/);
    expect(shots.shootProblem({ accountId: "a", apiToken: TOKEN, viewerUrl: VIEWER }, { artifact: true })).toBeNull();
  });

  it("goes to our own Chrome when Cloudflare is not set up: html, the #done selector, and the same allowed requests as patterns", async () => {
    const seen: any[] = [];
    await shots.shootArtifact(ART, 1, undefined, "mobile", { viewerUrl: VIEWER, local: async (o) => { seen.push(o); return PNG; } });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBeUndefined();
    expect(seen[0].html).toContain(`src="${VIEWER}/?type=react"`);
    expect(seen[0]).toMatchObject({ viewport: { width: 390, height: 844, mobile: true }, waitForSelector: "#done", selectorTimeoutMs: 25000 });
    expect(seen[0].allow.some((re: RegExp) => re.test(`${VIEWER}/x.js`))).toBe(true);
    expect(seen[0].allow.some((re: RegExp) => re.test("https://evil.example/"))).toBe(false);
  });
});

describe("shootUrl", () => {
  it("sends the address, the viewport, the cookies for the page's own origin, and waits for a selector, in the API's own shapes", async () => {
    const cf = cloudflare();
    await shots.shootUrl("https://tok.preview.example/dashboard?x=1", { viewport: "desktop", cookies: [{ name: "tzpv", value: "abc" }, { name: "o", value: "1", domain: "preview.example" }], waitFor: { selector: "main", timeoutMs: 9000 } }, cf.deps);
    const b = cf.calls[0]!.body;
    expect(b.url).toBe("https://tok.preview.example/dashboard?x=1");
    expect(b.html).toBeUndefined();
    expect(b.viewport).toEqual({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    expect(b.cookies).toEqual([{ name: "tzpv", value: "abc", url: "https://tok.preview.example" }, { name: "o", value: "1", domain: "preview.example" }]);
    expect(b.waitForSelector).toEqual({ selector: "main", timeout: 9000, visible: true });
    expect(b.gotoOptions.waitUntil).toBe("networkidle2");
    expect(b.allowRequestPattern).toBeUndefined();
  });

  it("refuses addresses it should not open, before anything is sent", async () => {
    const cf = cloudflare();
    for (const bad of ["not an address", "file:///etc/passwd", "ftp://example.com/", "http://127.0.0.1:8080/", "http://169.254.169.254/latest", "http://[::1]/", "http://localhost:3000/", "https://db.internal/"]) {
      await expect(shots.shootUrl(bad, { viewport: "mobile" }, cf.deps), bad).rejects.toBeInstanceOf(shots.ShotError);
    }
    expect(cf.calls).toHaveLength(0);
  });

  it("reads a JSON answer with the picture in `result` as well as a bare image, and says why when it cannot", async () => {
    const b64 = Buffer.from(PNG).toString("base64");
    const json = (o: object, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    const ok = cloudflare(() => json({ success: true, result: b64 }));
    expect(Array.from(await shots.shootUrl("https://a.example/", { viewport: "mobile" }, ok.deps))).toEqual(Array.from(PNG));
    const fails: Array<[() => Response, string]> = [
      [() => json({ success: true, result: "" }), "failed"],
      [() => json({ success: false, errors: [{ message: "Waiting for selector `#x` timed out" }] }, 200), "timeout"],
      [() => json({ success: false, errors: [{ message: "bad" }] }, 400), "failed"],
      [() => new Response("<html>", { headers: { "content-type": "text/html" }, status: 200 }), "failed"],
      [() => new Response("nope", { status: 200, headers: { "content-type": "image/png" } }), "not_png"],
      [() => new Response("", { status: 429 }), "busy"],
      [() => new Response("", { status: 401 }), "unavailable"],
      [() => new Response("", { status: 403 }), "unavailable"],
      [() => new Response("", { status: 408 }), "timeout"],
      [() => new Response("", { status: 504 }), "timeout"],
      [() => new Response("", { status: 502 }), "unavailable"],
    ];
    for (const [make, code] of fails) {
      const cf = cloudflare(make);
      await expect(shots.shootUrl("https://a.example/", { viewport: "mobile" }, cf.deps), code).rejects.toMatchObject({ code });
    }
    const down = cloudflare(() => { throw Object.assign(new Error("offline"), { name: "TypeError" }); });
    await expect(shots.shootUrl("https://a.example/", { viewport: "mobile" }, down.deps)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses a picture over 8 MB, and an error never carries the token", async () => {
    const big = cloudflare(() => new Response(new Uint8Array(shots.SHOT_MAX_BYTES + 1).fill(1), { headers: { "content-type": "image/png" } }));
    await expect(shots.shootUrl("https://a.example/", { viewport: "mobile" }, big.deps)).rejects.toMatchObject({ code: "failed" });
    const cf = cloudflare(() => new Response("", { status: 401 }));
    try { await shots.shootUrl("https://a.example/", { viewport: "mobile" }, cf.deps); } catch (e) { expect(String((e as Error).message)).not.toContain(TOKEN); }
  });

  it("uses our own Chrome with the same options when that is all there is, and says so when there is nothing", async () => {
    const seen: any[] = [];
    await shots.shootUrl("https://a.example/p", { viewport: "mobile", waitFor: { selector: "#r" }, cookies: [{ name: "c", value: "1" }] }, { local: async (o) => { seen.push(o); return PNG; } });
    expect(seen[0]).toMatchObject({ url: "https://a.example/p", viewport: { width: 390, height: 844, mobile: true }, waitForSelector: "#r", cookies: [{ name: "c", value: "1", url: "https://a.example" }] });
    await expect(shots.shootUrl("https://a.example/", { viewport: "mobile" }, {})).rejects.toMatchObject({ code: "no_browser" });
    await expect(shots.shootUrl("https://a.example/", { viewport: "mobile" }, { local: async () => { throw new Error("boom"); } })).rejects.toMatchObject({ code: "failed" });
  });
});

describe("the host page", () => {
  it("frames the viewer at the viewport's size and has the settle time", () => {
    expect(viewerOrigin("https://v.example/some/path?x=1")).toBe("https://v.example");
    expect(viewerOrigin("javascript:alert(1)")).toBeNull();
    expect(viewerOrigin("not a url")).toBeNull();
    expect(() => shotHostHtml({ viewerUrl: "ftp://x", artifact: { ...ART, version: 1 }, viewport: { width: 1, height: 1 } })).toThrow();
    const html = shotHostHtml({ viewerUrl: "https://v.example/x", artifact: { ...ART, version: 1 }, viewport: { width: 100, height: 50 } });
    expect(html).toContain('src="https://v.example/?type=react"');
    expect(html).toContain(`"settleMs":${SHOT_SETTLE_MS}`);
    expect(shotAllowPatterns("nope")).toEqual([]);
  });
});

describe("keeping shots", () => {
  const png = (n: number, seed = 1): Uint8Array => {
    // A PNG-looking blob of an exact size (the store keeps bytes; it does not read them).
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) b[i] = (i * 31 + seed) & 255;
    return b;
  };
  const meta = (artifactId: string, kind: "built" | "approved" = "built") => ({ artifactId, version: 2, kind, viewport: "mobile" as const, jobId: "job-1", at: 1 });
  const USER = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";

  it("memory: a shot is the owner's, for its artifact, until it expires", async () => {
    let t = 1000;
    const store = new shots.MemoryShotStore(() => t);
    const { id } = await store.put(USER, meta("a1"), png(100));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(Array.from((await store.get(USER, "a1", id))!.png)).toEqual(Array.from(png(100)));
    expect(await store.get(OTHER, "a1", id)).toBeNull();
    expect(await store.get(USER, "a2", id)).toBeNull();
    t += shots.SHOT_TTL_MS + 1;
    expect(await store.get(USER, "a1", id)).toBeNull();
  });

  it("in the artifact's saved data: cut in pieces, in a scope of their own under _tz/shot/, owner-only, gone after 7 days, pruned to 40 and to 480 keys", async () => {
    let t = 5_000_000;
    const mem = new MemoryArtifactStore(() => t);
    const svc = new ArtifactService({ store: mem, now: () => t });
    const art = (await svc.create(USER, { type: "markdown", title: "T", content: "# hi" })).artifact;
    const store = new shots.ArtifactDataShotStore({
      dataGet: (id, scope, key) => mem.dataGet(id, scope as never, key), dataPut: (id, scope, key, v) => mem.dataPut(id, scope as never, key, v), dataDelete: (id, scope, key) => mem.dataDelete(id, scope as never, key),
    }, () => t);

    const big = png(130 * 1024, 7);
    const { id } = await store.put(USER, meta(art.id), big);
    const keys = await mem.dataKeys(art.id, shots.shotScope(USER) as never);
    expect(keys.filter((k) => k.startsWith("_tz/shot/"))).toHaveLength(4 + 1 + 1); // four 40 KB pieces, the shot's meta, the index
    expect(await mem.dataKeys(art.id, "shared")).toEqual([]); // nothing in the shared scope: a share link's holder sees none of it
    // Not in the person's own scope either: what the artifact itself can list, read or fill is untouched by the shots.
    expect(await mem.dataKeys(art.id, USER as never)).toEqual([]);
    const acc = await svc.access(art.id, { userId: USER });
    expect(await svc.dataKeys(acc, "me")).toEqual([]);
    expect(await svc.dataGet(acc, "me", `_tz/shot/${id}/m`)).toBeNull();
    expect(shots.shotScope(USER)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/); // what the table's check accepts
    expect(shots.shotScope(USER)).not.toBe(shots.shotScope(OTHER));
    expect(shots.shotScope(USER)).toBe(shots.shotScope(USER));
    const back = (await store.get(USER, art.id, id))!;
    expect(back.png.length).toBe(big.length);
    expect(Array.from(back.png.subarray(0, 64))).toEqual(Array.from(big.subarray(0, 64)));
    expect(Array.from(back.png.subarray(-64))).toEqual(Array.from(big.subarray(-64)));
    expect(back.meta).toMatchObject({ artifactId: art.id, kind: "built", viewport: "mobile" });
    expect(await store.get(OTHER, art.id, id)).toBeNull();
    expect(await store.get(USER, "00000000-0000-4000-8000-000000000000", id)).toBeNull();
    expect(await store.get(USER, art.id, "not-an-id")).toBeNull();
    expect(await store.get(USER, art.id, "0".repeat(32))).toBeNull();

    // Expired: unreadable at once, and the next put removes its pieces.
    t += shots.SHOT_TTL_MS + 1;
    expect(await store.get(USER, art.id, id)).toBeNull();
    await store.put(USER, meta(art.id), png(10));
    expect((await mem.dataKeys(art.id, shots.shotScope(USER) as never)).filter((k) => k.startsWith(`_tz/shot/${id}`))).toEqual([]);

    // Only 40 are kept: the oldest goes with its pieces.
    const ids: string[] = [];
    for (let i = 0; i < 43; i += 1) ids.push((await store.put(USER, meta(art.id), png(50_000, i))).id);
    expect(await store.get(USER, art.id, ids[0]!)).toBeNull();
    expect(await store.get(USER, art.id, ids[2]!)).toBeNull();
    expect(await store.get(USER, art.id, ids[42]!)).not.toBeNull();
    expect((await mem.dataKeys(art.id, shots.shotScope(USER) as never)).filter((k) => k.startsWith(`_tz/shot/${ids[0]}`))).toEqual([]);
    expect((await mem.dataKeys(art.id, shots.shotScope(USER) as never)).filter((k) => k.startsWith("_tz/shot/")).length).toBeLessThan(40 * 3 + 2);

    // The scope holds 500 keys: the shots keep to 480 of them (oldest out first), and a picture that alone would not fit is refused whole.
    for (let i = 0; i < 30; i += 1) await store.put(USER, meta(art.id), png(400 * 1024, i)); // 10 pieces + meta each
    const used = (await mem.dataKeys(art.id, shots.shotScope(USER) as never)).length;
    expect(used).toBeLessThanOrEqual(shots.SHOT_KEYS_MAX);
    expect(used).toBeGreaterThan(300);
    const before = await mem.dataKeys(art.id, shots.shotScope(USER) as never);
    await expect(store.put(USER, meta(art.id), png(479 * 40 * 1024, 1))).rejects.toMatchObject({ code: "store" });
    expect(await mem.dataKeys(art.id, shots.shotScope(USER) as never)).toEqual(before);
  });
});

describe("the signed link", () => {
  const SECRET = ["shot", "secret", "0123456789abcdef0123456789abcdef"].join("-");
  const base = { secret: SECRET, userId: "user-1", artifactId: "art-1", shotId: "f".repeat(32) };
  const parts = (p: string) => { const u = new URL(p, "https://api.example"); return { exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig") }; };

  it("is good for the owner, for that artifact and shot, until it expires 7 days on", () => {
    const now = 1_800_000_000_000;
    const path = shots.signShotPath({ ...base, now });
    expect(path).toMatch(/^\/v1\/artifacts\/art-1\/shots\/f{32}\?exp=\d+&sig=[0-9a-f]{43}$/);
    const { exp, sig } = parts(path);
    expect(Number(exp)).toBe(now + 7 * 24 * 3600_000);
    expect(shots.verifyShotLink({ ...base, exp, sig, now: now + 1000 })).toBe(true);
    expect(shots.verifyShotLink({ ...base, exp, sig, now: now + 7 * 24 * 3600_000 })).toBe(false);
  });

  it("is refused for another person, artifact, shot or time, another secret, or a signature that is not one", () => {
    const now = 1_800_000_000_000;
    const { exp, sig } = parts(shots.signShotPath({ ...base, now }));
    const ok = (over: object) => shots.verifyShotLink({ ...base, exp, sig, now: now + 1000, ...over });
    expect(ok({})).toBe(true);
    expect(ok({ userId: "user-2" })).toBe(false);
    expect(ok({ artifactId: "art-2" })).toBe(false);
    expect(ok({ shotId: "e".repeat(32) })).toBe(false);
    expect(ok({ exp: String(Number(exp) + 1) })).toBe(false);
    expect(ok({ secret: "another-secret-0123456789abcdef01234567" })).toBe(false);
    expect(ok({ sig: sig!.slice(0, 42) + (sig!.endsWith("a") ? "b" : "a") })).toBe(false);
    expect(ok({ sig: "" })).toBe(false);
    expect(ok({ sig: undefined })).toBe(false);
    expect(ok({ exp: "soon" })).toBe(false);
    expect(ok({ exp: undefined })).toBe(false);
  });
});
