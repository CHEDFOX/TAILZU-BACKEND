/**
 * Flow — API contract (source of truth).
 *
 * This file defines the shape of every request/response between the clients
 * (Android keyboard, later iOS) and the backend. Keep it framework-free so it
 * can be imported by the backend directly and mirrored by the Android app.
 */

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

/** Audio container the client is sending. */
export type AudioFormat = "wav" | "m4a" | "webm" | "mp3" | "ogg" | "flac";

/**
 * Language hint for transcription + cleanup. Tulmi targets most world
 * languages, so this is open-ended: any ISO-639-1 code (e.g. "es", "fr", "ar",
 * "ja") is accepted. The named values are conveniences:
 * - "auto"     : let the model detect (default; best for spontaneous speech)
 * - "hi"       : primarily Hindi
 * - "en"       : primarily English
 * - "hinglish" : explicit Hindi/English code-switching (the flagship case)
 *
 * For any code-switching (Spanglish, Arabic/English, etc.), prefer "auto".
 */
export type LanguageHint = "auto" | "hi" | "en" | "hinglish" | (string & {});

/**
 * What the user is typing into, used to adapt tone/format.
 * Free-form on the wire (any app name), but these are the ones we tune for.
 */
export type TargetAppHint =
  | "WhatsApp"
  | "Slack"
  | "Gmail"
  | "Email"
  | "Messages"
  | "Notes"
  | "Search"
  | "Code"
  | "Generic"
  | (string & {});

/** Usage we record per request for metering / free-tier enforcement. */
export interface UsageRecord {
  /** Length of audio processed, in seconds (the primary meter). */
  audioSeconds: number;
  /** Word count of the cleaned output (secondary meter). */
  words: number;
  /** Cleanup model that produced the output (CLEANUP_MODEL). */
  model: string;
}

/** Aggregated usage for the stats screen (this month + all-time). */
export interface UsageSummary {
  month: { words: number; audioSeconds: number; requests: number };
  total: { words: number; audioSeconds: number; requests: number };
  /** The caller's own calendar day, when their clock was given. */
  today?: { words: number; audioSeconds: number; requests: number };
}

/**
 * Three continuous style dials (0–100). Continuous instead of enum so the
 * keyboard can offer a slider that Actually Feels Like a slider, and so we can
 * A/B different midpoints without a shape change.
 *
 *   formality: 0 = "yo" / 100 = "Dear Sir/Madam"
 *   length:    0 = terse / 100 = generous, spelled-out
 *   warmth:    0 = matter-of-fact / 100 = warm, personable
 */
export interface ToneDial {
  formality?: number;
  length?: number;
  warmth?: number;
}

/**
 * Per-target-app style override — the tone dial + emoji policy that should
 * apply when the user writes into this app specifically. Everything is optional;
 * unset fields inherit the top-level Personality. Sparse by design so an app
 * like "Slack" can override only formality without changing warmth.
 */
export interface AppStyle {
  dial?: ToneDial;
  formality?: "casual" | "neutral" | "formal";
  emoji?: "none" | "minimal" | "expressive";
  /** Free-form addendum for this app, e.g. "always thread-friendly". */
  note?: string;
}

/**
 * Per-recipient hint — a plain-language note the user writes about a specific
 * contact ("my mom", "boss@work"). Non-normative — the LLM uses it as advice,
 * not a rule. Kept as a small list so the prompt stays finite.
 */
export interface RecipientHint {
  /** Free-form identifier (name, handle, or address). Compared verbatim. */
  recipient: string;
  /** e.g. "very close friend, keep it low-effort and funny". */
  hint: string;
}

/**
 * The user's personality / style profile. Set once in the app, stored in the
 * backend, and applied to every output so the text sounds like *them*. The app
 * may also pass an inline override per request.
 *
 * Legacy fields (tone/formality/emoji) still work — new fields (dial/appStyles/
 * recipientHints/watermark/learnFromSent) are additive and layer on top.
 */
