/**
 * WHAT IS KEPT OF A BOT: ITS DEFINITION, ITS API KEYS (HASHED), ITS SAVED COMMANDS, WHAT IT HAS LEARNED OF ITS OWNER, AND THE TALK SO FAR.
 *
 *   bots          the definition (migration 0038), one row a bot, the slug unique across everyone: it is the bot's address
 *   bot_keys      a key is its sha256-with-a-pepper hash and its first characters, never the key; revoked keys stay as rows, with when
 *   bot_commands  a short instruction template with {{input}}, run from chat as /name
 *   bot_facts     the stable facts a bot learned of its owner, one line each, for them to read and forget
 *   bot_threads   the rolling summary of the talk with the owner, and the last few turns not yet folded into it
 *
 * Everything but the two public lookups (a key's hash, a slug) is the owner's: another person's id finds, changes and deletes nothing. The
 * server writes with the service key; a person's own token can only READ their own rows (owner-only RLS). The built-in bots have no row in
 * `bots`; their commands, facts and thread are kept under their slug as `bot_id`, which is text for that reason.
 *
 * The memory twin is what tests and a server with no Supabase use. Both are bounded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabase } from "../auth/supabase.js";
import { PALETTE, type BotBudgets, type BotSkills, type Colour, type StoredBot } from "./types.js";

export interface KeyRow {
  id: string;
  botId: string;
  userId: string;
  hash: string;
  /** The first characters of the key, so the owner can tell their keys apart. Never enough to use it. */
  prefix: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface Command { name: string; template: string; createdAt: number; updatedAt: number }
export interface Fact { id: string; text: string; createdAt: number }
export interface Thread { summary: string; buffer: string[]; turns: number; updatedAt: number }

/** The tables a person's account owns, for deleting an account and for the export. */
export const BOT_TABLES = ["bots", "bot_keys", "bot_commands", "bot_facts", "bot_threads"] as const;
export const BOT_USER_TABLES = BOT_TABLES;

export class SlugTaken extends Error {
  constructor() { super("slug taken"); this.name = "SlugTaken"; }
}

export interface BotStore {
  listBots(userId: string): Promise<StoredBot[]>;
  /** One of the person's own bots, by id or slug. */
  getBot(userId: string, ref: string): Promise<StoredBot | null>;
  /** Anyone's bot by slug: for the public card and the key door. */
  getBySlug(slug: string): Promise<StoredBot | null>;
  getById(id: string): Promise<StoredBot | null>;
  /** Throws SlugTaken. */
  putBot(bot: StoredBot): Promise<StoredBot>;
  updateBot(userId: string, id: string, patch: Partial<Omit<StoredBot, "id" | "ownerId" | "createdAt">>, now: number): Promise<StoredBot | null>;
  /** The bot with its keys, commands, facts and thread. */
  deleteBot(userId: string, id: string): Promise<boolean>;
  countBots(userId: string): Promise<number>;

  addKey(k: KeyRow): Promise<KeyRow>;
  listKeys(userId: string, botId: string): Promise<KeyRow[]>;
  findKey(hash: string): Promise<KeyRow | null>;
  revokeKey(userId: string, botId: string, keyId: string, now: number): Promise<boolean>;
  touchKey(keyId: string, now: number): Promise<void>;

  listCommands(userId: string, botId: string): Promise<Command[]>;
  putCommand(userId: string, botId: string, c: { name: string; template: string }, now: number): Promise<Command>;
  deleteCommand(userId: string, botId: string, name: string): Promise<boolean>;

  listFacts(userId: string, botId: string): Promise<Fact[]>;
  /** New facts (a fact already there is not added twice), the oldest dropped past `max`. Returns the ones that are new. */
  addFacts(userId: string, botId: string, texts: readonly string[], max: number, now: number): Promise<Fact[]>;
  /** Forgets one fact; false when it is not the person's. */
  dropFact(userId: string, botId: string, factId: string): Promise<boolean>;
  /** Forgets all facts and the thread. */
  clearMemory(userId: string, botId: string): Promise<{ facts: number; thread: boolean }>;
  getThread(userId: string, botId: string): Promise<Thread | null>;
  putThread(userId: string, botId: string, t: Thread): Promise<void>;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const copyBot = (b: StoredBot): StoredBot => ({
  ...b, principles: [...b.principles], skills: { ...b.skills, connectors: [...b.skills.connectors] }, knowledge: [...b.knowledge], budgets: { ...b.budgets },
});

// -------------------------------------------------------------------- memory

const MEMORY_BOTS_MAX = 20_000;

export class MemoryBotStore implements BotStore {
  private readonly bots = new Map<string, StoredBot>();
  private readonly keys = new Map<string, KeyRow>();
  private readonly commands: Array<Command & { userId: string; botId: string }> = [];
  private readonly facts: Array<Fact & { userId: string; botId: string }> = [];
  private readonly threads = new Map<string, Thread>();

