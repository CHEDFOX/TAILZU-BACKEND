/**
 * WHERE THE PROJECT BRAIN IS KEPT.
 *
 * The tables (supabase/migrations/0028_code_project_brain.sql), behind one
 * interface, so everything above runs against the in-memory twin in tests and
 * local runs, as code/store.ts does. Written with the service key; a person's
 * own token may only READ the rows of their own projects.
 *
 *   code_brain         one row per project: the head and tree it was built from,
 *                      the status and progress, the structure, conventions and
 *                      features, the memory text, the welcome, the baseline, the
 *                      history of commits, the money spent
 *   code_brain_files   a row per file read: blob sha, symbols, imports, rank, hot,
 *                      todo, tests, summary, and a generated search document
 *   code_brain_dirs    a row per folder with a line: tree sha and summary
 *   code_brain_texts   the strings a person sees, with file and line
 *
 * No method here is about a person: the caller (index.ts) has already shown the
 * project is theirs (projects.ts ownProject), as for branches and grants.
 *
 * SEARCH. The database finds candidates with its generated `tsv` (an AND of the
 * query's words, each a prefix; if that is empty, an OR); the twin does the same
 * on the same words (search.ts). Both hand the candidates back for the caller to
 * score, so tests and production order hits the same way.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import { fileMatches, queryWords, textMatches, tsQuery } from "./search.js";
import {
  EMPTY_CONVENTIONS, EMPTY_STRUCTURE,
  type Baseline, type BrainRow, type BrainStatus, type Conventions, type Feature, type History, type Progress, type StoredDir, type StoredFile, type StoredText, type Structure,
  type SummariesState, type SymbolInfo,
} from "./types.js";

/** What a save can change. `status` and the rest are all optional: the row is created on first save. */
export type BrainPatch = Partial<Omit<BrainRow, "projectId" | "updatedAt">>;

export interface ProjectBrainStore {
  getBrain(projectId: string): Promise<BrainRow | null>;
  /** Creates the row, or changes the fields given. */
  saveBrain(projectId: string, patch: BrainPatch): Promise<BrainRow>;
  setProgress(projectId: string, progress: Progress): Promise<void>;
  /** A ready or failed brain is stale now (the default branch moved). Returns whether there was a brain. */
  markStale(projectId: string): Promise<boolean>;
  deleteBrain(projectId: string): Promise<void>;

  listFiles(projectId: string): Promise<StoredFile[]>;
  getFile(projectId: string, path: string): Promise<StoredFile | null>;
  upsertFiles(projectId: string, files: readonly StoredFile[]): Promise<void>;
  deleteFiles(projectId: string, paths: readonly string[]): Promise<void>;

  listDirs(projectId: string): Promise<StoredDir[]>;
  upsertDirs(projectId: string, dirs: readonly StoredDir[]): Promise<void>;
  deleteDirs(projectId: string, paths: readonly string[]): Promise<void>;

  /** Drops the strings of these files, then adds `rows`. */
  replaceTexts(projectId: string, paths: readonly string[], rows: readonly StoredText[]): Promise<void>;
  clearTexts(projectId: string): Promise<void>;

  /** Candidate files for a query (see above), at most `limit`. */
  searchFiles(projectId: string, q: string, limit: number): Promise<StoredFile[]>;
  searchTexts(projectId: string, q: string, limit: number): Promise<StoredText[]>;
  /** Some of the project's strings, for samples (the features' words): at most `limit`, in path order. */
  sampleTexts(projectId: string, limit: number): Promise<StoredText[]>;
  /** The files that import `path`. */
  importersOf(projectId: string, path: string, limit: number): Promise<string[]>;
  /** The files with the most of something, most first; only those with any. */
  topFiles(projectId: string, by: "hot" | "todo" | "rank", limit: number): Promise<StoredFile[]>;
}

export const NO_PROGRESS: Readonly<Progress> = { pct: 0, phase: "" };

const clone = <T>(v: T): T => structuredClone(v);

function blankRow(projectId: string, now: number): BrainRow {
  return {
    projectId, headSha: "", treeSha: "", status: "building", progress: { ...NO_PROGRESS }, structure: clone(EMPTY_STRUCTURE) as Structure,
    conventions: clone(EMPTY_CONVENTIONS) as Conventions, features: [], memory: "", welcome: "", summariesState: "none", baseline: null,
    history: { commits: [], head: "" }, spentPaise: 0, builtAt: null, error: "", updatedAt: now,
  };
}

