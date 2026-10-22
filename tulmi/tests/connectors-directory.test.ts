/**
 * More apps (connectors/registry.ts): which registry entries are kept, how a
 * sync crawls and then catches up, how a search is ranked, the two stores
 * agreeing, and GET /v1/connectors/directory. Every registry page here is a
 * fixture handed to a fake fetch: nothing leaves the machine.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  resolveUser: async (h: string | undefined) => {
    const id = h?.replace(/^Bearer\s+/i, "").trim();
    return id ? { id } : null;
  },
}));

const {
  MemoryDirectoryStore, SupabaseDirectoryStore, REGISTRY_URL, readEntry, nameMatchesHost, searchDirectory, searchTerm, syncDirectory,
} = await import("../src/connectors/registry.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { registerCustomConnectorRoutes } = await import("../src/routes/connectorsCustom.js");
type DirectoryEntry = import("../src/connectors/registry.js").DirectoryEntry;
type DirectoryStore = import("../src/connectors/registry.js").DirectoryStore;
type ConnectorDef = import("../src/connectors/catalog.js").ConnectorDef;

// ------------------------------------------------------------- fixtures

const OFFICIAL = "io.modelcontextprotocol.registry/official";
type Over = { server?: Record<string, unknown>; meta?: Record<string, unknown> };
/** One registry item, a usable remote server unless told otherwise. */
const item = (name: string, o: Over = {}) => ({
  server: {
    name, title: undefined, description: `About ${name}.`, version: "1.0.0",
    remotes: [{ type: "streamable-http", url: `https://mcp.${name.split("/")[0]!.split(".").reverse().join(".")}/mcp` }],
    ...o.server,
  },
  _meta: { [OFFICIAL]: { status: "active", isLatest: true, publishedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z", ...o.meta } },
});
const remote = (url: string, extra: Record<string, unknown> = {}) => ({ type: "streamable-http", url, ...extra });

const entry = (name: string, o: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  name, title: o.title ?? name, description: "", url: `https://${name.replace(/[^a-z0-9]+/gi, "-")}.example/mcp`,
  host: `${name.replace(/[^a-z0-9]+/gi, "-")}.example`, website: null, icon: null, verifiedDomain: false, updatedAt: 1, ...o,
});

const catalogApp = (o: Partial<ConnectorDef>): ConnectorDef => ({
  id: "notion", name: "Notion", category: "Docs", oneLine: "Search, read and write pages.", aliases: ["notion", "page"],
  url: "https://mcp.notion.com/mcp", auth: "oauth", verified: true, ...o,
});

// --------------------------------------------------------------- filter

describe("which registry entries are kept", () => {
  it("keeps a Streamable HTTP server on public https, and says whose domain it is", () => {
    const r = readEntry(item("com.acme/notes", { server: { title: "  Acme ​Notes ", websiteUrl: "https://acme.com", icons: [{ src: "http://x/i.png" }, { src: "https://acme.com/i.png" }] } }));
    expect(r).toEqual({
      keep: {
        name: "com.acme/notes", title: "Acme Notes", description: "About com.acme/notes.", url: "https://mcp.acme.com/mcp", host: "mcp.acme.com",
        website: "https://acme.com", icon: "https://acme.com/i.png", verifiedDomain: true, updatedAt: Date.parse("2026-02-01T00:00:00Z"),
      },
    });
  });

  it("takes out what we could not connect to, and what was deleted", () => {
    const dropped = (o: Over) => readEntry(item("com.acme/x", o));
    expect(dropped({ server: { remotes: [{ type: "sse", url: "https://mcp.acme.com/sse" }] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: [remote("http://mcp.acme.com/mcp")] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: [remote("https://{tenant}.acme.com/mcp")] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: [remote("https://mcp.acme.com/mcp", { headers: [{ name: "X-Key", isRequired: true }] })] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: [remote("https://10.0.0.7/mcp")] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: [remote("https://localhost/mcp")] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: [remote("https://mcp.acme.com:8080/mcp")] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: [remote("https://me:pw@mcp.acme.com/mcp")] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ server: { remotes: undefined, packages: [{ registryType: "npm" }] } })).toEqual({ drop: "com.acme/x" });
    expect(dropped({ meta: { status: "deleted" } })).toEqual({ drop: "com.acme/x" });
  });

  it("picks the usable remote among several, and minds only required headers", () => {
    const r = readEntry(item("com.acme/x", { server: { remotes: [
      { type: "sse", url: "https://mcp.acme.com/sse" },
      remote("https://mcp.acme.com/needs-key", { headers: [{ name: "Authorization", isRequired: true }] }),
      remote("https://mcp.acme.com:8443/mcp", { headers: [{ name: "X-Optional", isRequired: false }] }),
    ] } }));
    expect(r).toMatchObject({ keep: { url: "https://mcp.acme.com:8443/mcp", host: "mcp.acme.com:8443" } });
  });

  it("ignores what is not the latest or not readable, and falls back to the name for a title", () => {
    expect(readEntry(item("com.acme/x", { meta: { isLatest: false } }))).toBeNull();
    expect(readEntry({ server: { name: "has space/x" } })).toBeNull();
    expect(readEntry(null)).toBeNull();
    expect(readEntry(item("io.github.someone/tool"))).toMatchObject({ keep: { title: "io.github.someone/tool" } });
  });

  it("a domain only counts when the remote is on it", () => {
    expect(nameMatchesHost("com.stripe/mcp", "mcp.stripe.com")).toBe(true);
    expect(nameMatchesHost("com.stripe/mcp", "stripe.com")).toBe(true);
    expect(nameMatchesHost("com.stripe/mcp", "notstripe.com")).toBe(false);
    expect(nameMatchesHost("com.stripe/mcp", "stripe.com.evil.example")).toBe(false);
    expect(nameMatchesHost("io.github.someone/x", "mcp.smithery.ai")).toBe(false);
    expect(nameMatchesHost("acme/x", "acme")).toBe(false);
  });
});

// ----------------------------------------------------------------- sync

/** A registry that answers from pages by cursor, and remembers what it was asked. */
function fakeRegistry(pages: Record<string, { servers: unknown[]; next?: string }>) {
  const asked: URL[] = [];
  let failOn: string | null = null;
  const fetchFn = async (u: string | URL) => {
    const url = new URL(String(u));
    asked.push(url);
    const key = url.searchParams.get("cursor") ?? "";
    if (key === failOn) return new Response("busy", { status: 503 });
    const p = pages[key];
    if (!p) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ servers: p.servers, metadata: { count: p.servers.length, ...(p.next ? { nextCursor: p.next } : {}) } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  return { fetchFn, asked, failAt: (cursor: string | null) => { failOn = cursor; }, pages };
}

describe("syncing the directory", () => {
  it("crawls every page the first time, then asks only for what changed since", async () => {
    const store = new MemoryDirectoryStore();
    const reg = fakeRegistry({
      "": { servers: [item("com.acme/notes"), item("com.beta/tasks", { server: { remotes: [{ type: "sse", url: "https://mcp.beta.com/sse" }] } })], next: "c1" },
      c1: { servers: [item("io.github.someone/files", { server: { remotes: [remote("https://files.example.net/mcp")] } })] },
    });
    let t = Date.parse("2026-10-22T10:00:00Z");
    const first = await syncDirectory({ store, fetchFn: reg.fetchFn, now: () => t });
    expect(first).toEqual({ full: true, pages: 2, kept: 2, dropped: 1 });
    expect(reg.asked.map((u) => u.origin + u.pathname)).toEqual([REGISTRY_URL, REGISTRY_URL]);
    expect(Object.fromEntries(reg.asked[0]!.searchParams)).toEqual({ limit: "100", version: "latest" });
    expect(reg.asked[1]!.searchParams.get("cursor")).toBe("c1");
    expect((await store.findDirectory("", { limit: 10, offset: 0 })).map((e) => e.name)).toEqual(["com.acme/notes", "io.github.someone/files"]);
    expect(await store.directorySyncedFrom()).toBe(t);

    // Twelve hours on: the deleted one goes, the changed one is replaced.
    const was = t;
    t += 12 * 60 * 60_000;
    reg.asked.length = 0;
    reg.pages[""] = { servers: [
      item("com.acme/notes", { server: { title: "Acme Notes 2" }, meta: { updatedAt: "2026-10-22T15:00:00Z" } }),
      item("io.github.someone/files", { meta: { status: "deleted" } }),
    ] };
    const next = await syncDirectory({ store, fetchFn: reg.fetchFn, now: () => t });
    expect(next).toEqual({ full: false, pages: 1, kept: 1, dropped: 1 });
    expect(reg.asked[0]!.searchParams.get("updated_since")).toBe(new Date(was - 10 * 60_000).toISOString());
    expect((await store.findDirectory("", { limit: 10, offset: 0 })).map((e) => [e.name, e.title])).toEqual([["com.acme/notes", "Acme Notes 2"]]);
    expect(await store.directorySyncedFrom()).toBe(t);
  });

  it("a page that fails leaves the marker where it was, so the next run starts over", async () => {
    const store = new MemoryDirectoryStore();
    const reg = fakeRegistry({ "": { servers: [item("com.acme/notes")], next: "c1" }, c1: { servers: [item("com.beta/tasks")] } });
    reg.failAt("c1");
    await expect(syncDirectory({ store, fetchFn: reg.fetchFn })).rejects.toThrow(/503 on page 2/);
    expect(await store.directorySyncedFrom()).toBeNull();
    // What was read is kept; writing it again is harmless.
    expect((await store.getDirectory("com.acme/notes"))?.host).toBe("mcp.acme.com");
    reg.failAt(null);
    expect(await syncDirectory({ store, fetchFn: reg.fetchFn })).toMatchObject({ full: true, kept: 2 });
  });

  it("stops at a cursor it has seen, and refuses a page that is not a list", async () => {
    const store = new MemoryDirectoryStore();
    const loop = fakeRegistry({ "": { servers: [item("com.acme/notes")], next: "c1" }, c1: { servers: [], next: "c1" } });
    expect(await syncDirectory({ store, fetchFn: loop.fetchFn })).toMatchObject({ pages: 2 });
    const bad = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });
    await expect(syncDirectory({ store: new MemoryDirectoryStore(), fetchFn: bad })).rejects.toThrow(/no servers list/);
  });
});

// --------------------------------------------------------------- search

describe("searching More apps", () => {
  async function seeded(): Promise<DirectoryStore> {
    const store = new MemoryDirectoryStore();
    await store.putDirectory([
      entry("io.github.anon/notion-proxy", { title: "Notion Proxy", description: "Talk to Notion pages." }),
      entry("com.notes/notion-sync", { title: "Notion Sync", verifiedDomain: true, host: "mcp.notes.com", url: "https://mcp.notes.com/mcp" }),
      entry("app.featured/notion-kit", { title: "Zed Notion Kit" }),
      entry("com.notion/official-looking", { title: "Notion", url: "https://mcp.notion.com/mcp/", host: "mcp.notion.com" }),
      entry("com.weather/now", { title: "Weather Now", description: "Forecasts." }),
    ]);
    return store;
  }
  const catalog = [catalogApp({}), catalogApp({ id: "linear", name: "Linear", aliases: ["linear", "issue"], url: "https://mcp.linear.app/mcp" })];

  it("puts our own first, then featured, then domain-verified, then the rest, everything outside ours Unverified", async () => {
    const page = await searchDirectory(await seeded(), "notion", { catalog, featured: ["app.featured/notion-kit"] });
    expect(page.apps.map((a) => [a.source, a.id])).toEqual([
      ["catalog", "notion"],
      ["registry", "app.featured/notion-kit"],
      ["registry", "com.notes/notion-sync"],
      ["registry", "io.github.anon/notion-proxy"],
    ]);
    // Our catalog's Notion is the answer: the entry at its address is not offered again.
    expect(page.apps.some((a) => a.id === "com.notion/official-looking")).toBe(false);
    expect(page.apps[0]).toEqual({ id: "notion", source: "catalog", name: "Notion", initial: "N", description: "Search, read and write pages.", host: "mcp.notion.com" });
    expect(page.apps.slice(1).every((a) => a.unverified === true && !!a.url && !!a.host)).toBe(true);
    expect(page.apps[1]).toMatchObject({ featured: true, name: "Zed Notion Kit", initial: "Z" });
    expect(page.apps[2]).toMatchObject({ domainVerified: true, host: "mcp.notes.com", url: "https://mcp.notes.com/mcp" });
    expect(page).toMatchObject({ count: 4, q: "notion" });
    expect(page.nextCursor).toBeUndefined();
  });

  it("matches a catalog app by its name or a whole alias, not by letters inside a word", async () => {
    const store = new MemoryDirectoryStore();
    expect((await searchDirectory(store, "issue", { catalog })).apps.map((a) => a.id)).toEqual(["linear"]);
    expect((await searchDirectory(store, "lin", { catalog })).apps.map((a) => a.id)).toEqual(["linear"]);
    expect((await searchDirectory(store, "spreadsheet", { catalog: [catalogApp({ id: "github", name: "GitHub", aliases: ["github", "pr"] })] })).apps).toEqual([]);
    expect((await searchDirectory(store, "", { catalog })).apps).toEqual([]);
  });

  it("pages twenty at a time with a cursor, and an empty search browses domain-verified first", async () => {
    const store = new MemoryDirectoryStore();
    await store.putDirectory(Array.from({ length: 45 }, (_, i) => entry(`com.many/app-${String(i).padStart(2, "0")}`, { verifiedDomain: i === 30 })));
    const one = await searchDirectory(store, "", { catalog: [] });
    expect(one.apps).toHaveLength(20);
    expect(one.apps[0]!.id).toBe("com.many/app-30");
    expect(one.nextCursor).toBe("20");
    const two = await searchDirectory(store, "", { catalog: [], cursor: one.nextCursor });
    const three = await searchDirectory(store, "", { catalog: [], cursor: two.nextCursor });
    expect([two.apps.length, three.apps.length, three.nextCursor]).toEqual([20, 5, undefined]);
    expect(new Set([...one.apps, ...two.apps, ...three.apps].map((a) => a.id)).size).toBe(45);
    expect((await searchDirectory(store, "", { catalog: [], cursor: "../1" })).apps[0]!.id).toBe("com.many/app-30");
  });

  it("cuts a long title to an app's forty letters, at a word", async () => {
    const store = new MemoryDirectoryStore();
    await store.putDirectory([entry("com.long/x", { title: "The Extremely Thorough Project Management Server For Teams" })]);
    const [a] = (await searchDirectory(store, "thorough", { catalog: [] })).apps;
    expect(a!.name).toBe("The Extremely Thorough Project");
    expect(a!.name.length).toBeLessThanOrEqual(40);
  });

  it("reads a search as text only", () => {
    expect(searchTerm(`  notion"),name.eq.x%  `)).toBe("notion name.eq.x");
    expect(searchTerm("a".repeat(100))).toHaveLength(60);
    expect(searchTerm(7)).toBe("");
    expect(searchTerm("linear_app")).toBe("linear_app");
  });
});

// -------------------------------------------------------- store parity

/** Supabase's query builder, as far as the directory store uses it, over in-memory tables. */
function fakeSupabase() {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const keys: Record<string, string> = { mcp_directory: "name", mcp_directory_sync: "id" };
  const queries: string[] = [];
  const like = (pattern: string) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "upsert" | "delete" = "select";
    let payload: Array<Record<string, unknown>> = [];
    const where: Array<(r: Record<string, unknown>) => boolean> = [];
    const order: Array<{ col: string; asc: boolean }> = [];
    let range: [number, number] | null = null;
    const run = () => {
      const match = (r: Record<string, unknown>) => where.every((f) => f(r));
      if (op === "upsert") {
        for (const p of payload) {
          const hit = rows().find((r) => r[keys[table]!] === p[keys[table]!]);
          if (hit) Object.assign(hit, p); else rows().push({ ...p });
        }
        return { data: null, error: null };
      }
      if (op === "delete") { tables[table] = rows().filter((r) => !match(r)); return { data: null, error: null }; }
      let out = rows().filter(match);
      out = [...out].sort((a, b) => {
        for (const { col, asc } of order) {
          const x = a[col], y = b[col];
          const c = x === y ? 0 : typeof x === "boolean" ? (x ? 1 : -1) : String(x) < String(y) ? -1 : 1;
          if (c) return asc ? c : -c;
        }
        return 0;
      });
      if (range) out = out.slice(range[0], range[1] + 1);
      return { data: structuredClone(out), error: null };
    };
    const b = {
      select: () => b,
      upsert: (p: Record<string, unknown> | Array<Record<string, unknown>>) => { op = "upsert"; payload = Array.isArray(p) ? p : [p]; return b; },
      delete: () => { op = "delete"; return b; },
      eq: (col: string, v: unknown) => { where.push((r) => r[col] === v); return b; },
      in: (col: string, vs: unknown[]) => { where.push((r) => vs.includes(r[col])); return b; },
      not: (col: string, operator: string, list: string) => {
        queries.push(`not ${col} ${operator} ${list}`);
        const names = [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
        where.push((r) => !names.includes(r[col] as string));
        return b;
      },
      or: (filter: string) => {
        queries.push(`or ${filter}`);
        const parts = [...filter.matchAll(/(\w+)\.ilike\."([^"]*)"/g)].map((m) => ({ col: m[1]!, re: like(m[2]!) }));
        where.push((r) => parts.some((p) => p.re.test(String(r[p.col] ?? ""))));
        return b;
      },
      order: (col: string, o?: { ascending?: boolean }) => { order.push({ col, asc: o?.ascending !== false }); return b; },
      range: (a: number, z: number) => { range = [a, z]; return b; },
      returns: () => b,
      maybeSingle: async () => { const r = run(); return { data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error }; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, ko),
    };
    return b;
  };
  return { from, tables, queries };
}

describe("the two directory stores", () => {
  async function script(store: DirectoryStore) {
    const seen: unknown[] = [];
    seen.push(await store.directorySyncedFrom());
    await store.putDirectory([
      entry("com.acme/notes", { title: "Acme Notes", description: "Notes, synced.", updatedAt: Date.parse("2026-01-01T00:00:00Z") }),
      entry("com.beta/tasks", { title: "Beta Tasks", verifiedDomain: true, updatedAt: Date.parse("2026-01-02T00:00:00Z") }),
      entry("io.github.x/notes_v2", { title: "notes v2", updatedAt: Date.parse("2026-01-03T00:00:00Z") }),
    ]);
    await store.putDirectory([entry("com.acme/notes", { title: "Acme Notes", description: "Notes, synced again.", updatedAt: Date.parse("2026-01-04T00:00:00Z") })]);
    seen.push(await store.getDirectory("com.acme/notes"), await store.getDirectory("com.none/x"), await store.getDirectory("bad name"));
    seen.push((await store.findDirectory("", { limit: 10, offset: 0 })).map((e) => e.name));
    seen.push((await store.findDirectory("NOTES", { limit: 10, offset: 0 })).map((e) => e.name));
    seen.push((await store.findDirectory("notes_v", { limit: 10, offset: 0 })).map((e) => e.name));
    seen.push((await store.findDirectory("notes", { limit: 1, offset: 1 })).map((e) => e.name));
    seen.push((await store.findDirectory("", { names: ["com.beta/tasks", "com.none/x"], limit: 5, offset: 0 })).map((e) => e.name));
    seen.push((await store.findDirectory("", { exclude: ["com.beta/tasks"], limit: 5, offset: 0 })).map((e) => e.name));
    await store.removeDirectory(["com.beta/tasks", "com.none/x"]);
    seen.push((await store.findDirectory("", { limit: 10, offset: 0 })).map((e) => e.name));
    await store.setDirectorySyncedFrom(Date.parse("2026-10-22T10:00:00Z"));
    await store.setDirectorySyncedFrom(Date.parse("2026-10-22T22:00:00Z"));
    seen.push(await store.directorySyncedFrom());
    return seen;
  }

  it("memory and Supabase answer the same script the same way", async () => {
    const memory = await script(new MemoryDirectoryStore());
    const sb = fakeSupabase();
    const supa = await script(new SupabaseDirectoryStore(sb as never));
    expect(supa).toEqual(memory);
    expect(memory.slice(4, 10)).toEqual([
      ["com.beta/tasks", "com.acme/notes", "io.github.x/notes_v2"],
      ["com.acme/notes", "io.github.x/notes_v2"],
      ["io.github.x/notes_v2"],
      ["io.github.x/notes_v2"],
      ["com.beta/tasks"],
      ["com.acme/notes", "io.github.x/notes_v2"],
    ]);
    expect(memory[11]).toBe(Date.parse("2026-10-22T22:00:00Z"));
    // The rows are the columns 0018 makes, and the search is quoted text.
    expect(Object.keys(sb.tables.mcp_directory![0]!).sort()).toEqual(
      ["description", "host", "icon", "name", "title", "updated_at", "url", "verified_domain", "website"]);
    expect(sb.tables.mcp_directory_sync).toEqual([{ id: 1, synced_from: "2026-10-22T22:00:00.000Z" }]);
    expect(sb.queries).toContain('or title.ilike."%NOTES%",name.ilike."%NOTES%",description.ilike."%NOTES%"');
    expect(sb.queries).toContain('not name in ("com.beta/tasks")');
  });
});

// ---------------------------------------------------------------- route

describe("GET /v1/connectors/directory", () => {
  async function rig(enabled = true) {
    const directory = new MemoryDirectoryStore();
    await directory.putDirectory([entry("com.acme/notes", { title: "Acme Notes" })]);
    const connectors = createConnectors({
      store: new MemoryConnectorStore(), catalog: [catalogApp({})], redirectUrl: "https://api.example.com/v1/connectors/callback",
      signIn: {}, custom: { enabled, max: 10 }, directory,
    });
    const app = Fastify();
    registerCustomConnectorRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, connectors });
    await app.ready();
    const get = (url: string, user: string | null = "ann") =>
      app.inject({ method: "GET", url, headers: user ? { authorization: `Bearer ${user}` } : {} });
    return { app, get };
  }

  it("answers a page of More apps for a signed-in person", async () => {
    const { app, get } = await rig();
    const res = await get("/v1/connectors/directory?q=acme");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      q: "acme", count: 1,
      apps: [{ id: "com.acme/notes", source: "registry", name: "Acme Notes", initial: "A", description: "", host: "com-acme-notes.example", url: "https://com-acme-notes.example/mcp", unverified: true }],
    });
    expect((await get("/v1/connectors/directory?q=notion")).json().apps.map((a: { source: string }) => a.source)).toEqual(["catalog"]);
    expect((await get("/v1/connectors/directory")).json().count).toBe(1);
    expect((await get(`/v1/connectors/directory?q=${"x".repeat(101)}`)).statusCode).toBe(400);
    expect((await get("/v1/connectors/directory", null)).statusCode).toBe(401);
    await app.close();
  });

  it("is not there while apps added by link are switched off", async () => {
    const { app, get } = await rig(false);
    expect((await get("/v1/connectors/directory?q=acme")).json()).toEqual({ code: "custom_off", message: "Adding your own apps isn't switched on." });
    await app.close();
  });
});