  get size(): number { return this.bots.size; }

  async listBots(userId: string): Promise<StoredBot[]> {
    return [...this.bots.values()].filter((b) => b.ownerId === userId).sort((a, b) => a.createdAt - b.createdAt).map(copyBot);
  }

  async getBot(userId: string, ref: string): Promise<StoredBot | null> {
    for (const b of this.bots.values()) if (b.ownerId === userId && (b.id === ref || b.slug === ref)) return copyBot(b);
    return null;
  }

  async getBySlug(slug: string): Promise<StoredBot | null> {
    for (const b of this.bots.values()) if (b.slug === slug) return copyBot(b);
    return null;
  }

  async getById(id: string): Promise<StoredBot | null> {
    const b = this.bots.get(id);
    return b ? copyBot(b) : null;
  }

  async putBot(bot: StoredBot): Promise<StoredBot> {
    if ([...this.bots.values()].some((b) => b.slug === bot.slug)) throw new SlugTaken();
    if (this.bots.size >= MEMORY_BOTS_MAX) throw new Error("bot store: full");
    this.bots.set(bot.id, copyBot(bot));
    return copyBot(bot);
  }

  async updateBot(userId: string, id: string, patch: Partial<Omit<StoredBot, "id" | "ownerId" | "createdAt">>, now: number): Promise<StoredBot | null> {
    const b = this.bots.get(id);
    if (!b || b.ownerId !== userId) return null;
    if (patch.slug && patch.slug !== b.slug && [...this.bots.values()].some((x) => x.slug === patch.slug)) throw new SlugTaken();
    const next: StoredBot = { ...b, ...patch, id: b.id, ownerId: b.ownerId, createdAt: b.createdAt, updatedAt: now };
    this.bots.set(id, copyBot(next));
    return copyBot(next);
  }

