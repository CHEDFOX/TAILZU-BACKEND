/**
 * WHAT IS KEPT OF A BOT (src/bots/store.ts, migration 0038): THE MEMORY TWIN HELD TO THE CONTRACT, THE SUPABASE TWIN HELD TO THE MIGRATION'S COLUMNS.
 *
 *   - everything is the owner's: another person's id finds, changes, deletes and lists nothing; a slug is unique across everyone
 *   - deleting a bot takes its keys, commands, facts and thread with it
 *   - the Supabase twin writes the migration's columns, filters every read and write by the owner, and maps whatever the database hands back
 *   - the migration makes the five tables with owner-only read policies and no write policy, hides the key hash from a token, is in full_schema.sql,
 *     is on the account delete list and in the export
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { MemoryBotStore, SupabaseBotStore, SlugTaken, BOT_TABLES, BOT_USER_TABLES } = await import("../src/bots/store.js");
const { ALICE, BOB, rig, def } = await import("./bots-rig.js");
type StoredBot = import("../src/bots/types.js").StoredBot;
type KeyRow = import("../src/bots/store.js").KeyRow;

const ID = "33333333-3333-4333-8333-333333333333";
const bot = (over: Partial<StoredBot> = {}): StoredBot => ({
  id: ID, ownerId: ALICE, slug: "workout-buddy", name: "Workout buddy", colour: "sea", purpose: "Plans workouts.", principles: ["Be brief."],
  skills: { web: true, files: false, artifacts: false, code: false, research: false, connectors: ["google-calendar"] }, knowledge: [], tone: "upbeat", visibility: "private",
  budgets: { perRequestPaise: 150, dailyPaise: 800 }, publicCard: false, createdAt: 1000, updatedAt: 1000, ...over,
});
const key = (over: Partial<KeyRow> = {}): KeyRow => ({ id: "44444444-4444-4444-8444-444444444444", botId: ID, userId: ALICE, hash: "a".repeat(64), prefix: "tzb_abcd", label: "app", createdAt: 5, lastUsedAt: null, revokedAt: null, ...over });

describe("the memory twin", () => {
  it("keeps a bot for its owner, by id or by slug, and hands out copies", async () => {
    const s = new MemoryBotStore();
    await s.putBot(bot());
    expect((await s.getBot(ALICE, ID))!.slug).toBe("workout-buddy");
    expect((await s.getBot(ALICE, "workout-buddy"))!.id).toBe(ID);
    const got = (await s.getBot(ALICE, ID))!;
    got.principles.push("changed");
    got.skills.connectors.push("changed");
    expect((await s.getBot(ALICE, ID))!.principles).toEqual(["Be brief."]);
    expect((await s.getBot(ALICE, ID))!.skills.connectors).toEqual(["google-calendar"]);
    expect(await s.countBots(ALICE)).toBe(1);
  });

  it("is the owner's: nobody else finds, lists, changes or deletes it", async () => {
    const s = new MemoryBotStore();
    await s.putBot(bot());
    expect(await s.getBot(BOB, ID)).toBeNull();
    expect(await s.getBot(BOB, "workout-buddy")).toBeNull();
    expect(await s.listBots(BOB)).toEqual([]);
    expect(await s.updateBot(BOB, ID, { name: "Stolen" }, 5)).toBeNull();
    expect(await s.deleteBot(BOB, ID)).toBe(false);
    expect((await s.getBot(ALICE, ID))!.name).toBe("Workout buddy");
    // the public lookups are the only ones that cross owners: by slug and by id, for the card and the key door
    expect((await s.getBySlug("workout-buddy"))!.ownerId).toBe(ALICE);
    expect((await s.getById(ID))!.ownerId).toBe(ALICE);
    expect(await s.getBySlug("nobody")).toBeNull();
  });

  it("keeps one slug for everyone", async () => {
    const s = new MemoryBotStore();
    await s.putBot(bot());
    await expect(s.putBot(bot({ id: "x", ownerId: BOB }))).rejects.toBeInstanceOf(SlugTaken);
    await s.putBot(bot({ id: "y", ownerId: BOB, slug: "other" }));
    await expect(s.updateBot(BOB, "y", { slug: "workout-buddy" }, 9)).rejects.toBeInstanceOf(SlugTaken);
    expect((await s.updateBot(BOB, "y", { slug: "renamed", name: "N" }, 9))!).toMatchObject({ slug: "renamed", name: "N", updatedAt: 9, createdAt: 1000, ownerId: BOB, id: "y" });
  });

  it("deletes a bot with its keys, commands, facts and thread", async () => {
    const s = new MemoryBotStore();
    await s.putBot(bot());
    await s.addKey(key());
    await s.putCommand(ALICE, ID, { name: "go", template: "Go {{input}}" }, 1);
    await s.addFacts(ALICE, ID, ["Likes tea."], 40, 1);
    await s.putThread(ALICE, ID, { summary: "s", buffer: ["a"], turns: 1, updatedAt: 1 });
    // a built-in's, under its slug, is another bot's
    await s.addFacts(ALICE, "keybot", ["Writes short."], 40, 1);
    expect(await s.deleteBot(ALICE, ID)).toBe(true);
    expect(await s.findKey("a".repeat(64))).toBeNull();
    expect(await s.listCommands(ALICE, ID)).toEqual([]);
    expect(await s.listFacts(ALICE, ID)).toEqual([]);
    expect(await s.getThread(ALICE, ID)).toBeNull();
    expect((await s.listFacts(ALICE, "keybot")).map((f) => f.text)).toEqual(["Writes short."]);
    expect(await s.deleteBot(ALICE, ID)).toBe(false);
  });

  it("keeps keys by hash, revokes by the owner only, and notes when a key was used", async () => {
    const s = new MemoryBotStore();
    await s.putBot(bot());
    await s.addKey(key());
    expect((await s.findKey("a".repeat(64)))!.id).toBe(key().id);
    expect(await s.findKey("b".repeat(64))).toBeNull();
    expect(await s.revokeKey(BOB, ID, key().id, 9)).toBe(false);
    expect(await s.revokeKey(ALICE, "wrong-bot", key().id, 9)).toBe(false);
    expect(await s.revokeKey(ALICE, ID, key().id, 9)).toBe(true);
    expect(await s.revokeKey(ALICE, ID, key().id, 10)).toBe(true);
    expect((await s.findKey("a".repeat(64)))!.revokedAt).toBe(9);
    await s.touchKey(key().id, 77);
    expect((await s.listKeys(ALICE, ID))[0]!.lastUsedAt).toBe(77);
    expect(await s.listKeys(BOB, ID)).toEqual([]);
  });

  it("keeps commands by name (a second save replaces), facts once each with the oldest dropped past the limit, and a thread", async () => {
    const s = new MemoryBotStore();
    await s.putCommand(ALICE, ID, { name: "go", template: "one" }, 1);
    const again = await s.putCommand(ALICE, ID, { name: "go", template: "two" }, 5);
    expect(again).toMatchObject({ template: "two", createdAt: 1, updatedAt: 5 });
    expect(await s.listCommands(ALICE, ID)).toHaveLength(1);
    expect(await s.listCommands(BOB, ID)).toEqual([]);
    expect(await s.deleteCommand(BOB, ID, "go")).toBe(false);
    expect(await s.deleteCommand(ALICE, ID, "go")).toBe(true);
    const added = await s.addFacts(ALICE, ID, ["Likes tea.", "likes  TEA.", "Walks daily."], 2, 1);
    expect(added.map((f) => f.text)).toEqual(["Likes tea.", "Walks daily."]);
    await s.addFacts(ALICE, ID, ["Reads a lot."], 2, 2);
    expect((await s.listFacts(ALICE, ID)).map((f) => f.text)).toEqual(["Walks daily.", "Reads a lot."]);
    const [first] = await s.listFacts(ALICE, ID);
    expect(await s.dropFact(BOB, ID, first!.id)).toBe(false);
    expect(await s.dropFact(ALICE, ID, first!.id)).toBe(true);
    expect(await s.clearMemory(ALICE, ID)).toEqual({ facts: 1, thread: false });
    await s.putThread(ALICE, ID, { summary: "s", buffer: ["a"], turns: 2, updatedAt: 1 });
    expect(await s.getThread(BOB, ID)).toBeNull();
    expect((await s.getThread(ALICE, ID))!.turns).toBe(2);
    expect(await s.clearMemory(ALICE, ID)).toEqual({ facts: 0, thread: true });
  });
});

// ------------------------------------------------------------------ supabase

type Call = [string, unknown[]];
/** A query builder that writes down what it is asked and answers, in order, with `answers` (the last repeats). */
function stub(answers: unknown[]) {
  const log: Call[] = [];
  let n = 0;
  const next = (): unknown => answers[Math.min(n++, answers.length - 1)];
  const q: Record<string, unknown> = {};
  for (const m of ["from", "insert", "update", "upsert", "delete", "select", "eq", "is", "in", "order", "limit", "single", "maybeSingle", "returns"]) q[m] = (...args: unknown[]) => { log.push([m, args]); return q; };
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  return { sb: q as never, log, calls: (m: string) => log.filter(([x]) => x === m).map(([, a]) => a) };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: ID, user_id: ALICE, slug: "workout-buddy", name: "Workout buddy", colour: "sea", purpose: "Plans workouts.", principles: ["Be brief."],
  skills: { web: true, connectors: ["google-calendar"] }, knowledge: [], tone: "upbeat", budgets: { perRequestPaise: 150, dailyPaise: 800 }, public_card: false,
  created_at: "2026-10-27T00:00:00.000Z", updated_at: "2026-10-27T00:00:00.000Z", ...over,
});
const ok = { error: null };

