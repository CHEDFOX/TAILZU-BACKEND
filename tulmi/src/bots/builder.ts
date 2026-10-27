/**
 * MAKE A BOT FROM ONE SENTENCE: A DRAFT FOR THE PERSON TO EDIT AND APPROVE, AND NOTHING SAVED.
 *
 *   draftBot(deps, userId, sentence) -> { definition, tests, connectors, warnings, paise, tier }
 *
 * "A bot that plans my workouts and checks my calendar" becomes a definition (name, purpose, colour, a few rules of the owner's own, the skills, the
 * tone), three questions to try it with, and the apps it needs, each marked connected, "not connected yet", or not something Tailzu can reach. The
 * role is bot_builder on the CHEAP tier; the strong tier is asked once only when the cheap one could not make a draft that holds up (bad JSON twice, a
 * definition the checks refuse). The apps the model names are checked against the catalog, and the words that name an app outright ("my calendar",
 * "in Notion") are read for nothing (connectors/intent.ts) and added when the model missed them.
 *
 * A DRAFT IS NOT A BOT. This writes nothing: no row, no key, no memory. The person reads it, edits it and sends it to approve (service.ts approve),
 * and only that saves. The test console (service.ts test) runs a draft that was never saved, so they can talk to it first.
 */
import { z } from "zod";
import { readIntent, JOB_APPS } from "../connectors/intent.js";
import { askJson, forModel, oneLine, type CallFn, type ModelCtx } from "../code/work/model.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { builtinBots } from "./builtin.js";
import { neutral } from "./prompt.js";
import type { BotConnectors, ConnectorStatus } from "./ports.js";
import type { BotStore } from "./store.js";
import { BotError, LIMITS, PALETTE, type BotSkills, type Colour } from "./types.js";
import { colourFor } from "./builtin.js";
import { parseBotInput, slugOf, type Limits } from "./validate.js";

/** What the builder role answers with (the contract of bot_builder names these fields). Looser than a definition: the code cleans it up. */
export const BotDraftReply = z.object({
  name: z.string().min(1).max(120),
  purpose: z.string().min(1).max(400),
  colour: z.enum(PALETTE),
  rules: z.array(z.string().min(1).max(400)).max(14),
  skills: z.object({ web: z.boolean(), files: z.boolean(), artifacts: z.boolean(), code: z.boolean(), research: z.boolean() }),
  connectors: z.array(z.string().max(80)).max(12),
  tone: z.string().max(200),
  tests: z.array(z.string().min(2).max(400)).max(6),
});
export type BotDraftReply = z.infer<typeof BotDraftReply>;

export interface Draft {
  definition: {
    name: string; slug: string; colour: Colour; purpose: string; principles: string[]; skills: BotSkills; knowledge: string[]; tone: string; visibility: "private";
    budgets: { perRequestPaise: number; dailyPaise: number };
  };
  /** Three questions to try the bot with in the test console. */
  tests: string[];
  /** The apps it needs, and whether this person has each. */
  connectors: Array<{ id: string; name: string; status: ConnectorStatus }>;
  warnings: string[];
  paise: number;
  /** The tier that made the draft: the strong one only when the cheap one could not. */
  tier: "cheap" | "strong";
}

export interface BuilderDeps {
  store: BotStore;
  connectors?: BotConnectors | null;
  call?: CallFn;
  gateway?: GatewayDeps;
  limits: Limits;
}

export const SENTENCE_MAX = 600;
export const DRAFT_CAP_PAISE = { cheap: 60, strong: 150 } as const;
const CATALOG_SHOWN = 60;

const FALLBACK_TESTS = ["What can you help me with?", "What do you need from me to get started?", "Show me how you would answer a typical request."];

export function builderUser(sentence: string, apps: ReadonlyArray<{ id: string; name: string; oneLine: string }>): string {
  const list = apps.slice(0, CATALOG_SHOWN).map((a) => `- ${a.id}: ${neutral(oneLine(`${a.name}. ${a.oneLine}`, 110))}`).join("\n");
  return [`Sentence:\n<<<\n${neutral(sentence)}\n>>>`, `Apps (id: what it does):\n<<<\n${list || "(none)"}\n>>>`].join("\n");
}

/** App ids the words name outright or the job they describe points to, read for nothing. */
export function connectorHints(sentence: string, known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const read = (i: ReturnType<typeof readIntent>): void => {
    for (const n of i.named) { const id = n.ids.find((x) => known.has(x)); if (id) out.push(id); }
    if (i.job && !i.guarded) { const id = JOB_APPS[i.job].find((x) => known.has(x)); if (id) out.push(id); }
    for (const m of i.more ?? []) read(m);
  };
  try { read(readIntent(sentence)); } catch { /* the hints are a help, never a dependency */ }
  return [...new Set(out)];
}

const trimTo = (s: string, n: number): string => (s.length > n ? s.slice(0, n).trimEnd() : s);

