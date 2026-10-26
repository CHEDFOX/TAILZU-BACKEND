/**
 * WHAT THE ROUTER LEARNS (src/code/brain/stats.ts, migration 0025): the record
 * of how each model does at each kind of step.
 *
 * What these hold down:
 *   - an outcome adds to its row: successes or failures, paise, milliseconds,
 *     one row per (task type, step, model), the memory twin and the Supabase
 *     twin held to the same script;
 *   - recordOutcome never throws, and says so when it could not write;
 *   - the Supabase twin adds in one call (the SQL function) and reads one kind
 *     of step at a time;
 *   - the migration: the table, row-level security with NO policy, the function
 *     closed to everyone but the service key, and the same text in full_schema.sql.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { MemoryRouteStatsStore, SupabaseRouteStatsStore, lookupOf, paisePerTry, preferredModel, recordOutcome, resetRouteStatsForTests, routeStats, samplesOf } =
  await import("../src/code/brain/stats.js");
type RouteStatsStore = import("../src/code/brain/stats.js").RouteStatsStore;

const here = dirname(fileURLToPath(import.meta.url));
const supabaseDir = join(here, "..", "supabase");

/**
 * A Supabase client that keeps code_route_stats in memory and answers what the store asks of it the way Postgres would:
 * the select with its two filters, and the rpc that adds an outcome in one statement.
 */
function fakeSupabase(o: { rpcError?: string; selectError?: string } = {}) {
  const rows = new Map<string, Record<string, any>>();
  const rpcCalls: Array<{ fn: string; args: Record<string, any> }> = [];
  const sb = {
    rows, rpcCalls,
    rpc: async (fn: string, args: Record<string, any>) => {
      rpcCalls.push({ fn, args });
      if (o.rpcError) return { data: null, error: { message: o.rpcError } };
      if (fn !== "code_record_route_outcome") return { data: null, error: { message: "no such function" } };
      const k = `${args.p_task_type}|${args.p_step}|${args.p_model}`;
      const cur = rows.get(k) ?? { task_type: args.p_task_type, step: args.p_step, model: args.p_model, successes: 0, failures: 0, paise_total: 0, ms_total: 0 };
      rows.set(k, {
        ...cur,
        successes: cur.successes + (args.p_success ? 1 : 0), failures: cur.failures + (args.p_success ? 0 : 1),
        paise_total: cur.paise_total + Math.max(args.p_paise, 0), ms_total: cur.ms_total + Math.max(args.p_ms, 0),
        updated_at: "2026-10-26T10:00:00.000Z",
      });
      return { data: null, error: null };
    },
    from: (table: string) => {
      const where: Array<[string, unknown]> = [];
      const b: any = {
        select: () => b,
        eq: (col: string, v: unknown) => { where.push([col, v]); return b; },
        returns: () => b,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(() => {
          if (table !== "code_route_stats") return { data: null, error: { message: `no table ${table}` } };
          if (o.selectError) return { data: null, error: { message: o.selectError } };
          return { data: [...rows.values()].filter((r) => where.every(([c, v]) => r[c] === v)).map((r) => ({ ...r })), error: null };
        }).then(ok, ko),
      };
      return b;
    },
  };
  return sb;
}

