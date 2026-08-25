/**
 * Personality presets — the 12 starter voices users pick from.
 *
 * Each preset is a hand-tuned combination of tone + formality + emoji use +
 * a short LLM system prompt. Users can pick one, adjust the tone toggle
 * (formal / casual / very-casual / excited), and pin up to 6 to their
 * keyboard for one-tap switching mid-message.
 *
 * The list is intentionally opinionated — every preset has a clear "when
 * you'd pick this" so users don't stall at the picker. Order matters:
 * higher-utility voices first (a solid default → a friendly default →
 * useful edges).
 *
 * Field notes
 *   id           — stable across releases; used as the active/pinned key.
 *   name         — 1–2 words the user sees on the card.
 *   tagline      — one line under the name (max ~50 chars).
 *   description  — 1–2 sentences on the detail card.
 *   formality    — the default point on the dial (users can override).
 *   emojiUse     — how much emoji output tolerates.
 *   promptStyle  — the sentence appended to the LLM system prompt when
 *                  this preset is active. Keep it directional, not verbose.
 */

/**
 * The tones the user can pick per preset.
 *
 * "none" is the default: the transcript arrives EXACTLY as Whisper heard
 * it — no LLM cleanup, no rewriting, no filler removal. Fastest, most
 * faithful to what the user said, best for people who trust their own
 * dictation. The other four tones layer an LLM refine on top of the
 * transcript and the refined text is what the user sees at the cursor —
 * the raw is never inserted.
 */
export type PresetTone = "none" | "formal" | "casual" | "very-casual" | "excited";

export interface PersonalityPreset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  formality: "casual" | "neutral" | "formal";
  emojiUse: "none" | "minimal" | "expressive";
  defaultTone: PresetTone;
  promptStyle: string;
}

export const PERSONALITY_PRESETS: PersonalityPreset[] = [
  {
    id: "signature",
    name: "Signature",
    tagline: "Your everyday voice",
    description:
      "The default — clear, warm, and even-keeled. Works for most messages, from Slack to a note to your landlord.",
    formality: "neutral",
    emojiUse: "minimal",
    defaultTone: "none",
    promptStyle:
      "Write in a clean, natural voice — warm without being cutesy, clear without being clinical.",
  },
  {
    id: "professional",
    name: "Professional",
    tagline: "Boardroom-ready",
    description:
      "Direct, polite, structured. When you're writing to a client, a hiring manager, or someone whose time matters.",
    formality: "formal",
    emojiUse: "none",
    defaultTone: "none",
    promptStyle:
      "Write with professional restraint: concise, respectful, no filler, no exclamation marks unless truly warranted.",
  },
  {
    id: "friendly",
    name: "Friendly",
    tagline: "Warm and easy",
    description:
      "Casual, kind, a little chatty. When you'd rather sound like a person than a manager.",
    formality: "casual",
    emojiUse: "minimal",
    defaultTone: "none",
    promptStyle:
      "Write with warmth — like you're talking to someone you like. Contractions are fine. Keep it light.",
  },
  {
    id: "witty",
    name: "Witty",
    tagline: "Dry humour, sharp corners",
    description:
      "Playful without being silly. Reaches for the clever line before the earnest one.",
    formality: "casual",
    emojiUse: "none",
    defaultTone: "none",
    promptStyle:
      "Write with dry wit — reach for the smart aside, prefer a clever verb to a flat one, don't over-explain the joke.",
  },
  {
    id: "concise",
    name: "Concise",
    tagline: "Every word earns its space",
    description:
      "Short sentences. No hedging. When you want the message to hit and stop.",
    formality: "neutral",
    emojiUse: "none",
    defaultTone: "none",
    promptStyle:
      "Write with maximum brevity — one thought per sentence, no throat-clearing, no 'just wanted to', no 'I hope this finds you well'.",
  },
  {
    id: "gentle",
    name: "Gentle",
    tagline: "Soft, careful, considered",
    description:
      "For hard conversations — care, condolences, apologies, boundaries. Slows down and picks its words.",
    formality: "neutral",
    emojiUse: "none",
    defaultTone: "none",
    promptStyle:
      "Write with gentleness — acknowledge before you propose, prefer 'I' statements, don't rush the reader, don't over-apologise.",
  },
  {
    id: "playful",
    name: "Playful",
    tagline: "Group-chat energy",
    description:
      "Loose, expressive, lots of personality. When the recipients are your favourite people.",
    formality: "casual",
    emojiUse: "expressive",
    defaultTone: "none",
    promptStyle:
      "Write like the group chat — punchy, expressive, emojis welcome, contractions and casual phrasing throughout.",
  },
  {
    id: "romantic",
    name: "Romantic",
    tagline: "Present, tender, unguarded",
    description:
      "For the person who matters. Feels lived-in, not scripted; specific, not saccharine.",
    formality: "casual",
    emojiUse: "minimal",
    defaultTone: "none",
    promptStyle:
      "Write with tenderness and specificity — sensory, present-tense, small details over grand claims, never generic.",
  },
  {
    id: "concise-boss",
    name: "Executive",
    tagline: "Decision-first, no fluff",
    description:
      "Lead with the ask or the answer, follow with why. When your reader needs to act fast.",
    formality: "formal",
    emojiUse: "none",
    defaultTone: "none",
    promptStyle:
      "Write like a decisive executive — lead with the ask or the conclusion in the first sentence, follow with a two-line rationale, close with the next step.",
  },
  {
    id: "explainer",
    name: "Explainer",
    tagline: "Clear, structured, patient",
    description:
      "Breaks a thing down step-by-step. For handoffs, teaching moments, or telling a group how something works.",
    formality: "neutral",
    emojiUse: "minimal",
    defaultTone: "none",
    promptStyle:
      "Explain patiently — one idea per sentence, use ordered structure when there are steps, define jargon on first use.",
  },
  {
    id: "excited",
    name: "Hype",
    tagline: "Big feelings, on purpose",
    description:
      "Genuine enthusiasm. For launches, wins, celebrations — reads as excited without reading as fake.",
    formality: "casual",
    emojiUse: "expressive",
    defaultTone: "none",
    promptStyle:
      "Write with real enthusiasm — active verbs, superlatives used sparingly but confidently, no forced hype, exclamation marks welcome where earned.",
  },
  {
    id: "poetic",
    name: "Poetic",
    tagline: "Image-first, cadence-second",
    description:
      "Slower, more image-driven, a little indirect. When the message is the mood, not just the point.",
    formality: "casual",
    emojiUse: "none",
    defaultTone: "none",
    promptStyle:
      "Write with a poetic ear — favour concrete images over abstract claims, listen for rhythm, permit one restrained metaphor per note.",
  },
];

