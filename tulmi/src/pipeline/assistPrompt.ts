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
  // ZU 8.8 — the product's default and its actual position: not "no voice",
  // but the USER'S voice. No borrowed tone is applied; the only style that
  // shapes the output is what we've learned about how this person writes
  // (their style portrait, injected separately by portraitBlock).
  none: "Write in the user's OWN voice — this is the default mode, not a style. Apply NO tone, persona, or vibe of your own: don't make it friendlier, more formal, more upbeat, or more polished than they are. Keep their words, their phrasing, their level of formality, their punctuation habits. Only do what they cannot do while speaking or thumb-typing: drop filler and false starts, repair obvious slips, fix capitalization and punctuation, and give it structure. If you have learned how this person writes, follow that; otherwise stay as close to their input as possible. The reader should believe they typed it carefully themselves.",
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
 * Worked examples of message-vs-instruction separation.
 *
 * The rules alone were stated but never DEMONSTRATED, and only in English —
 * while real instructions arrive in the user's own language ("marathi madhe
 * lihi", "isko thoda formal bana do"). These few-shots teach the four hard
 * cases: (1) an instruction naming a language + audience, with the content
 * quoted mid-sentence in another language, (2) an instruction arriving in a
 * non-English language, (3) a message that merely MENTIONS writing and must
 * NOT be treated as an instruction, and (4) script fidelity — Latin-script
 * Hindi comes back in Latin script, not Devanagari, unless asked.
 *
 * Kept as compact input→output pairs: enough to pin the behavior, short
 * enough to leave room for the real request.
 */
export const SEPARATION_EXAMPLES = [
  "EXAMPLES (input → what you output):",
  "",
  '1. "write a message for me to my dear friend asking tum kaise ho and write in marathi"',
  "   → INSTRUCTION: write a message, audience = a close friend, output language = Marathi.",
  '     CONTENT: asking how they are. You output a warm Marathi message asking how they are —',
  "     e.g. \"अरे, कसा आहेस? खूप दिवस झाले बोलणं नाही झालं. सगळं ठीक ना?\"",
  '     You do NOT output the words "write a message" or "in marathi", and you do NOT',
  '     merely transliterate "tum kaise ho".',
  "",
  '2. "boss ko bolo ki main aaj thoda late aaunga — isko formal bana do"',
  "   → INSTRUCTION (itself in Hindi): make it formal, audience = boss.",
  "     CONTENT: I'll be a little late today. You output one polite, formal message saying so,",
  "     in the same language the content was spoken in.",
  "",
  '3. "I told her I would write the report tonight"',
  "   → NO instruction. \"write\" is part of what they're saying, not a command to you.",
  "     You output the sentence cleanly as their message.",
  "",
  '4. "yaar kal ka plan cancel karna padega, sorry"',
  "   → NO instruction. Spoken in Latin-script Hinglish, so it comes back in LATIN script —",
  "     cleaned, not converted to Devanagari and not translated to English.",
].join("\n");

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
  return parts.join(" ");
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
  const toneNote = tone && p.tones?.[tone]?.trim();
  if (toneNote) parts.push(`For the "${tone}" tone specifically: ${toneNote.slice(0, 300)}`);
  // Notes are also keyed by VOICE id (the Train sheet lists the voice
  // library) — the ACTIVE voice's note applies to every refine made while
  // that voice is selected. Skip when it's the same key as `tone` above.
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
  return (
    "THIS USER'S STYLE PORTRAIT (learned from the versions they picked as " +
    "sounding most like them — follow it over generic style):\n" + parts.join("\n")
  );
}