export interface Personality {
  /** Free-text description of voice, e.g. "warm, concise, a little witty". */
  tone?: string;
  /** How formal the output should lean. */
  formality?: "casual" | "neutral" | "formal";
  /** How much emoji to use (only when it fits the app/context). */
  emoji?: "none" | "minimal" | "expressive";
  /** Preferred languages/scripts, in priority order (e.g. ["hinglish", "en"]). */
  languages?: LanguageHint[];
  /** Optional sign-off the user likes (only used where a sign-off fits). */
  signature?: string;
  /** Free-form extra instructions ("avoid exclamation marks", "use British spelling"). */
  customInstructions?: string;
  /** Word → replacement pairs from the Dictionary editor. Applied by the
   *  keyboard on device and stated to the writer, so a name the user always
   *  spells one way comes out that way. */
  dictionary?: Array<{ word: string; replacement: string }>;
  /** Personal dictionary: names, brands, jargon to spell exactly (one per line
   * or comma-separated). Biases speech-to-text and cleanup so the right
   * spellings come out. */
  vocabulary?: string;
  /** Text-expansion shortcuts, one per line as "trigger = expansion". The
   * cleanup step expands each trigger into its full text. */
  snippets?: string;
  /**
   * The read-aloud (TTS) voice the user picked — an OpenAI gpt-4o-mini-tts
   * voice id from the curated set (experience/ttsVoices.ts), e.g. "nova". Used
   * by /v1/speak when the client sends no voice of its own, and returned by
   * /v1/ask so the client knows which voice to request. Only an id that passes
   * `isValidTtsVoice` is ever stored; anything else is ignored, so an unknown
   * value can never reach OpenAI. Unset → the default voice ("nova").
   */
  ttsVoice?: string;

  /**
   * The evolving style portrait — a compact, LLM-maintained description of how
   * this user likes their refined text, learned from the Training tab's
   * variant picks (and bounded so it can never blow up the refine prompt).
   * `core` is tone-independent; `tones` carries per-tone notes keyed by tone
   * id; `examples` counts absorbed picks.
   */
  /**
   * When they first reached the tab shell — i.e. finished onboarding and
   * arrived in the app proper.
   *
   * Kept here rather than on the profile because personality is a JSON
   * document and the profile is columns: one is a field, the other a
   * migration. It is the only thing that separates "first visit" from "every
   * later visit", which is what decides the tab they open on.
   */
  shellSeenAt?: string;

  stylePortrait?: {
    /** The prose summary. Still the thing every refine reads first. */
    core?: string;
    /**
     * Their own words, with what each one MEANS to them.
     *
     * A list rather than a sentence, because these are the part that must
     * accumulate: someone's slang is learned one word at a time over months,
     * and a prose paragraph rewritten each session forgets the ones that
     * happened not to come up. The meaning is what makes them usable — knowing
     * that this person says "jugaad" is preservation, knowing what they mean by
     * it is the difference between keeping the word and using it.
     */
    words?: Array<{ term: string; means: string }>;
    /** The handful of modes they actually write in, and when each shows up. */
    styles?: Array<{ name: string; when: string }>;
    /**
     * How they differ by time of day. Only ever written when the user's UTC
     * offset is known — a day-part computed against the wrong clock is worse
     * than no day-part at all.
     */
    rhythms?: Array<{ when: string; vibe: string }>;
    /** Per-voice notes, keyed by voice or tone id. */
    tones?: Record<string, string>;
    /** Last known offset from UTC, in minutes, sent by the app with its stats
     *  call. Without it, `rhythms` stays empty. */
    tzOffsetMinutes?: number;
    /** Deliberate training rounds: variants picked, spoken sessions finished. */
    examples?: number;
    /** Ordinary refines observed since the portrait was last rewritten from
     *  them. Most people train a handful of times and then just use the
     *  keyboard for months, so this is where nearly all the evidence is. */
    observed?: number;
    /** How many distinct sittings have fed this portrait. Sent to the writer
     *  so it knows whether what is already there is a first impression or a
     *  settled observation — one odd session should not overturn a habit seen
     *  across fifty. */
    sessions?: number;
    /** When this person first wrote anything we learned from. With sessions,
     *  it gives the portrait its own age. */
    firstSeenAt?: string;
    /** Last refine of any kind. A gap larger than PORTRAIT_SESSION_GAP_MINUTES
     *  is what ends a session and triggers the roll-up. */
    lastSeenAt?: string;
    updatedAt?: string;
  };

  // --- Style dials + per-context overrides (v2 additions) --------------------

  /** Continuous style dials — see ToneDial. Overrides `formality` when set. */
  dial?: ToneDial;
  /** Per-target-app overrides (e.g. { WhatsApp: { dial: { formality: 10 } } }). */
  appStyles?: Record<string, AppStyle>;
  /** Small list of per-contact hints applied when `recipient` matches. */
  recipientHints?: RecipientHint[];

  // --- Consent + trust flags -------------------------------------------------

  /**
   * If true, appends " · Tailzu" (or the localised equivalent) after outputs.
   * Opt-in growth mechanism — users get "sent with Tailzu" attribution.
   */
  watermark?: boolean;

  /**
   * Explicit consent for the backend to use recent outputs to improve the
   * user's saved style. If false, cleanup runs are single-shot and forgotten.
   * Default: unset → treat as false. Never inferred from anything else.
   */
  learnFromSent?: boolean;

