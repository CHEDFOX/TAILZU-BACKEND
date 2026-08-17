/**
 * The cleanup "brain": OpenRouter chat calls that
 *  - clean()/cleanStream()  : polish raw transcript OR typed text (voice + typing)
 *  - draftReply()           : draft a personalized reply from screen content + intent
 *
 * Default model: anthropic/claude-haiku-4.5, swappable via CLEANUP_MODEL.
 * System prompts are built in ../prompts.ts from the versioned shared/prompts/.
 */
import OpenAI from "openai";
import { getConfig } from "../config.js";
import { buildCleanupSystem, buildReplySystem } from "../prompts.js";
import type { CleanupOptions, Personality } from "../../../shared/types/api.js";
import { buildTonePrompt, LLM_TONES } from "./tonePrompts.js";
import { buildAssistSystem } from "./assistPrompt.js";
import type { PresetTone } from "../experience/personalityPresets.js";

let client: OpenAI | null = null;
function openrouter(): OpenAI {
  if (!client) {
    const cfg = getConfig();
    client = new OpenAI({
      apiKey: cfg.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      // Bound each call so a hung upstream can't pin a request/socket for the
      // SDK default (~10 min). 30s covers refine/draft; the SDK retries twice
      // on transient network/5xx.
      timeout: 30_000,
      maxRetries: 2,
      defaultHeaders: {
        "HTTP-Referer": cfg.OPENROUTER_APP_URL,
        "X-Title": cfg.OPENROUTER_APP_NAME,
      },
    });
  }
  return client;
}

const TEMPERATURE = 0.2; // low: faithful cleanup, not creativity
const REPLY_TEMPERATURE = 0.4; // a touch more latitude for natural drafting

// Output ceilings. Set explicitly so OpenRouter's per-request credit
// reservation matches what we actually produce (~200 tokens for cleanup,
// ~500 for a reply). Without this, OpenRouter reserves the model's full
// context ceiling (64k+ tokens) upfront and rejects small-balance accounts
// even though the real cost is a fraction of a cent.
//
// Real outputs are almost always shorter than the input — cleanup collapses
// filler, reply drafts hit medium length. These caps leave generous headroom.
const MAX_TOKENS_CLEANUP = 1024;   // ≈ 750 words of cleaned text
const MAX_TOKENS_REPLY = 2048;     // ≈ 1500 words — email-length drafts
const MAX_TOKENS_STYLE = 512;      // small JSON blob