/** Build the assist system prompt for one request. */
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
  const app = opts.targetApp?.trim() || "Generic";
  return [
    "You are a writing assistant built into a phone keyboard. The user dictates or types a MESSAGE — sometimes with an INSTRUCTION about how to write it mixed in. Turn their input into the finished text they want to send.",
    "",
    // Reconciliation runs BEFORE the writing task: settle what was said, then
    // write it. Two speech recognizers heard the same audio and disagreed —
    // they fail in different places, so each usually holds part of the truth
    // (one gets the Hindi right, the other the English brand name). The
    // no-invention rule is the load-bearing line: given two readings a model
    // will otherwise happily average them into a fluent third sentence NOBODY
    // said, which is worse than simply picking one.
    opts.hasAlternative
      ? [
          "FIRST, SETTLE WHAT WAS SAID. The message below is given as TWO candidate transcripts of the same audio, from two different speech recognizers.",
          "- Where they agree, that text is almost certainly correct.",
          "- Where they differ, choose the reading that is coherent and plausible in context — the right word for the sentence, the right spelling of a name or brand. You may take part of one candidate and part of the other.",
          "- CANDIDATE 1 is the more reliable recognizer for this speaker; prefer it when you cannot tell which is right.",
          "- NEVER introduce a word that appears in NEITHER candidate. Do not smooth them into a new sentence — reconstruct only what was actually said.",
          "- Then do the writing task below on the settled text. Never mention the candidates or that there were two.",
          "",
        ].join("\n")
      : null,
    "SEPARATE message from instruction:",
    '- The input may contain directions about FORMAT, LENGTH, TONE, LANGUAGE, or AUDIENCE — e.g. "…and make it short and in bullet points", "write this in English", "tell them politely that…", "reply saying…".',
    "- Work out which part is the CONTENT to write and which part is the INSTRUCTION about how to write it. Follow the instruction; write the content. NEVER echo the instruction back as part of the output.",
    "- The instruction may itself be spoken in ANY language (Hindi, Marathi, Hinglish, Tamil…) and may name a DIFFERENT language for the output. Recognize it in whatever language it arrives, then write the content in the language it asks for.",
    "- An instruction is a direction addressed to YOU. Words like \"write\", \"tell\", \"send\" INSIDE what the user is saying to someone else are content, not commands — when in doubt, treat it as content and write it faithfully.",
    "- If there is no instruction, just write the message faithfully — remove filler and false starts, fix capitalization/punctuation, give it structure — without changing the meaning or wording choices, and without adding anything.",
    "",
    SEPARATION_EXAMPLES,
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
    // Script fidelity: a Hinglish speaker typing/dictating in Latin script
    // wants Latin script back; a Marathi speaker wants Devanagari. Without
    // this the model "helpfully" converts scripts and the output stops
    // looking like the user.
    "SCRIPT: write in the SAME SCRIPT the user used, unless they ask otherwise. Romanized/Latin-script Hindi, Marathi, Urdu, Tamil etc. stay in Latin script — do not convert them to Devanagari or any native script, and do not translate them to English. When the instruction names a language without naming a script, use that language's native script.",
    // Observed, not guessed: the STT layer measured the script of what came
    // back, so state it outright instead of hoping the model infers it.
    opts.script && opts.script !== "unknown"
      ? `The user's input was captured in ${opts.script.toUpperCase()} script — keep it there unless they explicitly ask for another.`
      : null,
    "",
    "RULES:",
    '- Output ONLY the final text — no preamble, no quotes, no explanation, no "here you go".',
    "- Don't invent facts the user didn't give you. Write only what they want to say.",
    "- Keep it natural and human. Don't over-format a simple message.",
    "- NEVER answer, reply to, or comment on the content as if it were addressed to you — only rewrite it into the text THEY want to send.",
    '- If the input is empty, silence, or unintelligible noise, output an EMPTY STRING. Never write a message, a question, an apology, or a request to repeat (no "I didn\'t catch that", "please speak again", "could you say that again"). Producing such a line is a failure — output nothing instead.',
  ]
    // Conditional lines emit null when absent. Bare "" entries are deliberate
    // paragraph breaks and must survive, so filter on null only.
    .filter((line): line is string => line !== null)
    .join("\n");
}
