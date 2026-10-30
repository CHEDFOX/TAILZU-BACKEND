/**
 * THE BOTS PLATFORM, IN ONE PLACE: WHAT A PERSON'S BOTS ARE, WHAT THEY MAY DO, AND WHO MAY ASK THEM.
 *
 *   list / get / create / update / remove   a person's bots, and the four Tailzu ships (builtin.ts); a built-in is read-only
 *   draft / approve / test                  make a bot from a sentence (builder.ts), save it only when the person approves, talk to a draft before saving
 *   ask                                     the owner talks to a bot (run.ts), `/name` runs a saved command (commands.ts)
 *   askWithKey                              the endpoint for the person's own apps: a key per bot, hashed, revocable, rate-limited, budgeted
 *   createKey / listKeys / revokeKey        keys: shown once, then only a masked prefix
 *   commands / memory / connectors          saved commands, what a bot remembers (and forgetting it), the apps linked to a bot
 *   target                                  "Ask any bot": the front door's pick of a bot for a message, or a bot the person chose (door.ts)
 *   card / exportAll                        the public card (off unless the owner turns it on), and everything a person holds, for the export
 *
 * OWNER ONLY. Every method but `card` and `askWithKey` takes the signed-in person's id and finds a bot only among theirs and the four built-ins: another
 * person's bot is "not found", never "not yours". `askWithKey` is the owner's own app talking: it finds the bot by the key's hash, refuses a key that is
 * for another bot, and runs as the owner (their apps, their money, their files) but never touches the owner's memory: an API caller is a customer of
 * the owner's, not the owner.
 *
 * THE MONEY. A request is held to the smaller of the bot's per-request budget, what is left of its day (per owner and bot), and for a key what is left of
 * the key's day. The day's meters are in memory like every other limit of the server (a restart forgets a day at most).
 */
import { randomUUID } from "node:crypto";
import { Limiter, SpendMeter } from "../artifacts/limits.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import type { CallFn } from "../code/work/model.js";
import { getConfig } from "../config.js";
import type { Guard } from "../guard/index.js";
import type { FrontCtx } from "../front/types.js";
import { builtinBot, builtinBots, CODE_SLUG, colourFor, isBuiltinSlug } from "./builtin.js";
import { draftBot, type Draft } from "./builder.js";
import { checkCommand, expand } from "./commands.js";
import { pickBot } from "./door.js";
import { bearerKey, hashKey, maskKey, newKey, prefixOf } from "./keys.js";
import { runBot } from "./run.js";
import type { BotPorts } from "./ports.js";
import type { Attached, Turn } from "./prompt.js";
import { botStore, SlugTaken, type BotStore, type Command, type Fact, type KeyRow } from "./store.js";
import { BotError, LIMITS, type BotAnswer, type BotDef, type BotEvent, type BotView, type StoredBot } from "./types.js";
import { parseBotInput, slugOf, type CleanInput, type Limits } from "./validate.js";
import { isLeaving, LEAVING_MESSAGE } from "../you/deletion.js";

export interface ServiceLimits extends Limits {
  botsMax: number;
  keyRatePerMin: number;
  keyDailyPaise: number;
  /** What the test console may spend for one person in a day. */
  testDailyPaise: number;
  keysPerBot: number;
  draftsPerHour: number;
}

export function limitsFromConfig(): ServiceLimits {
  const c = getConfig();
  return {
    requestMax: c.BOT_REQUEST_PAISE_MAX, dailyMax: c.BOT_DAILY_PAISE_MAX, requestDefault: c.BOT_REQUEST_PAISE, dailyDefault: c.BOT_DAILY_PAISE,
    botsMax: c.BOTS_MAX, keyRatePerMin: c.BOT_KEY_RATE_PER_MIN, keyDailyPaise: c.BOT_KEY_DAILY_PAISE, testDailyPaise: c.BOT_DAILY_PAISE, keysPerBot: 5, draftsPerHour: 10,
  };
}