  /**
   * Explicit consent for the backend to keep raw audio beyond the STT call.
   * Default: unset → treat as false. Today the backend deletes audio right
   * after the STT call regardless; this flag exists so a future feature (e.g.
   * "review my last dictation") can be opted into.
   */
  retainAudio?: boolean;

  /**
   * Explicit consent for the backend to keep a per-request history log
   * (input transcript/text + cleaned output) so the user can browse and
   * re-use their past cleanups. Default: unset → treat as false. Distinct
   * from `learnFromSent`: learning uses runs to improve the personality;
   * `retainHistory` just keeps the receipts. Either flag being true is
   * enough to enable history storage.
   */
  retainHistory?: boolean;

  // --- Keyboard haptics ------------------------------------------------------
  /**
   * Every key buzzes. The master switch on the Haptics card.
   *
   * Independent of `hapticKeys`, not a superset of it: turning this off must
   * not silently discard the individual keys someone chose.
   */
  hapticsAll?: boolean;
  /**
   * The individual keys the user picked, by what they type (" ", ".", "a") or
   * by role ("shift", "backspace", "return", "space", "mic", "refine").
   * Lowercased, so a shifted key and the picker agree.
   *
   * A key listed here buzzes even when `hapticsAll` is off. Both default to
   * off: a keyboard that buzzes on every letter out of the box is a setting
   * people go hunting for how to turn OFF.
   */
  hapticKeys?: string[];

  // --- Preset selection + keyboard-pinning (v3 additions) --------------------
  // The main app now surfaces 12 hand-tuned starter voices ("presets"). The
  // user picks one, tunes its tone with a segmented toggle, and can pin up
  // to 6 to the keyboard for quick-swap without opening the app.

  /**
   * Currently selected preset id (see experience/personalityPresets.ts).
   * When set, the LLM system prompt gets the preset's promptStyle appended
   * on top of the user's other fields. Unset → treated as "signature".
   */
  activePresetId?: string;

  /**
   * Tone override for the active preset — one of "formal" / "casual" /
   * "very-casual" / "excited". Overrides the preset's defaultTone; layered
   * on top of `formality` and `dial.formality` when set.
   */
  activeTone?: string;

  /**
   * Ordered list of preset ids the user has pinned to the keyboard for
   * quick-swap. Max 6. Order matters: index 0 shows leftmost on the
   * keyboard's personality chip row.
   */
  pinnedPresetIds?: string[];

  /**
   * Per-user overrides for the built-in personality presets. Keyed by
   * preset id (e.g. "signature", "wispr", "kai") → partial preset shape.
   * Only the fields the user changes are stored; the built-in preset
   * supplies the rest via a merge on read. Lets a user rename a preset,
   * adjust its tagline / description / promptStyle
   * without changing the shipped preset list.
   *
   * Undefined / missing key → the built-in preset shows through as-is.
   */
  presetOverrides?: Record<string, {
    name?: string;
    tagline?: string;
    description?: string;
    defaultTone?: string;
    promptStyle?: string;
  }>;

}

/**
 * "Command mode" — a trailing verbal (or typed) instruction the user tacks
 * on to alter the cleanup for this one run. E.g. "…MAKE IT SHORTER".
 *
 * See pipeline/commands.ts for the detector; the transcript minus the command
 * is what gets cleaned, and the command shapes the cleanup prompt as an
 * ephemeral, "for this run only" override that never touches saved personality.
 */
export type Command =
  | { kind: "shorter" }
  | { kind: "longer" }
  | { kind: "formal" }
  | { kind: "casual" }
  | { kind: "translate"; lang: string }
  /** "write this in Hindi" — compose in that language rather than carry a
   *  finished English text across into it. The two end in the same place
   *  and people say both, so both are heard. */
  | { kind: "language"; lang: string }
  | { kind: "bulletpoints" }
  | { kind: "emojiOff" }
  | { kind: "emojiOn" }
  /** "…make it sweet", "…say it politely", "…in a funny way": how it should
   *  sound, for this message only. The word they used, as they said it. */
  | { kind: "style"; style: string };

/**
 * The kind of field they are writing in, as the client reads it: Android's
 * input type and IME action, iOS's keyboard traits, the desktop's
 * accessibility role. Never sent for a password field.
 */
export type FieldKind =
  | "search" | "url" | "email" | "number" | "phone" | "name" | "address"
  | "message" | "text" | "longtext";