  async deleteBot(userId: string, id: string): Promise<boolean> {
    const b = this.bots.get(id);
    if (!b || b.ownerId !== userId) return false;
    this.bots.delete(id);
    for (const [k, v] of this.keys) if (v.botId === id) this.keys.delete(k);
    for (const list of [this.commands, this.facts] as Array<Array<{ userId: string; botId: string }>>) {
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]!.botId === id && list[i]!.userId === userId) list.splice(i, 1);
    }
    this.threads.delete(`${userId}|${id}`);
    return true;
  }

  async countBots(userId: string): Promise<number> {
    return [...this.bots.values()].filter((b) => b.ownerId === userId).length;
  }

  async addKey(k: KeyRow): Promise<KeyRow> {
    this.keys.set(k.id, { ...k });
    return { ...k };
  }

  async listKeys(userId: string, botId: string): Promise<KeyRow[]> {
    return [...this.keys.values()].filter((k) => k.userId === userId && k.botId === botId).sort((a, b) => a.createdAt - b.createdAt).map((k) => ({ ...k }));
  }

  async findKey(hash: string): Promise<KeyRow | null> {
    for (const k of this.keys.values()) if (k.hash === hash) return { ...k };
    return null;
  }

  async revokeKey(userId: string, botId: string, keyId: string, now: number): Promise<boolean> {
    const k = this.keys.get(keyId);
    if (!k || k.userId !== userId || k.botId !== botId) return false;
    if (k.revokedAt === null) k.revokedAt = now;
    return true;
  }

  async touchKey(keyId: string, now: number): Promise<void> {
    const k = this.keys.get(keyId);
    if (k) k.lastUsedAt = now;
  }

  async listCommands(userId: string, botId: string): Promise<Command[]> {
    return this.commands.filter((c) => c.userId === userId && c.botId === botId).sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ name: c.name, template: c.template, createdAt: c.createdAt, updatedAt: c.updatedAt }));
  }

  async putCommand(userId: string, botId: string, c: { name: string; template: string }, now: number): Promise<Command> {
    const had = this.commands.find((x) => x.userId === userId && x.botId === botId && x.name === c.name);
    if (had) { had.template = c.template; had.updatedAt = now; return { name: had.name, template: had.template, createdAt: had.createdAt, updatedAt: now }; }
    const row = { userId, botId, name: c.name, template: c.template, createdAt: now, updatedAt: now };
    this.commands.push(row);
    return { name: row.name, template: row.template, createdAt: now, updatedAt: now };
  }

  async deleteCommand(userId: string, botId: string, name: string): Promise<boolean> {
    const i = this.commands.findIndex((x) => x.userId === userId && x.botId === botId && x.name === name);
    if (i < 0) return false;
    this.commands.splice(i, 1);
    return true;
  }

  async listFacts(userId: string, botId: string): Promise<Fact[]> {
    return this.facts.filter((f) => f.userId === userId && f.botId === botId).map((f) => ({ id: f.id, text: f.text, createdAt: f.createdAt }));
  }

  async addFacts(userId: string, botId: string, texts: readonly string[], max: number, now: number): Promise<Fact[]> {
    const added: Fact[] = [];
    for (const text of texts) {
      if (this.facts.some((f) => f.userId === userId && f.botId === botId && norm(f.text) === norm(text))) continue;
      const row = { id: randomUUID(), userId, botId, text, createdAt: now };
      this.facts.push(row);
      added.push({ id: row.id, text, createdAt: now });
    }
    const mine = this.facts.filter((f) => f.userId === userId && f.botId === botId);
    for (const f of mine.slice(0, Math.max(0, mine.length - max))) this.facts.splice(this.facts.indexOf(f), 1);
    return added;
  }

  async dropFact(userId: string, botId: string, factId: string): Promise<boolean> {
    const i = this.facts.findIndex((f) => f.id === factId && f.userId === userId && f.botId === botId);
    if (i < 0) return false;
    this.facts.splice(i, 1);
    return true;
  }

  async clearMemory(userId: string, botId: string): Promise<{ facts: number; thread: boolean }> {
    let facts = 0;
    for (let i = this.facts.length - 1; i >= 0; i -= 1) if (this.facts[i]!.userId === userId && this.facts[i]!.botId === botId) { this.facts.splice(i, 1); facts += 1; }
    return { facts, thread: this.threads.delete(`${userId}|${botId}`) };
  }

  async getThread(userId: string, botId: string): Promise<Thread | null> {
    const t = this.threads.get(`${userId}|${botId}`);
    return t ? { ...t, buffer: [...t.buffer] } : null;
  }

  async putThread(userId: string, botId: string, t: Thread): Promise<void> {
    this.threads.set(`${userId}|${botId}`, { ...t, buffer: [...t.buffer] });
  }
}

// ------------------------------------------------------------------ supabase

