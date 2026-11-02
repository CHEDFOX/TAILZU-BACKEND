/**
 * assist(): what was said or typed, written the way the person writes.
 */

import type { CleanupOptions } from "../../../../shared/types/api.js";
import { getConfig } from "../../config.js";
import { compose } from "../../principles/roles.js";
import { stripFenceTags, readSend } from "../assistPrompt.js";
import { continuesSentence, shapeForJoin, joinPauseStops } from "../join.js";
import { detectScript, transliterated } from "../stt.js";
import { complete, TEMPERATURE, MAX_TOKENS_CLEANUP } from "./model.js";
import {
  countWords, wordCount, PIECE_WORDS, opensList, runaway, quotesPrompt, stripEchoedContext, stripEdgeFiller, stripAddedGreeting,
  stripAddedClosing, finalizeCompletion,
} from "./output.js";
import { OPENS_A_QUESTION, type Slip, slipIn, REDO } from "./slips.js";
import { expandSnippets, ctxFromOpts } from "./snippets.js";
import { type WriterExtras, writerRequest } from "./writerRequest.js";

/**
 * THEY WRITE IN LOWERCASE ON PURPOSE: the group-chat voice says so, or their
 * own instructions or portrait do. Then an answer that starts on a small
 * letter is their style, not a sentence left unwritten (finishUnwritten).
 */
const LOWERCASE_STYLE = /\blower[\s-]?case\b|\bno (?:capitals?|caps|full stops?|periods?|punctuation)\b/i;
function writesLowercase(opts: CleanupOptions): boolean {
  if (opts.tone === "very-casual" || opts.personality?.tone === "very-casual") return true;
  const p = opts.personality;
  return LOWERCASE_STYLE.test([opts.tonePrompt, p?.customInstructions, p?.stylePortrait?.core].filter(Boolean).join("\n"));
}

