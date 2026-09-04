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

if (existsSync(backendEnv)) loadEnv({ path: backendEnv });
else if (existsSync(rootEnv)) loadEnv({ path: rootEnv });
else loadEnv(); // fall back to process env / default lookup

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
  // protocol is identical either way. "sarvam" needs SARVAM_API_KEY and is the
  // choice for Indian-language live dictation, where Deepgram is weakest;
  // anything else falls back to Deepgram.
  STT_LIVE_PROVIDER: z.enum(["deepgram", "sarvam"]).default("deepgram"),

  // Run BOTH live engines: the one named above streams to the user, the other
  // listens silently, and the two transcripts are reconciled at stop (the same
  // fusion the one-shot path does, applied at the end of the stream). Each
  // engine has areas the other is weak in — Deepgram on English/European,
  // Sarvam on Indic and code-mixed — so the committed text can be better than
  // either alone. Costs two live STT streams for the same audio.
  STT_LIVE_DUAL: z.coerce.boolean().default(false),

  // Add Deepgram's pre-recorded API as a THIRD candidate in STT_PROVIDER=auto.
  // Opt-in: a third opinion costs a third call (no extra latency — the legs run
  // in parallel) but its gain is smaller than Sarvam + Whisper together, and it
  // widens the failure surface. Turn on to A/B it.
  STT_AUTO_INCLUDE_DEEPGRAM: z.coerce.boolean().default(false),

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
  CLEANUP_PROMPT_VERSION: z.string().default("v3"),
  REPLY_PROMPT_VERSION: z.string().default("v2"),

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
   * RevenueCat REST secret key (sk_…), for asking about a user directly.
   *
   * Optional, and a different direction from the webhook: the webhook is
   * RevenueCat telling us, this is us asking. It exists because webhooks get
   * missed — a delivery fails, the server is restarting, an event is dropped —
   * and a missed one leaves a paying customer metered as free with nothing to
   * notice it. With this set the server can check for itself and heal.
   */
  REVENUECAT_API_KEY: z.string().optional(),
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
  FREE_MONTHLY_WORDS: z.coerce.number().default(2500),

  // --- Earned words -------------------------------------------------------
  // The free plan grows when it is used. See src/usage/allowance.ts for why
  // frequency is rewarded and volume is not; these are the dials.
  //
  // Tuned so a casual user never notices a wall and a daily user reaches the
  // cap in about three weeks: 2,500 base, up to 5,000 earned. A 30-day streak
  // with a burst most days would earn ~11,000 if nothing capped it — the cap
  // is what keeps the free tier generous rather than free.
  /** Words for the first day of a streak. */
  EARN_STREAK_WORDS: z.coerce.number().default(100),
  /** Added per extra consecutive day: day 2 is worth 125, day 3 150, … */
  EARN_STREAK_STEP_WORDS: z.coerce.number().default(25),
  /** Ceiling on one day's streak grant, reached on day 9. */
  EARN_STREAK_MAX_WORDS: z.coerce.number().default(300),
  /** Dictations in one day that count as a day of real use. */
  EARN_BURST_SESSIONS: z.coerce.number().default(5),
  /** Words for reaching that. */
  EARN_BURST_WORDS: z.coerce.number().default(150),
  /** Most that can be earned in one month. 0 turns earning off entirely. */
  EARN_MAX_WORDS: z.coerce.number().default(5000),
});

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