interface BotRow {
  id: string; user_id: string; slug: string; name: string; colour: string; purpose: string; principles: unknown; skills: unknown; knowledge: unknown; tone: string;
  budgets: unknown; public_card: boolean; created_at: string; updated_at: string;
}
interface KeyDbRow { id: string; bot_id: string; user_id: string; key_hash: string; prefix: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (ms: number): string => new Date(ms).toISOString();
const ms = (s: string | null): number | null => (s ? Date.parse(s) || 0 : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const BOT_COLUMNS = "id, user_id, slug, name, colour, purpose, principles, skills, knowledge, tone, budgets, public_card, created_at, updated_at";
const KEY_COLUMNS = "id, bot_id, user_id, key_hash, prefix, label, created_at, last_used_at, revoked_at";

function botOf(r: BotRow): StoredBot {
  const s = (r.skills && typeof r.skills === "object" ? r.skills : {}) as Partial<BotSkills>;
  const b = (r.budgets && typeof r.budgets === "object" ? r.budgets : {}) as Partial<BotBudgets>;
  return {
    id: r.id, ownerId: r.user_id, slug: r.slug, name: r.name, colour: (PALETTE as readonly string[]).includes(r.colour) ? (r.colour as Colour) : "stone", purpose: r.purpose,
    principles: strings(r.principles),
    skills: { web: s.web === true, files: s.files === true, artifacts: s.artifacts === true, code: s.code === true, research: s.research === true, connectors: strings(s.connectors) },
    knowledge: strings(r.knowledge), tone: r.tone ?? "", visibility: "private",
    budgets: { perRequestPaise: Number(b.perRequestPaise) || 1, dailyPaise: Number(b.dailyPaise) || 1 },
    publicCard: r.public_card === true, createdAt: Date.parse(r.created_at) || 0, updatedAt: Date.parse(r.updated_at) || 0,
  };
}

const keyOf = (r: KeyDbRow): KeyRow => ({
  id: r.id, botId: r.bot_id, userId: r.user_id, hash: r.key_hash, prefix: r.prefix, label: r.label, createdAt: Date.parse(r.created_at) || 0,
  lastUsedAt: ms(r.last_used_at), revokedAt: ms(r.revoked_at),
});

function dbPatch(p: Partial<Omit<StoredBot, "id" | "ownerId" | "createdAt">>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.slug !== undefined) o.slug = p.slug;
  if (p.name !== undefined) o.name = p.name;
  if (p.colour !== undefined) o.colour = p.colour;
  if (p.purpose !== undefined) o.purpose = p.purpose;
  if (p.principles !== undefined) o.principles = p.principles;
  if (p.skills !== undefined) o.skills = p.skills;
  if (p.knowledge !== undefined) o.knowledge = p.knowledge;
  if (p.tone !== undefined) o.tone = p.tone;
  if (p.budgets !== undefined) o.budgets = p.budgets;
  if (p.publicCard !== undefined) o.public_card = p.publicCard;
  return o;
}

const fail = (what: string, error: { message: string }): never => { throw new Error(`bot store: ${what}: ${error.message}`); };

export class SupabaseBotStore implements BotStore {
  constructor(private readonly sb: SupabaseClient) {}

  async listBots(userId: string): Promise<StoredBot[]> {
    const { data, error } = await this.sb.from("bots").select(BOT_COLUMNS).eq("user_id", userId).order("created_at", { ascending: true }).returns<BotRow[]>();
    if (error) fail("list", error);
    return (data ?? []).map(botOf);
  }

  async getBot(userId: string, ref: string): Promise<StoredBot | null> {
    const q = this.sb.from("bots").select(BOT_COLUMNS).eq("user_id", userId);
    const { data, error } = await (UUID.test(ref) ? q.eq("id", ref) : q.eq("slug", ref)).maybeSingle<BotRow>();
    if (error) fail("read", error);
    return data ? botOf(data) : null;
  }

  async getBySlug(slug: string): Promise<StoredBot | null> {
    const { data, error } = await this.sb.from("bots").select(BOT_COLUMNS).eq("slug", slug).maybeSingle<BotRow>();
    if (error) fail("read", error);
    return data ? botOf(data) : null;
  }

  async getById(id: string): Promise<StoredBot | null> {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.sb.from("bots").select(BOT_COLUMNS).eq("id", id).maybeSingle<BotRow>();
    if (error) fail("read", error);
    return data ? botOf(data) : null;
  }

  async putBot(bot: StoredBot): Promise<StoredBot> {
    const { data, error } = await this.sb.from("bots").insert({
      id: bot.id, user_id: bot.ownerId, slug: bot.slug, name: bot.name, colour: bot.colour, purpose: bot.purpose, principles: bot.principles, skills: bot.skills,
      knowledge: bot.knowledge, tone: bot.tone, budgets: bot.budgets, public_card: bot.publicCard, created_at: iso(bot.createdAt), updated_at: iso(bot.updatedAt),
    }).select(BOT_COLUMNS).single<BotRow>();
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new SlugTaken();
      fail("create", error);
    }
    return botOf(data as BotRow);
  }

