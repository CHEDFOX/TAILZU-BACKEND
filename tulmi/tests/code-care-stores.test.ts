/**
 * THE STORES MIGRATION 0034 ADDS (code_chat_threads, code_project_settings, code_job_checkpoints, code_pr_care), EACH BEHIND ONE INTERFACE WITH A MEMORY TWIN:
 * the twin and the Supabase one do the same thing, the process's own is memory when there is no service client, and the migration says what the code relies on.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
noNetwork();

const { fakeSupabase } = await import("./work-fixtures.js");
const chat = await import("../src/code/chat/threads.js");
const settings = await import("../src/code/agent/settings.js");
const rewind = await import("../src/code/agent/rewind.js");
const care = await import("../src/code/prcare/store.js");
const { REWIND_KEEP, REWIND_CHARS_MAX } = await import("../src/code/agent/types.js");
const { emptyState } = await import("../src/code/prcare/types.js");

const U = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const J = "55555555-5555-4555-8555-555555555555";
const T = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  chat.resetThreadStoreForTests();
  settings.resetSettingsStoreForTests();
  rewind.resetRewindStoreForTests();
  care.resetCareStoreForTests();
});

describe("the process's own stores", () => {
  it("are memory when there is no service client, and the same one each time", () => {
    expect(chat.threadStore()).toBeInstanceOf(chat.MemoryThreadStore);
    expect(chat.threadStore()).toBe(chat.threadStore());
    expect(settings.settingsStore()).toBeInstanceOf(settings.MemorySettingsStore);
    expect(rewind.rewindStore()).toBeInstanceOf(rewind.MemoryRewindStore);
    expect(care.careStore()).toBeInstanceOf(care.MemoryCareStore);
  });
});

describe.each([
  ["memory", () => new chat.MemoryThreadStore()],
  ["supabase", () => new chat.SupabaseThreadStore(fakeSupabase({ tables: ["code_chat_threads"] }) as never)],
])("the chat thread store (%s)", (_n, make) => {
  const thread = (over: Partial<import("../src/code/chat/threads.js").ChatThread> = {}) => ({
    id: T, userId: U, projectId: P, summary: "- how does login work (src/auth/session.ts)", turns: 1, lastQuestion: "how does login work", lastCites: ["src/auth/session.ts:14"],
    lastLocated: null, history: [{ q: "how does login work", a: "In src/auth/session.ts:14.", at: 2 }], createdAt: 1, updatedAt: 2, ...over,
  });

  it("keeps a thread for the person and the project that made it, and for nobody else", async () => {
    const s = make();
    await s.put(thread());
    expect(await s.get(U, P, T)).toMatchObject({
      summary: "- how does login work (src/auth/session.ts)", lastCites: ["src/auth/session.ts:14"], history: [{ q: "how does login work", a: "In src/auth/session.ts:14.", at: 2 }],
    });
    expect(await s.get(U2, P, T)).toBeNull();
    expect(await s.get(U, P2, T)).toBeNull();
    expect(await s.get(U, P, "not-an-id")).toBeNull();
  });

  it("replaces a thread by its id, lists a project's newest first, and deletes only the owner's", async () => {
    const s = make();
    await s.put(thread());
    await s.put(thread({ summary: "more", turns: 2, updatedAt: 5 }));
    expect((await s.get(U, P, T))!.turns).toBe(2);
    expect(await s.list(U, P)).toHaveLength(1);
    expect(await s.delete(U2, P, T)).toBe(false);
    expect(await s.delete(U, P, T)).toBe(true);
    expect(await s.get(U, P, T)).toBeNull();
  });
});

describe("the chat thread store's Supabase twin", () => {
  it("cuts what the columns limit, and fails loudly when the table is missing", async () => {
    const sb = fakeSupabase({ tables: ["code_chat_threads"] });
    const s = new chat.SupabaseThreadStore(sb as never);
    await s.put({ id: T, userId: U, projectId: P, summary: "x".repeat(5000), turns: 1, lastQuestion: "q".repeat(3000), lastCites: [], lastLocated: null, history: [], createdAt: 1, updatedAt: 2 });
    const row = sb.tables.code_chat_threads![0]!;
    expect((row.summary as string).length).toBe(2000);
    expect((row.last_question as string).length).toBe(1000);
    // A row kept before the history: last_located holds the located files alone, and reads as no history.
    const located = { targets: [{ path: "a.ts" }], related: [], tests: [], confidence: 0.9, used: { expanded: false, picked: false, paise: 0 } };
    row.last_located = located;
    expect(await s.get(U, P, T)).toMatchObject({ lastLocated: located, history: [] });
    await expect(new chat.SupabaseThreadStore(fakeSupabase({ error: "no table" }) as never).get(U, P, T)).rejects.toThrow(/no table/);
  });
});

describe.each([
  ["memory", () => new settings.MemorySettingsStore()],
  ["supabase", () => new settings.SupabaseSettingsStore(fakeSupabase({ tables: ["code_project_settings"] }) as never)],
])("the project settings store (%s)", (_n, make) => {
  it("keeps the person's choice for a project, and nothing before they make one", async () => {
    const s = make();
    expect(await s.get(P)).toBeNull();
    await s.put({ projectId: P, userId: U, mode: "freeform", planFirst: true, updatedAt: 10 });
    expect(await s.get(P)).toMatchObject({ mode: "freeform", planFirst: true });
    await s.put({ projectId: P, userId: U, mode: "guided", planFirst: true, updatedAt: 11 });
    expect(await s.get(P)).toMatchObject({ mode: "guided", planFirst: true });
    expect(await s.get(P2)).toBeNull();
  });
});

describe("the settings patch", () => {
  it("takes each field alone and refuses a wrong kind with a sentence", () => {
    expect(settings.readSettingsPatch({ mode: "freeform" })).toEqual({ mode: "freeform" });
    expect(settings.readSettingsPatch({ planFirst: false })).toEqual({ planFirst: false });
    expect(settings.readSettingsPatch(undefined)).toEqual({});
    expect(() => settings.readSettingsPatch({ mode: "wild" })).toThrow(/"guided" or "freeform"/);
    expect(() => settings.readSettingsPatch({ planFirst: "yes" })).toThrow(/true or false/);
  });
});

const point = (step: number, files: Array<[string, string | null]> = [["src/a.ts", "x"]]) => ({
  step, at: step * 10, note: `step ${step}`, staged: files.map(([path, content]) => ({ path, content, action: content === null ? ("delete" as const) : ("edit" as const) })), summary: `s${step}`, digests: [`d${step}`],
});

describe.each([
  ["memory", () => new rewind.MemoryRewindStore()],
  ["supabase", () => new rewind.SupabaseRewindStore(fakeSupabase({ tables: ["code_job_checkpoints"] }) as never)],
])("the rewind store (%s)", (_n, make) => {
  it("keeps a point for each step, lists them oldest first without their text, and gives one back whole", async () => {
    const s = make();
    await s.put(J, point(1));
    await s.put(J, point(2, [["src/a.ts", "y"], ["src/b.ts", null]]));
    expect(await s.list(J)).toEqual([
      { step: 1, at: 10, note: "step 1", files: ["src/a.ts"] },
      { step: 2, at: 20, note: "step 2", files: ["src/a.ts", "src/b.ts"] },
    ]);
    expect(await s.get(J, 2)).toEqual(point(2, [["src/a.ts", "y"], ["src/b.ts", null]]));
    expect(await s.get(J, 3)).toBeNull();
    // A step kept again is replaced.
    await s.put(J, point(2, [["src/c.ts", "z"]]));
    expect((await s.get(J, 2))!.staged.map((f) => f.path)).toEqual(["src/c.ts"]);
  });

  it("drops what came after a step the job went back to, and everything when the job goes", async () => {
    const s = make();
    for (const n of [1, 2, 3, 4]) await s.put(J, point(n));
    await s.dropAfter(J, 2);
    expect((await s.list(J)).map((x) => x.step)).toEqual([1, 2]);
    await s.deleteJob(J);
    expect(await s.list(J)).toEqual([]);
  });

  it("keeps the last steps only, and the text of all of them under its limit, oldest dropped first", async () => {
    const s = make();
    for (let n = 1; n <= REWIND_KEEP + 5; n += 1) await s.put(J, point(n));
    const steps = (await s.list(J)).map((x) => x.step);
    expect(steps).toHaveLength(REWIND_KEEP);
    expect(steps[0]).toBe(6);
    // Three big points: the oldest go until the text fits, the newest never.
    const big = "x".repeat(Math.floor(REWIND_CHARS_MAX / 2) + 1);
    await s.deleteJob(J);
    await s.put(J, point(1, [["a", big]]));
    await s.put(J, point(2, [["a", big]]));
    await s.put(J, point(3, [["a", big]]));
    expect((await s.list(J)).map((x) => x.step)).toEqual([3]);
  });
});

describe("the files of a revert commit", () => {
  it("puts back what the step had, or what the branch had before the job, and leaves out what already matches", async () => {
    const atBase: Record<string, string | null> = { "a.ts": "base a", "b.ts": "base b", "c.ts": null, "d.ts": "base d" };
    const atHead: Record<string, string | null> = { "a.ts": "job a", "b.ts": "job b", "c.ts": "job c", "d.ts": "base d" };
    const files = await rewind.revertFiles({
      paths: ["a.ts", "b.ts", "c.ts", "d.ts", "a.ts"],
      staged: [{ path: "a.ts", content: "step a", action: "edit" }],
      atBase: async (p) => atBase[p] ?? null, atHead: async (p) => atHead[p] ?? null,
    });
    expect(files).toEqual([{ path: "a.ts", content: "step a" }, { path: "b.ts", content: "base b" }, { path: "c.ts", delete: true }]);
    // Going back to what the branch already is: nothing to commit.
    expect(await rewind.revertFiles({ paths: ["d.ts"], staged: [], atBase: async (p) => atBase[p] ?? null, atHead: async (p) => atHead[p] ?? null })).toEqual([]);
  });
});

const careRow = (over: Partial<import("../src/code/prcare/types.js").CareRow> = {}) => ({
  projectId: P, prNumber: 7, userId: U, branch: "tailzu/x-1", origin: "tailzu" as const, statusCommentId: 99, ciRounds: { "2026-10-27": 2 },
  state: { ...emptyState(), handled: [1, 2], notes: [{ at: 5, text: "hi" }] }, handedAt: null, endedAt: null, createdAt: 1, updatedAt: 2, ...over,
});

describe.each([
  ["memory", () => new care.MemoryCareStore()],
  ["supabase", () => new care.SupabaseCareStore(fakeSupabase({ tables: ["code_pr_care"] }) as never)],
])("the PR care store (%s)", (_n, make) => {
  it("keeps one row for each pull request, replaced as a whole, and finds it again as it was", async () => {
    const s = make();
    await s.put(careRow());
    await s.put(careRow({ prNumber: 8, branch: "tailzu/y-2", createdAt: 3 }));
    const row = (await s.get(P, 7))!;
    expect(row).toMatchObject({ prNumber: 7, branch: "tailzu/x-1", origin: "tailzu", statusCommentId: 99, ciRounds: { "2026-10-27": 2 } });
    expect(row.state.handled).toEqual([1, 2]);
    await s.put(careRow({ statusCommentId: 100 }));
    expect((await s.get(P, 7))!.statusCommentId).toBe(100);
    expect((await s.listByProject(P)).map((r) => r.prNumber).sort()).toEqual([7, 8]);
    expect(await s.get(P2, 7)).toBeNull();
    expect(await s.get(P, 9)).toBeNull();
  });

  it("lists the pull requests that are not over, and forgets one", async () => {
    const s = make();
    await s.put(careRow());
    await s.put(careRow({ prNumber: 8, endedAt: 50 }));
    expect((await s.listActive(10)).map((r) => r.prNumber)).toEqual([7]);
    expect(await s.delete(P, 7)).toBe(true);
    expect(await s.delete(P, 7)).toBe(false);
    expect(await s.listActive(10)).toEqual([]);
  });
});

describe("the PR care store's twins on bad data", () => {
  it("memory refuses to give a pull request to somebody else", async () => {
    const s = new care.MemoryCareStore();
    await s.put(careRow());
    await expect(s.put(careRow({ userId: U2 }))).rejects.toThrow(/not theirs/);
  });
  it("supabase reads a row with odd columns as a usable one, and refuses a project that is not a signed-in person's", async () => {
    const sb = fakeSupabase({ tables: ["code_pr_care"] });
    sb.tables.code_pr_care!.push({ project_id: P, pr_number: 7, user_id: U, branch: "b", origin: "weird", status_comment_id: null, ci_rounds: { "bad": 1, "2026-10-27": "x", "2026-10-28": 1 }, state: "nonsense", handed_at: null, ended_at: null, created_at: "2026-10-27T00:00:00Z", updated_at: "2026-10-27T00:00:00Z" });
    const s = new care.SupabaseCareStore(sb as never);
    const row = (await s.get(P, 7))!;
    expect(row).toMatchObject({ origin: "tailzu", statusCommentId: null, ciRounds: { "2026-10-28": 1 }, state: { handled: [], jobs: [], notes: [] } });
    await expect(s.put(careRow({ projectId: "nope" }))).rejects.toThrow(/signed-in person/);
    await expect(new care.SupabaseCareStore(fakeSupabase({ error: "no table" }) as never).get(P, 7)).rejects.toThrow(/no table/);
  });
});

describe("migration 0034", () => {
  const dir = path.join(__dirname, "..", "supabase");
  const sql = fs.readFileSync(path.join(dir, "migrations", "0034_code_chat_and_care.sql"), "utf8");

  it("makes the four tables the stores use, with owner-read rules and nothing else open", () => {
    for (const t of ["code_chat_threads", "code_project_settings", "code_job_checkpoints", "code_pr_care"]) {
      expect(sql, t).toMatch(new RegExp(`create table if not exists public\\.${t}\\b`));
      expect(sql, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(sql, t).toMatch(new RegExp(`on public\\.${t} for select`));
    }
    expect(sql).not.toMatch(/for (?:insert|update|delete|all)\b/i);
  });

  it("holds the columns the stores write", () => {
    for (const col of ["last_located", "last_cites", "plan_first", "mode", "staged", "digests", "status_comment_id", "ci_rounds", "ended_at", "handed_at", "origin"]) expect(sql, col).toContain(col);
    for (const col of ["capture", "captured", "declined"]) expect(sql, col).toMatch(new RegExp(`add column if not exists ${col}\\b`));
    // A handed-over branch is not a "tailzu/..." one: the check on the branch name gives way to the flag.
    expect(sql).toMatch(/add column if not exists handed boolean not null default false/);
    expect(sql).toMatch(/check \(handed or branch ~ '\^tailzu\//);
  });

  it("can be run again, and is in the full schema as it is", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/);
    expect(sql).toMatch(/drop policy if exists/);
    const full = fs.readFileSync(path.join(dir, "full_schema.sql"), "utf8");
    expect(full).toContain(sql.trim());
  });
});

describe("the chat thread store, kept in the process when the table fails", () => {
  it("holds the chat in memory when the table is missing, and says once why", async () => {
    const lines: string[] = [];
    const s = new chat.KeptThreadStore(new chat.SupabaseThreadStore(fakeSupabase({ error: "relation code_chat_threads does not exist" }) as never), (l) => lines.push(l));
    const t = chat.afterTurn(chat.newThread(U, P, T, 1), { question: "what is this?", cites: [], located: null, now: 2, answer: "A storefront." });
    await s.put(t);
    await s.put(chat.withTurn(t, { said: "??", answer: "A shop on the web.", now: 3 }));
    expect((await s.get(U, P, T))!.history.map((h) => h.q)).toEqual(["what is this?", "??"]);
    expect(await s.list(U, P)).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/0034_code_chat_and_care\.sql/);
  });

  it("uses the table when it works", async () => {
    const sb = fakeSupabase({ tables: ["code_chat_threads"] });
    const s = new chat.KeptThreadStore(new chat.SupabaseThreadStore(sb as never), () => { throw new Error("no warning expected"); });
    await s.put(chat.newThread(U, P, T, 1));
    expect(sb.tables.code_chat_threads).toHaveLength(1);
    expect(await s.get(U, P, T)).toMatchObject({ id: T });
  });
});
