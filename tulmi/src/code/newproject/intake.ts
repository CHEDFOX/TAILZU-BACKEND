/**
 * INTAKE: THE FEW QUESTIONS A NEW PROJECT IS ASKED, AND NONE THE PERSON HAS ALREADY ANSWERED.
 *
 * "I want an app" is not enough to build one, and a form of twenty fields is worse
 * than no form. So there are five questions, at most, in this order:
 *
 *   what          what you are building, and who it is for
 *   platforms     where it runs: a website, an iPhone or Android app, desktop, an API
 *   features      the must-haves for the first version
 *   constraints   limits: a budget, hosting you already have, a stack you prefer
 *   examples      apps or sites you like
 *
 * and a question is SKIPPED when the person's own words already answer it: "a booking
 * site for yoga studios, with login and payments, on Vercel, like Calendly" answers
 * all five. That is read off the words with rules and no model (answeredBy): the
 * platform words, a product word and an audience, the features named, the stack or
 * hosting or budget mentioned, a reference to another product. A message that names
 * a product but no audience gets only "Who is it for?". An answer given to a question
 * stands whatever it says; "skip" and "you decide" are answers too, and mean the
 * planner will choose and say what it assumed.
 *
 * The state is kept per project (intakeStore.ts): the first message, the answers, which
 * questions were put. stepIntake() is the state machine and calls no model;
 * advanceIntake() goes on, once nothing is left to ask, to the spec (spec.ts, the strong
 * tier), the stack (rules) and PLAN.md, and keeps them. An intake that cannot be saved
 * is asked again from what it was given, never an error to the person.
 */
import { redactText } from "../work/worklog.js";
import type { ModelCtx } from "../work/model.js";
import { intakeStore, type IntakeStore } from "./intakeStore.js";
import { planMarkdown } from "./planDoc.js";
import { buildSpec, chooseStack } from "./spec.js";
import { FEATURE_CUE_WORDS } from "./words.js";
import { QUESTION_IDS, type IntakeRow, type Question, type QuestionId, type Spec, type Stack } from "./types.js";

// ------------------------------------------------------------------ the questions

export const QUESTIONS: Readonly<Record<QuestionId, Omit<Question, "id">>> = {
  what: { ask: "What are you building, and who is it for?", why: "So the plan fits the people who will really use it." },
  platforms: { ask: "Where should it run: a website, an iPhone or Android app, a desktop app, or just an API?", why: "It decides what gets built first and how it is hosted." },
  features: { ask: "What must the first version be able to do? A short list is perfect.", why: "A small first version is finished sooner and tells you what to build next." },
  constraints: { ask: "Any limits I should plan around: a budget, hosting you already have, or a stack you would like me to use?", why: "So I choose what you can actually run and afford." },
  examples: { ask: "Are there apps or sites you like that I should take after?", why: "A reference says more than a paragraph of description." },
};

/** What the first question becomes when the product is named but not who it is for. */
const WHO: Omit<Question, "id"> = { ask: "Who is it for?", why: "So the plan fits the people who will really use it." };

// ----------------------------------------------------------- reading the words