export async function draftBot(d: BuilderDeps, userId: string, sentenceRaw: string, signal?: AbortSignal): Promise<Draft> {
  const sentence = typeof sentenceRaw === "string" ? sentenceRaw.replace(/\s+/g, " ").trim() : "";
  if (sentence.length < 4) throw new BotError("bad_request", "Say in a sentence what the bot is for.");
  if (sentence.length > SENTENCE_MAX) throw new BotError("too_large", `Keep it to one sentence: ${SENTENCE_MAX} characters at most.`, 413);
  if (forModel(sentence) !== sentence) throw new BotError("secret", "That looks like it has a secret in it. Leave it out of the sentence: a bot never needs one written here.", 422);

  const apps = d.connectors ? await d.connectors.catalog(userId).catch(() => []) : [];
  const known = new Set(apps.map((a) => a.id));
  const user = builderUser(sentence, apps);
  const model = (cap: number): ModelCtx => ({ ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId, budget: { maxPaise: cap }, ...(signal ? { signal } : {}) });

  let paise = 0;
  let tier: "cheap" | "strong" = "cheap";
  let failed = "";
  for (const t of ["cheap", "strong"] as const) {
    tier = t;
    const r = await askJson(model(DRAFT_CAP_PAISE[t]), { tier: t, purpose: "bot.build", role: "bot_builder", user, schema: BotDraftReply, maxTokens: 900 });
    if (!r.ok) {
      if (r.reason === "aborted") throw Object.assign(new Error("aborted"), { name: "AbortError" });
      failed = r.reason;
      // A budget that cannot cover even the first call will not cover the second.
      if (r.reason === "budget") break;
      continue;
    }
    paise += r.paise;
    const made = await finish(d, userId, r.value, sentence, apps, known);
    if (made) return { ...made, paise, tier };
    failed = "invalid";
  }
  throw failed === "budget"
    ? new BotError("budget", "That would cost more than drafting a bot may. Try a shorter sentence.", 402)
    : new BotError("model_down", "Tailzu couldn't draft that just now. Try again in a moment, or make the bot by hand.", 503);
}

/** The model's draft made into one that holds up: trimmed to the caps, checked by the same schema as a saved bot, the apps looked up. Null when it cannot be. */
async function finish(
  d: BuilderDeps, userId: string, v: BotDraftReply, sentence: string, apps: ReadonlyArray<{ id: string; name: string; connected: boolean }>, known: ReadonlySet<string>,
): Promise<Omit<Draft, "paise" | "tier"> | null> {
  const warnings: string[] = [];
  const wanted = [...new Set([...v.connectors.map((c) => c.trim().toLowerCase()), ...connectorHints(sentence, known)])];
  const ids = wanted.filter((id) => known.has(id)).slice(0, 6);
  for (const id of wanted.filter((x) => x && !known.has(x) && /^[a-z0-9_][a-z0-9._-]*$/.test(x))) warnings.push(`Tailzu has no app called "${id}" yet, so it was left out.`);

  const taken = new Set<string>([...builtinBots().map((b) => b.slug)]);
  let slug = slugOf(v.name);
  for (let i = 0; i < 4 && (taken.has(slug) || (await d.store.getBySlug(slug).catch(() => null))); i += 1) slug = slugOf(v.name, Math.random().toString(36).slice(2, 6));
  const mine = await d.store.listBots(userId).catch(() => []);
  const rules = v.rules.map((r) => trimTo(r.replace(/\s+/g, " ").trim(), LIMITS.rule)).filter(Boolean).slice(0, 8);

  const parsed = parseBotInput({
    name: trimTo(v.name.replace(/\s+/g, " ").trim(), LIMITS.name), slug, colour: v.colour, purpose: trimTo(v.purpose.replace(/\s+/g, " ").trim(), LIMITS.purpose), principles: rules,
    skills: { ...v.skills, connectors: ids }, knowledge: [], tone: trimTo(v.tone.replace(/\s+/g, " ").trim(), LIMITS.tone),
  }, d.limits);
  if (!parsed.ok) return null;
  const value = parsed.value;
  const colour: Colour = value.colour ?? colourFor(slug, mine.map((b) => b.colour));
  const tests = [...new Set(v.tests.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 3);
  for (const t of FALLBACK_TESTS) if (tests.length < 3 && !tests.includes(t)) tests.push(t);

  const status = d.connectors && ids.length ? await d.connectors.status(userId, ids).catch(() => null) : null;
  const connectors = ids.map((id) => {
    const s = status?.find((x) => x.id === id);
    return { id, name: s?.name ?? apps.find((a) => a.id === id)?.name ?? id, status: (s?.status ?? (apps.find((a) => a.id === id)?.connected ? "connected" : "not_connected")) as ConnectorStatus };
  });
  const missing = connectors.filter((c) => c.status === "not_connected").map((c) => c.name);
  if (missing.length) warnings.push(`Not connected yet: ${missing.join(", ")}. The bot works without ${missing.length === 1 ? "it" : "them"}; connect ${missing.length === 1 ? "it" : "them"} in Tailzu to let it use ${missing.length === 1 ? "it" : "them"}.`);
  warnings.push(...parsed.warnings);

  return {
    definition: {
      name: value.name, slug, colour, purpose: value.purpose, principles: value.principles, skills: value.skills, knowledge: [], tone: value.tone, visibility: "private", budgets: value.budgets,
    },
    tests, connectors, warnings,
  };
}
