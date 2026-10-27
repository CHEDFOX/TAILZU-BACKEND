/** workerSafeFetch, the Worker's guard for every address it reads (tulmi/src/web/workerSafeFetch.ts), in workerd. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EgressRefused, type FetchLike } from "../../tulmi/src/connectors/egressTypes.js";
import { clearSafeFetchForTests, installSafeFetch, isBlockedAddress, safeFetchWith } from "../../tulmi/src/web/safeFetch.js";
import { checkWorkerUrl, isPrivateName, workerSafeFetchImpl, workerSafeFetchWith } from "../../tulmi/src/web/workerSafeFetch.js";

interface Seen { url: string; init: RequestInit }

/** A base fetch that answers from a list and records what it was asked. */
function fakeNet(answers: Array<Response | ((url: string) => Response)>): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const queue = [...answers];
  return {
    seen,
    fetch: async (url, init = {}) => {
      seen.push({ url: String(url), init });
      const next = queue.shift() ?? new Response("ok", { status: 200 });
      return typeof next === "function" ? next(String(url)) : next;
    },
  };
}

const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
const refusal = async (p: Promise<unknown>): Promise<string> => {
  try { await p; } catch (e) { if (e instanceof EgressRefused) return e.reason; throw e; }
  return "allowed";
};

describe("which addresses it will open", () => {
  const ask = (url: string, o = {}) => {
    const net = fakeNet([new Response("hello")]);
    return { net, run: () => workerSafeFetchWith(o, net.fetch)(url) };
  };

  it("takes a public https address, and asks the platform not to follow redirects itself", async () => {
    const { net, run } = ask("https://registry.npmjs.org/zod");
    expect(await (await run()).text()).toBe("hello");
    expect(net.seen).toHaveLength(1);
    expect(net.seen[0]!.init.redirect).toBe("manual");
  });

  it.each([
    ["http://example.com/", "not_https"],
    ["ftp://example.com/", "not_https"],
    ["https://example.com:8080/", "bad_port"],
    ["https://example.com:22/", "bad_port"],
    ["https://user:pass@example.com/", "userinfo"],
    ["https://example.com/#top", "fragment"],
  ])("refuses %s (%s)", async (url, reason) => {
    const { net, run } = ask(url);
    expect(await refusal(run())).toBe(reason);
    expect(net.seen).toHaveLength(0);
  });

  it("takes port 8443", async () => {
    expect(await refusal(ask("https://example.com:8443/x").run())).toBe("allowed");
  });

  it.each([
    "https://1.2.3.4/", "https://8.8.8.8/dns", "https://[::1]/", "https://[2606:4700:4700::1111]/", "https://[::ffff:10.0.0.1]/",
    // The other ways to write 127.0.0.1: the URL parser turns every one of them into the dotted form.
    "https://2130706433/", "https://0x7f.0.0.1/", "https://017700000001/", "https://127.1/",
  ])("refuses an address written as an IP: %s", async (url) => {
    const { net, run } = ask(url);
    expect(await refusal(run())).toBe("private_address");
    expect(net.seen).toHaveLength(0);
  });

  it.each([
    "https://localhost/", "https://localhost./", "https://app.localhost/", "https://printer.local/", "https://db.internal/", "https://x.db.internal/",
    "https://router.lan/", "https://nas.home.arpa/", "https://box.localdomain/", "https://wiki.intranet/", "https://files.corp/", "https://tv.home/",
    "https://intranet/", "https://metadata/",
  ])("refuses a name only a private network gives itself: %s", async (url) => {
    const { net, run } = ask(url);
    expect(await refusal(run())).toBe("private_address");
    expect(net.seen).toHaveLength(0);
  });

  it("does not take a public name for a private one", () => {
    for (const h of ["example.com", "docs.github.com", "locale.example.org", "internal.example.com", "localhost.example.com", "my-local.dev"]) {
      expect(isPrivateName(h)).toBe(false);
    }
    expect(() => checkWorkerUrl(new URL("https://local.example.com/"))).not.toThrow();
  });

  it("says bad_url for something that is not an address", async () => {
    expect(await refusal(workerSafeFetchWith({}, fakeNet([]).fetch)("not a url"))).toBe("bad_url");
  });
});