// --- Meta / refusal / clarification guard ----------------------------------
//
// The refine model is supposed to output ONLY the rewritten text. On empty /
// noisy / unintelligible input it sometimes disobeys and answers
// conversationally instead — "I don't get anything, speak again",
// "Sorry, I couldn't hear you", "Could you say that again?". That string is
// non-empty, so the `out || input` fallbacks let it straight through to the
// user's cursor. On the typepad we NEVER show that: a refine that produces a
// meta/refusal/clarification response is a failure, and a failed refine must be
// a no-op (insert nothing / keep the original), never a chat reply.
//
// This catches short outputs that are wholly a refusal-to-transcribe or a
// request to repeat. It is deliberately conservative (anchored, length-bounded)
// so it can't eat a legitimately short rewrite that happens to contain one of
// these words mid-sentence.
// Precise, high-confidence phrases only. Recall is intentionally traded for
// precision: flagging a legitimately short dictation would DROP the user's real
// words (worse than the bug). The prompt hardening + empty-completion handling
// cover the rarer meta forms these miss.
const META_PATTERNS: RegExp[] = [
  /\bi (?:didn'?t|did not|couldn'?t|could not|can'?t|cannot) (?:catch|hear|understand|make out) (?:that|it|you|anything|what you said)\b/i,
  /\bi (?:don'?t|do not|didn'?t|did not) get anything\b/i,
  /\b(?:could|can) you (?:say (?:that|it) again|repeat that)\b/i,
  /\bsay (?:that|it) again\b/i,
  /\b(?:please )?repeat that\b/i,
  /\bplease (?:say that again|speak (?:again|up)|try (?:again|speaking))\b/i,
  /\bno (?:speech|audio|input|sound) (?:was )?(?:detected|found|received|captured)\b/i,
  /\bnothing (?:was said|to transcribe|to clean|was detected|was captured)\b/i,
  /\b(?:i'?m sorry|sorry),?\s+i (?:couldn'?t|could not|can'?t|didn'?t|did not) (?:hear|catch|understand|get)\b/i,
];

/**
 * True when `text` is a wholly conversational meta/refusal/clarification reply
 * rather than a rewrite of the user's words — the kind of thing the model emits
 * on silence/noise and that must never reach the cursor. Bounded to short
 * outputs so a long, legitimate rewrite is never misclassified.
 */
export function looksLikeMeta(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Only short outputs can be a bare refusal; real rewrites of dictation are
  // rarely this short AND meta. ~140 chars ≈ a sentence or two.
  if (t.length > 140) return false;
  return META_PATTERNS.some((re) => re.test(t));
}

/**
 * Finalize an LLM completion for insertion. `out` is the (trimmed, snippet-
 * expanded) model output; `input` is what the user actually said/typed.
 *
 * Discards ONLY a refusal/clarification the MODEL introduced — i.e. `out` looks
 * meta but the user's own `input` did not. In that case we fall back to `input`,
 * so a refine is a clean no-op (keeps the user's text) and a dictation inserts
 * the real transcript, never the filler; an empty input naturally yields "".
 *
 * Critically it does NOT discard when the user genuinely SAID a meta-shaped
 * phrase ("Can you say that again?") — there `input` is meta too, so we keep the
 * faithful rewrite. (This is the fix for the guard wiping legitimate messages.)
 * An empty completion also falls back to `input` so we never wipe the field.
 */
function finalizeCompletion(out: string, input: string): string {
  const inp = (input ?? "").trim();
  if (out && looksLikeMeta(out) && !looksLikeMeta(inp)) return inp;
  return out || inp;
}

// --- Snippets (text expansion) ---------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse "trigger = expansion" lines into pairs (first '=' splits the line). */
function parseSnippets(text: string): Array<{ trigger: string; expansion: string }> {
  const out: Array<{ trigger: string; expansion: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const trigger = line.slice(0, i).trim();
    if (trigger) out.push({ trigger, expansion: line.slice(i + 1).trim() });
  }
  return out;
}

/** Context values available for interpolation inside a snippet expansion. */
export interface SnippetContext {
  name?: string;
  email?: string;
  targetApp?: string;
  recipient?: string;
  /** Injected in tests so time-based variables are deterministic. */
  now?: Date;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Resolve a single `{var}` placeholder. Unknown variables leave the literal
 * `{var}` in place — the user probably typed a stray brace and we shouldn't
 * silently eat it. Empty strings ARE emitted for known-but-missing variables
 * (so `sig = — {name}` becomes `— ` when we don't know the user's name).
 */
function resolveVariable(name: string, ctx: SnippetContext): string | null {
  const now = ctx.now ?? new Date();
  switch (name) {
    case "date":
      // ISO calendar date. Locale-aware formatting is a future upgrade.
      return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
    case "time":
      return `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}`;
    case "day":
      return WEEKDAYS[now.getUTCDay()] ?? "";
    case "name":
      return ctx.name ?? "";
    case "email":
      return ctx.email ?? "";
    case "targetApp":
      return ctx.targetApp ?? "";
    case "recipient":
      return ctx.recipient ?? "";
    default:
      return null;
  }
}

/** Interpolate `{var}` tokens inside a snippet expansion. */
function interpolate(expansion: string, ctx: SnippetContext): string {
  return expansion.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, name: string) => {
    const v = resolveVariable(name, ctx);
    return v == null ? whole : v;
  });
}

