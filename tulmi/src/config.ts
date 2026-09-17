/**
 * Centralised, validated configuration. Everything secret comes from env vars
 * (see ../../.env.example). Nothing is hardcoded.
 *
 * We load .env from the tulmi/ folder first, then fall back to the repo root,
 * so either location works.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendEnv = resolve(__dirname, "..", ".env");
const rootEnv = resolve(__dirname, "..", "..", ".env");

/**
 * A TEST RUN NEVER READS THE DEPLOYMENT'S .env.
 *
 * Every test file declares the handful of variables it needs and assumes
 * nothing else is set. That assumption held only because the machines we ran
 * on happened to have no .env beside the source. On the server, which does,
 * the same suite read the live configuration and 56 tests failed — not
 * because anything was broken, but because they were answering a different
 * question than the one they were written to ask.
 *
 * Two of those were worth more than a red line. The stores fall back to an
 * in-memory map when Supabase is disabled, and that map is what the store
 * tests are written against; a real SUPABASE_SERVICE_KEY in the environment
 * silently swapped it for the production database, so `npm test` began
 * writing rows to it. It was caught by the foreign key — the ids in the
 * tests are not UUIDs — which is luck, not a design. And the entitlement
 * tests upsert against a table that grants paid access.
 *
 * So the file is skipped under the runner rather than documented around. A
 * test asks about the code; if it can also read the deployment, it is asking
 * about the deployment too, and the answer stops meaning anything.
 */
export function envFileToLoad(where: {
  underTest: boolean;
  backendEnv?: boolean;
  rootEnv?: boolean;
}): "backend" | "root" | "default" | "none" {
  if (where.underTest) return "none";
  if (where.backendEnv) return "backend";
  if (where.rootEnv) return "root";
  return "default";
}

const source = envFileToLoad({
  underTest: !!process.env.VITEST,
  backendEnv: existsSync(backendEnv),
  rootEnv: existsSync(rootEnv),
});

if (source === "backend") loadEnv({ path: backendEnv });
else if (source === "root") loadEnv({ path: rootEnv });
else if (source === "default") loadEnv(); // process env / default lookup
// "none" — under the runner. process.env as the test file left it.

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : v.toLowerCase() === "true"));

