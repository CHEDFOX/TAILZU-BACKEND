/**
 * THE CODE BOT'S PROJECT RULES THAT THE BOTS APP KEEPS (migration 0044, bots_code_rules): the spend cap per job a
 * person sets on bots.code.rules. Every job the app starts in that project carries it as its budget (POST /v1/code/jobs
 * budgetPaise), so the job stops and asks before going over. The rest of a project's rules are the policy's own grants.
 *
 * Supabase when the service client exists, else memory (tests, local runs), like the other code stores.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** The cap when the person has set none: the server's default job budget is what a job gets then. */
export const CAP_STEP_PAISE = 1000;
export const CAP_MIN_PAISE = 1000;
export const CAP_MAX_PAISE = 50_000;

export const clampCap = (p: number): number =>
  Math.min(CAP_MAX_PAISE, Math.max(CAP_MIN_PAISE, Math.round(p / CAP_STEP_PAISE) * CAP_STEP_PAISE));

export interface CodeRulesStore {
  /** The cap the person set for a project, or null. */
  cap(userId: string, projectId: string): Promise<number | null>;
  setCap(userId: string, projectId: string, paise: number): Promise<number>;
}

export class MemoryCodeRulesStore implements CodeRulesStore {
  private caps = new Map<string, number>();
  async cap(userId: string, projectId: string) { return this.caps.get(`${userId}|${projectId}`) ?? null; }
  async setCap(userId: string, projectId: string, paise: number) {
    const v = clampCap(paise);
    this.caps.set(`${userId}|${projectId}`, v);
    return v;
  }
}

interface Row { job_cap_paise: number }

export class SupabaseCodeRulesStore implements CodeRulesStore {
  constructor(private readonly sb: SupabaseClient) {}
  async cap(userId: string, projectId: string) {
    const r = await this.sb.from("bots_code_rules").select("job_cap_paise").eq("user_id", userId).eq("project_id", projectId).maybeSingle<Row>();
    if (r.error) throw new Error(`bots code rules: ${r.error.message}`);
    return r.data ? Number(r.data.job_cap_paise) : null;
  }
  async setCap(userId: string, projectId: string, paise: number) {
    const v = clampCap(paise);
    const r = await this.sb.from("bots_code_rules").upsert(
      { user_id: userId, project_id: projectId, job_cap_paise: v, updated_at: new Date().toISOString() },
      { onConflict: "user_id,project_id" },
    );
    if (r.error) throw new Error(`bots code rules: ${r.error.message}`);
    return v;
  }
}

let current: CodeRulesStore | null = null;

export function codeRulesStore(): CodeRulesStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseCodeRulesStore(sb) : new MemoryCodeRulesStore();
  }
  return current;
}

/** Tests: a fresh memory store. */
export function resetCodeRulesStoreForTests(s: CodeRulesStore = new MemoryCodeRulesStore()): void { current = s; }
