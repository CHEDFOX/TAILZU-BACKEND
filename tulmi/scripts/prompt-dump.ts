/**
 * Print the prompts the product actually sends, rendered rather than described.
 *
 *   npm run prompts
 *
 * Every one of these is assembled at request time from the user's personality,
 * their learned portrait and the destination — so reading the source tells you
 * the shape and not the text. This renders them with a realistic user loaded so
 * the thing you review is the thing the model receives.
 */
import { buildAssistSystem } from "../src/pipeline/assistPrompt.js";
import {
  VARIANT_ANGLES, portraitSystem, PORTRAIT_FROM_TRANSCRIPT_SYSTEM, converseSystem,
} from "../src/pipeline/cleanup.js";
import type { Personality } from "../../shared/types/api.js";

const RULE = (s: string) => `\n${"=".repeat(76)}\n${s}\n${"=".repeat(76)}\n`;

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

const parts: string[] = [];

parts.push(RULE("REFINE — POST /v1/refine   and   POST /v1/transcribe-clean"));
parts.push(
  "Both endpoints build ONE system prompt, buildAssistSystem(), and the whole",
  "product runs on it: keyboard dictation, keyboard typing, and the in-app mic.",
  "Rendered here for a dictation into a text field, with a trained portrait, a",
  "custom instruction, Hindi as the default language, Devanagari observed on the",
  "audio, and two disagreeing recognizers to reconcile.\n",
);
parts.push(buildAssistSystem({
  tone: "none", personality: PERSON, language: "hi", targetApp: "a text field",
  hasContext: true, script: "devanagari", hasAlternative: true,
}));

parts.push(RULE("REFINE WITH A TONE SELECTED — POST /v1/refine/<tone>"));
parts.push(
  "The SAME prompt. Picking a tone changes one line and nothing else, so a",
  "chosen voice never costs the user instruction separation or script fidelity.",
  "The four voices, as they appear on that line:\n",
);
for (const t of ["formal", "casual", "very-casual", "excited"]) {
  const line = (buildAssistSystem({ tone: t, hasContext: false }).split("TONE:")[1] ?? "").trim();
  parts.push(`  ${t}`, `    ${line}`, "");
}
parts.push("  (default, no tone chosen)",
  `    ${(buildAssistSystem({ hasContext: false }).split("TONE:")[1] ?? "").trim()}`);

parts.push(RULE("TRAIN — POST /v1/train/variants"));
parts.push(
  "Same system prompt as refine (so a variant is never off-voice), plus ONE",
  "angle per variant appended as the user turn's brief. The angles:\n",
);
for (const a of VARIANT_ANGLES) parts.push(`  ${a.angle.padEnd(14)} ${a.brief}`);

parts.push(RULE("TRAIN — POST /v1/train/pick   →   the portrait is WRITTEN here"));
parts.push(
  "Picking a variant does not store the variant. It sends the pick, the two",
  "rejected candidates and the previous portrait to the model, which rewrites",
  "the portrait. That is the only place the portrait changes on this path.\n",
);
parts.push(portraitSystem("Signature"));

parts.push(RULE("TRAIN — POST /v1/train/converse   (talking, not picking)"));
parts.push(converseSystem("hi"));

parts.push(RULE("TRAIN — POST /v1/train/portrait   →   the portrait is WRITTEN here too"));
parts.push(
  "The spoken path's ending. One read of the whole transcript at the end of the",
  "session, rather than a portrait rewrite per turn.\n",
);
parts.push(PORTRAIT_FROM_TRANSCRIPT_SYSTEM);

parts.push(RULE("WHERE THE PORTRAIT IS READ BACK"));
parts.push(
  "portraitBlock() injects it into EVERY refine — the block you can see near the",
  "end of the TONE line in the first prompt above. Written in two places, read in",
  "all of them.\n",
);

console.log(parts.join("\n"));
