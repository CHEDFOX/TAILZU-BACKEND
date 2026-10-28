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

/**
 * Whether this is the Cloudflare jobs Worker (jobs/), not the VPS. On a Worker
 * there is no .env beside the source and no file system worth asking, and
 * `import.meta.url` may not be a file address, so none of the loading below is
 * done: the settings come from the Worker's own env (vars and secrets), which
 * jobs/src/env.ts copies into process.env before anything reads them.
 */
export function isWorkerRuntime(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers" || process.env.RUNTIME === "worker";
}

/** Where the .env files would be, or null when this module's own address is not a file (a bundle on a Worker). */
function envPaths(): { backendEnv: string; rootEnv: string } | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return { backendEnv: resolve(here, "..", ".env"), rootEnv: resolve(here, "..", "..", ".env") };
  } catch {
    return null;
  }
}

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

const paths = isWorkerRuntime() ? null : envPaths();
if (paths) {
  const source = envFileToLoad({
    underTest: !!process.env.VITEST,
    backendEnv: existsSync(paths.backendEnv),
    rootEnv: existsSync(paths.rootEnv),
  });

  if (source === "backend") loadEnv({ path: paths.backendEnv });
  else if (source === "root") loadEnv({ path: paths.rootEnv });
  else if (source === "default") loadEnv(); // process env / default lookup
  // "none" — under the runner. process.env as the test file left it.
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null ? def : v.toLowerCase() === "true"));

/** ASK_SITE as the site reads it: "soon" or "live", and "off" for anything else. */
export function askSite(v: unknown): "off" | "soon" | "live" {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "soon" || s === "live" ? s : "off";
}

/** One OAuth client registered with a vendor in advance (CONNECTOR_OAUTH_CLIENTS). */
export interface ConnectorOAuthClient { client_id: string; client_secret?: string; issuer: string }

const OAuthClientSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  issuer: z.string().url().refine((u) => u.startsWith("https://"), "https only"),
});

/**
 * CONNECTOR_OAUTH_CLIENTS, read. Bad JSON is ignored whole and an entry that
 * is not {client_id, client_secret?, issuer} is ignored alone, each with a
 * warning that names the id and never the value (it holds a secret).
 */
export function connectorOAuthClients(raw: string | undefined, warn: (line: string) => void = (l) => console.warn(l)): Record<string, ConnectorOAuthClient> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warn("[config] CONNECTOR_OAUTH_CLIENTS is not a JSON object of {id: {client_id, client_secret?, issuer}}: it is ignored, so no app has a pre-registered client.");
    return {};
  }
  const out: Record<string, ConnectorOAuthClient> = {};
  for (const [id, value] of Object.entries(parsed)) {
    const ok = OAuthClientSchema.safeParse(value);
    if (ok.success) out[id.trim().toLowerCase()] = ok.data;
    else warn(`[config] CONNECTOR_OAUTH_CLIENTS["${id.slice(0, 40)}"] needs client_id and an https issuer (client_secret is optional): that entry is ignored.`);
  }
  return out;
}

