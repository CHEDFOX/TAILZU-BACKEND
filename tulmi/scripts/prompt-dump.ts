/**
 * Print the prompts the product actually sends, rendered rather than described.
 *
 *   npm run prompts
 *
 * Every one of these is a role's STABLE BLOCK (principles/roles.ts, the same
 * bytes for everyone) followed by the data of the call, assembled at request
 * time from the user's personality, their learned portrait and the destination
 * (pipeline/assistPrompt.ts and cleanup.ts). Reading the source tells you the
 * shape and not the text. This renders them with a realistic user loaded so the
 * thing you review is the thing the model receives.
 */
import { writerContext, replyContext } from "../src/pipeline/assistPrompt.js";
import {
  VARIANT_ANGLES, portraitContext, transcriptContext, converseContext,
  usageContext, editContext, answerAboutContext,
} from "../src/pipeline/cleanup.js";
import { stableBlock } from "../src/principles/roles.js";
import type { Personality } from "../../shared/types/api.js";

const RULE = (s: string) => `\n${"=".repeat(76)}\n${s}\n${"=".repeat(76)}\n`;
/** A role's block, then the data that follows it, the way the model reads them. */
const sent = (role: Parameters<typeof stableBlock>[0], data: string) => `${stableBlock(role)}\n\n--- then, in the user message ---\n${data}`;

const PERSON = {
  activeTone: "none",
  activePresetId: "signature",
  customInstructions: "never use exclamation marks",
  signature: "— R",
  stylePortrait: {
    core: "Short sentences. Lowercase openers. Says 'yaar' and 'anyway'. Rarely uses commas.",
    tones: { none: "keeps it clipped" },
  },
} as unknown as Personality;

// A portrait with some history behind it, so the provenance line renders as
// it would for a real returning user rather than as the first-run case.
const SEASONED = {
  core: "(the portrait so far)",
  words: [
    { term: "yaar", means: "mate — close friends only" },
    { term: "jugaad", means: "a scrappy workaround they are pleased with" },
  ],
  styles: [{ name: "clipped", when: "work chats" }],
  rhythms: [{ when: "early morning", vibe: "terser, skips the greeting" }],
  sessions: 23,
  examples: 6,
  firstSeenAt: new Date(Date.now() - 97 * 86_400_000).toISOString(),
};

const parts: string[] = [];

parts.push(RULE("REFINE — POST /v1/refine   and   POST /v1/transcribe-clean"));
parts.push(
  "Both endpoints send ONE role, `writer`, and the whole product runs on it:",
  "keyboard dictation, keyboard typing, and the in-app mic. Its block is the same",
  "bytes for every user. Rendered here for a dictation into a text field, with a",
  "trained portrait, a custom instruction, Hindi as the default language,",
  "Devanagari observed on the audio, and two disagreeing recognizers to reconcile.\n",
);
parts.push(sent("writer", writerContext({
  tone: "none", personality: PERSON, language: "hi", targetApp: "a text field",
  hasContext: true, script: "devanagari", hasAlternative: true,
})));

parts.push(RULE("REFINE WITH A TONE SELECTED — POST /v1/refine/<tone>"));
parts.push(
  "The SAME role. Picking a tone changes one block of the data and nothing else,",
  "so a chosen voice never costs the user instruction separation or script",
  "fidelity. The four voices, as they appear in <tone>:\n",
);
for (const t of ["formal", "casual", "very-casual", "excited"]) {
  const block = /<tone>\n([\s\S]*?)\n<\/tone>/.exec(writerContext({ tone: t, hasContext: false }))?.[1] ?? "";
  parts.push(`  ${t}`, `    ${block}`, "");
}
parts.push("  (default, no tone chosen)",
  `    ${/<tone>\n([\s\S]*?)\n<\/tone>/.exec(writerContext({ hasContext: false }))?.[1] ?? ""}`);