/** The same script for both twins. */
function script(name: string, make: () => RouteStatsStore) {
  describe(name, () => {
    it("adds an outcome to its row: a success, a failure, the paise and the milliseconds", async () => {
      const s = make();
      await s.record({ taskType: "feature", step: "write_code", model: "a/one", success: true, paise: 12, ms: 3000 });
      await s.record({ taskType: "feature", step: "write_code", model: "a/one", success: true, paise: 8, ms: 1000 });
      await s.record({ taskType: "feature", step: "write_code", model: "a/one", success: false, paise: 30, ms: 500 });
      const [row] = await s.list("feature", "write_code");
      expect(row).toMatchObject({ taskType: "feature", step: "write_code", model: "a/one", successes: 2, failures: 1, paiseTotal: 50, msTotal: 4500 });
      expect(samplesOf(row!)).toBe(3);
      expect(paisePerTry(row!)).toBeCloseTo(50 / 3, 10);
      expect(row!.updatedAt).toBeGreaterThan(0);
    });

    it("keeps one row for each model, step and kind of request, and lists one kind of step at a time", async () => {
      const s = make();
      await s.record({ taskType: "feature", step: "write_code", model: "a/one", success: true });
      await s.record({ taskType: "feature", step: "write_code", model: "b/two", success: false });
      await s.record({ taskType: "feature", step: "plan", model: "a/one", success: true });
      await s.record({ taskType: "bug_fix", step: "write_code", model: "a/one", success: true });
      expect((await s.list("feature", "write_code")).map((r) => r.model).sort()).toEqual(["a/one", "b/two"]);
      expect(await s.list("feature", "plan")).toHaveLength(1);
      expect(await s.list("bug_fix", "write_code")).toHaveLength(1);
      expect(await s.list("question", "review")).toEqual([]);
    });

    it("counts only whole, non-negative paise and milliseconds, and treats none as zero", async () => {
      const s = make();
      await s.record({ taskType: "t", step: "s", model: "m/x", success: true, paise: 2.6, ms: -5 });
      await s.record({ taskType: "t", step: "s", model: "m/x", success: true, paise: Number.NaN });
      await s.record({ taskType: "t", step: "s", model: "m/x", success: true });
      expect((await s.list("t", "s"))[0]).toMatchObject({ successes: 3, paiseTotal: 3, msTotal: 0 });
    });

    it("counts two outcomes that arrive together", async () => {
      const s = make();
      await Promise.all(Array.from({ length: 25 }, (_, i) => s.record({ taskType: "t", step: "s", model: "m/x", success: i % 5 !== 0, paise: 1 })));
      expect((await s.list("t", "s"))[0]).toMatchObject({ successes: 20, failures: 5, paiseTotal: 25 });
    });

    it("feeds the router's lookup", async () => {
      const s = make();
      for (let i = 0; i < 20; i += 1) await s.record({ taskType: "feature", step: "write_code", model: "a/one", success: true, paise: 4 });
      const lookup = lookupOf(await s.list("feature", "write_code"));
      expect(lookup("feature", "write_code", "a/one")?.successes).toBe(20);
      expect(lookup("feature", "write_code", "zzz")).toBeUndefined();
      expect(preferredModel(["b/two", "a/one"], "feature", "write_code", lookup)).toBe("a/one");
    });
  });
}

script("the memory twin", () => new MemoryRouteStatsStore());
script("the Supabase twin", () => new SupabaseRouteStatsStore(fakeSupabase() as never));

describe("the Supabase twin", () => {
  it("adds through the SQL function in one call, with the outcome's numbers", async () => {
    const sb = fakeSupabase();
    await new SupabaseRouteStatsStore(sb as never).record({ taskType: "bug_fix", step: "review", model: "google/gemini-2.5-flash", success: false, paise: 7, ms: 900 });
    expect(sb.rpcCalls).toEqual([{
      fn: "code_record_route_outcome",
      args: { p_task_type: "bug_fix", p_step: "review", p_model: "google/gemini-2.5-flash", p_success: false, p_paise: 7, p_ms: 900 },
    }]);
  });

  it("throws what the database said, for recordOutcome to hear", async () => {
    await expect(new SupabaseRouteStatsStore(fakeSupabase({ rpcError: "function does not exist" }) as never).record({ taskType: "t", step: "s", model: "m", success: true }))
      .rejects.toThrow(/function does not exist/);
    await expect(new SupabaseRouteStatsStore(fakeSupabase({ selectError: "relation missing" }) as never).list("t", "s")).rejects.toThrow(/relation missing/);
  });

  it("reads the big counts Postgres sends as strings", async () => {
    const sb = fakeSupabase();
    sb.rows.set("t|s|m", { task_type: "t", step: "s", model: "m", successes: 3, failures: 1, paise_total: "12345678901", ms_total: "99", updated_at: "2026-10-26T10:00:00.000Z" });
    expect((await new SupabaseRouteStatsStore(sb as never).list("t", "s"))[0]).toMatchObject({ paiseTotal: 12345678901, msTotal: 99, updatedAt: Date.parse("2026-10-26T10:00:00.000Z") });
  });
});