/** Options that shape a request (shared by voice, typing, and screen modes). */
export interface CleanupOptions {
  /** App the user is typing into; drives tone + formatting. Default "Generic". */
  targetApp?: TargetAppHint;
  /** What kind of field it is, when the client can read it (see FieldKind). */
  fieldKind?: FieldKind;
  /** The field's own label or placeholder as they see it: "Search mail",
   *  "Subject", "Message #design". Text off their screen, so the server
   *  cleans and caps it (field.cleanLabel) before the writer sees it. */
  fieldLabel?: string;
  /**
   * What is on the screen AROUND the field, when the client can read it: the
   * conversation being replied to, the recipient, the subject, the page.
   * Other people's words. Reference only — the writer uses it to understand
   * this message (who "he" is, how a name is spelled, what is being replied
   * to) and never copies it or replies to it. The server fences and caps it.
   */
  surroundings?: string;
  /**
   * The field, or the window, is private: an incognito/private browser
   * window, or an app the client treats as sensitive. The server then writes
   * from what they said alone — no surroundings, no prior text kept.
   */
  privateField?: boolean;
  /**
   * The device's current UTC offset in minutes (e.g. 330 for IST, -480 for
   * PST), when the client sends it. Used for the "this morning / 2 min ago"
   * timing of the recent-dictations context, so a keyboard-only user whose
   * stored offset is stale still gets the right time of day. Overrides the
   * stored one for this request.
   */
  tzOffsetMinutes?: number;
  /** Language hint. Default "auto". */
  language?: LanguageHint;
  /**
   * Script the input was actually captured in, OBSERVED by the STT layer (not
   * declared by the user). Stated to the model as fact so romanized speech
   * can't be silently converted to a native script and vice-versa.
   */
  script?: string;
  /**
   * A second speech recognizer's reading of the same audio, present only when
   * it disagreed with the primary transcript. The writing step reconciles the
   * two before writing — two engines fail in different places, so each usually
   * holds part of the truth.
   */
  alternative?: string;
  /**
   * The recognizer's own confidence that it heard real, intelligible speech.
   * Observed like `script`, and stated to the writing step for the same
   * reason: it is what separates "they said this" from "this is my best guess
   * at what they said", and the writing step is the only place a mishearing
   * can still be repaired.
   *
   * Never sent by clients — the STT layer fills it in.
   */
  speechConfidence?: "high" | "low" | "unknown";
  /**
   * Personality override for this request. If omitted, the backend uses the
   * user's saved personality (resolved from their account).
   */
  personality?: Personality;
  /**
   * One-shot command override detected from the tail of the input
   * (e.g. "…make it shorter"). Applied as an addendum to the cleanup prompt
   * for THIS run only — never persisted, never merged into personality.
   */
  command?: Command;
  /**
   * Values the snippet expander can interpolate into user snippets — e.g.
   * `sig = — {name}` becomes `— Alex` when variables.name === "Alex". Every
   * field is optional; unset variables resolve to an empty string.
   */
  variables?: {
    name?: string;
    email?: string;
    /** E.164 phone, for accounts that signed in with SMS and have no email. */
    phone?: string;
  };
  /**
   * What's already in the text field when this request fires — the existing
   * draft or the conversation so far. The assist step treats it as CONTEXT to
   * continue / revise / reply to, not as text to rewrite. Optional; omitted
   * when the field is empty.
   */
  context?: string;
  /**
   * The active tone id for this request ("none" | "formal" | "casual" |
   * "very-casual" | "excited" | a preset's tone). Drives the assist prompt's
   * voice. When omitted the backend falls back to the saved active tone.
   */
  tone?: string;
  /**
   * The active tone's own instruction text, sent INLINE by the client. When
   * present it defines the voice directly and overrides the built-in guidance
   * for `tone` — so a tone the user created seconds ago works with no
   * server-side registry (the backend never has to KNOW the tone, only receive
   * its prompt). Built-in tones can omit this and let the server fill the
   * default guidance. Capped server-side (see MAX_TONE_PROMPT).
   */
  tonePrompt?: string;
}

// ---------------------------------------------------------------------------
// REST: one-shot transcribe + clean  (POST /v1/transcribe-clean)
// ---------------------------------------------------------------------------
//
// Sent as multipart/form-data:
//   - field "audio": the audio file
//   - field "targetApp" (optional)
//   - field "language"  (optional)
//
// This is the simplest path: upload a whole clip, get polished text back. It is
// what the test script and early Android builds use before live streaming.

export interface TranscribeCleanResponse {
  /** The polished, insert-ready text. */
  cleanedText: string;
  /** The raw STT output, before cleanup (useful for debugging/QA). Empty when
   *  the clip held no speech: never paste it in place of an empty cleanedText
   *  when `noSpeech` is set. */
  transcript: string;
  usage: UsageRecord;
  /**
   * Put ONE space before `cleanedText` when appending it after the `context`
   * you sent. Computed from the two strings: false when there is no context,
   * when context already ends in whitespace, when cleanedText opens with
   * punctuation (",", ".", "?"…), or for Chinese/Japanese/Thai on both sides.
   * Older servers omit it; then join with a space unless one of those holds.
   */
  joinWithSpace?: boolean;
  /** The clip held no speech (silence, a breath, noise, or only words a
   *  recogniser invents on quiet). Paste nothing; a pause stretch shows nothing. */
  noSpeech?: boolean;
  /** Diagnostic: seconds of voice measured in the clip (null when it could not
   *  be measured) and, when text was withheld, why. */
  speech?: { voicedSeconds: number | null; dropped?: string };
}

