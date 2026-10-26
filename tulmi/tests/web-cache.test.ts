/**
 * THE PAGE CACHE (src/web/cache.ts, migration 0026): what a read page is kept as.
 *
 * What these hold down:
 *   - the key: the same page is the same key however it was typed (host case,
 *     fragment, query order), and different pages are not;
 *   - the rules: how long (docs hosts a day), and what is never kept (an address
 *     with a secret in its query);
 *   - the memory twin: a 500-entry LRU that expires and that a use refreshes;
 *   - the Supabase twin: one upsert, one select, the sweep, and a row that is not
 *     what put wrote counts as a miss; both held to the same script;
 *   - the migration: the table, row-level security with NO policy, and the same
 *     text in full_schema.sql after 0025.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const {
  DOCS_TTL_MIN, MEMORY_PAGES_MAX, MemoryWebCache, SupabaseWebCache, cacheKey, isCacheable, isSecretParam, normalizeUrl, redactUrl, resetWebCacheForTests, ttlMinutes, webCache,
} = await import("../src/web/cache.js");
type CachedPage = import("../src/web/cache.js").CachedPage;
type WebCache = import("../src/web/cache.js").WebCache;

const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const page = (url: string, over: Partial<CachedPage> = {}): CachedPage => ({
  url, finalUrl: url, title: "Title", lang: "en", text: "# Title\n\nBody.", headings: [{ level: 1, text: "Title", offset: 0 }],
  links: [{ text: "a link", url: "https://example.com/l" }], codeBlocks: 2, contentType: "text/html", bytes: 1234, truncated: false, via: "fetch",
  fetchedAt: T0, expiresAt: T0 + 3600_000, ...over,
});

describe("the key", () => {
  it("is the same for the same page written differently", () => {
    const k = cacheKey("https://example.com/a?x=1&y=2");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    for (const same of ["https://EXAMPLE.com/a?y=2&x=1", "https://example.com/a?x=1&y=2#section", "https://example.com:443/a?x=1&y=2", "https://user:pw@example.com/a?x=1&y=2"]) {
      expect(cacheKey(same), same).toBe(k);
    }
  });
  it("differs when the page does", () => {
    const k = cacheKey("https://example.com/a?x=1");
    for (const other of ["https://example.com/b?x=1", "https://example.com/a?x=2", "https://example.com/a", "http://example.com/a?x=1", "https://example.org/a?x=1", "https://example.com/A?x=1"]) {
      expect(cacheKey(other), other).not.toBe(k);
    }
  });
  it("keeps repeated parameters in their order, and sorts the names", () => {
    expect(normalizeUrl("https://example.com/p?b=2&a=2&a=1")).toBe("https://example.com/p?a=2&a=1&b=2");
    expect(normalizeUrl("https://example.com/p?")).toBe("https://example.com/p");
  });
});

describe("what may be kept, and for how long", () => {
  it("knows a secret parameter by its name", () => {
    for (const name of ["token", "key", "sig", "signature", "auth", "code", "session", "password", "access_token", "X-Amz-Signature", "x-amz-credential", "X-Amz-Date", "X-Goog-Signature", "api_key", "apikey", "csrf_token", "client_secret", "sessionid", "TOKEN", "Signature"]) {
      expect(isSecretParam(name), name).toBe(true);
    }
    for (const name of ["page", "q", "sort", "author", "keyword", "id", "lang", "utm_source", "ref", "monkey", "codec", "encode"]) {
      expect(isSecretParam(name), name).toBe(false);
    }
  });
  it("refuses an address with one anywhere in its query", () => {
    expect(isCacheable(new URL("https://example.com/f?a=1&token=x"))).toBe(false);
    expect(isCacheable(new URL("https://example.com/f?X-Amz-Signature=x"))).toBe(false);
    expect(isCacheable(new URL("https://example.com/f?page=2&q=cats"))).toBe(true);
    expect(isCacheable(new URL("https://example.com/f"))).toBe(true);
    expect(isCacheable(new URL("https://u:p@example.com/f"))).toBe(false);
  });
  it("blanks secret values for display and leaves the rest", () => {
    expect(redactUrl("https://example.com/f?a=1&token=SECRET&sig=S2")).toBe("https://example.com/f?a=1&token=REDACTED&sig=REDACTED");
    expect(redactUrl("https://u:p@example.com/f?a=1")).toBe("https://example.com/f?a=1");
    expect(redactUrl("not an address")).toBe("not an address");
  });
  it("keeps most pages for the setting and documentation for a day or more", () => {
    const t = (url: string, base = 360) => ttlMinutes(new URL(url), base);
    expect(t("https://example.com/blog")).toBe(360);
    expect(t("https://example.com/blog", 30)).toBe(30);
    expect(t("https://example.com/blog", 0)).toBe(0);
    expect(DOCS_TTL_MIN).toBe(1440);
    for (const url of ["https://x.readthedocs.io/en/latest/", "https://docs.python.org/3/", "https://docs.github.com/en", "https://developer.mozilla.org/en-US/docs/Web/API/fetch", "https://nodejs.org/api/fs.html", "https://nodejs.org/api"]) {
      expect(t(url), url).toBe(1440);
    }
    expect(t("https://nodejs.org/en/download")).toBe(360);
    expect(t("https://nodejs.org/apiary")).toBe(360);
    expect(t("https://example.com/docs/")).toBe(360);
    expect(t("https://docs.example.com/x", 5000)).toBe(5000);
    expect(t("https://docs.example.com/x", 0)).toBe(0);
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(t(`https://raw.githubusercontent.com/o/r/${sha}/README.md`)).toBe(1440);
    expect(t("https://raw.githubusercontent.com/o/r/abc1234/README.md")).toBe(1440);
    expect(t("https://raw.githubusercontent.com/o/r/main/README.md")).toBe(360);
    expect(t("https://raw.githubusercontent.com/o/r/v1.2.3/README.md")).toBe(360);
  });
});

/** The same script for both twins. */
function script(name: string, make: (clock: { now: number }) => WebCache) {
  describe(name, () => {
    const clock = { now: T0 };
    const cache = () => { clock.now = T0; return make(clock); };

    it("keeps a page whole and gives it back, under any spelling of its address", async () => {
      const c = cache();
      const p = page("https://example.com/a?y=2&x=1");
      await c.put(p);
      expect(await c.get("https://EXAMPLE.com/a?x=1&y=2#frag", T0)).toEqual({ ...p, url: "https://example.com/a?x=1&y=2" });
      expect(await c.get("https://example.com/other", T0)).toBeNull();
    });

    it("does not serve a page past its expiry", async () => {
      const c = cache();
      await c.put(page("https://example.com/a", { expiresAt: T0 + 1000 }));
      expect(await c.get("https://example.com/a", T0 + 999)).not.toBeNull();
      expect(await c.get("https://example.com/a", T0 + 1000)).toBeNull();
      expect(await c.get("https://example.com/a", T0 + 5000)).toBeNull();
    });

    it("replaces a page put again for the same address", async () => {
      const c = cache();
      await c.put(page("https://example.com/a", { title: "Old" }));
      await c.put(page("https://example.com/a#x", { title: "New", via: "browser" }));
      expect(await c.get("https://example.com/a", T0)).toMatchObject({ title: "New", via: "browser" });
    });

    it("sweeps what has expired and nothing else", async () => {
      const c = cache();
      await c.put(page("https://example.com/old", { expiresAt: T0 + 10 }));
      await c.put(page("https://example.com/new", { expiresAt: T0 + 99_999 }));
      expect(await c.prune(T0 + 50)).toBe(1);
      expect(await c.get("https://example.com/new", T0 + 50)).not.toBeNull();
      expect(await c.prune(T0 + 50)).toBe(0);
    });

    it("hands out copies, so a caller cannot change what is kept", async () => {
      const c = cache();
      await c.put(page("https://example.com/a"));
      const got = (await c.get("https://example.com/a", T0))!;
      got.headings.push({ level: 2, text: "added", offset: 99 });
      got.links.length = 0;
      expect(await c.get("https://example.com/a", T0)).toMatchObject({ headings: [{ text: "Title" }], links: [{ text: "a link" }] });
    });
  });
}