const PLATFORM = /\b(web ?sites?|sites?|web ?pages?|web ?app|webapp|web|browser|ios|iphone|ipad|android|mobile|desktop|windows app|mac app|macos|electron|api|backend|rest api|graphql|cli|command[- ]line|chrome extension|browser extension|pwa|saas|landing page)\b/i;
const PRODUCT = /\b(app|application|site|website|platform|tool|marketplace|dashboard|game|bot|api|service|portal|store|shop|tracker|planner|manager|system|extension|plugin|saas|cms|blog|network|community|booking|crm|directory|newsletter|app store|assistant|scheduler|calculator|quiz)\b/i;
const AUDIENCE = new RegExp(
  "\\bfor (?:\\w+ ){0,3}(?:people|users?|customers?|teams?|students?|teachers?|doctors?|patients?|businesses|business|owners?|freelancers?|creators?|developers?|kids|children|parents|farmers|shops?|stores?|restaurants?|gyms?|clinics?|schools?|clubs?|studios?|salons?|agencies|anyone|everyone|members|fans|residents|travellers|travelers|founders|sellers|buyers|drivers|riders|artists|musicians|writers|small|my|our)\\b"
  + "|\\bso (?:that )?(?:people|users?|customers?|they|my|our)\\b|\\b(?:helps?|lets?|allows?|enables?|used by)\\s+\\w+",
  "i",
);
const FEATURE_CUE = /\b(features?|should be able to|must be able to|needs? to (?:let|allow|have|be able)|lets? (?:users?|people|them)|allows? (?:users?|people)|users? can|people can|can (?:book|buy|sign|log|post|upload|search|chat|pay|share|create|track))\b/i;
const CONSTRAINT = new RegExp(
  "\\b(budget|free tier|free hosting|for free|cheap|no money|no budget|low cost|usd|inr|hosting|host(?:ed)? on|deploy(?:ed)? (?:on|to)|vercel|netlify|cloudflare|aws|gcp|azure|digitalocean|heroku|render|railway|fly\\.io|supabase|firebase|stack|next\\.?js|react|vue|nuxt|svelte|angular|expo|flutter|django|flask|fastapi|express|fastify|laravel|rails|node(?:\\.?js)?|python|typescript|javascript|golang|rust|postgres(?:ql)?|mysql|mongodb|already have|i know|i prefer|i'd like to use|i want to use|must use|using)\\b"
  + "|[$₹]\\s?\\d|\\brs\\.?\\s?\\d",
  "i",
);
const EXAMPLE = /\b(?:like|similar to|inspired by|clone of|such as|e\.g\.|for example|reference|take after|think)\s+(?:a |an |the )?[A-Z][\w.]+|https?:\/\/\S+|\b(?:uber|airbnb|notion|trello|stripe|shopify|figma|slack|instagram|tiktok|zomato|swiggy|ola|razorpay|spotify|netflix|amazon|etsy|duolingo|calendly|linktree|canva|discord|whatsapp|twitter|linkedin|youtube|pinterest|medium|substack|asana|jira|zoom)\b/i;

export interface Reading { answered: Set<QuestionId>; /** The product is named but not who it is for. */ partialWhat: boolean }

/** Which questions a piece of text already answers. */
export function answeredBy(text: string): Reading {
  const t = String(text ?? "");
  const answered = new Set<QuestionId>();
  let partialWhat = false;
  if (t.trim().length >= 20 && PRODUCT.test(t)) {
    if (AUDIENCE.test(t)) answered.add("what"); else partialWhat = true;
  }
  if (PLATFORM.test(t)) answered.add("platforms");
  const featureWords = new Set((t.match(FEATURE_CUE_WORDS) ?? []).map((w) => w.toLowerCase().replace(/\s+/g, "")));
  const listed = t.split("\n").filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)).length;
  if (listed >= 2 || (FEATURE_CUE.test(t) && featureWords.size >= 1) || featureWords.size >= 2) answered.add("features");
  if (CONSTRAINT.test(t)) answered.add("constraints");
  if (EXAMPLE.test(t)) answered.add("examples");
  return { answered, partialWhat };
}

const SKIP = /^(?:skip|no|none|nope|n\/?a|nothing|nothing in particular|don'?t know|no idea|you decide|you choose|up to you|anything|any|whatever|not sure|no preference|surprise me)\.?$/i;

/** An answer as it is kept: cut, with nothing a secret scan flags; a "skip" is kept as what it means. */
export function cleanAnswer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return SKIP.test(t) ? "(no preference: you decide)" : redactText(t, 1500);
}

/** The questions still to ask, in order, and those already answered, by the first message and by what has been said since. */
export function nextQuestions(request: string, answers: Partial<Record<QuestionId, string>>): { questions: Question[]; answered: QuestionId[] } {
  const read = answeredBy([request, ...Object.values(answers)].join("\n"));
  const answered: QuestionId[] = [];
  const questions: Question[] = [];
  for (const id of QUESTION_IDS) {
    if (answers[id] || read.answered.has(id)) { answered.push(id); continue; }
    questions.push({ id, ...(id === "what" && read.partialWhat ? WHO : QUESTIONS[id]) });
  }
  return { questions, answered };
}

// --------------------------------------------------------------------- the state

export interface IntakeInput {
  /** The person's first message (or a new one: it replaces the old). */
  request?: string;
  /** Answers by question id. */
  answers?: Record<string, unknown>;
  /** A free-text reply, taken as the answer to the first question that was asked and is not answered. */
  reply?: string;
  /** "Just start": whatever is left is the planner's to decide. */
  proceed?: boolean;
}

