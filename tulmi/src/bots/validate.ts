/**
 * A BOT'S DEFINITION, CHECKED: THE PALETTE ONLY, THE RULES CAPPED, THE SKILLS A SCHEMA, AND THE OWNER'S RULES KEPT IN THEIR PLACE.
 *
 *   parseBotInput(raw, limits)  what a person sent (a new bot, or a change) -> a clean definition, or every problem in words
 *   inertRules(rules)           the owner's rules that try to change Tailzu's own rules: they are kept as typed and never reach a model
 *   slugOf(name)                a slug made from a name
 *
 * The owner's rules are THEIR OWN rules for THEIR OWN bot: tone, topic, the way it answers. They are placed after Tailzu's stable principles,
 * fenced, and capped (prompt.ts), and a rule that tries to override safety ("ignore previous rules", "reveal your keys") is inert: the person
 * is told, on save, that it is ignored, and the model never sees its words. What a bot may do is decided by its skills and the permission tiers,
 * in code, never by what a rule says.
 *
 * Pure. Nothing here reads the environment, a store or a model.
 */
import { z } from "zod";
import { LIMITS, PALETTE, RESERVED_SLUGS, SKILL_NAMES, type BotBudgets, type BotSkills, type Colour } from "./types.js";

/** Whitespace and control characters made into single spaces. */
// eslint-disable-next-line no-control-regex
const line = (s: string): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();