/**
 * Expand the user's snippet triggers (whole-word, case-insensitive).
 * When `ctx` is provided, `{date}`, `{time}`, `{day}`, `{name}`, `{email}`,
 * `{targetApp}` and `{recipient}` inside an expansion are interpolated from
 * the caller's context — everything else is left literal (a stray `{foo}` is
 * more likely a real brace than a variable typo).
 */
export function expandSnippets(
  text: string,
  snippets?: string,
  ctx?: SnippetContext,
): string {
  if (!snippets?.trim() || !text) return text;
  const context = ctx ?? {};
  let out = text;
  for (const { trigger, expansion } of parseSnippets(snippets)) {
    const re = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, "gi");
    out = out.replace(re, () => interpolate(expansion, context));
  }
  return out;
}

/** Build a snippet context from CleanupOptions + an optional recipient. */
function ctxFromOpts(opts: CleanupOptions, recipient?: string): SnippetContext {
  return {
    name: opts.variables?.name,
    email: opts.variables?.email,
    targetApp: opts.targetApp,
    recipient,
  };
}

// --- Cleanup / refine (voice + typing) -------------------------------------

/**
 * Basic cleanup — this is what the "None" tone now does. Removes filler and
 * false starts and gives the text sentence structure (capitalization,
 * punctuation, sentence/paragraph breaks) WITHOUT changing the user's words,
 * tone, meaning, or language. It's the floor every other tone builds on:
 * "None" is exactly this and nothing more — faithful, not a rewrite.
 */
const BASIC_CLEAN_PROMPT = [
  "You lightly clean up dictated or typed text so it reads well, WITHOUT changing the person's voice, wording, or meaning.",
  "Output ONLY the cleaned text — no preamble, no quotes, no explanation.",
  "",
  "DO:",
  "- Remove filler and false starts: 'um', 'uh', 'er', 'like', 'you know', repeated words, and self-corrections (keep the corrected version).",
  "- Fix capitalization and punctuation; add sentence and paragraph breaks where the meaning calls for them.",
  "- Keep every other word the user said, including slang and casual phrasing.",
  "",
  "DON'T:",
  "- Don't rephrase, formalize, shorten, or expand. Don't add greetings, sign-offs, or facts.",
  "- Don't change the tone or the language. Preserve mixed-language / code-switched text exactly.",
].join("\n");

/**
 * The "None" tone: a light, faithful cleanup (filler + structure) with no
 * personality rewrite. Exported so both the voice pipeline and the typing
 * /v1/refine/none route share the exact same behavior.
 */
export async function cleanBasic(input: string): Promise<string> {
  if (!input.trim()) return "";
  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: 0.1, // very low — faithful, not creative
    max_tokens: MAX_TOKENS_CLEANUP,
    messages: [
      { role: "system", content: BASIC_CLEAN_PROMPT },
      { role: "user", content: input },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}

/**
 * The unified writing-assistant call — Tailzu's single brain for voice + typing.
 * Takes the user's MESSAGE (spoken or typed, possibly with an embedded
 * instruction like "…make it short and in bullet points"), optional CONTEXT
 * (what's already in the field), and the active tone, and returns the finished
 * text. The model separates message from instruction, applies the tone, and
 * continues/answers the context when present.
 */
export async function assist(
  message: string,
  opts: CleanupOptions = {},
): Promise<string> {
  if (!message.trim()) return "";
  const context = opts.context?.trim();
  const system = buildAssistSystem({
    tone: opts.tone,
    tonePrompt: opts.tonePrompt,
    personality: opts.personality,
    language: opts.language,
    targetApp: opts.targetApp,
    hasContext: !!context,
  });
  const userContent = context
    ? `CONTEXT (already in the field):\n${context}\n\nMESSAGE (what I just said or typed):\n${message.trim()}`
    : message.trim();
  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS_CLEANUP,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  });
  const out = expandSnippets(
    (res.choices[0]?.message?.content ?? "").trim(),
    opts.personality?.snippets,
    ctxFromOpts(opts),
  );
  // Discard a meta/refusal reply ("speak again"…); else keep the completion,
  // falling back to the input on an empty one so we never wipe the field.
  return finalizeCompletion(out, message.trim());
}