export interface BotsOptions {
  store?: BotStore;
  ports?: BotPorts;
  call?: CallFn;
  gateway?: GatewayDeps;
  guard?: Guard;
  /** BOT_KEY_PEPPER, instead of the config's. Null: no key can be made or used. */
  pepper?: string | null;
  limits?: Partial<ServiceLimits>;
  now?: () => number;
  /**
   * Whether a person's bots are stopped: their account waits to be deleted (you/deletion.ts isLeaving, the default). Their bots
   * answer nobody, the owner included, and their keys do not work, until Keep my account.
   */
  stopped?: (userId: string) => Promise<boolean>;
}

/** What the person is shown of a key: never the key. */
export interface KeyView { id: string; label: string; masked: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null; active: boolean }

export interface AskInput {
  message: string;
  projectId?: string;
  history?: Turn[];
  signal?: AbortSignal;
  emit?: (e: BotEvent) => void;
  ctx?: Pick<FrontCtx, "attachments" | "recent" | "mode">;
  pickedBy?: BotAnswer["pickedBy"];
  /** Files attached to the message, already read, and what that cost (the front door reads them): see run.ts. */
  attached?: Attached[];
  extraPaise?: number;
  /** The answer's words as they are written, and word that the ones so far are void (run.ts). */
  onText?: (piece: string) => void;
  onReset?: () => void;
}

export interface KeyAnswer {
  answer: BotAnswer;
  /** What the key may still spend today, in paise. */
  leftTodayPaise: number;
}

/** Where "Ask any bot" sends a message. */
export type Target =
  | { kind: "front"; bot: BotDef | null; by: "name" | "rules" | "model" | "chosen" | "none"; message: string; confidence: number; reasons: string[]; paise: number }
  | { kind: "bot"; bot: BotDef; by: "name" | "rules" | "model" | "chosen"; message: string; confidence: number; reasons: string[]; paise: number };

const notFound = (): BotError => new BotError("not_found", "There is no such bot.", 404);

const defOf = (b: StoredBot): BotDef => ({
  id: b.id, ownerId: b.ownerId, slug: b.slug, name: b.name, colour: b.colour, purpose: b.purpose, principles: [...b.principles],
  skills: { ...b.skills, connectors: [...b.skills.connectors] }, knowledge: [...b.knowledge], tone: b.tone, visibility: "private", budgets: { ...b.budgets },
});

export function viewOf(def: BotDef, stored?: Pick<StoredBot, "publicCard" | "createdAt" | "updatedAt"> | null): BotView {
  return { ...def, builtin: def.ownerId === null, publicCard: stored?.publicCard ?? false, createdAt: stored?.createdAt ?? null, updatedAt: stored?.updatedAt ?? null };
}

const keyView = (k: KeyRow): KeyView => ({ id: k.id, label: k.label, masked: maskKey(k.prefix), createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, active: k.revokedAt === null });

/** What anyone may see of a bot whose owner turned the card on: no rules, no apps, no files, no owner. */
export interface Card { slug: string; name: string; colour: BotDef["colour"]; purpose: string; skills: { web: boolean; files: boolean; artifacts: boolean; code: boolean; research: boolean } }

export class Bots {
  readonly store: BotStore;
  readonly ports: BotPorts;
  private readonly call: CallFn | undefined;
  private readonly gateway: GatewayDeps | undefined;
  private readonly now: () => number;
  private readonly pepper: string | null;
  readonly limits: ServiceLimits;
  readonly guard: Guard | undefined;
  private readonly daily: SpendMeter;
  private readonly keyDaily: SpendMeter;
  private readonly keyRate: Limiter;
  private readonly draftRate: Limiter;
  private readonly stopped: (userId: string) => Promise<boolean>;

