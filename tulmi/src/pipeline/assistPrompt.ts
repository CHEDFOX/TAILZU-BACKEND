/**
 * The "assist" system prompt — Tailzu's writing brain.
 *
 * ONE prompt runs the product: keyboard dictation, keyboard typing and the
 * in-app mic all build it. Someone tells their keyboard what they want to say
 * and it writes it for them, finished and in their voice.
 *
 * It is written as PRINCIPLES rather than rules, and that is a deliberate
 * reversal. It used to be sixty lines of do-and-don't — a scope list, a
 * separation procedure, four worked examples, a table of field types — and
 * that approach cannot finish. Every case it enumerated implied three it did
 * not, each new failure got answered with another line, and every added line
 * made the earlier ones fainter. A list of exceptions is a promise to keep
 * writing exceptions forever.
 *
 * What is left is a handful of sentences that each generalise, and the tone
 * block, which is the user's own material rather than instruction to the
 * model. Adding to this file should feel expensive. If a new failure appears,
 * the first question is which existing principle failed to cover it, not what
 * sentence to append.
 */
import type { Personality } from "../../../shared/types/api.js";
import { applyPresetOverrides } from "../experience/personalityPresets.js";

/** Short, natural-language guidance per built-in tone. "none" keeps the user's
 *  own voice — a faithful clean-up, not a restyle. */
const TONE_GUIDANCE: Record<string, string> = {
  // ZU — the product's default, and its actual position: not "no voice" but
  // the USER'S voice. Nothing is applied on top; the only thing that shapes
  // the output is what we have learned about how this person writes, injected
  // separately by portraitBlock.
  //
  // This entry was a hundred words of don't — don't make it friendlier, more
  // formal, more upbeat, more polished. One sentence says the same and says it
  // positively, which is the difference between a rule to check against and a
  // voice to write in.
  none: "Their own voice, not a style. Change nothing about how they sound — repair only what speaking or thumb-typing cost them: filler, false starts, slips, punctuation, shape. They should read it back and believe they wrote it carefully.",
  formal: "Formal. Professional register, full words, one idea per sentence, precise punctuation. No slang, no emoji, and no exclamation mark the input did not earn.",
  casual: "The way they would talk to a friend — warm, contracted, unhurried. Never formalize someone who said 'yo'.",
  "very-casual": "Group-chat energy. Punchy, fragments welcome, lowercase fine. Keep every piece of their slang exactly as they wrote it.",
  excited: "As excited as the input actually is, and no more. Active verbs, exclamation marks where they are earned, never manufactured enthusiasm.",
};

/**
 * Cap for an inline (client-supplied) tone prompt. Bounds the token blast
 * radius and keeps a runaway custom prompt from drifting the output. It only
 * shapes the user's OWN output, so this is a safety valve, not a security
 * boundary.
 */
export const MAX_TONE_PROMPT = 600;

/**
 * Resolve the tone guidance for a request.
 *
 * A tone is just "a voice described in a prompt". The client may send that
 * prompt INLINE (`inlinePrompt`) — for a built-in tone the user edited, or a
 * tone they created seconds ago — and it's used verbatim as the voice. This is
 * what makes "any tone, anytime" work with no server-side registry: the backend
 * never has to KNOW a tone, only receive its prompt.
 *
 * When no inline prompt is sent, we fall back to the named built-in tone's
 * guidance plus the active preset's own `promptStyle` (central, tunable
 * defaults so thin/old clients keep working). Either way the user's global
 * customInstructions + sign-off layer on top.
 */