// -------------------------------------------------------------------- memory

export class MemoryProjectBrainStore implements ProjectBrainStore {
  private brains = new Map<string, BrainRow>();
  private files = new Map<string, Map<string, StoredFile>>();
  private dirs = new Map<string, Map<string, StoredDir>>();
  private texts = new Map<string, StoredText[]>();

  constructor(private readonly now: () => number = Date.now) {}

  async getBrain(projectId: string) {
    const b = this.brains.get(projectId);
    return b ? clone(b) : null;
  }
  async saveBrain(projectId: string, patch: BrainPatch) {
    const cur = this.brains.get(projectId) ?? blankRow(projectId, this.now());
    const next: BrainRow = { ...cur, ...clone(patch), projectId, updatedAt: this.now() };
    this.brains.set(projectId, next);
    return clone(next);
  }
  async setProgress(projectId: string, progress: Progress) {
    const cur = this.brains.get(projectId);
    if (cur) { cur.progress = { ...progress }; cur.updatedAt = this.now(); }
  }
  async markStale(projectId: string) {
    const cur = this.brains.get(projectId);
    if (!cur) return false;
    if (cur.status === "ready" || cur.status === "failed") { cur.status = "stale"; cur.updatedAt = this.now(); }
    return true;
  }
  async deleteBrain(projectId: string) {
    this.brains.delete(projectId); this.files.delete(projectId); this.dirs.delete(projectId); this.texts.delete(projectId);
  }

  private f(projectId: string) { let m = this.files.get(projectId); if (!m) { m = new Map(); this.files.set(projectId, m); } return m; }
  private d(projectId: string) { let m = this.dirs.get(projectId); if (!m) { m = new Map(); this.dirs.set(projectId, m); } return m; }

  async listFiles(projectId: string) { return [...this.f(projectId).values()].sort((a, b) => (a.path < b.path ? -1 : 1)).map(clone); }
  async getFile(projectId: string, path: string) { const x = this.f(projectId).get(path); return x ? clone(x) : null; }
  async upsertFiles(projectId: string, files: readonly StoredFile[]) { const m = this.f(projectId); for (const x of files) m.set(x.path, clone(x)); }
  async deleteFiles(projectId: string, paths: readonly string[]) { const m = this.f(projectId); for (const p of paths) m.delete(p); }

  async listDirs(projectId: string) { return [...this.d(projectId).values()].sort((a, b) => (a.path < b.path ? -1 : 1)).map(clone); }
  async upsertDirs(projectId: string, dirs: readonly StoredDir[]) { const m = this.d(projectId); for (const x of dirs) m.set(x.path, clone(x)); }
  async deleteDirs(projectId: string, paths: readonly string[]) { const m = this.d(projectId); for (const p of paths) m.delete(p); }

  async replaceTexts(projectId: string, paths: readonly string[], rows: readonly StoredText[]) {
    const drop = new Set(paths);
    this.texts.set(projectId, [...(this.texts.get(projectId) ?? []).filter((t) => !drop.has(t.path)), ...rows.map(clone)]);
  }
  async clearTexts(projectId: string) { this.texts.delete(projectId); }

  async searchFiles(projectId: string, q: string, limit: number) {
    const words = queryWords(q);
    if (!words.length) return [];
    const all = [...this.f(projectId).values()];
    let hits = all.filter((f) => fileMatches(f, words, "and"));
    if (!hits.length) hits = all.filter((f) => fileMatches(f, words, "or"));
    return hits.slice(0, limit).map(clone);
  }
  async searchTexts(projectId: string, q: string, limit: number) {
    const words = queryWords(q);
    if (!words.length) return [];
    const all = this.texts.get(projectId) ?? [];
    let hits = all.filter((t) => textMatches(t, words, "and"));
    if (!hits.length) hits = all.filter((t) => textMatches(t, words, "or"));
    return hits.slice(0, limit).map(clone);
  }
  async sampleTexts(projectId: string, limit: number) {
    return (this.texts.get(projectId) ?? []).slice(0, limit).map(clone);
  }
  async importersOf(projectId: string, path: string, limit: number) {
    return [...this.f(projectId).values()].filter((f) => f.imports.includes(path)).map((f) => f.path).sort().slice(0, limit);
  }
  async topFiles(projectId: string, by: "hot" | "todo" | "rank", limit: number) {
    return [...this.f(projectId).values()].filter((f) => f[by] > 0)
      .sort((a, b) => b[by] - a[by] || (a.path < b.path ? -1 : 1)).slice(0, limit).map(clone);
  }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: unknown): number | null => { const n = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : null; };