/** The reader's User-Agent when WEB_BOT_UA is not set (or is not a usable header value). */
export const DEFAULT_WEB_BOT_UA = "Mozilla/5.0 (compatible; TailzuBot/1.0; +https://tailzu.com/bot)";

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
  // "openai" streams through OpenAI's realtime transcription with
  // OPENAI_API_KEY, the same key the one-shot path uses (see OPENAI_LIVE_*).
  STT_LIVE_PROVIDER: z.enum(["deepgram", "sarvam", "openai"]).default("deepgram"),

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
   * Judge each transcript against the voice measured in its audio
   * (pipeline/speechPresence.ts, speechGate.ts): no voice, no text. Its
   * thresholds were tuned on generated audio; if real quiet speech is ever
   * lost to it, SPEECH_MEASURE=false in .env turns the measurement off at
   * once — the phrase lists and the second engine still guard — while the
   * thresholds are retuned.
   */
  SPEECH_MEASURE: bool(true),

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

  // OpenAI STT (used when STT_PROVIDER=openai). gpt-4o-mini-transcribe is the
  // efficient default; gpt-4o-transcribe is the most accurate, at about twice
  // the price; whisper-1 is the legacy.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  // Live dictation through OpenAI (STT_LIVE_PROVIDER=openai): the realtime
  // API in transcription mode. The mini model is the efficient one: about
  // half the price of gpt-4o-transcribe and faster to each word.
  OPENAI_LIVE_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_REALTIME_URL: z.string().default("wss://api.openai.com/v1/realtime?intent=transcription"),
  // The realtime API's message shapes: "ga" (current) or "beta" (the older
  // transcription_session.update, sent with the OpenAI-Beta header). Switch
  // only if OpenAI refuses the session with the other.
  OPENAI_REALTIME_PROTOCOL: z.enum(["ga", "beta"]).default("ga"),
  // How long a stopped live session waits for its last words before closing.
  OPENAI_LIVE_FLUSH_MS: z.coerce.number().default(4000),
  // The silence that ends a turn on OpenAI's live recognizer. Each turn is
  // transcribed on its own and comes back as a sentence, capital and full
  // stop included, so every breath longer than this became a full stop in
  // the middle of what they were saying. It was 500 ms; 800 lets a speaker
  // think mid-sentence. Its text only arrives when a turn ends, so a longer
  // one also means the live captions come in fewer, larger pieces.
  OPENAI_LIVE_SILENCE_MS: z.coerce.number().int().min(200).max(3000).default(800),

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
  /**
   * Model that organises a desktop note (src/notes/organise.ts). A note is
   * written once, after the meeting, and read for weeks, so it can afford a
   * stronger model than the refiner. Defaults to CLEANUP_MODEL.
   */
  NOTES_MODEL: z.string().default(""),
  /** Deepgram model for telling a note's speakers apart (src/notes/speakers.ts). */
  NOTES_DIARIZE_MODEL: z.string().default("nova-3"),
  /** OpenAI's model for the same, used when Deepgram is not configured or
   *  fails. Empty = do not use OpenAI for it. */
  NOTES_DIARIZE_OPENAI_MODEL: z.string().default("gpt-4o-transcribe-diarize"),
  /**
   * ASK, THE ON-SCREEN AGENT (POST /v1/agent, src/agent).
   *
   * The model plans one step at a time over a list of the front window's
   * elements, and someone is watching the guide wait for its first line, so
   * this is the fastest model that follows a line protocol, with reasoning
   * off. Measured on the first chunk, a non-reasoning model answers in under
   * a second where a thinking one took seven.
   *
   * The fallbacks are tried in order, then CLEANUP_MODEL, and only when a
   * call fails before it has written anything (an HTTP error or the timeout):
   * once a line has gone to the device the step belongs to that model.
   */
  AGENT_MODEL: z.string().default("openai/gpt-6-luna"),
  /** Comma-separated. */
  AGENT_FALLBACK_MODELS: z.string().default("anthropic/claude-haiku-5.5"),
  /** Per model call, the whole stream included. */
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(6000),
  /** Steps in one run, counted from 0. Past it a step is refused. */
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(50).default(8),
  /** Elements one step may send. The device stops its walk at the same number. */
  AGENT_MAX_ELEMENTS: z.coerce.number().int().min(10).max(1000).default(250),
  /**
   * The screen as it reaches the prompt (element lines plus window text), in
   * characters. 250 elements with their labels and values come to about 12k;
   * past twice that a client is sending something other than a window.
   */
  AGENT_SCREEN_MAX_CHARS: z.coerce.number().int().min(1000).default(24_000),
  /**
   * The picture path: a question about something drawn ("explain this
   * equation", "what does this chart show") comes with ONE picture of it, and
   * is answered by a model that can see, sentence by sentence as it writes.
   * Its own ladder, by the text path's rules: the fallbacks in order, then
   * CLEANUP_MODEL, each only when the one before failed before writing
   * anything, and no model twice. Every model on it must take an image.
   *
   * Chosen on speed, measured on the VPS with one picture question asked of
   * each model in turn (scripts/time-vision.ts asks it again): with latency
   * routing this one reached its first sentence in 2.1 s and never took more
   * than 2.4 s in 8 runs, about twice as fast as the fallback (4.6 s, 6.1 s
   * at worst), and drew more marks. One that reads pictures better took
   * 4.2 s, and 15 s at worst. It can turn its thinking off, so it starts
   * writing at once.
   */
  AGENT_VISION_MODEL: z.string().default("google/gemini-2.5-flash"),
  /** Comma-separated. */
  AGENT_VISION_FALLBACK_MODELS: z.string().default("anthropic/claude-haiku-5.5"),
  /**
   * Asked to go step by step, in detail, or to walk them through it: room
   * for a longer answer, tried first, with the ordinary vision ladder under
   * it. The same model as AGENT_VISION_MODEL, given more to write: a worked
   * answer is still read as it arrives, and a slower model would make its
   * first sentence wait.
   */
  AGENT_VISION_DEEP_MODEL: z.string().default("google/gemini-2.5-flash"),
  /**
   * OpenRouter's provider routing for picture questions: among the providers
   * serving the model, ask the one that sorts first. "latency" is the one
   * soonest to its first token, and measured it cut the primary's worst first
   * sentence from 4.6 s to 2.4 s, at no extra cost. "throughput" and "price"
   * are OpenRouter's other two; "" sends no preference, and OpenRouter
   * balances the load as it likes. Any other value is sent as no preference
   * too (llm.providerSortOf), since a field OpenRouter cannot read would be
   * refused on every picture question.
   */
  AGENT_VISION_PROVIDER_SORT: z.string().default("latency"),
  /**
   * Per vision call: to its first written character, and then between one
   * chunk and the next. Not the whole stream, as the text path's is: a
   * worked answer takes longer than this to write, and cutting it at a fixed
   * time would end it mid-step. A picture takes longer to read than a list,
   * so this is longer than AGENT_TIMEOUT_MS.
   */
  AGENT_VISION_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(9000),
  /** The one picture a step may carry, in bytes; above it is a 413. A
   *  1024-pixel JPEG of a window is 100–300 KB, so this is far past fair. */
  AGENT_IMAGE_MAX_BYTES: z.coerce.number().int().min(10_000).max(20_000_000).default(2_000_000),
  /**
   * Marks one step may draw on the screen (DRAW lines: a box, an arrow, a
   * numbered place). The model is asked for six at most; past this it is
   * scribbling, and the rest are dropped. 0 turns drawing off.
   */
  AGENT_DRAW_MAX: z.coerce.number().int().min(0).max(50).default(12),
  /**
   * Ask's own bucket, apart from the app's: a run is several requests a few
   * seconds apart, and it must never be the reason dictation gets a 429.
   */
  AGENT_RATE_LIMIT_MAX: z.coerce.number().default(60),
  AGENT_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  /**
   * A question to Ask spoken on the live stream (its start message says
   * purpose "ask"), in seconds of audio. The desktop stops listening for one
   * at desktop.agent.listenMaxMs, 15 s; past twice that it is not a question,
   * and the stream ends there with what it heard.
   */
  AGENT_STREAM_MAX_SECONDS: z.coerce.number().int().min(1).max(900).default(30),
  /**
   * The run ledger (src/runs, migration 0019): one row for every Ask run, on
   * the desktop and the phone, and one for every planner call in it, with
   * what OpenRouter charged. Phone follow-ups (a question back waiting for
   * its answer) are kept there too, so a restart or a second server does not
   * lose them. Off (the default) keeps all of it in this process's memory
   * instead, as the follow-ups were kept before; receipts are sent either
   * way. Turn it on only once 0019 is applied and the privacy policy that
   * says what the ledger keeps (sections 1.2, 4, 10.4 and 11.4) is the one
   * people are shown, on the published site as well as here (DEPLOY.md).
   */
  AGENT_RUN_LEDGER: bool(false),

  // --- Connected apps (src/connectors): Ask acts in the person's own apps ---
  /**
   * The whole feature. Off by default, and while it is off nothing changes:
   * Ask's planner gets exactly the prompt it always did and the /v1/connectors
   * and /v1/tasks routes answer "off". Turning it on also needs
   * CONNECTOR_TOKEN_KEY, migration 0017 and at least one id below.
   */
  CONNECTORS: bool(false),
  /**
   * Which catalog apps (src/connectors/catalog.ts) people may connect, comma
   * separated ("notion,linear"). Every catalog entry ships disabled because its
   * vendor endpoint has to be tried against the live service first; naming an
   * id here is the statement that this was done. An unknown id does nothing.
   */
  CONNECTORS_ENABLED_IDS: z.string().default(""),
  /**
   * Enabled apps shown only to testers (CONNECTORS_TESTERS) while their vendor
   * reviews them. Google asks that scopes it has not verified stay off
   * production traffic: anyone else tapping Connect would meet Google's
   * unverified-app screen and use up the 100-user allowance. So, while Google
   * reviews: google-calendar,google-tasks. Empty once approved: every enabled
   * app is then shown to everyone.
   */
  CONNECTORS_TESTER_ONLY_IDS: z.string().default(""),
  /** The sign-in emails that see those apps, comma-separated. */
  CONNECTORS_TESTERS: z.string().default(""),
  /**
   * 32 random bytes, base64 (openssl rand -base64 32). Encrypts every stored
   * token (AES-256-GCM) and signs the sign-in state. Without it the server
   * refuses to store a token, so connecting fails instead of saving a secret
   * in the clear. Changing it disconnects everyone: stored tokens no longer open.
   */
  CONNECTOR_TOKEN_KEY: z.string().optional(),
  /**
   * Where an app sends the person back after they sign in. Must be the address
   * of this server's GET /v1/connectors/callback, and must be reachable from
   * their browser; it is what is registered with each vendor.
   */
  CONNECTOR_REDIRECT_URL: z.string().default("https://api.tailzu.space/v1/connectors/callback"),
  /**
   * Tailzu's published identity for signing in to MCP apps (a client ID
   * metadata document, "CIMD"): the URL is itself the client id, and an auth
   * server that supports it reads who we are and where we may send people
   * back from the document there, instead of us registering a fresh client
   * with every app. This server serves that document at
   * /oauth/client-metadata.json, built from CONNECTOR_REDIRECT_URL, so the
   * default is right for production. A staging server needs its own URL (its
   * own host) or "" to switch it off: an auth server only sends people back to
   * a redirect the document lists, exactly.
   */
  CONNECTOR_CLIENT_METADATA_URL: z.string().default("https://api.tailzu.space/oauth/client-metadata.json"),
  /**
   * OAuth clients registered with a vendor in advance, for the apps that
   * offer no other way in (GitHub, Asana: catalog entries marked
   * preRegistered). JSON, by catalog id:
   *   {"github":{"client_id":"...","client_secret":"...","issuer":"https://github.com/login/oauth"}}
   * `issuer` is the auth server the client belongs to; the client is never
   * shown to any other. The secret lives here and nowhere else: never in the
   * catalog, a log or a reply. Bad JSON is warned about and ignored, so those
   * apps answer "not set up" instead of the server not starting.
   */
  CONNECTOR_OAUTH_CLIENTS: z.string().optional(),
  /**
   * Apps a person adds themselves, by pasting an MCP server's address
   * (POST /v1/connectors/custom, migration 0018). Off by default: they are
   * servers nobody here has read, so they get the strict sign-in, cleaned and
   * pinned tool lists and a yes for anything not plainly a read (see
   * src/connectors/hygiene.ts). Off means their rows are not read at all; on
   * needs CONNECTORS too. One switch for everyone for now, so it can later
   * become a paid-plan perk in one place (routes/connectorsCustom.ts). While
   * on, the server also keeps More apps, its copy of the official MCP
   * Registry, synced every 12 hours (connectors/registry.ts).
   */
  CUSTOM_CONNECTORS: bool(false),
  /** How many apps one person may add by link. */
  CUSTOM_CONNECTORS_MAX: z.coerce.number().int().min(0).max(100).default(10),
  /**
   * The Google apps in Connected apps (google-calendar, google-docs and the
   * rest) sign in with a WEB OAuth client in the same Google Cloud project the
   * Google sign-in already uses, so there is one consent screen to keep and
   * nothing new to verify as a company. A client of its own ("Tailzu Connected
   * apps") is best: the sign-in client's secret lives in Supabase's Google
   * provider, and resetting it there would break sign-in. This is that client's id. Google has no
   * dynamic client registration (unlike the MCP apps), so our own client is
   * the only way in. The client must list CONNECTOR_REDIRECT_URL as an
   * authorized redirect URI. Sign-in itself never asks for these scopes: they
   * are asked only when someone taps Connect on a Google app.
   */
  GOOGLE_CONNECT_CLIENT_ID: z.string().optional(),
  /**
   * That client's secret. Google's token endpoint wants it even with PKCE on a
   * web client. Server-side only: it is never sent to a device, a log or an
   * error message. Without both values the Google apps list but cannot connect.
   */
  GOOGLE_CONNECT_CLIENT_SECRET: z.string().optional(),
  /**
   * YouTube's search in Connected apps (the always-on "youtube" app,
   * connectors/google/youtube.ts) reads YouTube's public search results with
   * this key, so it asks nobody for a Google permission: an API key from the
   * same Google Cloud project, restricted to YouTube Data API v3 (and to this
   * server's address). Each search costs 100 of the project's 10,000 quota
   * units a day, shared by everyone, so about 100 searches a day until Google
   * raises it. Without it, or once the day's are spent, a search opens
   * YouTube's own search for the same words instead (the play hand-off), so
   * nothing breaks. Server-side only: never sent to a device, a log or a reply.
   */
  YOUTUBE_API_KEY: z.string().optional(),
  // --- Code bot (src/code): connect GitHub, add a project, work on a branch ---
  /**
   * The whole feature. Off by default, and while it is off every /v1/code/*
   * route answers 404 { code: "code_off" }. On, but with the GitHub App below
   * not set up, they answer 503 { code: "not_configured" }. Needs migration
   * 0020 and CONNECTOR_TOKEN_KEY (the sign-in state is signed with it).
   * Setup, with a ready-made App manifest, is in docs/github-app.md.
   */
  CODE_GITHUB: bool(false),
  /** The GitHub App's numeric id. Only the fallback for the client id below, as the JWT's issuer. */
  GITHUB_APP_ID: z.string().optional(),
  /** The App's URL name (github.com/apps/<slug>): the install link is https://github.com/apps/<slug>/installations/new. */
  GITHUB_APP_SLUG: z.string().optional(),
  /** The App's client id ("Iv23..."). It is the JWT's `iss` and the OAuth client of the install step. */
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  /**
   * The App's client secret, to turn the code GitHub sends back after an
   * install into proof of who the person is. Server-side only: never sent to
   * a device, a log or an error message.
   */
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  /**
   * The App's private key, to sign the short-lived JWT every installation
   * token is minted with. Raw PEM, or base64 of the PEM (an env file cannot
   * hold newlines); `\n` escapes are turned back into newlines. Whoever holds
   * it can act on every repo the App is installed on: keep it with the other
   * secrets, never in a log or a reply.
   */
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  /** The secret GitHub signs its webhooks with (X-Hub-Signature-256). With none, the webhook refuses everything. */
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  /**
   * "Sign in with GitHub" for the Code bot: a second way to connect that needs
   * no App install. It is a classic GitHub OAuth App, so its token reaches all
   * the person's repos; Tailzu's own limits make that safe (src/code/oauth.ts:
   * only repos added as projects, push access re-checked before every write,
   * revoked on disconnect, on account delete and after 30 days unused). Off by
   * default, and the kill switch: while it is false no stored token is ever
   * used, and the sign-in routes answer 404 { code: "oauth_off" }. Needs
   * CODE_GITHUB, migration 0021 and CONNECTOR_TOKEN_KEY (tokens are stored
   * encrypted under it). Setup is in docs/github-app.md.
   */
  CODE_GITHUB_OAUTH: bool(false),
  /** The OAuth App's client id. Separate from the GitHub App's. */
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  /** The OAuth App's client secret. Server-side only: never sent to a device, a log or an error message. */
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  /**
   * WHO THE CODE BOT IS IN GIT. Every commit it makes, through either way of
   * connecting, has this name and email as its AUTHOR (the committer stays
   * whoever GitHub says the token is), and its message ends with a
   * Co-authored-by line for the person it worked for. Default "Blip" and
   * "blip@tailzu.space". For the avatar to show on GitHub, make a GitHub
   * account for the bot, and use that account's noreply address here
   * (<id>+<login>@users.noreply.github.com): docs/github-app.md. A value that
   * is empty, or has `<`, `>` or a line break in it, is ignored for the default.
   */
  CODE_BOT_NAME: z.string().optional(),
  CODE_BOT_EMAIL: z.string().optional(),
  /**
   * THE JOB ROUTER'S GITHUB ALLOWANCE (src/code/jobs, docs/code-router.md). A
   * coding job's steps that need a computer run on the cheapest place there is:
   * the person's own PC, then GitHub's free computers (GitHub Actions), then
   * paid compute under the person's own rule. GitHub gives a free plan 2,000
   * Actions minutes a month, shared with everything else the person runs
   * there, so Tailzu counts only its own use against this number and keeps a
   * tenth of it back. Set it to 0 to never use GitHub's free computers, or to
   * the person's plan's allowance if it is bigger. Needs migration 0023.
   */
  CODE_GITHUB_FREE_MINUTES: z.coerce.number().int().min(0).default(2000),
  /**
   * THE AUDIENCE OF THE IDENTITY TOKEN A STEP ON GITHUB'S FREE COMPUTERS REPORTS WITH
   * (src/code/jobs/githubActions.ts, docs/github-app.md section 9). The script
   * on the person's runner asks GitHub for an OIDC token for this audience and
   * sends it with its result to POST /v1/code/runner/gh-result; the server
   * accepts the result only if the token's audience is exactly this (and it
   * was signed by GitHub, for the right repo, branch, commit and workflow).
   * Any word works; it only has to be the same on both ends, which it is,
   * since the server writes it into the step. Change it and steps already out
   * are refused (they run again).
   */
  CODE_RUNNER_OIDC_AUDIENCE: z.string().trim().min(1).max(100).default("tailzu"),
  /**
   * THE CODE BOT'S MODELS (src/code/brain, docs/code-brain.md). Every call the
   * bot's brain makes names a TIER, not a model: tiny (classify and route),
   * cheap (search, summarise, index), code (normal code writing), strong
   * (plans and hard or risky changes), review (always a different model family
   * from the writer), vision, and indic (Indian-language wording). Each tier is
   * a ladder of OpenRouter model slugs, tried in order when a call fails before
   * it answers, with its own output limit, reasoning level, timeout and price
   * estimate. The defaults are in code/brain/tiers.ts.
   *
   * CODE_MODEL_TIERS changes them without a deploy: a JSON object keyed by
   * tier, each value any of { models, maxTokens, reasoning, timeoutMs,
   * usdPerMIn, usdPerMOut }, merged over that tier's defaults. A `models` list
   * replaces the ladder, it does not add to it. For example
   *   {"code":{"models":["deepseek/deepseek-v4.1-flash"],"reasoning":"high"}}
   * A value that does not parse, or a tier with a field the code does not know,
   * is ignored with a warning at the first call, never a crash.
   *
   * CODE_INDIC_MODEL is the first model of the indic tier; without it the indic
   * tier is the cheap tier's ladder. CODE_MODEL_TIERS still wins over it.
   *
   * CODE_USD_INR turns what OpenRouter charges (US dollars) into the paise a job
   * is budgeted in: 88 rupees to the dollar unless set.
   */
  CODE_MODEL_TIERS: z.string().optional(),
  CODE_INDIC_MODEL: z.string().trim().optional(),
  CODE_USD_INR: z.coerce.number().positive().max(10_000).default(88),
  /**
   * THE PROJECT BRAIN (src/code/project, docs/code-project-brain.md): when a
   * person adds a repo as a project, Tailzu reads it and keeps an accurate,
   * cheap-to-query understanding of it (files, symbols, routes, what a person
   * sees, tests, conventions, hot spots, features), and keeps it fresh from
   * GitHub's push webhook. Off by default: it needs migration 0028, and the
   * routes POST/GET /v1/code/projects/:id/brain answer 404 { code: "brain_off" }
   * while it is off. Needs CODE_GITHUB.
   *
   * CODE_IMPORT_BUDGET_PAISE caps what the cheap model may cost for one project's
   * first import, in paise (1,000, ten rupees, unless set). When it is spent the
   * lines already written are kept, the build says summaries "partial", and
   * everything learned without a model stands. An incremental build gets a fifth
   * of it. 0 turns the model off for the brain altogether.
   */
  CODE_PROJECT_BRAIN: bool(false),
  CODE_IMPORT_BUDGET_PAISE: z.coerce.number().int().min(0).max(1_000_000).default(1000),
  /**
   * TREE-SITTER FOR THE PROJECT BRAIN (src/code/project/treesitter, docs/code-project-brain.md): symbols, routes, imports, the names a file refers
   * to and the text a person reads are read with a real parser (web-tree-sitter, one WebAssembly grammar per language, loaded when a repo has a
   * file in that language) instead of regular expressions. On by default. false makes every build read with the regexes, which are also what runs
   * for any language whose grammar is not loaded (the Cloudflare Worker carries only some) and for a file the parser gives up on.
   */
  CODE_TREE_SITTER: bool(true),
  /**
   * HOW THE CODE AGENT TREATS ITS OLD TOOL RESULTS (src/code/agent/mask.ts, context.ts, docs/code-agent.md): "mask" replaces the output of a result that is
   * older than the last six by a one-line placeholder and keeps the model's own actions, with no model call; "summary" drops those turns and has the cheap
   * tier fold them into a running summary; "hybrid" masks and folds the oldest ten masked turns into the summary once there are twenty; "transcript" keeps every
   * result whole until they pass a size, then masks the oldest in a batch (a free-form job's default). A job keeps the strategy it started with.
   * Unset: a free-form job's transcript, else the default in agent/types.ts (CONTEXT_STRATEGY_DEFAULT). Set it to compare them (the e2e harness does).
   */
  /**
   * A FIX IS PROVED BY A TEST OF ITS OWN (src/code/agent/phases.ts testWanted, principle code.prove): before the checks run on a change to source with no test staged, the
   * agent is asked, once and within budget, for one small focused test of the behaviour it changed (the edge case the task names). On by default; set it to false to
   * compare a run with and without the round (the e2e harness can).
   */
  CODE_PROVE_FIX: bool(true),
  CODE_CONTEXT_STRATEGY: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined), z.enum(["mask", "summary", "hybrid", "transcript"]).optional()),
  /**
   * HOW A NEW CODE JOB IS WORKED WHEN NEITHER THE JOB NOR ITS PROJECT SAYS (src/code/agent/orchestrator.ts enqueue, docs/code-agent.md): "freeform" (the
   * default: the model reads, runs and edits in its own order, with the locate funnel offered as a tool and as hints, inside the same rails) or "guided" (the
   * phases in order: locate, plan, work on the planned files, verify). Kept so the two can be compared (the e2e harness's tailzu-phased contestant).
   */
  CODE_JOB_MODE: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined), z.enum(["freeform", "guided"]).optional()),
  /**
   * HOW HARD A FREE-FORM JOB'S MODEL THINKS, TURN BY TURN (src/code/agent/effort.ts): "high" (every work turn at its tier's level) or "adaptive" (the tier's
   * level when a turn decides something: understanding the task, after a failure or an answer, the review before done; "low" when it carries out a decision:
   * reading, searching, applying an edit after the first one). The router's tiers and models are the same either way.
   */
  CODE_EFFORT: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined), z.enum(["adaptive", "high"]).default("high")),
  /**
   * ARTIFACTS (src/artifacts, docs/artifacts.md): live things a bot makes and the person sees and clicks in the app, like Claude's: a page,
   * a React component, SVG, a diagram, markdown. They run in the viewer (the viewer/ package, a site of its own, in a sandbox with no network);
   * this server keeps them, their versions, what they save while they run, and makes the changes cheaply (an edit of one element sends a
   * model only that element, on the cheap tier). Off by default: it needs migration 0032, and every /v1/artifacts route answers
   * 404 { code: "artifacts_off" } while it is off. Not tied to the Code bot, but a Code project makes an artifact look like the project
   * (needs CODE_GITHUB and CODE_PROJECT_BRAIN for that part).
   *
   * ARTIFACT_DAILY_PAISE is what one person's edits, fixes and makings may cost in a day, in paise (2,000, twenty rupees, unless set).
   * ARTIFACT_ASK_DAILY_PAISE is what an artifact asking the bot may cost the PERSON WHO OPENED IT in a day (500, five rupees): never the
   * owner's money. 0 turns the model off for that part.
   */
  ARTIFACTS: bool(false),
  ARTIFACT_DAILY_PAISE: z.coerce.number().int().min(0).max(10_000_000).default(2000),
  ARTIFACT_ASK_DAILY_PAISE: z.coerce.number().int().min(0).max(10_000_000).default(500),
  /**
   * THE FRONT DOOR (src/front, docs/front-door.md): one smart entry point for a message. POST /v1/ask with {message, ...} understands it, picks
   * the answer's shape (a visual when one explains faster), and sends it down the cheapest path that can do it. Off by default: with it off
   * that body answers 404 { code: "front_door_off" } and /v1/ask keeps answering the desktop's {question, screenContent} exactly as before.
   * Needs migration 0033 only for the decision log and what it teaches (without it the log is the memory twin's, lost on a restart).
   *
   * FRONT_DAILY_PAISE is what the front door itself may spend on one person's messages in a day (1,500 paise, fifteen rupees): the small
   * model that reads a message, the replies, the research, the plans. Jobs have their own budgets and artifacts their own daily cap.
   */
  FRONT_DOOR: bool(false),
  FRONT_DAILY_PAISE: z.coerce.number().int().min(0).max(10_000_000).default(1500),
  /**
   * MEDIA AND FILES INGESTION (src/media, docs/media.md): a person attaches a PDF, an office file, a spreadsheet, a picture, a recording, a video or a zip,
   * and a question about it is answered from the part of it that matters. Off by default: it needs migration 0035, and with it off the front door's
   * attachment registry keeps its "coming soon" for those kinds and every /v1/files route answers 404 { code: "media_off" }.
   *
   * MEDIA_WORKER_URL / MEDIA_WORKER_SECRET: the Python worker (media-worker/) that reads office files (MarkItDown), hard PDFs (Docling), makes pictures
   * smaller and cuts a video into key frames and a sound track (ffmpeg). https, or http on a private address; every call is HMAC-signed with the secret
   * (SECRET: .env only, 32+ characters, the same on both sides). Without it PDFs with a text layer, CSV, text, code, zip, pictures and sound still work.
   *
   * R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET: the Cloudflare R2 bucket the bytes of a file are kept in (S3 API, signed by
   * src/media/sigv4.ts). R2_SECRET_ACCESS_KEY is a SECRET: .env only. Without all four, files are read and their text kept but their bytes are not.
   *
   * MEDIA_KEEP_DAYS: how long a file is kept unless the person keeps it (30).
   */
  MEDIA_INGEST: bool(false),
  MEDIA_WORKER_URL: z.string().trim().optional(),
  MEDIA_WORKER_SECRET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().trim().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().trim().optional(),
  MEDIA_KEEP_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /**
   * THE BOTS PLATFORM (src/bots, docs/bots.md): everything is a bot (the Code bot, Keybot, the Plan bot, the Travel bot), and a person can make their own, each
   * with its own tools, knowledge, memory and an API endpoint for their own apps. Off by default: it needs migration 0038, and with it off every /v1/bots route
   * answers 404 { code: "bots_off" } and the front door never picks a bot.
   *
   * BOT_KEY_PEPPER is a SECRET (.env only, 32+ characters): a bot's API key is stored as sha256(pepper + key), so a leaked table cannot be used. Without it
   * nobody can make a key (503 not_configured); rotating it revokes every key at once.
   *
   * BOTS_MAX is how many bots one person may make. BOT_REQUEST_PAISE and BOT_DAILY_PAISE are what a new bot is given to spend on one request and in one day
   * (the person may change both on their own bot, up to BOT_REQUEST_PAISE_MAX and BOT_DAILY_PAISE_MAX). BOT_KEY_RATE_PER_MIN is how many requests one key may make a
   * minute, and BOT_KEY_DAILY_PAISE what one key may spend in a day.
   */
  BOTS: bool(false),
  /**
   * THE BOTS APP (experience/bots, docs/bots-app.md): the new design of the phone and desktop apps, "everything is a bot" (tabs Bots / Activity / You,
   * Home is your bots). Off by default, and off means today's app, byte for byte. On, a build that declares "BotsKit" (it draws the kit's pieces)
   * is booted into it; an older build keeps today's app. BOTS_APP_TESTERS (sign-in emails, comma separated) narrows it to those people while set.
   * The screens read the bots platform (BOTS), the Code bot's jobs and connected apps where they are on, and draw an honest empty state where not.
   */
  BOTS_APP: bool(false),
  BOTS_APP_TESTERS: z.string().default(""),
  BOT_KEY_PEPPER: z.string().optional(),
  BOTS_MAX: z.coerce.number().int().min(1).max(500).default(20),
  BOT_REQUEST_PAISE: z.coerce.number().int().min(1).max(100_000).default(150),
  BOT_DAILY_PAISE: z.coerce.number().int().min(1).max(10_000_000).default(800),
  BOT_REQUEST_PAISE_MAX: z.coerce.number().int().min(1).max(1_000_000).default(1000),
  BOT_DAILY_PAISE_MAX: z.coerce.number().int().min(1).max(10_000_000).default(5000),
  BOT_KEY_RATE_PER_MIN: z.coerce.number().int().min(1).max(10_000).default(30),
  BOT_KEY_DAILY_PAISE: z.coerce.number().int().min(0).max(10_000_000).default(500),
  /**
   * THE OVERLOAD GUARDS (src/guard, docs/front-door.md): how many of the guarded requests (/v1/ask, artifact makings and edits, jobs, code
   * questions) run at once in THIS process. In memory: with several workers or servers each has its own count, so the real ceiling is the
   * number of them times these (docs/front-door.md says how to size it).
   *
   * GUARD_GLOBAL_CONCURRENCY all people together (64). GUARD_USER_CONCURRENCY one person (3); GUARD_USER_CONCURRENCY_FREE one person on the
   * free plan (1). A request over a limit waits in a queue: GUARD_QUEUE_MAX waiting in all (256), GUARD_QUEUE_PER_USER for one person (4),
   * GUARD_QUEUE_WAIT_MS at most this long before it is answered 429 with Retry-After and its place in the queue (8,000).
   */
  GUARD_GLOBAL_CONCURRENCY: z.coerce.number().int().min(1).max(100_000).default(64),
  GUARD_USER_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(3),
  GUARD_USER_CONCURRENCY_FREE: z.coerce.number().int().min(1).max(1_000).default(1),
  GUARD_QUEUE_MAX: z.coerce.number().int().min(0).max(100_000).default(256),
  GUARD_QUEUE_PER_USER: z.coerce.number().int().min(0).max(1_000).default(4),
  GUARD_QUEUE_WAIT_MS: z.coerce.number().int().min(0).max(120_000).default(8000),
  /**
   * THE CODE BOT'S AGENT LOOP (src/code/agent, docs/code-agent.md): the server-side
   * worker that drives a job from "fix this" to a pull request. It rides on the
   * environment router (src/code/jobs) and the brain (layers 1 to 7).
   *
   * CODE_JOB_DEFAULT_BUDGET_PAISE is what a job may spend on models (and paid
   * compute) when it is made WITHOUT a budget: 3,000 paise, thirty rupees, unless
   * set. A budget of 0 sent on purpose still means "no model calls": the default
   * is for a job made with no budget at all. A job that runs out stops cleanly
   * and offers the person "continue with ₹X more" (POST /v1/code/jobs/:id/budget).
   *
   * CODE_AGENT_CONCURRENCY is how many jobs one server drives at once (4 unless
   * set). A job is run by one server at a time whatever this says: the claim is in
   * the database (migration 0030).
   */
  CODE_JOB_DEFAULT_BUDGET_PAISE: z.coerce.number().int().min(0).max(1_000_000).default(3000),
  CODE_AGENT_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /**
   * LEAD AND HELPERS (src/code/team, docs/code-team.md). A goal that is big (a plan over 12 files or 3 features, or one over several projects, or one the
   * person asked a team for) is split into parts with clear file ownership; helpers build the parts in parallel on their own branches, a model of
   * another family reviews each, and the lead merges them and opens one pull request. CODE_TEAM=false switches it off for the server (a job is then always one
   * job). CODE_TEAM_PARALLEL is how many helpers work at once (3): the person's PC first, then GitHub's free computers, whose minutes are limited and shared.
   */
  CODE_TEAM: bool(true),
  CODE_TEAM_PARALLEL: z.coerce.number().int().min(1).max(8).default(3),
  /**
   * WHERE THE CODE BOT'S JOBS RUN (jobs/, docs/cloudflare-jobs.md).
   *
   * CODE_JOBS_MODE "local" (default) is how it has always been: this server's own
   * orchestrator and ticker drive the agent loop and build project brains.
   * "cloudflare" moves job EXECUTION to the Cloudflare Worker in jobs/ (a Workflow
   * per job, a Workflow per brain build, a Cron Trigger for the ticker): this
   * server then starts no orchestrator and no ticker, and instead tells the Worker
   * at CODE_JOBS_URL (https, no trailing path) when a job is made, when the person
   * answers, approves, denies, adds budget or stops it, and when a brain needs
   * building. Every call is signed with CODE_JOBS_SECRET (HMAC-SHA256, five-minute
   * window, a nonce), and so is the Worker's call back to POST
   * /v1/internal/code/notify, which is how the push still goes out from here.
   * Anything but "cloudflare" is "local".
   */
  CODE_JOBS_MODE: z.preprocess((v) => (String(v ?? "").trim().toLowerCase() === "cloudflare" ? "cloudflare" : "local"), z.enum(["local", "cloudflare"])),
  CODE_JOBS_URL: z.string().trim().optional(),
  CODE_JOBS_SECRET: z.string().optional(),
  /**
   * THE LIVE SESSION (src/code/live, docs/cloudflare-jobs.md section 10). With jobs on Cloudflare, a job has a
   * room (a Durable Object) that holds a copy of its files for instant read, grep and glob, and keeps ONE runner
   * open for the whole job, so a command takes about a second instead of 30 to 60. CODE_LIVE_SESSION switches it
   * off (the job then reads through GitHub's API and runs each command as its own step, as before).
   *
   * The rules, all here:
   *   CODE_SESSION_IDLE_SEC     a session with no command for this long is closed (120)
   *   CODE_SESSION_MAX_MIN      the most minutes of live session one job may use, in all (20); it is also the
   *                             time limit of the GitHub workflow that hosts the runner
   *   CODE_ACTIONS_MONTHLY_MIN  the person's GitHub Actions minutes a month that Tailzu counts against (2000, a
   *                             free plan). At 80% the person is told once; at 95% Tailzu stops choosing GitHub's
   *                             computers for them until the month turns over. A public repo does not count
   * A session is opened late (only on the first command) and closed before the person is asked anything.
   */
  CODE_LIVE_SESSION: bool(true),
  CODE_SESSION_IDLE_SEC: z.coerce.number().int().min(5).max(3600).default(120),
  CODE_SESSION_MAX_MIN: z.coerce.number().int().min(1).max(120).default(20),
  CODE_ACTIONS_MONTHLY_MIN: z.coerce.number().int().min(0).max(1_000_000).default(2000),
  /**
   * THE PREVIEW AND THE DESIGN CHECK (docs/cloudflare-jobs.md "The preview", docs/artifacts.md section 11). A job built from an approved design
   * (artifacts/build.ts) can run the project's own dev server on its runner, look at it, and compare it to the design.
   *
   *   CODE_PREVIEW_IDLE_SEC  a preview that gets no request for this long is closed (300). It counts as session activity only while it is used,
   *                          and always inside CODE_SESSION_MAX_MIN
   *   PREVIEW_DOMAIN         wildcard mode, on the Worker: the registrable domain whose subdomains are previews, `<token>.<PREVIEW_DOMAIN>`.
   *                          A site of its own, never the app's or the API's (it runs the person's project)
   *   PREVIEW_HOST           cookie mode, on the Worker: one dedicated host, `https://<PREVIEW_HOST>/p/<token>/`. Used when PREVIEW_DOMAIN is not set
   *   CODE_DESIGN_CHECK      "false" skips the design round of the agent loop altogether (true)
   *   ARTIFACT_SHOT_VIEWER_URL  the address of the viewer kept for screenshots: the same viewer deployed a second time with VIEWER_PARENT_ORIGINS=null
   *                          (viewer/docs/artifact-viewer.md section 14). It is NOT the app's viewer, which refuses the host page of a shot. Screenshots of a design need it
   *   ARTIFACT_SHOT_SECRET   signs the 7-day links to a job's screenshots; CODE_JOBS_SECRET when not set
   */
  CODE_PREVIEW_IDLE_SEC: z.coerce.number().int().min(10).max(3600).default(300),
  PREVIEW_DOMAIN: z.string().trim().toLowerCase().optional(),
  PREVIEW_HOST: z.string().trim().toLowerCase().optional(),
  CODE_DESIGN_CHECK: bool(true),
  ARTIFACT_SHOT_VIEWER_URL: z.string().trim().optional(),
  ARTIFACT_SHOT_SECRET: z.string().optional(),
  /**
   * WHERE THIS PROCESS RUNS. "node" (default) is the VPS: every setting it needs is
   * checked. "worker" is the Cloudflare jobs Worker, which never transcribes
   * speech, serves the app, or takes a payment, so the settings only those need
   * (the speech provider's key) are not required of it. Set by jobs/wrangler.jsonc.
   */
  RUNTIME: z.preprocess((v) => (String(v ?? "").trim().toLowerCase() === "worker" ? "worker" : "node"), z.enum(["node", "worker"])),
  /** Cloudflare's Browser Rendering REST API, for WEB_BROWSER=cloudflare: an API token with "Browser Rendering - Edit", and the account. */
  CLOUDFLARE_ACCOUNT_ID: z.string().trim().optional(),
  CLOUDFLARE_API_TOKEN: z.string().trim().optional(),
  /**
   * THE PAGE READER AND ITS BROWSER (src/web, docs/web-reader.md). Shared by the
   * Code bot's search tools and, later, anything Tailzu does on the web for a
   * person; it has no routes of its own.
   *
   * WEB_BROWSER: "off" (default) reads a page with a plain fetch only, and a page
   * that needs JavaScript answers needs_browser. "local" lets this server run its
   * own headless Chrome for those pages, behind a proxy of ours that refuses every
   * private address. It needs a Chrome: CHROME_PATH, or one found on the machine.
   * "cloudflare" renders those pages on Cloudflare's Browser Rendering (its REST
   * /content endpoint; CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN), which is
   * what the jobs Worker uses: it has no Chrome to start. Anything but these
   * three words is "off".
   */
  WEB_BROWSER: z.preprocess((v) => {
    const w = String(v ?? "").trim().toLowerCase();
    return w === "local" || w === "cloudflare" ? w : "off";
  }, z.enum(["off", "local", "cloudflare"])),
  /** Where Chrome is. Empty: look in /opt/pw-browsers, then for google-chrome, chromium and chromium-browser on PATH. */
  CHROME_PATH: z.string().trim().optional(),
  /**
   * The User-Agent the reader says it is. Printable ASCII, 300 characters at
   * most; anything else (or nothing) is the default. Keep the "+https://..."
   * part pointing at a page that tells a site owner who we are.
   */
  WEB_BOT_UA: z.string().optional().transform((v) => {
    const ua = (v ?? "").trim();
    return /^[\x20-\x7e]{1,300}$/.test(ua) ? ua : DEFAULT_WEB_BOT_UA;
  }),
  /**
   * How long a read page is kept, in minutes (migration 0026, or memory without
   * Supabase). Documentation hosts are kept for a day at least. 0 keeps nothing.
   */
  WEB_CACHE_TTL_MIN: z.coerce.number().int().min(0).max(10_080).default(360),
  /**
   * WEB SEARCH (src/web/search, docs/web-search.md): the Code bot's web_search and
   * research tools. The direct sources (npm, PyPI, crates.io, GitHub, Stack
   * Overflow, MDN, Hacker News, Wikipedia) need no key. Then, for a general web
   * search, tried in this order and only as many as it takes:
   *
   * WEB_SEARXNG_URL: the address of a SearXNG we run (https, public: every call
   * goes through the same guard that refuses private addresses, so an instance on
   * the server's own network has to be reached through the reverse proxy). Its
   * json format must be switched on. Anything that is not an https address is
   * ignored with a warning.
   * DuckDuckGo's HTML page comes next with no setting: free and for low volume
   * only (one request every two seconds), and not something to build on.
   * BRAVE_SEARCH_KEY: the paid fallback. SECRET: .env only.
   * STACKEXCHANGE_KEY: an app key from stackapps.com, which raises Stack Overflow's
   * 300 calls a day per address to 10,000. SECRET: .env only.
   *
   * WEB_SEARCH_DAILY and WEB_RESEARCH_DAILY hold one person to this many
   * general-web-search queries and this many research runs in 24 hours (in memory,
   * so a restart forgets). 0 turns that part off: no general web search, no research.
   */
  WEB_SEARXNG_URL: z.string().optional().transform((v) => {
    const raw = (v ?? "").trim();
    if (!raw) return undefined;
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" || u.username || u.password) return undefined;
      return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return undefined;
    }
  }),
  BRAVE_SEARCH_KEY: z.string().trim().optional().transform((v) => v || undefined),
  STACKEXCHANGE_KEY: z.string().trim().optional().transform((v) => v || undefined),
  WEB_SEARCH_DAILY: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(100_000).default(200)),
  WEB_RESEARCH_DAILY: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).max(100_000).default(30)),
  OPENROUTER_APP_URL: z.string().default("https://tulmi.local"),
  OPENROUTER_APP_NAME: z.string().default("Tulmi"),

  // --- Text-to-speech (voice output: read-aloud / screen-clarify) ---
  // Uses OPENAI_API_KEY. gpt-4o-mini-tts is cheap, multilingual, and steerable.
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

  // When true, auth + metering are skipped (local pipeline testing). Only
  // ever under NODE_ENV=development or test — see the boot-time refusal.
  DEV_SKIP_AUTH: bool(false),

  // The screen reply's prompt. From v5 it is the `writer` role (principles/
  // roles.ts), like every other writing path; v1 to v4 are the files in
  // shared/prompts/ (reply.v<N>.md). Roll back by exporting
  // REPLY_PROMPT_VERSION=v4 without a code change. (Cleanup has no file any
  // more: the writer's rules are the role's, its data is pipeline/assistPrompt.ts.)
  REPLY_PROMPT_VERSION: z.string().default("v5"),

  // Sentry (backend). Optional — the observability layer no-ops when unset,
  // so the value can safely stay empty in dev.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default("production"),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.05),

  // Rate limiting — buckets are keyed by the locally verified user id when the
  // request carries a valid session, else by client IP (see the keyGenerator
  // in server.ts). Spending is bounded downstream by metering/quota.
  RATE_LIMIT_MAX: z.coerce.number().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  // Admin secret for every operator route over HTTP (x-admin-secret): the
  // control plane and its console, push, media, and the cache bump. Optional —
  // when unset, the admin endpoints refuse every request. Set to a long random
  // string (openssl rand -hex 32).
  ADMIN_SECRET: z.string().optional(),
  /**
   * Smart notifications (src/push): one push at most on a day there is a
   * reason for it, at the hour each person usually dictates. On unless set to
   * "false"; the control plane's push.smart.enabled turns it off live, per
   * audience, without a restart. Needs Supabase to do anything.
   */
  PUSH_ENGINE: bool(true),
  /** How often the engine looks for a push that has come due. */
  PUSH_TICK_SEC: z.coerce.number().int().min(60).max(3600).default(300),
  /** Only needed when "enhanced push security" is on for the Expo project. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
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
   *
   * THE DEFAULT HAS TO BE THIS PROJECT'S OWN ID, and it was "pro" — a name
   * borrowed from RevenueCat's documentation and true of nobody's project by
   * accident. The entitlement here is called TAILZU AIR, so every purchase
   * that ever completed was filtered out on arrival: money taken, webhook
   * accepted, 200 returned, nothing granted. The failure leaves no error
   * anywhere, because refusing an entitlement we were not asked about is
   * exactly what this filter is for.
   *
   * It matches PAYWALL_CONFIG.entitlement, which is what the apps are told to
   * look for — the two are the same question asked at both ends, and
   * config.test.ts fails if they drift. Not imported from there: the catalog
   * reads this config, and the cycle would cost more than the test does.
   */
  REVENUECAT_ENTITLEMENT: z.string().default("TAILZU AIR"),
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
   * TAILZU'S OWN PAY PAGE (GET /pay, served as tailzu.space/pay): the plans
   * for the buyer's market, and Razorpay's checkout over them. The desktop's
   * Subscribe opens it, by a link the server signs for the account
   * (razorpay.payLink), when REVENUECAT_WEB_PAYWALL_URL is
   * https://tailzu.space/pay.
   *
   * Razorpay has no RevenueCat integration, so this server is the whole
   * integration (src/billing/razorpay.ts): it creates every subscription,
   * checks the checkout's signature, and keeps its own table of Razorpay
   * subscriptions current from Razorpay's webhook.
   *
   *   RAZORPAY_KEY_ID          rzp_test_… first, rzp_live_… once proven.
   *                            Public: it is in the page that opens checkout.
   *   RAZORPAY_KEY_SECRET      SECRET: .env only.
   *   RAZORPAY_WEBHOOK_SECRET  the secret typed when adding the webhook
   *                            (https://api.tailzu.space/v1/billing/razorpay).
   *                            SECRET: .env only.
   *   RAZORPAY_PLANS           the plans on sale, each tagged with its market
   *                            and period — exactly what
   *                            scripts/razorpay-plans.mjs prints:
   *                              IN:monthly:plan_…,IN:annual:plan_…,
   *                              world:monthly:plan_…,world:annual:plan_…
   *                            IN is shown to a browser in India's time zone,
   *                            world to every other. Public ids.
   *
   * Checked by the code that reads it, not here: a malformed entry takes that
   * plan off sale, it does not stop the server booting.
   */
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_PLANS: z.string().default(""),
  /**
   * META (Facebook/Instagram ads): the dataset the site's pixel and this
   * server's Conversions API both report to (src/ads/meta.ts).
   *
   *   META_PIXEL_ID          the dataset's id (Events Manager → the dataset →
   *                          Settings). Public: it is in every page's pixel.
   *                          Empty = no pixel on the site, nothing sent.
   *   META_CAPI_TOKEN        Conversions API access token (same Settings tab →
   *                          Conversions API → Generate access token).
   *                          SECRET: .env only. Empty = the pixel alone.
   *   META_TEST_EVENT_CODE   Events Manager → Test events, while checking
   *                          that events arrive. Remove once they do: events
   *                          sent with it are test events, not conversions.
   *   META_GRAPH_VERSION     the Graph API version the events go to.
   *   META_SKIP_EUROPE       the site loads no pixel for a visitor whose clock
   *                          is in Europe: there is no consent banner, and
   *                          there the pixel needs one.
   */
  META_PIXEL_ID: z.string().regex(/^\d*$/, "META_PIXEL_ID is the dataset's number").default(""),
  META_CAPI_TOKEN: z.string().default(""),
  META_TEST_EVENT_CODE: z.string().default(""),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  META_SKIP_EUROPE: bool(true),
  /**
   * THE LANDING PAGE'S LIVE DEMO. Off by default, on purpose.
   *
   * tailzu.space lets a visitor press a mic, talk for a few seconds, and see
   * their own words come back clean — no account, no install. That is the
   * whole pitch, and it is also an unauthenticated route that spends real
   * recogniser and model calls. Bounded three ways: a kill switch, a clip
   * length cap, and a per-IP rate. Turning it on is a decision about money,
   * so it is a line in .env rather than a default.
   */
  DEMO_ENABLED: bool(false),
  /**
   * Google sign-in on Android by way of Supabase's own OAuth page.
   *
   * The native Google client returns to `com.tulmi.app:/oauthredirect`, and a
   * build that never claimed that scheme strands the user on Google after
   * consent. Claiming it is a manifest change, which no OTA can carry. This
   * is the way round that: with it ON, the app opens Supabase's Google flow
   * instead, Supabase finishes Google with the web client secret it already
   * holds, and lands on /auth/callback here — which hands the session to the
   * app on tulmi://, a scheme every build has always claimed.
   *
   * Off by default because it needs two things done first: the callback URL
   * in Supabase → Auth → URL Configuration → Redirect URLs — as
   * `https://<host>/auth/callback**`, because the return now carries a
   * `?state=` (AUTH_CALLBACK_REQUIRE_STATE) — and the Google provider there
   * configured with the web client id AND secret.
   */
  AUTH_GOOGLE_WEB: bool(false),
  /**
   * /auth/callback hands a sign-in to the app only when the return carries a
   * `state` — the one the app minted when it started that sign-in, and the
   * only thing that lets the app tell its own flow from a link minted for
   * someone else's account (login CSRF; see routes/demo.ts).
   *
   * On by default. Off is a rollout valve and nothing else: an app bundle
   * from before the state existed sends none, so its Google-on-Android
   * sign-in would be refused. Set false only if this server ships before the
   * app update that sends the state has reached people, and back to true once
   * it has. It also needs Supabase's Redirect URLs to accept the query (see
   * docs/SUPABASE.md): `https://<PUBLIC_ORIGIN host>/auth/callback**`.
   */
  AUTH_CALLBACK_REQUIRE_STATE: bool(true),
  /** Longest clip the demo will accept, in seconds. A pitch, not a dictation. */
  DEMO_MAX_SECONDS: z.coerce.number().default(15),
  /** Demo calls one visitor may make per minute. */
  DEMO_PER_MINUTE: z.coerce.number().default(6),
  /**
   * Demo calls the whole server makes in a UTC day. The per-visitor rate is
   * not the ceiling: behind the site every visitor arrives from Vercel, so
   * the visitor is read from Vercel's header — which anyone calling the API
   * directly can also send. This is the number that bounds the bill.
   */
  DEMO_PER_DAY: z.coerce.number().default(500),
  /** Pages that may spend a demo call, by Origin (comma-separated). The
   *  API's own PUBLIC_ORIGIN, which serves a copy of the page, is added. */
  DEMO_ORIGINS: z.string().default("https://tailzu.space,https://www.tailzu.space"),
  /**
   * Where the landing page lives. `index.html` here is served at `/`; absent,
   * `/` sends people to /download so the apex is never a blank page. Bind
   * mounted from ~/tulmi/site on the server, so publishing the site is one
   * scp — the same shape as /downloads.
   */
  SITE_DIR: z.string().default("/data/site"),
  /**
   * WHETHER tailzu.space SHOWS ASK, served as /v1/site's top-level `ask`.
   *
   *   off   (default) the page keeps an empty #ask shell, no nav entry, no
   *         Alt-twice egg: nothing about an unreleased feature is shown
   *   soon  the section, as "Coming to the desktop app", with no download
   *         button beside it
   *   live  "New in the desktop app", with the desktop downloads
   *
   * A console rule on /ask ("soon") flips it with no deploy; this is the
   * value with no rule. Anything else reads as "off" rather than stopping
   * the server, because a typo here should hide a section, not the API.
   */
  ASK_SITE: z.string().optional().transform(askSite),
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
  /**
   * User ids that skip the free-tier cap. Comma-separated, empty by default.
   *
   * FOR OPERATOR TOKENS, AND IT IS A BILLING BYPASS — hence a list of exact
   * ids rather than a flag. The quality harness authenticates with a
   * STATIC_BEARER_TOKENS value, which resolves to a synthetic `static-<hash>`
   * user; that id is not a UUID, so it cannot have an entitlements row (the
   * table's foreign key points at auth.users), and there was no other way to
   * lift the cap for it. A 79-case run exhausted the monthly free words and
   * reported 63 quota errors as quality failures.
   *
   * Do not put a real account in here. Raising FREE_MONTHLY_WORDS instead
   * would have done the same job for the harness and handed it to every user
   * at the same time.
   */
  QUOTA_EXEMPT_USER_IDS: z.string().optional(),
  /**
   * TAILZU IS FREE, FOR NOW: no word limit for anyone, and nothing anywhere
   * that sells — no paywall, no plans, no "upgrade", no out-of-words or
   * low-words prompts, no prices on the site. The meters still count, so the
   * day this goes back to false every limit and screen returns as it was,
   * with no app build: set FREE_FOR_ALL=false in .env and deploy.
   */
  FREE_FOR_ALL: bool(true),
  FREE_MONTHLY_AUDIO_SECONDS: z.coerce.number().default(0),
  FREE_MONTHLY_WORDS: z.coerce.number().default(800),
  /**
   * Seconds of questions spoken to Ask a free account may send in a month,
   * on the live stream or as an Ask step's recording. Their words are never
   * written anywhere, so they do not spend the words above; without a
   * ceiling of their own, a stream that called itself a question was
   * transcription without end. Half an hour is several hundred questions.
   * 0 = no ceiling.
   */
  FREE_MONTHLY_AGENT_AUDIO_SECONDS: z.coerce.number().default(1800),
  /**
   * Questions about a picture a free account may ask Ask in a day. Each is a
   * vision call carrying an image, metered as no words and no seconds, so no
   * ceiling above ever reached it: 60 a minute, around the clock, was free.
   * Counted in memory, as the rate limits are. 0 = no ceiling.
   */
  FREE_DAILY_AGENT_PICTURES: z.coerce.number().int().min(0).default(100),

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
  "CONTROL_DIR",
  "KB_ROLLOUTS",
  "LLM_REASONING_EFFORT",
  "LOG_LEVEL",
  "MEDIA_DIR",
  "MEDIA_PUBLIC_URL",
  "ONBOARD_V2",
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
    ["GITHUB_APP_WEBHOOK_SECRET", env.GITHUB_APP_WEBHOOK_SECRET],
  ] as const) {
    if (typeof value === "string" && value.includes("$")) {
      console.warn(
        `[config] ${name} contains a "$". Docker Compose interpolates those in ` +
          `env_file values, so the running process may be holding a DIFFERENT ` +
          `secret than the file does — and the sender would get 401 with no ` +
          `other symptom. Use a secret with no "$" in it.`,
      );
    }
    // Every comparison is timing-safe and every route that checks one is
    // throttled, which only makes guessing slow; a short secret makes it
    // short. Warned, not refused, for the same reason as above.
    if (typeof value === "string" && value && value.length < 24) {
      console.warn(`[config] ${name} is under 24 characters. Use a long random value (openssl rand -hex 32).`);
    }
  }

  // The search keys are third-party API keys, not secrets of ours, so they have no length rule; the `$` trap is the same.
  for (const [name, value] of [
    ["BRAVE_SEARCH_KEY", env.BRAVE_SEARCH_KEY],
    ["STACKEXCHANGE_KEY", env.STACKEXCHANGE_KEY],
  ] as const) {
    if (typeof value === "string" && value.includes("$")) {
      console.warn(`[config] ${name} contains a "$". Docker Compose interpolates those in env_file values, so the running process may be holding a DIFFERENT key than the file does.`);
    }
  }

  // The selected STT provider must have its key. (The jobs Worker never transcribes speech: RUNTIME=worker is not asked for one.)
  if (env.RUNTIME !== "worker" && env.STT_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    throw new Error(
      "STT_PROVIDER=openai but OPENAI_API_KEY is missing. Add OPENAI_API_KEY, " +
        "or set STT_PROVIDER=groq and add GROQ_API_KEY.",
    );
  }
  if (env.RUNTIME !== "worker" && env.STT_PROVIDER === "groq" && !env.GROQ_API_KEY) {
    throw new Error(
      "STT_PROVIDER=groq but GROQ_API_KEY is missing. Add GROQ_API_KEY, " +
        "or set STT_PROVIDER=openai and add OPENAI_API_KEY.",
    );
  }

  // Connected apps with no usable key can list apps but never connect one.
  // Warned, not refused: the rest of the server is unaffected.
  if (env.CONNECTORS && Buffer.from(env.CONNECTOR_TOKEN_KEY ?? "", "base64").length !== 32) {
    console.warn("[config] CONNECTORS=true but CONNECTOR_TOKEN_KEY is not 32 bytes of base64 (openssl rand -base64 32): no app can be connected.");
  }
  if (env.CUSTOM_CONNECTORS && !env.CONNECTORS) {
    console.warn("[config] CUSTOM_CONNECTORS=true does nothing while CONNECTORS is off: nobody can add an app by link.");
  }

  // A SearXNG address that is not an https address was dropped by the schema; say so, since it is a setting someone typed.
  if ((process.env.WEB_SEARXNG_URL ?? "").trim() && !env.WEB_SEARXNG_URL) {
    console.warn("[config] WEB_SEARXNG_URL is not an https address (https://search.example.com): it is ignored, and web search goes to DuckDuckGo's page, then Brave if there is a key.");
  }

  // Media ingestion: half-set worker or bucket settings are a feature that quietly does less. Warned, not refused.
  if (env.MEDIA_INGEST) {
    const r2 = [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_BUCKET];
    if (r2.some(Boolean) && !r2.every(Boolean)) console.warn("[config] R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are not all set: files are read but their bytes are not kept.");
    if (Boolean(env.MEDIA_WORKER_URL) !== Boolean(env.MEDIA_WORKER_SECRET)) console.warn("[config] MEDIA_WORKER_URL and MEDIA_WORKER_SECRET go together: without both there is no worker, so office files and scanned PDFs are not read.");
    if (env.MEDIA_WORKER_SECRET && env.MEDIA_WORKER_SECRET.length < 32) console.warn("[config] MEDIA_WORKER_SECRET is under 32 characters. Use a long random value (openssl rand -hex 32), the same on the VPS and the worker.");
  }

  // Bots: a pepper that is missing or short makes keys that a leaked table could be tested against. Warned, not refused: the rest of the server is unaffected.
  if (env.BOTS) {
    if (!env.BOT_KEY_PEPPER) console.warn("[config] BOTS=true but BOT_KEY_PEPPER is not set: nobody can make an API key for a bot until it is (openssl rand -hex 32).");
    else if (env.BOT_KEY_PEPPER.length < 32) console.warn("[config] BOT_KEY_PEPPER is under 32 characters. Use a long random value (openssl rand -hex 32).");
  }

  // Jobs on Cloudflare with no way to reach the Worker: every job would be failed with a reason. Warned, not refused: the rest of the server is unaffected.
  if (env.CODE_JOBS_MODE === "cloudflare" && env.RUNTIME !== "worker") {
    const missing = ([["CODE_JOBS_URL", env.CODE_JOBS_URL], ["CODE_JOBS_SECRET", env.CODE_JOBS_SECRET]] as const).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) console.warn(`[config] CODE_JOBS_MODE=cloudflare but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set: new jobs are failed with a reason until they are (docs/cloudflare-jobs.md).`);
    else if (env.CODE_JOBS_URL && !/^https:\/\//i.test(env.CODE_JOBS_URL)) console.warn("[config] CODE_JOBS_URL is not an https address: the Worker is not called.");
  }
  if (env.CODE_JOBS_SECRET && env.CODE_JOBS_SECRET.length < 32) {
    console.warn("[config] CODE_JOBS_SECRET is under 32 characters. Use a long random value (openssl rand -hex 32), the same on the VPS and the Worker.");
  }

  // The Code bot switched on with half a GitHub App can be asked and never answer.
  // Warned, not refused: every /v1/code route says "not_configured" until it is whole.
  if (env.CODE_GITHUB) {
    const missing = ([
      ["GITHUB_APP_SLUG", env.GITHUB_APP_SLUG], ["GITHUB_APP_CLIENT_ID", env.GITHUB_APP_CLIENT_ID],
      ["GITHUB_APP_CLIENT_SECRET", env.GITHUB_APP_CLIENT_SECRET], ["GITHUB_APP_PRIVATE_KEY", env.GITHUB_APP_PRIVATE_KEY],
      ["GITHUB_APP_WEBHOOK_SECRET", env.GITHUB_APP_WEBHOOK_SECRET],
    ] as const).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) console.warn(`[config] CODE_GITHUB=true but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set: the Code bot cannot be used until they are (docs/github-app.md).`);
    if (Buffer.from(env.CONNECTOR_TOKEN_KEY ?? "", "base64").length !== 32) {
      console.warn("[config] CODE_GITHUB=true but CONNECTOR_TOKEN_KEY is not 32 bytes of base64 (openssl rand -base64 32): GitHub cannot be connected.");
    }
    if (env.CODE_GITHUB_OAUTH && !(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET)) {
      console.warn("[config] CODE_GITHUB_OAUTH=true but GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET are not both set: Sign in with GitHub answers not_configured.");
    }
  }
  if (env.CODE_GITHUB_OAUTH && !env.CODE_GITHUB) {
    console.warn("[config] CODE_GITHUB_OAUTH=true does nothing while CODE_GITHUB is off.");
  }

  // Our published client document only works for sign-ins that come back to the
  // redirect it lists, and this server lists its own. Pointing the URL anywhere
  // else is allowed (a document hosted elsewhere), but then that document has to
  // list CONNECTOR_REDIRECT_URL, or every sign-in through it fails at the vendor.
  if (env.CONNECTORS && env.CONNECTOR_CLIENT_METADATA_URL) {
    let own = "";
    try { own = `${new URL(env.CONNECTOR_REDIRECT_URL).origin}/oauth/client-metadata.json`; } catch { /* the redirect is checked where it is used */ }
    let usable = false;
    try { const u = new URL(env.CONNECTOR_CLIENT_METADATA_URL); usable = u.protocol === "https:" && u.pathname !== "/"; } catch { /* warned below */ }
    if (!usable) {
      console.warn("[config] CONNECTOR_CLIENT_METADATA_URL must be an https URL with a path (it is our client id): it is ignored, and apps register a client instead.");
    } else if (env.CONNECTOR_CLIENT_METADATA_URL !== own) {
      console.warn(`[config] CONNECTOR_CLIENT_METADATA_URL is not where this server serves its client document (${own || "no valid CONNECTOR_REDIRECT_URL"}). Sign-ins through it work only if the document there lists CONNECTOR_REDIRECT_URL; set it to "" to turn it off.`);
    }
  }

  // Google apps switched on with no OAuth client can be listed but never connected.
  if (env.CONNECTORS && /google-(calendar|docs)/i.test(env.CONNECTORS_ENABLED_IDS) && !(env.GOOGLE_CONNECT_CLIENT_ID && env.GOOGLE_CONNECT_CLIENT_SECRET)) {
    console.warn("[config] A Google app is in CONNECTORS_ENABLED_IDS but GOOGLE_CONNECT_CLIENT_ID / GOOGLE_CONNECT_CLIENT_SECRET are not both set: it cannot be connected.");
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
  // budget, and every caller is the same user). We treat anything that isn't an
  // affirmative "development"/"test" as production — so a typo'd or unset
  // NODE_ENV ("prod", "PRODUCTION", "") fails safe rather than booting wide open.
  // There is no override: a load test runs under NODE_ENV=development, on a box
  // that is not the production one.
  const nodeEnv = (env.NODE_ENV ?? "").toLowerCase();
  const isDevOrTest = nodeEnv === "development" || nodeEnv === "test";
  if (env.DEV_SKIP_AUTH && !isDevOrTest) {
    throw new Error(
      "DEV_SKIP_AUTH=true is not allowed when NODE_ENV=production. " +
        "Configure Supabase (SUPABASE_URL + SUPABASE_ANON_KEY) and remove " +
        "DEV_SKIP_AUTH before deploying.",
    );
  }

  cached = { ...env, supabaseEnabled, authEnabled };
  return cached;
}

export const VERSION = "0.1.0";
