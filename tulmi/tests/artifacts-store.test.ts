/**
 * Where artifacts are kept (src/artifacts/store.ts, migration 0032): the memory twin and the Supabase one say the same things, the Supabase one
 * asks the database for the two atomic writes in one call, the migration matches (row security: the owner reads, the service role writes,
 * a share link only through the API), and the tables are on the account delete and export lists.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { MemoryArtifactStore, SupabaseArtifactStore, ARTIFACT_TABLES, ARTIFACT_USER_TABLES, deleteViewerData, newShareToken } = await import("../src/artifacts/store.js");
const { LIMITS } = await import("../src/artifacts/protocol.js");
const { newVersion } = await import("../src/artifacts/versions.js");

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const UID = "11111111-1111-4111-8111-111111111111";
const AID = "22222222-2222-4222-8222-222222222222";
const first = { kind: "snapshot" as const, body: "<p>hi</p>", madeBy: "bot" as const, note: "Created" };

describe("the memory twin", () => {
  it("keeps an artifact with its first version, lists a person's newest change first, and filters by project", async () => {
    let t = 1000;
    const s = new MemoryArtifactStore(() => (t += 10));
    const a = await s.create({ userId: UID, type: "html", title: "A", projectId: "p1" }, first);
    const b = await s.create({ userId: UID, type: "svg", title: "B" }, first);
    await s.create({ userId: "other", type: "html", title: "C" }, first);
    expect(a).toMatchObject({ headVersion: 1, shareToken: null, othersCanSave: false, spentPaise: 0, projectId: "p1" });
    expect((await s.list(UID)).map((x) => x.title)).toEqual(["B", "A"]);
    await s.addVersion(a.id, 1, newVersion(2, "<p>hi</p>", "<p>ho</p>", { madeBy: "person", note: "n" }));
    expect((await s.list(UID)).map((x) => x.title)).toEqual(["A", "B"]);
    expect((await s.list(UID, { projectId: "p1" })).map((x) => x.id)).toEqual([a.id]);
    expect(await s.countFor(UID)).toBe(2);
    expect(b.projectId).toBeNull();
  });

  it("finds an artifact by its share token, and a token that was taken back finds nothing", async () => {
    const s = new MemoryArtifactStore();
    const a = await s.create({ userId: UID, type: "html", title: "A" }, first);
    const tok = newShareToken();
    expect(tok).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newShareToken()).not.toBe(tok);
    await s.setShare(a.id, { shareToken: tok, othersCanSave: true });
    expect(await s.getByToken(tok)).toMatchObject({ id: a.id, othersCanSave: true });
    await s.setShare(a.id, { shareToken: null });
    expect(await s.getByToken(tok)).toBeNull();
    expect(await s.getByToken("")).toBeNull();
  });

  it("keeps saved data by scope, counts keys per scope, and refuses a new key past the protocol's limit but not an update", async () => {
    const s = new MemoryArtifactStore();
    const a = await s.create({ userId: UID, type: "html", title: "A" }, first);
    expect(await s.dataPut(a.id, "shared", "k", { n: 1 })).toBe("ok");
    expect(await s.dataPut(a.id, "bob", "k", "mine")).toBe("ok");
    expect((await s.dataGet(a.id, "shared", "k"))!.value).toEqual({ n: 1 });
    expect((await s.dataGet(a.id, "bob", "k"))!.value).toBe("mine");
    expect(await s.dataGet(a.id, "carol", "k")).toBeNull();
    for (let i = 0; i < LIMITS.storageKeys - 1; i += 1) expect(await s.dataPut(a.id, "shared", `key${i}`, i)).toBe("ok");
    expect((await s.dataKeys(a.id, "shared"))).toHaveLength(LIMITS.storageKeys);
    expect(await s.dataPut(a.id, "shared", "one-too-many", 1)).toBe("too_many");
    expect(await s.dataPut(a.id, "shared", "key3", "changed")).toBe("ok");
    // another scope has its own room
    expect(await s.dataPut(a.id, "bob", "again", 1)).toBe("ok");
    expect(await s.dataDelete(a.id, "shared", "key3")).toBe(true);
    expect(await s.dataDelete(a.id, "shared", "key3")).toBe(false);
    expect(await s.dataPut(a.id, "shared", "one-too-many", 1)).toBe("ok");
  });

  it("deletes an artifact with its versions and data, and the kit of a project is one row replaced", async () => {
    const s = new MemoryArtifactStore();
    const a = await s.create({ userId: UID, type: "html", title: "A" }, first);
    await s.dataPut(a.id, "shared", "k", 1);
    expect(await s.delete(a.id)).toBe(true);
    expect(await s.get(a.id)).toBeNull();
    expect(await s.dataGet(a.id, "shared", "k")).toBeNull();
    expect(await s.snapshotAtOrBefore(a.id, 1)).toBeNull();
    expect(await s.delete(a.id)).toBe(false);
    await s.putKit("p1", UID, "sha1", { prompt: "one" });
    await s.putKit("p1", UID, "sha2", { prompt: "two" });
    expect(await s.getKit("p1")).toMatchObject({ headSha: "sha2", kit: { prompt: "two" } });
    await s.deleteKit("p1");
    expect(await s.getKit("p1")).toBeNull();
  });

  it("exports a person's artifacts with their text, versions and the data they could see", async () => {
    const s = new MemoryArtifactStore();
    const a = await s.create({ userId: UID, type: "html", title: "A" }, first);
    await s.addVersion(a.id, 1, newVersion(2, "<p>hi</p>", "<p>ho</p>", { madeBy: "person", note: "n" }));
    await s.dataPut(a.id, "shared", "k", 1);
    await s.dataPut(a.id, UID, "mine", 2);
    await s.dataPut(a.id, "someone-else", "theirs", 3);
    await s.create({ userId: "other", type: "html", title: "Not mine" }, first);
    const out = await s.exportOf(UID);
    expect(out.artifacts).toHaveLength(1);
    expect(out.artifacts[0]).toMatchObject({ title: "A", content: "<p>ho</p>", versions: [{ version: 2 }, { version: 1 }] });
    expect(out.data.map((d) => d.key).sort()).toEqual(["k", "mine"]);
    expect(JSON.stringify(out)).not.toContain("theirs");
  });
});

// ------------------------------------------------------------------ the Supabase twin, against a recording stub

type Log = Array<[string, unknown[]]>;
function stub(answers: { data?: unknown; error?: { message: string } | null; count?: number } = {}) {
  const log: Log = [];
  const chain = (answer: unknown): unknown => new Proxy(() => {}, {
    get: (_t, prop) => {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answer);
      return (...args: unknown[]) => { log.push([String(prop), args]); return chain(answer); };
    },
  });
  const answer = { data: answers.data ?? null, error: answers.error ?? null, ...(answers.count !== undefined ? { count: answers.count } : {}) };
  const sb = {
    from: (t: string) => { log.push(["from", [t]]); return chain(answer); },
    rpc: (f: string, a: unknown) => { log.push(["rpc", [f, a]]); return chain(answer); },
  };
  return { sb: sb as never, log };
}

const dbRow = {
  id: AID, user_id: UID, project_id: null, type: "react", title: "T", head_version: 3, share_token: "tok", others_can_save: true, spent_paise: 42,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
};

describe("the Supabase twin", () => {
  it("reads rows into the shapes the twin returns, with an unknown type taken for html", async () => {
    const s = new SupabaseArtifactStore(stub({ data: dbRow }).sb);
    expect(await s.get(AID)).toEqual({
      id: AID, userId: UID, projectId: null, type: "react", title: "T", headVersion: 3, shareToken: "tok", othersCanSave: true, spentPaise: 42,
      createdAt: Date.parse("2026-10-01T00:00:00Z"), updatedAt: Date.parse("2026-10-02T00:00:00Z"),
    });
    expect((await new SupabaseArtifactStore(stub({ data: { ...dbRow, type: "weird" } }).sb).get(AID))!.type).toBe("html");
  });

  it("does not ask the database about an id that is not a uuid", async () => {
    const { sb, log } = stub({ data: dbRow });
    const s = new SupabaseArtifactStore(sb);
    expect(await s.get("nope")).toBeNull();
    expect(await s.dataGet("nope", "shared", "k")).toBeNull();
    expect(await s.versionsBetween("nope", 1, 2)).toEqual([]);
    expect(await s.delete("nope")).toBe(false);
    expect(await s.addVersion("nope", 1, first)).toBeNull();
    expect(log).toEqual([]);
  });

  it("makes the artifact and its first version, and takes the artifact back if the version cannot be written", async () => {
    const ok = stub({ data: dbRow });
    await new SupabaseArtifactStore(ok.sb).create({ userId: UID, type: "react", title: "T", projectId: "p" }, first);
    expect(ok.log.filter(([m]) => m === "from").map(([, a]) => a[0])).toEqual(["artifacts", "artifact_versions"]);
    expect(ok.log.find(([m, a]) => m === "insert" && (a[0] as { head_version?: number }).head_version === 1)![1][0]).toMatchObject({ user_id: UID, project_id: "p", type: "react", title: "T", head_version: 1 });
    expect(ok.log.find(([m, a]) => m === "insert" && (a[0] as { version?: number }).version === 1)![1][0]).toMatchObject({ version: 1, kind: "snapshot", body: "<p>hi</p>", made_by: "bot", note: "Created" });

    // the artifact insert answers; the version insert fails
    const log: Log = [];
    const row = { data: dbRow, error: null };
    const failing = { data: null, error: { message: "boom" } };
    const chain = (answer: unknown): unknown => new Proxy(() => {}, { get: (_t, prop) => (prop === "then" ? (r: (v: unknown) => void) => r(answer) : (...args: unknown[]) => { log.push([String(prop), args]); return chain(answer); }) });
    let table = "";
    const sb = { from: (t: string) => { table = t; log.push(["from", [t]]); return chain(table === "artifact_versions" ? failing : row); } };
    await expect(new SupabaseArtifactStore(sb as never).create({ userId: UID, type: "react", title: "T" }, first)).rejects.toThrow(/artifact store: boom/);
    expect(log.some(([m]) => m === "delete")).toBe(true);
  });

  it("moves the head in ONE call to the database, and says null when it did not move", async () => {
    const moved = stub({ data: 4 });
    const v = newVersion(4, "a".repeat(50), "a".repeat(49) + "b", { madeBy: "person", note: "n" });
    await new SupabaseArtifactStore(moved.sb).addVersion(AID, 3, v, { title: "New", paise: 7.4 });
    const call = moved.log.find(([m]) => m === "rpc")![1];
    expect(call[0]).toBe("artifact_add_version");
    expect(call[1]).toEqual({ p_artifact: AID, p_expected: 3, p_kind: v.kind, p_body: v.body, p_made_by: "person", p_note: "n", p_title: "New", p_paise: 7 });
    // the head had moved: the function answers null, and nothing else is read
    const stale = stub({ data: null });
    expect(await new SupabaseArtifactStore(stale.sb).addVersion(AID, 3, v)).toBeNull();
    expect(stale.log.filter(([m]) => m === "from")).toEqual([]);
    expect(stale.log.find(([m]) => m === "rpc")![1][1]).toMatchObject({ p_title: null, p_paise: 0 });
  });

  it("saves a key in one call that counts the keys under a lock, and maps its answer", async () => {
    const ok = stub({ data: "ok" });
    expect(await new SupabaseArtifactStore(ok.sb).dataPut(AID, "shared", "k", { a: 1 })).toBe("ok");
    expect(ok.log.find(([m]) => m === "rpc")![1]).toEqual(["artifact_data_put", { p_artifact: AID, p_scope: "shared", p_key: "k", p_value: { a: 1 }, p_max_keys: LIMITS.storageKeys }]);
    expect(await new SupabaseArtifactStore(stub({ data: "too_many" }).sb).dataPut(AID, UID, "k", 1)).toBe("too_many");
    expect(await new SupabaseArtifactStore(stub({ error: { message: "x" } }).sb).dataPut(AID, UID, "k", 1).catch((e) => String(e))).toMatch(/artifact store: x/);
  });

  it("finds the nearest snapshot with one ordered, limited query, and reads a range of versions oldest first", async () => {
    const snap = stub({ data: [{ artifact_id: AID, version: 11, kind: "snapshot", body: "B", made_by: "bot", note: "", created_at: "2026-10-01T00:00:00Z" }] });
    const row = await new SupabaseArtifactStore(snap.sb).snapshotAtOrBefore(AID, 14);
    expect(row).toMatchObject({ version: 11, kind: "snapshot", body: "B", madeBy: "bot" });
    const calls = Object.fromEntries(snap.log.map(([m, a]) => [m, a]));
    expect(calls.eq).toBeDefined();
    expect(snap.log.some(([m, a]) => m === "eq" && a[0] === "kind" && a[1] === "snapshot")).toBe(true);
    expect(snap.log.some(([m, a]) => m === "lte" && a[0] === "version" && a[1] === 14)).toBe(true);
    expect(snap.log.some(([m, a]) => m === "order" && a[0] === "version" && (a[1] as { ascending: boolean }).ascending === false)).toBe(true);
    expect(snap.log.some(([m, a]) => m === "limit" && a[0] === 1)).toBe(true);
    const range = stub({ data: [] });
    await new SupabaseArtifactStore(range.sb).versionsBetween(AID, 12, 14);
    expect(range.log.some(([m, a]) => m === "gte" && a[1] === 12)).toBe(true);
    expect(range.log.some(([m, a]) => m === "lte" && a[1] === 14)).toBe(true);
    expect(range.log.some(([m, a]) => m === "order" && (a[1] as { ascending: boolean }).ascending === true)).toBe(true);
  });

  it("lists versions with their stored size, and a person's artifacts newest first", async () => {
    const lv = stub({ data: [{ version: 2, kind: "patch", made_by: "person", note: "n", created_at: "2026-10-01T00:00:00Z", bytes: 88 }] });
    expect(await new SupabaseArtifactStore(lv.sb).listVersions(AID)).toEqual([{ version: 2, kind: "patch", madeBy: "person", note: "n", createdAt: Date.parse("2026-10-01T00:00:00Z"), storedBytes: 88 }]);
    expect(lv.log.find(([m]) => m === "select")![1][0]).toBe("version,kind,made_by,note,created_at,bytes");
    const l = stub({ data: [dbRow] });
    await new SupabaseArtifactStore(l.sb).list(UID, { projectId: "p1" });
    expect(l.log.some(([m, a]) => m === "eq" && a[0] === "user_id" && a[1] === UID)).toBe(true);
    expect(l.log.some(([m, a]) => m === "eq" && a[0] === "project_id" && a[1] === "p1")).toBe(true);
    expect(l.log.some(([m, a]) => m === "order" && a[0] === "updated_at")).toBe(true);
  });

  it("writes the kit by project, and clears a viewer's own scope by their id", async () => {
    const k = stub({ data: null });
    await new SupabaseArtifactStore(k.sb).putKit(AID, UID, "sha", { prompt: "p" });
    expect(k.log.find(([m]) => m === "upsert")![1][0]).toMatchObject({ project_id: AID, user_id: UID, head_sha: "sha", kit: { prompt: "p" } });
    expect(k.log.find(([m]) => m === "upsert")![1][1]).toEqual({ onConflict: "project_id" });
    const d = stub({ data: [{ key: "a" }, { key: "b" }] });
    expect(await deleteViewerData(d.sb, UID)).toBe(2);
    expect(d.log.some(([m, a]) => m === "from" && a[0] === "artifact_data")).toBe(true);
    expect(d.log.some(([m, a]) => m === "eq" && a[0] === "scope" && a[1] === UID)).toBe(true);
  });
});

describe("the migration, the whole schema and the account", () => {
  const mig = readFileSync(join(dir, "supabase", "migrations", "0032_artifacts.sql"), "utf8");
  const all = readFileSync(join(dir, "supabase", "full_schema.sql"), "utf8");

  it("makes the four tables with the columns the twin reads and writes", () => {
    for (const t of ARTIFACT_TABLES) expect(mig).toMatch(new RegExp(`create table if not exists public\\.${t}\\b`));
    expect(mig).toMatch(/create table if not exists public\.artifacts \([\s\S]*id\s+uuid primary key[\s\S]*user_id\s+uuid not null references auth\.users \(id\) on delete cascade[\s\S]*project_id\s+uuid,[\s\S]*type\s+text not null check \(type in \('html', 'react', 'svg', 'mermaid', 'markdown'\)\)[\s\S]*head_version\s+integer not null default 1[\s\S]*share_token\s+text unique/);
    expect(mig).toMatch(/others_can_save boolean not null default false/);
    expect(mig).toMatch(/spent_paise\s+integer not null default 0/);
    expect(mig).toMatch(/artifact_id uuid not null references public\.artifacts \(id\) on delete cascade,\s+version\s+integer not null[\s\S]*kind\s+text not null check \(kind in \('snapshot', 'patch'\)\)[\s\S]*made_by\s+text not null check \(made_by in \('bot', 'person'\)\)[\s\S]*primary key \(artifact_id, version\)/);
    expect(mig).toMatch(/bytes\s+integer generated always as \(octet_length\(body\)\) stored/);
    expect(mig).toMatch(/create table if not exists public\.artifact_data \([\s\S]*scope\s+text not null check \(scope = 'shared' or scope ~ [\s\S]*value\s+jsonb not null[\s\S]*primary key \(artifact_id, scope, key\)/);
    expect(mig).toMatch(/create table if not exists public\.artifact_kits \([\s\S]*project_id uuid primary key[\s\S]*head_sha\s+text not null[\s\S]*kit\s+jsonb not null/);
  });

  it("is safe to run again, and puts the atomic writes in functions only the service role may call", () => {
    expect(mig).not.toMatch(/create table (?!if not exists)/);
    expect(mig).toMatch(/create or replace function public\.artifact_add_version/);
    expect(mig).toMatch(/where a\.id = p_artifact\s+and a\.head_version = p_expected/);
    expect(mig).toMatch(/create or replace function public\.artifact_data_put[\s\S]*pg_advisory_xact_lock[\s\S]*return 'too_many'/);
    expect(mig).toMatch(/create or replace function public\.artifact_add_spend/);
    for (const f of ["artifact_add_version(uuid, integer, text, text, text, text, text, integer)", "artifact_add_spend(uuid, integer)", "artifact_data_put(uuid, text, text, jsonb, integer)"]) {
      expect(mig).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(mig).toContain(`grant execute on function public.${f} to service_role;`);
    }
    for (const call of ["artifact_add_version", "artifact_add_spend", "artifact_data_put"]) expect(readFileSync(join(dir, "src", "artifacts", "store.ts"), "utf8")).toContain(`"${call}"`);
  });

  it("turns row security on for every table: the owner reads their own, nobody writes but the service role, a share link is not read from the database", () => {
    for (const t of ARTIFACT_TABLES) expect(mig).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    // every policy is a select, and there is no insert, update or delete policy
    expect(mig.match(/create policy/g)).toHaveLength(4);
    expect(mig).not.toMatch(/for (insert|update|delete|all)/);
    expect(mig).toMatch(/create policy "users read own artifacts"\s+on public\.artifacts for select\s+using \(auth\.uid\(\) = user_id\)/);
    expect(mig).toMatch(/create policy "users read own artifact versions"[\s\S]*exists \([\s\S]*a\.user_id = auth\.uid\(\)/);
    // a person reads the shared scope of artifacts they own, and their own scope: never another person's
    expect(mig).toMatch(/create policy "users read own artifact data"[\s\S]*scope = auth\.uid\(\)::text[\s\S]*scope = 'shared' and exists/);
    expect(mig).toMatch(/create policy "users read own artifact kits"[\s\S]*auth\.uid\(\) = user_id/);
    // nothing reads by share_token for anon
    expect(mig).not.toMatch(/share_token\s*=/);
    expect(mig).not.toMatch(/to anon/);
  });

  it("is appended to the whole schema, after 0031 and before the front door's 0033, whole", () => {
    expect(all).toContain("-- 0032_artifacts.sql");
    expect(all.indexOf("-- 0032_artifacts.sql")).toBeGreaterThan(all.indexOf("-- 0031_code_runner_minutes.sql"));
    const mine = all.slice(all.indexOf("-- 0032_artifacts.sql"), all.indexOf("-- 0033_front_decisions.sql"));
    expect(mine).toContain(mig.trim().split("\n").slice(-12).join("\n"));
    // (the next migration's heading starts with a rule of dashes)
    expect(mine.replace(/\n-- #+\s*$/, "").trimEnd().endsWith(mig.trimEnd())).toBe(true);
  });

  it("is on the account delete list (and what a viewer saved in other people's artifacts is cleared by scope), and the export covers every table", () => {
    const server = readFileSync(join(dir, "src", "server.ts"), "utf8");
    for (const t of ARTIFACT_USER_TABLES) expect(server).toContain(`["${t}", null]`);
    expect(server).toMatch(/deleteViewerData\(admin, user\.id\)/);
    // versions and data go with the artifact (cascade), so the delete list needs only the tables with a user_id
    expect([...ARTIFACT_USER_TABLES]).toEqual(["artifacts", "artifact_kits"]);
    expect([...ARTIFACT_TABLES]).toEqual(["artifacts", "artifact_versions", "artifact_data", "artifact_kits"]);
  });
});
