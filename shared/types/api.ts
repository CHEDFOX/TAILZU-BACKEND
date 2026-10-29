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
 * The usage meter (GET /v1/you/usage, tulmi/src/you/usage.ts): how much of this stretch and this month is used, as fractions (0.64 is
 * 64%; past 1 is over), and when each resets (epoch ms). A paid month is used in five stretches (days 1–4, 5–9, 10–15, 16–22, 23 to
 * the end); a plan without them is one stretch, the month. Never an amount: what the use cost is the server's own.
 */
export interface UsageMeter {
  plan: { id: string; name: string; paid: boolean; windows: boolean; carryOver: boolean; upgrade: boolean };
  stretch: { used: number; startsAt: number; resetsAt: number; n: number; of: number; days: number };
  month: { used: number; startsAt: number; resetsAt: number; days: number };
  state: "ok" | "near" | "out";
}

/** GET /v1/you/usage: the meter, and the lines a screen shows with it (near the limit, at it, how the stretches work). */
export interface UsageResponse { usage: UsageMeter; near: string | null; out: string | null; how: string }

/** Out of allowance: 429 with this body. `code` is the one every app already opens `quota.screenId` on. */
export interface UsageRefusalBody { code: "quota_exceeded"; reason: "usage_limit"; message: string; resetsAt: number; upgrade: boolean }

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

  /**
   * When the Bots app's first-arrival card (the microphone, then the keyboard, over Home) was answered or put off
   * (routes/botsFirstRun.ts, PUT /v1/bots/first-run/arrival). Unset: it is still due.
   */
  botsArrivalAt?: string;

  /**
   * When the Bots app's "turn on notifications" card (on a phone's Home, once a bot is working or needs them) was answered:
   * notifications allowed, or "Not now" (routes/botsPushAsk.ts, PUT /v1/bots/push-ask). Unset: it may still come up.
   */
  botsPushAskAt?: string;
  botsPushAnswer?: "granted" | "dismissed";

  /**
   * A second name of their own for the keyboard, beside Tailzu, which always
   * works too ("Zara, make it formal"). Set in Settings; letters, spaces,
   * apostrophes and hyphens, at most 24 characters (experience/assistantName).
   * "" or absent: Tailzu only.
   */
  assistantName?: string;

  /**
   * Which of this account's milestones have been reported to Meta (src/ads/
   * meta.ts), each with when: so each is reported once, ever. Server-owned:
   * a client's save never writes it (PUT /v1/personality drops it).
   */
  adsReported?: {
    registration?: string;
    keyboard?: string;
    firstDictation?: string;
  };

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
  /** The request carried a `selection` (the text selected in the field when
   *  they started talking), and `cleanedText` is that selection rewritten as
   *  they asked, or the new words they said in its place. Paste it over the
   *  selection, with no space before it. */
  replacedSelection?: boolean;
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
  /** The text selected in the field when they started, if any. `text` is then
   *  what they said about it ("make this bullet points"), and the answer is
   *  the selection rewritten (see RefineResponse.replacedSelection). */
  selection?: string;
}