// ---------------------------------------------------------------------------
// REST: typing-refine  (POST /v1/refine)
// ---------------------------------------------------------------------------
//
// The "smart autocorrect" mode: the user TYPED some rough text and wants it
// rewritten in the best way, in their personality + the target app's tone.
// No audio, no STT — just text in, polished text out.

export interface RefineRequest extends CleanupOptions {
  /** The raw text the user typed. */
  text: string;
}

export interface RefineResponse {
  refinedText: string;
  usage: UsageRecord; // audioSeconds is 0 here
  /** Put ONE space before `refinedText` when appending it after `context`
   *  (see TranscribeCleanResponse.joinWithSpace). */
  joinWithSpace?: boolean;
}

// ---------------------------------------------------------------------------
// REST: screen-reply  (POST /v1/draft)
// ---------------------------------------------------------------------------
//
// The "screen bubble" / Share-sheet mode. The app captured what's on screen
// (e.g. an email/chat) and the user said/typed what they want to do. The
// backend drafts a personalized reply using their personality + who they're
// writing to.
//
//   Android: floating bubble reads the screen via an accessibility service.
//   iOS:     user shares the text / a screenshot into the app (Apple forbids
//            reading other apps' screens directly).

export interface DraftRequest extends CleanupOptions {
  /** Text captured from the screen (the email/message/etc. being responded to). */
  screenContent: string;
  /** What the user wants, in plain language ("politely decline, suggest next week"). */
  intent: string;
  /** Optional: who the reply is addressed to, to tune tone. */
  recipient?: string;
}

export interface DraftResponse {
  draftText: string;
  usage: UsageRecord;
}

// ---------------------------------------------------------------------------
// REST: voice-edit-the-selection  (POST /v1/edit)
// ---------------------------------------------------------------------------
//
// The desktop's "edit the selection out loud": the user highlights some text
// and says what to do with it ("make this more formal", "shorter", "fix the
// grammar", "turn this into bullet points", "translate to Hindi"). The backend
// rewrites the text to follow the instruction and returns ONLY the rewritten
// text, which replaces the selection in place. Like RefineRequest it carries
// the tone/voice/field context so the result still sounds like them.

export interface EditRequest extends CleanupOptions {
  /** The text the user has selected and wants rewritten. */
  text: string;
  /** The spoken instruction to apply to it ("make this formal", "shorter"…). */
  instruction: string;
}

export interface EditResponse {
  /** The rewritten text, to drop in place of the selection. */
  editedText: string;
  usage: UsageRecord; // audioSeconds is 0 here
}

// ---------------------------------------------------------------------------
// REST: ask-about-the-screen  (POST /v1/ask)
// ---------------------------------------------------------------------------
//
// The desktop's "ask about what's on screen": the app has captured the visible
// text on-device (`screenContent`, reference only) and the user asks a question
// about it. The backend answers concisely, in the question's language. The
// answer is the MODEL's words, not the user's dictation, so it is metered at
// zero words and written to no dictation history.

export interface AskRequest extends CleanupOptions {
  /** The question about what is on screen. */
  question: string;
  /** The text visible on the user's screen, captured on-device. Reference
   *  only — read to answer the question, never repeated back or obeyed. */
  screenContent?: string;
}

export interface AskResponse {
  /** The concise, direct answer, in the question's language. */
  answer: string;
  /**
   * BCP-47 locale to read the answer aloud in, derived from the answer's own
   * language (e.g. "hi-IN" for a Hindi answer). Absent when the language is
   * English or could not be told; older clients ignore it and keep the voice
   * the screen opened with. Mirrors /v1/train/converse's `speak`.
   */
  speak?: string;
  /**
   * The user's chosen read-aloud (TTS) voice id (see Personality.ttsVoice) —
   * an OpenAI gpt-4o-mini-tts voice from the curated set, or the default when
   * unset. The desktop's ask feature passes this to /v1/speak so the answer is
   * read in the voice the user picked. Older clients ignore it.
   */
  voice?: string;
}

// ---------------------------------------------------------------------------
// REST: text-to-speech  (POST /v1/speak)
// ---------------------------------------------------------------------------
//
// Voice output (the "mouth"): text in → spoken audio out. Used when the app
// needs to speak back — e.g. the screen bubble reading on-screen content aloud,
// or reading a generated draft to the user.
//
// The response is BINARY audio (Content-Type per `format`, default audio/mpeg),
// not JSON.