/** Look up a preset by id. Falls back to the "signature" default. */
export function findPreset(id?: string | null): PersonalityPreset {
  if (!id) return PERSONALITY_PRESETS[0]!;
  return PERSONALITY_PRESETS.find((p) => p.id === id) ?? PERSONALITY_PRESETS[0]!;
}

/**
 * Layer per-user overrides on top of the built-in presets. Every consumer of
 * a preset (personality screen, keyboard chip row, tone prompt builder) goes
 * through this so a user rename / emoji change flows everywhere at once.
 *
 * A preset's `defaultTone` is validated against PresetTone before it's
 * accepted — a corrupt override can never smuggle an unknown tone into the
 * refine pipeline (it'd just fall back to the built-in default).
 */
export interface PresetOverride {
  name?: string;
  emoji?: string;
  tagline?: string;
  description?: string;
  defaultTone?: string;
  promptStyle?: string;
}

export function applyPresetOverrides(
  overrides?: Record<string, PresetOverride>,
): PersonalityPreset[] {
  if (!overrides || Object.keys(overrides).length === 0) return PERSONALITY_PRESETS;
  const validTones: PresetTone[] = ["none", "formal", "casual", "very-casual", "excited"];
  const coerceTone = (t: unknown, fallback: PresetTone): PresetTone =>
    typeof t === "string" && validTones.includes(t as PresetTone) ? (t as PresetTone) : fallback;

  const builtins = PERSONALITY_PRESETS.map((p) => {
    const o = overrides[p.id];
    if (!o) return p;
    return {
      ...p,
      name: (o.name ?? p.name).trim() || p.name,
      tagline: (o.tagline ?? p.tagline).trim() || p.tagline,
      description: (o.description ?? p.description).trim() || p.description,
      defaultTone: coerceTone(o.defaultTone, p.defaultTone),
      promptStyle: (o.promptStyle ?? p.promptStyle).trim() || p.promptStyle,
    };
  });

  // User-created tones: any override id that is NOT a built-in preset is a
  // custom voice the user added in the tone editor (just a name + prompt).
  // Append it so it shows in the Voice list, can be made active, and feeds the
  // refine pipeline exactly like a built-in.
  const builtinIds = new Set(PERSONALITY_PRESETS.map((p) => p.id));
  const customs: PersonalityPreset[] = [];
  for (const [id, o] of Object.entries(overrides)) {
    if (builtinIds.has(id)) continue;
    const name = (o.name ?? "").trim();
    const promptStyle = (o.promptStyle ?? "").trim();
    if (!name && !promptStyle) continue; // ignore empty stubs
    customs.push({
      id,
      name: name || "Custom voice",
      tagline: (o.tagline ?? "").trim(),
      description: (o.description ?? "").trim(),
      formality: "neutral",
      emojiUse: "minimal",
      defaultTone: coerceTone(o.defaultTone, "none"),
      promptStyle: promptStyle || name,
    });
  }
  return customs.length ? [...builtins, ...customs] : builtins;
}

/** Every preset with `pin: true` when the id appears in `pinnedIds`. */
export function decoratePresets(
  activeId: string | undefined,
  pinnedIds: string[] | undefined,
): Array<PersonalityPreset & { active: boolean; pinned: boolean }> {
  const pins = new Set(pinnedIds ?? []);
  return PERSONALITY_PRESETS.map((p) => ({
    ...p,
    active: p.id === (activeId ?? "signature"),
    pinned: pins.has(p.id),
  }));
}

/** Tone → segmented-toggle label mapping shown on the personality screen.
 *
 *  "none" is branded ZU 8.8 — it is not the absence of a voice, it IS the
 *  product's own: language auto-detected, no borrowed vibe applied, and the
 *  refinement shaped by the way THIS user has learned to talk (their style
 *  portrait). Every other tone is a costume laid over that; ZU 8.8 is the
 *  user, cleaned up. */
export const TONE_LABELS: Record<PresetTone, string> = {
  none: "ZU 8.8",
  formal: "Formal",
  casual: "Casual",
  "very-casual": "Very Casual",
  excited: "Excited",
};

/** Default tone new users start with — the raw, pass-through path. */
export const DEFAULT_TONE: PresetTone = "none";

/** Max number of presets a user can pin to the keyboard for quick-swap. */
export const MAX_PINNED_PRESETS = 6;
