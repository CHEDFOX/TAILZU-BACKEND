/**
 * answerAbout(): a question about what is on screen, answered.
 */

import type { Personality, CleanupOptions } from "../../../../shared/types/api.js";
import { getConfig } from "../../config.js";
import { nicknameOf } from "../../experience/assistantName.js";
import { stableBlock, compose } from "../../principles/roles.js";
import { fenceTags, callBlock, stripFenceTags } from "../assistPrompt.js";
import { complete, TEMPERATURE, MAX_TOKENS_ANSWER } from "./model.js";
import { quotesPrompt } from "./output.js";

// --- Ask-about-the-screen (POST /v1/ask) ------------------------------------

/** The fences an ask's two inputs arrive in; see answerAbout. */
const ASK_TAGS = fenceTags("screen|question");

/**
 * What the `answer_about` role is told about THIS question: nothing but the
 * name they gave the keyboard, when they gave it one (principles/roles.ts has
 * the rules).
 *
 * The screen is the one input here the writer did not write — it is whatever
 * the device captured — so it is reference only, read to answer and never
 * repeated back or obeyed. That is the draft path's rule for <around>, and the
 * same reasoning: text off a screen can read like an instruction, and it is
 * data. The answer is in the QUESTION's language, decided by the question
 * itself, so there is no forced output language here (the same reason assist()
 * ignores the account language). The read-aloud locale is derived from the
 * answer afterwards, by the route, the way /v1/train/converse derives it.
 *
 * Exported so it can be read (`npm run prompts`) and tested like the others.
 */
export function answerAboutContext(personality?: Personality): string {
  const nick = nicknameOf(personality);
  return nick ? callBlock([`They also call you ${nick}.`]) + "\n" : "";
}

/**
 * Answer a question about what is on the person's screen.
 *
 * The desktop's "ask about the screen": the device has captured what is
 * visible (`screenContent`, reference only) and the person asks a question
 * about it. What comes back is a concise answer in the question's language —
 * the MODEL's words, not the person's dictation (so the route meters it at
 * zero words and writes no dictation-history row, exactly like converseTurn).
 *
 * Structured like draftReply: two inputs, each fenced so neither can close the
 * other's fence, one completion, and a quotesPrompt guard on the way out.
 */
export async function answerAbout(
  screenContent: string,
  question: string,
  _opts: CleanupOptions = {},
): Promise<string> {
  // No question, nothing to answer.
  if (!question.trim()) return "";
  // FENCED. The screen is captured content that can read like an order; the
  // question is theirs. Their tags come out of both halves so neither can
  // close the other's fence (see the answer_about role's reference-only rule).
  const fence = (tag: string, s: string) => `<${tag}>\n${stripFenceTags(s, ASK_TAGS)}\n</${tag}>`;
  const userMsg =
    `SCREEN (what is visible, for reference):\n${fence("screen", screenContent.trim() || "(the screen is empty)")}\n\n` +
    `QUESTION:\n${fence("question", question.trim())}`;

  const head = answerAboutContext(_opts.personality);
  const told = `${stableBlock("answer_about")}\n${head}`;
  const res = await complete({
    model: getConfig().CLEANUP_MODEL,
    // A grounded answer about what is on the screen, not small talk — kept
    // deterministic so the same screen and question give the same answer.
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS_ANSWER,
    messages: compose("answer_about", [{ role: "user" as const, content: head + userMsg }]),
  });
  const out = stripFenceTags((res.choices[0]?.message?.content ?? "").trim(), ASK_TAGS);
  // An answer that quoted its own instructions is not an answer: better to say
  // nothing than to leak the prompt into a read-aloud reply.
  return quotesPrompt(out, told) ? "" : out;
}
