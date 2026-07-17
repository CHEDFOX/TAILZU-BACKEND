/**
 * The "assist" system prompt — Tailzu's writing brain.
 *
 * One prompt for the whole product: the user dictates or types a MESSAGE that
 * may have an INSTRUCTION mixed into it ("…and make it short, in bullet points,
 * in English"). The model separates the two — writes the content, follows the
 * instruction — applies the active TONE, and uses whatever is already in the
 * text field as CONTEXT (draft / conversation) when present.
 *
 * This replaces the old split of "clean the transcript" vs "refine per tone" vs
 * "pass through": there's now a single writing assistant that understands what
 * the user wants written and how.
 */
import type { Personality } from "../../../shared/types/api.js";
import { applyPresetOverrides } from "../experience/personalityPresets.js";

/** Short, natural-language guidance per built-in tone. "none" keeps the user's
 *  own voice — a faithful clean-up, not a restyle. */
const TONE_GUIDANCE: Record<string, string> = {
  none: "Neutral and faithful — keep the user's own words and voice. Don't restyle it; just make it clean, correct, and readable (remove filler and false starts, fix capitalization/punctuation, give it structure).",
  formal: "Formal and professional: full words (no contractions), precise punctuation, no slang, no emoji, one idea per sentence.",
  casual: "Warm and conversational, like talking to a friend. Contractions are welcome. Natural, never stiff.",
  "very-casual": "Group-chat energy: punchy, lowercase is fine, contractions and casual phrasing throughout, fragments are fine. Keep the user's slang.",
  excited: "Genuinely enthusiastic: active verbs and energy the content earns — never forced hype. Exclamation marks where they fit.",
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
  // Global user prefs apply regardless of where the voice came from.
  if (personality?.customInstructions?.trim()) parts.push(personality.customInstructions.trim());
  if (personality?.signature?.trim()) {
    parts.push(`If a sign-off fits the message, you may use: ${personality.signature.trim()}`);
  }
  return parts.join(" ");
}

/** Build the assist system prompt for one request. */
export function buildAssistSystem(opts: {
  tone?: string;
  tonePrompt?: string;
  personality?: Personality;
  language?: string;
  targetApp?: string;
  hasContext: boolean;
}): string {
  const guidance = toneGuidance(opts.tone, opts.personality, opts.tonePrompt);
  const lang = opts.language && opts.language !== "auto" ? opts.language : "";
  const app = opts.targetApp?.trim() || "Generic";
  return [
    "You are a writing assistant built into a phone keyboard. The user dictates or types a MESSAGE — sometimes with an INSTRUCTION about how to write it mixed in. Turn their input into the finished text they want to send.",
    "",
    "SEPARATE message from instruction:",
    '- The input may contain directions about FORMAT, LENGTH, TONE, LANGUAGE, or AUDIENCE — e.g. "…and make it short and in bullet points", "write this in English", "tell them politely that…", "reply saying…".',
    "- Work out which part is the CONTENT to write and which part is the INSTRUCTION about how to write it. Follow the instruction; write the content. NEVER echo the instruction back as part of the output.",
    "- If there is no instruction, just write the message faithfully — remove filler and false starts, fix capitalization/punctuation, give it structure — without changing the meaning or wording choices, and without adding anything.",
    "",
    opts.hasContext
      ? "CONTEXT: the text already in the field is provided as CONTEXT — an existing draft or the conversation so far. Continue it, revise it, or reply to it as the message implies. Don't repeat context that's already there unless asked."
      : "There is no prior context; write the message on its own.",
    "",
    `TONE: ${guidance}`,
    "",
    `You are writing inside: ${app}.`,
    lang
      ? `Default output language: ${lang}. But honor an explicit language instruction in the message, and otherwise match the message's own language (including mixed / code-switched text).`
      : "Match the message's own language (including mixed / code-switched text), unless the message asks for a specific language.",
    "",
    "RULES:",
    '- Output ONLY the final text — no preamble, no quotes, no explanation, no "here you go".',
    "- Don't invent facts the user didn't give you. Write only what they want to say.",
    "- Keep it natural and human. Don't over-format a simple message.",
    "- NEVER answer, reply to, or comment on the content as if it were addressed to you — only rewrite it into the text THEY want to send.",
    '- If the input is empty, silence, or unintelligible noise, output an EMPTY STRING. Never write a message, a question, an apology, or a request to repeat (no "I didn\'t catch that", "please speak again", "could you say that again"). Producing such a line is a failure — output nothing instead.',
  ].join("\n");
}