/** Non-streaming cleanup of a transcript or typed text. */
export async function clean(
  input: string,
  opts: CleanupOptions = {},
): Promise<string> {
  if (!input.trim()) return "";
  // "None" tone → basic cleanup only (filler removal + structure), NOT a
  // personality rewrite. resolvePersonality sets passThrough when the user's
  // active tone resolves to "none". Snippet expansion still runs after.
  if (opts.personality?.passThrough) {
    const cleaned = await cleanBasic(input);
    return expandSnippets(cleaned, opts.personality?.snippets, ctxFromOpts(opts));
  }
  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS_CLEANUP,
    messages: [
      { role: "system", content: buildCleanupSystem(opts) },
      { role: "user", content: input },
    ],
  });
  const out = expandSnippets(
    (res.choices[0]?.message?.content ?? "").trim(),
    opts.personality?.snippets,
    ctxFromOpts(opts),
  );
  // Never return empty for real input — the refine clients replace the field
  // with this, so an empty completion would delete the user's text. Fall back
  // to the original so a failed cleanup is a no-op, not data loss. A meta/
  // refusal reply is discarded (→ "") so it never lands on the typepad.
  return finalizeCompletion(out, input.trim());
}

/**
 * Per-tone refine: uses the hand-tuned prompt for the given tone with NO
 * dynamic mixing. Called by the tone-specific endpoints so each tone is
 * fully isolated — the LLM only ever sees one voice at a time.
 *
 * "none" is not accepted here — the /v1/refine/none route returns the
 * input directly (with snippet expansion) without ever calling this
 * function.
 */
export async function refineWithTone(
  input: string,
  tone: Exclude<PresetTone, "none">,
  opts: {
    language?: string;
    personality?: Personality;
  } = {},
): Promise<string> {
  if (!input.trim()) return "";
  const system = buildTonePrompt(tone, {
    language: opts.language,
    vocabulary: opts.personality?.vocabulary,
  });
  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS_CLEANUP,
    messages: [
      { role: "system", content: system },
      { role: "user", content: input },
    ],
  });
  const raw = (res.choices[0]?.message?.content ?? "").trim();
  // Snippet expansion still runs on the refined text so "brb" → "be right
  // back" works regardless of tone.
  const out = expandSnippets(
    raw,
    opts.personality?.snippets,
    { targetApp: "Generic" },
  );
  // Never wipe the field on an empty completion — fall back to the input.
  // A meta/refusal reply is discarded so it never lands on the typepad.
  return finalizeCompletion(out, input.trim());
}

export { LLM_TONES };

/** Streaming cleanup — yields cleaned text deltas as they arrive. */
export async function* cleanStream(
  input: string,
  opts: CleanupOptions = {},
): AsyncGenerator<string, void, unknown> {
  if (!input.trim()) return;
  // "None" tone → basic cleanup, emitted as one chunk. (Short + fast enough
  // that a separate streaming variant of the basic pass isn't worth it.)
  if (opts.personality?.passThrough) {
    const cleaned = await cleanBasic(input);
    yield expandSnippets(cleaned, opts.personality?.snippets, ctxFromOpts(opts));
    return;
  }
  const stream = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS_CLEANUP,
    stream: true,
    messages: [
      { role: "system", content: buildCleanupSystem(opts) },
      { role: "user", content: input },
    ],
  });
  // Accumulate the whole completion, THEN apply the same guards the non-stream
  // clean() applies: snippet expansion + the meta/refusal filter. We can't
  // un-yield a delta once it's on the cursor, so streaming raw deltas would let
  // "Sorry, say that again" reach the typepad and would skip snippet expansion.
  // Buffering trades per-word streaming on THIS path for correctness (the
  // in-app streaming mic; the keyboard's live path is Deepgram, not this).
  let buf = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) buf += delta;
  }
  const cleaned = finalizeCompletion(
    expandSnippets(buf.trim(), opts.personality?.snippets, ctxFromOpts(opts)),
    input,
  );
  if (cleaned) yield cleaned;
}

