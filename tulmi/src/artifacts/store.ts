/**
 * WHERE ARTIFACTS ARE KEPT.
 *
 * The tables (supabase/migrations/0032_artifacts.sql), behind one interface, so everything above runs
 * against the in-memory twin in tests and local runs, as code/store.ts does. Written with the service
 * key: a person's own token may only READ the rows of their own artifacts, and a shared link is read
 * through the API (routes/artifacts.ts), never straight from the database.
 *
 *   artifacts          one row per artifact: whose, what kind, the title, which version is the head, the share
 *                      token, whether others who open the link may save, and what models have cost for it
 *   artifact_versions  a row per version: a snapshot (the whole text) or a patch (versions.ts)
 *   artifact_data      what the artifact saves while it runs: a key and a JSON value per scope (shared, or one
 *                      person's), under the protocol's LIMITS
 *   artifact_kits      the project's look (kit.ts), one row per project, for the head it was read at
 *
 * No method here is about who may do what: the caller (service.ts) has shown the artifact is the person's,
 * or that the share link is real. Two writes are atomic in the database (a new version moves the head only
 * if the head is still where the writer read it; a saved key counts the keys under the same lock), and the
 * twin does the same, so a race loses the same way in both.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { LIMITS } from "./protocol.js";
import {
  ARTIFACT_TYPES, LIST_MAX, VERSIONS_LIST_MAX,
  type Artifact, type ArtifactType, type DataEntry, type NewArtifact, type NewVersion, type Scope, type VersionInfo, type VersionRow,
} from "./types.js";
import { contentAt, type VersionReader } from "./versions.js";

/** The project's look as it is kept: the head it was read at, and the kit (kit.ts DesignKit) as plain JSON. */
export interface StoredKit { headSha: string; kit: unknown; updatedAt: number }

/** Everything a person has in artifacts, for the export. Versions are listed, not their text; the head's text is in `content`. */
export interface ArtifactExport {
  artifacts: Array<Artifact & { content: string; versions: VersionInfo[] }>;
  /** Saved data in the artifacts they own: the shared scope and their own. */
  data: Array<{ artifactId: string; scope: Scope; key: string; value: unknown }>;
}

export interface ArtifactStore extends VersionReader {
  /** The artifact and its first version (a snapshot), together. */
  create(a: NewArtifact, first: NewVersion): Promise<Artifact>;
  get(id: string): Promise<Artifact | null>;
  getByToken(token: string): Promise<Artifact | null>;
  /** This person's artifacts, most recently changed first. */
  list(userId: string, o?: { projectId?: string; limit?: number }): Promise<Artifact[]>;
  countFor(userId: string): Promise<number>;
  /** The share link on or off, and whether others may save. Fields left out stay as they are. */
  setShare(id: string, s: { shareToken?: string | null; othersCanSave?: boolean }): Promise<Artifact | null>;
  /**
   * The next version, if the head is still `expectedHead` (null when it moved, or the artifact is gone). Also sets the title when given and
   * adds `paise` to what the artifact has cost, in the same step.
   */
  addVersion(id: string, expectedHead: number, v: NewVersion, o?: { title?: string; paise?: number }): Promise<Artifact | null>;
  addSpend(id: string, paise: number): Promise<void>;
  listVersions(id: string, limit?: number): Promise<VersionInfo[]>;
  /** The artifact, its versions and its data. Returns whether it was there. */
  delete(id: string): Promise<boolean>;

  dataGet(id: string, scope: Scope, key: string): Promise<DataEntry | null>;
  dataKeys(id: string, scope: Scope): Promise<string[]>;
  /** "too_many" when the scope already holds LIMITS.storageKeys keys and this is a new one. */
  dataPut(id: string, scope: Scope, key: string, value: unknown): Promise<"ok" | "too_many">;
  dataDelete(id: string, scope: Scope, key: string): Promise<boolean>;

  getKit(projectId: string): Promise<StoredKit | null>;
  putKit(projectId: string, userId: string, headSha: string, kit: unknown): Promise<void>;
  deleteKit(projectId: string): Promise<void>;

  exportOf(userId: string): Promise<ArtifactExport>;
}

const clone = <T>(v: T): T => structuredClone(v);

