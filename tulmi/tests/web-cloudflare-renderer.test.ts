/**
 * The renderer that uses Cloudflare's Browser Rendering REST /content endpoint (src/web/browser/cloudflare.ts), with a fake
 * fetch: what it asks, what it makes of the answer, what it refuses before and after, and getRenderer() choosing it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { cloudflareRenderer, cloudflareRendererFromConfig } = await import("../src/web/browser/cloudflare.js");
const { getRenderer, BrowserError } = await import("../src/web/browser/index.js");
const { readPage } = await import("../src/web/reader.js");
const { resetConfigForTests } = await import("../src/config.js");

interface Seen { url: string; init: RequestInit; json: Record<string, unknown> }

function api(answers: Array<Response | Error>) {
  const seen: Seen[] = [];
  const queue = [...answers];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, init, json: JSON.parse(String(init.body)) });
    const next = queue.shift() ?? ok("<html><body>rendered</body></html>");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchFn, seen };
}
const ok = (html: string, meta: Record<string, unknown> = {}) =>
  Response.json({ success: true, result: html, meta: { finalUrl: "https://example.com/app", status: 200, title: "The app", ...meta } });
const render = (a: ReturnType<typeof api>, o: Record<string, unknown> = {}) => cloudflareRenderer({ accountId: "acct 1", apiToken: "tok", fetchFn: a.fetchFn, ...o });
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return "no error"; } catch (e) { return (e as { code?: string }).code ?? "other"; } };

describe("the request", () => {
  it("posts the url to the account's browser-run /content endpoint with the token", async () => {
    const a = api([]);
    const page = await render(a)("https://example.com/app", { timeoutMs: 15_000 });
    expect(a.seen).toHaveLength(1);
    expect(a.seen[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct%201/browser-run/content?cacheTTL=0");
    expect(a.seen[0]!.init.method).toBe("POST");
    const headers = new Headers(a.seen[0]!.init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
    expect(headers.get("content-type")).toBe("application/json");
    expect(a.seen[0]!.json).toMatchObject({ url: "https://example.com/app", bestAttempt: true, rejectResourceTypes: ["image", "media", "font"], gotoOptions: { waitUntil: "networkidle2", timeout: 15_000 } });
    expect(page).toEqual({ html: "<html><body>rendered</body></html>", finalUrl: "https://example.com/app", title: "The app", status: 200 });
  });

  it("caps the navigation time at Cloudflare's 60 seconds, and loads everything when asked not to block resources", async () => {
    const a = api([]);
    await render(a)("https://example.com/", { timeoutMs: 300_000, blockResources: false });
    expect((a.seen[0]!.json.gotoOptions as { timeout: number }).timeout).toBe(60_000);
    expect(a.seen[0]!.json).not.toHaveProperty("rejectResourceTypes");
  });

  it("sends the reader's User-Agent when it has one", async () => {
    const a = api([]);
    await render(a, { userAgent: "TailzuBot/1.0" })("https://example.com/");
    expect(a.seen[0]!.json.userAgent).toBe("TailzuBot/1.0");
  });

  it("tries the name the API reference still lists when the product's route is not found", async () => {
    const a = api([new Response("{}", { status: 404 }), ok("<p>x</p>")]);
    const page = await render(a)("https://example.com/");
    expect(a.seen.map((s) => new URL(s.url).pathname)).toEqual(["/client/v4/accounts/acct%201/browser-run/content", "/client/v4/accounts/acct%201/browser-rendering/content"]);
    expect(page.html).toBe("<p>x</p>");
  });

  it("uses a base address of its own when given one (a test, a proxy)", async () => {
    const a = api([]);
    await render(a, { baseUrl: "https://cf.test/v4/" })("https://example.com/");
    expect(a.seen[0]!.url).toBe("https://cf.test/v4/accounts/acct%201/browser-run/content?cacheTTL=0");
  });
});

describe("what it refuses before sending anything", () => {
  it.each([
    ["ftp://example.com/", "bad_url"], ["javascript:alert(1)", "bad_url"], ["not a url", "bad_url"], ["file:///etc/passwd", "bad_url"],
    ["http://127.0.0.1/", "blocked"], ["https://10.0.0.5/admin", "blocked"], ["https://[::1]/", "blocked"], ["http://2130706433/", "blocked"],
    ["https://localhost/", "blocked"], ["https://db.internal/", "blocked"], ["https://printer.local/", "blocked"], ["http://metadata/", "blocked"],
  ])("%s is %s", async (url, expected) => {
    const a = api([]);
    expect(await code(render(a)(url))).toBe(expected);
    expect(a.seen).toHaveLength(0);
  });

  it("opens an http page as well as an https one, as the engine does", async () => {
    const a = api([]);
    await render(a)("http://example.com/old");
    expect(a.seen[0]!.json.url).toBe("http://example.com/old");
  });
});

describe("what it makes of the answer", () => {
  it("judges where the page ended up like where it was asked for", async () => {
    expect(await code(render(api([ok("<p/>", { finalUrl: "https://127.0.0.1/secret" })]))("https://example.com/"))).toBe("blocked");
    expect(await code(render(api([ok("<p/>", { finalUrl: "https://intranet/" })]))("https://example.com/"))).toBe("blocked");
    expect(await code(render(api([ok("<p/>", { finalUrl: "chrome-error://chromewebdata/" })]))("https://example.com/"))).toBe("bad_url");
  });

  it("falls back to the address asked for, a status of 200 and no title when meta says nothing", async () => {
    const a = api([Response.json({ success: true, result: "<p>hi</p>" })]);
    expect(await render(a)("https://example.com/x")).toEqual({ html: "<p>hi</p>", finalUrl: "https://example.com/x", title: "", status: 200 });
  });

  it("passes the page's own status on (a 404 page is rendered; the reader decides what it means)", async () => {
    expect((await render(api([ok("<h1>Not here</h1>", { status: 404 })]))("https://example.com/gone")).status).toBe(404);
  });

  it("keeps at most four million characters of HTML", async () => {
    const page = await render(api([ok("x".repeat(4_500_000))]))("https://example.com/");
    expect(page.html.length).toBe(4_000_000);
  });

  it.each([
    [new Response("{}", { status: 429 }), "busy"],
    [new Response("{}", { status: 401 }), "unavailable"],
    [new Response("{}", { status: 403 }), "unavailable"],
    [new Response("{}", { status: 408 }), "timeout"],
    [new Response("{}", { status: 504 }), "timeout"],
    [new Response("{}", { status: 502 }), "unavailable"],
    [Response.json({ success: false, errors: [{ code: 1, message: "Navigation timeout of 20000 ms exceeded" }] }), "timeout"],
    [Response.json({ success: false, errors: [{ code: 2, message: "net::ERR_NAME_NOT_RESOLVED" }] }), "navigation_failed"],
    [Response.json({ success: true }), "navigation_failed"],
    [new Response("<html>not json</html>"), "navigation_failed"],
    [Object.assign(new Error("slow"), { name: "TimeoutError" }), "timeout"],
    [new Error("connection reset"), "unavailable"],
  ])("answers %# with the code %s", async (answer, expected) => {
    expect(await code(render(api([answer as Response]))("https://example.com/"))).toBe(expected);
  });

  it("never puts the token or the page's address in an error", async () => {
    let msg = "";
    try { await render(api([new Response("{}", { status: 401 })]), { apiToken: "very-secret-token" })("https://example.com/private?x=1"); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toContain("very-secret-token");
    expect(msg).not.toContain("private");
  });
});

describe("used by the reader", () => {
  it("renders a page that needs its scripts, and then the reader's own extractor and rules run on it", async () => {
    const shell = '<html><head><title>x</title></head><body><div id="root"></div><script>1</script></body></html>';
    const rendered = "<html><head><title>Docs</title></head><body><main><h1>Real content</h1><p>This page was drawn by scripts and has plenty of words in it for the reader.</p></main></body></html>";
    const a = api([ok(rendered, { finalUrl: "https://docs.example.com/page", title: "Docs" })]);
    const fetchFn = (async () => new Response(shell, { headers: { "content-type": "text/html" } })) as never;
    const page = await readPage("https://docs.example.com/page", { fetchFn, render: render(a), cache: null });
    expect(page.via).toBe("browser");
    expect(page.text).toContain("Real content");
    expect(a.seen).toHaveLength(1);
  });

  it("turns the renderer's refusal into the reader's, and a page that ended up somewhere private is not read", async () => {
    const shell = '<html><body><div id="root"></div><script>1</script></body></html>';
    const fetchFn = (async () => new Response(shell, { headers: { "content-type": "text/html" } })) as never;
    const a = api([ok("<p>secret</p>", { finalUrl: "https://10.1.1.1/admin" })]);
    await expect(readPage("https://docs.example.com/page", { fetchFn, render: render(a), cache: null })).rejects.toMatchObject({ code: "blocked_address" });
  });
});

describe("getRenderer()", () => {
  const set = (env: Record<string, string>) => {
    for (const k of ["WEB_BROWSER", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) delete process.env[k];
    Object.assign(process.env, env);
    resetConfigForTests();
  };
  afterEach(() => set({}));

  it("is Cloudflare's when WEB_BROWSER=cloudflare and the account and token are set", () => {
    set({ WEB_BROWSER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "tok" });
    expect(typeof getRenderer()).toBe("function");
    expect(typeof cloudflareRendererFromConfig()).toBe("function");
  });

  it("is nothing, with a line saying why (once), without them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    set({ WEB_BROWSER: "cloudflare", CLOUDFLARE_ACCOUNT_ID: "acct" });
    expect(getRenderer()).toBeNull();
    expect(getRenderer()).toBeNull();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("CLOUDFLARE_API_TOKEN")).length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });

  it("is nothing when the browser is off, and Chrome's own for local (unchanged)", () => {
    set({});
    expect(getRenderer()).toBeNull();
    set({ WEB_BROWSER: "anything else" });
    expect(getRenderer()).toBeNull();
    expect(BrowserError).toBeTypeOf("function");
  });
});
