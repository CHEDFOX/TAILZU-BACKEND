/**
 * THE WORK LOG (src/code/work/worklog.ts, worklogStore.ts) and migration 0029.
 *
 * What these hold down:
 *   - the eight kinds of entry, each `{ at, kind, text, files?, data? }`, kept in order, in memory and in Supabase;
 *   - nothing secret is ever kept: a token on its own is [redacted], a line the scan flags as a whole is withheld, a
 *     private key's block is a note, a secret in a path or in the data is gone, and what still trips the scan is
 *     replaced outright (fixtures are built at runtime, never as literals);
 *   - the PR-body markdown: what changed and why, the files, the checks with what they said, the findings worst
 *     first, the decisions and the questions; short, escaped, cut to size, and honest when there is nothing;
 *   - a log that cannot be written is lost, never a job that fails;
 *   - the migration: its tables, row-level security with a select policy for the owner and nothing for writing, and
 *     its text in full_schema.sql.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { fakeSupabase } = await import("./work-fixtures.js");
const { WorkLog, WORK_KINDS, MemoryWorklogStore, SupabaseWorklogStore, redactText, redactData, renderWorklog, worklogMarkdown } = await import("../src/code/work/worklog.js");
type WorklogStore = import("../src/code/work/worklog.js").WorklogStore;

// Tokens are put together here so no file holds one as a literal (GitHub's push protection reads files).
const GH = ["gh", "p_"].join("") + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const AWS = ["AK", "IA"].join("") + "IOSFODNN7EXAMPLQ";
const STRIPE_LINE = `STRIPE_SECRET=${["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_")}`;
const PEM = (body: string) => [`-----BEGIN ${["RSA", "PRIVATE", "KEY"].join(" ")}-----`, body, `-----END ${["RSA", "PRIVATE", "KEY"].join(" ")}-----`].join("\n");

const JOB = "7d444840-9dc0-4f6a-a8b1-1f2b8d5a8c01";
const T0 = Date.parse("2026-10-26T10:00:00.000Z");
const clock = () => { let t = T0; return () => (t += 1000); };

// ----------------------------------------------------------------- redacting

describe("redactText: nothing secret is kept", () => {
  it("leaves ordinary text alone", () => {
    expect(redactText("Renamed fetchUsers to loadUsers in src/lib/api.ts")).toBe("Renamed fetchUsers to loadUsers in src/lib/api.ts");
  });

  it("replaces a token on its own with a note, and keeps the words around it", () => {
    const out = redactText(`The request used ${GH} and then ${AWS} in the header`);
    expect(out).toBe("The request used [redacted] and then [redacted] in the header");
    expect(out).not.toContain(GH);
  });

  it("a name=value secret is one word and is replaced", () => {
    const out = redactText(`env was ${STRIPE_LINE} at the time`);
    expect(out).toBe("env was [redacted] at the time");
  });

  it("a line the scan only flags as a whole (a name, a colon, a value apart) is withheld, and the other lines stand", () => {
    const out = redactText(`before\napi_key: "Zk3jD9fQ2mX8vB5nC1aL7sT4wY6uE0hG"\nafter`);
    expect(out).toBe("before\n[line withheld: it looked like it held a secret]\nafter");
  });

  it("a private key's block is a note, however many lines it has", () => {
    const out = redactText(`added a key:\n${PEM("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nabcdefghijklmnopqrstuvwxyz0123456789ABCD")}\ndone`);
    expect(out).toBe("added a key:\n[a private key was withheld]\ndone");
  });

  it("is cut to the length asked, and strips control characters", () => {
    expect(redactText("x".repeat(5000), 100)).toHaveLength(100);
    expect(redactText("a\u0000b\u0007c")).toBe("a b c");
    expect(redactText(undefined)).toBe("");
  });

  it("redactData cleans every string in a small object and drops what is too deep or too big", () => {
    const d = redactData({ cmd: "deploy", env: { key: GH, ok: "yes" }, list: [AWS, 1, true, null], deep: { a: { b: { c: { d: "too deep" } } } } })!;
    expect(JSON.stringify(d)).not.toContain(GH);
    expect(JSON.stringify(d)).not.toContain(AWS);
    expect(d).toMatchObject({ cmd: "deploy", env: { key: "[redacted]", ok: "yes" }, list: ["[redacted]", 1, true, null] });
    expect(JSON.stringify(redactData({ big: Array.from({ length: 50 }, () => "y".repeat(400)) }))).toBe('{"truncated":true}');
    expect(redactData("a string")).toBeUndefined();
    expect(redactData([1])).toBeUndefined();
  });
});

// ----------------------------------------------------------------- the log

describe("WorkLog", () => {
  it("keeps the eight kinds in order with their time, text, files and data", async () => {
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store, now: clock() });
    await log.step("Rename the function.", ["src/lib/api.ts"]);
    await log.read(["src/lib/api.ts", "src/lib/util.ts"]);
    await log.edit("edit", ["src/lib/api.ts"], "Renamed fetchUsers.");
    await log.command("pnpm test", { kind: "test", exitCode: 0, durationMs: 4200, summary: "12 passed" });
    await log.finding({ severity: "warn", path: "src/lib/api.ts", line: 5, text: "reads STRIPE_KEY but never checks it is set" });
    await log.decision("Kept the old name as a re-export for callers outside the repo.");
    await log.question("Should the old name stay?", "yes");
    await log.note("Done.");
    const all = await store.list(JOB);
    expect(all.map((e) => e.kind)).toEqual([...WORK_KINDS]);
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(all[0]).toMatchObject({ at: T0 + 1000, kind: "step", text: "Rename the function.", files: ["src/lib/api.ts"] });
    expect(all[3]).toMatchObject({ text: "pnpm test", data: { kind: "test", exitCode: 0, durationMs: 4200, summary: "12 passed" } });
    expect(all[4]).toMatchObject({ files: ["src/lib/api.ts"], data: { severity: "warn", path: "src/lib/api.ts", line: 5 } });
    expect(all[6]).toMatchObject({ data: { answer: "yes" } });
    expect((await store.list(JOB, { kinds: ["finding", "decision"] })).map((e) => e.kind)).toEqual(["finding", "decision"]);
  });

  it("redacts before it stores: text, paths and data", async () => {
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store });
    await log.note(`pasted ${GH}`);
    await log.edit("edit", [`config/${AWS}.json`, "src/a.ts"], `set ${STRIPE_LINE}`);
    await log.command("curl -H 'Authorization: token x'", { exitCode: 1, summary: `failed with ${GH}` });
    const stored = JSON.stringify(await store.list(JOB));
    for (const secret of [GH, AWS, ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_")]) expect(stored).not.toContain(secret);
    expect(stored).toContain("[redacted]");
  });

  it("a store that cannot be written is a lost entry, not a failed job", async () => {
    const broken: WorklogStore = {
      append: async () => { throw new Error("db down"); }, list: async () => { throw new Error("db down"); }, count: async () => 0, deleteJob: async () => {},
    };
    const log = new WorkLog(JOB, { store: broken });
    await expect(log.step("x")).resolves.toBeNull();
    await expect(log.markdown()).resolves.toMatch(/Nothing was recorded for this job/);
  });

  it("drops the quiet kinds (read, note) past its cap and keeps the rest", async () => {
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store, quietMax: 3 });
    for (let i = 0; i < 5; i += 1) await log.read([`f${i}.ts`]);
    expect(await store.count(JOB)).toBe(3);
    await log.edit("edit", ["a.ts"], "still kept");
    await log.note("dropped");
    expect((await store.list(JOB)).map((e) => e.kind)).toEqual(["read", "read", "read", "edit"]);
  });

  it("refuses a kind it does not have", async () => {
    const log = new WorkLog(JOB, { store: new MemoryWorklogStore() });
    await expect(log.add("gossip" as never, { text: "x" })).resolves.toBeNull();
  });
});

// ----------------------------------------------------------------- the PR body

describe("worklogMarkdown: the section of the PR body", () => {
  async function filled() {
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store, now: clock() });
    await log.step("Rename fetchUsers to loadUsers in the API client.");
    await log.step("Use the new name in the signup form.");
    await log.read(["src/lib/api.ts"]);
    await log.edit("edit", ["src/lib/api.ts", "src/components/SignupForm.tsx"], "Renamed.");
    await log.edit("create", ["src/lib/money.ts"], "A helper.");
    await log.edit("delete", ["src/lib/old.ts"], "Not used.");
    await log.command("pnpm run test", { kind: "test", exitCode: 0, durationMs: 12_400, summary: "31 passed" });
    await log.command("pnpm run lint", { kind: "lint", exitCode: 1, durationMs: 3000, summary: "2 problems", verdict: "already_broken" });
    await log.command("pnpm run build", { kind: "build", exitCode: 1, durationMs: 9000, verdict: "broke" });
    await log.command("pnpm run typecheck", { kind: "typecheck", exitCode: 1, durationMs: 1000, verdict: "fixed" });
    await log.finding({ severity: "info", path: "src/lib/util.ts", text: "slug() is never called" });
    await log.finding({ severity: "risk", path: "src/app/api/users/route.ts", line: 6, text: "POST reads no body and never validates it" });
    await log.finding({ severity: "warn", path: "src/lib/api.ts", text: "an unused import" });
    await log.decision("Kept the old name as an alias for one release.");
    await log.question("Should the old name stay?", "Yes, for a release");
    await log.question("Which version of Node?");
    return store;
  }

  it("has the headings in order, and leaves out a section with nothing in it", async () => {
    const md = await worklogMarkdown(JOB, { store: await filled() });
    expect(md.match(/^#{2,3} .+$/gm)).toEqual(["## Work log", "### What changed and why", "### Files", "### Checks", "### Findings", "### Decisions", "### Questions"]);
    const empty = new MemoryWorklogStore();
    await new WorkLog(JOB, { store: empty }).decision("Chose the simple way.");
    expect((await worklogMarkdown(JOB, { store: empty })).match(/^#{2,3} .+$/gm)).toEqual(["## Work log", "### Decisions"]);
  });

  it("says what changed and why as numbered steps, and lists each file once with the last thing done to it", async () => {
    const md = await worklogMarkdown(JOB, { store: await filled() });
    expect(md).toContain("1. Rename fetchUsers to loadUsers in the API client.\n2. Use the new name in the signup form.");
    expect(md).toContain("- `src/lib/api.ts` (changed)");
    expect(md).toContain("- `src/lib/money.ts` (added)");
    expect(md).toContain("- `src/lib/old.ts` (deleted)");
    expect(md.match(/`src\/lib\/api\.ts` \(/g)).toHaveLength(1);
  });

  it("with no steps, the reasons for the edits stand in for them", async () => {
    const store = new MemoryWorklogStore();
    await new WorkLog(JOB, { store }).edit("edit", ["a.ts"], "Fixed the off-by-one.");
    expect(await worklogMarkdown(JOB, { store })).toContain("- Fixed the off-by-one.");
  });

  it("shows each check with what it said, and the verdict against the baseline in plain words", async () => {
    const md = await worklogMarkdown(JOB, { store: await filled() });
    expect(md).toContain("| Command | Result |");
    expect(md).toContain("| `pnpm run test` | passed in 12s: 31 passed |");
    expect(md).toContain("| `pnpm run lint` | failed, and was already failing before X0 Bot in 3s: 2 problems |");
    expect(md).toContain("| `pnpm run build` | **failed**: this change broke it in 9s |");
    expect(md).toContain("| `pnpm run typecheck` | passes now; it was failing before in 1s |");
  });

  it("the last run of a command is the one shown", async () => {
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store });
    await log.command("npm test", { exitCode: 1, summary: "1 failed" });
    await log.command("npm test", { exitCode: 0, summary: "all passed" });
    const md = await worklogMarkdown(JOB, { store });
    expect(md.match(/`npm test`/g)).toHaveLength(1);
    expect(md).toContain("passed: all passed");
  });

  it("findings go worst first, with where they are", async () => {
    const md = await worklogMarkdown(JOB, { store: await filled() });
    const f = md.slice(md.indexOf("### Findings"), md.indexOf("### Decisions")).split("\n").filter((l) => l.startsWith("- "));
    expect(f).toEqual([
      "- **risk** `src/app/api/users/route.ts:6`: POST reads no body and never validates it",
      "- **warn** `src/lib/api.ts`: an unused import",
      "- **info** `src/lib/util.ts`: slug() is never called",
    ]);
  });

  it("decisions, and questions with their answers or a note that there is none", async () => {
    const md = await worklogMarkdown(JOB, { store: await filled() });
    expect(md).toContain("- Kept the old name as an alias for one release.");
    expect(md).toContain("- Should the old name stay? Answer: Yes, for a release");
    expect(md).toContain("- Which version of Node? (not answered)");
  });

  it("says so when nothing was recorded, and is cut to size", async () => {
    expect(await worklogMarkdown(JOB, { store: new MemoryWorklogStore() })).toBe("## Work log\n\n_Nothing was recorded for this job._");
    const store = new MemoryWorklogStore();
    const log = new WorkLog(JOB, { store });
    for (let i = 0; i < 30; i += 1) await log.step(`Step ${i}: ${"detail ".repeat(40)}`);
    const md = await worklogMarkdown(JOB, { store, maxChars: 1500 });
    expect(md.length).toBeLessThanOrEqual(1600);
    expect(md).toMatch(/_\(The rest is in the job's log\.\)_$/);
  });

  it("escapes what would break a table or a page, and never carries a secret that got into the store another way", async () => {
    const store = new MemoryWorklogStore();
    await store.append(JOB, { at: T0, kind: "command", text: "echo a | cat", data: { exitCode: 0, summary: `ok <b>bold</b> ${GH}` } });
    const md = await worklogMarkdown(JOB, { store });
    expect(md).toContain("`echo a \\| cat`");
    expect(md).toContain("&lt;b>bold&lt;/b>");
    expect(md).not.toContain(GH);
    expect(await renderWorklog([], { level: 3 })).toMatch(/^### Work log/);
  });
});

// ----------------------------------------------------------------- Supabase

describe("the Supabase store", () => {
  it("writes a row per entry and reads them back in order, with the files and data", async () => {
    const sb = fakeSupabase();
    const store = new SupabaseWorklogStore(sb as never);
    const log = new WorkLog(JOB, { store, now: clock() });
    await log.step("One.", ["a.ts"]);
    await log.command("npm test", { exitCode: 0 });
    await log.note("Three.");
    expect(sb.tables.code_worklog).toHaveLength(3);
    expect(sb.tables.code_worklog[0]).toMatchObject({ job_id: JOB, kind: "step", text: "One.", files: ["a.ts"] });
    const back = await store.list(JOB);
    expect(back.map((e) => [e.seq, e.kind])).toEqual([[1, "step"], [2, "command"], [3, "note"]]);
    expect(back[1]).toMatchObject({ data: { exitCode: 0 } });
    expect(await store.count(JOB)).toBe(3);
    expect((await store.list(JOB, { kinds: ["note"] })).map((e) => e.text)).toEqual(["Three."]);
    await store.deleteJob(JOB);
    expect(await store.count(JOB)).toBe(0);
  });

  it("a job id that is not a uuid reads as empty and cannot be written", async () => {
    const store = new SupabaseWorklogStore(fakeSupabase() as never);
    expect(await store.list("not-a-uuid")).toEqual([]);
    expect(await store.count("not-a-uuid")).toBe(0);
    await expect(store.append("not-a-uuid", { at: 1, kind: "note", text: "x" })).rejects.toThrow(/not a job id/);
  });

  it("an error from the database is thrown by the store and swallowed by the log", async () => {
    const store = new SupabaseWorklogStore(fakeSupabase({ error: "relation does not exist" }) as never);
    await expect(store.list(JOB)).rejects.toThrow(/relation does not exist/);
    await expect(new WorkLog(JOB, { store }).note("x")).resolves.toBeNull();
  });
});

// ----------------------------------------------------------------- the migration

describe("migration 0029_code_worklog.sql", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const supabaseDir = join(here, "..", "supabase");
  const migration = readFileSync(join(supabaseDir, "migrations", "0029_code_worklog.sql"), "utf8");
  const full = readFileSync(join(supabaseDir, "full_schema.sql"), "utf8");
  const code = migration.replace(/--.*$/gm, "");

  it("makes code_worklog: an identity id, a job it goes with, the eight kinds, and files and data", () => {
    expect(code).toMatch(/create table if not exists public\.code_worklog/);
    expect(code).toMatch(/id\s+bigint generated always as identity primary key/);
    expect(code).toMatch(/job_id uuid not null references public\.code_jobs \(id\) on delete cascade/);
    for (const k of WORK_KINDS) expect(code, k).toContain(`'${k}'`);
    expect(code).toMatch(/check \(kind in \('step', 'read', 'edit', 'command', 'finding', 'decision', 'question', 'note'\)\)/);
    expect(code).toMatch(/text\s+text not null default '' check \(char_length\(text\) <= 2000\)/);
    expect(code).toMatch(/files\s+text\[\] not null default '\{\}'/);
    expect(code).toMatch(/data\s+jsonb/);
    expect(code).toMatch(/create index if not exists code_worklog_job_idx on public\.code_worklog \(job_id, id\)/);
  });

  it("makes code_intake: one row per project, the states, the answers, the spec and stack, and the tips", () => {
    expect(code).toMatch(/create table if not exists public\.code_intake/);
    expect(code).toMatch(/project_id uuid primary key references public\.code_projects \(id\) on delete cascade/);
    expect(code).toMatch(/user_id\s+uuid not null references auth\.users \(id\) on delete cascade/);
    expect(code).toMatch(/state\s+text not null default 'asking' check \(state in \('asking', 'ready', 'done'\)\)/);
    for (const col of ["request", "answers", "asked", "spec", "stack", "tips", "created_at", "updated_at"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(code).toMatch(/tips\s+text\[\] not null default '\{\}'/);
  });

  it("lets the owner READ their rows and nobody write: row-level security on, select policies only", () => {
    for (const t of ["code_worklog", "code_intake"]) expect(code, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    expect(code).toMatch(/create policy "users read own code worklog"\s+on public\.code_worklog for select\s+using \(exists \(\s+select 1 from public\.code_jobs j\s+where j\.id = code_worklog\.job_id and j\.user_id = auth\.uid\(\)/);
    expect(code).toMatch(/create policy "users read own code intake"\s+on public\.code_intake for select\s+using \(user_id = auth\.uid\(\)\)/);
    expect(code.match(/create policy/g)).toHaveLength(2);
    expect(code).not.toMatch(/for (insert|update|delete|all)/i);
    expect(code).not.toMatch(/grant /i);
  });

  it("follows 0028 in the migrations folder and can be run again", () => {
    const names = readdirSync(join(supabaseDir, "migrations")).sort();
    const at = names.indexOf("0029_code_worklog.sql");
    expect(at).toBeGreaterThan(0);
    expect(names[at - 1]).toBe("0028_code_project_brain.sql");
    for (const st of code.split(";").map((x) => x.trim()).filter(Boolean)) {
      if (/^create (table|index)/i.test(st)) expect(st).toMatch(/if not exists/i);
      if (/^create policy/i.test(st)) expect(code).toContain(`drop policy if exists ${/create policy ("[^"]+")/i.exec(st)![1]}`);
    }
  });

  it("is in full_schema.sql, under its own heading, after 0028, and the same text", () => {
    expect(full).toContain("-- 0029_code_worklog.sql");
    expect(full.indexOf("-- 0029_code_worklog.sql")).toBeGreaterThan(full.indexOf("-- 0028_code_project_brain.sql"));
    expect(full).toContain(migration.trim());
    for (const t of ["code_worklog", "code_intake"]) expect(full.match(new RegExp(`create table if not exists public\\.${t}\\b`, "g")), t).toHaveLength(1);
    expect(full.endsWith("\n")).toBe(true);
  });
});