export interface IntakeProgress {
  state: "asking" | "ready";
  questions: Question[];
  answered: QuestionId[];
  request: string;
  answers: Partial<Record<QuestionId, string>>;
  /** The row had a spec already and nothing new came in. */
  unchanged: boolean;
}

const REQUEST_CHARS = 4000;

/** The intake state machine: what is known, what is still to ask. Calls no model. */
export async function stepIntake(userId: string, projectId: string, input: IntakeInput, o: { store?: IntakeStore } = {}): Promise<IntakeProgress & { row: IntakeRow | null }> {
  const store = o.store ?? intakeStore();
  let row: IntakeRow | null = null;
  try { row = await store.get(projectId); } catch { row = null; }

  const request = typeof input.request === "string" && input.request.trim() ? redactText(input.request.trim(), REQUEST_CHARS) : row?.request ?? "";
  const answers: Partial<Record<QuestionId, string>> = { ...(row?.answers ?? {}) };
  let changed = typeof input.request === "string" && input.request.trim() !== "" && input.request.trim() !== row?.request;
  for (const [k, v] of Object.entries(input.answers ?? {})) {
    if (!(QUESTION_IDS as readonly string[]).includes(k)) continue;
    const a = cleanAnswer(v);
    if (a && answers[k as QuestionId] !== a) { answers[k as QuestionId] = a; changed = true; }
  }
  const before = nextQuestions(request, answers).questions;
  if (typeof input.reply === "string") {
    const a = cleanAnswer(input.reply);
    const target = before.find((q) => (row?.asked ?? []).includes(q.id)) ?? before[0];
    if (a && target) { answers[target.id] = a; changed = true; }
  }
  if (input.proceed) {
    for (const q of nextQuestions(request, answers).questions) { answers[q.id] = "(no preference: you decide)"; changed = true; }
  }

  const { questions, answered } = nextQuestions(request, answers);
  const asked = [...new Set([...(row?.asked ?? []), ...questions.map((q) => q.id)])];
  const state: IntakeProgress["state"] = questions.length ? "asking" : "ready";
  let saved: IntakeRow | null = row;
  try {
    // New words invalidate a spec made from the old ones.
    saved = await store.save(projectId, userId, {
      request, answers, asked, state: state === "ready" && row?.state === "done" && !changed ? "done" : state,
      ...(changed ? { spec: null, stack: null } : {}),
    });
  } catch { /* kept in this reply only */ }
  return { state, questions, answered, request, answers, unchanged: !changed && !!row?.spec && !!row.stack, row: saved };
}

// ------------------------------------------------------------------- and on

export interface AdvanceDeps {
  model: ModelCtx;
  store?: IntakeStore;
}

export type Advance =
  | { state: "asking"; questions: Question[]; answered: QuestionId[] }
  | { state: "done"; spec: Spec; stack: Stack; plan: string; answered: QuestionId[]; /** The spec could not be written by a model and is what the answers say, plainly. */ degraded: boolean };

/**
 * Answers in; the next questions or, when nothing is left to ask, the spec, the
 * stack and PLAN.md out. The spec and the stack are kept with the project, and
 * asked for again (with nothing new said) they are returned as they were.
 */
export async function advanceIntake(userId: string, projectId: string, input: IntakeInput, deps: AdvanceDeps): Promise<Advance> {
  const store = deps.store ?? intakeStore();
  const p = await stepIntake(userId, projectId, input, { store });
  if (p.state === "asking") return { state: "asking", questions: p.questions, answered: p.answered };
  const intake = { request: p.request, answers: p.answers };
  if (p.unchanged && p.row?.spec && p.row.stack) {
    return { state: "done", spec: p.row.spec, stack: p.row.stack, plan: planMarkdown(p.row.spec, p.row.stack), answered: p.answered, degraded: p.row.spec.source === "rules" };
  }
  const spec = await buildSpec(intake, { model: deps.model });
  const stack = chooseStack(spec, intake);
  try { await store.save(projectId, userId, { state: "done", spec, stack }); } catch { /* the reply has them */ }
  return { state: "done", spec, stack, plan: planMarkdown(spec, stack), answered: p.answered, degraded: spec.source === "rules" };
}