describe("the Supabase twin", () => {
  it("writes the migration's columns, and reads them back as a bot", async () => {
    const t = stub([{ data: row(), error: null }]);
    const made = await new SupabaseBotStore(t.sb).putBot(bot({ createdAt: Date.UTC(2026, 9, 27), updatedAt: Date.UTC(2026, 9, 27) }));
    expect(t.calls("from")).toEqual([["bots"]]);
    expect(t.calls("insert")[0]![0]).toEqual({
      id: ID, user_id: ALICE, slug: "workout-buddy", name: "Workout buddy", colour: "sea", purpose: "Plans workouts.", principles: ["Be brief."],
      skills: bot().skills, knowledge: [], tone: "upbeat", budgets: { perRequestPaise: 150, dailyPaise: 800 }, public_card: false,
      created_at: "2026-10-27T00:00:00.000Z", updated_at: "2026-10-27T00:00:00.000Z",
    });
    expect(made).toMatchObject({ id: ID, ownerId: ALICE, slug: "workout-buddy", colour: "sea", publicCard: false, visibility: "private" });
    expect(made.skills).toEqual({ web: true, files: false, artifacts: false, code: false, research: false, connectors: ["google-calendar"] });
  });

  it("says a slug is taken when the unique index does", async () => {
    const t = stub([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
    await expect(new SupabaseBotStore(t.sb).putBot(bot())).rejects.toBeInstanceOf(SlugTaken);
    const u = stub([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
    await expect(new SupabaseBotStore(u.sb).updateBot(ALICE, ID, { slug: "taken" }, 5)).rejects.toBeInstanceOf(SlugTaken);
  });

  it("filters every owner's read and write by the owner, by id or by slug", async () => {
    const t = stub([{ data: row(), error: null }]);
    const s = new SupabaseBotStore(t.sb);
    await s.getBot(ALICE, ID);
    await s.getBot(ALICE, "workout-buddy");
    expect(t.calls("eq")).toEqual([["user_id", ALICE], ["id", ID], ["user_id", ALICE], ["slug", "workout-buddy"]]);
    await s.updateBot(ALICE, ID, { name: "N", publicCard: true, budgets: { perRequestPaise: 5, dailyPaise: 9 } }, Date.UTC(2026, 9, 28));
    expect(t.calls("update")[0]![0]).toEqual({ name: "N", public_card: true, budgets: { perRequestPaise: 5, dailyPaise: 9 }, updated_at: "2026-10-28T00:00:00.000Z" });
    expect(t.calls("eq").slice(4)).toEqual([["id", ID], ["user_id", ALICE]]);
    const before = t.log.length;
    expect(await s.updateBot(ALICE, "not-an-id", { name: "x" }, 1)).toBeNull();
    expect(await s.getById("not-an-id")).toBeNull();
    expect(await s.deleteBot(ALICE, "not-an-id")).toBe(false);
    expect(t.log.length).toBe(before);
  });

  it("maps whatever the database hands back: a colour outside the palette, missing skills, null lists", async () => {
    const t = stub([{ data: row({ colour: "neon", skills: null, principles: null, knowledge: "x", budgets: null, public_card: null }), error: null }]);
    const b = (await new SupabaseBotStore(t.sb).getBot(ALICE, ID))!;
    expect(b).toMatchObject({ colour: "stone", principles: [], knowledge: [], publicCard: false, budgets: { perRequestPaise: 1, dailyPaise: 1 } });
    expect(b.skills).toEqual({ web: false, files: false, artifacts: false, code: false, research: false, connectors: [] });
    expect(await new SupabaseBotStore(stub([{ data: null, error: null }]).sb).getBot(ALICE, ID)).toBeNull();
    await expect(new SupabaseBotStore(stub([{ data: null, error: { message: "connection reset" } }]).sb).getBot(ALICE, ID)).rejects.toThrow(/bot store: read: connection reset/);
  });

  it("keeps a key by its hash and never selects or writes the key", async () => {
    const t = stub([{ data: { id: key().id, bot_id: ID, user_id: ALICE, key_hash: "a".repeat(64), prefix: "tzb_abcd", label: "app", created_at: "2026-10-27T00:00:00.000Z", last_used_at: null, revoked_at: null }, error: null }]);
    const s = new SupabaseBotStore(t.sb);
    const k = await s.addKey(key({ createdAt: Date.UTC(2026, 9, 27) }));
    expect(t.calls("insert")[0]![0]).toEqual({ id: key().id, bot_id: ID, user_id: ALICE, key_hash: "a".repeat(64), prefix: "tzb_abcd", label: "app", created_at: "2026-10-27T00:00:00.000Z" });
    expect(k).toMatchObject({ hash: "a".repeat(64), prefix: "tzb_abcd", revokedAt: null });
    await s.findKey("a".repeat(64));
    expect(t.calls("eq").at(-1)).toEqual(["key_hash", "a".repeat(64)]);
    await s.touchKey(key().id, Date.UTC(2026, 9, 27, 1));
    expect(t.calls("update").at(-1)![0]).toEqual({ last_used_at: "2026-10-27T01:00:00.000Z" });
    await s.revokeKey(ALICE, ID, key().id, Date.UTC(2026, 9, 27, 2));
    expect(t.calls("update").at(-1)![0]).toEqual({ revoked_at: "2026-10-27T02:00:00.000Z" });
    expect(t.calls("eq").slice(-4)).toEqual(expect.arrayContaining([["id", key().id], ["user_id", ALICE], ["bot_id", ID]]));
    expect(await s.revokeKey(ALICE, ID, "not-an-id", 1)).toBe(false);
  });

  it("clears a bot's children by owner before the bot", async () => {
    const t = stub([{ data: [{ id: ID }], error: null }]);
    expect(await new SupabaseBotStore(t.sb).deleteBot(ALICE, ID)).toBe(true);
    expect(t.calls("from")).toEqual([["bot_commands"], ["bot_facts"], ["bot_threads"], ["bots"]]);
    expect(t.calls("eq").slice(0, 6)).toEqual([["user_id", ALICE], ["bot_id", ID], ["user_id", ALICE], ["bot_id", ID], ["user_id", ALICE], ["bot_id", ID]]);
    expect(t.calls("eq").slice(6)).toEqual([["id", ID], ["user_id", ALICE]]);
  });

  it("saves a command by owner, bot and name, a thread by owner and bot, and facts one each", async () => {
    const c = stub([{ data: { name: "go", template: "Go", created_at: "2026-10-27T00:00:00.000Z", updated_at: "2026-10-27T00:00:00.000Z" }, error: null }]);
    await new SupabaseBotStore(c.sb).putCommand(ALICE, ID, { name: "go", template: "Go" }, Date.UTC(2026, 9, 27));
    expect(c.calls("upsert")[0]).toEqual([{ user_id: ALICE, bot_id: ID, name: "go", template: "Go", updated_at: "2026-10-27T00:00:00.000Z" }, { onConflict: "user_id,bot_id,name" }]);
    const th = stub([ok]);
    await new SupabaseBotStore(th.sb).putThread(ALICE, ID, { summary: "s", buffer: ["a"], turns: 3, updatedAt: Date.UTC(2026, 9, 27) });
    expect(th.calls("upsert")[0]).toEqual([{ user_id: ALICE, bot_id: ID, summary: "s", buffer: ["a"], turns: 3, updated_at: "2026-10-27T00:00:00.000Z" }, { onConflict: "user_id,bot_id" }]);
    const f = stub([{ data: [{ id: "f1", fact: "Likes tea.", created_at: "2026-10-26T00:00:00.000Z" }], error: null }, { data: [{ id: "f2", fact: "Walks daily.", created_at: "2026-10-27T00:00:00.000Z" }], error: null }, ok]);
    const added = await new SupabaseBotStore(f.sb).addFacts(ALICE, ID, ["likes TEA.", "Walks daily."], 40, Date.UTC(2026, 9, 27));
    expect(f.calls("insert")[0]![0]).toEqual([{ user_id: ALICE, bot_id: ID, fact: "Walks daily.", created_at: "2026-10-27T00:00:00.000Z" }]);
    expect(added.map((x) => x.text)).toEqual(["Walks daily."]);
    expect(await new SupabaseBotStore(stub([{ data: [], error: null }]).sb).dropFact(ALICE, ID, "not-an-id")).toBe(false);
  });
});

// ------------------------------------------------------------------ the migration

describe("the migration (supabase/migrations/0038_bots.sql)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const sql = readFileSync(join(root, "supabase", "migrations", "0038_bots.sql"), "utf8");
  const full = readFileSync(join(root, "supabase", "full_schema.sql"), "utf8");
  const code = readFileSync(join(root, "src", "bots", "store.ts"), "utf8");
  const server = readFileSync(join(root, "src", "server.ts"), "utf8");

  it("makes the five tables, safe to run again", () => {
    for (const t of BOT_TABLES) expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}\\b`));
    expect(sql).not.toMatch(/create table (?!if not exists)/);
    expect([...BOT_TABLES]).toEqual(["bots", "bot_keys", "bot_commands", "bot_facts", "bot_threads"]);
    expect(sql).toMatch(/slug\s+text not null unique check \(slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$' and char_length\(slug\) between 3 and 40\)/);
    expect(sql).toMatch(/colour\s+text not null check \(colour in \('moss', 'clay', 'ochre', 'sea', 'pine', 'plum', 'sand', 'stone'\)\)/);
    expect(sql).toMatch(/jsonb_array_length\(principles\) <= 12/);
    expect(sql).toMatch(/public_card boolean not null default false/);
    expect(sql).toMatch(/key_hash\s+text not null unique check \(key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).toMatch(/bot_id\s+uuid not null references public\.bots \(id\) on delete cascade/);
    expect(sql).toMatch(/unique \(user_id, bot_id, name\)/);
    expect(sql).toMatch(/unique \(user_id, bot_id, fact\)/);
    expect(sql).toMatch(/primary key \(user_id, bot_id\)/);
    expect(sql.match(/references auth\.users \(id\) on delete cascade/g)).toHaveLength(5);
  });

  it("is owner-only: row security on every table, a read policy for the owner, no policy that lets a token write, and the key hash hidden from a token", () => {
    for (const t of BOT_TABLES) expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    expect(sql.match(/create policy/g)).toHaveLength(5);
    expect(sql.match(/for select\s+using \(auth\.uid\(\) = user_id\)/g)).toHaveLength(5);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/i);
    expect(sql).not.toMatch(/to anon/);
    expect(sql).toContain("revoke select on public.bot_keys from anon, authenticated;");
    expect(sql).toMatch(/grant select \(id, bot_id, user_id, prefix, label, created_at, last_used_at, revoked_at\) on public\.bot_keys to authenticated;/);
    expect(sql).not.toMatch(/grant select \([^)]*key_hash/);
  });

  it("names every column the store writes and reads", () => {
    for (const c of ["user_id", "slug", "colour", "purpose", "principles", "skills", "knowledge", "tone", "budgets", "public_card", "created_at", "updated_at", "bot_id", "key_hash", "prefix", "label", "last_used_at", "revoked_at", "template", "fact", "summary", "buffer", "turns"]) {
      expect(sql, c).toMatch(new RegExp(`\\b${c}\\b`));
      expect(code, c).toMatch(new RegExp(`\\b${c}\\b`));
    }
  });

  it("is appended to the whole schema, after 0037, whole", () => {
    expect(full).toContain("-- 0038_bots.sql");
    expect(full.indexOf("-- 0038_bots.sql")).toBeGreaterThan(full.indexOf("-- 0037_code_team.sql"));
    expect(full.endsWith(`${sql.trimEnd()}\n`) || full.trimEnd().endsWith(sql.trimEnd())).toBe(true);
    expect(full.endsWith("\n")).toBe(true);
  });

  it("is on the account delete list, and in the export", async () => {
    for (const t of BOT_USER_TABLES) expect(server).toContain(`["${t}", null]`);
    expect([...BOT_USER_TABLES]).toEqual([...BOT_TABLES]);
    const r = await rig(() => "hi");
    await r.bots.create(ALICE, def({ slug: "api-bot" }));
    const { key } = await r.bots.createKey(ALICE, "api-bot", "app");
    await r.bots.putCommand(ALICE, "api-bot", { name: "go", template: "Go {{input}}" });
    await r.bots.putCommand(ALICE, "keybot", { name: "short", template: "Make it short: {{input}}" });
    await r.bots.ask(ALICE, "api-bot", { message: "remember that I train at 6" });
    const out = await r.bots.exportAll(ALICE);
    expect(out.bots.map((b) => b.slug)).toEqual(["api-bot"]);
    expect(out.keys).toEqual([expect.objectContaining({ bot: "api-bot", label: "app", masked: `${key.slice(0, 8)}…` })]);
    expect(out.commands.map((c) => [c.bot, c.name])).toEqual([["keybot", "short"], ["api-bot", "go"]]);
    expect(out.memory).toEqual([{ bot: "api-bot", facts: ["I train at 6"], summary: "" }, { bot: "all your bots", facts: ["I train at 6"], summary: "" }]);
    expect(JSON.stringify(out)).not.toContain(key);
    expect(await r.bots.exportAll(BOB)).toMatchObject({ bots: [], keys: [], commands: [], memory: [] });
  });
});