/** Rows written or deleted in one request: the address and the body both have limits. */
const WRITE_CHUNK = 200;
const DELETE_CHUNK = 60;
const PAGE = 1000;

interface BrainDbRow {
  project_id: string; head_sha: string; tree_sha: string; status: BrainStatus; progress: Progress; structure: Structure; conventions: Conventions;
  features: Feature[]; memory: string; welcome: string; summaries_state: SummariesState; baseline: Baseline | null; history: History;
  spent_paise: number; built_at: string | null; error: string; updated_at: string;
}
interface FileDbRow {
  project_id: string; path: string; blob_sha: string; lang: string; bytes: number; symbols: SymbolInfo[]; imports: string[]; rank: number;
  hot: number; todo: number; tests: string[]; summary: string;
  /** Migration 0035; absent from a row read before it was run. */
  refs?: Array<[string, number]> | null;
}
interface DirDbRow { project_id: string; path: string; tree_sha: string; summary: string }
interface TextDbRow { project_id: string; path: string; line: number; text: string; kind: StoredText["kind"] }

const brainOf = (r: BrainDbRow): BrainRow => ({
  projectId: r.project_id, headSha: r.head_sha ?? "", treeSha: r.tree_sha ?? "", status: r.status, progress: r.progress ?? { ...NO_PROGRESS },
  structure: { ...clone(EMPTY_STRUCTURE), ...(r.structure ?? {}) } as Structure, conventions: { ...clone(EMPTY_CONVENTIONS), ...(r.conventions ?? {}) } as Conventions,
  features: r.features ?? [], memory: r.memory ?? "", welcome: r.welcome ?? "", summariesState: r.summaries_state, baseline: r.baseline ?? null,
  history: r.history && Array.isArray(r.history.commits) ? r.history : { commits: [], head: "" },
  spentPaise: Number(r.spent_paise) || 0, builtAt: ms(r.built_at), error: r.error ?? "", updatedAt: ms(r.updated_at) ?? 0,
});
const fileOf = (r: FileDbRow): StoredFile => ({
  path: r.path, blobSha: r.blob_sha, lang: r.lang ?? "", bytes: Number(r.bytes) || 0, symbols: r.symbols ?? [], imports: r.imports ?? [],
  rank: Number(r.rank) || 0, hot: Number(r.hot) || 0, todo: Number(r.todo) || 0, tests: r.tests ?? [], summary: r.summary ?? "",
  ...(Array.isArray(r.refs) && r.refs.length ? { refs: r.refs } : {}),
});
const fileRow = (projectId: string, f: StoredFile, withRefs: boolean): FileDbRow => ({
  project_id: projectId, path: f.path, blob_sha: f.blobSha, lang: f.lang, bytes: f.bytes, symbols: f.symbols, imports: f.imports, rank: f.rank,
  hot: f.hot, todo: f.todo, tests: f.tests, summary: f.summary, ...(withRefs ? { refs: f.refs ?? [] } : {}),
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code brain store: ${res.error.message}`);
  return res.data;
}

export class SupabaseProjectBrainStore implements ProjectBrainStore {
  /** Whether code_brain_files has the refs column (migration 0035): until a write says it does not, it is taken to. */
  private refsColumn = true;

  constructor(private readonly sb: SupabaseClient, private readonly now: () => number = Date.now) {}

  /** A project id that isn't a uuid is no project's: reads find nothing, writes are refused. */
  private id(projectId: string): string | null { return UUID.test(projectId) ? projectId : null; }
  private must(projectId: string): string {
    const id = this.id(projectId);
    if (!id) throw new Error("code brain store: not a project id");
    return id;
  }

  async getBrain(projectId: string) {
    const id = this.id(projectId);
    if (!id) return null;
    const r = ok(await this.sb.from("code_brain").select("*").eq("project_id", id).maybeSingle<BrainDbRow>());
    return r ? brainOf(r) : null;
  }
  async saveBrain(projectId: string, patch: BrainPatch) {
    const id = this.must(projectId);
    const row: Record<string, unknown> = { project_id: id, updated_at: iso(this.now()) };
    if (patch.headSha !== undefined) row.head_sha = patch.headSha;
    if (patch.treeSha !== undefined) row.tree_sha = patch.treeSha;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.progress !== undefined) row.progress = patch.progress;
    if (patch.structure !== undefined) row.structure = patch.structure;
    if (patch.conventions !== undefined) row.conventions = patch.conventions;
    if (patch.features !== undefined) row.features = patch.features;
    if (patch.memory !== undefined) row.memory = patch.memory;
    if (patch.welcome !== undefined) row.welcome = patch.welcome;
    if (patch.summariesState !== undefined) row.summaries_state = patch.summariesState;
    if (patch.baseline !== undefined) row.baseline = patch.baseline;
    if (patch.history !== undefined) row.history = patch.history;
    if (patch.spentPaise !== undefined) row.spent_paise = Math.max(0, Math.round(patch.spentPaise));
    if (patch.builtAt !== undefined) row.built_at = patch.builtAt === null ? null : iso(patch.builtAt);
    if (patch.error !== undefined) row.error = patch.error;
    const r = ok(await this.sb.from("code_brain").upsert(row, { onConflict: "project_id" }).select("*").single<BrainDbRow>());
    return brainOf(r!);
  }
  async setProgress(projectId: string, progress: Progress) {
    const id = this.id(projectId);
    if (!id) return;
    ok(await this.sb.from("code_brain").update({ progress, updated_at: iso(this.now()) }).eq("project_id", id));
  }
  async markStale(projectId: string) {
    const id = this.id(projectId);
    if (!id) return false;
    ok(await this.sb.from("code_brain").update({ status: "stale", updated_at: iso(this.now()) }).eq("project_id", id).in("status", ["ready", "failed"]));
    const r = ok(await this.sb.from("code_brain").select("project_id").eq("project_id", id).maybeSingle<{ project_id: string }>());
    return !!r;
  }
  async deleteBrain(projectId: string) {
    const id = this.id(projectId);
    if (!id) return;
    for (const t of ["code_brain_files", "code_brain_dirs", "code_brain_texts", "code_brain"]) ok(await this.sb.from(t).delete().eq("project_id", id));
  }

  async listFiles(projectId: string) {
    const id = this.id(projectId);
    if (!id) return [];
    const out: StoredFile[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = ok(await this.sb.from("code_brain_files").select(this.refsColumn ? "path,blob_sha,lang,bytes,symbols,imports,rank,hot,todo,tests,summary,refs,project_id" : "path,blob_sha,lang,bytes,symbols,imports,rank,hot,todo,tests,summary,project_id")
        .eq("project_id", id).order("path").range(from, from + PAGE - 1).returns<FileDbRow[]>()) ?? [];
      out.push(...rows.map(fileOf));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  async getFile(projectId: string, path: string) {
    const id = this.id(projectId);
    if (!id) return null;
    const r = ok(await this.sb.from("code_brain_files").select("*").eq("project_id", id).eq("path", path).maybeSingle<FileDbRow>());
    return r ? fileOf(r) : null;
  }
  async upsertFiles(projectId: string, files: readonly StoredFile[]) {
    const id = this.must(projectId);
    for (let i = 0; i < files.length; i += WRITE_CHUNK) {
      const chunk = files.slice(i, i + WRITE_CHUNK);
      let res = await this.sb.from("code_brain_files").upsert(chunk.map((f) => fileRow(id, f, this.refsColumn)), { onConflict: "project_id,path" });
      // A database that has not had migration 0035 run has no refs column: write the rest and go on without references, never fail the build over them.
      if (res.error && this.refsColumn && /\brefs\b/.test(res.error.message)) {
        this.refsColumn = false;
        res = await this.sb.from("code_brain_files").upsert(chunk.map((f) => fileRow(id, f, false)), { onConflict: "project_id,path" });
      }
      ok(res);
    }
  }
  async deleteFiles(projectId: string, paths: readonly string[]) {
    const id = this.must(projectId);
    for (let i = 0; i < paths.length; i += DELETE_CHUNK) ok(await this.sb.from("code_brain_files").delete().eq("project_id", id).in("path", paths.slice(i, i + DELETE_CHUNK) as string[]));
  }

  async listDirs(projectId: string) {
    const id = this.id(projectId);
    if (!id) return [];
    const out: StoredDir[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = ok(await this.sb.from("code_brain_dirs").select("path,tree_sha,summary").eq("project_id", id).order("path").range(from, from + PAGE - 1)
        .returns<DirDbRow[]>()) ?? [];
      out.push(...rows.map((r) => ({ path: r.path, treeSha: r.tree_sha, summary: r.summary ?? "" })));
      if (rows.length < PAGE) break;
    }
    return out;
  }
  async upsertDirs(projectId: string, dirs: readonly StoredDir[]) {
    const id = this.must(projectId);
    for (let i = 0; i < dirs.length; i += WRITE_CHUNK) {
      ok(await this.sb.from("code_brain_dirs").upsert(dirs.slice(i, i + WRITE_CHUNK).map((d) => ({ project_id: id, path: d.path, tree_sha: d.treeSha, summary: d.summary })), { onConflict: "project_id,path" }));
    }
  }
  async deleteDirs(projectId: string, paths: readonly string[]) {
    const id = this.must(projectId);
    for (let i = 0; i < paths.length; i += DELETE_CHUNK) ok(await this.sb.from("code_brain_dirs").delete().eq("project_id", id).in("path", paths.slice(i, i + DELETE_CHUNK) as string[]));
  }

  async replaceTexts(projectId: string, paths: readonly string[], rows: readonly StoredText[]) {
    const id = this.must(projectId);
    for (let i = 0; i < paths.length; i += DELETE_CHUNK) ok(await this.sb.from("code_brain_texts").delete().eq("project_id", id).in("path", paths.slice(i, i + DELETE_CHUNK) as string[]));
    for (let i = 0; i < rows.length; i += 500) {
      ok(await this.sb.from("code_brain_texts").insert(rows.slice(i, i + 500).map((t): TextDbRow => ({ project_id: id, path: t.path, line: Math.max(1, t.line), text: t.text.slice(0, 1000), kind: t.kind }))));
    }
  }
  async clearTexts(projectId: string) {
    const id = this.id(projectId);
    if (id) ok(await this.sb.from("code_brain_texts").delete().eq("project_id", id));
  }

  async searchFiles(projectId: string, q: string, limit: number) {
    const id = this.id(projectId);
    const words = queryWords(q);
    if (!id || !words.length) return [];
    for (const op of ["&", "|"] as const) {
      const rows = ok(await this.sb.from("code_brain_files").select("*").eq("project_id", id).textSearch("tsv", tsQuery(words, op), { config: "simple" })
        .limit(limit).returns<FileDbRow[]>()) ?? [];
      if (rows.length || words.length === 1) return rows.map(fileOf);
    }
    return [];
  }
  async searchTexts(projectId: string, q: string, limit: number) {
    const id = this.id(projectId);
    const words = queryWords(q);
    if (!id || !words.length) return [];
    for (const op of ["&", "|"] as const) {
      const rows = ok(await this.sb.from("code_brain_texts").select("path,line,text,kind,project_id").eq("project_id", id).textSearch("tsv", tsQuery(words, op), { config: "simple" })
        .limit(limit).returns<TextDbRow[]>()) ?? [];
      if (rows.length || words.length === 1) return rows.map((r) => ({ path: r.path, line: r.line, text: r.text, kind: r.kind }));
    }
    return [];
  }
  async sampleTexts(projectId: string, limit: number) {
    const id = this.id(projectId);
    if (!id) return [];
    const rows = ok(await this.sb.from("code_brain_texts").select("path,line,text,kind,project_id").eq("project_id", id).order("path").order("line").limit(limit)
      .returns<TextDbRow[]>()) ?? [];
    return rows.map((r) => ({ path: r.path, line: r.line, text: r.text, kind: r.kind }));
  }
  async importersOf(projectId: string, path: string, limit: number) {
    const id = this.id(projectId);
    if (!id) return [];
    const rows = ok(await this.sb.from("code_brain_files").select("path").eq("project_id", id).contains("imports", [path]).order("path").limit(limit)
      .returns<Array<{ path: string }>>()) ?? [];
    return rows.map((r) => r.path);
  }
  async topFiles(projectId: string, by: "hot" | "todo" | "rank", limit: number) {
    const id = this.id(projectId);
    if (!id) return [];
    const rows = ok(await this.sb.from("code_brain_files").select("*").eq("project_id", id).gt(by, 0).order(by, { ascending: false }).limit(limit)
      .returns<FileDbRow[]>()) ?? [];
    return rows.map(fileOf);
  }
}

// ------------------------------------------------------------------ the one

let current: ProjectBrainStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function projectBrainStore(): ProjectBrainStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseProjectBrainStore(sb) : new MemoryProjectBrainStore();
  }
  return current;
}

export function resetProjectBrainStoreForTests(): void { current = null; }

export type { BrainStatus };