describe("recordOutcome", () => {
  it("writes to the store it is given", async () => {
    const store = new MemoryRouteStatsStore();
    await recordOutcome({ taskType: "feature", step: "write_code", model: "a/one", success: true, paise: 5, ms: 10 }, { store });
    expect(await store.list("feature", "write_code")).toHaveLength(1);
  });

  it("never throws, and says it could not write", async () => {
    const warnings: Array<[object, string]> = [];
    const broken: RouteStatsStore = { record: async () => { throw new Error("db down: secret detail"); }, list: async () => [] };
    await expect(recordOutcome({ taskType: "t", step: "s", model: "m", success: true }, { store: broken, log: { warn: (o, m) => warnings.push([o, m]) } })).resolves.toBeUndefined();
    expect(warnings).toEqual([[{ error: "Error" }, "code brain: outcome not recorded"]]);
    expect(JSON.stringify(warnings)).not.toContain("secret detail");
  });

  it("goes to the memory twin when there is no Supabase (tests, local runs)", async () => {
    resetRouteStatsForTests();
    expect(routeStats()).toBeInstanceOf(MemoryRouteStatsStore);
    expect(routeStats()).toBe(routeStats());
    await recordOutcome({ taskType: "t", step: "s", model: "m", success: true });
    expect(await routeStats().list("t", "s")).toHaveLength(1);
    resetRouteStatsForTests();
    expect(await routeStats().list("t", "s")).toEqual([]);
  });
});

describe("migration 0025_code_route_stats.sql", () => {
  const migration = readFileSync(join(supabaseDir, "migrations", "0025_code_route_stats.sql"), "utf8");
  const full = readFileSync(join(supabaseDir, "full_schema.sql"), "utf8");

  it("follows 0024 in the migrations folder", () => {
    const names = readdirSync(join(supabaseDir, "migrations")).sort();
    const at = names.indexOf("0025_code_route_stats.sql");
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe("0024_code_github_actions.sql");
  });

  it("makes the table with the columns the store reads and writes, one row to a (task type, step, model)", () => {
    expect(migration).toMatch(/create table if not exists public\.code_route_stats/);
    for (const col of ["task_type", "step", "model", "successes", "failures", "paise_total", "ms_total", "updated_at"]) {
      expect(migration, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(migration).toMatch(/primary key \(task_type, step, model\)/);
  });

  it("is service-only: row-level security on, no policy at all, and the function closed to everyone but the service role", () => {
    expect(migration).toMatch(/alter table public\.code_route_stats enable row level security/);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toMatch(/revoke all on function public\.code_record_route_outcome\(.*\) from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.code_record_route_outcome\(.*\) to service_role/);
    expect(migration).toMatch(/create or replace function public\.code_record_route_outcome/);
  });

  it("can be run again: every statement is guarded", () => {
    const statements = migration.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
    for (const st of statements) {
      if (/^create table/i.test(st)) expect(st).toMatch(/if not exists/i);
      if (/^create (or replace )?function/i.test(st)) expect(st).toMatch(/or replace/i);
    }
  });

  it("is in full_schema.sql, under its own heading, after 0024, and row for row the same text", () => {
    expect(full).toContain("-- 0025_code_route_stats.sql");
    expect(full.indexOf("-- 0025_code_route_stats.sql")).toBeGreaterThan(full.indexOf("-- 0024_code_github_actions.sql"));
    expect(full).toContain(migration.trim());
    expect(full.match(/create table if not exists public\.code_route_stats/g)).toHaveLength(1);
  });
});
