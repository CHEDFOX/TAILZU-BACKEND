/**
 * THE DECISION LOG AND WHAT IT TEACHES (src/front/store.ts, learn.ts, migration 0033):
 *
 *   - the log keeps categories and numbers (never a word), one row a message, an outcome that moves from "ok" to what became of it;
 *   - a person's visual habit: kept raises, closed lowers, from (kept + 2) / (kept + closed + 4), moving the evidence by 0.6 to 1.4 at most;
 *   - the trust in the rules for an intent: a rephrase or a thumbs-down cuts it, a thumbs-up gives some back, by 30% at most, and not
 *     before five messages of that intent; under 0.7 the small model is asked, so the cut sends more of them to it;
 *   - every adjustment says why; a log that cannot be read teaches nothing and breaks nothing;
 *   - the rephrase watch: the same person, a similar message, within 60 seconds, from word hashes that are never the words;
 *   - the Supabase twin speaks the table's columns; the migration is owner-read RLS, safe to run again, and in the whole schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { MemoryFrontStore, SupabaseFrontStore, summarise, frontStore, resetFrontStoreForTests, SUMMARY_ROWS } = await import("../src/front/store.js");
const { Learning, RephraseWatch, habitOf, trustOf, signature, similarity, MAX_CUT, MIN_SAMPLE, REPHRASE_WINDOW_MS, SIMILAR } = await import("../src/front/learn.js");
const { decide } = await import("../src/front/decide.js");
const { buildTierTable } = await import("../src/code/brain/tiers.js");
const { ctx, model, noModel, decideJson } = await import("./front-rig.js");
type Outcome = import("../src/front/types.js").Outcome;
type Intent = import("../src/front/types.js").Intent;

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const tiers = buildTierTable();
const DAY = 24 * 60 * 60 * 1000;

const row = (over: Partial<Parameters<InstanceType<typeof MemoryFrontStore>["add"]>[0]> = {}) => ({
  userId: "alice", at: Date.now(), intent: "answer" as Intent, route: "reply" as const, tier: "cheap" as const, visual: null, confidence: 0.8, costPaise: 5, latencyMs: 300, via: "rules" as const, ...over,
});

describe("the log", () => {
  it("keeps one row a message, with an id, and an outcome of ok until something happens to it", async () => {
    const s = new MemoryFrontStore();
    const first = row({ visual: "table" });
    const id = await s.add(first);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await s.recent("alice")).toEqual([{ ...first, id, outcome: "ok" }]);
    expect(await s.recent("bob")).toEqual([]);
  });

  it("keeps no word: a row has the columns of the table and nothing else", async () => {
    const s = new MemoryFrontStore();
    await s.add({ ...row(), message: "my secret plan", reply: "x" } as never);
    const keys = Object.keys((await s.recent("alice"))[0]!).sort();
    // (the twin spreads what it is given; the route and dispatch only ever give it these)
    expect(keys.filter((k) => !["message", "reply"].includes(k))).toEqual(["at", "confidence", "costPaise", "id", "intent", "latencyMs", "outcome", "route", "tier", "userId", "via", "visual"]);
  });

  it("clamps what it is given: a confidence to 0 to 1, money and time to whole, non-negative numbers", async () => {
    const s = new MemoryFrontStore();
    await s.add(row({ confidence: 7, costPaise: -4.6, latencyMs: Number.NaN }));
    expect((await s.recent("alice"))[0]).toMatchObject({ confidence: 1, costPaise: 0, latencyMs: 0 });
  });

  it("moves an outcome: a person's tap replaces anything, 'rephrased' only replaces 'ok', and nobody sets another person's row", async () => {
    const s = new MemoryFrontStore();
    const id = await s.add(row());
    expect(await s.setOutcome("bob", id, "thumbs_down")).toBe(false);
    expect(await s.setOutcome("alice", "nope", "thumbs_down")).toBe(false);
    expect(await s.setOutcome("alice", id, "rephrased")).toBe(true);
    expect(await s.setOutcome("alice", id, "rephrased")).toBe(false);
    expect(await s.setOutcome("alice", id, "visual_kept")).toBe(true);
    expect(await s.setOutcome("alice", id, "rephrased")).toBe(false);
    expect((await s.recent("alice"))[0]!.outcome).toBe("visual_kept");
    expect(await s.setOutcome("alice", id, "thumbs_up")).toBe(true);
    expect((await s.recent("alice"))[0]!.outcome).toBe("thumbs_up");
  });

  it("summarises the last 30 days and the last 300 rows, by person", async () => {
    const now = 100 * DAY;
    const s = new MemoryFrontStore(() => now);
    await s.add(row({ at: now - 31 * DAY, visual: "table" })).then((id) => s.setOutcome("alice", id, "visual_closed"));
    const kept = await s.add(row({ at: now - DAY, visual: "diagram" }));
    await s.setOutcome("alice", kept, "visual_kept");
    const rephrased = await s.add(row({ at: now - DAY, intent: "research" }));
    await s.setOutcome("alice", rephrased, "rephrased");
    await s.add(row({ userId: "bob" }));
    expect(await s.summary("alice")).toEqual({
      rows: 2, visual: { kept: 1, closed: 0 },
      byIntent: { answer: { n: 1, rephrased: 0, down: 0, up: 0 }, research: { n: 1, rephrased: 1, down: 0, up: 0 } },
    });
    for (let i = 0; i < SUMMARY_ROWS + 20; i += 1) await s.add(row({ at: now - 1000, userId: "carol" }));
    expect((await s.summary("carol")).rows).toBe(SUMMARY_ROWS);
  });

  it("is memory without Supabase, and one per process", async () => {
    resetFrontStoreForTests();
    expect(frontStore()).toBeInstanceOf(MemoryFrontStore);
    expect(frontStore()).toBe(frontStore());
    resetFrontStoreForTests();
  });
});

describe("a person's habit with visuals", () => {
  it("is 0.5 with no history, and moves with what they keep and close, never to 0 or 1", () => {
    const h = (kept: number, closed: number) => habitOf({ visual: { kept, closed } });
    expect(h(0, 0)).toEqual({ value: 0.5, why: "no history" });
    expect(h(8, 0).value).toBeCloseTo(10 / 12, 3);
    expect(h(0, 8).value).toBeCloseTo(2 / 12, 3);
    expect(h(2, 2).value).toBe(0.5);
    expect(h(3, 1).value).toBeGreaterThan(h(2, 2).value);
    expect(h(1, 3).value).toBeLessThan(h(2, 2).value);
    expect(h(1000, 0).value).toBeLessThan(1);
    expect(h(0, 1000).value).toBeGreaterThan(0);
  });

  it("says why, in words a person could read", () => {
    expect(habitOf({ visual: { kept: 7, closed: 1 } }).why).toBe("kept 7 of 8 visuals");
    expect(habitOf({ visual: { kept: 1, closed: 7 } }).why).toBe("closed 7 of 8 visuals");
  });
});

describe("the trust in the rules", () => {
  const stat = (n: number, rephrased: number, down = 0, up = 0) => ({ byIntent: { answer: { n, rephrased, down, up } } });

  it("is full below five messages of the intent, and when answers have held", () => {
    expect(MIN_SAMPLE).toBe(5);
    expect(trustOf(stat(4, 4), "answer")).toEqual({ factor: 1, why: "not enough history" });
    expect(trustOf(stat(40, 0), "answer").factor).toBe(1);
    expect(trustOf({ byIntent: {} }, "design")).toEqual({ factor: 1, why: "not enough history" });
    expect(trustOf(stat(40, 1), "answer").factor).toBe(1);
  });

  it("is cut by rephrases and thumbs-downs, a little at a time, and never by more than 30%", () => {
    const f = (n: number, r: number, d = 0, u = 0) => trustOf(stat(n, r, d, u), "answer").factor;
    expect(f(10, 3)).toBeLessThan(1);
    expect(f(10, 5)).toBeLessThan(f(10, 3));
    expect(f(10, 5, 2)).toBeLessThan(f(10, 5));
    expect(f(20, 20)).toBe(1 - MAX_CUT);
    expect(f(100, 100, 100)).toBe(0.7);
    // a thumbs-up gives some of it back
    expect(f(10, 5, 0, 4)).toBeGreaterThan(f(10, 5));
  });

  it("says why", () => {
    expect(trustOf(stat(10, 3, 1), "answer").why).toBe("4 of 10 answer messages were rephrased or marked down");
  });
});

describe("what the learning reads", () => {
  it("reads the log once a minute per person, and a tap is felt at the next message", async () => {
    let t = 0;
    let reads = 0;
    const base = new MemoryFrontStore(() => t);
    const store = { ...base, add: base.add.bind(base), setOutcome: base.setOutcome.bind(base), recent: base.recent.bind(base), summary: async (u: string, n?: number) => { reads += 1; return base.summary(u, n); } };
    const l = new Learning(store as never, { now: () => t });
    await l.habit("alice");
    await l.trust("alice", "answer");
    expect(reads).toBe(1);
    t += 61_000;
    await l.habit("alice");
    expect(reads).toBe(2);
    l.forget("alice");
    await l.habit("alice");
    expect(reads).toBe(3);
  });

  it("knows nothing, and breaks nothing, when the log cannot be read", async () => {
    const down = { add: async () => "x", setOutcome: async () => false, recent: async () => [], summary: async () => { throw new Error("db down"); } };
    const l = new Learning(down as never);
    expect(await l.habit("alice")).toEqual({ value: 0.5, why: "no history" });
    expect(await l.trust("alice", "answer")).toEqual({ factor: 1, why: "not enough history" });
  });
});

describe("the learning, in a decision", () => {
  /** A person with a history of `n` messages of an intent, `bad` of which were rephrased, and `kept`/`closed` visuals. */
  async function history(o: { answers?: number; rephrased?: number; kept?: number; closed?: number } = {}) {
    const store = new MemoryFrontStore();
    for (let i = 0; i < (o.answers ?? 0); i += 1) {
      const id = await store.add(row());
      if (i < (o.rephrased ?? 0)) await store.setOutcome("alice", id, "rephrased");
    }
    for (let i = 0; i < (o.kept ?? 0); i += 1) await store.setOutcome("alice", await store.add(row({ visual: "diagram" })), "visual_kept");
    for (let i = 0; i < (o.closed ?? 0); i += 1) await store.setOutcome("alice", await store.add(row({ visual: "diagram" })), "visual_closed");
    return new Learning(store);
  }

  it("asks the small model about a kind of message the rules keep getting wrong for this person, though the rules were sure", async () => {
    const m = noModel();
    const message = "what is the capital of France?";
    const fresh = await decide(message, ctx(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000, learning: await history() });
    expect(fresh).toMatchObject({ via: "rules", confidence: 0.95 });
    // 12 answers, 8 of them rephrased: the rules' 0.95 is cut to under 0.7
    const asked = model(() => decideJson({ intent: "answer", length: "short", confidence: 0.9 }));
    const doubted = await decide(message, ctx(), { call: asked.call, tiers, fx: 88, jobBudgetPaise: 3000, learning: await history({ answers: 12, rephrased: 8 }) });
    expect(asked.sent).toHaveLength(1);
    expect(doubted.via).toBe("model");
    expect(doubted.reasons.some((r) => r.startsWith("trust:8 of 12 answer messages were rephrased"))).toBe(true);
    expect(asked.sent[0]!.user).toContain("The rules read it as: answer (");
  });

  it("cuts only the intent that has been going wrong", async () => {
    const m = noModel();
    const learning = await history({ answers: 12, rephrased: 12 });
    const d = await decide("hi", ctx(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000, learning });
    expect(d).toMatchObject({ intent: "chat", via: "rules", confidence: 0.92 });
  });

  it("shows fewer visuals to a person who closes them, and more to one who keeps them, and says so", async () => {
    const message = "explain how OAuth works";
    const run = (learning: InstanceType<typeof Learning>) => decide(message, ctx(), { call: noModel().call, tiers, fx: 88, jobBudgetPaise: 3000, learning });
    const closer = await run(await history({ closed: 9 }));
    const keeper = await run(await history({ kept: 9 }));
    const nobody = await run(await history());
    // "how X works" is weak evidence for a diagram (0.62 against the bar of 0.5)
    expect(nobody.shape.visual?.kind ?? null).toBe(null);
    const long = (learning: InstanceType<typeof Learning>) => decide("how does OAuth work, explained in detail", ctx(), { call: noModel().call, tiers, fx: 88, jobBudgetPaise: 3000, learning });
    expect((await long(await history({ closed: 9 }))).shape.visual).toBeNull();
    expect((await long(await history({ kept: 9 }))).shape.visual?.kind).toBe("diagram");
    expect((await long(await history())).shape.visual?.kind).toBe("diagram");
    const why = (await long(await history({ closed: 9 }))).reasons.find((r) => r.startsWith("visual:habit:"));
    expect(why).toBe("visual:habit:closed 9 of 9 visuals");
    expect(closer.shape.visual).toBeNull();
    expect(keeper.shape.visual).toBeNull();
  });

  it("never holds back what was asked for, however many they have closed", async () => {
    const learning = await history({ closed: 30 });
    const d = await decide("draw a diagram of how OAuth works", ctx(), { call: noModel().call, tiers, fx: 88, jobBudgetPaise: 3000, learning });
    expect(d.shape.visual).toMatchObject({ kind: "diagram", asked: true });
  });

  it("is small: a person who has closed everything is shown a clear comparison still", async () => {
    const d = await decide("compare Postgres vs MySQL for a small online shop", ctx(), { call: noModel().call, tiers, fx: 88, jobBudgetPaise: 3000, learning: await history({ closed: 40 }) });
    expect(d.shape.visual?.kind).toBe("table");
  });
});