  constructor(o: BotsOptions = {}) {
    this.now = o.now ?? Date.now;
    this.store = o.store ?? botStore();
    this.ports = o.ports ?? {};
    this.call = o.call;
    this.gateway = o.gateway;
    this.guard = o.guard;
    this.limits = { ...limitsFromConfig(), ...(o.limits ?? {}) };
    this.pepper = o.pepper !== undefined ? o.pepper : getConfig().BOT_KEY_PEPPER || null;
    const clock = { now: this.now };
    this.daily = new SpendMeter(Number.MAX_SAFE_INTEGER, clock);
    this.keyDaily = new SpendMeter(Number.MAX_SAFE_INTEGER, clock);
    this.keyRate = new Limiter(this.limits.keyRatePerMin, 60_000, clock);
    this.draftRate = new Limiter(this.limits.draftsPerHour, 3_600_000, clock);
    this.stopped = o.stopped ?? ((userId) => isLeaving(userId));
  }

  /** Nothing runs for a person whose bots are stopped (their account waits to be deleted). */
  private async notStopped(userId: string): Promise<void> {
    if (await this.stopped(userId)) throw new BotError("account_leaving", LEAVING_MESSAGE, 403);
  }

  // ------------------------------------------------------------------ finding

  /** One of the person's bots or a built-in, by id or slug. */
  async resolve(userId: string, ref: string): Promise<{ def: BotDef; stored: StoredBot | null } | null> {
    if (typeof ref !== "string" || !ref || ref.length > 64) return null;
    const own = await this.store.getBot(userId, ref.toLowerCase());
    if (own) return { def: defOf(own), stored: own };
    const built = builtinBot(ref.toLowerCase());
    return built ? { def: built, stored: null } : null;
  }