// --- Screen-reply drafting --------------------------------------------------

/** Draft a personalized reply from on-screen content + the user's intent. */
export async function draftReply(
  screenContent: string,
  intent: string,
  opts: CleanupOptions = {},
  recipient?: string,
): Promise<string> {
  if (!intent.trim()) return "";
  const userMsg =
    `SCREEN CONTENT (what I'm replying to):\n${screenContent.trim() || "(none)"}\n\n` +
    `MY INTENT (what I want to say back):\n${intent.trim()}`;

  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: REPLY_TEMPERATURE,
    max_tokens: MAX_TOKENS_REPLY,
    messages: [
      { role: "system", content: buildReplySystem(opts, recipient) },
      { role: "user", content: userMsg },
    ],
  });
  return expandSnippets(
    (res.choices[0]?.message?.content ?? "").trim(),
    opts.personality?.snippets,
    ctxFromOpts(opts, recipient),
  );
}

// --- Learn style from a writing sample -------------------------------------

const LEARN_TEMPERATURE = 0.3;

/** Infer a style profile from a sample of the user's own writing. */
export async function inferStyle(sample: string): Promise<Partial<Personality>> {
  if (!sample.trim()) return {};
  const system =
    "You analyze a person's writing and infer their texting/writing style. " +
    "Return ONLY a JSON object with these optional keys: " +
    "tone (short phrase like 'warm and concise, a little witty'), " +
    "formality ('casual' | 'neutral' | 'formal'), " +
    "emoji ('none' | 'minimal' | 'expressive'), " +
    "signature (a sign-off they use, or omit it), " +
    "customInstructions (concrete style rules you observed, e.g. 'lowercase, few commas, no exclamation marks'), " +
    "dial (an object { formality: 0-100, length: 0-100, warmth: 0-100 } — omit any dial you can't confidently read from the sample). " +
    "No prose, no markdown, no extra keys.";
  const res = await openrouter().chat.completions.create({
    model: getConfig().CLEANUP_MODEL,
    temperature: LEARN_TEMPERATURE,
    max_tokens: MAX_TOKENS_STYLE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: "Here is a sample of my writing:\n\n" + sample.trim() },
    ],
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
  } catch {
    return {};
  }
  return sanitizeStyle(parsed);
}

function sanitizeStyle(o: Record<string, unknown>): Partial<Personality> {
  const out: Partial<Personality> = {};
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const tone = str(o.tone, 200);
  if (tone) out.tone = tone;
  if (o.formality === "casual" || o.formality === "neutral" || o.formality === "formal") out.formality = o.formality;
  if (o.emoji === "none" || o.emoji === "minimal" || o.emoji === "expressive") out.emoji = o.emoji;
  const sig = str(o.signature, 100);
  if (sig) out.signature = sig;
  const ci = str(o.customInstructions, 500);
  if (ci) out.customInstructions = ci;
  // Tone dial (v3): each dial is optional; only include ones the model gave
  // us as a number, and clamp to 0-100.
  if (o.dial && typeof o.dial === "object") {
    const d = o.dial as Record<string, unknown>;
    const clamp01 = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : undefined;
    const dial: NonNullable<Personality["dial"]> = {};
    const f = clamp01(d.formality);
    const l = clamp01(d.length);
    const w = clamp01(d.warmth);
    if (f != null) dial.formality = f;
    if (l != null) dial.length = l;
    if (w != null) dial.warmth = w;
    if (Object.keys(dial).length) out.dial = dial;
  }
  return out;
}