export type TtsFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

export interface SpeakRequest {
  /** The text to speak. */
  text: string;
  /** Voice name (e.g. "alloy", "nova"). Defaults to the server's TTS_VOICE. */
  voice?: string;
  /** Output container. Defaults to the server's TTS_FORMAT (mp3). */
  format?: TtsFormat;
  /** Optional style steer, e.g. "calm and friendly" (can come from personality). */
  instructions?: string;
}

// ---------------------------------------------------------------------------
// REST: personality  (GET/PUT /v1/personality)
// ---------------------------------------------------------------------------
//
// GET  → the user's saved personality (or an empty object if none set).
// PUT  → save/replace it (body is a Personality).

export interface PersonalityResponse {
  personality: Personality;
}

// ---------------------------------------------------------------------------
// Paywall config — served with bootstrap flags["paywall"]. Every value comes
// from the backend so plans / copy / media / gating swap without a rebuild.
// ---------------------------------------------------------------------------

/**
 * A single selectable plan card. Prices come from the store (RevenueCat
 * resolves them) — the label / period / badge are backend authored.
 *
 *   productId    Apple/Google product id. Passed to iap.subscribe when
 *                the user taps the CTA with this plan selected.
 *   offeringId   Optional RevenueCat offering to look inside; used with
 *                iap.showPaywall when the backend prefers offering-based
 *                selection over raw productId.
 *   packageId    Optional RevenueCat package identifier (annual/monthly/…)
 *                inside the offering. When present, iap.showPaywall targets
 *                that specific package.
 *   badge        Small pill (e.g. "Save 40%", "Best value") rendered on top
 *                of the card. Empty/absent = no pill.
 *   accent       Overrides the card's active-state accent (defaults to
 *                theme.color.primary). Handy for a "gold" annual plan.
 */
export interface PaywallPlan {
  id: string;                       // client-side selection state key
  productId?: string;               // for iap.subscribe
  offeringId?: string;              // for iap.showPaywall
  packageId?: string;               // for iap.showPaywall (inside offering)
  label: string;                    // "Annual", "Monthly", "Lifetime"
  price: string;                    // "$59.99/yr", "$9.99/mo" — the shown copy
  period?: string;                  // "per year", "per month" — secondary line
  perUnit?: string;                 // "$4.99/mo billed annually" — footnote
  /**
   * ONE LINE saying what tapping this row does.
   *
   * The paywall has no confirm button — the row is the commitment — so this is
   * the only place the terms get stated, and the stores require them stated
   * before a purchase, not after.
   */
  note?: string;
  badge?: string;                   // "Save 40%", "Best value", "3-day trial"
  accent?: string;                  // hex — overrides theme primary on select
  default?: boolean;                // pre-selected when the screen opens
  /**
   * A card that is shown but cannot be bought — the free tier, standing next to
   * what money buys.
   *
   * It is not selectable, it carries no purchase action, and the CTA chain skips
   * it entirely. Without that last part a "free plan" is a button that tries to
   * buy a product with no id and fails in front of the user.
   *
   * Worth showing: a paywall that lists only paid tiers implies the free one has
   * run out or never existed, and App Review reads "what do I get for nothing"
   * as part of a subscription being honestly described.
   */
  free?: boolean;
}

/**
 * Backend-authored paywall. Rendered via the "paywall" SDUI screen.
 *   heroFrames    Cycling media at the top (uses Slideshow).
 *   title         Big headline under the hero.
 *   subtitle      Smaller supporting line.
 *   features      Bulleted list of value props.
 *   plans         Selectable pricing cards. First card default when none
 *                 explicitly marked `default: true`.
 *   cta           Primary button label (e.g. "Start free trial").
 *   restoreLabel  Text for the restore-purchases link.
 *   footnote      Small print under the CTA (auto-renewal disclosure, etc.).
 *   terms         Optional Terms of Service URL for the footer link.
 *   privacy       Optional Privacy Policy URL for the footer link.
 *   dismissible   When true, a subtle "×" / "Not now" appears — hard paywall
 *                 when false. Defaults to true.
 *   dismissLabel  Copy for the dismiss button when dismissible is true.
 */
export interface PaywallConfig {
  heroFrames?: Array<{ key?: string; url?: string; asset?: string }>;
  heroFrameMs?: number;
  heroLoops?: number;
  title: string;
  subtitle?: string;
  features?: string[];
  plans: PaywallPlan[];
  cta: string;
  restoreLabel?: string;
  footnote?: string;
  terms?: string;
  privacy?: string;
  dismissible?: boolean;
  dismissLabel?: string;
  entitlement?: string;             // RevenueCat entitlement to check on load
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "ok";
  service: "tulmi-backend";
  version: string;
}