  private async mine(userId: string, ref: string): Promise<StoredBot> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    if (!found.stored) throw new BotError("builtin", "This is one of X0 Bot's own bots. It can't be changed, but you can give it commands and read its memory.", 403);
    return found.stored;
  }

  async list(userId: string): Promise<BotView[]> {
    return [...builtinBots().map((b) => viewOf(b)), ...(await this.store.listBots(userId)).map((b) => viewOf(defOf(b), b))];
  }

  async get(userId: string, ref: string): Promise<BotView> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    return viewOf(found.def, found.stored);
  }

  /** Every bot a person can ask, as definitions. */
  async defs(userId: string): Promise<BotDef[]> {
    return [...builtinBots(), ...(await this.store.listBots(userId)).map(defOf)];
  }

  // ------------------------------------------------------------------ making

  private parse(raw: unknown): { value: CleanInput; warnings: string[] } {
    const p = parseBotInput(raw, this.limits);
    if (!p.ok) throw new BotError("bad_request", p.errors[0]!, 400, { errors: p.errors });
    return { value: p.value, warnings: p.warnings };
  }

  /** The files must be the person's own, and the apps must be ones Tailzu has. Returns what to warn about. */
  private async check(userId: string, v: CleanInput): Promise<string[]> {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (v.knowledge.length) {
      const media = this.ports.media;
      if (!media) errors.push("knowledge: files aren't switched on on this server");
      else {
        for (const id of v.knowledge) {
          const item = await media.store.get(userId, id, { light: true }).catch(() => null);
          if (!item) errors.push(`knowledge: you don't have the file ${id.slice(0, 8)}…`);
        }
      }
    }
    const apps = v.skills.connectors;
    if (apps.length) {
      const conn = this.ports.connectors;
      if (!conn) warnings.push("Connected apps aren't switched on on this server, so this bot can't use the apps it lists yet.");
      else {
        const status = await conn.status(userId, apps).catch(() => []);
        for (const s of status) {
          if (s.status === "unavailable") errors.push(`skills.connectors: X0 Bot has no app called "${s.id}"`);
          else if (s.status === "not_connected") warnings.push(`Not connected yet: ${s.name}. Connect it in X0 Bot to let this bot use it.`);
        }
      }
    }
    if (errors.length) throw new BotError("bad_request", errors[0]!, 400, { errors });
    return warnings;
  }

  async create(userId: string, raw: unknown): Promise<{ bot: BotView; warnings: string[] }> {
    const { value, warnings } = this.parse(raw);
    if ((await this.store.countBots(userId)) >= this.limits.botsMax) throw new BotError("bot_limit", `You can have ${this.limits.botsMax} bots of your own. Remove one to make another.`, 409);
    const more = await this.check(userId, value);
    const mine = await this.store.listBots(userId);
    const now = this.now();
    let slug = value.slug ?? slugOf(value.name);
    if (value.slug && (isBuiltinSlug(slug) || (await this.store.getBySlug(slug)))) throw new BotError("slug_taken", "That address is taken. Pick another.", 409);
    const stored: StoredBot = {
      id: randomUUID(), ownerId: userId, slug, name: value.name, colour: value.colour ?? colourFor(slug, mine.map((b) => b.colour)), purpose: value.purpose, principles: value.principles,
      skills: value.skills, knowledge: value.knowledge, tone: value.tone, visibility: "private", budgets: value.budgets, publicCard: value.publicCard === true, createdAt: now, updatedAt: now,
    };
    // A slug made from the name is made different until it is free; one the person typed is theirs to fix.
    for (let i = 0; ; i += 1) {
      try { await this.store.putBot(stored); break; } catch (err) {
        if (!(err instanceof SlugTaken)) throw err;
        if (value.slug || i >= 5) throw new BotError("slug_taken", "That address is taken. Pick another.", 409);
        slug = slugOf(value.name, Math.random().toString(36).slice(2, 6));
        stored.slug = slug;
      }
    }
    return { bot: viewOf(defOf(stored), stored), warnings: [...warnings, ...more] };
  }

  /** The person read a draft, changed what they wanted, and approved it: this is the only thing that saves one. */
  async approve(userId: string, body: unknown): Promise<{ bot: BotView; warnings: string[] }> {
    const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as { definition?: unknown; approved?: unknown };
    if (b.approved !== undefined && b.approved !== true) throw new BotError("not_approved", "Nothing is saved until you approve it.", 400);
    if (!b.definition) throw new BotError("bad_request", "definition is the draft, with your changes.");
    return this.create(userId, b.definition);
  }

  async update(userId: string, ref: string, patch: unknown): Promise<{ bot: BotView; warnings: string[] }> {
    const cur = await this.mine(userId, ref);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new BotError("bad_request", "The body is a JSON object with what to change.");
    const p = patch as Record<string, unknown>;
    const merged = {
      name: cur.name, slug: cur.slug, colour: cur.colour, purpose: cur.purpose, principles: cur.principles, skills: cur.skills, knowledge: cur.knowledge, tone: cur.tone,
      visibility: "private", budgets: cur.budgets, publicCard: cur.publicCard, ...p,
      // A change to one skill keeps the others.
      ...(p.skills && typeof p.skills === "object" && !Array.isArray(p.skills) ? { skills: { ...cur.skills, ...(p.skills as object) } } : {}),
      ...(p.budgets && typeof p.budgets === "object" && !Array.isArray(p.budgets) ? { budgets: { ...cur.budgets, ...(p.budgets as object) } } : {}),
    };
    const { value, warnings } = this.parse(merged);
    const more = await this.check(userId, value);
    if (value.slug && value.slug !== cur.slug && (isBuiltinSlug(value.slug) || (await this.store.getBySlug(value.slug)))) throw new BotError("slug_taken", "That address is taken. Pick another.", 409);
    let next: StoredBot | null;
    try {
      next = await this.store.updateBot(userId, cur.id, {
        slug: value.slug ?? cur.slug, name: value.name, colour: value.colour ?? cur.colour, purpose: value.purpose, principles: value.principles, skills: value.skills,
        knowledge: value.knowledge, tone: value.tone, budgets: value.budgets, publicCard: value.publicCard ?? cur.publicCard,
      }, this.now());
    } catch (err) {
      if (err instanceof SlugTaken) throw new BotError("slug_taken", "That address is taken. Pick another.", 409);
      throw err;
    }
    if (!next) throw notFound();
    return { bot: viewOf(defOf(next), next), warnings: [...warnings, ...more] };
  }

  async remove(userId: string, ref: string): Promise<void> {
    const cur = await this.mine(userId, ref);
    if (!(await this.store.deleteBot(userId, cur.id))) throw notFound();
  }

  // ------------------------------------------------------------------ the maker

  /** A draft from one sentence. Nothing is written. */
  async draft(userId: string, sentence: unknown, signal?: AbortSignal): Promise<Draft> {
    if (typeof sentence !== "string") throw new BotError("bad_request", "sentence is what the bot is for, in a sentence.");
    if (!this.draftRate.allow(userId)) throw new BotError("rate_limited", "That's a lot of drafts. Try again in a little while.", 429, { retryAfterSec: this.draftRate.retryAfterSec(userId) });
    return draftBot({ store: this.store, connectors: this.ports.connectors, call: this.call, gateway: this.gateway, limits: this.limits }, userId, sentence, signal);
  }

  /** A chat with a draft that was never saved: the test console. Nothing is kept: no memory, no key, no row. */
  async test(userId: string, definition: unknown, input: AskInput): Promise<BotAnswer> {
    await this.notStopped(userId);
    const { value } = this.parse(definition);
    await this.check(userId, value);
    const message = this.messageOf(input.message);
    const left = Math.max(0, this.limits.testDailyPaise - this.daily.usedPaise(`${userId}|test`));
    if (left <= 0) throw new BotError("bot_daily_limit", "You've used what the test console may spend today. It starts again tomorrow.", 429);
    const def: BotDef = {
      id: "draft", ownerId: userId, slug: value.slug ?? slugOf(value.name), name: value.name, colour: value.colour ?? "stone", purpose: value.purpose, principles: value.principles,
      skills: value.skills, knowledge: value.knowledge, tone: value.tone, visibility: "private", budgets: value.budgets,
    };
    const answer = await runBot(this.runDeps(), {
      bot: def, userId, message, surface: "test", capPaise: Math.min(def.budgets.perRequestPaise, left), ...this.rest(input),
    });
    this.daily.add(`${userId}|test`, answer.paise);
    return answer;
  }

  // ------------------------------------------------------------------ asking

  private runDeps() {
    return { store: this.store, ports: this.ports, ...(this.call ? { call: this.call } : {}), ...(this.gateway ? { gateway: this.gateway } : {}), now: this.now };
  }

  private rest(i: AskInput) {
    return {
      ...(i.projectId ? { projectId: i.projectId } : {}), ...(i.history?.length ? { history: i.history } : {}), ...(i.signal ? { signal: i.signal } : {}),
      ...(i.emit ? { emit: i.emit } : {}), ...(i.ctx ? { ctx: i.ctx } : {}), ...(i.pickedBy ? { pickedBy: i.pickedBy } : {}),
      ...(i.attached?.length ? { attached: i.attached } : {}), ...(i.extraPaise ? { extraPaise: i.extraPaise } : {}),
      ...(i.onText ? { onText: i.onText } : {}), ...(i.onReset ? { onReset: i.onReset } : {}),
    };
  }

  private messageOf(m: unknown): string {
    if (typeof m !== "string" || !m.trim()) throw new BotError("bad_request", "message is what the person said.");
    if (m.length > LIMITS.message) throw new BotError("too_large", `A message may be ${LIMITS.message} characters at most.`, 413);
    return m.trim();
  }

  private dailyLeft(userId: string, def: BotDef): number {
    return Math.max(0, def.budgets.dailyPaise - this.daily.usedPaise(`${userId}|${def.id}`));
  }

  /** The owner talks to a bot. A message that starts with /name and names one of its commands runs the command. */
  async ask(userId: string, ref: string, input: AskInput): Promise<BotAnswer> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    const def = found.def;
    if (def.slug === CODE_SLUG) throw new BotError("code_bot", "Xode answers through the front door (POST /v1/ask).", 409);
    await this.notStopped(userId);
    let message = this.messageOf(input.message);
    const ran = expand(await this.store.listCommands(userId, def.id), message);
    if (ran) message = ran.message;
    const left = this.dailyLeft(userId, def);
    if (left <= 0) throw new BotError("bot_daily_limit", `${def.name} has used its budget for today. It starts again tomorrow, or you can raise it in the bot's settings.`, 429);
    const answer = await runBot(this.runDeps(), {
      bot: def, userId, message, surface: ran ? "command" : "chat", capPaise: Math.min(def.budgets.perRequestPaise, left), ...this.rest(input),
    });
    this.daily.add(`${userId}|${def.id}`, answer.paise);
    return answer;
  }

  /**
   * The endpoint for the person's own apps. `authorization` is the Authorization header, `slug` the address in the path.
   * Throws BotError: 401 for a key that is not one of ours, unknown or revoked (the same words for each), 403 for a good key of another bot,
   * 429 (with retryAfterSec) over the key's rate or either day, 503 when the server has no pepper.
   */
  async askWithKey(authorization: string | string[] | undefined, slug: string, input: AskInput): Promise<KeyAnswer> {
    if (!this.pepper) throw new BotError("not_configured", "API keys aren't set up on this server.", 503);
    const key = bearerKey(authorization);
    const row = key ? await this.store.findKey(hashKey(key, this.pepper)) : null;
    if (!row || row.revokedAt !== null) throw new BotError("invalid_key", "That key doesn't work. Make a new one in the bot's settings.", 401);
    const stored = await this.store.getById(row.botId);
    if (!stored) throw new BotError("invalid_key", "That key doesn't work. Make a new one in the bot's settings.", 401);
    if (stored.slug !== slug) throw new BotError("wrong_bot", "This key is for a different bot.", 403);
    // The owner's account waits to be deleted: the key does not work until they keep it. The caller is not told why.
    if (await this.stopped(stored.ownerId!)) throw new BotError("invalid_key", "That key doesn't work right now.", 401);
    if (!this.keyRate.allow(row.id)) {
      throw new BotError("rate_limited", `That's more than ${this.limits.keyRatePerMin} requests a minute for one key. Slow down.`, 429, { retryAfterSec: this.keyRate.retryAfterSec(row.id) });
    }
    const def = defOf(stored);
    const keyLeft = Math.max(0, this.limits.keyDailyPaise - this.keyDaily.usedPaise(row.id));
    if (keyLeft <= 0) throw new BotError("key_daily_limit", "This key has used what it may spend today. It starts again tomorrow.", 429, { retryAfterSec: 3600 });
    const botLeft = this.dailyLeft(stored.ownerId!, def);
    if (botLeft <= 0) throw new BotError("bot_daily_limit", "This bot has used its budget for today.", 429, { retryAfterSec: 3600 });
    const message = this.messageOf(input.message);
    void this.store.touchKey(row.id, this.now()).catch(() => undefined);
    const answer = await runBot(this.runDeps(), {
      bot: def, userId: stored.ownerId!, message, surface: "api", capPaise: Math.min(def.budgets.perRequestPaise, keyLeft, botLeft), ...this.rest(input),
    });
    this.keyDaily.add(row.id, answer.paise);
    this.daily.add(`${stored.ownerId}|${def.id}`, answer.paise);
    return { answer, leftTodayPaise: Math.max(0, this.limits.keyDailyPaise - this.keyDaily.usedPaise(row.id)) };
  }

  /** Which bot a key is for, without asking it anything: so the route can guard the right person. */
  async ownerOfKey(authorization: string | string[] | undefined): Promise<string | null> {
    if (!this.pepper) return null;
    const key = bearerKey(authorization);
    const row = key ? await this.store.findKey(hashKey(key, this.pepper)) : null;
    return row && row.revokedAt === null ? row.userId : null;
  }

  // ------------------------------------------------------------------ the front door

  /** "Ask any bot" (`bot` is "any"), or a bot the person chose: where the message goes. */
  async target(userId: string, bot: string, message: string, ctx: Pick<FrontCtx, "projectId" | "attachments" | "recent" | "mode">, signal?: AbortSignal): Promise<Target> {
    if (bot === "any" || bot === "auto") {
      // Which apps they have connected: a bot given an app they have not connected is no better a fit for it.
      const apps = await this.ports.connectors?.catalog(userId).catch(() => null);
      const connected = apps ? new Set(apps.filter((a) => a.connected).map((a) => a.id)) : undefined;
      const picked = await pickBot({ ...(connected ? { connected } : {}), ...(this.call ? { call: this.call } : {}), ...(this.gateway ? { gateway: this.gateway } : {}), ...(signal ? { signal } : {}) }, userId, message, await this.defs(userId), ctx);
      if (!picked.bot || picked.bot.slug === CODE_SLUG) {
        return { kind: "front", bot: picked.bot, by: picked.by === "none" ? "none" : picked.by, message: picked.message, confidence: picked.confidence, reasons: picked.reasons, paise: picked.paise };
      }
      return { kind: "bot", bot: picked.bot, by: picked.by === "none" ? "rules" : picked.by, message: picked.message, confidence: picked.confidence, reasons: picked.reasons, paise: picked.paise };
    }
    const found = await this.resolve(userId, bot);
    if (!found) throw notFound();
    if (found.def.slug === CODE_SLUG) return { kind: "front", bot: found.def, by: "chosen", message, confidence: 1, reasons: ["chosen"], paise: 0 };
    return { kind: "bot", bot: found.def, by: "chosen", message, confidence: 1, reasons: ["chosen"], paise: 0 };
  }

  // ------------------------------------------------------------------ keys

  async createKey(userId: string, ref: string, label: unknown): Promise<{ key: string; view: KeyView }> {
    const bot = await this.mine(userId, ref);
    if (!this.pepper) throw new BotError("not_configured", "API keys aren't set up on this server yet.", 503);
    const text = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (label !== undefined && typeof label !== "string") throw new BotError("bad_request", "label is a short name for the key.");
    const active = (await this.store.listKeys(userId, bot.id)).filter((k) => k.revokedAt === null);
    if (active.length >= this.limits.keysPerBot) throw new BotError("key_limit", `A bot may have ${this.limits.keysPerBot} keys at once. Revoke one to make another.`, 409);
    const key = newKey();
    const row = await this.store.addKey({ id: randomUUID(), botId: bot.id, userId, hash: hashKey(key, this.pepper), prefix: prefixOf(key), label: text, createdAt: this.now(), lastUsedAt: null, revokedAt: null });
    return { key, view: keyView(row) };
  }

  async listKeys(userId: string, ref: string): Promise<KeyView[]> {
    const bot = await this.mine(userId, ref);
    return (await this.store.listKeys(userId, bot.id)).map(keyView);
  }

  async revokeKey(userId: string, ref: string, keyId: string): Promise<void> {
    const bot = await this.mine(userId, ref);
    if (!(await this.store.revokeKey(userId, bot.id, keyId, this.now()))) throw new BotError("not_found", "There is no such key.", 404);
  }

  // ------------------------------------------------------------------ commands

  async listCommands(userId: string, ref: string): Promise<Command[]> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    return this.store.listCommands(userId, found.def.id);
  }

  async putCommand(userId: string, ref: string, body: unknown): Promise<Command> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    const c = checkCommand((body && typeof body === "object" ? body : {}) as { name?: unknown; template?: unknown });
    if (!c.ok) throw new BotError("bad_request", c.error);
    const have = await this.store.listCommands(userId, found.def.id);
    if (!have.some((x) => x.name === c.name) && have.length >= LIMITS.command.perBot) throw new BotError("command_limit", `A bot may have ${LIMITS.command.perBot} commands.`, 409);
    return this.store.putCommand(userId, found.def.id, { name: c.name, template: c.template }, this.now());
  }

  async removeCommand(userId: string, ref: string, name: string): Promise<void> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    if (!(await this.store.deleteCommand(userId, found.def.id, String(name).toLowerCase().replace(/^\//, "")))) throw new BotError("not_found", "There is no such command.", 404);
  }

  // ------------------------------------------------------------------ memory

  async memory(userId: string, ref: string): Promise<{ facts: Fact[]; summary: string; turns: number }> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    const [facts, thread] = await Promise.all([this.store.listFacts(userId, found.def.id), this.store.getThread(userId, found.def.id)]);
    return { facts, summary: thread?.summary ?? "", turns: thread?.turns ?? 0 };
  }

  /** Forgets one fact, or all of it (the facts and the summary). */
  async forget(userId: string, ref: string, factId?: string): Promise<{ forgotten: number }> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    if (factId !== undefined) {
      if (!(await this.store.dropFact(userId, found.def.id, factId))) throw new BotError("not_found", "There is no such memory.", 404);
      return { forgotten: 1 };
    }
    const r = await this.store.clearMemory(userId, found.def.id);
    return { forgotten: r.facts };
  }

  // ------------------------------------------------------------------ connected apps

  /** The apps linked to a bot, each with whether this person has it connected. */
  async connectors(userId: string, ref: string): Promise<Array<{ id: string; name: string; status: string }>> {
    const found = await this.resolve(userId, ref);
    if (!found) throw notFound();
    const ids = found.def.skills.connectors;
    if (!ids.length) return [];
    return this.ports.connectors ? this.ports.connectors.status(userId, ids) : ids.map((id) => ({ id, name: id, status: "unavailable" }));
  }

  async link(userId: string, ref: string, connectorId: string): Promise<{ bot: BotView; warnings: string[] }> {
    const cur = await this.mine(userId, ref);
    const ids = [...new Set([...cur.skills.connectors, String(connectorId).toLowerCase()])];
    return this.update(userId, cur.id, { skills: { connectors: ids } });
  }

  async unlink(userId: string, ref: string, connectorId: string): Promise<{ bot: BotView; warnings: string[] }> {
    const cur = await this.mine(userId, ref);
    const id = String(connectorId).toLowerCase();
    if (!cur.skills.connectors.includes(id)) throw new BotError("not_found", "That app isn't linked to this bot.", 404);
    return this.update(userId, cur.id, { skills: { connectors: cur.skills.connectors.filter((x) => x !== id) } });
  }

  // ------------------------------------------------------------------ the card, and everything a person holds

  /** The card of a bot whose owner turned it on. Null for anything else: a bot that is private is not said to exist. */
  async card(slug: string): Promise<Card | null> {
    if (typeof slug !== "string" || !slug || slug.length > 64) return null;
    const b = await this.store.getBySlug(slug.toLowerCase());
    if (!b || !b.publicCard) return null;
    return { slug: b.slug, name: b.name, colour: b.colour, purpose: b.purpose, skills: { web: b.skills.web, files: b.skills.files, artifacts: b.skills.artifacts, code: b.skills.code, research: b.skills.research } };
  }

  /** Everything a person holds here, for the export: their bots, keys (masked), commands and what their bots remember. */
  async exportAll(userId: string): Promise<{
    bots: BotView[]; keys: Array<KeyView & { bot: string }>; commands: Array<Command & { bot: string }>;
    memory: Array<{ bot: string; facts: string[]; summary: string }>; exportedAt: number;
  }> {
    const mine = await this.store.listBots(userId);
    const everyone = [...builtinBots().map((b) => ({ id: b.id, slug: b.slug })), ...mine.map((b) => ({ id: b.id, slug: b.slug }))];
    const keys: Array<KeyView & { bot: string }> = [];
    const commands: Array<Command & { bot: string }> = [];
    const memory: Array<{ bot: string; facts: string[]; summary: string }> = [];
    for (const b of mine) for (const k of await this.store.listKeys(userId, b.id)) keys.push({ ...keyView(k), bot: b.slug });
    for (const b of everyone) {
      for (const c of await this.store.listCommands(userId, b.id)) commands.push({ ...c, bot: b.slug });
      const [facts, thread] = await Promise.all([this.store.listFacts(userId, b.id), this.store.getThread(userId, b.id)]);
      if (facts.length || thread?.summary) memory.push({ bot: b.slug, facts: facts.map((f) => f.text), summary: thread?.summary ?? "" });
    }
    return { bots: mine.map((b) => viewOf(defOf(b), b)), keys, commands, memory, exportedAt: this.now() };
  }
}