const EnvSchema = z.object({
  // --- Speech-to-text provider ---
  // "groq" (default) runs whisper-large-v3-turbo — fast, cheap, and returns
  // per-segment confidence (no_speech_prob / avg_logprob) that we use to drop
  // hallucinated segments, which is why it's the deployed default. "openai"
  // (gpt-4o-transcribe) is an alternative with strong ~100-language coverage
  // but no per-segment confidence signal.
  // "auto" (recommended when SARVAM_API_KEY is set) runs the Indic specialist
  // and the global generalist CONCURRENTLY and keeps the better transcript —
  // Sarvam when the speech is Indic or code-mixed, Whisper otherwise. That's
  // how we serve a worldwide audience without ever asking the user what
  // language they're about to speak (you can't route by language before you
  // know it). Costs two STT calls; latency is the slower of the two, not the
  // sum. Pin a single provider to trade quality for that cost.
  //
  // "sarvam" (Saarika) alone is India-first: purpose-built for Indian
  // languages and code-mixed speech, auto-detecting the language itself
  // (language_code=unknown). Falls back to Whisper if a call fails.
  STT_PROVIDER: z.enum(["openai", "groq", "sarvam", "auto"]).default("groq"),

  // Sarvam (used when STT_PROVIDER=sarvam).
  SARVAM_API_KEY: z.string().optional(),
  SARVAM_API_URL: z.string().default("https://api.sarvam.ai"),
  // saaras:v3 is Sarvam's current model and what /speech-to-text defaults to;
  // saarika:v1/v2/flash are deprecated and saarika:v2.5 is legacy and on its
  // way out. v3 also carries the mode parameter below.
  SARVAM_STT_MODEL: z.string().default("saaras:v3"),
  // What v3 should DO with the audio. "transcribe" keeps the user's own
  // language — never leave this unset, or a translating default turns Marathi
  // into English. "codemix" is worth A/B-ing for Hinglish.
  SARVAM_STT_MODE: z.enum(["transcribe", "codemix", "translit", "verbatim"]).default("transcribe"),
  // Sarvam's STREAMING endpoint (live dictation). Separate from the REST URL
  // above; override if their WS path changes.
  SARVAM_WS_URL: z.string().default("wss://api.sarvam.ai/speech-to-text/ws"),

  // Which engine backs LIVE dictation (/v1/transcribe-stream). Server-side, so
  // switching is a VPS config change and never an app update: the phone's wire
  // protocol is identical either way.
  //
  // THIS DECIDES THE LIVE PARTIALS, not the final text. Deepgram, because it
  // is the only one of the two that covers the whole world: Sarvam is built
  // for 22 Indian languages plus English and has no French, Spanish, German,
  // Japanese or Arabic at all. Making it primary would have fixed Hindi by
  // breaking every language it does not speak.
  //
  // The Indic fix lives in STT_LIVE_DUAL below instead, which is the same
  // answer the one-shot path already reached: run both, decide afterwards.
  // WHICH ENGINE LEADS IS NO LONGER DECIDED HERE. This names who streams the
  // partials the user watches while talking; which reading is KEPT is decided
  // by the text, on script where there is one and on the words where there is
  // not (see leadsOnScript and readsAsRomanHindi). Romanized Hinglish used to
  // be the exception that rode on this value, which made recognition quality
  // depend on a guess about traffic — and a guess is wrong for everybody on
  // the other side of it.
  //
  // So this is a latency and cost choice, not a quality one. Leave it unless
  // you have a reason about the partials specifically.
  STT_LIVE_PROVIDER: z.enum(["deepgram", "sarvam"]).default("deepgram"),

  // Run BOTH live engines: the one named above streams to the user, the other
  // listens silently, and the two transcripts are reconciled at stop.
  //
  // ON BY DEFAULT, because off is what made the keyboard mic worse than the
  // in-app mic on Indian languages. The in-app mic posts a clip to
  // /v1/transcribe-clean, where STT_PROVIDER=auto already runs both engines and
  // keeps the Indic reading. The keyboard mic streams, and streaming ran one
  // engine — Deepgram, the weaker of the two exactly where the flagship
  // language lives. Same speaker, same sentence, worse transcript, purely for
  // reaching for the keyboard instead of the app.
  //
  // Costs two live STT streams for the same audio. STT is cents-per-hour and
  // far cheaper than the LLM call that follows it; set false to halve it and
  // accept one engine's blind spots. Without SARVAM_API_KEY there is no second
  // engine to open and this is a no-op.
  // bool(), not z.coerce.boolean(): coerce runs Boolean("false"), which is
  // TRUE. Every other flag in this file already uses the helper; these two did
  // not, so STT_LIVE_DUAL=false in a .env was silently ignored — and with the
  // default now true, that would have been an operator unable to turn off the
  // second stream they are paying for.
  STT_LIVE_DUAL: bool(true),

  /**
   * How many ordinary refines pass before the portrait is rewritten from them.
   *
   * The portrait used to move only on deliberate training, which most people
   * do a handful of times and then never again — so it froze at whatever six
   * taps had taught it while months of real evidence went past unread.
   *
   * Twelve is a working default, not a measured one: often enough that a new
   * user is recognised within a session or two, rare enough that the roll-up
   * costs one extra LLM call per dozen refines and never lands on the user's
   * path. Set to 0 to turn the whole thing off and learn only from training.
   */
  /**
   * Silence that ends a sitting, in minutes.
   *
   * The portrait is rewritten once per session, at the START of the next one:
   * the first refine after a gap this long reads back everything from the
   * session that just finished. No timers, no background jobs — the user
   * coming back IS the trigger.
   *
   * One consequence, stated because it is easy to be surprised by: the very
   * last session before someone stops using the app is not rolled up until
   * they return. Nothing is lost, it just waits.
   */
  PORTRAIT_SESSION_GAP_MINUTES: z.coerce.number().int().min(1).default(30),
  /** Backstop for a session that never ends — someone dictating all afternoon
   *  would otherwise never hit a gap. 0 disables ordinary-use learning. */
  PORTRAIT_LEARN_EVERY: z.coerce.number().int().min(0).default(12),
  /** How many recent messages the roll-up reads. Enough for a habit to repeat
   *  in, short enough that last month's mood does not outvote this week. */
  PORTRAIT_LEARN_WINDOW: z.coerce.number().int().min(6).max(200).default(40),

  // Add Deepgram's pre-recorded API as a THIRD candidate in STT_PROVIDER=auto.
  // Opt-in: a third opinion costs a third call (no extra latency — the legs run
  // in parallel) but its gain is smaller than Sarvam + Whisper together, and it
  // widens the failure surface. Turn on to A/B it.
  STT_AUTO_INCLUDE_DEEPGRAM: bool(false),

  // OpenAI STT (used when STT_PROVIDER=openai). gpt-4o-transcribe is the
  // current best; gpt-4o-mini-transcribe is cheaper; whisper-1 is the legacy.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-transcribe"),

  // Groq STT (used when STT_PROVIDER=groq).
  GROQ_API_KEY: z.string().optional(),
  GROQ_STT_MODEL: z.string().default("whisper-large-v3-turbo"),

  // Deepgram (used by the WS /v1/transcribe-stream route for live dictation —
  // not the one-shot /v1/transcribe-clean path, which uses STT_PROVIDER above).
  // Optional: without it the live route returns a "not configured" error and
  // the app's fallback REST transcribe still works.
  DEEPGRAM_API_KEY: z.string().optional(),
  // Live-STT model. Default nova-2 (general). Swap to a noise-tuned variant
  // (e.g. nova-2-meeting for far-field/multi-speaker rooms) via env without a
  // code change if real-world capture proves noisy.
  DEEPGRAM_STT_MODEL: z.string().default("nova-2"),
  // Live-STT language. Empty (the default) = "multi", Deepgram's multilingual
  // + code-switching mode, which is what we always want: the backend detects
  // the language, we never pin it from user input. Set a code here ONLY to
  // force one language for debugging or an A/B.
  DEEPGRAM_LANGUAGE: z.string().default(""),

  // OpenRouter (cleanup) — required to run the pipeline.
  // Model slug follows OpenRouter's naming: "<vendor>/<model>". Swap this via
  // env (CLEANUP_MODEL=...) without a code change. Current default is picked
  // for a good speed × quality × price balance for short cleanup / drafting.
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  CLEANUP_MODEL: z.string().default("openai/gpt-5.4-mini"),
  /**
   * Model for the style portrait, separate from the refiner's.
   *
   * The two jobs pull in opposite directions. Refining runs while the user
   * waits with their thumb still on the mic, many times a day, and wants the
   * fastest model that writes well. The portrait runs rarely, off the user's
   * path, and is read by every refine that follows — a worse portrait is a
   * worse keyboard for weeks, so it is worth a slower, stronger model.
   *
   * Defaults to CLEANUP_MODEL so nothing changes until it is set.
   */
  PORTRAIT_MODEL: z.string().default(""),
  OPENROUTER_APP_URL: z.string().default("https://tulmi.local"),
  OPENROUTER_APP_NAME: z.string().default("Tulmi"),

  // --- Text-to-speech (voice output: read-aloud / screen-clarify) ---
  // Uses OPENAI_API_KEY. gpt-4o-mini-tts is cheap, multilingual, and steerable.
  TTS_PROVIDER: z.enum(["openai"]).default("openai"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  TTS_VOICE: z.string().default("alloy"),
  TTS_FORMAT: z.enum(["mp3", "opus", "aac", "flac", "wav", "pcm"]).default("mp3"),

  // Supabase — optional when DEV_SKIP_AUTH is true.
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  // The project's JWT signing secret (Supabase dashboard → Settings → API → JWT
  // Secret), for HS256-signed tokens. Used ONLY to verify a user JWT LOCALLY
  // (no network) so the rate limiter can key its buckets on the verified user
  // id instead of the coarse client IP. Optional: when unset (and the project
  // isn't using asymmetric keys the JWKS path can fetch), the limiter falls
  // back to per-IP keying — no behavior regression, just less granular.
  SUPABASE_JWT_SECRET: z.string().optional(),

  // Server
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.string().optional(),

  // When true, auth + metering are skipped (local pipeline testing).
  DEV_SKIP_AUTH: bool(false),
  // Explicit escape hatch for running with auth off in production-shaped envs
  // (load tests, smoke checks). Off by default — see the boot-time refusal.
  DEV_SKIP_AUTH_ALLOW_PROD: bool(false),

  // Prompt versions to load from shared/prompts/. v3 (cleanup) / v2 (reply)
  // add the tone dial + per-app overrides + watermark. Roll back by exporting
  // CLEANUP_PROMPT_VERSION=v2 / REPLY_PROMPT_VERSION=v1 without a code change.
  // v6 scopes the language rule to LANGUAGES, not just scripts: v5's switching
  // sentence named romanized Hindi and Devanagari, so a sentence that opens in
  // English and finishes in Hindi matched no rule and came back translated.
  // v5 is still on disk — set this to v5 to compare the two against
  // scripts/quality.sh without a deploy.
  CLEANUP_PROMPT_VERSION: z.string().default("v6"),
  REPLY_PROMPT_VERSION: z.string().default("v3"),

  // Sentry (backend). Optional — the observability layer no-ops when unset,
  // so the value can safely stay empty in dev.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default("production"),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.05),

  // Rate limiting — abuse buckets are keyed per client IP (see the
  // keyGenerator in server.ts). Per-user fairness is enforced downstream by
  // metering/quota, not by this coarse limiter.
  RATE_LIMIT_MAX: z.coerce.number().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  // Admin secret used to authorize server-side operations reachable over HTTP
  // (currently just the cache-bump endpoint). Optional — when unset, the
  // admin endpoints refuse every request. Set to a long random string.
  ADMIN_SECRET: z.string().optional(),
  /**
   * Shared secret for RevenueCat's webhook.
   *
   * RevenueCat sends it as the Authorization header, verbatim, on every event.
   * Without it the endpoint refuses everything: an unauthenticated webhook
   * that grants entitlements is a free subscription for anyone who finds the
   * URL, so this fails closed rather than open.
   */
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  /**
   * The entitlement id(s) that mean "paid for Tailzu". Comma-separated.
   *
   * This is a FILTER, not just a default. A RevenueCat project can hold more
   * than one app and more than one product, and its webhook is configured per
   * project — so purchases of anything in it land on our endpoint. Only events
   * naming an id listed here grant access.
   *
   * Several products mapped to ONE entitlement (monthly, annual, lifetime)
   * need nothing here. Several paid TIERS do: "pro,unlimited".
   */
  REVENUECAT_ENTITLEMENT: z.string().default("pro"),
  /**
   * The RevenueCat web purchase link, for the desktop app.
   *
   * WHY THE DESKTOP NEEDS ONE AT ALL. RevenueCat has no desktop SDK, so the
   * window cannot call `iap.subscribe` the way the phones do — it rendered the
   * paywall with every row on it dead. A web purchase link is the way through,
   * and it is nearly free here because the identity already lines up: the
   * phones configure RevenueCat with `appUserID: <supabase user id>`, the
   * webhook resolves that same id back, and a web purchase for the same id
   * lands on the same customer and writes the same entitlements row. Nothing
   * about the webhook changes — it keys on the event type, the entitlement and
   * the user, and only RECORDS the store.
   *
   * So a user who paid on a phone is already entitled in the window, and one
   * who pays in the window is entitled on their phone.
   *
   * WHICH BILLING ENGINE IS BEHIND IT IS A DASHBOARD CHOICE, NOT A CODE ONE.
   * RevenueCat backs these links with its own billing, with Stripe, or with
   * Paddle, and nothing on this side can tell the difference — the link is a
   * link, the webhook is the same webhook, and `store` is recorded rather than
   * branched on. That matters because Paddle is the MERCHANT OF RECORD: it
   * registers, collects and remits sales tax worldwide, which Stripe does not.
   * Swapping to it later is a new link in this variable.
   *
   * WHERE THE USER ID GOES IS PART OF THE LINK. The shapes differ — a hosted
   * paywall link takes a trailing path segment, a Web Purchase Link takes an
   * `app_user_id` query parameter — and guessing wrong is the failure that
   * looks like success: the card is charged and the webhook arrives with no id
   * to attach it to. Put `{app_user_id}` where it belongs, e.g.
   * `https://pay.rev.cat/xxxx/{app_user_id}`; with no placeholder the desktop
   * appends `?app_user_id=…`, which is what a Web Purchase Link expects.
   *
   * This is a PUBLIC link, not a credential — it is opened in the user's
   * browser and is safe in a flag. The secret key is the other value below and
   * must never leave the server.
   *
   * Unset means no web purchase path: the desktop is told so and is never
   * blocked by a paywall it has no way to pass.
   */
  REVENUECAT_WEB_PAYWALL_URL: z.string().url().optional(),
  /**
   * RevenueCat REST secret key (sk_…), for asking about a user directly.
   *
   * Optional, and a different direction from the webhook: the webhook is
   * RevenueCat telling us, this is us asking. It exists because webhooks get
   * missed — a delivery fails, the server is restarting, an event is dropped —
   * and a missed one leaves a paying customer metered as free with nothing to
   * notice it. With this set the server can check for itself and heal.
   */
  REVENUECAT_API_KEY: z.string().optional(),
  // The PUBLIC SDK keys the apps configure RevenueCat with. Not secrets: they
  // ship inside every binary and sit in the update manifest in plain text.
  //
  // They are here because the app can no longer be trusted to keep its own
  // copy. app.config.ts bakes them from the build environment, and that config
  // is re-evaluated on every `eas update` — so an update published from a
  // machine without them set replaces two working keys with two empty strings,
  // and purchases stop in a build that was made correctly.
  REVENUECAT_IOS_KEY: z.string().optional(),
  REVENUECAT_ANDROID_KEY: z.string().optional(),
  /**
   * Whether a SANDBOX purchase grants access. True while you are testing.
   *
   * RevenueCat marks TestFlight, Xcode and Play internal-track purchases as
   * sandbox, and they cost nothing. Before launch that is exactly what you
   * want — it is the only way to test the paid path. After launch it is a free
   * subscription for anyone on a test build, so set this to false.
   *
   * Sandbox GRANTS are logged loudly for that reason. Revokes always apply:
   * the sandbox setting must never be able to keep access alive.
   */
  REVENUECAT_ALLOW_SANDBOX: bool(true),

  // --- App review ---------------------------------------------------------
  /**
   * The email address App Review and Play Review sign in with.
   *
   * Both stores need an account that reaches the whole app, and neither
   * reviewer can receive an OTP at an address they do not own or complete a
   * Sign in with Apple flow on a shared test device. So this one address takes
   * a PASSWORD instead of a code: the app shows a password field only when the
   * typed email matches this, and signs in against Supabase normally.
   *
   * Unset = the path does not exist. Set it for the submission, clear it after
   * — that is a container restart, not a release, which is the point of it
   * living here rather than in the binary.
   */
  REVIEW_EMAIL: z.string().optional(),
  /**
   * The code that address signs in with.
   *
   * A fixed pair, held here, that passes auth: type the email, type this, you
   * are in. It exists because sign-in is one-time codes and a reviewer cannot
   * open our inbox — Supabase offers fixed test codes for phone numbers and has
   * no equivalent for email, so the pair has to live on our side.
   *
   * BOTH must be set for the path to exist. Either one alone is nothing, so a
   * half-finished configuration cannot leave a door ajar.
   *
   * Not a password: it never reaches Supabase's password field. The server
   * checks it, and on a match mints a one-time link for that account — the same
   * kind of link the emailed code redeems. The session that comes back is an
   * ordinary session, indistinguishable from any other user's.
   *
   * SIX DIGITS. Not a choice — the code screen strips non-digits and truncates
   * to six, because it is the same screen every user types an emailed code
   * into. Anything longer, or with a letter in it, silently becomes something
   * else on the way in and simply never matches.
   *
   * So this is one secret in a million, behind an address every client is told.
   * What makes that survivable is the route's own rate limit — eight attempts a
   * quarter-hour, far below the app's — and the fact that the pair is set for a
   * submission and cleared when review passes. Clearing it is a container
   * restart, not a release. Do it.
   */
  REVIEW_CODE: z.string().optional(),
  /**
   * Accounts that skip everything between launch and the app.
   *
   * A reviewer has three minutes and a checklist. Sending them through an
   * intro, a language pick, a permission primer and a keyboard-enable
   * walkthrough is how a submission comes back as "we could not locate the
   * described functionality". Comma-separated Supabase user ids: these land on
   * home, are treated as entitled so no paywall appears, and are never shown
   * the arrival prompt.
   *
   * Ids, not the email, because the email is what they TYPE and the id is what
   * the token PROVES — and the whole point is that this cannot be claimed by
   * anyone who merely knows the address.
   */
  REVIEW_USER_IDS: z.string().default(""),

  // Static bearer tokens for non-Supabase clients (the desktop app). A
  // comma-separated list of LONG random secrets; a request whose Authorization
  // bearer matches one (timing-safe) is authenticated as a stable synthetic
  // user derived from the token — no Supabase round-trip, no JWT expiry (a
  // Supabase access token dies in ~1h, which would break a config-file client
  // hourly). Mint with `openssl rand -hex 32`. Unset → feature off.
  STATIC_BEARER_TOKENS: z.string().optional(),

  // Input length caps — refuse any request whose text field exceeds this many
  // characters, so a runaway client can't burn LLM budget on huge inputs. 10k
  // chars ≈ 2500 tokens ≈ a healthy 2-minute dictation.
  MAX_TEXT_LENGTH: z.coerce.number().default(10_000),

  // Free-tier ceiling per calendar month. When set (positive number), any
  // signed-in user who exceeds it is refused with `quota_exceeded` BEFORE the
  // paid upstream call is made. Unset / 0 = no ceiling.
  /**
   * The free tier is measured in WORDS REFINED — the words Tailzu writes for
   * you, which is the thing the product actually does and the thing that costs
   * money to produce. Not minutes spoken: a user who dictates slowly is not
   * costing more than one who dictates fast, and metering them differently
   * would be arbitrary from their side.
   *
   * 0 disables a cap. Audio is left at 0 on purpose — one meter is legible,
   * two is a thing users have to reason about.
   */
  FREE_MONTHLY_AUDIO_SECONDS: z.coerce.number().default(0),
  FREE_MONTHLY_WORDS: z.coerce.number().default(800),

  // --- Earned words -------------------------------------------------------
  // The free plan grows when it is used. See src/usage/allowance.ts for why
  // frequency is rewarded and volume is not; these are the dials.
  //
  // Scaled to the base. With 800 free and 5,000 earnable, the earned half was
  // six times the plan — the number the user was given would have been a
  // rounding error beside the number they won, and "free words" would have
  // stopped meaning anything. 1,600 keeps earning worth chasing (it can triple
  // the allowance) while leaving the plan itself the larger fact. The cap is
  // the only place this maths is bounded, since a day's amount is a roll
  // rather than a rate.
  // A day's grant is no longer a formula, so there is no per-day amount to
  // configure. It is a roll across four tiers, in src/usage/allowance.ts, where
  // the tiers sit next to the reasoning for their spacing — a value that has to
  // be read together with its odds does not belong in an env var.
  /** Dictations in one day that count as a day of real use. */
  EARN_BURST_SESSIONS: z.coerce.number().default(5),
  /** Words for reaching that. */
  EARN_BURST_WORDS: z.coerce.number().default(150),
  /** Most that can be earned in one month. 0 turns earning off entirely. */
  EARN_MAX_WORDS: z.coerce.number().default(1700),
});

/**
 * Everything the server reads out of the environment, in one list.
 *
 * Skipping tulmi/.env under the runner was half a fix. A variable can also be
 * EXPORTED into the shell — which is how the server's own ADMIN_SECRET reached
 * a test that exists to check the branch where it is absent, and turned a 503
 * into a 401. dotenv never touched it; the process simply inherited it.
 *
 * So the test setup clears this list instead of trusting a shell to be empty.
 * The names read straight from process.env elsewhere in src/ are included:
 * they are read the same way and contaminate the same way, and INTRO_PLAY_WHEN
 * on the server is what opened an onboarded user on the intro.
 *
 * NODE_ENV is in here, via the schema, and belongs here: an exported
 * NODE_ENV=production made the DEV_SKIP_AUTH guard throw ahead of the
 * assertion a test was making. The setup clears it with the rest and then
 * pins it back to "test", so the order does the work, not an exemption.
 */
export const ENV_KEYS: readonly string[] = [
  ...Object.keys(EnvSchema.shape),
  "ANDROID_SIGNING_SHA256",
  "APP_STORE_ID",
  "AUTH_ENABLE_PHONE",
  "DOWNLOADS_DIR",
  "FLOW_ARM_DISMISS_MS",
  "FLOW_END_HOLD_MS",
  "FLOW_TRANSPORT",
  "HISTORY_COALESCE_MS",
  "HISTORY_DEFAULT_ON",
  "INTRO_BUILT_IN",
  "INTRO_FIT",
  "INTRO_PLAY_MS",
  "INTRO_PLAY_WHEN",
  "INTRO_SHAPE",
  "INTRO_VIDEO_MAX_MS",
  "KB_ROLLOUTS",
  "LLM_REASONING_EFFORT",
  "LOG_LEVEL",
  "MEDIA_DIR",
  "MEDIA_PUBLIC_URL",
  "PUBLIC_ORIGIN",
  "TULMI_SHARED_DIR",
  "WEBP_MAX_SECONDS",
].filter((k, i, all) => all.indexOf(k) === i);

export type AppConfig = z.infer<typeof EnvSchema> & {
  /** True if Supabase is fully configured for metering (needs the service key). */
  supabaseEnabled: boolean;
  /**
   * True if we can verify user JWTs — needs the URL plus EITHER the service key
   * OR the public anon key (verifying a token only calls /auth/v1/user, which
   * the anon key is allowed to do). So real auth works without the secret key.
   */
  authEnabled: boolean;
};

let cached: AppConfig | null = null;

/**
 * Drop the cache so the next getConfig() re-reads the environment.
 *
 * For tests, and named so nobody mistakes it for a runtime feature: config is
 * parsed once at boot on purpose, and a server that re-read its environment
 * mid-flight would be a server whose behaviour changed without a deploy.
 *
 * It earns its place by letting the review-pair tests prove the door is SHUT in
 * every configuration — no email, no code, one but not the other — and those are
 * exactly the cases that cannot be checked without changing the environment
 * between them.
 */
export function resetConfigForTests(): void {
  cached = null;
}

export function getConfig(): AppConfig {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid/missing environment variables:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in your keys.`,
    );
  }

  const env = parsed.data;

  /**
   * A SECRET WITH A `$` IN IT IS A SECRET DOCKER COMPOSE HAS ALREADY EATEN.
   *
   * Compose interpolates `$NAME` inside `env_file` values. A shared secret
   * containing one therefore reaches the process with that chunk REPLACED —
   * usually by nothing, since the variable is rarely set — and the only sign
   * is a line on startup that scrolls past:
   *
   *   WARN The "V_LTBATS" variable is not set. Defaulting to a blank string.
   *
   * What it produces is the worst kind of broken. The service starts, every
   * screen works, and the only thing that fails is the one path nobody
   * exercises until it matters: RevenueCat sends the secret as written, the
   * process compares it against the mangled copy, answers 401, and a customer
   * who has just been charged is never granted anything.
   *
   * Warned rather than thrown, because a running service is worth more than a
   * strict one and the affected path may not be in use yet. Both values are
   * checked: the same trap catches the admin secret.
   */
  for (const [name, value] of [
    ["REVENUECAT_WEBHOOK_SECRET", env.REVENUECAT_WEBHOOK_SECRET],
    ["ADMIN_SECRET", env.ADMIN_SECRET],
  ] as const) {
    if (typeof value === "string" && value.includes("$")) {
      console.warn(
        `[config] ${name} contains a "$". Docker Compose interpolates those in ` +
          `env_file values, so the running process may be holding a DIFFERENT ` +
          `secret than the file does — and the sender would get 401 with no ` +
          `other symptom. Use a secret with no "$" in it.`,
      );
    }
  }

  // The selected STT provider must have its key.
  if (env.STT_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    throw new Error(
      "STT_PROVIDER=openai but OPENAI_API_KEY is missing. Add OPENAI_API_KEY, " +
        "or set STT_PROVIDER=groq and add GROQ_API_KEY.",
    );
  }
  if (env.STT_PROVIDER === "groq" && !env.GROQ_API_KEY) {
    throw new Error(
      "STT_PROVIDER=groq but GROQ_API_KEY is missing. Add GROQ_API_KEY, " +
        "or set STT_PROVIDER=openai and add OPENAI_API_KEY.",
    );
  }

  const supabaseEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
  const authEnabled = Boolean(
    env.SUPABASE_URL && (env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY),
  );

  if (!authEnabled && !env.DEV_SKIP_AUTH) {
    throw new Error(
      "Supabase auth is not configured but DEV_SKIP_AUTH is false. " +
        "Set SUPABASE_URL + SUPABASE_ANON_KEY (or SUPABASE_SERVICE_KEY), " +
        "or set DEV_SKIP_AUTH=true for local testing.",
    );
  }

  // Hard refuse to boot with auth disabled UNLESS this is explicitly a dev/test
  // environment. A forgotten DEV_SKIP_AUTH=true is the single largest
  // cost-amplification footgun (unauthenticated requests spend OpenAI/OpenRouter
  // budget). We treat anything that isn't an affirmative "development"/"test" as
  // production — so a typo'd or unset NODE_ENV ("prod", "PRODUCTION", "") fails
  // safe rather than booting wide open.
  const nodeEnv = (env.NODE_ENV ?? "").toLowerCase();
  const isDevOrTest = nodeEnv === "development" || nodeEnv === "test";
  if (env.DEV_SKIP_AUTH && !isDevOrTest && !env.DEV_SKIP_AUTH_ALLOW_PROD) {
    throw new Error(
      "DEV_SKIP_AUTH=true is not allowed when NODE_ENV=production. " +
        "Configure Supabase (SUPABASE_URL + SUPABASE_ANON_KEY) and remove " +
        "DEV_SKIP_AUTH before deploying. To override for a controlled load " +
        "test, set DEV_SKIP_AUTH_ALLOW_PROD=true (NOT recommended).",
    );
  }

  cached = { ...env, supabaseEnabled, authEnabled };
  return cached;
}

export const VERSION = "0.1.0";