describe("the rephrase watch", () => {
  it("hashes a message into words nobody can read back, without the little words", () => {
    const a = signature("What is the best way to learn Python?");
    expect([...a].every((h) => /^[0-9a-f]{8}$/.test(h))).toBe(true);
    expect(a.size).toBe(5); // what, best, way, learn, python (is, the, to are little)
    expect(signature("")).toEqual(new Set());
    expect(signature("पायथन सीखने का तरीका").size).toBeGreaterThan(2);
  });

  it("is how much of the shorter message the other shares", () => {
    expect(SIMILAR).toBe(0.5);
    expect(similarity(signature("learn python quickly"), signature("how can I learn python quickly"))).toBe(1);
    expect(similarity(signature("learn python"), signature("cook rice at home"))).toBe(0);
    expect(similarity(new Set(), signature("a b c"))).toBe(0);
  });

  it("names the person's previous message when a similar one follows within 60 seconds, and only theirs", () => {
    let t = 0;
    const w = new RephraseWatch(() => t);
    expect(REPHRASE_WINDOW_MS).toBe(60_000);
    expect(w.check("alice", "learn python quickly")).toBeNull();
    w.remember("alice", "row-1", "learn python quickly");
    t += 30_000;
    expect(w.check("alice", "how can I learn python quickly?")).toBe("row-1");
    expect(w.check("bob", "how can I learn python quickly?")).toBeNull();
    expect(w.check("alice", "what is the capital of France?")).toBeNull();
    t += 30_001;
    expect(w.check("alice", "how can I learn python quickly?")).toBeNull();
  });
});

