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
import { LLM_TONES } from "./tonePrompts.js";
import {
  PORTRAIT_DIMENSIONS, PORTRAIT_BOUNDS, portraitJsonContract, portraitProvenance,
  parsePortraitDraft, type PortraitDraft,
} from "./portraitDimensions.js";
import { buildAssistSystem, portraitBlock } from "./assistPrompt.js";
export { portraitBlock };

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

/**
 * Reasoning effort for every LLM call.
 *
 * CLEANUP_MODEL defaults to a GPT-5-class model, and those REASON before they
 * answer. Nothing here passed a reasoning parameter, so every refine ran at the
 * provider's default effort — spending tokens deliberating before emitting a
 * single word of output. That is the latency, and it buys nothing: rewriting a
 * sentence someone just said is not a problem that needs thinking through.
 *
 * "none" for that reason. Raise it (minimal / low / medium / high) from the env
 * if a harder task ever justifies the wait; the eval harness is the place to
 * settle whether it does.
 */
const REASONING_EFFORT = process.env.LLM_REASONING_EFFORT?.trim() || "none";

/**
 * Params every completion shares. Centralised because there are seven call
 * sites and a latency fix applied to six of them is not a latency fix.
 */
function common(): Record<string, unknown> {
  return REASONING_EFFORT === "default"
    ? {}
    : { reasoning: { effort: REASONING_EFFORT } };
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
 * The model TYPING the absence instead of producing it.
 *
 * The prompt used to say "output an EMPTY STRING" on silence, and models did
 * exactly that — the words EMPTY STRING landed in the user's message. The
 * prompt no longer names a literal (see assistPrompt.ts), but an instruction
 * about emptiness will always tempt a placeholder, so the echo is caught here
 * too. Belt and braces, because the failure is invisible until it is in
 * somebody's WhatsApp.
 *
 * ANCHORED AND WHOLE-OUTPUT ONLY. These words are ordinary English and a real
 * dictation may contain them — "send me an empty box", "the file is null" —
 * so a match anywhere inside a sentence must never fire. The response has to
 * BE the placeholder and nothing else.
 */
const EMPTY_ECHO =
  /^[\s"'`(\[<{*_-]*(?:an?\s+)?(?:empty(?:\s+(?:string|response|output|text|message))?|no(?:ne|thing|\s+text|\s+output|\s+content)|null|nil|undefined|n\/?a|blank|silence|<\s*empty\s*>)[\s"'`)\]>}*_.,;:-]*$/i;

/**
 * A pair of wrappers with nothing inside — the model showing you the empty
 * string rather than being it.
 *
 * Deliberately narrow: only a matched, EMPTY pair. A bare "?" or "..." is a
 * message people really do send, and a rule that swallowed all punctuation
 * would eat it.
 */
const BARE_WRAPPER = /^(?:""|''|``|\(\)|\[\]|<>|\{\}|"\s*"|'\s*')$/;

/** True when the whole completion is a stand-in for "I have nothing to say". */
export function looksLikeEmptyEcho(text: string): boolean {
  const t = text.trim();
  // Bounded hard: the longest of these is a couple of words. Anything longer is
  // a real message that happens to start with one of them.
  if (!t || t.length > 24) return false;
  return BARE_WRAPPER.test(t) || EMPTY_ECHO.test(t);
}

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
  // The placeholder is treated as the empty output it was meant to be, NOT as
  // meta: falling back to `input` here would insert the raw noisy transcript
  // the model correctly decided was unintelligible. On a silent clip `inp` is
  // already "" and both paths agree; on a noisy one only this path is right.
  if (out && looksLikeEmptyEcho(out)) return "";
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
  phone?: string;
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
    case "phone":
      return ctx.phone ?? "";
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
 * `{phone}`,
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
    phone: opts.variables?.phone,
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
    ...common(),
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
  // A second recognizer's reading, when it disagreed with the first. Kept as
  // USER content (never spliced into the system prompt) so recognizer output
  // can't act as instructions.
  const alternative = opts.alternative?.trim();
  const hasAlternative = !!alternative && alternative !== message.trim();
  const system = buildAssistSystem({
    tone: opts.tone,
    tonePrompt: opts.tonePrompt,
    personality: opts.personality,
    language: opts.language,
    targetApp: opts.targetApp,
    script: opts.script,
    hasContext: !!context,
    hasAlternative,
  });
  const messageBlock = hasAlternative
    ? `CANDIDATE 1 (more reliable):\n${message.trim()}\n\nCANDIDATE 2:\n${alternative}`
    : message.trim();
  const userContent = context
    ? `CONTEXT (already in the field):\n${context}\n\nMESSAGE (what I just said or typed):\n${messageBlock}`
    : messageBlock;
  const res = await openrouter().chat.completions.create({
    ...common(),
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
    ...common(),
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
    ...common(),
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
    ...common(),
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

// --- Style portrait (Training tab) -----------------------------------------

/**
 * Training: produce three distinct refined variants of the same input so the
 * user can pick the one that sounds most like them. One JSON call — the
 * variants probe different directions (their learned style, tighter, warmer)
 * while all staying faithful to the message. Falls back to a single assist()
 * result if the JSON reply is unusable, so the Training screen never dead-ends.
 */
/** The three directions the Training tab probes. Authored as separate calls
 *  rather than one JSON blob — see refineVariants. */
export const VARIANT_ANGLES: Array<{ angle: string; brief: string }> = [
  { angle: "closest", brief: "Follow their style portrait exactly (or do a neutral clean-up if there is none)." },
  { angle: "tighter", brief: "Noticeably more compact and direct than you would normally write it. Cut every word that isn't pulling weight." },
  { angle: "warmer", brief: "Noticeably more natural and personal than you would normally write it — how they'd talk to someone they like." },
];

/**
 * Training: produce three refinements of the same input, differing only in
 * style, so the user can pick the one that sounds most like them.
 *
 * Three PARALLEL calls, not one call returning JSON. The single-call version
 * had to generate ~3× the output tokens before anything could render, and the
 * user sat watching "Refining…" for all of it — the Training tab felt broken.
 * Run concurrently, the wait is one short completion instead of one long one,
 * and dropping JSON mode removes both the formatting overhead and a whole
 * class of parse failures.
 *
 * Each call carries the FULL assist prompt, so instruction separation, script
 * fidelity and the style portrait all apply — a command like "write this in
 * Marathi" is executed once per variant rather than being rewritten as if it
 * were part of the message.
 */
export async function refineVariants(
  message: string,
  opts: CleanupOptions = {},
): Promise<Array<{ text: string; angle: string }>> {
  if (!message.trim()) return [];
  const base = buildAssistSystem({
    tone: opts.tone,
    tonePrompt: opts.tonePrompt,
    personality: opts.personality,
    language: opts.language,
    targetApp: opts.targetApp,
    script: opts.script,
    hasContext: false,
  });

  const settled = await Promise.allSettled(
    VARIANT_ANGLES.map(async ({ angle, brief }) => {
      // The separation contract in `base` decides WHAT to write; this only
      // shapes HOW. Stated in that order so a spoken instruction is still
      // executed rather than treated as content to restyle.
      const system =
        base +
        "\n\nTRAINING VARIANT: after applying the rules above to work out what the user wants written, " +
        "write that message in this specific direction:\n" + brief +
        "\nSay the same thing the other versions would say — only the style differs. " +
        "Output ONLY the message, exactly as the rules above require.";
      const res = await openrouter().chat.completions.create({
    ...common(),
        model: getConfig().CLEANUP_MODEL,
        temperature: 0.6, // higher than cleanup: the variants must actually differ
        max_tokens: MAX_TOKENS_CLEANUP,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message.trim() },
        ],
      });
      const text = (res.choices[0]?.message?.content ?? "").trim();
      return { angle, text };
    }),
  );

  const out = settled
    .filter((r): r is PromiseFulfilledResult<{ angle: string; text: string }> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v) => v.text && !looksLikeMeta(v.text));

  // Identical variants are worse than fewer variants — a user asked to choose
  // between three copies of the same sentence learns nothing and teaches us
  // nothing. Keep the first of any duplicate.
  const seen = new Set<string>();
  const unique = out.filter((v) => {
    const key = v.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length >= 2) return unique.slice(0, 3);

  // Every leg failed (or they all collapsed to one reading) — fall back to a
  // single ordinary refine so the Training tab never dead-ends.
  const single = await assist(message, opts);
  return single.trim() ? [{ angle: "closest", text: single.trim() }] : unique;
}

/**
 * Training: absorb one pick (chosen vs rejected variants) into the evolving
 * portrait. The LLM REWRITES the portrait rather than appending — that keeps
 * it a living, bounded description instead of an ever-growing log. Tone-scoped
 * picks also refresh that tone's note.
 */
/**
 * The prompt that WRITES the portrait on the picking path.
 *
 * Exported because this is the product's memory of a person and it should be
 * readable and testable without instrumenting a live request. `npm run prompts`
 * prints it.
 */
export function portraitSystem(
  trainingTone?: string,
  current?: Personality["stylePortrait"],
): string {
  return [
    "You keep a portrait of how one person writes, close enough that their sentences could be reproduced from it. You have the portrait so far, and one new piece of evidence: what they said, the version they chose as sounding most like them, and the ones they did not.",
    "The version they REJECTED is evidence too, and the sharpest kind — it tells you what they are not, which a hundred accepted messages never would.",
    "Rewrite the portrait against that evidence: keep what still holds, drop what it contradicts, add what it reveals.",
    "",
    portraitProvenance(current),
    "",
    "What to notice:",
    PORTRAIT_DIMENSIONS,
    "",
    PORTRAIT_BOUNDS,
    "",
    portraitJsonContract({ trainingTone }),
  ].join("\n");
}

export async function updateStylePortrait(
  current: Personality["stylePortrait"],
  example: {
    input: string;
    chosen: string;
    rejected: string[];
    /** Human-readable name of the voice/tone being trained (never a raw id). */
    tone?: string;
    /** The existing note for that voice/tone — the caller resolves it by KEY
     * (voice id), which may differ from the display name above. */
    currentToneNote?: string;
  },
): Promise<PortraitDraft & { core: string }> {
  const trainingTone = example.tone && example.tone !== "none" ? example.tone : undefined;
  const system = portraitSystem(trainingTone, current);
  const user = [
    `CURRENT PORTRAIT:\n${current?.core?.trim() || "(none yet)"}`,
    trainingTone && example.currentToneNote
      ? `CURRENT '${trainingTone}' NOTE:\n${example.currentToneNote}`
      : "",
    `THEY SAID:\n${example.input.slice(0, 1200)}`,
    `THEY PICKED:\n${example.chosen.slice(0, 1200)}`,
    example.rejected.length
      ? `THEY REJECTED:\n${example.rejected.map((r, i) => `${i + 1}. ${r.slice(0, 800)}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
  const res = await openrouter().chat.completions.create({
    ...common(),
    // The portrait is off the user's path and read by every later refine, so
    // it can afford a stronger model than the one that runs while they wait.
    model: getConfig().PORTRAIT_MODEL || getConfig().CLEANUP_MODEL,
    temperature: LEARN_TEMPERATURE,
    max_tokens: MAX_TOKENS_STYLE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const draft = parsePortraitDraft(res.choices[0]?.message?.content ?? "{}");
  return { ...draft, core: draft.core || current?.core || "" };
}

// --- Training by conversation ----------------------------------------------
//
// The other half of the Train tab. The picking loop learns from a choice
// between three written versions; this learns from someone just talking, which
// gets at things a written variant cannot show — how long their sentences run
// before they stop, whether they ask back, what they sound like when nobody is
// editing them.
//
// Every line here is spoken aloud, so the constraints are different from
// anything else in this file: short, no punctuation the ear cannot hear, no
// lists, no formatting at all.

/** Spoken turns, oldest first. */
export type ConverseTurn = { role: "user" | "assistant"; text: string };

const MAX_TOKENS_SPOKEN = 160;      // two sentences of speech, with headroom
const CONVERSE_TEMPERATURE = 0.75;  // this is small talk, not a spec
/** How many turns the model is shown. Older ones fall off the front. */
const CONVERSE_WINDOW = 24;

/**
 * The next thing the app says out loud.
 *
 * It is an interested stranger, not an interviewer with a form and not a
 * coach. The whole design goal is that the user forgets they are being
 * listened to and just talks, because a person performing "how I talk" is
 * exactly the sample we do not want.
 */
/** The spoken training partner's prompt. Exported so it can be read and
 *  tested; `npm run prompts` prints it. */
export function converseSystem(language?: string): string {
  return [
    "You are talking with someone, out loud, and your only job is to keep them talking easily about themselves. Be curious, warm and brief.",
    "",
    "Every word is spoken, so speak: one or two sentences, plainly, nothing written down and nothing performed.",
    "Answer what they actually said before you ask anything, ask about one thing, and only when you genuinely have something to ask.",
    "If they go quiet, offer something small of your own rather than another question.",
    "Never mention what this conversation is for, and never remark on how they speak.",
    language && language !== "auto" ? `Speak in ${language}.` : "Speak whatever language they are speaking.",
    "",
    "Return only what you say next.",
  ].join("\n");
}

export async function converseTurn(
  turns: ConverseTurn[],
  opts: { personality?: Personality; language?: string } = {},
): Promise<string> {
  const said = turns.filter((t) => t.text?.trim()).slice(-CONVERSE_WINDOW);
  if (!said.length) return "";
  const system = converseSystem(opts.language);

  const res = await openrouter().chat.completions.create({
    ...common(),
    model: getConfig().CLEANUP_MODEL,
    temperature: CONVERSE_TEMPERATURE,
    max_tokens: MAX_TOKENS_SPOKEN,
    messages: [
      { role: "system", content: system },
      ...said.map((t) => ({
        role: t.role === "user" ? ("user" as const) : ("assistant" as const),
        content: t.text.trim().slice(0, 1200),
      })),
    ],
  });
  const text = (res.choices[0]?.message?.content ?? "").trim();
  return looksLikeMeta(text) ? "" : text;
}

/**
 * Rewrite the portrait from a whole conversation, at the end of it.
 *
 * Once, not per turn. How someone talks is a pattern across an exchange — one
 * sarcastic line in the middle of an otherwise careful conversation is noise,
 * and absorbing it turn by turn would let that noise move the portrait as far
 * as the pattern does.
 *
 * Only the user's own turns are evidence. The assistant's lines are in the
 * prompt for context, clearly marked, because a question changes what an
 * answer looks like — but the model is told plainly not to learn from them.
 */
/** The prompt that WRITES the portrait on the spoken path — one read of the
 *  whole conversation, at the end of it. Exported for review and testing. */
export function transcriptSystem(current?: Personality["stylePortrait"]): string {
  return [
    "You keep a portrait of how one person writes, close enough that their sentences could be reproduced from it. You have the portrait so far, and a transcript of them talking freely. Rewrite the portrait against it: keep what still holds, drop what it contradicts, add what it reveals.",
    "Only the lines marked THEM are evidence. The APP lines are what they were answering.",
    "Speech is not writing. Take what survives the crossing and leave what does not: filler, repetition, stumbles and the transcriber's own mistakes are not theirs.",
    "",
    portraitProvenance(current),
    "",
    "What to notice:",
    PORTRAIT_DIMENSIONS,
    "",
    PORTRAIT_BOUNDS,
    "",
    portraitJsonContract(),
  ].join("\n");
}

/** The prompt that writes the portrait from ordinary use. Exported so it can
 *  be read (`npm run prompts`) and tested like the other two. */
export function usageSystem(
  current?: Personality["stylePortrait"],
  withRhythms = false,
): string {
  return [
    "You keep a portrait of how one person writes, close enough that their sentences could be reproduced from it. You have the portrait so far, and a stretch of their real messages.",
    "Each SAID line is how they put it themselves. Each SENT line is what they accepted and sent, having read it. The gap between the two is evidence: what they consistently let a rewrite change is not part of their voice, and what survives every rewrite is the core of it.",
    "Weight what recurs. One odd message is a mood; the same habit across ten is the person.",
    withRhythms
      ? "Each line carries the local time it was written. Use it only if the same difference shows up repeatedly at the same part of the day — someone who is short in the morning every morning. One late-night message is not a rhythm."
      : "",
    "Rewrite the portrait against this: keep what still holds, drop what it contradicts, add what it reveals.",
    "",
    portraitProvenance(current),
    "",
    "What to notice:",
    PORTRAIT_DIMENSIONS,
    "",
    PORTRAIT_BOUNDS,
    "",
    portraitJsonContract({ withRhythms }),
  ].filter(Boolean).join("\n");
}

/**
 * The portrait built from ORDINARY USE, which is where nearly all the evidence
 * has always been.
 *
 * Until this, the portrait only moved when someone deliberately trained: they
 * picked a variant, or they sat through a spoken session. Most people do that
 * a handful of times and then use the keyboard for months. Every one of those
 * dictations passed through the writing model and was thrown away, while the
 * portrait stayed frozen at whatever six taps had taught it.
 *
 * The evidence was already on disk. Every refine writes a history row with
 * what the user said and what they accepted, so this reads them back. No new
 * capture, no new consent surface, nothing stored that was not stored before.
 *
 * WHY BOTH HALVES OF EACH ROW. The input is how they talk when nobody is
 * watching — the raw shape of their thought. The output is what they let
 * through: they had it in front of them and they sent it, which makes it a
 * quiet accept. Neither alone is the person. The distance between them is the
 * most interesting signal in the product, because it is the part we are
 * adding, and a portrait that drifts toward the output would slowly describe
 * the model's habits back to itself.
 */
export async function portraitFromUsage(
  current: Personality["stylePortrait"],
  rows: Array<{ input: string; output: string; targetApp?: string; createdAt?: string }>,
  /** Minutes from UTC, when the app has told us. Absent means no rhythms:
   *  a day-part computed against the wrong clock is worse than none. */
  tzOffsetMinutes?: number,
): Promise<PortraitDraft | null> {
  const usable = rows.filter((r) => r.input?.trim() && r.output?.trim());
  // Too little evidence is worse than none: a portrait rewritten off three
  // messages swings hard on whatever mood those three were written in.
  if (usable.length < 6) return null;

  const knowsClock = typeof tzOffsetMinutes === "number";
  const system = usageSystem(current, knowsClock);

  const evidence = usable
    .map((r) => {
      const where = r.targetApp?.trim() ? ` (${r.targetApp.trim()})` : "";
      // Their clock, not the server's. Rendered as a plain local time so the
      // model reads "07:40" rather than doing arithmetic on an offset.
      let when = "";
      if (knowsClock && r.createdAt) {
        const t = Date.parse(r.createdAt);
        if (Number.isFinite(t)) {
          const local = new Date(t + tzOffsetMinutes! * 60_000);
          const hh = String(local.getUTCHours()).padStart(2, "0");
          const mm = String(local.getUTCMinutes()).padStart(2, "0");
          when = ` ${hh}:${mm}`;
        }
      }
      return `SAID${when}${where}: ${r.input.trim().slice(0, 400)}\nSENT: ${r.output.trim().slice(0, 400)}`;
    })
    .join("\n\n");

  const res = await openrouter().chat.completions.create({
    ...common(),
    // Off the user's path and read by every later refine — the same reasoning
    // as the other two writers: it can afford the better model.
    model: getConfig().PORTRAIT_MODEL || getConfig().CLEANUP_MODEL,
    temperature: LEARN_TEMPERATURE,
    max_tokens: MAX_TOKENS_STYLE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `CURRENT PORTRAIT:\n${current?.core?.trim() || "(none yet)"}\n\n` +
          `THEIR MESSAGES:\n${evidence.slice(0, 14_000)}`,
      },
    ],
  });
  const draft = parsePortraitDraft(res.choices[0]?.message?.content ?? "{}");
  // A reply with nothing usable in it must never wipe months of learning.
  return draft.core || draft.words?.length || draft.styles?.length ? draft : null;
}

export async function portraitFromTranscript(
  current: Personality["stylePortrait"],
  turns: ConverseTurn[],
): Promise<PortraitDraft & { core: string }> {
  const mine = turns.filter((t) => t.role === "user" && t.text?.trim());
  if (mine.length < 2) return { core: current?.core ?? "" };

  const system = transcriptSystem(current);

  const transcript = turns
    .filter((t) => t.text?.trim())
    .map((t) => `${t.role === "user" ? "THEM" : "APP"}: ${t.text.trim().slice(0, 600)}`)
    .join("\n");

  const res = await openrouter().chat.completions.create({
    ...common(),
    // Off the user's path, and read by every later refine — same reasoning as
    // updateStylePortrait: it can afford the better model.
    model: getConfig().PORTRAIT_MODEL || getConfig().CLEANUP_MODEL,
    temperature: LEARN_TEMPERATURE,
    max_tokens: MAX_TOKENS_STYLE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `CURRENT PORTRAIT:\n${current?.core?.trim() || "(none yet)"}\n\n` +
          `TRANSCRIPT:\n${transcript.slice(0, 12_000)}`,
      },
    ],
  });
  const draft = parsePortraitDraft(res.choices[0]?.message?.content ?? "{}");
  return { ...draft, core: draft.core || current?.core || "" };
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
    ...common(),
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
