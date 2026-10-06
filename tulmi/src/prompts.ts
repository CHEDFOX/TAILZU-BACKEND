/**
 * Loads the versioned prompt files from shared/prompts/ and renders them with
 * per-request values (target app, language, personality, recipient), plus the
 * helpers every prompt uses to place user-supplied values as data.
 *
 * Only the screen reply (/v1/draft) is a file prompt now; the writing prompt
 * every other path uses is built in pipeline/assistPrompt.ts. Prompts are the
 * product's core asset, kept as versioned markdown so we can A/B and roll back
 * without code changes.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getConfig } from "./config.js";
import type {
  AppStyle,
  CleanupOptions,
  Command,
  Personality,
  RecipientHint,
  ToneDial,
} from "../../shared/types/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cache = new Map<string, string>();

/** Read a prompt file (e.g. "reply.v4.md") from shared/prompts/, cached. */
function loadPromptFile(filename: string): string {
  const cached = cache.get(filename);
  if (cached) return cached;

  // Resolve across layouts: dev (src/) vs built (dist/), an explicit override,
  // and cwd-relative fallbacks. First existing wins.
  const candidates = [
    process.env.TULMI_SHARED_DIR &&
      resolve(process.env.TULMI_SHARED_DIR, "prompts", filename),
    resolve(__dirname, "..", "..", "shared", "prompts", filename), // tulmi/src → repo/shared
    resolve(__dirname, "..", "..", "..", "shared", "prompts", filename), // dist/tulmi/src → repo/shared
    resolve(process.cwd(), "..", "shared", "prompts", filename), // run from tulmi/
    resolve(process.cwd(), "shared", "prompts", filename), // run from repo root
  ].filter(Boolean) as string[];

  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    throw new Error(
      `Could not find prompt "${filename}". Looked in:\n` +
        candidates.map((p) => `  - ${p}`).join("\n") +
        `\nSet TULMI_SHARED_DIR to the shared/ directory if it lives elsewhere.`,
    );
  }

  /**
   * THE EDITOR'S NOTES ARE NOT THE MODEL'S INSTRUCTIONS.
   *
   * Every prompt file opens with an HTML comment explaining why it is written
   * the way it is — what the previous version got wrong, what each placeholder
   * means, how to version it. None of that was stripped, so all of it was sent
   * on every single request: the model read an essay about prompt engineering,
   * including the sentence saying the prompt is deliberately short, before
   * reaching a word it was meant to act on.
   *
   * Worse than wasted tokens. A placeholder table listing `"auto" | "hi" |
   * "en" | "hinglish"` was substituted inside that comment, so the user's
   * language setting arrived as a fragment of documentation rather than as a
   * rule — present in the context, absent from the instructions.
   *
   * Only a comment at the TOP is removed, and only the first one. A comment
   * further down would be inside the prompt's own prose, where it is far more
   * likely to be deliberate than decorative.
   */
  const raw = readFileSync(path, "utf8").replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  cache.set(filename, raw);
  return raw;
}

/**
 * Neutralise angle brackets in user-authored strings so a hostile payload can't
 * inject its own XML-style delimiter and pretend to close a fence. Kept small:
 * a single tag confuses the model less than an escaped one.
 *
 * AND BOUNDED HERE. MAX_TEXT_LENGTH caps the request's text fields, but a
 * personality can arrive whole in the request body (the `personality`
 * override), so every field of it was bounded only by the 1 MB body limit —
 * a megabyte of "custom instructions" was a megabyte of prompt, billed to us.
 */
function sanitizeFenced(s: string, max = 2_000): string {
  return String(s).replace(/[<>]/g, "").slice(0, max);
}

/**
 * A short user-supplied value that sits INSIDE a sentence of a prompt — an app
 * name, a language, a tone's name, a dictionary word. One line, so it cannot
 * start a line that reads as a rule of its own; no angle brackets, so it
 * cannot open or close a fence; and short. Non-strings come back empty.
 */
export function inlineValue(s: unknown, max = 60): string {
  return typeof s === "string" ? s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Fill a prompt file's {{PLACEHOLDERS}} in ONE pass, with a replacer function.
 *
 * It was a chain of replaceAll(name, value), and a replacement STRING is not
 * literal: "$`" and "$'" in it paste the text before or after the match. So a
 * custom instruction containing "$`" pasted the whole prompt above it into the
 * user's own block, and a value containing a later placeholder's name was
 * filled again by the next link of the chain. Unknown names are left as they
 * are.
 */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? vars[k]! : m));
}