export interface RefineResponse {
  refinedText: string;
  usage: UsageRecord; // audioSeconds is 0 here
  /** Put ONE space before `refinedText` when appending it after `context`
   *  (see TranscribeCleanResponse.joinWithSpace). */
  joinWithSpace?: boolean;
  /** `refinedText` replaces the selection the request carried: paste it over
   *  the selection, with no space before it. */
  replacedSelection?: boolean;
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
// REST: Ask, the on-screen agent  (POST /v1/agent)
// ---------------------------------------------------------------------------
//
// One request per step of a run the DEVICE owns: it reads the front app's
// accessibility tree into a short list of elements with ids, posts them with
// what the user said, and gets back an NDJSON stream of events that point at,
// explain, or do one small thing to those ids. Only roles, labels, short
// values and a coarse region leave the machine: never frames, pixels or
// window titles. The server is a stateless planner, and the device decides
// what needs confirming (it takes the higher of its own risk and `risk`).
//
// Sent either as multipart/form-data, a `request` field holding the JSON
// below and an `audio` file (the server transcribes it as the utterance), or
// as application/json with `utterance` set. Answered `200
// application/x-ndjson`, one AgentEvent per line, ending in exactly one
// terminal event (action, ask, look, approve, done or error). Problems found before
// the stream starts are ordinary JSON errors (400/401/413/429). A step that
// ends the run on the server's side (done, error, ask, approve) sends a
// `receipt` just before its terminal event: how the run ended, why, and what
// it changed. It is not terminal, and a device that does not know it skips
// it, as it skips any event type it does not know.
//
// The picture path: a multipart step may also carry ONE `image` part
// (image/jpeg, image/png or image/webp, at most AGENT_IMAGE_MAX_BYTES: 413
// above it, 400 for another type or a second picture), a crop of what they
// asked about. A JSON body never carries one. With it the step skips the
// free paths and is answered about the picture by a model that can see, in
// show mode: it says and points, and never acts. The picture is the one
// thing from the screen that leaves the machine as pixels, and only when the
// person has allowed it for that app.
//
// Drawing: on either path the answer may mark the screen while it explains
// (a box, a circle, an arrow, numbered places), as `draw` events in the order
// the model wrote them among its sentences. A mark names what it is on by an
// element's id, or, on a step that carried a picture, by a place in that
// picture in picture units (0–1000 across and down it). The device turns
// both into screen positions itself; nothing about where things are goes
// the other way for it.

/** Where an element sits in its window, by thirds. Never a frame. */
export type AgentRegion = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";

/** One element of the front window, as the device's driver read it. */
export interface AgentElement {
  /** "e1".."eN" in walk order, valid until the next snapshot; "o1".."oN" for
   *  a line of text the device read off the window's pixels (OCR), which is
   *  something to point at and never a control to act on. `^[eo]\d{1,5}$`. */
  id: string;
  /** button link field area check radio switch tab menu menuitem item combo
   *  slider image heading text cell row window. An OCR line is always text,
   *  with its words as the label and no value or flags. */
  role: string;
  label?: string;
  /** Fields, areas, combos, sliders, checks only. Never a password's. */
  value?: string;
  region?: AgentRegion;
  focused?: boolean;
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean;
}

/** What happened at an earlier step of this run. */
export interface AgentTurn {
  /** The user's words for that step. */
  said?: string;
  /** The action line that was run: "PRESS e12", "KEY cmd+k", "TYPE design". */
  did?: string;
  result?: "ok" | "failed" | "declined" | "nochange";
  /** What changed, as the device saw it: "a new window opened: Export". */
  note?: string;
  /** What a `device` event gave back (file names, sizes, kinds and dates,
   *  never contents; ≤ 5000). Only the newest turns' keep it. Data, not
   *  instructions: the planner reads it fenced like a connected app's result. */
  data?: string;
}

export interface AgentStepRequest {
  /** Made by the device: [A-Za-z0-9_-]{6,64}. */
  runId: string;
  /** 0, 1, …; past the server's AGENT_MAX_STEPS the answer is "too_many_steps". */
  step: number;
  /** What they said or typed, ≤ 1000. With audio it is replaced by what was
   *  heard; audio on a later step is their answer to an ASK. */
  utterance?: string;
  /** mac or win on POST /v1/agent (anything else is a 400). ios and android
   *  come only from the phone's POST /v1/assistant/ask, which builds its own
   *  step with no screen; nothing is ever pressed or typed on a phone. */
  platform: "mac" | "win" | "ios" | "android";
  /** The front app's short label, ≤ 60. */
  app: string;
  /** A private window or a sensitive app: refused ("private"). The device
   *  refuses first; this is the second lock. */
  privateField?: boolean;
  language?: string;
  tzOffsetMinutes?: number;
  /** What this computer can do for the planner besides the screen: "DeviceFiles"
   *  is the built-in "This computer" app (find, list, organise, move, copy,
   *  rename, make folders, trash, open and undo, on the person's own files,
   *  done by the desktop). Absent or empty: the planner is not offered it. */
  capabilities?: string[];
  screen: {
    /** ≤ AGENT_MAX_ELEMENTS (250); more is a 413. */
    elements: AgentElement[];
    /** The selected text in the focused element, ≤ 8000. */
    selection?: string;
    /** The focused field, when there is one. */
    field?: { kind: string; label?: string };
    /** Window text from OCR when the tree is thin, ≤ 4000. */
    text?: string;
  };
  /** ≤ 16, oldest first. */
  history?: AgentTurn[];
  /** Only with an `image` part: what the picture is a crop of. One image on
   *  the screen ("element"), or the whole window. Where it is on the screen
   *  never leaves the device. */
  picture?: AgentPicture;
}

export interface AgentPicture {
  region: "element" | "window";
}

export type AgentActionKind = "press" | "set" | "type" | "key" | "scroll" | "focus" | "open";
export type AgentRisk = "free" | "confirm" | "always";

/** What a mark is: box, circle, underline and highlight go around or under
 *  their target; an arrow runs from one spot to another; a number is a
 *  numbered disc (the card's step of that number); a label is text alone; a
 *  path is a line through picture points; clear takes every mark away. */
export type AgentDrawKind = "box" | "circle" | "underline" | "highlight" | "arrow" | "number" | "label" | "path" | "clear";

/**
 * Where a mark goes: one of the request's elements by id, or, only on a step
 * that carried a picture, a point or a box in that picture's units: 0 to 1000
 * from its left edge across, and from its top edge down, whole numbers. A
 * box's width and height are at least 4.
 */
export type AgentSpot =
  | { id: string }
  | { pt: [number, number] }
  | { box: [number, number, number, number] };

/** One mark on the screen, as the `draw` event carries it. */
export interface AgentDraw {
  kind: AgentDrawKind;
  /** box, circle, underline, highlight, number and label. */
  target?: AgentSpot;
  /** arrow: from the first spot to the second. */
  from?: AgentSpot;
  to?: AgentSpot;
  /** path: 2 to 32 picture points, [x, y] each. */
  points?: Array<[number, number]>;
  /** path: the last point joins the first. */
  closed?: boolean;
  /** number: 1 to 9. */
  n?: number;
  /** The mark's label, ≤ 48 chars, one line; required for a label. */
  text?: string;
}

/** What a connected-app action will do, in words, for the confirm card. */
export interface AgentApproval {
  id: string;
  /** The app's catalog id ("notion"). */
  connector: string;
  tool: string;
  /**
   * "read" only for an app the person added by link: once another app's
   * answer is in the run, even a look in it is asked first, since what it is
   * sent can carry that answer out.
   */
  risk: "read" | "write" | "send" | "destructive" | "pay";
  /** The exact text, recipient or target, in plain words. */
  preview: string;
}

/** One app in GET /v1/connectors. */
export interface ConnectorInfo {
  id: string;
  name: string;
  category: string;
  oneLine: string;
  /** "oauth": POST .../connect returns a sign-in URL. "url": the person pastes one. */
  auth: "oauth" | "url";
  connected: boolean;
  /** Connected, but the app asked for a new sign-in the last time it was tried. */
  needsSignIn?: boolean;
  /** look = reads only, draft = may prepare changes (each asked), send = may send (asked, unless turned on per tool). */
  level: "look" | "draft" | "send";
  /** Tools the person lets it do without asking. */
  auto: string[];
  /** An app the person added by link: no level (each tool has its own Allow / Ask / Off), and a Remove. */
  custom?: true;
  /** Where an app added by link lives ("mcp.example.com"), shown beside it since nobody vetted it. */
  host?: string;
  /** An app added by link whose tools changed since the person approved them: how many wait for a look. */
  toolsChanged?: number;
  /**
   * An app added by link: where its last sign-in sent the person ("auth.example.com"),
   * said before the browser opens ("You'll sign in at ..."). Connect refuses (409
   * sign_in_moved) when it would now go anywhere else, so this is never stale when it matters.
   */
  signInHost?: string;
}

/** One app in GET /v1/connectors/directory: More apps, searched. */
export interface DirectoryApp {
  /** A catalog app's id, or the MCP Registry name it would be added from ("com.example/mcp"). */
  id: string;
  /** "catalog": one of Tailzu's own apps, connected from its own tile. "registry": anybody's, added by link. */
  source: "catalog" | "registry";
  /** Its name, cut to fit an app's (40 letters): what Add sends. */
  name: string;
  /** The first letter, for the mark beside it (no icon is fetched). */
  initial: string;
  /** The registry's words for it, cleaned and cut short: theirs, not ours. */
  description: string;
  host: string;
  /** Registry only: the MCP address Add sends, with `from: id`. */
  url?: string;
  /** Every registry entry: nobody here has checked it. */
  unverified?: true;
  /** Its registry name is its own server's domain, reversed. Shown as a fact, not as trust. */
  domainVerified?: true;
  /** On DIRECTORY_FEATURED: tried live, so shown early. Still unverified. */
  featured?: true;
}

/** One tool in GET /v1/connectors/:id/tools, for the per-tool sheet. */
export interface ConnectorTool {
  name: string;
  /** The server's display name for it, when it gives one. */
  title?: string;
  /** Cleaned of hidden characters and cut short; the server's words, not ours. */
  description: string;
  risk: "read" | "write" | "send" | "destructive" | "pay";
  /**
   * What happens when the assistant wants it. An app added by link: the
   * person's choice (Allow / Ask / Off; a delete or a payment cannot be
   * Allow). A catalog app: what its level and auto list come to.
   */
  policy: "allow" | "ask" | "off";
  /** The policies this tool may be set to. Absent for a catalog app, which is set by its level. */
  choices?: Array<"allow" | "ask" | "off">;
  /** New or changed since the person approved the list: hidden from the assistant until they accept it. */
  changed?: true;
}

/** One assistant task in GET /v1/tasks (a run that used connected apps). */
export interface AssistantTask {
  id: string;
  state: "running" | "waiting" | "done" | "failed" | "cancelled";
  title: string;
  steps: Array<{ at: number; text: string }>;
  approval: AgentApproval | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * The confirm card of an `approve` event, built and worded by the server: the
 * device draws it as it is, and each button names the route it calls. Nothing
 * on it is the device's own wording, so it reads the same in every language
 * the server speaks and changes with a deploy.
 */
export interface ApprovalCard {
  /** "Ready to send?" */
  title: string;
  /** The app, in a word: "Slack". */
  app: string;
  /** What the preview is: "The exact message". */
  label: string;
  /** The exact words, recipient or target (the approval's preview). */
  preview: string;
  /** What it will do and what it won't. */
  note: string;
  /** In order: yes, change it, no. */
  buttons: ApprovalButton[];
  /** What the card says once the answer is known. */
  after: { done: string; left: string; failed: string; change: string };
}

/** The words of a "This computer" plan card, with {slots} the desktop fills
 *  (n files, m folders, to, name, from). One voice per request. */
export interface DeviceWords {
  title: string; titleTrash: string; label: string; note: string; noteTrash: string;
  ok: string; later: string; done: string; left: string; failed: string; working: string;
  organise: string; move: string; copy: string; rename: string; makeFolder: string; trash: string; undo: string;
  more: string;
}

export interface ApprovalButton {
  id: "approve" | "edit" | "deny";
  label: string;
  /** The server route this button calls, with the account's token. */
  call: { method: "POST"; path: string; body?: Record<string, string> };
  /** After a good answer: "listen" waits for what to change, said aloud; otherwise the card shows the outcome. */
  then?: "listen";
}

export type AgentEvent =
  /** First in every stream that gets past the refusals: what was heard, and
   *  whether the run shows ("where/how/what/why…") or does (a command). */
  | { t: "heard"; text: string; mode: "show" | "do" }
  /** ≤ 240 chars, captioned and spoken. Every say after a step's first
   *  comes with `append: true`: it is the next sentence of the same answer,
   *  added to the card and spoken after the last, not a new answer. */
  | { t: "say"; text: string; locale?: string; append?: boolean }
  /** `id` is always one of this request's elements. */
  | { t: "point"; id: string; caption?: string }
  /** A do-run's plan, ≤ 6 short lines. */
  | { t: "steps"; items: string[] }
  /** A mark on the screen, drawn as the answer explains; display only, in
   *  show and do runs alike, and never a reason to confirm anything. At most
   *  AGENT_DRAW_MAX a step. Its ids are this request's elements; picture
   *  spots come only on a step that carried a picture. */
  | ({ t: "draw" } & AgentDraw)
  /** TERMINAL. Never sent in show mode. `confirm` is the sentence to show
   *  when the risk is not "free". */
  | {
      t: "action"; kind: AgentActionKind;
      id?: string; text?: string; keys?: string; dir?: string; app?: string;
      risk: AgentRisk; confirm?: string;
    }
  /** TERMINAL: a question for the user; their answer is the next step. */
  | { t: "ask"; text: string }
  /** TERMINAL, only on a step without a picture: the answer needs to see
   *  something drawn rather than written. The device may send the SAME step
   *  again with the picture (once a run, with permission), or say it can't.
   *  `why` is the model's few words on what it needs to see, for the log. */
  | { t: "look"; why: string }
  /** TERMINAL, only when the person has connected apps (CONNECTORS): the
   *  planner wants to do something in one of them that needs their yes. The
   *  device shows `approval.preview` on its confirm card and calls
   *  POST /v1/tasks/:taskId/approve or /deny; nothing has been done yet. */
  | { t: "approve"; taskId: string; approval: AgentApproval; card?: ApprovalCard }
  /** TERMINAL, only when the step carried capability "DeviceFiles": the planner
   *  wants something done to the person's own files. The server never touches
   *  a file: the desktop does it, inside the folders the person allowed, and
   *  returns the outcome on its next step as a history turn
   *  ({ did: "DEVICE <tool>", result, note, data }). `risk` is the tier the
   *  server gives the tool; the desktop holds its own table and the higher
   *  wins. Anything but a "read" shows the person a plan first (a "destructive"
   *  one every time). `words` is the plan card's voice (EN or Hinglish) with
   *  {slots}; the desktop falls back to its own English when it is absent.
   *  Tools (args are those of connectors/device.ts): find_files, list_folder,
   *  open_file, reveal_file (read); organise_folder, move_files, copy_files,
   *  rename_file, make_folder, undo_last (write); trash_files (destructive). */
  | { t: "device"; id: string; tool: string; args: Record<string, unknown>; risk: "read" | "write" | "destructive"; words?: DeviceWords }
  /** Not terminal (a `done` follows): open a link on the person's computer,
   *  a hand-off with everything filled in for them to finish in the other
   *  app (they press Send, Post or Book; Tailzu sends nothing). Only these
   *  links are ever sent, every argument percent-encoded (the backend's
   *  connectors/handoffs/links.ts is the list):
   *    https://mail.google.com/mail/?view=cm&fs=1&to=..&su=..&body=.. with a
   *      mailto: `fallback` (the email hand-off)
   *    https://wa.me/<digits>?text=..  https://wa.me/?text=..  https://api.whatsapp.com/send?..
   *    https://t.me/share/url?url=..  https://t.me/<username>?text=..
   *    https://www.google.com/maps/dir/?api=1&..  https://www.google.com/maps/search/?api=1&..
   *    https://m.uber.com/ul/?..  https://www.amazon.in/s?k=..  https://www.flipkart.com/search?q=..
   *    https://www.youtube.com/results?search_query=..  https://music.youtube.com/search?q=..
   *    https://open.spotify.com/search/..  https://www.threads.com/intent/post?text=..
   *    https://www.booking.com/searchresults.html?..
   *  A phone's own links (tel:, sms:, upi://pay?..) never come to a computer:
   *  there the run says one line ("That one's for your phone. Ask me there.")
   *  and opens nothing. A desktop opens only links on this list. */
  | { t: "open"; url: string; label: string; fallback?: string }
  /** TERMINAL. */
  | { t: "done"; text?: string }
  /** TERMINAL. Codes: private, too_many_steps, no_speech, bad_target,
   *  model_unavailable, internal. */
  | { t: "error"; code: string; message: string }
  /** Not terminal. Sent once, right before the terminal event of a step that
   *  ends the run on the server's side (done, error, ask, approve; on the
   *  phone, every terminal). Never before action, look or device on the
   *  desktop: the run goes on. Desktop 0.4.4 ignores it (agent.js:1734). */
  | { t: "receipt"; receipt: RunReceipt };

/** How a run ended, as far as the server knows when it says so. */
export type RunOutcome = "done" | "partial" | "failed" | "needs_you" | "cancelled";

/** Why, in a word. Plain words for each are the server's (src/runs/words.ts). */
export type RunReason =
  | "question" | "approval" | "handoff"
  | "nothing_usable" | "invalid_args" | "desk_only"
  | "model_unavailable" | "internal" | "no_speech" | "private" | "too_many_steps" | "bad_target"
  | "needs_reconnect" | "not_connected" | "blocked" | "app_timeout" | "app_unreachable" | "app_error" | "stopped"
  | "stuck" | "denied" | "expired" | "unanswered" | "device_stopped" | "hung_up";

/**
 * The last word on a run: how it ended, why, and what it changed, never what
 * was said in it. On /v1/agent it is a `receipt` event just before the
 * terminal event that ends the run; on /v1/assistant/ask it is the answer's
 * `receipt`. A device that does not know it ignores it.
 */
export interface RunReceipt {
  runId: string;
  outcome: RunOutcome;
  reason?: RunReason;
  /** One line for the person, in their language (English or Hinglish). */
  line: string;
  /** Changes made in the world so far (see agent_runs.effects). */
  effects: number;
  steps: number;
  /** From the step's request to this receipt, and to its first event after `heard`. */
  ms: number;
  firstMs?: number;
  /** The task waiting for their yes, when outcome is needs_you for a card. */
  taskId?: string;
  /** Asking again exactly as before is safe: nothing was changed (phone only). */
  retry?: true;
}

// ---------------------------------------------------------------------------
// REST: the phone's Ask  (POST /v1/assistant/ask)
// ---------------------------------------------------------------------------
//
// One command typed or said into Tailzu on the phone, run by the same planner
// and connected apps as the desktop's Ask, with no screen behind it. Answered
// with one JSON object the phone's screen acts on with the actions it already
// has: it shows `say`, opens `open.url` when there is one, and goes to the
// confirm sheet (assistant_approve) when there is a `taskId`. 404 while
// CONNECTORS is off; 400 for no text; 401 and 429 as everywhere. The answer
// also carries the run's `receipt`; a screen that does not read it keeps the
// whole answer and uses the three fields above, as it always has.

export interface AssistantAskRequest {
  /** What they typed or said, ≤ 1000. */
  text: string;
  /** Their language, when the phone knows it; otherwise X-App-Language, then the profile's. */
  lang?: string;
  /** "ios" or "android". Optional: the server screen sends it; without it the User-Agent decides, iOS when unsure. */
  platform?: "ios" | "android";
}

export interface AssistantAskResponse {
  /** One line to show (and say): the answer, the hand-off's line, or a question back. */
  say: string;
  /** A hand-off to open, already checked: a link on the list in the `open` agent event above, tel:, sms: or upi://pay?.. */
  open?: { url: string; label: string; fallback?: string };
  /** Something waits for their yes: the task to show on the confirm sheet. */
  taskId?: string;
  /** How the run ended (see RunReceipt). Always sent by a server with the run
   *  ledger; optional so an answer from an older one still reads. */
  receipt?: RunReceipt;
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
  /**
   * The period line with "{price}" where the store's own monthly price goes ("{price} / mo, billed yearly"). A phone
   * shows it once the store answers (app billing/storePrice.ts); `period` stays the words until then, and everywhere else.
   */
  periodTemplate?: string;
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
  /** The meeting's to-dos, found once its transcript is final (tulmi/src/notes/extract.ts); ticked off in the app. */
  todos?: NoteTodo[];
  /** What was decided, each in a line. */
  decisions?: string[];
  /**
   * When the to-dos and decisions were looked for, and for which transcript (a hash): the same transcript is never
   * read twice. `ok` false: the look failed and may be tried again later.
   */
  found?: { hash: string; at: string; ok: boolean };
}

/** One to-do from a meeting: what, who (a speaker label or a name), when if it was said, and whether it is done. */
export interface NoteTodo {
  /** Stable within its note ("t1", "t2"…). */
  id: string;
  text: string;
  /** A speaker label ("You", "Speaker 2"; Note.people names them) or a name said in the meeting. Absent when nobody was given it. */
  who?: string;
  /** When, as it was said ("by Friday", "kal tak"). */
  when?: string;
  done: boolean;
  /** ISO-8601, when it was ticked off. */
  doneAt?: string;
}

/** A note as a list shows it, with its to-dos counted. */
export type NoteSummary = Pick<Note, "id" | "status" | "startedAt" | "endedAt" | "durationSeconds" | "words" | "title" | "summary" | "people" | "organised" | "systemAudio"> & {
  /** To-dos found, and how many are still open; decisions found. Absent before the meeting was looked at. */
  todos?: number;
  openTodos?: number;
  decisions?: number;
};


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