export function toneGuidance(
  tone: string | undefined,
  personality?: Personality,
  inlinePrompt?: string,
): string {
  const parts: string[] = [];
  const inline = inlinePrompt?.trim();
  if (inline) {
    // Inline wins — the client owns the voice (built-in override OR custom tone).
    parts.push(inline.slice(0, MAX_TONE_PROMPT));
  } else {
    parts.push(TONE_GUIDANCE[tone ?? "none"] ?? TONE_GUIDANCE.none);
    if (personality?.activePresetId) {
      const preset = applyPresetOverrides(personality.presetOverrides).find(
        (p) => p.id === personality.activePresetId,
      );
      if (preset?.promptStyle) parts.push(preset.promptStyle);
    }
  }
  // Global user prefs apply regardless of where the voice came from. Sliced
  // like the inline tone prompt — an unbounded personality field (client-
  // suppliable via the refine body's `personality` override) must not smuggle
  // arbitrary prompt length past the request caps.
  if (personality?.customInstructions?.trim()) {
    parts.push(personality.customInstructions.trim().slice(0, 2_000));
  }
  if (personality?.signature?.trim()) {
    parts.push(`If a sign-off fits the message, you may use: ${personality.signature.trim()}`);
  }
  // The learned portrait rides every request, scoped to the active tone.
  const portrait = portraitBlock(personality, tone);
  if (portrait) parts.push(portrait);
  // JOINED ON BLANK LINES, not on a space. These parts come from four
  // different places — the tone, the preset's style, the user's own
  // instruction, their sign-off, their portrait — and a space ran them into
  // one another. Rendering the real prompt showed the result:
  //
  //   "...typed it carefully themselves. Write in a clean, natural voice —
  //   ...clear without being clinical. never use exclamation marks If a
  //   sign-off fits the message, you may use: — R THIS USER'S STYLE PORTRAIT"
  //
  // A lowercase user instruction wedged mid-sentence, a sign-off with the
  // portrait's heading welded to it. Each part is a separate rule and has to
  // look like one, or the weakest-stated one gets read as part of its
  // neighbour and dropped.
  return parts.map((p) => p.trim()).filter(Boolean).join("\n\n");
}

/**
 * Render the user's learned style portrait as a prompt block, or "" when they
 * haven't trained yet. Built from the Training tab's variant picks and
 * injected into every refine path (toneGuidance here + buildTonePrompt for
 * the per-tone endpoints). Hard-capped so a runaway portrait can never crowd
 * out the actual task.
 */
export function portraitBlock(personality: Personality | undefined, tone?: string): string {
  const p = personality?.stylePortrait;
  if (!p) return "";
  const parts: string[] = [];
  if (p.core?.trim()) parts.push(p.core.trim().slice(0, 900));

  // THEIR WORDS, WITH WHAT THEY MEAN. This is why the list is stored as pairs
  // rather than folded into the prose: knowing that someone says "jugaad" only
  // tells the model to preserve it, and knowing what they mean by it is what
  // lets the model USE it. Capped hard — the portrait rides on every request
  // and a lexicon that grows without limit eventually crowds out the message.
  if (p.words?.length) {
    parts.push(
      "Words that are theirs — keep them, and use them where they fit:\n" +
        p.words.slice(0, 24).map((w) => `  ${w.term} — ${w.means}`).join("\n"),
    );
  }
  if (p.styles?.length) {
    parts.push(
      "How they write, by situation:\n" +
        p.styles.slice(0, 4).map((x) => `  ${x.name}${x.when ? ` — ${x.when}` : ""}`).join("\n"),
    );
  }
  // Only ever populated when the user's clock is known, so it is safe to state
  // plainly here rather than hedged.
  if (p.rhythms?.length) {
    parts.push(
      "How they differ through the day:\n" +
        p.rhythms.slice(0, 3).map((r) => `  ${r.when} — ${r.vibe}`).join("\n"),
    );
  }

  const toneNote = tone && p.tones?.[tone]?.trim();
  if (toneNote) parts.push(`For the "${tone}" tone specifically: ${toneNote.slice(0, 300)}`);
  const voiceId = personality?.activePresetId;
  if (voiceId && voiceId !== tone) {
    const voiceNote = p.tones?.[voiceId]?.trim();
    if (voiceNote) {
      const voiceName =
        applyPresetOverrides(personality?.presetOverrides).find((x) => x.id === voiceId)?.name ?? voiceId;
      parts.push(`For their "${voiceName}" voice specifically: ${voiceNote.slice(0, 300)}`);
    }
  }
  if (!parts.length) return "";
  // "HOW THEY WRITE", not a paragraph explaining where the portrait came from.
  // The model does not need the provenance; it needs the observation.
  return "HOW THEY WRITE — follow this over any generic style:\n" + parts.join("\n");
}

