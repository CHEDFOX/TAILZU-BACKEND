/**
 * The seam every outbound read goes through (src/web/safeFetch.ts): on the VPS it is the egress guard (connectors/egress.ts),
 * installed when that file loads; on a Worker it is workerSafeFetch. The rules of workerSafeFetch itself are tested in workerd
 * (jobs/test/worker-safe-fetch.test.ts); here, that the VPS's behaviour did not change, and that the seam holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EgressRefused } from "../src/connectors/egressTypes.js";
import * as egress from "../src/connectors/egress.js";
import { clearSafeFetchForTests, installSafeFetch, isBlockedAddress, isSafeFetchInstalled, safeFetchWith } from "../src/web/safeFetch.js";
import { isPrivateName, workerSafeFetchImpl, workerSafeFetchWith } from "../src/web/workerSafeFetch.js";
import { readPage } from "../src/web/reader.js";
import { isPublicHttpUrl } from "../src/web/search/index.js";

vi.hoisted(() => { process.env.NODE_ENV = "test"; });

afterEach(() => {
  egress.setEgressTestHooks(null);
  // The suite's setup installed the VPS guard: put it back whatever a test did.
  installSafeFetch({ fetchWith: egress.egressFetchWith, isBlockedAddress: egress.isBlockedAddress });
});

describe("on the VPS", () => {
  it("is the egress guard once connectors/egress.ts is loaded, with its exact rules", async () => {
    expect(isSafeFetchInstalled()).toBe(true);
    const hits: string[] = [];
    egress.setEgressTestHooks({ resolve: (h) => { hits.push(h); return ["10.0.0.7"]; } });
    // A public-looking name that resolves to a private address is refused inside the connection's DNS lookup: only the VPS's guard can do that.
    await expect(safeFetchWith()("https://rebind.example/")).rejects.toMatchObject({ reason: "private_address" });
    expect(hits).toContain("rebind.example");
  });

  it("refuses what egress refuses, with the same errors", async () => {
    for (const [url, reason] of [["http://example.com/", "not_https"], ["https://example.com:8080/", "bad_port"], ["https://u:p@example.com/", "userinfo"], ["https://127.0.0.1/", "private_address"]] as const) {
      const err = await safeFetchWith()(url).catch((e) => e);
      expect(err, url).toBeInstanceOf(EgressRefused);
      expect((err as EgressRefused).reason).toBe(reason);
    }
  });

  it("knows which addresses are blocked, as egress does", () => {
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("not an address")).toBe(true);
  });

  it("is looked up when a request is made, so a fetch built at load time follows whatever is installed later", async () => {
    const early = safeFetchWith({ timeoutMs: 1_000 });
    const seen: string[] = [];
    installSafeFetch({ fetchWith: () => async (url) => { seen.push(String(url)); return new Response("from the other guard"); }, isBlockedAddress: () => false });
    expect(await (await early("https://example.com/x")).text()).toBe("from the other guard");
    expect(seen).toEqual(["https://example.com/x"]);
  });

  it("fails closed, loudly, with nothing installed, and says the same for the address check", async () => {
    clearSafeFetchForTests();
    expect(isSafeFetchInstalled()).toBe(false);
    await expect(safeFetchWith()("https://example.com/")).rejects.toThrow("no safe fetch is installed");
    expect(() => isBlockedAddress("8.8.8.8")).toThrow("no safe fetch is installed");
  });
});

describe("the page reader and the search sources use the seam", () => {
  it("readPage fetches through whatever guard is installed, with its own time and size limits", async () => {
    const asked: Array<{ url: string; init?: RequestInit }> = [];
    installSafeFetch({
      fetchWith: (o) => async (url, init) => { asked.push({ url: String(url), ...(init ? { init } : {}) }); void o; return new Response("<html><head><title>T</title></head><body><main><p>Plenty of words here for a reader to find and keep as the text of this page.</p></main></body></html>", { headers: { "content-type": "text/html" } }); },
      isBlockedAddress: () => true,
    });
    const page = await readPage("https://docs.example.com/guide", { cache: null });
    expect(page.text).toContain("Plenty of words");
    expect(asked[0]!.url).toBe("https://docs.example.com/guide");
  });

  it("isPublicHttpUrl keeps its answers, through the seam", async () => {
    expect(isPublicHttpUrl(new URL("https://docs.example.com/x"))).toBe(true);
    expect(isPublicHttpUrl(new URL("https://8.8.8.8/x"))).toBe(true); // a public address written as an IP is still a public address, on the VPS
    expect(isPublicHttpUrl(new URL("https://10.0.0.1/x"))).toBe(false);
    expect(isPublicHttpUrl(new URL("https://[::1]/x"))).toBe(false);
    expect(isPublicHttpUrl(new URL("https://localhost/x"))).toBe(false);
    expect(isPublicHttpUrl(new URL("http://example.com:3000/x"))).toBe(false);
    expect(isPublicHttpUrl(new URL("https://u:p@example.com/"))).toBe(false);
    // ...and on a Worker no address written as an IP is public.
    installSafeFetch(workerSafeFetchImpl);
    expect(isPublicHttpUrl(new URL("https://8.8.8.8/x"))).toBe(false);
    expect(isPublicHttpUrl(new URL("https://docs.example.com/x"))).toBe(true);
  });
});

describe("workerSafeFetch, here in Node too", () => {
  it("is the same code that runs in the Worker: a few of its rules", async () => {
    const base = vi.fn(async () => new Response("ok"));
    const f = workerSafeFetchWith({}, base);
    expect(await (await f("https://example.com/")).text()).toBe("ok");
    for (const url of ["http://example.com/", "https://1.2.3.4/", "https://db.internal/", "https://[::1]/", "https://example.com:8080/"]) {
      await expect(f(url)).rejects.toBeInstanceOf(EgressRefused);
    }
    expect(base).toHaveBeenCalledTimes(1);
    expect(isPrivateName("docs.github.com")).toBe(false);
  });
});

describe("loading egress.ts", () => {
  it("installs the VPS guard only if no other is in place, so a Worker's choice is never overridden", async () => {
    vi.resetModules(); // a registry of its own: the earlier tests' modules are untouched
    const seam = await import("../src/web/safeFetch.js");
    expect(seam.isSafeFetchInstalled()).toBe(false);
    seam.installSafeFetch({ fetchWith: () => async () => new Response("the other guard"), isBlockedAddress: () => true });
    await import("../src/connectors/egress.js");
    expect(seam.isBlockedAddress("8.8.8.8")).toBe(true); // egress would say false: the guard installed first stays
    expect(await (await seam.safeFetchWith()("https://example.com/")).text()).toBe("the other guard");

    vi.resetModules();
    const fresh = await import("../src/web/safeFetch.js");
    await import("../src/connectors/egress.js");
    expect(fresh.isSafeFetchInstalled()).toBe(true);
    expect(fresh.isBlockedAddress("8.8.8.8")).toBe(false);
  });
});