const PLAIN_FIRST_WORD = /^\p{Ll}[\p{Ll}'’]*(?=[\s,;!?…]|[.:](?!\S)|$)/u;
export function tidyRaw(s: string, continuing = false): string {
  let t = s.trim();
  if (!t || detectScript(t) !== "latin" || countWords(t) < 3) return t;
  if (!continuing && PLAIN_FIRST_WORD.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  if (/[\p{L}\p{N}]$/u.test(t) && !/[@/]\S*$/.test(t)) t += OPENS_A_QUESTION.test(t) ? "?" : ".";
  return t;
}

/**
 * NOTHING GOES OUT LOOKING UNWRITTEN.
 *
 * The run the owner read line by line had a dozen answers that were what went
 * in, letter for letter: "mujhe kal subah jaldi uthna hai", "what time does
 * the movie start", "add 250 ml water and 2 spoons sugar", lowercase and open.
 * The writer took them for notes or searches or already done, and from the
 * field that is "it is not doing anything at all". An answer that starts on a
 * small letter, with nothing of theirs before it to carry on, was not
 * written: it gets what tidyRaw gives a fallback, a capital and an end mark.
 *
 * Only that signature. A capital the writer gave with the end mark left off
 * is a choice ("Tomorrow 6pm gym"), and a live chunk that stops mid-sentence
 * comes capitalised from the recogniser, so it is never closed here into a
 * sentence it is not (and shapeForJoin takes a stop back off a word no
 * sentence ends on). assist() does not ask it of a field that is not for
 * sentences, or of anyone who writes in lowercase on purpose.
 */
export function finishUnwritten(out: string, continuing: boolean): string {
  const t = out.trim();
  if (continuing || t.includes("\n") || !PLAIN_FIRST_WORD.test(t)) return out;
  return tidyRaw(t);
}

/**
 * A PLEASE THEY SAID GOES OUT. "Please transfer 2500 rupees to Ramesh today"
 * came back "Transfer ₹2500 to Ramesh today" one run in three: every point
 * kept and the tone gone, after the prompt named the tone as theirs. Put back
 * where it stood, and only where that is plain: at the start, before the same
 * word they said it before, or at the end. An answer that asks in another
 * way ("Could you transfer…") already kept it.
 */
const POLITE = /\b(?:please|pls|plz|kindly)\b/i;
export function keepPlease(out: string, said: string): string {
  const t = out.trim();
  const s = said.trim();
  if (!t || t.includes("\n") || POLITE.test(t)) return out;
  const lead = /^(?:please|pls|plz)[\s,]+([\p{L}']+)/iu.exec(s);
  if (lead) {
    const first = /^[\p{L}']+/u.exec(t)?.[0];
    if (!first || first.toLowerCase() !== lead[1]!.toLowerCase()) return out;
    const word = first === "I" || first === first.toUpperCase() ? first : first.charAt(0).toLowerCase() + first.slice(1);
    return `Please ${word}${t.slice(first.length)}`;
  }
  if (!/\b(?:please|pls|plz)[\s.!?]*$/i.test(s)) return out;
  const end = /^(.*?)([.!?]*)$/su.exec(t)!;
  return /[\p{L}\p{N}]$/u.test(end[1]!) ? `${end[1]}, please${end[2]}` : out;
}

/**
 * A blank the writer left for something they never gave: "Hi [Boss's
 * Name]," in a message written for them. A placeholder is a form to fill,
 * and this is going straight into a field to be sent. It comes out, with the
 * space before it, unless they typed brackets themselves.
 */
export function stripPlaceholders(out: string, said: string): string {
  if (!out.includes("[") || said.includes("[")) return out;
  return out
    .replace(/[ \t]*\[[^\]\n]{1,40}\]/g, "")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  input: string,
  opts: CleanupOptions & WriterExtras = {},
): Promise<string> {
  if (!input.trim()) return "";
  const { message, context, askedLanguage, instructed, piece, toAnAi, tooBig, field, told, userContent } = writerRequest(input, opts);
  const checks = { askedLanguage, instructed, piece, toAnAi, field };
  const write = async (after: Array<{ role: "assistant" | "user"; content: string }> = []) => {
    const res = await complete({
      model: getConfig().CLEANUP_MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS_CLEANUP,
      messages: compose("writer", [{ role: "user" as const, content: userContent }, ...after]),
    });
    // The intent line is the writer's thinking, never the message: only
    // what it put in <send> goes on (assistPrompt.readSend).
    return stripFenceTags(readSend(res.choices[0]?.message?.content ?? "")).trim();
  };
  let wrote = await write();
  // CHECKED, AND ASKED ONCE MORE WHEN IT BROKE A RULE (see slipIn). Once: a
  // rule the model breaks twice in a row is not won by a third ask, and every
  // ask is time someone is waiting at the cursor. A second ask that fails
  // leaves the guards below to decide, as they always have.
  // A piece has no words of theirs to compare against, only a size: a short
  // piece, written long, is asked for once more, shorter.
  //
  // Nothing written for words they really said is a slip too: the writer took
  // a question or an order as aimed at itself and wrote nothing.
  const slip: Slip | null = !wrote && wordCount(message) >= 2 ? "empty"
    : piece && countWords(wrote) > PIECE_WORDS ? "long"
    : slipIn(message, wrote, checks);
  if (slip) {
    try {
      const again = await write([
        { role: "assistant", content: wrote },
        { role: "user", content: `${REDO[slip]} Return only the text.` },
      ]);
      const still = again ? slipIn(message, again, checks) : slip;
      // Kept when it is clean, or, for an addition or a long piece, when it at
      // least added less. A second answer that swapped one slip for another is
      // not kept.
      const shorter = !!again && wordCount(again) < wordCount(wrote);
      const asSaid = tidyRaw(message, continuesSentence(context));
      if (again && slip === "long" && still === null && shorter) wrote = again;
      else if (again && slip !== "long" && still === null) wrote = again;
      // Still in English after being told it was a translation: their own
      // words, unwritten, are closer to what they said than someone else's.
      else if (slip === "translated" && detectScript(message) === "latin") wrote = asSaid;
      // Carried out twice in an AI app: what they said IS the prompt. A
      // question lost twice: their question, as they asked it, is closer
      // than search words or an answer. Words added twice, nothing asked:
      // the writer is answering or offering ("I can write a letter of
      // recommendation. Who is it for…?"), and none of it is theirs. Words a
      // pause cut, left out twice: their sentence with the stop joined
      // (joinPauseStops, below) keeps what the answer lost.
      else if (slip === "carried" || slip === "question" || slip === "added" || slip === "cut") wrote = asSaid;
      // Almost nothing kept, twice, and what is left is a lone address or
      // number: the message it was in goes out. Anything longer is the
      // writer's reading of a long ramble, and stays.
      else if (slip === "dropped" && countWords(wrote) <= 2) wrote = asSaid;
    } catch {
      // The first answer stands; the guards below still apply to it.
    }
  }
  const out = expandSnippets(stripPlaceholders(wrote, message), opts.personality?.snippets, ctxFromOpts(opts));
  // What they said, as it goes out when the writer's answer cannot (below).
  const theirs = tidyRaw(message, continuesSentence(context));
  // Whatever goes out is pasted AFTER their own text (`context`), so every
  // return below is shaped to join it: single spaces, no capital on a word
  // that only continues an unfinished sentence, no full stop after a word no
  // sentence ends on. See join.ts.
  //
  // And no full stop a pause left inside a sentence, on every return,
  // because the fallbacks below hand back what they SAID: the transcript
  // itself, which is where those stops come from.
  //
  // A list starts on a line of its own: pasted after "Things for the trip:"
  // its first item would otherwise sit on the end of that line. The leading
  // newline also tells joinWithSpace that no space goes in front.
  const joined = (s: string) => {
    const t = shapeForJoin(joinPauseStops(s), context);
    // The field as sent, not trimmed: a trailing newline there already starts the line.
    const field = opts.context ?? "";
    return field.trim() && !/\n[^\S\n]*$/.test(field) && opensList(t) ? `\n${t}` : t;
  };
  // Something far longer than they could have asked for goes out as what they
  // said, the same policy as a leaked prompt: never an essay in their field.
  // Not for a piece they asked for: its length was bounded above, and their
  // request is the one thing that must not be pasted in its place.
  if (!piece && runaway(out, message)) return joined(theirs);
  // MORE THAN A KEYBOARD WRITES IS WHAT THEY ARE SAYING, so the request goes
  // out as the request, and that has a size: theirs. Asked for an essay, the
  // writer explained itself instead, 39 words of "I can help you write
  // messages… you would need to provide me with more specific details", too
  // long for a refusal pattern to be trusted with and every word of it the
  // writer's. Anything past their own words and a few more is not theirs.
  if (tooBig && wordCount(out) > wordCount(message) + 4) return joined(theirs);
  // The instructions are never the message. Falling back to what they said is
  // the same policy as a refusal: a request that happened to address the model
  // goes out as the message it always was.
  if (quotesPrompt(out, told)) return joined(theirs);
  // Their words, re-spelled in another alphabet. Four wordings of the rule
  // across four deployed runs held sometimes and not others; at temperature 0
  // it now fails every time, which makes it a decision rather than a wobble.
  // Checked here for the same reason the prompt leak is: an instruction the
  // model keeps losing is not an instruction, it is a hope.
  // Not when they asked for a language: then another script is the request.
  if (!askedLanguage && transliterated(message, out)) return joined(theirs);
  // Their own prior text stays in the field either way, so an echo of it here
  // is a second copy on screen.
  // A closing line is theirs to have in a piece they asked for ("Thanks!" at
  // the end of an email); only in dictation is it one they never said.
  const unechoed = stripEchoedContext(out, context);
  // A greeting at the start, the same: theirs in a piece, the model's in dictation.
  const trimmed = stripEdgeFiller(piece ? unechoed : stripAddedGreeting(stripAddedClosing(unechoed, message), message), continuesSentence(context));
  // Discard a meta/refusal reply ("speak again"…); else keep the completion,
  // falling back to the input on an empty one so we never wipe the field.
  const final = finalizeCompletion(trimmed, theirs);
  // Never out looking unwritten (finishUnwritten), and never without the
  // please they said (keepPlease). Neither where they asked for something
  // about the writing ("make it lowercase", "keep it short"), or asked for a
  // piece: then the shape and the tone are the request's.
  if (instructed || piece) return joined(final);
  const finished = field || writesLowercase(opts) ? final : finishUnwritten(final, continuesSentence(context));
  return joined(keepPlease(finished, message));
}
