/**
 * The writing "brain": OpenRouter chat calls that
 *  - assist()        : write what was said or typed (voice + typing), prompt
 *                      from ./assistPrompt.ts
 *  - draftReply()    : draft a reply from screen content + intent, prompt from
 *                      ../prompts.ts (shared/prompts/reply.*.md)
 *  - the Training and portrait writers
 *
 * The model is CLEANUP_MODEL (config.ts). Each writer is a file of its own in
 * ./writing/; this module is their one way in.
 */
export { stripFenceTags } from "./assistPrompt.js";
export { LLM_TONES } from "./tonePrompts.js";
export { scriptOf, type WriterExtras, fieldShapesIt } from "./writing/writerRequest.js";
export { TEMPERATURE, REPLY_TEMPERATURE } from "./writing/model.js";
export { looksLikeEmptyEcho, looksLikeMeta, quotesPrompt, stripEchoedContext, stripAddedClosing, stripAddedGreeting, stripEdgeFiller, PIECE_WORDS, runaway } from "./writing/output.js";
export { type SnippetContext, expandSnippets } from "./writing/snippets.js";
export { type Slip, slipIn } from "./writing/slips.js";
export { tidyRaw, finishUnwritten, keepPlease, stripPlaceholders, assist } from "./writing/assist.js";
export { draftReply } from "./writing/draft.js";
export { type EditMode, editContext, editSelection } from "./writing/edit.js";
export { answerAboutContext, answerAbout } from "./writing/answer.js";
export { VARIANT_ANGLES, refineVariants } from "./writing/variants.js";
export { portraitContext, updateStylePortrait, transcriptContext, usageContext, portraitFromUsage, portraitFromTranscript, inferStyle } from "./writing/portrait.js";
export { type ConverseTurn, languageName, spokenLanguage, converseContext, converseTurn } from "./writing/converse.js";