parts.push(RULE("THE SCREEN REPLY — POST /v1/draft"));
parts.push(
  "The same `writer` role again. The message they are replying to is <around>, what",
  "they want to say back is <said>, and the app, the recipient, the language setting",
  "and their voice follow the block as data. (REPLY_PROMPT_VERSION=v4 sends the old",
  "file prompt instead.)\n",
);
parts.push(sent("writer", replyContext({ targetApp: "WhatsApp", language: "auto", personality: PERSON }, "Rahul")));

parts.push(RULE("EDIT THE SELECTION — POST /v1/edit"));
parts.push(
  "Two inputs, not one: the selected TEXT to rewrite and the spoken INSTRUCTION",
  "to apply to it. The selection is content off the screen, so it is data to",
  "transform; only the instruction is addressed to the writer. Rendered here with",
  "a tone and a portrait, as a message field in an email app.\n",
);
parts.push(sent("edit_selection", editContext({ tone: "none", personality: PERSON, targetApp: "Gmail", fieldKind: "message" }, { spoken: true })));

parts.push(RULE("ASK ABOUT THE SCREEN — POST /v1/ask"));
parts.push(
  "The screen is reference only and is data, never an instruction; the answer is",
  "concise, in the question's language. No forced output language — the question",
  "decides it, and the read-aloud locale is derived from the answer afterwards.\n",
);
parts.push(sent("answer_about", answerAboutContext({ assistantName: "Zara" } as never)));

parts.push(RULE("TRAIN — POST /v1/train/variants"));
parts.push(
  "The same role and the same data as refine (so a variant is never off-voice), plus",
  "ONE direction per variant, a line in <call>. The directions:\n",
);
for (const a of VARIANT_ANGLES) parts.push(`  ${a.angle.padEnd(14)} ${a.brief}`);

parts.push(RULE("TRAIN — POST /v1/train/pick   →   the portrait is WRITTEN here"));
parts.push(
  "Picking a variant does not store the variant. It sends the pick, the two",
  "rejected candidates and the previous portrait to the model, which rewrites",
  "the portrait. That is the only place the portrait changes on this path.\n",
);
parts.push(sent("portrait_update", portraitContext("Signature", SEASONED)));

parts.push(RULE("TRAIN — POST /v1/train/converse   (talking, not picking)"));
parts.push(sent("converse", converseContext("hi")));

parts.push(RULE("TRAIN — POST /v1/train/portrait   →   the portrait is WRITTEN here too"));
parts.push(
  "The spoken path's ending. One read of the whole transcript at the end of the",
  "session, rather than a portrait rewrite per turn.\n",
);
parts.push(sent("portrait_transcript", transcriptContext(SEASONED)));

parts.push(RULE("THE PORTRAIT WRITTEN FROM ORDINARY USE  (no endpoint — it just happens)"));
parts.push(
  "The one that does most of the work. Deliberate training is a handful of taps;",
  "this reads the last PORTRAIT_LEARN_WINDOW real messages every",
  "PORTRAIT_LEARN_EVERY refines, off the user's path, from history already on",
  "disk. Both halves of each row are evidence: SAID is how they put it, SENT is",
  "what they read and let through.\n",
);
parts.push(sent("portrait_usage", usageContext(SEASONED, true)));

parts.push(RULE("WHAT A PORTRAIT LOOKS LIKE ONCE WRITTEN"));
parts.push(
  "Fields, not one paragraph — because prose forgets. A word learned in March",
  "that did not come up in April was gone by May, since the rewrite had no",
  "reason to carry it. `words` accumulates and dedupes across sessions; the",
  "rest is a fresh read each time.\n",
);
parts.push(writerContext({
  hasContext: false,
  personality: { activeTone: "none", stylePortrait: SEASONED } as never,
}).split("<portrait>")[1]?.split("</portrait>")[0]?.trim() ?? "");

parts.push(RULE("WHERE THE PORTRAIT IS READ BACK"));
parts.push(
  "portraitBlock() injects it into EVERY refine — the <portrait> block in the first",
  "prompt above. Written in two places, read in all of them.\n",
);

console.log(parts.join("\n"));
