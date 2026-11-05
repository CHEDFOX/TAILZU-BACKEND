/**
 * What the writer is told about one request: the words, the field, the app and the script.
 */

import type { CleanupOptions } from "../../../../shared/types/api.js";
import { nicknameOf, heardNameIn } from "../../experience/assistantName.js";
import { stableBlock } from "../../principles/roles.js";
import { renderCommandOverride } from "../../prompts.js";
import { writerContext, stripFenceTags } from "../assistPrompt.js";
import { splitInstruction } from "../commands.js";
import { promptsAnAi, composeAsk, mentionsAPiece } from "../compose.js";
import { describeField, fieldKindOf, takesAValue, cleanLabel } from "../field.js";
import { screenIsOffLimits } from "../sensitive.js";
import { type RecentDictation, earlierBlock } from "../session.js";
import { detectScript, INDIC_SCRIPTS, readsAsRomanHindi, mixesEnglishAndRomanHindi } from "../stt.js";

/**
 * The script a piece of text is written in, or undefined when there is no
 * answer worth stating. Saying "Theirs was unknown." in the prompt is worse
 * than saying nothing: it invites a choice where the fact was meant to remove
 * one.
 */
export function scriptOf(text: string): string | undefined {
  const s = detectScript(text);
  return s && s !== "unknown" ? s : undefined;
}

// --- Cleanup / refine (voice + typing) -------------------------------------

/**
 * What the writer is handed, built once for assist() and refineVariants() so
 * the Training variants get exactly the separation, script fact and fence the
 * keyboard does.
 */
interface WriterRequest {
  /** What they said, with any trailing instruction taken off. */
  message: string;
  context?: string;
  askedLanguage?: string;
  /** They asked for something about the writing (shorter, formal, a language). */
  instructed: boolean;
  /** They asked for a piece to be written for them, unmistakably or in so many
   *  words (compose.ts): what comes back is meant to be longer than what they
   *  said, and in words they did not say. */
  piece: boolean;
  /** The field is a prompt for another AI (compose.promptsAnAi). */
  toAnAi: boolean;
  /** They asked for more than a keyboard writes (compose: tooBig), so the
   *  request itself is what they are saying. */
  tooBig: boolean;
  /** The field is not for sentences: a search box, a number (fieldShapesIt). */
  field: boolean;
  /** The writer role's stable block: the same bytes for everyone. */
  system: string;
  /** The fenced data that follows it, at the head of `userContent` (assistPrompt.writerContext). */
  head: string;
  /** `head`, then what they said. */
  userContent: string;
  /** What the model was told, whole: for the check that it did not quote it back (quotesPrompt). */
  told: string;
}

/**
 * What the writer is given beyond a request's own fields. Server-side only:
 * nothing here is read from a request body.
 */
export interface WriterExtras {
  /** Their dictations from the last few minutes (session.recentDictations). */
  recent?: RecentDictation[];
  /** Their clock, so the session can say when, in their time. */
  tzOffsetMinutes?: number;
  /** The desktop held back the full stop that ended `context` at a pause (its
   *  pause stretches, see assistPrompt): this stretch decides whether it goes in. */
  heldStop?: boolean;
  /** Training: the direction of this one version (VARIANT_ANGLES). */
  variant?: string;
}