// ------------------------------------------------------------------ supabase

type Call = [string, unknown[]];
/** A query builder that writes down what it is asked and answers with `result`. */
function stub(result: unknown) {
  const log: Call[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["from", "insert", "update", "select", "eq", "gte", "order", "limit", "single", "returns"]) q[m] = (...args: unknown[]) => { log.push([m, args]); return q; };
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return { sb: q as never, log };
}

describe("the Supabase twin", () => {
  it("writes the table's columns, and gives back the id", async () => {
    const t = stub({ data: { id: "uuid-1" }, error: null });
    const id = await new SupabaseFrontStore(t.sb).add(row({ at: Date.UTC(2026, 9, 27), visual: "table" }));
    expect(id).toBe("uuid-1");
    expect(t.log.find(([m]) => m === "from")![1]).toEqual(["front_decisions"]);
    expect(t.log.find(([m]) => m === "insert")![1][0]).toEqual({
      user_id: "alice", at: "2026-10-27T00:00:00.000Z", intent: "answer", route: "reply", tier: "cheap", visual: "table", confidence: 0.8, cost_paise: 5, latency_ms: 300, outcome: "ok", via: "rules",
    });
  });

  it("sets an outcome on the person's own row only, and 'rephrased' only on one that is still ok", async () => {
    const t = stub({ data: [{ id: "x" }], error: null });
    expect(await new SupabaseFrontStore(t.sb).setOutcome("alice", "x", "rephrased")).toBe(true);
    expect(t.log.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["id", "x"], ["user_id", "alice"], ["outcome", "ok"]]);
    const tap = stub({ data: [{ id: "x" }], error: null });
    await new SupabaseFrontStore(tap.sb).setOutcome("alice", "x", "thumbs_up");
    expect(tap.log.filter(([m]) => m === "eq").map(([, a]) => a)).toEqual([["id", "x"], ["user_id", "alice"]]);
    const none = stub({ data: [], error: null });
    expect(await new SupabaseFrontStore(none.sb).setOutcome("alice", "x", "thumbs_up")).toBe(false);
  });

  it("reads the last 30 days and 300 rows for the summary, and says in words that it could not", async () => {
    const t = stub({ data: [{ intent: "answer", visual: "table", outcome: "visual_kept" }, { intent: "weird", visual: null, outcome: "ok" }], error: null });
    const s = await new SupabaseFrontStore(t.sb).summary("alice", 40 * DAY);
    expect(s).toMatchObject({ rows: 2, visual: { kept: 1, closed: 0 }, byIntent: { answer: { n: 1 }, unclear: { n: 1 } } });
    expect(t.log.find(([m]) => m === "gte")![1]).toEqual(["at", new Date(10 * DAY).toISOString()]);
    expect(t.log.find(([m]) => m === "limit")![1]).toEqual([300]);
    const bad = stub({ data: null, error: { message: "relation does not exist" } });
    await expect(new SupabaseFrontStore(bad.sb).summary("alice")).rejects.toThrow(/front store: relation does not exist/);
    await expect(new SupabaseFrontStore(bad.sb).add(row())).rejects.toThrow(/front store/);
  });

  it("reads a person's latest rows back as rows", async () => {
    const t = stub({ data: [{ id: "i", user_id: "alice", at: "2026-10-27T00:00:00Z", intent: "design", route: "artifact", tier: "code", visual: "component", confidence: 0.8, cost_paise: 90, latency_ms: 4000, outcome: "visual_kept", via: "model" }], error: null });
    expect(await new SupabaseFrontStore(t.sb).recent("alice", 5)).toEqual([
      { id: "i", userId: "alice", at: Date.UTC(2026, 9, 27), intent: "design", route: "artifact", tier: "code", visual: "component", confidence: 0.8, costPaise: 90, latencyMs: 4000, outcome: "visual_kept", via: "model" },
    ]);
  });

  it("summarise() counts the same way the twin does", () => {
    const rows = [{ intent: "answer", visual: null, outcome: "thumbs_down" }, { intent: "answer", visual: null, outcome: "thumbs_up" }, { intent: "plan", visual: "diagram", outcome: "visual_closed" }] as { intent: Intent; visual: null; outcome: Outcome }[];
    expect(summarise(rows as never)).toEqual({ rows: 3, visual: { kept: 0, closed: 1 }, byIntent: { answer: { n: 2, rephrased: 0, down: 1, up: 1 }, plan: { n: 1, rephrased: 0, down: 0, up: 0 } } });
  });
});