script("the memory twin", (clock) => new MemoryWebCache(MEMORY_PAGES_MAX, () => clock.now));

describe("the memory twin's LRU", () => {
  it("holds 500 pages, and lets the one least recently used go for the 501st", async () => {
    expect(MEMORY_PAGES_MAX).toBe(500);
    const c = new MemoryWebCache();
    for (let i = 0; i < 500; i++) await c.put(page(`https://example.com/p${i}`, { expiresAt: Date.now() + 60_000 }));
    expect(c.size).toBe(500);
    await c.get("https://example.com/p0"); // a use: p0 is now the newest
    await c.put(page("https://example.com/p500", { expiresAt: Date.now() + 60_000 }));
    expect(c.size).toBe(500);
    expect(await c.get("https://example.com/p0")).not.toBeNull();
    expect(await c.get("https://example.com/p1")).toBeNull(); // the oldest unused
    expect(await c.get("https://example.com/p500")).not.toBeNull();
    expect(await c.get("https://example.com/p2")).not.toBeNull();
  });
  it("forgets an expired page when it is asked for, and by the sweep", async () => {
    const c = new MemoryWebCache(10, () => T0);
    await c.put(page("https://example.com/a", { expiresAt: T0 - 1 }));
    expect(c.size).toBe(1);
    expect(await c.get("https://example.com/a")).toBeNull();
    expect(c.size).toBe(0);
    await c.put(page("https://example.com/b", { expiresAt: T0 - 1 }));
    expect(await c.prune()).toBe(1);
  });
});