export function writerRequest(input: string, opts: CleanupOptions & WriterExtras): WriterRequest {
  // THE INSTRUCTION COMES OFF FIRST (commands.splitInstruction). The writer is
  // handed the message alone and told what was asked, so no word of the
  // request can be written into it — and every fallback below returns the
  // message without it, never the raw sentence with the instruction inside.
  const split = splitInstruction(input);
  const asked = split.command;
  const askedLanguage = asked && (asked.kind === "language" || asked.kind === "translate")
    ? asked.lang.replace(/\b\w/g, (c) => c.toUpperCase())
    : undefined;
  const message = split.message;
  // THE SCREEN IS OFF LIMITS in a money/health app (privateField; a private
  // window only where the desktop has them off, else it is read): not
  // the text around the field, and not even their own prior text, which in
  // those apps is a balance or a card number. Everywhere else, both ride.
  const offLimits = screenIsOffLimits(opts);
  const context = offLimits ? undefined : opts.context?.trim();
  const around = offLimits ? undefined
    : (typeof opts.surroundings === "string" ? opts.surroundings : "").replace(/\s+\n/g, "\n").trim() || undefined;
  // A PROMPT FOR ANOTHER AI IS NEVER A JOB FOR THIS ONE, and otherwise: is
  // this an ask to write a piece for them, or for more than a keyboard
  // writes? Measured on the message, after any "make it sweet" is off it.
  const toAnAi = promptsAnAi(opts.targetApp);
  const ask = composeAsk(message, opts.targetApp, nicknameOf(opts.personality));
  const piece = ask?.kind === "piece" || (!toAnAi && ask?.kind !== "tooBig" && mentionsAPiece(message));
  const earlier = earlierBlock(opts.recent, { tzOffsetMinutes: opts.tzOffsetMinutes, context });
  // A second recognizer's reading, when it disagreed with the first. Kept as
  // USER content (never spliced into the system prompt) so recognizer output
  // can't act as instructions.
  // Its instruction comes off too, or candidate 2 carries the words candidate
  // 1 no longer does.
  const alternative = opts.alternative ? splitInstruction(opts.alternative).message : undefined;
  const hasAlternative = !!alternative && alternative !== message.trim();
  // WHICH READING LEADS IS DECIDED BY THE TEXT, as the stream and the
  // one-shot path decide it: the prompt calls candidate 1 the more reliable,
  // and the live path hands over what reached the cursor first, which for an
  // Indic speaker is often the engine that only approximated them. The one
  // that came back in their script, or in their romanized words, leads.
  const altLeads = hasAlternative && (
    (INDIC_SCRIPTS.has(detectScript(alternative!)) && !INDIC_SCRIPTS.has(detectScript(message)))
    || readsAsRomanHindi(message, alternative!));
  const head = writerContext({
    tone: opts.tone,
    tonePrompt: opts.tonePrompt,
    personality: opts.personality,
    // ONLY A LANGUAGE ASKED FOR IN THIS DICTATION. The saved one is the
    // language they SPEAK (the Languages card, the keyboard's mic language):
    // a hint for the recognizer, never a language to write in. Passed here it
    // became "Write in en." and "Write in hi.", which took the never-translate
    // rule out of the prompt: Hinglish came back as English for anyone whose
    // first language was English, and as Devanagari, which the alphabet guard
    // then threw away for the raw transcript, for anyone whose first was Hindi.
    language: askedLanguage,
    instruction: asked && !askedLanguage ? renderCommandOverride(asked) : undefined,
    targetApp: opts.targetApp,
    field: describeField(opts.fieldKind, opts.fieldLabel),
    // THE SCRIPT IS OBSERVABLE HERE, AND WAS ONLY EVER OBSERVED UPSTREAM.
    //
    // assistPrompt states the script as a measured fact — "Theirs was latin."
    // — and its own comment says that without it romanized Hinglish drifts
    // into Devanagari. Only the STT layer was measuring it, so every TYPED
    // path (the keyboard's /v1/refine, /v1/draft) built the prompt with no
    // script at all and the model chose one. It chose Devanagari:
    // "mujhe kal subah jaldi uthna hai" came back "मुझे कल सुबह जल्दी उठना है।"
    // on the deployed server, which is the transliteration the rule exists to
    // prevent.
    //
    // Derived here rather than at each call site because there are three of
    // them and a fourth will be added without this. A caller that DID measure
    // it (the STT path, which sees the recognizer's own reading) still wins.
    script: opts.script ?? scriptOf(message),
    // Only meaningful within one script — a sentence that already switches
    // alphabets shows its own mixture, and the script fact carries it.
    mixedLanguages: mixesEnglishAndRomanHindi(message),
    // Only "low" is worth saying. "unknown" means the provider reports no
    // confidence at all (the OpenAI path), and calling that uncertain would
    // tell the model every transcript from that engine is a guess.
    uncertain: opts.speechConfidence === "low",
    hasContext: !!context,
    heldStop: !!context && opts.heldStop === true,
    hasAlternative,
    compose: ask?.kind,
    promptsAnAi: toAnAi,
    calledAs: toAnAi ? undefined : heardNameIn(message),
    hasEarlier: !!earlier,
    hasAround: !!around,
    variant: opts.variant,
  });
  // FENCED, NOT HANDED OVER AS A TURN. The dictation used to be the whole
  // user message, and a user message is what a chat model replies to: a
  // dictated question came back answered, a long ramble came back as a
  // response to it. Inside <said> it is the material; the system prompt says
  // what to do with it. Their own text in the field goes in <before>.
  const said = stripFenceTags(message.trim());
  const other = hasAlternative ? stripFenceTags(alternative!) : "";
  const messageBlock = hasAlternative
    ? `CANDIDATE 1 (more reliable):\n${altLeads ? other : said}\n\nCANDIDATE 2:\n${altLeads ? said : other}`
    : said;
  const userContent = head
    + earlier
    + (around ? `<around>\n${stripFenceTags(around)}\n</around>\n` : "")
    + (context ? `<before>\n${stripFenceTags(context)}\n</before>\n` : "")
    + `<said>\n${messageBlock}\n</said>`;
  const system = stableBlock("writer");
  return {
    message, context, askedLanguage, instructed: !!asked, piece, toAnAi,
    tooBig: ask?.kind === "tooBig", field: fieldShapesIt(opts.targetApp, opts.fieldKind, opts.fieldLabel), system, head, userContent,
    told: `${system}\n${head}`,
  };
}

/**
 * A FIELD THAT IS NOT FOR SENTENCES: a search box, a number, a PIN. There the
 * field decides the shape (assistPrompt's shape line): "best biryani place
 * near Andheri" is the right answer to a question and "4128" to a sentence,
 * so the checks below that hold a message to its sentence (its question, its
 * words, its capital and full stop) stand back. Read from the app hint, the
 * only word the writer has for the field.
 */
const FIELD_NOT_FOR_SENTENCES = /\b(?:search|number|numeric|digits?|pin|otp|passcode|url|address bar|email address|spotlight|launcher)\b/i;
/** A field that takes a value (search, address, number…) says so; a message
 *  box or a text area takes sentences whatever its app is called; a plain
 *  text field is read by its label and app ("Search mail", "Chrome: Google
 *  Search"), because a web page's search box is often only that. */
export function fieldShapesIt(targetApp?: string, fieldKind?: string, fieldLabel?: string): boolean {
  const kind = fieldKindOf(fieldKind);
  if (takesAValue(kind)) return true;
  if (kind === "message" || kind === "longtext") return false;
  return [targetApp, cleanLabel(fieldLabel)].some((s) => !!s && FIELD_NOT_FOR_SENTENCES.test(s));
}