// ------------------------------------------------------------------ the migration

describe("migration 0033_front_decisions.sql", () => {
  const migration = readFileSync(join(dir, "supabase", "migrations", "0033_front_decisions.sql"), "utf8");
  const full = readFileSync(join(dir, "supabase", "full_schema.sql"), "utf8");

  it("follows 0032 in the migrations folder", () => {
    const names = readdirSync(join(dir, "supabase", "migrations")).sort();
    const at = names.indexOf("0033_front_decisions.sql");
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe("0032_artifacts.sql");
    expect(names.at(-1)).toBe("0033_front_decisions.sql");
  });

  it("makes the table with the columns the store reads and writes, and the lists the code's own", async () => {
    const { INTENTS, ROUTES, OUTCOMES, VISUAL_KINDS } = await import("../src/front/types.js");
    const { MODEL_TIERS } = await import("../src/code/brain/tiers.js");
    expect(migration).toMatch(/create table if not exists public\.front_decisions/);
    for (const col of ["id", "user_id", "at", "intent", "route", "tier", "visual", "confidence", "cost_paise", "latency_ms", "outcome", "via"]) expect(migration, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(migration).toMatch(/user_id\s+uuid not null references auth\.users \(id\) on delete cascade/);
    const list = (name: string) => new RegExp(`${name}\\s+text[^\\n]*in \\(([^)]*)\\)`).exec(migration)![1]!.split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(list("intent")).toEqual([...INTENTS]);
    expect(list("route")).toEqual([...ROUTES]);
    expect(list("tier")).toEqual([...MODEL_TIERS]);
    expect(list("outcome")).toEqual([...OUTCOMES]);
    expect(list("visual")).toEqual([...VISUAL_KINDS]);
    expect(migration).toMatch(/via\s+text not null default 'rules' check \(via in \('rules', 'model'\)\)/);
  });

  it("is owner-read: row-level security on, one select policy for the person's own rows, no policy that lets a token write", () => {
    expect(migration).toMatch(/alter table public\.front_decisions enable row level security/);
    const policies = migration.match(/create policy[^;]*;/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select\s+using \(auth\.uid\(\) = user_id\)/);
    expect(migration).not.toMatch(/for (insert|update|delete|all)/i);
  });

  it("can be run again: every statement is guarded", () => {
    const statements = migration.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
    for (const st of statements) {
      if (/^create table/i.test(st)) expect(st).toMatch(/if not exists/i);
      if (/^create index/i.test(st)) expect(st).toMatch(/if not exists/i);
      if (/^create policy/i.test(st)) expect(statements[statements.indexOf(st) - 1]).toMatch(/^drop policy if exists/i);
    }
  });

  it("is in full_schema.sql, under its own heading, after 0032, last, and the same text", () => {
    expect(full).toContain("-- 0033_front_decisions.sql");
    expect(full.indexOf("-- 0033_front_decisions.sql")).toBeGreaterThan(full.indexOf("-- 0032_artifacts.sql"));
    expect(full).toContain(migration.trim());
    expect(full.endsWith(migration)).toBe(true);
    expect(full.match(/create table if not exists public\.front_decisions/g)).toHaveLength(1);
  });

  it("goes with the account: the delete clears it with the other tables", () => {
    const server = readFileSync(join(dir, "src", "server.ts"), "utf8");
    expect(server).toContain('["front_decisions", null]');
  });
});