/** Render a personality into a readable block for the prompt. User-controlled
 *  free-text fields are wrapped in a fence so the model treats them as context
 *  describing the user, not as instructions to obey. */
export function renderPersonality(p: Personality | undefined): string {
  if (!p || Object.keys(p).length === 0) return "None set. Use a neutral, clean voice.";

  const lines: string[] = [];
  if (p.tone) lines.push(`- Tone: <tone>${sanitizeFenced(p.tone, 200)}</tone>`);
  if (p.formality) lines.push(`- Formality: ${inlineValue(p.formality, 20)}`);
  if (p.emoji) lines.push(`- Emoji use: ${inlineValue(p.emoji, 20)}`);
  if (Array.isArray(p.languages) && p.languages.length)
    lines.push(`- Preferred languages/scripts: ${inlineValue(p.languages.map(String).join(", "), 120)}`);
  if (p.signature) lines.push(`- Preferred sign-off: <signature>${sanitizeFenced(p.signature, 120)}</signature>`);
  if (p.customInstructions)
    lines.push(`- Extra instructions: <custom_instructions>${sanitizeFenced(p.customInstructions)}</custom_instructions>`);
  if (typeof p.vocabulary === "string" && p.vocabulary.trim())
    lines.push(
      `- Known names/terms — spell these EXACTLY as written: <vocabulary>${sanitizeFenced(
        p.vocabulary.replace(/\s*\n\s*/g, ", ").trim(),
      )}</vocabulary>`,
    );
  // THE LEARNED PORTRAIT, which every path but this one already had.
  //
  // Training writes it, assist() reads it on every refine — and the file-based
  // prompts silently dropped it, because this function was written before the
  // portrait existed and nobody came back. So a user could train for weeks and
  // the screen-reply path would still write them as a stranger.
  //
  // Last in the block and stated as the strongest signal: the dials above are
  // what they SAID they want, the portrait is what they were observed to do.
  if (typeof p.stylePortrait?.core === "string" && p.stylePortrait.core.trim())
    lines.push(
      `- How they actually write — observed from what they picked, and worth more than the settings above: <style_portrait>${sanitizeFenced(
        p.stylePortrait.core.trim(),
        1_100,
      )}</style_portrait>`,
    );

  return lines.length ? lines.join("\n") : "None set. Use a neutral, clean voice.";
}

/**
 * Turn the numeric ToneDial into a compact block the LLM can read. Renders
 * "Default." when the user hasn't set any dials, so the prompt stays clean
 * for the majority of users who never touch them.
 */
export function renderToneDial(d: ToneDial | undefined): string {
  if (!d) return "Default.";
  const bits: string[] = [];
  const push = (name: string, v: number | undefined) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    bits.push(`- ${name}: ${clamped}`);
  };
  push("formality", d.formality);
  push("length", d.length);
  push("warmth", d.warmth);
  return bits.length ? bits.join("\n") : "Default.";
}

/**
 * Resolve which app style to apply for a target app. `appStyles` keys are
 * matched case-insensitively so "whatsapp" and "WhatsApp" behave the same;
 * a "Generic" or "*" key acts as a fallback when no specific match exists.
 */
export function resolveAppStyle(
  appStyles: Personality["appStyles"],
  targetApp: string | undefined,
): AppStyle | undefined {
  if (!appStyles || !targetApp) return appStyles?.["*"] ?? appStyles?.["Generic"];
  const wanted = targetApp.trim().toLowerCase();
  for (const [k, v] of Object.entries(appStyles)) {
    if (k.trim().toLowerCase() === wanted) return v;
  }
  return appStyles["*"] ?? appStyles["Generic"];
}