// ---------------------------------------------------------------- Supabase twin

/** A Supabase client that keeps web_pages in memory and answers what the cache asks of it the way Postgres would. */
function fakeSupabase(o: { error?: string } = {}) {
  const rows = new Map<string, Record<string, any>>();
  const upserts: Array<{ row: Record<string, any>; opts: unknown }> = [];
  const sb = {
    rows, upserts,
    from: (table: string) => {
      const filters: Array<(r: Record<string, any>) => boolean> = [];
      let op: "select" | "delete" = "select";
      let wantRows = false;
      const run = () => {
        if (table !== "web_pages") return { data: null, error: { message: `no table ${table}` } };
        if (o.error) return { data: null, error: { message: o.error } };
        const hit = [...rows.entries()].filter(([, r]) => filters.every((f) => f(r)));
        if (op === "delete") { for (const [k] of hit) rows.delete(k); return { data: wantRows ? hit.map(([, r]) => ({ url_hash: r.url_hash })) : null, error: null }; }
        return { data: hit.map(([, r]) => structuredClone(r)), error: null };
      };
      const b: any = {
        select: () => { wantRows = true; return b; },
        delete: () => { op = "delete"; return b; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        gt: (c: string, v: string) => { filters.push((r) => Date.parse(r[c]) > Date.parse(v)); return b; },
        lte: (c: string, v: string) => { filters.push((r) => Date.parse(r[c]) <= Date.parse(v)); return b; },
        returns: () => b,
        maybeSingle: async () => { const r = run(); return r.error ? r : { data: (r.data as any[])[0] ?? null, error: null }; },
        upsert: async (row: Record<string, any>, opts: unknown) => {
          upserts.push({ row, opts });
          if (o.error) return { data: null, error: { message: o.error } };
          rows.set(row.url_hash, structuredClone(row));
          return { data: null, error: null };
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko),
      };
      return b;
    },
  };
  return sb;
}

script("the Supabase twin", (clock) => new SupabaseWebCache(fakeSupabase() as never, () => clock.now));

describe("the Supabase twin", () => {
  it("writes one row to a hash, with the page's body as jsonb and the dates as timestamps", async () => {
    const sb = fakeSupabase();
    await new SupabaseWebCache(sb as never).put(page("https://example.com/a?y=2&x=1#f", { via: "browser", finalUrl: "https://example.com/final" }));
    const [{ row, opts }] = sb.upserts;
    expect(opts).toEqual({ onConflict: "url_hash" });
    expect(row).toMatchObject({
      url_hash: cacheKey("https://example.com/a?x=1&y=2"), url: "https://example.com/a?x=1&y=2", final_url: "https://example.com/final", title: "Title",
      lang: "en", via: "browser", fetched_at: "2026-10-26T10:00:00.000Z", expires_at: "2026-10-26T11:00:00.000Z",
    });
    expect(row.body).toEqual({
      text: "# Title\n\nBody.", headings: [{ level: 1, text: "Title", offset: 0 }], links: [{ text: "a link", url: "https://example.com/l" }],
      codeBlocks: 2, contentType: "text/html", bytes: 1234, truncated: false,
    });
    expect(JSON.stringify(row)).not.toMatch(/<html|<body/i);
  });

  it("counts a row that is not what put wrote as a miss, not an error", async () => {
    const sb = fakeSupabase();
    const c = new SupabaseWebCache(sb as never, () => T0);
    sb.rows.set(cacheKey("https://example.com/odd"), { url_hash: cacheKey("https://example.com/odd"), url: "https://example.com/odd", final_url: "", title: "", lang: "", body: { nope: true }, via: "fetch", fetched_at: "2026-10-26T10:00:00.000Z", expires_at: "2026-10-26T11:00:00.000Z" });
    expect(await c.get("https://example.com/odd")).toBeNull();
    sb.rows.set(cacheKey("https://example.com/bad-date"), { url_hash: cacheKey("https://example.com/bad-date"), url: "x", final_url: "", title: "", lang: "", body: { text: "t" }, via: "fetch", fetched_at: "yesterday", expires_at: "2026-10-26T11:00:00.000Z" });
    expect(await c.get("https://example.com/bad-date")).toBeNull();
  });

  it("throws when the table cannot be read or written (the reader treats that as no cache)", async () => {
    const c = new SupabaseWebCache(fakeSupabase({ error: "relation does not exist" }) as never);
    await expect(c.get("https://example.com/a")).rejects.toThrow(/web cache: relation does not exist/);
    await expect(c.put(page("https://example.com/a"))).rejects.toThrow(/web cache/);
    await expect(c.prune()).rejects.toThrow(/web cache/);
  });

  it("sweeps the expired rows now and then as it writes", async () => {
    const sb = fakeSupabase();
    const c = new SupabaseWebCache(sb as never, () => T0);
    sb.rows.set("stale", { url_hash: "stale", expires_at: "2026-10-26T09:00:00.000Z" });
    for (let i = 0; i < 199; i++) await c.put(page(`https://example.com/p${i}`));
    expect(sb.rows.has("stale")).toBe(true);
    await c.put(page("https://example.com/p199"));
    await new Promise((r) => setTimeout(r, 10));
    expect(sb.rows.has("stale")).toBe(false);
    expect(sb.rows.size).toBe(200);
  });
});

describe("the shared cache", () => {
  it("is memory without Supabase, one instance until it is reset", async () => {
    resetWebCacheForTests();
    const a = webCache();
    expect(a).toBeInstanceOf(MemoryWebCache);
    expect(webCache()).toBe(a);
    resetWebCacheForTests();
    expect(webCache()).not.toBe(a);
  });
});

describe("migration 0026_web_cache.sql", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const supabaseDir = join(here, "..", "supabase");
  const migration = readFileSync(join(supabaseDir, "migrations", "0026_web_cache.sql"), "utf8");
  const full = readFileSync(join(supabaseDir, "full_schema.sql"), "utf8");

  it("follows 0025 in the migrations folder", () => {
    const names = readdirSync(join(supabaseDir, "migrations")).sort();
    expect(names.indexOf("0026_web_cache.sql")).toBe(names.indexOf("0025_code_route_stats.sql") + 1);
  });

  it("makes web_pages with the columns the cache reads and writes, keyed by the hash", () => {
    expect(migration).toMatch(/create table if not exists public\.web_pages/);
    for (const col of ["url_hash", "url", "final_url", "title", "lang", "body", "via", "fetched_at", "expires_at"]) {
      expect(migration, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(migration).toMatch(/url_hash\s+text primary key/);
    expect(migration).toMatch(/body\s+jsonb not null/);
    expect(migration).toMatch(/via\s+text not null check \(via in \('fetch', 'browser'\)\)/);
    expect(migration).toMatch(/fetched_at timestamptz not null/);
    expect(migration).toMatch(/expires_at timestamptz not null/);
    expect(migration).toMatch(/create index if not exists web_pages_expires_at_idx/);
  });

  it("is service-only: row-level security on and no policy at all", () => {
    expect(migration).toMatch(/alter table public\.web_pages enable row level security/);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/grant /i);
  });

  it("can be run again: every statement is guarded", () => {
    const statements = migration.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
    for (const st of statements) {
      if (/^create table/i.test(st) || /^create index/i.test(st)) expect(st).toMatch(/if not exists/i);
    }
  });

  it("is in full_schema.sql, under its own heading, after 0025, and the same text", () => {
    expect(full).toContain("-- 0026_web_cache.sql");
    expect(full.indexOf("-- 0026_web_cache.sql")).toBeGreaterThan(full.indexOf("-- 0025_code_route_stats.sql"));
    expect(full).toContain(migration.trim());
    expect(full.match(/create table if not exists public\.web_pages/g)).toHaveLength(1);
  });
});
