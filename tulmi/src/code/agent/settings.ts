/**
 * HOW A PROJECT'S JOBS ARE WORKED, AS THE PERSON SET IT: THE MODE, AND "ALWAYS SHOW ME THE PLAN FIRST".
 *
 *   mode        "freeform" (the default: the model decides the order of explore, change and run, with the locate funnel as a tool and hints) or "guided"
 *               (locate, plan, work on the planned files, verify, commit). CODE_JOB_MODE changes the server's default; this makes every job of the project so
 *   planFirst   every task's plan goes to the person for a yes before any work, in either mode (a guided job always planned; a free-form job plans only for this)
 *   team        lead and helpers (code/team, docs/code-team.md): "auto" (a plan over 12 files or 3 features becomes a team's work), "on" (always) or "off" (never)
 *
 * One row for each project (migration 0034, code_project_settings), behind one interface with a memory twin, as the other stores are. A job's own request
 * ({ mode, planFirst } on POST /v1/code/jobs, or the front door's decision) beats the project's setting; the project's beats the default.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import { ConnectorError } from "../../connectors/state.js";
import { TEAM_MODES, type TeamMode } from "../team/types.js";
import { getConfig } from "../../config.js";
import { JOB_MODES, JOB_MODE_DEFAULT, type JobMode } from "./types.js";

export interface ProjectSettings {
  projectId: string;
  userId: string;
  mode: JobMode;
  planFirst: boolean;
  team: TeamMode;
  updatedAt: number;
}

/** What a project that never set anything has. Its mode is the server's default (defaultJobMode): free-form unless CODE_JOB_MODE says guided. */
export const DEFAULT_PROJECT_SETTINGS = { mode: JOB_MODE_DEFAULT, planFirst: false, team: "auto" } as const satisfies Pick<ProjectSettings, "mode" | "planFirst" | "team">;

/** How a new job is worked when neither the job nor its project says: the agent's own setting (a harness's), else CODE_JOB_MODE, else free-form. */
export function defaultJobMode(over?: JobMode): JobMode {
  return over ?? getConfig().CODE_JOB_MODE ?? JOB_MODE_DEFAULT;
}

export interface SettingsStore {
  /** The project's settings; the defaults (guided, no plan first) when the person never set any. */
  get(projectId: string): Promise<ProjectSettings | null>;
  put(s: ProjectSettings): Promise<ProjectSettings>;
}

/** A settings body, checked: each field optional, a wrong kind is refused with a sentence. */
export function readSettingsPatch(body: unknown): { mode?: JobMode; planFirst?: boolean; team?: TeamMode } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const out: { mode?: JobMode; planFirst?: boolean; team?: TeamMode } = {};
  if (b.mode !== undefined) {
    if (typeof b.mode !== "string" || !(JOB_MODES as readonly string[]).includes(b.mode)) throw new ConnectorError("bad_request", `mode is ${JOB_MODES.map((m) => `"${m}"`).join(" or ")}.`);
    out.mode = b.mode as JobMode;
  }
  if (b.planFirst !== undefined) {
    if (typeof b.planFirst !== "boolean") throw new ConnectorError("bad_request", "planFirst is true or false.");
    out.planFirst = b.planFirst;
  }
  if (b.team !== undefined) {
    if (typeof b.team !== "string" || !(TEAM_MODES as readonly string[]).includes(b.team)) throw new ConnectorError("bad_request", `team is ${TEAM_MODES.map((m) => `"${m}"`).join(", ")}.`);
    out.team = b.team as TeamMode;
  }
  return out;
}

export class MemorySettingsStore implements SettingsStore {
  private rows = new Map<string, ProjectSettings>();
  async get(projectId: string) { const r = this.rows.get(projectId); return r ? { ...r } : null; }
  async put(s: ProjectSettings) { this.rows.set(s.projectId, { ...s }); return { ...s }; }
}

interface Row { project_id: string; user_id: string; mode: string; plan_first: boolean | null; team?: string | null; updated_at: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rowOf = (r: Row): ProjectSettings => ({
  projectId: r.project_id, userId: r.user_id, mode: r.mode === "freeform" ? "freeform" : "guided", planFirst: r.plan_first === true,
  team: r.team === "on" || r.team === "off" ? r.team : "auto", updatedAt: Date.parse(r.updated_at) || 0,
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
    const row = { project_id: s.projectId, user_id: s.userId, mode: s.mode, plan_first: s.planFirst, updated_at: new Date(s.updatedAt).toISOString() };
    let res = await this.sb.from("code_project_settings").upsert({ ...row, team: s.team }, { onConflict: "project_id" }).select("*").single<Row>();
    // Migration 0037 adds the team column. Until it is run, the other settings are still kept (as they were before it), and "auto" is what a project has.
    if (res.error && /\bteam\b/i.test(res.error.message)) {
      if (s.team !== "auto") throw new Error("code settings store: migration 0037 has not been run, so the team setting cannot be kept");
      res = await this.sb.from("code_project_settings").upsert(row, { onConflict: "project_id" }).select("*").single<Row>();
    }
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