// ---------------------------------------------------------------------------
// REST: cleanup history  (GET/DELETE /v1/history)
// ---------------------------------------------------------------------------
//
// Opt-in per-user log of past cleanups. Storage is only performed when the
// user has consented via personality.learnFromSent === true OR
// personality.retainHistory === true. Reads and writes are always scoped to
// the caller. Rows are soft-deleted via a server-side deleted_at column and
// hidden from list/read responses.

/** One row in a user's cleanup history. */
export interface HistoryEntry {
  /** Server-generated UUID for the row. */
  id: string;
  /** Which surface produced this entry. */
  kind: "voice" | "typing" | "draft";
  /** Target app the cleanup was tuned for, when known. */
  targetApp?: TargetAppHint;
  /** Language hint that was in effect. */
  language?: LanguageHint;
  /** Raw input: transcript (for voice) or typed text (for typing/draft). */
  input: string;
  /** Cleaned / drafted output shown to the user. */
  output: string;
  /** Total pipeline time for this cleanup, in milliseconds. */
  durationMs?: number;
  /** Word count of the input. */
  wordsIn?: number;
  /** Word count of the output. */
  wordsOut?: number;
  /**
   * The register asked for on this request — "none" (Zu, their own voice),
   * "formal", "casual", "very-casual", "excited". Absent on rows written
   * before it was recorded, and counted as unknown rather than guessed at.
   */
  tone?: string;
  /**
   * The voice that was active — a built-in preset id or one the user made.
   * Kept beside `tone` because neither derives from the other: a voice can be
   * written in any register. A custom voice keeps this id through a rename,
   * so renaming does not split its history in two.
   */
  presetId?: string;
  /** ISO-8601 timestamp of when the row was created. */
  createdAt: string;
}

// --- Notes (desktop: a hotkey, the room's audio, notes kept in the app) -----

/** Where a note is in its life. "recording" while audio arrives, "organising"
 *  while the writer works, "ready" when it has, "failed" when it could not
 *  (the transcript is kept either way). */
export type NoteStatus = "recording" | "organising" | "ready" | "failed";

/** One stretch of what was heard, at its offset from the start. */
export interface NoteSegment {
  /** Seconds from the note's start. */
  at: number;
  text: string;
  /** Who said it: "You", "Others" (the computer's sound, before speakers are
   *  told apart), "Speaker 1"… after. A person the writer could name is in
   *  Note.people, keyed by this label. */
  speaker?: string;
}

/**
 * A note: one meeting (or lecture, or thought said aloud), kept short. What
 * it was, one paragraph on the whole conversation, and the few things people
 * said that matter, each in the speaker's own voice, cleanly worded. The
 * transcript is kept to organise it again, never shown.
 */
export interface Note {
  id: string;
  status: NoteStatus;
  /** ISO-8601. */
  startedAt: string;
  endedAt?: string;
  /** Seconds of audio heard. */
  durationSeconds: number;
  /** Words heard, as counted against the allowance. */
  words: number;
  /** The meeting: what it was, in a few words. */
  title: string;
  /** One short paragraph about the whole conversation. */
  summary: string;
  /** The few important things people said, in the order they were said:
   *  who (a speaker label, see `people`), and the words, refined. */
  highlights: Array<{ speaker: string; text: string }>;
  /** The speakers, by label, with a name where the conversation made it
   *  plain ("Thanks, Priya"). */
  people: Array<{ label: string; name?: string }>;
  transcript: NoteSegment[];
  /** True once the writer has organised it. */
  organised: boolean;
  /**
   * Whether the computer's own sound (the other people on a call) was heard:
   * "ok"; "denied" when the Mac's Screen & System Audio Recording permission
   * is off, so only the microphone was noted; "unavailable" when this
   * computer could not provide it. Absent on notes from before this was kept.
   */
  systemAudio?: "ok" | "denied" | "unavailable";
}

/** A note as a list shows it. */
export type NoteSummary = Pick<Note, "id" | "status" | "startedAt" | "endedAt" | "durationSeconds" | "words" | "title" | "summary" | "people" | "organised" | "systemAudio">;


/** GET /v1/history response. */
export interface HistoryListResponse {
  entries: HistoryEntry[];
  /**
   * ISO-8601 cursor for the next page — pass back as `?before=` on the next
   * request to fetch older entries. Absent when there are no more rows.
   */
  nextBefore?: string;
  /**
   * Row-id tie-breaker paired with `nextBefore`. Rows are ordered by
   * (created_at desc, id desc); pass this back as `?beforeId=` alongside
   * `?before=` so entries that share the boundary timestamp aren't skipped.
   * Absent when there are no more rows.
   */
  nextBeforeId?: string;
}

