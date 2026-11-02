/**
 * draftReply(): a reply to what is on screen, in the person's voice.
 */

import type { CleanupOptions } from "../../../../shared/types/api.js";
import { getConfig } from "../../config.js";
import { stableBlock, compose } from "../../principles/roles.js";
import { replyIsAFile, buildReplySystem } from "../../prompts.js";
import { fenceTags, replyContext, stripFenceTags, readSend } from "../assistPrompt.js";
import { complete, REPLY_TEMPERATURE, MAX_TOKENS_REPLY } from "./model.js";
import { quotesPrompt } from "./output.js";
import { expandSnippets, ctxFromOpts } from "./snippets.js";

// --- Screen-reply drafting --------------------------------------------------

/** The fences a draft's two inputs arrive in when it is a prompt file's (REPLY_PROMPT_VERSION v1 to v4); see draftReply. */
const SCREEN_TAGS = fenceTags("screen|intent");

/**
 * Draft a personalized reply from on-screen content + the user's intent.
 *
 * The writer role (principles/roles.ts), with the screen they are replying to
 * in <around> and what they want to say back in <said>, and the rest (the app,
 * the recipient, their voice and dials, the language setting) as the fenced
 * data that follows the stable block (assistPrompt.replyContext). The answer is
 * plain text. REPLY_PROMPT_VERSION=v1 to v4 sends the old file prompt instead.
 */
export async function draftReply(
  screenContent: string,
  intent: string,
  opts: CleanupOptions = {},
  recipient?: string,
): Promise<string> {
  if (!intent.trim()) return "";
  if (replyIsAFile()) return draftReplyFromFile(screenContent, intent, opts, recipient);
  // FENCED. The screen is the one input here that someone ELSE wrote — the
  // message being replied to — and it used to sit under a heading, where a
  // line of it could pass for the end of the data. Its tags come out of both
  // halves so neither can close the other's fence.
  const head = replyContext(opts, recipient);
  const told = `${stableBlock("writer")}\n${head}`;
  const user = `${head}<around>\n${stripFenceTags(screenContent.trim() || "(none)")}\n</around>\n<said>\n${stripFenceTags(intent.trim())}\n</said>`;
  const res = await complete({
    model: getConfig().CLEANUP_MODEL,
    temperature: REPLY_TEMPERATURE,
    max_tokens: MAX_TOKENS_REPLY,
    messages: compose("writer", [{ role: "user" as const, content: user }]),
  });
  const out = stripFenceTags(readSend(res.choices[0]?.message?.content ?? "")).trim();
  // A draft that quotes its instructions is not a reply: what they said they
  // wanted to say goes out instead, the same policy as assist().
  return expandSnippets(
    quotesPrompt(out, told) ? intent.trim() : out,
    opts.personality?.snippets,
    ctxFromOpts(opts, recipient),
  );
}

/** The screen reply as a prompt file (reply.v1 to v4 in shared/prompts/): kept so REPLY_PROMPT_VERSION can roll back to it. */
async function draftReplyFromFile(
  screenContent: string,
  intent: string,
  opts: CleanupOptions,
  recipient?: string,
): Promise<string> {
  const fence = (tag: string, s: string) => `<${tag}>\n${stripFenceTags(s, SCREEN_TAGS)}\n</${tag}>`;
  const userMsg =
    `SCREEN CONTENT (what I'm replying to):\n${fence("screen", screenContent.trim() || "(none)")}\n\n` +
    `MY INTENT (what I want to say back):\n${fence("intent", intent.trim())}`;

  const system = buildReplySystem(opts, recipient);
  const res = await complete({
    model: getConfig().CLEANUP_MODEL,
    temperature: REPLY_TEMPERATURE,
    max_tokens: MAX_TOKENS_REPLY,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
  });
  const out = stripFenceTags((res.choices[0]?.message?.content ?? "").trim(), SCREEN_TAGS);
  return expandSnippets(
    quotesPrompt(out, system) ? intent.trim() : out,
    opts.personality?.snippets,
    ctxFromOpts(opts, recipient),
  );
}
