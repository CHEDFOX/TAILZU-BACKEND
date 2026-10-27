/**
 * HOW A PROJECT'S JOBS ARE WORKED, AS THE PERSON SET IT: THE MODE, AND "ALWAYS SHOW ME THE PLAN FIRST".
 *
 *   mode        "guided" (the default: locate, plan, work, verify, commit) or "freeform" (the model decides the order of explore, change and run: debugging,
 *               investigating, exploratory changes). The front door chooses freeform for a task that reads as open-ended; this makes every job of the project so
 *   planFirst   every task's plan goes to the person for a yes before any work, in either mode (a guided job always planned; a free-form job plans only for this)
 *
 * One row for each project (migration 0034, code_project_settings), behind one interface with a memory twin, as the other stores are. A job's own request
 * ({ mode, planFirst } on POST /v1/code/jobs, or the front door's decision) beats the project's setting; the project's beats the default.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import { ConnectorError } from "../../connectors/state.js";
import { JOB_MODES, type JobMode } from "./types.js";

export interface ProjectSettings {
  projectId: string;
  userId: string;
  mode: JobMode;
  planFirst: boolean;
  updatedAt: number;
}

export const DEFAULT_PROJECT_SETTINGS = { mode: "guided", planFirst: false } as const satisfies Pick<ProjectSettings, "mode" | "planFirst">;

export interface SettingsStore {
  /** The project's settings; the defaults (guided, no plan first) when the person never set any. */
  get(projectId: string): Promise<ProjectSettings | null>;
  put(s: ProjectSettings): Promise<ProjectSettings>;
}

/** A settings body, checked: each field optional, a wrong kind is refused with a sentence. */
export function readSettingsPatch(body: unknown): { mode?: JobMode; planFirst?: boolean } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const out: { mode?: JobMode; planFirst?: boolean } = {};
  if (b.mode !== undefined) {
    if (typeof b.mode !== "string" || !(JOB_MODES as readonly string[]).includes(b.mode)) throw new ConnectorError("bad_request", `mode is ${JOB_MODES.map((m) => `"${m}"`).join(" or ")}.`);
    out.mode = b.mode as JobMode;
  }
  if (b.planFirst !== undefined) {
    if (typeof b.planFirst !== "boolean") throw new ConnectorError("bad_request", "planFirst is true or false.");
    out.planFirst = b.planFirst;
  }
  return out;
}

export class MemorySettingsStore implements SettingsStore {
  private rows = new Map<string, ProjectSettings>();
  async get(projectId: string) { const r = this.rows.get(projectId); return r ? { ...r } : null; }
  async put(s: ProjectSettings) { this.rows.set(s.projectId, { ...s }); return { ...s }; }
}

interface Row { project_id: string; user_id: string; mode: string; plan_first: boolean | null; updated_at: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rowOf = (r: Row): ProjectSettings => ({
  projectId: r.project_id, userId: r.user_id, mode: r.mode === "freeform" ? "freeform" : "guided", planFirst: r.plan_first === true, updatedAt: Date.parse(r.updated_at) || 0,
});

export class SupabaseSettingsStore implements SettingsStore {
  constructor(private readonly sb: SupabaseClient) {}

  async get(projectId: string) {
    if (!UUID.test(projectId)) return null;
    const res = await this.sb.from("code_project_settings").select("*").eq("project_id", projectId).maybeSingle<Row>();
    if (res.error) throw new Error(`code settings store: ${res.error.message}`);
    return res.data ? rowOf(res.data) : null;
  }
  async put(s: ProjectSettings) {
    if (!UUID.test(s.projectId) || !UUID.test(s.userId)) throw new Error("code settings store: not a project of a signed-in person");
    const res = await this.sb.from("code_project_settings").upsert(
      { project_id: s.projectId, user_id: s.userId, mode: s.mode, plan_first: s.planFirst, updated_at: new Date(s.updatedAt).toISOString() }, { onConflict: "project_id" },
    ).select("*").single<Row>();
    if (res.error) throw new Error(`code settings store: ${res.error.message}`);
    return rowOf(res.data!);
  }
}

let current: SettingsStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function settingsStore(): SettingsStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseSettingsStore(sb) : new MemorySettingsStore();
  }
  return current;
}

export function resetSettingsStoreForTests(): void { current = null; }
