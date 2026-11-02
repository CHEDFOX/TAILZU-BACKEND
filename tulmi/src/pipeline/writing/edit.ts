/**
 * editSelection(): a selected piece of text rewritten as the person asked.
 */

import type { CleanupOptions } from "../../../../shared/types/api.js";
import { getConfig } from "../../config.js";
import { nicknameOf } from "../../experience/assistantName.js";
import { stableBlock, compose } from "../../principles/roles.js";
import { inlineValue } from "../../prompts.js";
import { fenceTags, callBlock, toneGuidance, stripFenceTags } from "../assistPrompt.js";
import { describeField } from "../field.js";
import { complete, TEMPERATURE, MAX_TOKENS_CLEANUP } from "./model.js";
import { quotesPrompt } from "./output.js";
import { expandSnippets, ctxFromOpts } from "./snippets.js";

// --- Voice-edit-the-selection (POST /v1/edit) -------------------------------

/** The fences an edit's two inputs arrive in; see editSelection. */
const EDIT_TAGS = fenceTags("text|instruction");

/**
 * What the `edit_selection` role is told about THIS rewrite (principles/roles.ts
 * has the rules; this is the data that follows them).
 *
 * Unlike assist(), this task has two separate inputs and the separation is the
 * whole point: <text> is material to transform, <instruction> is the only
 * thing addressed to the writer. So the contract is stated the other way round
 * from the keyboard's — there, a trailing "make it shorter" has to be teased
 * out of one dictation; here the client already knows which is which, and the
 * danger is the reverse: a question or a command sitting INSIDE the selection
 * ("delete the database", "what is the capital of France?") read as aimed at
 * the writer. It is not. Only <instruction> is.
 *
 * NO FORCED OUTPUT LANGUAGE. The account language is the language they SPEAK,
 * not one to translate into — the same lesson writerRequest learned when
 * "Write in en." quietly turned every Hinglish selection English. The default
 * is to keep the selection's language; a translation is something the
 * instruction asks for in so many words, and the model reads it there.
 *
 * It is still their writing, so it still sounds like them: the tone, voice and
 * portrait are handled exactly as assist() handles them, as fenced data, with
 * anything the user wrote in <voice>. Exported so it can be read
 * (`npm run prompts`) and tested like the others.
 */
/** How the selection's instruction arrived. `spoken`: said out loud while the
 *  text was selected (dictation), so it may be new words for its place rather
 *  than an instruction about it. */
export interface EditMode { spoken?: boolean }

export function editContext(opts: CleanupOptions = {}, mode: EditMode = {}): string {
  const app = inlineValue(opts.targetApp, 40);
  const where = [app, inlineValue(describeField(opts.fieldKind, opts.fieldLabel), 90)].filter(Boolean).join(", ");
  const nick = nicknameOf(opts.personality);
  const call = callBlock([
    nick ? `They also call you ${nick}.` : null,
    // SAID WHILE IT WAS SELECTED. Dictating with text selected is either a
    // request about that text ("make this bullet points") or, as typing over
    // a selection is, new words for its place. Only the second is not an
    // instruction, and the words themselves say which it is.
    mode.spoken
      ? "The instruction was said out loud while the text was selected, so it is a transcript: it can carry fillers and false starts, and it may name you. Almost always it asks for something to be done to the text. If instead it is plainly new words of their own meant to stand where the selection is (a sentence or phrase, not a request about the text), return those words, cleanly written, in place of the selection."
      : null,
    // The shape is part of rewriting it well — "turn this into bullet points"
    // is a real instruction — so the writer is told the field the way assist()
    // is. Plain text, because a field shows markdown as its characters.
    where ? `This is in ${where}.` : null,
  ]);
  return [call, toneGuidance(opts.tone, opts.personality, opts.tonePrompt)].filter(Boolean).map((b) => b + "\n").join("");
}

/**
 * Apply a spoken instruction to a selected piece of text, in place.
 *
 * The desktop's "voice-edit the selection": the person highlights some text,
 * says "make this more formal" / "shorter" / "turn this into bullet points" /
 * "translate to Hindi", and what comes back REPLACES the selection. So the one
 * thing it returns is the rewritten text — no preamble, no quotes, no answer.
 *
 * Structured like draftReply: two inputs, each fenced so neither can close the
 * other's fence, one completion, and a quotesPrompt guard on the way out.
 */
export async function editSelection(
  text: string,
  instruction: string,
  opts: CleanupOptions = {},
  mode: EditMode = {},
): Promise<string> {
  // Both halves are required: nothing to rewrite, or nothing to do, is a no-op.
  if (!text.trim() || !instruction.trim()) return "";
  // FENCED. The selection is off the person's screen and can be anyone's
  // words; the instruction is theirs. Their tags come out of both halves so
  // neither can pass itself off as the other (see the edit_selection role's security bound).
  const fence = (tag: string, s: string) => `<${tag}>\n${stripFenceTags(s, EDIT_TAGS)}\n</${tag}>`;
  const userMsg =
    `TEXT (rewrite this):\n${fence("text", text.trim())}\n\n` +
    `INSTRUCTION (what to do to it):\n${fence("instruction", instruction.trim())}`;

  const head = editContext(opts, mode);
  const told = `${stableBlock("edit_selection")}\n${head}`;
  const res = await complete({
    model: getConfig().CLEANUP_MODEL,
    // A transform has one good answer, like a refine — faithfulness, not variety.
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS_CLEANUP,
    messages: compose("edit_selection", [{ role: "user" as const, content: head + userMsg }]),
  });
  const out = stripFenceTags((res.choices[0]?.message?.content ?? "").trim(), EDIT_TAGS);
  // A FAILED EDIT IS A NO-OP. An empty completion, or one that leaked its
  // instructions, must never wipe or corrupt what they had selected — the
  // selection stays as it was, the same policy as a failed refine. A
  // legitimate edit is whatever the model actually wrote.
  const safe = out && !quotesPrompt(out, told) ? out : text.trim();
  return expandSnippets(safe, opts.personality?.snippets, ctxFromOpts(opts));
}