/** GET /v1/stats response. */
export interface StatsResponse {
  /** Which rolling window this response covers. */
  window: "week" | "month" | "all";
  /** Total request count in the window. */
  requests: number;
  /** Total cleaned-output word count in the window. */
  wordsOut: number;
  /** Total audio seconds processed in the window. */
  audioSeconds: number;
  /**
   * Rough "minutes saved" estimate, computed on the server as
   * (wordsOut * TYPING_TIME_PER_WORD) / 60. See history/store.ts for the
   * constant.
   */
  minutesSaved: number;
  /**
   * Per-day counts (requests) for a sparkline. The array is ordered oldest→
   * newest, has length = window's day count (7/30/…, capped for "all"), and
   * is bucketed by UTC calendar day.
   */
  sparklinePerDay: number[];
  // --- Deep projections for the Stats tab (optional — old servers omit). ---
  /** Words written per day, same buckets/order as sparklinePerDay. */
  wordsPerDay?: number[];
  /** Days in the window with at least one session. */
  daysActive?: number;
  /** Consecutive active days ending today (or yesterday). */
  currentStreak?: number;
  /** Longest run of consecutive active days inside the window. */
  bestStreak?: number;
  /** Words by capture kind — the "how you write" split. */
  kindWords?: { voice: number; typing: number; draft: number };
  /** Sessions by local time-of-day band — the "when you write" split. */
  daypartSessions?: { morning: number; afternoon: number; evening: number; night: number };
  /** Top target apps by words (max 5, remainder folded into "Other"). */
  topApps?: Array<{ app: string; words: number }>;
  /** The single biggest day in the window. */
  bestDay?: { date: string; words: number };
  /** wordsOut / sessions, rounded. */
  avgWordsPerSession?: number;
  /**
   * Words by language, biggest first — what you write in. Rows with no
   * language recorded fold into "auto" rather than being dropped, so the
   * slices sum to the words in the window.
   */
  languageWords?: Array<{ language: string; words: number }>;
  /**
   * Words by voice, biggest first. A request with no voice recorded counts
   * under Zu — "no voice asked for" IS Zu, so that is a reading of the data
   * rather than a guess at it.
   *
   * No tone here: a voice can be written in any register, so one tone beside
   * it could only be a sample. `toneWords` answers that over every row.
   */
  voiceWords?: Array<{ id: string; words: number }>;
  /**
   * How much of the saved dictionary earns its place. `used` and `unused`
   * count SAVED WORDS, not occurrences — one word used two hundred times is
   * still one word used. Absent, never zeroed, when there is no text to scan:
   * zero would read as "none of your words are used", which is untrue.
   */
  dictionary?: {
    saved: number;
    used: number;
    unused: number;
    /** Cleanups scanned to produce the counts. */
    scanned: number;
    top?: Array<{ word: string; uses: number }>;
    /**
     * The words that have never turned up, named rather than only counted:
     * "six unused" is a fact, "these six" is something you can act on.
     * Capped — the point is a list you can read, not a wall.
     */
    unusedWords?: string[];
  };
  /**
   * Words by register — how the writing was asked for, as opposed to who
   * wrote it. "none" is Zu, which is what an unmarked request was written in.
   */
  toneWords?: Array<{ tone: string; words: number }>;
  /** Minutes of speech processed, rounded to one decimal. */
  speakingMinutes?: number;
  /** Words by the language the text is written in (writtenIn keys), biggest first. */
  writtenIn?: Array<{ key: string; words: number }>;
  /** The detail behind each day's square, same buckets/order as wordsPerDay. */
  days?: Array<{
    words: number;
    sessions: number;
    saidSeconds: number;
    apps: Array<{ app: string; words: number }>;
    hours: number[];
    kinds: { voice: number; typing: number; draft: number };
    languages: Array<{ key: string; words: number }>;
    first?: string;
    last?: string;
  }>;
  /** Today's sessions, newest first: local "HH:MM", app, words. */
  todaySessions?: Array<{ at: string; app?: string; words: number; kind?: string }>;
  /** Each app the words went to, biggest first. */
  appDetail?: Array<{
    app: string;
    words: number;
    sessions: number;
    kinds: { voice: number; typing: number; draft: number };
    dayparts: { morning: number; afternoon: number; evening: number; night: number };
    avgWords: number;
    lastAt: string;
    voices: Array<{ id: string; words: number }>;
  }>;
  /** Sessions by length in words: 1–5, 6–15, 16–40, 41–100, more. */
  sessionLengths?: number[];
  /** Words by local hour, 24 buckets. */
  hourWords?: number[];
  /** Seconds of speech per day, same buckets as wordsPerDay. */
  saidSecondsPerDay?: number[];
}
