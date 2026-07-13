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
  /** Cleanup model that produced the output, e.g. "anthropic/claude-haiku-4.5". */
  model: string;
}

/** Aggregated usage for the stats screen (this month + all-time). */
export interface UsageSummary {
  month: { words: number; audioSeconds: number; requests: number };
  total: { words: number; audioSeconds: number; requests: number };
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
  /** Personal dictionary: names, brands, jargon to spell exactly (one per line
   * or comma-separated). Biases speech-to-text and cleanup so the right
   * spellings come out. */
  vocabulary?: string;
  /** Text-expansion shortcuts, one per line as "trigger = expansion". The
   * cleanup step expands each trigger into its full text. */
  snippets?: string;

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
   * swap its emoji, adjust its tagline / description / promptStyle
   * without changing the shipped preset list.
   *
   * Undefined / missing key → the built-in preset shows through as-is.
   */
  presetOverrides?: Record<string, {
    name?: string;
    emoji?: string;
    tagline?: string;
    description?: string;
    defaultTone?: string;
    promptStyle?: string;
  }>;

  /**
   * Transient flag set by resolvePersonality when the effective tone is
   * "none" — signals downstream cleanup/refine composers to skip the LLM
   * step and pass the raw transcript through unchanged. Never persisted;
   * lives only on the in-request resolved copy of the profile.
   */
  passThrough?: boolean;
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
  | { kind: "bulletpoints" }
  | { kind: "emojiOff" }
  | { kind: "emojiOn" };

/** Options that shape a request (shared by voice, typing, and screen modes). */
export interface CleanupOptions {
  /** App the user is typing into; drives tone + formatting. Default "Generic". */
  targetApp?: TargetAppHint;
  /** Language hint. Default "auto". */
  language?: LanguageHint;
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
  };
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
  /** The raw STT output, before cleanup (useful for debugging/QA). */
  transcript: string;
  usage: UsageRecord;
}

// ---------------------------------------------------------------------------
// WebSocket: live streaming  (wss://host/v1/stream)
// ---------------------------------------------------------------------------
//
// Sequence:
//   1. client → { type: "start", ... }
//   2. client → binary audio frames (raw bytes of the chosen format)
//   3. client → { type: "end" }
//   4. server → "transcript" (once), then "cleaned_delta" (many), then "done"
//   Any time → server may send "error".

export const WS_PATH = "/v1/stream";

/** Control messages the client sends (JSON). Audio itself is sent as binary frames. */
export type ClientMessage =
  | ({
      type: "start";
      format: AudioFormat;
      /** Sample rate of the audio being streamed, e.g. 16000. */
      sampleRate: number;
    } & CleanupOptions)
  | { type: "end" };

/** Messages the server sends back (JSON). */
export type ServerMessage =
  | { type: "ready" } // server accepted "start", client may begin sending audio
  | { type: "transcript"; text: string } // raw STT result
  | { type: "cleaned_delta"; text: string } // incremental cleaned tokens
  | { type: "done"; cleanedText: string; usage: UsageRecord }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "unauthorized"
  | "quota_exceeded"
  | "bad_request"
  | "audio_too_long"
  | "stt_failed"
  | "cleanup_failed"
  | "internal";

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
// REST: voice preview  (POST /v1/voice/preview)
// ---------------------------------------------------------------------------
//
// Play a short sample so the user can hear what a voice sounds like BEFORE
// they pick it in Settings. Same shape/output as /v1/speak (binary audio) —
// text and instructions default sensibly when omitted so the caller can just
// pass { voice: "nova" } and get a preview.

export interface VoicePreviewRequest {
  /** Voice name to preview. Defaults to the server's TTS_VOICE. */
  voice?: string;
  /** Text to speak. Defaults to a short English sample. */
  text?: string;
  /** Style steer. Defaults to a derivation from the user's personality. */
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
  badge?: string;                   // "Save 40%", "Best value", "3-day trial"
  accent?: string;                  // hex — overrides theme primary on select
  default?: boolean;                // pre-selected when the screen opens
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
// REST: auto-learn vocabulary  (POST /v1/personality/vocabulary/learn)
// ---------------------------------------------------------------------------
//
// The keyboard/app calls this when it detects the user has corrected an
// output (deleted a produced word/phrase and typed a different spelling for
// the same term). The server appends the corrected "to" spelling to the
// personal vocabulary so future STT + cleanup runs bias toward it.
//
// Body is a small array of corrections. Anything over a per-request cap is
// rejected — this is a helper, not an import path.

export interface VocabularyCorrection {
  /** What the cleaner produced (or the wrong spelling to REPLACE from). */
  from: string;
  /** What the user meant (the CORRECT spelling to LEARN). */
  to: string;
}

export interface LearnVocabularyRequest {
  corrections: VocabularyCorrection[];
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
// REST: privacy audit  (GET /v1/privacy/audit)
// ---------------------------------------------------------------------------
//
// The "receipts" endpoint — feeds the in-app Privacy screen so a user can see
// exactly what happened with their data over a window. Nothing new is stored;
// this is a projection of the existing metering.

export interface PrivacyAuditWindow {
  /** ISO window label ("last24h", "last7d", "last30d", "allTime"). */
  window: string;
  /** Total number of requests we processed for this user in this window. */
  requests: number;
  /** Seconds of audio processed. Deleted after transcription (retentionSeconds=0). */
  audioSeconds: number;
  /** Word count of cleaned output shown to the user. */
  words: number;
}

export interface PrivacyAuditResponse {
  /** Per-window usage counts. */
  windows: PrivacyAuditWindow[];
  /** True if long-term audio retention is on for this account. Default false. */
  audioRetained: boolean;
  /** True if the backend uses the user's runs to improve their style. */
  learningFromRuns: boolean;
  /** SaaS providers your text/audio has been sent to in this window. */
  upstreamProviders: string[];
  /**
   * Freeform links the app renders as chips ("Read policy", "Delete my data").
   */
  links: Array<{ label: string; url: string }>;
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
  /** ISO-8601 timestamp of when the row was created. */
  createdAt: string;
}

/** GET /v1/history response. */
export interface HistoryListResponse {
  entries: HistoryEntry[];
  /**
   * ISO-8601 cursor for the next page — pass back as `?before=` on the next
   * request to fetch older entries. Absent when there are no more rows.
   */
  nextBefore?: string;
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
}