describe("redirects", () => {
  it("follows up to three, each one checked as the first was", async () => {
    const net = fakeNet([redirect("/a"), redirect("https://cdn.example.net/b"), redirect("/c"), new Response("arrived")]);
    const res = await workerSafeFetchWith({}, net.fetch)("https://example.com/start");
    expect(await res.text()).toBe("arrived");
    expect(net.seen.map((s) => s.url)).toEqual(["https://example.com/a".replace("/a", "/start"), "https://example.com/a", "https://cdn.example.net/b", "https://cdn.example.net/c"]);
    expect(net.seen.every((s) => s.init.redirect === "manual")).toBe(true);
  });

  it("stops at the fourth", async () => {
    const net = fakeNet([redirect("/1"), redirect("/2"), redirect("/3"), redirect("/4")]);
    expect(await refusal(workerSafeFetchWith({}, net.fetch)("https://example.com/"))).toBe("redirects");
    expect(net.seen).toHaveLength(4);
  });

  it.each([
    ["http://example.com/plain", "not_https"],
    ["https://127.0.0.1/admin", "private_address"],
    ["https://[::1]/", "private_address"],
    ["https://db.internal/", "private_address"],
    ["https://example.com:6379/", "bad_port"],
    ["https://user:pw@example.com/", "userinfo"],
  ])("refuses a redirect to %s (%s) without sending anything there", async (to, reason) => {
    const net = fakeNet([redirect(to)]);
    expect(await refusal(workerSafeFetchWith({}, net.fetch)("https://example.com/"))).toBe(reason);
    expect(net.seen).toHaveLength(1);
  });

  it("hands a redirect back unfollowed when the caller asked for manual", async () => {
    const net = fakeNet([redirect("/next")]);
    const res = await workerSafeFetchWith({}, net.fetch)("https://example.com/", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(net.seen).toHaveLength(1);
  });

  it("does not carry credentials to another origin", async () => {
    const net = fakeNet([redirect("https://other.example.org/x"), new Response("ok")]);
    await workerSafeFetchWith({}, net.fetch)("https://example.com/", { headers: { authorization: "Bearer abc", "x-keep": "1" } });
    const second = new Headers(net.seen[1]!.init.headers);
    expect(second.get("authorization")).toBeNull();
    expect(second.get("x-keep")).toBe("1");
  });
});

describe("sizes and times", () => {
  it("cuts a body off past maxBytes", async () => {
    const net = fakeNet([new Response("x".repeat(5_000))]);
    const res = await workerSafeFetchWith({ maxBytes: 1_000 }, net.fetch)("https://example.com/big");
    expect(await refusal(res.text())).toBe("too_large");
  });

  it("refuses at once a body that says it is too big", async () => {
    const net = fakeNet([new Response("x".repeat(50), { headers: { "content-length": "9999999" } })]);
    const res = await workerSafeFetchWith({ maxBytes: 1_000 }, net.fetch)("https://example.com/big");
    expect(await refusal(res.text())).toBe("too_large");
  });

  it("lets a small body through whole", async () => {
    const net = fakeNet([new Response("small")]);
    expect(await (await workerSafeFetchWith({ maxBytes: 1_000 }, net.fetch)("https://example.com/")).text()).toBe("small");
  });

  it("gives up after timeoutMs", async () => {
    const slow: FetchLike = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    await expect(workerSafeFetchWith({ timeoutMs: 40 }, slow)("https://example.com/slow")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("honours the caller's own signal too", async () => {
    const slow: FetchLike = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const ctl = new AbortController();
    const p = workerSafeFetchWith({ timeoutMs: 10_000 }, slow)("https://example.com/slow", { signal: ctl.signal });
    ctl.abort(new Error("stopped"));
    await expect(p).rejects.toThrow("stopped");
  });
});

describe("as the seam", () => {
  afterEach(() => { clearSafeFetchForTests(); vi.unstubAllGlobals(); });

  it("fails closed with nothing installed", async () => {
    clearSafeFetchForTests();
    await expect(safeFetchWith()("https://example.com/")).rejects.toThrow("no safe fetch is installed");
  });

  it("is what the readers get once the Worker installs it", async () => {
    installSafeFetch(workerSafeFetchImpl);
    const fake = vi.fn(async () => new Response("through the platform"));
    vi.stubGlobal("fetch", fake);
    expect(await (await safeFetchWith({ timeoutMs: 1_000 })("https://example.com/")).text()).toBe("through the platform");
    expect(fake).toHaveBeenCalledTimes(1);
    expect(await refusal(safeFetchWith()("https://10.0.0.1/"))).toBe("private_address");
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("calls every address written as an IP blocked", () => {
    installSafeFetch(workerSafeFetchImpl);
    expect(isBlockedAddress("8.8.8.8")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
  });
});