const text = (max: number, what: string) =>
  z.string({ required_error: `${what} is needed`, invalid_type_error: `${what} is text` }).transform(line)
    .pipe(z.string().min(1, `${what} can't be empty`).max(max, `${what} is ${max} characters at most`));

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONNECTOR_ID = /^[a-z0-9_][a-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SlugSchema = z.string().trim().toLowerCase()
  .min(LIMITS.slug.min, `slug is at least ${LIMITS.slug.min} characters`).max(LIMITS.slug.max, `slug is ${LIMITS.slug.max} characters at most`)
  .regex(SLUG, "slug is lower-case letters, digits and single hyphens")
  .refine((s) => !RESERVED_SLUGS.includes(s), "that slug is taken by X0 Bot");

export const ColourSchema = z.enum(PALETTE, { errorMap: () => ({ message: `colour is one of ${PALETTE.join(", ")}` }) });

const flag = (name: string) => z.boolean({ invalid_type_error: `skills.${name} is true or false` }).default(false);

/** The skills: five switches and the connected apps the bot may use. Anything else is refused. */
export const SkillsSchema = z.object({
  web: flag("web"), files: flag("files"), artifacts: flag("artifacts"), code: flag("code"), research: flag("research"),
  connectors: z.array(z.string().regex(CONNECTOR_ID, "a connector is named by its id")).max(LIMITS.connectors, `at most ${LIMITS.connectors} connected apps`).default([])
    .transform((l) => [...new Set(l)]),
}).strict("skills has web, files, artifacts, code, research and connectors, and nothing else");

/** The owner's rules: at most 12, each one short line. A rule over its cap is refused, not cut. */
export const RulesSchema = z.array(text(LIMITS.rule, "a rule")).max(LIMITS.rules, `at most ${LIMITS.rules} rules`)
  .transform((l) => l.filter((r, i) => l.indexOf(r) === i));

export interface Limits {
  /** The most a person may set for one request / one day (BOT_REQUEST_PAISE_MAX / BOT_DAILY_PAISE_MAX). */
  requestMax: number;
  dailyMax: number;
  /** What a bot is given when the person says nothing. */
  requestDefault: number;
  dailyDefault: number;
}

export const DEFAULT_LIMITS: Limits = { requestMax: 1000, dailyMax: 5000, requestDefault: 150, dailyDefault: 800 };

const budgetsOf = (l: Limits) => z.object({
  perRequestPaise: z.number({ invalid_type_error: "perRequestPaise is a number" }).int("perRequestPaise is whole paise").min(1, "perRequestPaise is at least 1").max(l.requestMax, `perRequestPaise is ${l.requestMax} at most`),
  dailyPaise: z.number({ invalid_type_error: "dailyPaise is a number" }).int("dailyPaise is whole paise").min(1, "dailyPaise is at least 1").max(l.dailyMax, `dailyPaise is ${l.dailyMax} at most`),
}).strict().partial();

const base = (l: Limits) => z.object({
  name: text(LIMITS.name, "name"),
  slug: SlugSchema.optional(),
  colour: ColourSchema.optional(),
  purpose: text(LIMITS.purpose, "purpose"),
  principles: RulesSchema.default([]),
  skills: SkillsSchema.default({}),
  knowledge: z.array(z.string().regex(UUID, "knowledge is a list of file ids")).max(LIMITS.knowledge, `at most ${LIMITS.knowledge} files of knowledge`).default([])
    .transform((l2) => [...new Set(l2.map((x) => x.toLowerCase()))]),
  tone: z.string().transform(line).pipe(z.string().max(LIMITS.tone, `tone is ${LIMITS.tone} characters at most`)).default(""),
  visibility: z.literal("private", { errorMap: () => ({ message: 'visibility is "private"' }) }).default("private"),
  budgets: budgetsOf(l).default({}),
  publicCard: z.boolean({ invalid_type_error: "publicCard is true or false" }).optional(),
}).strict();

export interface CleanInput {
  name: string;
  slug?: string;
  colour?: Colour;
  purpose: string;
  principles: string[];
  skills: BotSkills;
  knowledge: string[];
  tone: string;
  visibility: "private";
  budgets: BotBudgets;
  publicCard?: boolean;
}

export type Parsed = { ok: true; value: CleanInput; warnings: string[] } | { ok: false; errors: string[] };

const where = (path: Array<string | number>): string => (path.length ? `${path.map(String).join(".")}: ` : "");

/**
 * What a person sent, checked. Every problem is named in words, with where it is. Files of knowledge need the Files skill, a bot
 * that reads nothing cannot have a library, and a rule that tries to change Tailzu's own rules is accepted but reported as ignored.
 */
export function parseBotInput(raw: unknown, limits: Limits = DEFAULT_LIMITS): Parsed {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["The body is a JSON object with the bot's definition."] };
  const r = base(limits).safeParse(raw);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${where(i.path)}${i.message}`) };
  const v = r.data;
  const errors: string[] = [];
  if (v.knowledge.length && !v.skills.files) errors.push("knowledge: turn the Files skill on to give the bot files to answer from");
  if (v.budgets.perRequestPaise !== undefined && v.budgets.dailyPaise !== undefined && v.budgets.perRequestPaise > v.budgets.dailyPaise) errors.push("budgets: one request can't be allowed more than the day");
  if (errors.length) return { ok: false, errors };
  const perRequestPaise = v.budgets.perRequestPaise ?? Math.min(limits.requestDefault, limits.requestMax);
  const dailyPaise = Math.max(v.budgets.dailyPaise ?? Math.min(limits.dailyDefault, limits.dailyMax), perRequestPaise);
  const warnings = inertRules(v.principles).map((x) => `Rule ${x.index + 1} is ignored: ${x.why}.`);
  return {
    ok: true, warnings,
    value: {
      name: v.name, ...(v.slug ? { slug: v.slug } : {}), ...(v.colour ? { colour: v.colour } : {}), purpose: v.purpose, principles: v.principles,
      skills: v.skills as BotSkills, knowledge: v.knowledge, tone: v.tone, visibility: "private", budgets: { perRequestPaise, dailyPaise },
      ...(v.publicCard !== undefined ? { publicCard: v.publicCard } : {}),
    },
  };
}

// ------------------------------------------------------------------ the rules that try to change ours

interface Override { re: RegExp; why: string }

const OVERRIDES: readonly Override[] = [
  { re: /\b(?:ignore|disregard|forget|override|bypass|skip|drop|discard)\b[^.]{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|your|the|these|those|safety|system|every)\b[^.]{0,30}\b(?:rules?|instructions?|prompts?|principles?|polic(?:y|ies)|guidelines?|restrictions?|filters?|limits?|safeguards?)\b/i, why: "it asks the bot to ignore X0 Bot's own rules" },
  { re: /\b(?:reveal|show|print|leak|dump|expose|exfiltrate|share|output|repeat|display|send)\b[^.]{0,40}\b(?:system prompt|your prompt|your instructions|api[\s_-]?keys?|secrets?|tokens?|passwords?|credentials?|private keys?|bot keys?|owner rules)\b/i, why: "it asks the bot to reveal a secret or its own instructions" },
  { re: /\b(?:leak|exfiltrate)\b/i, why: "it asks the bot to leak something" },
  { re: /\b(?:bypass|circumvent|get around|work around|evade)\b[^.]{0,30}\b(?:permissions?|approvals?|rules?|checks?|filters?|safety|polic(?:y|ies)|limits?|restrictions?|safeguards?|confirmations?)\b/i, why: "it asks the bot to get round a permission or a safety check" },
  { re: /\b(?:jailbreak|do anything now|developer mode|god mode|no restrictions?|without (?:any )?(?:restrictions?|limits?|filters?|rules?)|unrestricted)\b/i, why: "it asks the bot to work without X0 Bot's limits" },
  { re: /\b(?:disable|turn off|switch off|remove|stop)\b[^.]{0,20}\b(?:safety|safeguards?|filters?|permissions?|approvals?|confirmations?|policy)\b/i, why: "it asks the bot to switch off a safety check" },
  { re: /\b(?:without|never|don'?t|do not)\b[^.]{0,20}\b(?:ask(?:ing)?|confirm(?:ing)?)\b[^.]{0,30}\b(?:owner|me|permission|approval|first)\b/i, why: "it asks the bot to change things without asking" },
  { re: /\b(?:pichle|purane|upar ke|saare|sab)\s+(?:rules?|niyam|instructions?)\b[^.]{0,30}\b(?:ignore|bhool|chhod|hata)/i, why: "it asks the bot to ignore X0 Bot's own rules" },
  { re: /\b(?:ignore|bhool jao|ignore karo)\b[^.]{0,20}\b(?:rules?|niyam|instructions?)\b/i, why: "it asks the bot to ignore X0 Bot's own rules" },
];

/** The owner's rules that try to change Tailzu's own: by index, with why. They stay as typed and never reach a model. */
export function inertRules(rules: readonly string[]): Array<{ index: number; why: string }> {
  const out: Array<{ index: number; why: string }> = [];
  rules.forEach((r, index) => {
    const hit = OVERRIDES.find((o) => {
      const m = o.re.exec(r);
      // A refusal ("never share my keys") protects the owner and asks for nothing: a verb right after a "never" or "don't" is let through.
      return !!m && !PROHIBITION.test(r.slice(Math.max(0, m.index - 14), m.index));
    });
    if (hit) out.push({ index, why: hit.why });
  });
  return out;
}

const PROHIBITION = /\b(?:never|don'?t|do not|not|no|won'?t|cannot|can'?t)\s+(?:ever\s+|to\s+)?$/i;

// ------------------------------------------------------------------ slugs

/** A slug from a name: lower-case, hyphens, at most 32 characters, never reserved. `salt` makes it different when the first one is taken. */
export function slugOf(name: string, salt = ""): string {
  const folded = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let s = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
  if (s.length < LIMITS.slug.min) s = `${s}${s ? "-" : ""}bot`;
  if (salt) s = `${s.slice(0, 32)}-${salt}`;
  if (RESERVED_SLUGS.includes(s)) s = `my-${s}`;
  return s.slice(0, LIMITS.slug.max).replace(/-+$/g, "");
}

export const isSkill = (v: unknown): v is (typeof SKILL_NAMES)[number] => typeof v === "string" && (SKILL_NAMES as readonly string[]).includes(v);