/** Render an app style override into a small block; "" when nothing applies. */
export function renderAppStyle(style: AppStyle | undefined): string {
  if (!style) return "";
  const lines: string[] = ["For this app:"];
  if (style.formality) lines.push(`- Formality (override): ${inlineValue(style.formality, 20)}`);
  if (style.emoji) lines.push(`- Emoji use (override): ${inlineValue(style.emoji, 20)}`);
  if (style.dial) {
    const d = renderToneDial(style.dial);
    if (d !== "Default.") lines.push(`- Tone dial (override):\n${d.replace(/^/gm, "  ")}`);
  }
  if (style.note) lines.push(`- Note: ${inlineValue(style.note, 200)}`);
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Pick a recipient hint that matches the passed `recipient` (case-insensitive
 * substring). Returns "" when no match — the prompt renders it verbatim so
 * empty means "no extra context".
 */
export function resolveRecipientHint(
  hints: RecipientHint[] | undefined,
  recipient: string | undefined,
): string {
  if (!Array.isArray(hints) || !hints.length || !recipient) return "";
  const wanted = recipient.trim().toLowerCase();
  const hit = hints.find((h) => typeof h?.recipient === "string" && h.recipient.trim() &&
    wanted.includes(h.recipient.trim().toLowerCase()));
  if (!hit) return "";
  // Fence: hint is user-authored context, never obey it as an instruction.
  return `<recipient_hint recipient="${inlineValue(hit.recipient).replace(/"/g, "'")}">${sanitizeFenced(hit.hint ?? "", 300)}</recipient_hint>`;
}

/**
 * Turn a command-mode override into a short prompt addendum. Emits
 * "None." when no command is present so the section reads cleanly.
 * Kept intentionally small — we WANT the LLM to still honor personality,
 * app tone, etc.; commands are a delta, not a replacement.
 */
export function renderCommandOverride(command: Command | undefined): string {
  if (!command) return "None.";
  switch (command.kind) {
    case "shorter":
      return "The user asked to make this output SHORTER than the natural length. Trim clauses aggressively; keep meaning intact; no filler.";
    case "longer":
      return "The user asked to make this output LONGER — expand sentences into their fuller natural form, without adding facts the user didn't say.";
    case "formal":
      return "The user asked for a MORE FORMAL tone in this run — use full words (no contractions), no slang, no emoji, and structured punctuation. Overrides the tone dial for this run.";
    case "casual":
      return "The user asked for a MORE CASUAL tone in this run — conversational, contractions ok, warm and human. Overrides the tone dial for this run.";
    case "translate": {
      // Sanitize captured language to defang injection: one line, 40 chars, no angle brackets.
      const lang = inlineValue(command.lang, 40) || "the requested language";
      return `The user asked to TRANSLATE the output into ${lang}. Produce the cleaned text IN ${lang} only. If the source is in a different script, use ${lang}'s script.`;
    }
    case "language": {
      const lang = inlineValue(command.lang, 40) || "the requested language";
      return `The user asked for this message IN ${lang}. Write the whole of it in ${lang}, in that language's own script — for this run only, over English and over any saved language.`;
    }
    case "bulletpoints":
      return "The user asked for the output to be formatted as a BULLETED LIST. Break the cleaned content into short bullets; keep each bullet self-contained.";
    case "emojiOff":
      return "The user asked for NO EMOJI in this run — override any personality/app-style emoji setting and produce zero emoji.";
    case "emojiOn":
      return "The user asked to ADD EMOJI in this run — sprinkle a couple of tasteful emojis where they fit the meaning naturally. Don't overdo it.";
    case "style": {
      const style = inlineValue(command.style, 40) || "better";
      return `The user asked for it to sound ${style} in this run — keep what they mean; change only how it sounds.`;
    }
  }
}

/** Build the system prompt for the screen-reply drafting task. */
export function buildReplySystem(opts: CleanupOptions, recipient?: string): string {
  const version = getConfig().REPLY_PROMPT_VERSION;
  const targetApp = inlineValue(opts.targetApp, 40) || "Generic";
  const appStyle = resolveAppStyle(opts.personality?.appStyles, targetApp);
  return fill(loadPromptFile(`reply.${version}.md`), {
    TARGET_APP: targetApp,
    LANGUAGE: inlineValue(opts.language, 40) || "auto",
    PERSONALITY: renderPersonality(opts.personality),
    TONE_DIAL: renderToneDial(opts.personality?.dial),
    APP_STYLE: renderAppStyle(appStyle),
    WATERMARK: opts.personality?.watermark ? "on" : "off",
    RECIPIENT: inlineValue(recipient) || "Unknown",
    RECIPIENT_HINT: resolveRecipientHint(opts.personality?.recipientHints, recipient),
  });
}