/**
 * Build the assist system prompt for one request.
 *
 * PRINCIPLES, NOT RULES. This was sixty lines of do-and-don't: a scope list, a
 * separation procedure, four worked examples, a destination table. That
 * approach cannot finish. Every case it enumerated implied three it did not,
 * and each new failure got answered with another line — which made the prompt
 * longer, the earlier lines fainter, and the next gap likelier. A list of
 * exceptions is a promise to keep writing exceptions forever.
 *
 * What replaced it is a handful of sentences that each generalise:
 *
 *   "Everything you return is what they send."
 *        does the work of the old scope list, the no-preamble rule, the
 *        no-essay rule and the no-explanation rule at once.
 *
 *   "When you cannot tell which it is, it is what they want said."
 *        does the work of the whole separation procedure and its examples,
 *        including the ones nobody thought to write down.
 *
 *   "The field decides the shape, never the content."
 *        does the work of the destination table, and — unlike the table —
 *        cannot be read as permission to supply an answer.
 *
 * The framing changed with it. The old opening insisted the user was not
 * talking TO the model but THROUGH it, which is a distinction the model has to
 * hold rather than something it can act on. They ARE talking to their keyboard;
 * it writes for them. Say that, and the rest follows.
 */
export function buildAssistSystem(opts: {
  tone?: string;
  tonePrompt?: string;
  personality?: Personality;
  language?: string;
  targetApp?: string;
  hasContext: boolean;
  /** Script the transcript actually arrived in (observed by the STT layer).
   *  Stated as a fact so the model can't drift the user's script. */
  script?: string;
  /** True when the user message carries TWO candidate transcripts that need
   *  reconciling before the writing task begins. */
  hasAlternative?: boolean;
}): string {
  const guidance = toneGuidance(opts.tone, opts.personality, opts.tonePrompt);
  const lang = opts.language && opts.language !== "auto" ? opts.language : "";
  const app = opts.targetApp?.trim();
  return [
    "You are the writing assistant inside Tailzu, a keyboard. Someone tells you what they want to say. You write it — as well as it can be written, in their voice, finished and ready to send.",
    "",
    "Everything you return is what they send. Nothing else has anywhere to go.",
    "",
    // Two recognizers heard the same audio and disagreed. The no-invention
    // clause is the load-bearing half: given two readings a model will happily
    // average them into a fluent third sentence nobody said, which is worse
    // than simply picking one.
    opts.hasAlternative
      ? "Two recognizers heard this and disagreed, so it comes to you as two candidates. Keep what they agree on, take the plausible reading where they differ, and invent nothing that is in neither. Candidate 1 is the more reliable one. Never mention that there were two.\n"
      : null,
    "Part of what they say may be addressed to you: how to write it, how long, what language, who it is for. Do that part; write the rest. When you cannot tell which it is, it is what they want said — a question they dictate is a question they are sending, not one for you to answer.",
    "",
    lang
      ? `Write in ${lang} unless they ask otherwise or plainly speak another language, and in the same script they used.`
      : "Write in their language and their script, exactly as they used them.",
    // Observed, not guessed: the STT layer measured what came back, so state it
    // as fact rather than hoping the model infers it. Without this, romanized
    // Hinglish drifts into Devanagari.
    opts.script && opts.script !== "unknown"
      ? `Theirs was ${opts.script}.`
      : null,
    "",
    app
      ? `They are writing into ${app}. The field decides the SHAPE of the text and never its content: a search box wants the words, a number field wants the number, a message wants sentences.`
      : "The field they are writing into decides the SHAPE of the text and never its content.",
    opts.hasContext
      ? "What is already in the field is given as context — their draft, or the conversation. Continue or revise it; do not repeat it."
      : null,
    "",
    "Say nothing they did not give you. If there is nothing to write, return nothing at all: no placeholder, no apology, no asking them to repeat.",
    "",
    `TONE: ${guidance}`,
  ]
    // Conditional lines emit null when absent. Bare "" entries are deliberate
    // paragraph breaks and must survive, so filter on null only.
    .filter((line): line is string => line !== null)
    .join("\n");
}