  async updateBot(userId: string, id: string, patch: Partial<Omit<StoredBot, "id" | "ownerId" | "createdAt">>, now: number): Promise<StoredBot | null> {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.sb.from("bots").update({ ...dbPatch(patch), updated_at: iso(now) }).eq("id", id).eq("user_id", userId).select(BOT_COLUMNS).maybeSingle<BotRow>();
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new SlugTaken();
      fail("update", error);
    }
    return data ? botOf(data) : null;
  }

  async deleteBot(userId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    // The children are text-keyed (a built-in has no row), so they are cleared here; the keys also cascade from the row.
    for (const table of ["bot_commands", "bot_facts", "bot_threads"]) {
      const { error } = await this.sb.from(table).delete().eq("user_id", userId).eq("bot_id", id);
      if (error) fail(`delete ${table}`, error);
    }
    const { data, error } = await this.sb.from("bots").delete().eq("id", id).eq("user_id", userId).select("id");
    if (error) fail("delete", error);
    return (data?.length ?? 0) > 0;
  }

  async countBots(userId: string): Promise<number> {
    const { count, error } = await this.sb.from("bots").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (error) fail("count", error);
    return count ?? 0;
  }

  async addKey(k: KeyRow): Promise<KeyRow> {
    const { data, error } = await this.sb.from("bot_keys").insert({
      id: k.id, bot_id: k.botId, user_id: k.userId, key_hash: k.hash, prefix: k.prefix, label: k.label, created_at: iso(k.createdAt),
    }).select(KEY_COLUMNS).single<KeyDbRow>();
    if (error) fail("add key", error);
    return keyOf(data as KeyDbRow);
  }

  async listKeys(userId: string, botId: string): Promise<KeyRow[]> {
    const { data, error } = await this.sb.from("bot_keys").select(KEY_COLUMNS).eq("user_id", userId).eq("bot_id", botId).order("created_at", { ascending: true }).returns<KeyDbRow[]>();
    if (error) fail("list keys", error);
    return (data ?? []).map(keyOf);
  }

  async findKey(hash: string): Promise<KeyRow | null> {
    const { data, error } = await this.sb.from("bot_keys").select(KEY_COLUMNS).eq("key_hash", hash).maybeSingle<KeyDbRow>();
    if (error) fail("find key", error);
    return data ? keyOf(data) : null;
  }

  async revokeKey(userId: string, botId: string, keyId: string, now: number): Promise<boolean> {
    if (!UUID.test(keyId)) return false;
    const { data, error } = await this.sb.from("bot_keys").update({ revoked_at: iso(now) }).eq("id", keyId).eq("user_id", userId).eq("bot_id", botId).is("revoked_at", null).select("id");
    if (error) fail("revoke key", error);
    if ((data?.length ?? 0) > 0) return true;
    // Already revoked is still the owner's key and still revoked.
    const { data: had, error: e2 } = await this.sb.from("bot_keys").select("id").eq("id", keyId).eq("user_id", userId).eq("bot_id", botId);
    if (e2) fail("revoke key", e2);
    return (had?.length ?? 0) > 0;
  }

  async touchKey(keyId: string, now: number): Promise<void> {
    const { error } = await this.sb.from("bot_keys").update({ last_used_at: iso(now) }).eq("id", keyId);
    if (error) fail("touch key", error);
  }

  async listCommands(userId: string, botId: string): Promise<Command[]> {
    const { data, error } = await this.sb.from("bot_commands").select("name, template, created_at, updated_at").eq("user_id", userId).eq("bot_id", botId).order("name", { ascending: true })
      .returns<Array<{ name: string; template: string; created_at: string; updated_at: string }>>();
    if (error) fail("list commands", error);
    return (data ?? []).map((r) => ({ name: r.name, template: r.template, createdAt: Date.parse(r.created_at) || 0, updatedAt: Date.parse(r.updated_at) || 0 }));
  }

  async putCommand(userId: string, botId: string, c: { name: string; template: string }, now: number): Promise<Command> {
    const { data, error } = await this.sb.from("bot_commands").upsert(
      { user_id: userId, bot_id: botId, name: c.name, template: c.template, updated_at: iso(now) }, { onConflict: "user_id,bot_id,name" },
    ).select("name, template, created_at, updated_at").single<{ name: string; template: string; created_at: string; updated_at: string }>();
    if (error) fail("save command", error);
    const r = data as { name: string; template: string; created_at: string; updated_at: string };
    return { name: r.name, template: r.template, createdAt: Date.parse(r.created_at) || now, updatedAt: Date.parse(r.updated_at) || now };
  }

  async deleteCommand(userId: string, botId: string, name: string): Promise<boolean> {
    const { data, error } = await this.sb.from("bot_commands").delete().eq("user_id", userId).eq("bot_id", botId).eq("name", name).select("name");
    if (error) fail("delete command", error);
    return (data?.length ?? 0) > 0;
  }

  async listFacts(userId: string, botId: string): Promise<Fact[]> {
    const { data, error } = await this.sb.from("bot_facts").select("id, fact, created_at").eq("user_id", userId).eq("bot_id", botId).order("created_at", { ascending: true })
      .returns<Array<{ id: string; fact: string; created_at: string }>>();
    if (error) fail("list facts", error);
    return (data ?? []).map((r) => ({ id: r.id, text: r.fact, createdAt: Date.parse(r.created_at) || 0 }));
  }

  async addFacts(userId: string, botId: string, texts: readonly string[], max: number, now: number): Promise<Fact[]> {
    const have = await this.listFacts(userId, botId);
    const seen = new Set(have.map((f) => norm(f.text)));
    const fresh = texts.filter((t) => { const k = norm(t); if (seen.has(k)) return false; seen.add(k); return true; });
    let added: Fact[] = [];
    if (fresh.length) {
      const { data, error } = await this.sb.from("bot_facts").insert(fresh.map((fact) => ({ user_id: userId, bot_id: botId, fact, created_at: iso(now) })))
        .select("id, fact, created_at").returns<Array<{ id: string; fact: string; created_at: string }>>();
      if (error) fail("add facts", error);
      added = (data ?? []).map((r) => ({ id: r.id, text: r.fact, createdAt: Date.parse(r.created_at) || now }));
    }
    const over = have.length + added.length - max;
    if (over > 0) {
      const old = have.slice(0, over).map((f) => f.id);
      const { error } = await this.sb.from("bot_facts").delete().eq("user_id", userId).eq("bot_id", botId).in("id", old);
      if (error) fail("trim facts", error);
    }
    return added;
  }

  async dropFact(userId: string, botId: string, factId: string): Promise<boolean> {
    if (!UUID.test(factId)) return false;
    const { data, error } = await this.sb.from("bot_facts").delete().eq("id", factId).eq("user_id", userId).eq("bot_id", botId).select("id");
    if (error) fail("drop fact", error);
    return (data?.length ?? 0) > 0;
  }

  async clearMemory(userId: string, botId: string): Promise<{ facts: number; thread: boolean }> {
    const f = await this.sb.from("bot_facts").delete().eq("user_id", userId).eq("bot_id", botId).select("id");
    if (f.error) fail("forget facts", f.error);
    const t = await this.sb.from("bot_threads").delete().eq("user_id", userId).eq("bot_id", botId).select("bot_id");
    if (t.error) fail("forget thread", t.error);
    return { facts: f.data?.length ?? 0, thread: (t.data?.length ?? 0) > 0 };
  }

  async getThread(userId: string, botId: string): Promise<Thread | null> {
    const { data, error } = await this.sb.from("bot_threads").select("summary, buffer, turns, updated_at").eq("user_id", userId).eq("bot_id", botId)
      .maybeSingle<{ summary: string; buffer: unknown; turns: number; updated_at: string }>();
    if (error) fail("read thread", error);
    return data ? { summary: data.summary ?? "", buffer: strings(data.buffer), turns: Number(data.turns) || 0, updatedAt: Date.parse(data.updated_at) || 0 } : null;
  }

  async putThread(userId: string, botId: string, t: Thread): Promise<void> {
    const { error } = await this.sb.from("bot_threads").upsert(
      { user_id: userId, bot_id: botId, summary: t.summary, buffer: t.buffer, turns: t.turns, updated_at: iso(t.updatedAt) }, { onConflict: "user_id,bot_id" },
    );
    if (error) fail("keep thread", error);
  }
}

// ------------------------------------------------------------------ the one

let current: BotStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function botStore(): BotStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseBotStore(sb) : new MemoryBotStore();
  }
  return current;
}

export function resetBotStoreForTests(): void { current = null; }