/** The share token: 24 random bytes, base64url. It is the whole of the link's secret. */
export const newShareToken = (): string => randomBytes(24).toString("base64url");

// -------------------------------------------------------------------- memory

export class MemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, Artifact>();
  private versions = new Map<string, VersionRow[]>();
  private data = new Map<string, Map<string, DataEntry>>();
  private kits = new Map<string, StoredKit & { userId: string }>();

  constructor(private readonly now: () => number = Date.now) {}

  async create(a: NewArtifact, first: NewVersion) {
    const t = this.now();
    const row: Artifact = {
      id: randomUUID(), userId: a.userId, projectId: a.projectId ?? null, type: a.type, title: a.title, headVersion: 1, shareToken: null,
      othersCanSave: false, spentPaise: 0, createdAt: t, updatedAt: t,
    };
    this.artifacts.set(row.id, row);
    this.versions.set(row.id, [{ artifactId: row.id, version: 1, ...clone(first), createdAt: t }]);
    return clone(row);
  }
  async get(id: string) {
    const a = this.artifacts.get(id);
    return a ? clone(a) : null;
  }
  async getByToken(token: string) {
    if (!token) return null;
    for (const a of this.artifacts.values()) if (a.shareToken === token) return clone(a);
    return null;
  }
  async list(userId: string, o: { projectId?: string; limit?: number } = {}) {
    return [...this.artifacts.values()]
      .filter((a) => a.userId === userId && (o.projectId === undefined || a.projectId === o.projectId))
      .sort((x, y) => y.updatedAt - x.updatedAt || (x.id < y.id ? -1 : 1))
      .slice(0, Math.min(o.limit ?? LIST_MAX, LIST_MAX)).map(clone);
  }
  async countFor(userId: string) { return [...this.artifacts.values()].filter((a) => a.userId === userId).length; }
  async setShare(id: string, s: { shareToken?: string | null; othersCanSave?: boolean }) {
    const a = this.artifacts.get(id);
    if (!a) return null;
    if (s.shareToken !== undefined) a.shareToken = s.shareToken;
    if (s.othersCanSave !== undefined) a.othersCanSave = s.othersCanSave;
    a.updatedAt = this.now();
    return clone(a);
  }
  async addVersion(id: string, expectedHead: number, v: NewVersion, o: { title?: string; paise?: number } = {}) {
    const a = this.artifacts.get(id);
    if (!a || a.headVersion !== expectedHead) return null;
    const t = this.now();
    a.headVersion += 1;
    if (o.title !== undefined) a.title = o.title;
    a.spentPaise += Math.max(0, Math.round(o.paise ?? 0));
    a.updatedAt = t;
    this.versions.get(id)!.push({ artifactId: id, version: a.headVersion, ...clone(v), createdAt: t });
    return clone(a);
  }
  async addSpend(id: string, paise: number) {
    const a = this.artifacts.get(id);
    if (a) { a.spentPaise += Math.max(0, Math.round(paise)); }
  }
  async snapshotAtOrBefore(id: string, version: number) {
    const rows = this.versions.get(id) ?? [];
    for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i]!.kind === "snapshot" && rows[i]!.version <= version) return clone(rows[i]!);
    return null;
  }
  async versionsBetween(id: string, from: number, to: number) {
    return (this.versions.get(id) ?? []).filter((r) => r.version >= from && r.version <= to).map(clone);
  }
  async listVersions(id: string, limit = 50) {
    return (this.versions.get(id) ?? []).slice().reverse().slice(0, Math.min(limit, VERSIONS_LIST_MAX)).map((r) => ({
      version: r.version, kind: r.kind, madeBy: r.madeBy, note: r.note, createdAt: r.createdAt, storedBytes: Buffer.byteLength(r.body, "utf8"),
    }));
  }
  async delete(id: string) {
    this.versions.delete(id);
    for (const k of [...this.data.keys()]) if (k.startsWith(`${id}|`)) this.data.delete(k);
    return this.artifacts.delete(id);
  }

  private scopeOf(id: string, scope: Scope) {
    let m = this.data.get(`${id}|${scope}`);
    if (!m) { m = new Map(); this.data.set(`${id}|${scope}`, m); }
    return m;
  }
  async dataGet(id: string, scope: Scope, key: string) {
    const e = this.data.get(`${id}|${scope}`)?.get(key);
    return e ? clone(e) : null;
  }
  async dataKeys(id: string, scope: Scope) { return [...(this.data.get(`${id}|${scope}`)?.keys() ?? [])].sort(); }
  async dataPut(id: string, scope: Scope, key: string, value: unknown) {
    const m = this.scopeOf(id, scope);
    if (!m.has(key) && m.size >= LIMITS.storageKeys) return "too_many" as const;
    m.set(key, { key, value: clone(value), updatedAt: this.now() });
    return "ok" as const;
  }
  async dataDelete(id: string, scope: Scope, key: string) { return this.data.get(`${id}|${scope}`)?.delete(key) ?? false; }

  async getKit(projectId: string) {
    const k = this.kits.get(projectId);
    return k ? { headSha: k.headSha, kit: clone(k.kit), updatedAt: k.updatedAt } : null;
  }
  async putKit(projectId: string, userId: string, headSha: string, kit: unknown) {
    this.kits.set(projectId, { headSha, kit: clone(kit), updatedAt: this.now(), userId });
  }
  async deleteKit(projectId: string) { this.kits.delete(projectId); }

  async exportOf(userId: string): Promise<ArtifactExport> {
    const mine = [...this.artifacts.values()].filter((a) => a.userId === userId);
    const out: ArtifactExport = { artifacts: [], data: [] };
    for (const a of mine) {
      out.artifacts.push({ ...clone(a), content: await contentAt(this, a.id, a.headVersion), versions: await this.listVersions(a.id, VERSIONS_LIST_MAX) });
      for (const [k, m] of this.data) {
        const [id, scope] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
        if (id !== a.id || (scope !== "shared" && scope !== userId)) continue;
        for (const e of m.values()) out.data.push({ artifactId: id, scope, key: e.key, value: clone(e.value) });
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: unknown): number => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export interface ArtifactDbRow {
  id: string; user_id: string; project_id: string | null; type: string; title: string; head_version: number; share_token: string | null;
  others_can_save: boolean; spent_paise: number; created_at: string; updated_at: string;
}
export interface VersionDbRow {
  artifact_id: string; version: number; kind: "snapshot" | "patch"; body: string; made_by: "bot" | "person"; note: string; created_at: string; bytes?: number;
}
interface DataDbRow { artifact_id: string; scope: string; key: string; value: unknown; updated_at: string }

export const artifactOf = (r: ArtifactDbRow): Artifact => ({
  id: r.id, userId: r.user_id, projectId: r.project_id ?? null,
  type: (ARTIFACT_TYPES as readonly string[]).includes(r.type) ? (r.type as ArtifactType) : "html",
  title: r.title, headVersion: Number(r.head_version), shareToken: r.share_token ?? null, othersCanSave: !!r.others_can_save,
  spentPaise: Number(r.spent_paise ?? 0), createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
});
export const versionOf = (r: VersionDbRow): VersionRow => ({
  artifactId: r.artifact_id, version: Number(r.version), kind: r.kind, body: r.body, madeBy: r.made_by, note: r.note ?? "", createdAt: ms(r.created_at),
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`artifact store: ${res.error.message}`);
  return res.data;
}

export class SupabaseArtifactStore implements ArtifactStore {
  constructor(private readonly sb: SupabaseClient, private readonly now: () => number = Date.now) {}

  /** An id that is not a uuid is no artifact's: reads find nothing. */
  private id(id: string): string | null { return UUID.test(id) ? id : null; }

  async create(a: NewArtifact, first: NewVersion) {
    const row = ok(await this.sb.from("artifacts").insert({
      user_id: a.userId, project_id: a.projectId ?? null, type: a.type, title: a.title, head_version: 1,
    }).select("*").single<ArtifactDbRow>())!;
    const made = await this.sb.from("artifact_versions").insert({
      artifact_id: row.id, version: 1, kind: first.kind, body: first.body, made_by: first.madeBy, note: first.note,
    });
    if (made.error) {
      // An artifact without its first version is nothing: take it back.
      await this.sb.from("artifacts").delete().eq("id", row.id);
      throw new Error(`artifact store: ${made.error.message}`);
    }
    return artifactOf(row);
  }
  async get(id: string) {
    const u = this.id(id);
    if (!u) return null;
    const r = ok(await this.sb.from("artifacts").select("*").eq("id", u).maybeSingle<ArtifactDbRow>());
    return r ? artifactOf(r) : null;
  }
  async getByToken(token: string) {
    if (!token || token.length > 200) return null;
    const r = ok(await this.sb.from("artifacts").select("*").eq("share_token", token).maybeSingle<ArtifactDbRow>());
    return r ? artifactOf(r) : null;
  }
  async list(userId: string, o: { projectId?: string; limit?: number } = {}) {
    let q = this.sb.from("artifacts").select("*").eq("user_id", userId);
    if (o.projectId !== undefined) q = q.eq("project_id", o.projectId);
    const rows = ok(await q.order("updated_at", { ascending: false }).limit(Math.min(o.limit ?? LIST_MAX, LIST_MAX)).returns<ArtifactDbRow[]>());
    return (rows ?? []).map(artifactOf);
  }
  async countFor(userId: string) {
    const r = await this.sb.from("artifacts").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (r.error) throw new Error(`artifact store: ${r.error.message}`);
    return r.count ?? 0;
  }
  async setShare(id: string, s: { shareToken?: string | null; othersCanSave?: boolean }) {
    const u = this.id(id);
    if (!u) return null;
    const row: Record<string, unknown> = { updated_at: iso(this.now()) };
    if (s.shareToken !== undefined) row.share_token = s.shareToken;
    if (s.othersCanSave !== undefined) row.others_can_save = s.othersCanSave;
    const r = ok(await this.sb.from("artifacts").update(row).eq("id", u).select("*").maybeSingle<ArtifactDbRow>());
    return r ? artifactOf(r) : null;
  }
  async addVersion(id: string, expectedHead: number, v: NewVersion, o: { title?: string; paise?: number } = {}) {
    const u = this.id(id);
    if (!u) return null;
    // One statement in the database: the head moves only if it is still where the writer read it, and the version is written with it.
    const head = ok(await this.sb.rpc("artifact_add_version", {
      p_artifact: u, p_expected: expectedHead, p_kind: v.kind, p_body: v.body, p_made_by: v.madeBy, p_note: v.note,
      p_title: o.title ?? null, p_paise: Math.max(0, Math.round(o.paise ?? 0)),
    }) as { data: number | null; error: { message: string } | null });
    if (head === null || head === undefined) return null;
    return this.get(u);
  }
  async addSpend(id: string, paise: number) {
    const u = this.id(id);
    if (!u || !(paise > 0)) return;
    ok(await this.sb.rpc("artifact_add_spend", { p_artifact: u, p_paise: Math.round(paise) }) as { data: unknown; error: { message: string } | null });
  }
  async snapshotAtOrBefore(id: string, version: number) {
    const u = this.id(id);
    if (!u) return null;
    const rows = ok(await this.sb.from("artifact_versions").select("*").eq("artifact_id", u).eq("kind", "snapshot").lte("version", version)
      .order("version", { ascending: false }).limit(1).returns<VersionDbRow[]>());
    return rows?.[0] ? versionOf(rows[0]) : null;
  }
  async versionsBetween(id: string, from: number, to: number) {
    const u = this.id(id);
    if (!u) return [];
    const rows = ok(await this.sb.from("artifact_versions").select("*").eq("artifact_id", u).gte("version", from).lte("version", to)
      .order("version", { ascending: true }).returns<VersionDbRow[]>());
    return (rows ?? []).map(versionOf);
  }
  async listVersions(id: string, limit = 50) {
    const u = this.id(id);
    if (!u) return [];
    const rows = ok(await this.sb.from("artifact_versions").select("version,kind,made_by,note,created_at,bytes").eq("artifact_id", u)
      .order("version", { ascending: false }).limit(Math.min(limit, VERSIONS_LIST_MAX)).returns<VersionDbRow[]>());
    return (rows ?? []).map((r) => ({ version: Number(r.version), kind: r.kind, madeBy: r.made_by, note: r.note ?? "", createdAt: ms(r.created_at), storedBytes: Number(r.bytes ?? 0) }));
  }
  async delete(id: string) {
    const u = this.id(id);
    if (!u) return false;
    const rows = ok(await this.sb.from("artifacts").delete().eq("id", u).select("id").returns<Array<{ id: string }>>());
    return (rows ?? []).length > 0;
  }

  async dataGet(id: string, scope: Scope, key: string) {
    const u = this.id(id);
    if (!u) return null;
    const r = ok(await this.sb.from("artifact_data").select("*").eq("artifact_id", u).eq("scope", scope).eq("key", key).maybeSingle<DataDbRow>());
    return r ? { key: r.key, value: r.value, updatedAt: ms(r.updated_at) } : null;
  }
  async dataKeys(id: string, scope: Scope) {
    const u = this.id(id);
    if (!u) return [];
    const rows = ok(await this.sb.from("artifact_data").select("key").eq("artifact_id", u).eq("scope", scope).order("key").limit(LIMITS.storageKeys).returns<Array<{ key: string }>>());
    return (rows ?? []).map((r) => r.key);
  }
  async dataPut(id: string, scope: Scope, key: string, value: unknown) {
    const u = this.id(id);
    if (!u) return "too_many" as const;
    const r = ok(await this.sb.rpc("artifact_data_put", { p_artifact: u, p_scope: scope, p_key: key, p_value: value, p_max_keys: LIMITS.storageKeys }) as { data: string | null; error: { message: string } | null });
    return r === "too_many" ? "too_many" as const : "ok" as const;
  }
  async dataDelete(id: string, scope: Scope, key: string) {
    const u = this.id(id);
    if (!u) return false;
    const rows = ok(await this.sb.from("artifact_data").delete().eq("artifact_id", u).eq("scope", scope).eq("key", key).select("key").returns<Array<{ key: string }>>());
    return (rows ?? []).length > 0;
  }

  async getKit(projectId: string) {
    const u = this.id(projectId);
    if (!u) return null;
    const r = ok(await this.sb.from("artifact_kits").select("*").eq("project_id", u).maybeSingle<{ head_sha: string; kit: unknown; updated_at: string }>());
    return r ? { headSha: r.head_sha, kit: r.kit, updatedAt: ms(r.updated_at) } : null;
  }
  async putKit(projectId: string, userId: string, headSha: string, kit: unknown) {
    const u = this.id(projectId);
    if (!u) return;
    ok(await this.sb.from("artifact_kits").upsert({ project_id: u, user_id: userId, head_sha: headSha, kit, updated_at: iso(this.now()) }, { onConflict: "project_id" }));
  }
  async deleteKit(projectId: string) {
    const u = this.id(projectId);
    if (u) ok(await this.sb.from("artifact_kits").delete().eq("project_id", u));
  }

  async exportOf(userId: string): Promise<ArtifactExport> {
    const mine = await this.list(userId, { limit: LIST_MAX });
    const out: ArtifactExport = { artifacts: [], data: [] };
    for (const a of mine) {
      out.artifacts.push({ ...a, content: await contentAt(this, a.id, a.headVersion), versions: await this.listVersions(a.id, VERSIONS_LIST_MAX) });
      const rows = ok(await this.sb.from("artifact_data").select("*").eq("artifact_id", a.id).in("scope", ["shared", userId]).returns<DataDbRow[]>());
      for (const r of rows ?? []) out.data.push({ artifactId: a.id, scope: r.scope, key: r.key, value: r.value });
    }
    return out;
  }
}

// ------------------------------------------------------------------ the account

/** The tables with a user_id that an account delete clears; versions and data cascade from `artifacts`. */
export const ARTIFACT_USER_TABLES = ["artifacts", "artifact_kits"] as const;
/** All the artifact tables, for the export and the docs. */
export const ARTIFACT_TABLES = ["artifacts", "artifact_versions", "artifact_data", "artifact_kits"] as const;

/**
 * Saved data a person left in OTHER people's artifacts (scope = their id) has no row of theirs to cascade from, so the account delete
 * clears it by scope. Returns how many rows went.
 */
export async function deleteViewerData(sb: SupabaseClient, userId: string): Promise<number> {
  const rows = ok(await sb.from("artifact_data").delete().eq("scope", userId).select("key").returns<Array<{ key: string }>>());
  return (rows ?? []).length;
}

// ------------------------------------------------------------------ the one

let current: ArtifactStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function artifactStore(): ArtifactStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseArtifactStore(sb) : new MemoryArtifactStore();
  }
  return current;
}

export function resetArtifactStoreForTests(): void { current = null; }
