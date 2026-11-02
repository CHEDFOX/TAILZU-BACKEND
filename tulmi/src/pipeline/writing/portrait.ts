/**
 * The person's style portrait: inferred, updated from use and from a spoken conversation.
 */

import type { Personality } from "../../../../shared/types/api.js";
import { getConfig } from "../../config.js";
import { compose } from "../../principles/roles.js";
import { inlineValue } from "../../prompts.js";
import { callBlock } from "../assistPrompt.js";
import { portraitProvenance, type PortraitDraft, parsePortraitDraft } from "../portraitDimensions.js";
import type { ConverseTurn } from "./converse.js";
import { complete, MAX_TOKENS_STYLE } from "./model.js";

/**
 * Training: absorb one pick (chosen vs rejected variants) into the evolving
 * portrait. The LLM REWRITES the portrait rather than appending — that keeps
 * it a living, bounded description instead of an ever-growing log. Tone-scoped
 * picks also refresh that tone's note.
 */
/**
 * What the `portrait_update` role is told about THIS pick: how much evidence is
 * behind the portrait it is given, and the voice being trained, when there is
 * one (principles/roles.ts has the rules and what to notice).
 *
 * Exported because this is the product's memory of a person and it should be
 * readable and testable without instrumenting a live request. `npm run prompts`
 * prints it.
 */
export function portraitContext(
  trainingTone?: string,
  current?: Personality["stylePortrait"],
): string {
  // A voice's name is the user's own, placed inside a sentence.
  const tone = inlineValue(trainingTone, 40).replace(/["']/g, "");
  return callBlock([portraitProvenance(current), tone ? `The voice this is for: ${tone}.` : null]) + "\n";
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
  const user = [
    portraitContext(trainingTone, current).trimEnd(),
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
  const res = await complete({
    // The portrait is off the user's path and read by every later refine, so
    // it can afford a stronger model than the one that runs while they wait.
    model: getConfig().PORTRAIT_MODEL || getConfig().CLEANUP_MODEL,
    temperature: LEARN_TEMPERATURE,
    max_tokens: MAX_TOKENS_STYLE,
    response_format: { type: "json_object" },
    messages: compose("portrait_update", [{ role: "user" as const, content: user }]),
  });
  const draft = parsePortraitDraft(res.choices[0]?.message?.content ?? "{}");
  return { ...draft, core: draft.core || current?.core || "" };
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
/**
 * What the `portrait_transcript` role is told about THIS conversation: how much
 * evidence is behind the portrait it is given. One read of the whole
 * conversation, at the end of it. Exported for review and testing.
 */
export function transcriptContext(current?: Personality["stylePortrait"]): string {
  return callBlock([portraitProvenance(current)]) + "\n";
}

/**
 * What the `portrait_usage` role is told about THESE messages: how much
 * evidence is behind the portrait it is given, and whether the lines carry the
 * local time they were written, so a rhythm can be seen. Exported so it can be
 * read (`npm run prompts`) and tested like the other two.
 */
export function usageContext(
  current?: Personality["stylePortrait"],
  withRhythms = false,
): string {
  return callBlock([portraitProvenance(current), withRhythms ? "The lines carry the local time they were written." : null]) + "\n";
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
  const head = usageContext(current, knowsClock);

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

  const res = await complete({
    // Off the user's path and read by every later refine — the same reasoning
    // as the other two writers: it can afford the better model.
    model: getConfig().PORTRAIT_MODEL || getConfig().CLEANUP_MODEL,
    temperature: LEARN_TEMPERATURE,
    max_tokens: MAX_TOKENS_STYLE,
    response_format: { type: "json_object" },
    messages: compose("portrait_usage", [{
      role: "user" as const,
      content:
        head +
        `CURRENT PORTRAIT:\n${current?.core?.trim() || "(none yet)"}\n\n` +
        `THEIR MESSAGES:\n${evidence.slice(0, 14_000)}`,
    }]),
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

  const head = transcriptContext(current);

  const transcript = turns
    .filter((t) => t.text?.trim())
    .map((t) => `${t.role === "user" ? "THEM" : "APP"}: ${t.text.trim().slice(0, 600)}`)
    .join("\n");

  const res = await complete({
    // Off the user's path, and read by every later refine — same reasoning as
    // updateStylePortrait: it can afford the better model.
    model: getConfig().PORTRAIT_MODEL || getConfig().CLEANUP_MODEL,
    temperature: LEARN_TEMPERATURE,
    max_tokens: MAX_TOKENS_STYLE,
    response_format: { type: "json_object" },
    messages: compose("portrait_transcript", [{
      role: "user" as const,
      content:
        head +
        `CURRENT PORTRAIT:\n${current?.core?.trim() || "(none yet)"}\n\n` +
        `TRANSCRIPT:\n${transcript.slice(0, 12_000)}`,
    }]),
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
  const res = await complete({
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
