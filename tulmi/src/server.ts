/**
 * Tulmi backend HTTP/WS server.
 *
 *   GET  /healthz                 → liveness
 *   POST /v1/transcribe-clean     → voice: multipart audio → cleaned text
 *   WS   /v1/stream               → voice (live): audio frames up, text down
 *   POST /v1/refine               → typing: text → polished text (autocorrect)
 *   POST /v1/draft                → screen: screen content + intent → reply
 *   POST /v1/speak                → voice out: text → spoken audio (TTS)
 *   GET  /v1/personality          → read the user's saved style profile
 *   PUT  /v1/personality          → save the user's style profile
 *
 * Every output is shaped by the user's personality + the target-app context,
 * resolved here on the backend (the app just sends the inputs).
 */
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";

/** Constant-time string comparison — avoids leaking a secret via response
 * timing. Returns false on any length mismatch (lengths aren't secret). */
function safeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import transcribeStream from "./routes/transcribe-stream.js";
import { registerMediaRoutes, loadMediaRegistry, getMediaRegistry } from "./routes/media.js";
import { PRIVACY_POLICY_HTML, PRIVACY_POLICY_EFFECTIVE } from "./routes/policies/privacy.js";
import { TERMS_HTML, TERMS_EFFECTIVE } from "./routes/policies/terms.js";
import { DOWNLOAD_PAGE_HTML } from "./routes/download.js";
import { getConfig, VERSION } from "./config.js";
import { resolveUser, supabase, type AuthedUser } from "./auth/supabase.js";
import { localUserId } from "./auth/jwt.js";
import { enforceQuota, recordUsage, usageSummary, usageWindows } from "./usage/metering.js";
import { recordKeyboardTelemetry } from "./usage/telemetry.js";
import { activeRollouts, bucketFor } from "./experience/rollout.js";
import { captureException, fastifyLoggerOptions, initSentry } from "./observability.js";
import { getProfile, updateProfile, touchLastSeen, type Profile } from "./profile/store.js";
import { applyRevenueCatEvent, isEntitled } from "./billing/entitlements.js";

/**
 * The language a request should be written in.
 *
 * Clients send a hint, but the hint is a copy of the user's choice made at
 * first launch and does not always follow later changes — the iOS keyboard
 * reads it from a shared store that Settings did not update, so a Hindi
 * speaker who had picked English once kept getting Hindi speech "refined"
 * toward English. The profile is the source of truth for that choice, so
 * when the client sends nothing, or "auto", the profile decides. A real code
 * from the client still wins: a per-request override is a deliberate act.
 *
 * One extra read, and only on the fallback path.
 */
async function effectiveLanguage(
  user: AuthedUser,
  hint: string | undefined,
  personality?: Personality,
): Promise<string> {
  if (hint && hint !== "auto") return hint;
  // The Languages card, primary first. Free when the caller already holds the
  // personality — which every one of these handlers does.
  const first = personality?.languages?.[0];
  if (first && first !== "auto") return String(first);
  const profile = await getProfile(user).catch(() => null);
  const l = profile?.language;
  return l && l !== "auto" ? l : "auto";
}
import { runPipeline, runPipelineStream } from "./pipeline/index.js";
import { assist, draftReply, inferStyle, refineVariants, updateStylePortrait, LLM_TONES } from "./pipeline/cleanup.js";
import { synthesize } from "./pipeline/tts.js";
import {
  getPersonality,
  resolvePersonality,
  learnVocabularyCorrections,
  upsertPresetTone,
  updatePersonality,
} from "./personality/store.js";
import { PERSONALITY_PRESETS, applyPresetOverrides } from "./experience/personalityPresets.js";
import {
  type KeyboardPlatform,
  buildBootstrap,
  buildScreen,
  buildKeyboardConfig,
  bumpCacheVersion,
  currentCacheVersion,
  setMediaRegistryAccessor,
} from "./experience/catalog.js";
import { localize } from "./experience/i18n.js";
import {
  appendHistoryEntry,
  deleteHistoryEntry,
  listHistory,
  statsForUser,
  MAX_LIMIT as HISTORY_MAX_LIMIT,
} from "./history/store.js";
import { z } from "zod";
import type {
  AudioFormat,
  ClientMessage,
  DraftRequest,
  DraftResponse,
  HealthResponse,
  HistoryListResponse,
  LanguageHint,
  LearnVocabularyRequest,
  Personality,
  PersonalityResponse,
  PrivacyAuditResponse,
  RefineRequest,
  RefineResponse,
  ServerMessage,
  SpeakRequest,
  StatsResponse,
  TargetAppHint,
  VoicePreviewRequest,
} from "../../shared/types/api.js";
import { WS_PATH } from "../../shared/types/api.js";

/**
 * Build (but do NOT listen on) a fully-configured Fastify instance.
 *
 * Extracted so tests can `app.inject()` in-process without binding a port and
 * so the boot block below stays a single top-level try/catch.
 */
export async function buildApp(): Promise<FastifyInstance> {
const cfg = getConfig();

// Sentry — opt-in via SENTRY_DSN. Awaited so error hooks are registered
// before Fastify starts accepting traffic.
await initSentry();

const app = Fastify({
  // Redact Authorization/api-key headers out of every log line + trim the
  // request serializer so large multipart bodies never enter the log. See
  // observability.fastifyLoggerOptions() for the redaction list.
  logger: fastifyLoggerOptions(),
  // 1 MB ceiling for JSON/urlencoded bodies. Text endpoints cap at
  // MAX_TEXT_LENGTH (10k chars ≈ 40 KB), so 1 MB is very generous while
  // preventing a 50 MB JSON body from being parsed into memory. Audio uploads
  // do NOT use this limit — @fastify/multipart streams them under its own
  // `limits.fileSize` (50 MB) below.
  bodyLimit: 1 * 1024 * 1024,
  // Trust EXACTLY the reverse proxy in front of us (Caddy) — one hop. With
  // `true`, Fastify trusted the whole X-Forwarded-For chain and took the
  // left-most, client-supplied entry as req.ip, so an attacker could spoof
  // `X-Forwarded-For: <anything>` and mint unlimited fresh rate-limit buckets.
  // A hop count makes Fastify use the proxy-inserted (real) client IP. If you
  // add another proxy/LB in front of Caddy, bump this to the total hop count.
  trustProxy: 1,
});

// Route unhandled errors through the observability layer (Sentry when
// configured, console otherwise) — Fastify's default error handler still runs
// after and formats the JSON response, this only tees the event.
app.addHook("onError", async (req, _reply, err) => {
  captureException(err, { route: req.routeOptions?.url, method: req.method });
});

await app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});
await app.register(websocket);

// --- Rate limiter (must register BEFORE any route that needs throttling) ---
// Fastify applies plugin hooks in registration order, so /v1/media/* + admin
// routes below need this plugin already in place to be throttleable.
await app.register(rateLimit, {
  global: false,
  max: cfg.RATE_LIMIT_MAX,
  timeWindow: cfg.RATE_LIMIT_WINDOW_MS,
  keyGenerator: async (req) => {
    // Key by the VERIFIED user id when we can prove it, else by client IP.
    //
    // The user id is read from a LOCALLY signature-verified JWT (localUserId —
    // no network), so this reacts to the authenticated user without the two
    // hazards that keying on the raw Authorization header had: (1) a forged /
    // rotated token can't mint a fresh bucket — it fails verification and falls
    // through to the IP bucket; (2) there's no per-request Supabase round-trip
    // to amplify. Real users behind one NAT/CGNAT egress IP now get their own
    // buckets instead of sharing (and 429-storming) a single per-IP one.
    //
    // req.ip is trustworthy (trustProxy is the exact proxy hop count, so
    // X-Forwarded-For can't be spoofed). When no JWT secret / JWKS is configured
    // localUserId returns null and this degrades to the prior per-IP behavior.
    const uid = await localUserId(req.headers["authorization"]);
    return uid ? "u:" + uid : "ip:" + req.ip;
  },
});

// --- Media store -----------------------------------------------------------
// Serves /media/* as static files from MEDIA_DIR (mounted volume so uploads
// survive container recreation). Admin routes (/v1/media/*) handle upload +
// list + delete. The bootstrap response surfaces the registry as
// `bootstrap.media` so clients can resolve keys → URLs without a separate
// request. Registered AFTER rate-limit so admin endpoints can be throttled.
const MEDIA_DIR = process.env.MEDIA_DIR || "/data/media";
const MEDIA_PUBLIC_URL = process.env.MEDIA_PUBLIC_URL
  || `${process.env.PUBLIC_ORIGIN || "https://api.tailzu.space"}/media`;
await loadMediaRegistry(MEDIA_DIR);
// Let the SDUI catalog reach into the media registry (for e.g. surfacing
// the "mic.animation" media URL into the keyboard config's flags). Avoids a
// circular import between routes/media.ts and experience/catalog.ts.
setMediaRegistryAccessor(getMediaRegistry);
await app.register(fastifyStatic, {
  root: MEDIA_DIR,
  prefix: "/media/",
  decorateReply: false,
  cacheControl: true,
  maxAge: "365d",   // media files are content-addressed by SHA256; safe to cache aggressively
  immutable: true,
});
registerMediaRoutes(app, {
  mediaDir: MEDIA_DIR,
  publicUrlPrefix: MEDIA_PUBLIC_URL,
  adminSecret: cfg.ADMIN_SECRET ?? "",
  // The rate-limit plugin is registered global:false, so the media admin
  // routes only get throttled if they opt in per-route. Hand the same
  // per-IP cap the app routes use (AUTHED_RL) down so they actually apply it.
  rateLimit: { max: cfg.RATE_LIMIT_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS },
});

// --- Desktop-app downloads ---------------------------------------------------
// Installer binaries under DOWNLOADS_DIR are served at /downloads/* with
// STABLE filenames (Tailzu-Setup.exe / Tailzu.dmg / Tailzu.AppImage), so the
// /download landing page's links never change — publishing a release is just
// replacing a file on the server. Short cache (files are replaced in place,
// unlike the sha-addressed /media files).
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || "/data/downloads";
try {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
} catch (err) {
  // Non-Docker boots (local dev, CI) may not be able to create /data — that
  // must not kill the server; /downloads just 404s until the dir exists.
  console.warn(`[downloads] could not create ${DOWNLOADS_DIR}:`, (err as Error).message);
}
await app.register(fastifyStatic, {
  root: DOWNLOADS_DIR,
  prefix: "/downloads/",
  decorateReply: false,
  cacheControl: true,
  maxAge: "1h",
});

await app.register(transcribeStream);

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Refuse strings whose length exceeds the config-defined MAX_TEXT_LENGTH.
 *  Returns an error message when over-cap; null when ok. */
function tooLong(text: string | undefined): string | null {
  if (text == null) return null;
  if (text.length > cfg.MAX_TEXT_LENGTH) {
    return `text exceeds ${cfg.MAX_TEXT_LENGTH} chars (got ${text.length})`;
  }
  return null;
}

// --- Health -----------------------------------------------------------------

// /healthz — liveness only. Cheap, no upstream calls. Used by Docker HEALTHCHECK.
app.get("/healthz", async (): Promise<HealthResponse> => {
  return { status: "ok", service: "tulmi-backend", version: VERSION };
});

// --- Public policies (linked from App Store Connect + in-app Settings) -----
// Served as HTML directly from the backend so the URL never breaks even if
// the marketing site is down. Cache-controlled for 1h; edits go live within
// that window after a redeploy. If a shorter turnaround is ever needed, bump
// the cache-version and clients will refetch.

app.get("/privacy", async (_req, reply) => {
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=3600");
  return PRIVACY_POLICY_HTML;
});

app.get("/terms", async (_req, reply) => {
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=3600");
  return TERMS_HTML;
});

// OS-aware desktop-app download page (tailzu.space/download). The page itself
// HEAD-checks /downloads/* so platforms without a published installer show as
// "coming soon" instead of a dead link.
app.get("/download", async (_req, reply) => {
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=3600");
  return DOWNLOAD_PAGE_HTML;
});

// --- Universal Links / App Links (AASA + assetlinks) -----------------------
// Apple + Google fetch these from the naked domain to verify the app owns the
// URL space. We serve them from the backend and expect Caddy to proxy
// tailzu.space + app.tailzu.space through to this container — see
// deploy/Caddyfile. Any Host header works; the content is static.
//
// If tailzu.space / app.tailzu.space are hosted elsewhere, mirror these files
// from deploy/well-known/ into the marketing site's /.well-known/ instead.
//
// AASA must be served with application/json AND no redirect. Cache is short
// so an app-id or path change goes live within a day.
const AASA_JSON = JSON.stringify({
  applinks: {
    apps: [],
    details: [
      {
        appIDs: ["6552H8HYA4.com.tulmi.app"],
        components: [
          { "/": "/s/*" },
          { "/": "/screen/*" },
          { "/": "/paywall*" },
          { "/": "/invite/*" },
        ],
      },
    ],
  },
  webcredentials: {
    apps: ["6552H8HYA4.com.tulmi.app"],
  },
});

app.get("/.well-known/apple-app-site-association", async (_req, reply) => {
  reply.type("application/json");
  reply.header("Cache-Control", "public, max-age=3600");
  return AASA_JSON;
});

// Some older docs point iOS at the naked path — serve there too as an alias.
app.get("/apple-app-site-association", async (_req, reply) => {
  reply.type("application/json");
  reply.header("Cache-Control", "public, max-age=3600");
  return AASA_JSON;
});

app.get("/.well-known/assetlinks.json", async (_req, reply) => {
  reply.type("application/json");
  reply.header("Cache-Control", "public, max-age=3600");
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.tulmi.app",
        sha256_cert_fingerprints: [
          process.env.ANDROID_SIGNING_SHA256 ||
            "REPLACE_WITH_PRODUCTION_SIGNING_SHA256_FINGERPRINT",
        ],
      },
    },
  ];
});

// Machine-readable policy metadata — Apple's App Privacy questionnaire + any
// automated review tooling can pull effective dates from here.
app.get("/policies.json", async () => {
  return {
    privacy: {
      url: "https://tailzu.space/privacy",
      effective: PRIVACY_POLICY_EFFECTIVE,
    },
    terms: {
      url: "https://tailzu.space/terms",
      effective: TERMS_EFFECTIVE,
    },
  };
});

// /readyz — readiness. Pings the upstreams the pipeline depends on so an
// orchestrator (or operator) can tell "process alive" from "actually serving".
// Cached for 5 s so a flood of probes can't push us into upstream rate limits.
type Readiness = { name: string; ok: boolean; detail?: string };
let readyCache: { at: number; status: number; body: unknown } | null = null;
const READY_CACHE_MS = 5_000;

async function pingHead(url: string, timeoutMs = 1500): Promise<Readiness> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctl.signal });
    // 2xx-4xx all mean the host is reachable; 5xx means upstream is sick.
    return { name: url, ok: res.status < 500, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: url, ok: false, detail: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

app.get("/readyz", async (_req, reply) => {
  const now = Date.now();
  if (readyCache && now - readyCache.at < READY_CACHE_MS) {
    return reply.code(readyCache.status).send(readyCache.body);
  }
  const checks: Readiness[] = [];
  checks.push(await pingHead("https://openrouter.ai/api/v1/models"));
  if (cfg.SUPABASE_URL) {
    checks.push(await pingHead(`${cfg.SUPABASE_URL}/auth/v1/health`));
  } else {
    checks.push({ name: "supabase", ok: cfg.DEV_SKIP_AUTH, detail: "not configured (DEV_SKIP_AUTH)" });
  }
  const allOk = checks.every((c) => c.ok);
  const status = allOk ? 200 : 503;
  const body = {
    status: allOk ? "ready" : "degraded",
    service: "tulmi-backend",
    version: VERSION,
    checks,
  };
  readyCache = { at: now, status, body };
  return reply.code(status).send(body);
});

// --- Voice (REST): one-shot transcribe + clean ------------------------------

const ALLOWED_FORMATS: AudioFormat[] = [
  "wav",
  "m4a",
  "webm",
  "mp3",
  "ogg",
  "flac",
];

function formatFromFilename(name: string | undefined): AudioFormat | null {
  const ext = name?.split(".").pop()?.toLowerCase() as AudioFormat | undefined;
  return ext && ALLOWED_FORMATS.includes(ext) ? ext : null;
}

const AUTHED_RL = {
  rateLimit: { max: cfg.RATE_LIMIT_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS },
};
// UNAUTH_RL removed — every previously-unauth route was gated on
// per-user hashed tokens anyway, so AUTHED_RL is the right cap and
// avoids the 429-storm we saw on /v1/keyboard/config launch traffic.

app.post("/v1/transcribe-clean", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  let audio: Buffer | null = null;
  let format: AudioFormat | null = null;
  let targetApp: TargetAppHint | undefined;
  let language: LanguageHint | undefined;
  let personalityOverride: Personality | undefined;
  let context: string | undefined; // whatever's already in the field, if any
  let tone: string | undefined; // active tone override from the client
  let tonePrompt: string | undefined; // the active tone's inline prompt text

  // Iterate multipart parts: one file ("audio") + optional text fields.
  for await (const part of req.parts()) {
    if (part.type === "file") {
      format = formatFromFilename(part.filename) ?? "m4a";
      audio = await part.toBuffer();
    } else if (part.fieldname === "targetApp") {
      targetApp = String(part.value);
    } else if (part.fieldname === "language") {
      language = String(part.value) as LanguageHint;
    } else if (part.fieldname === "context") {
      context = String(part.value);
    } else if (part.fieldname === "tone") {
      tone = String(part.value);
    } else if (part.fieldname === "tonePrompt") {
      tonePrompt = String(part.value);
    } else if (part.fieldname === "personality") {
      try {
        personalityOverride = JSON.parse(String(part.value)) as Personality;
      } catch {
        /* ignore malformed personality field */
      }
    }
  }

  if (!audio || !format) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'audio' file" });
  }

  // The multipart text fields feed the LLM prompt exactly like /v1/refine's
  // JSON body does — cap them the same way (multipart's own fieldSize limit is
  // ~1 MiB, far above MAX_TEXT_LENGTH).
  const fieldOver = tooLong(context) ?? tooLong(tonePrompt);
  if (fieldOver) return reply.code(413).send({ code: "bad_request", message: fieldOver });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  const t0 = Date.now();
  try {
    const personality = personalityOverride ?? await getPersonality(user);
    const lang = await effectiveLanguage(user, language, personality);
    const result = await runPipeline({
      audio,
      format,
      targetApp,
      language: lang,
      personality,
      tone: tone ?? personality.activeTone,
      tonePrompt,
      context,
      variables: { email: user.email, phone: user.phone },
    });
    await recordUsage({ user, source: "rest", ...result.usage });
    await appendHistoryEntry(
      user,
      personality,
      {
        kind: "voice",
        targetApp,
        language,
        input: result.transcript,
        output: result.cleanedText,
        durationMs: Date.now() - t0,
        wordsIn: countWords(result.transcript),
        wordsOut: result.usage.words,
      },
      result.usage.audioSeconds,
    );
    return reply.send(result);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Pipeline failed" });
  }
});

// --- Typing (REST): refine typed text ---------------------------------------

app.post("/v1/refine", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  const body = (req.body ?? {}) as RefineRequest;
  if (!body.text || !body.text.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
  }
  // Cap EVERY prompt-bound text field, not just body.text — context/tonePrompt
  // flow into the LLM prompt too, and uncapped they let one request smuggle up
  // to the 1 MB bodyLimit of unmetered input tokens past MAX_TEXT_LENGTH.
  // Cap EVERY prompt-bound field — `alternative` (a second recognizer's
  // reading, forwarded by the live path) reaches the prompt exactly like
  // context does, so it gets the same ceiling.
  const over =
    tooLong(body.text) ?? tooLong(body.context) ?? tooLong(body.tonePrompt) ?? tooLong(body.alternative);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  const t0 = Date.now();
  try {
    const personality = body.personality ?? await getPersonality(user);
    // The writing assistant separates any embedded instruction ("…make it
    // shorter, in bullet points") from the message, applies the active tone,
    // and uses body.context (whatever's already in the field) as the draft /
    // conversation to continue or reply to.
    const lang = await effectiveLanguage(user, body.language, personality);
    const refinedText = await assist(body.text, {
      tone: body.tone ?? personality.activeTone,
      tonePrompt: body.tonePrompt,
      context: body.context,
      targetApp: body.targetApp,
      language: lang,
      // A second engine's reading of the same speech, when the live path saw
      // the two disagree — reconciled before the writing task.
      alternative: body.alternative,
      personality,
      variables: { email: user.email, phone: user.phone },
    });
    const usage = {
      audioSeconds: 0,
      words: countWords(refinedText),
      model: cfg.CLEANUP_MODEL,
    };
    await recordUsage({ user, source: "rest", ...usage });
    await appendHistoryEntry(user, personality, {
      kind: "typing",
      targetApp: body.targetApp,
      language: body.language,
      input: body.text,
      output: refinedText,
      durationMs: Date.now() - t0,
      wordsIn: countWords(body.text),
      wordsOut: usage.words,
    });
    const res: RefineResponse = { refinedText, usage };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Refine failed" });
  }
});

// --- Training (REST): variant generation + style-portrait learning ----------
//
// The Train tab's loop: /variants turns one input into three differently-
// styled refinements; the user taps the one that sounds most like them and
// /pick absorbs that choice into the evolving style portrait
// (personality.stylePortrait), which every refine path then injects into its
// prompt. Tone-scoped picks also train that tone's note.

app.post("/v1/train/variants", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const body = (req.body ?? {}) as { text?: string; tone?: string; language?: string };
  const textIn = (body.text ?? "").trim();
  if (!textIn) return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
  const over = tooLong(textIn);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });
  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
  try {
    const personality = await getPersonality(user);
    const tone = body.tone && body.tone !== "none" ? String(body.tone).slice(0, 120) : undefined;
    // The Train sheet sends a VOICE id (built-in or custom preset). When it
    // matches one, the variants speak in that voice's promptStyle — and the
    // voice id doubles as the portrait key, so its learned note flows into
    // generation too. A plain LLM tone id still works for legacy callers.
    const voice = tone
      ? applyPresetOverrides(personality.presetOverrides).find((p) => p.id === tone)
      : undefined;
    const variants = await refineVariants(textIn, {
      tone,
      tonePrompt: voice?.promptStyle,
      personality,
      language: body.language,
      targetApp: "Generic",
    });
    if (!variants.length) {
      return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't generate variants" });
    }
    await recordUsage({
      user,
      source: "rest",
      audioSeconds: 0,
      words: variants.reduce((s, v) => s + countWords(v.text), 0),
      model: getConfig().CLEANUP_MODEL,
    });
    return reply.send({ variants });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't generate variants" });
  }
});

app.post("/v1/train/pick", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const body = (req.body ?? {}) as {
    input?: string;
    chosen?: string;
    rejectedA?: string;
    rejectedB?: string;
    tone?: string;
  };
  const input = (body.input ?? "").trim();
  const chosen = (body.chosen ?? "").trim();
  if (!input || !chosen) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'input' or 'chosen'" });
  }
  const over = tooLong(input) ?? tooLong(chosen) ?? tooLong(body.rejectedA) ?? tooLong(body.rejectedB);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });
  try {
    const personalityNow = await getPersonality(user);
    const current = personalityNow.stylePortrait;
    // `tone` may be a VOICE id (the Train sheet lists the voice library) or a
    // plain LLM tone id. The portrait note is KEYED by the raw id; the LLM
    // prompt sees the human name so "custom_<uuid>" never leaks into it.
    const toneKey = body.tone && body.tone !== "none" ? String(body.tone).slice(0, 120) : undefined;
    const toneLabel = toneKey
      ? applyPresetOverrides(personalityNow.presetOverrides).find((p) => p.id === toneKey)?.name ?? toneKey
      : undefined;
    const rejected = [body.rejectedA, body.rejectedB]
      .map((r) => (r ?? "").trim())
      .filter((r) => r && r !== chosen);
    const next = await updateStylePortrait(current, {
      input,
      chosen,
      rejected,
      tone: toneLabel,
      currentToneNote: toneKey ? current?.tones?.[toneKey] : undefined,
    });
    // Merge under the per-user lock; the tones map merges per-key so training
    // one tone never wipes the notes learned for the others.
    const merged = await updatePersonality(user, (existing) => ({
      ...existing,
      stylePortrait: {
        core: next.core,
        tones: {
          ...(existing.stylePortrait?.tones ?? {}),
          ...(toneKey && next.toneNote ? { [toneKey]: next.toneNote } : {}),
        },
        examples: (existing.stylePortrait?.examples ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      },
    }));
    return reply.send({ ok: true, examples: merged.stylePortrait?.examples ?? 1 });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Couldn't save your pick" });
  }
});

// --- Per-tone refine (REST): one endpoint per tone --------------------------
//
// One dedicated endpoint per tone so the LLM only ever sees a single,
// hand-tuned prompt with no dynamic composition — the fewer moving pieces
// in the system message, the less chance of drift or hallucination on
// borderline inputs. The client picks the endpoint based on the user's
// active tone; the /v1/refine catch-all above still works for legacy
// callers.
//
// Shape:
//   POST /v1/refine/<tone>
//   body:  { text: string; language?: string }
//   200:   { refinedText: string; usage: {...} }
//
// The "none" tone doesn't touch the LLM — it returns the input after
// snippet expansion so "brb" still becomes "be right back" without a
// server round-trip on the refine layer.

// All tone routes now share one brain: assist(). The route path only carries
// which tone to write in; the assistant separates message from instruction,
// applies that tone, and uses body.context (the existing draft) when present.
const runToneRefine = (toneId: string) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const body = (req.body ?? {}) as { text?: string; language?: string; context?: string; tonePrompt?: string };
    if (!body.text || !body.text.trim()) return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
    // Same cap discipline as /v1/refine: every prompt-bound field counts.
    const over = tooLong(body.text) ?? tooLong(body.context) ?? tooLong(body.tonePrompt);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });
    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    const t0 = Date.now();
    try {
      const personality = await getPersonality(user);
      const lang = await effectiveLanguage(user, body.language, personality);
      const refinedText = await assist(body.text, {
        tone: toneId,
        // Inline prompt still wins even on the per-tone route, so a custom tone
        // can reuse this path and the route's toneId is just the label/default.
        tonePrompt: body.tonePrompt,
        context: body.context,
        language: lang,
        personality,
        variables: { email: user.email, phone: user.phone },
      });
      const usage = { audioSeconds: 0, words: countWords(refinedText), model: cfg.CLEANUP_MODEL };
      await recordUsage({ user, source: "rest", ...usage });
      await appendHistoryEntry(user, personality, {
        kind: "typing",
        targetApp: "Generic",
        language: body.language,
        input: body.text,
        output: refinedText,
        durationMs: Date.now() - t0,
        wordsIn: countWords(body.text),
        wordsOut: usage.words,
      });
      return reply.send({ refinedText, usage });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Refine failed" });
    }
  };

app.post("/v1/refine/none", { config: AUTHED_RL }, runToneRefine("none"));
for (const toneId of LLM_TONES) {
  app.post(`/v1/refine/${toneId}`, { config: AUTHED_RL }, runToneRefine(toneId));
}

// --- Screen (REST): draft a personalized reply ------------------------------

app.post("/v1/draft", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  const body = (req.body ?? {}) as DraftRequest;
  if (!body.intent || !body.intent.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'intent'" });
  }
  const tooBig = tooLong(body.intent) ?? tooLong(body.screenContent) ?? tooLong(body.recipient);
  if (tooBig) return reply.code(413).send({ code: "bad_request", message: tooBig });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  const t0 = Date.now();
  try {
    const personality = await resolvePersonality(user, body.personality);
    const lang = await effectiveLanguage(user, body.language, personality);
    const draftText = await draftReply(
      body.screenContent ?? "",
      body.intent,
      {
        targetApp: body.targetApp,
        language: lang,
        personality,
        variables: { email: user.email, phone: user.phone },
      },
      body.recipient,
    );
    const usage = {
      audioSeconds: 0,
      words: countWords(draftText),
      model: cfg.CLEANUP_MODEL,
    };
    await recordUsage({ user, source: "rest", ...usage });
    await appendHistoryEntry(user, personality, {
      kind: "draft",
      targetApp: body.targetApp,
      language: body.language,
      input: body.intent,
      output: draftText,
      durationMs: Date.now() - t0,
      wordsIn: countWords(body.intent),
      wordsOut: usage.words,
    });
    const res: DraftResponse = { draftText, usage };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Draft failed" });
  }
});

// --- Text-to-speech (REST): text → spoken audio -----------------------------

app.post("/v1/speak", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  const body = (req.body ?? {}) as SpeakRequest;
  if (!body.text || !body.text.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
  }
  const over = tooLong(body.text) ?? tooLong(body.instructions);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  try {
    const { audio, contentType } = await synthesize({
      text: body.text,
      voice: body.voice,
      format: body.format,
      instructions: body.instructions,
    });
    await recordUsage({
      user,
      source: "rest",
      audioSeconds: 0,
      words: countWords(body.text),
      model: cfg.OPENAI_TTS_MODEL,
    });
    return reply.header("content-type", contentType).send(audio);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "TTS failed" });
  }
});

// --- Personality (REST): read / save the user's style profile ---------------

app.get("/v1/personality", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const personality = await getPersonality(user);
  const res: PersonalityResponse = { personality };
  return reply.send(res);
});

app.put("/v1/personality", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const personality = (req.body ?? {}) as Personality;
  // Prompt-bound and user-supplied: every selected language becomes an
  // exemplar in the recognizer's prompt, so an unbounded array is unbounded
  // prompt. Twenty is far past any real answer and still cheap.
  if (personality.languages !== undefined) {
    if (!Array.isArray(personality.languages)) {
      return reply.code(400).send({ code: "bad_request", message: "languages must be an array" });
    }
    personality.languages = personality.languages
      .filter((l): l is string => typeof l === "string")
      .map((l) => l.trim().toLowerCase().slice(0, 16))
      .filter(Boolean)
      .slice(0, 20);
  }
  const over =
    tooLong(personality.tone) ??
    tooLong(personality.signature) ??
    tooLong(personality.customInstructions) ??
    tooLong(personality.vocabulary) ??
    tooLong(personality.snippets);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });
  // activePresetId must reference a real preset — built-in or one of the
  // user's custom tones — or it silently poisons the keyboard config
  // (kb.personality.activeId) and the voices screen's active highlight.
  if (personality.activePresetId !== undefined && personality.activePresetId !== null) {
    const id = String(personality.activePresetId);
    const existing = await getPersonality(user);
    const known =
      PERSONALITY_PRESETS.some((p) => p.id === id) ||
      Object.keys(existing?.presetOverrides ?? {}).includes(id);
    if (!known) {
      return reply.code(400).send({ code: "bad_request", message: `unknown presetId: ${id}` });
    }
  }
  try {
    // Merge the partial update into the existing profile so a PUT with just
    // { activePresetId } doesn't blow away the user's vocabulary, sign-off,
    // and pinned list. Under the per-user lock (updatePersonality) so this
    // shallow-merge can't clobber a concurrent tone / vocab / pin write.
    const merged = await updatePersonality(user, (existing) => ({ ...existing, ...personality }));
    const res: PersonalityResponse = { personality: merged };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to save personality" });
  }
});

// Toggle keyboard haptics — one key, or the master switch.
//
// A dedicated route rather than the PUT above because this is a SET membership
// change: the PUT shallow-merges, so a client would have to send the whole
// array back, and two quick taps would race with each other and drop one. This
// read-modify-writes under the same per-user lock, so every tap lands.
const hapticsToggleSchema = z.object({
  key: z.string().min(1).max(24).optional(),
  all: z.boolean().optional(),
});

app.post("/v1/personality/haptics", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const parsed = hapticsToggleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: "key or all required" });
  }
  const { key, all } = parsed.data;
  if (key === undefined && all === undefined) {
    return reply.code(400).send({ code: "bad_request", message: "key or all required" });
  }
  try {
    const merged = await updatePersonality(user, (existing) => {
      const next = { ...existing };
      if (all !== undefined) next.hapticsAll = all;
      if (key !== undefined) {
        const id = key.toLowerCase();
        const cur = new Set(existing?.hapticKeys ?? []);
        if (cur.has(id)) cur.delete(id); else cur.add(id);
        // Bounded: the picker only ever shows the keys on three layouts, so a
        // list longer than this is a client bug, not a user preference.
        next.hapticKeys = Array.from(cur).slice(0, 128);
      }
      return next;
    });
    const res: PersonalityResponse = { personality: merged };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to save haptics" });
  }
});

// Create / edit / delete a single tone (personality preset) — the two-field
// tone editor on the Voice screen. Read-modify-writes ONE presetOverrides entry
// under the per-user lock so it can't clobber the user's other tones (the PUT
// above shallow-merges the whole map). id present = edit; absent = new custom
// tone; remove=true = delete/reset. On save the tone becomes the active voice.
const toneUpsertSchema = z.object({
  id: z.string().max(120).optional(),
  name: z.string().max(80).optional(),
  promptStyle: z.string().max(2000).optional(),
  remove: z.boolean().optional(),
  // "New voice for keyboard" path: also pin the saved tone to the keyboard
  // set (same 6-cap as /v1/personality/pin), atomically with the upsert.
  pin: z.boolean().optional(),
});
app.post("/v1/personality/tone", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const parsed = toneUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: "Invalid tone payload" });
  }
  const { id, name, promptStyle, remove, pin } = parsed.data;
  if (!remove && !(name?.trim() || promptStyle?.trim())) {
    return reply.code(400).send({ code: "bad_request", message: "A tone needs a name or a prompt" });
  }
  try {
    const { personality, toneId } = await upsertPresetTone(user, { id, name, promptStyle, remove, pin });
    const res: PersonalityResponse = { personality };
    return reply.send({ ...res, toneId });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to save tone" });
  }
});

// Toggle a preset on/off in the user's keyboard pin list. Idempotent per
// action (POST body decides), enforces the 6-item ceiling. Kept separate
// from PUT /v1/personality so the client doesn't have to round-trip the
// whole profile just to star an item.
const MAX_PINNED = 6;
app.post("/v1/personality/pin", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const body = (req.body ?? {}) as { presetId?: string; pinned?: boolean };
  const presetId = String(body.presetId ?? "").trim();
  if (!presetId) return reply.code(400).send({ code: "bad_request", message: "Missing presetId" });
  try {
    // Read-modify-write under the per-user lock so a concurrent PUT / tone /
    // vocab write can't clobber the pin change (and vice-versa).
    let next: string[] = [];
    const merged = await updatePersonality(user, (existing) => {
      const current = Array.isArray(existing.pinnedPresetIds) ? [...existing.pinnedPresetIds] : [];
      // Toggle when `pinned` is omitted (star icon UX). Otherwise honor the
      // explicit flag — lets a settings screen force-add or force-remove.
      const explicit = typeof body.pinned === "boolean" ? body.pinned : !current.includes(presetId);
      if (explicit) {
        // Add — cap at MAX_PINNED, evicting the oldest to make room. Matches
        // the "star already has 6 → drop the first" UX shipping apps use.
        if (current.includes(presetId)) next = current;
        else next = [...current, presetId].slice(-MAX_PINNED);
      } else {
        next = current.filter((id) => id !== presetId);
      }
      return { ...existing, pinnedPresetIds: next };
    });
    return reply.send({ personality: merged, pinnedPresetIds: next });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to update pin" });
  }
});

// Register (or refresh) an Expo push token for the current user. The client
// sends this on every launch — we upsert on (user, platform) so old tokens
// naturally roll over when the device gets a new one. The whole flow is
// best-effort from the client's perspective; the app never blocks on it.
const pushRegisterSchema = z.object({
  token: z.string().min(4).max(256),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(40).optional(),
});
app.post("/v1/push/register", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  const parsed = pushRegisterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid body" });
  }
  const { token, platform, appVersion } = parsed.data;
  try {
    // Best-effort upsert. Table shape: (user_id, platform, token, app_version,
    // updated_at) with PK (user_id, platform) so re-registration overwrites
    // the same row. If the table doesn't exist yet, we log and no-op; the
    // schema migration is a follow-up SQL step. Never surfaces to the user.
    const sb = supabase();
    if (sb) {
      const { error } = await sb.from("push_tokens").upsert(
        {
          user_id: user.id,
          platform,
          token,
          app_version: appVersion ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" },
      );
      if (error) req.log.warn({ err: error }, "push_tokens upsert failed");
    }
    return reply.send({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "push_tokens exception");
    // Silent success — client retries on next launch.
    return reply.send({ ok: true });
  }
});

// Learn a style profile from a sample of the user's own writing, merge it into
// their saved personality, and return the result.
app.post("/v1/personality/learn", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const body = (req.body ?? {}) as { sample?: string };
  if (!body.sample || !body.sample.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'sample'" });
  }
  const over = tooLong(body.sample);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  try {
    const inferred = await inferStyle(body.sample);
    // Merge under the per-user lock so the inferred style can't clobber a
    // concurrent tone / pin / vocab write.
    const merged = await updatePersonality(user, (existing) => ({ ...existing, ...inferred }));
    const res: PersonalityResponse = { personality: merged };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to learn style" });
  }
});

// Auto-learn: when the user corrects a produced spelling (deletes what the
// cleaner wrote and re-dictates / retypes it), the client posts the (from, to)
// pairs here so future STT + cleanup calls know the right spelling. Only the
// "to" side is stored in the personal vocabulary — see personality/store.ts.
const vocabularyLearnSchema = z.object({
  corrections: z
    .array(
      z.object({
        from: z.string().trim().min(1).max(60),
        to: z.string().trim().min(1).max(60),
      }),
    )
    .min(1)
    .max(20),
});

app.post(
  "/v1/personality/vocabulary/learn",
  { config: AUTHED_RL },
  async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) {
      return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    }
    const parsed = vocabularyLearnSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid body" });
    }

    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    try {
      const body = parsed.data as LearnVocabularyRequest;
      const personality = await learnVocabularyCorrections(user, body.corrections);
      const res: PersonalityResponse = { personality };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "internal", message: "Failed to learn vocabulary" });
    }
  },
);

// --- Voice preview (REST): sample a voice in the caller's own style ---------
//
// Same wire shape as /v1/speak but every field is optional — text defaults to
// a short English sample, instructions default to a derivation of the user's
// personality (tone + formality), and voice defaults to the server's TTS_VOICE.

const voicePreviewSchema = z.object({
  voice: z.string().trim().min(1).max(60).optional(),
  text: z.string().trim().min(1).max(cfg.MAX_TEXT_LENGTH).optional(),
  instructions: z.string().trim().min(1).max(cfg.MAX_TEXT_LENGTH).optional(),
});

const DEFAULT_PREVIEW_TEXT = "Hi, this is what I sound like.";

/** Build a small style steer from the user's personality — tone + formality. */
function deriveTtsInstructions(p: Personality | undefined): string | undefined {
  if (!p) return undefined;
  const bits: string[] = [];
  if (p.tone?.trim()) bits.push(p.tone.trim());
  if (p.formality === "formal") bits.push("speak more formally");
  else if (p.formality === "casual") bits.push("speak casually and friendly");
  return bits.length ? bits.join("; ") : undefined;
}

app.post("/v1/voice/preview", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const parsed = voicePreviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply
      .code(400)
      .send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid body" });
  }

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  try {
    const body = parsed.data as VoicePreviewRequest;
    const text = body.text?.trim() || DEFAULT_PREVIEW_TEXT;
    let instructions = body.instructions?.trim();
    if (!instructions) {
      const personality = await getPersonality(user);
      instructions = deriveTtsInstructions(personality);
    }

    const { audio, contentType } = await synthesize({
      text,
      voice: body.voice,
      instructions,
    });
    await recordUsage({
      user,
      source: "rest",
      audioSeconds: 0,
      words: countWords(text),
      model: cfg.OPENAI_TTS_MODEL,
    });
    return reply.header("content-type", contentType).send(audio);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Voice preview failed" });
  }
});

// --- Experience (SDUI): the backend drives the app's UI ---------------------
//
// The app is a generic renderer; these endpoints decide what it draws. Auth is
// optional here so the shell can boot pre-login (personality is empty for guests).

// Every SDUI response carries no-store headers so intermediaries (nginx,
// mobile OS URL cache, corporate proxies) never serve a stale catalog.
// Client-side caching is negotiated through `cacheVersion` in bootstrap.
function noStoreSdui(reply: import("fastify").FastifyReply): void {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
  reply.header("Pragma", "no-cache");
  reply.header("X-Cache-Version", currentCacheVersion());
}

// SDUI endpoints intentionally use the AUTHED_RL tier even though the routes
// themselves are auth-optional. Reason: a normal launch fires bootstrap +
// several screens back-to-back (4–6 requests). The keyGenerator keys by the
// LOCALLY-verified user id when a valid JWT is present, so a real authed user
// gets their own bucket (even sharing a NAT egress IP with many others);
// anonymous callers fall back to per-IP (real IP now, thanks to trustProxy).
/**
 * RevenueCat's webhook — the only thing that may grant a subscription.
 *
 * Authenticated by a shared secret RevenueCat sends verbatim as the
 * Authorization header. With no secret configured this refuses everything:
 * an open endpoint that grants entitlements is a free subscription for anyone
 * who finds the URL, so it fails closed.
 *
 * Always answers 200 once authorised, even when an event is unusable.
 * RevenueCat retries non-2xx for hours, and a malformed event will never
 * become valid — retrying it forever buries the real ones.
 */
app.post("/v1/billing/revenuecat", async (req, reply) => {
  const expected = cfg.REVENUECAT_WEBHOOK_SECRET ?? "";
  if (!expected) {
    req.log.error("[billing] webhook hit with no REVENUECAT_WEBHOOK_SECRET set");
    return reply.code(503).send({ code: "not_configured" });
  }
  const got = String(req.headers["authorization"] ?? "");
  if (got !== expected && got !== `Bearer ${expected}`) {
    return reply.code(401).send({ code: "unauthorized" });
  }
  const body = (req.body ?? {}) as { event?: Record<string, unknown> };
  const ev = (body.event ?? {}) as Record<string, unknown>;
  const res = await applyRevenueCatEvent(ev as never, cfg.REVENUECAT_ENTITLEMENT);
  // Logged either way: a webhook that silently does nothing looks exactly like
  // one that worked, and this is how a missing subscription gets diagnosed.
  req.log.info({ rc: res, type: ev.type }, "[billing] revenuecat event");
  return reply.send(res);
});

app.post("/v1/app/bootstrap", { config: AUTHED_RL }, async (req, reply) => {
  noStoreSdui(reply);
  // Auth is optional here so the shell can boot; when present, the user's
  // profile decides whether onboarding still needs to run.
  const user = await resolveUser(req.headers["authorization"]);
  // The personality is read here only to know whether the Languages card has
  // been answered — see arrivalPrompt. One read per launch, in parallel with
  // the profile, so it costs no extra latency.
  const [profile, personality] = user
    ? await Promise.all([getProfile(user), getPersonality(user).catch(() => null)])
    : [null, null];
  const reqBody = (req.body ?? {}) as { launchCount?: number };
  // The server's own view of both, so the app never has to guess and a
  // modified client cannot claim either. Read in parallel with everything
  // else, so this costs no extra latency.
  const [entitled, usage] = user
    ? await Promise.all([isEntitled(user).catch(() => false), usageSummary(user).catch(() => null)])
    : [false, null];
  const bootstrap = buildBootstrap({
    onboarded: profile?.onboarded ?? false,
    // Both answers are required by the card, so either one proves it ran.
    profileComplete: !!(profile?.fullName || profile?.gender),
    launchCount: Number(reqBody.launchCount) || 0,
    languagesSet: !!personality?.languages?.length,
    entitled,
    wordsUsed: usage?.month?.words ?? 0,
  });
  // When they were last here. Fire and forget: a failed stamp must never cost
  // the boot, and nothing reads it on this path.
  if (user) void touchLastSeen(user).catch(() => {});
  // Attach the current media registry so clients can resolve keys → URLs
  // without a separate roundtrip. Keys are semantic ("brand.mark",
  // "onboarding.hero.png"); each entry has { url, contentType, size,
  // uploadedAt }. Missing key → clients fall back to bundled default.
  (bootstrap as unknown as { media?: Record<string, unknown> }).media = getMediaRegistry();
  return reply.send(await localize(bootstrap, profile?.language ?? "en"));
});

app.post("/v1/app/screen", { config: AUTHED_RL }, async (req, reply) => {
  noStoreSdui(reply);
  const body = (req.body ?? {}) as {
    screenId?: string;
    params?: Record<string, string | number | boolean | undefined>;
    /** Caller's UTC offset (minutes, JS -getTimezoneOffset() convention) so
     * per-day stats bucket in the USER'S day, not Greenwich's. */
    tzOffsetMinutes?: number;
  };
  const screenId = body.screenId;
  if (!screenId) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'screenId'" });
  }

  const user = await resolveUser(req.headers["authorization"]);
  const [personality, profile] = user
    ? await Promise.all([getPersonality(user), getProfile(user)])
    : [{}, null];

  // Load per-screen aggregates only for the screens that need them.
  // usageSummary covers legacy stats numbers; statsForUser adds the
  // history-derived "minutes saved" + sparkline for the SDUI stats screen.
  const usage = user && screenId === "stats" ? await usageSummary(user) : undefined;
  // "month" window: the Stats tab charts 14-day bars + 30-day streaks, which
  // a 7-day projection can't feed. tzOffsetMinutes keeps "today"/"evening"
  // meaning the user's clock.
  const stats =
    user && screenId === "stats"
      ? await statsForUser(user, "month", Number(body.tzOffsetMinutes) || 0)
      : undefined;
  const history =
    user && screenId === "history"
      ? (await listHistory(user, { limit: 50 })).entries
      : undefined;
  // THE GATE. On iOS the keyboard's mic opens the app on `flow_arm`, so this
  // route is where an out-of-words user is stopped — before a session arms,
  // and without needing a keyboard build to enforce it.
  //
  // Only for flow_arm: every other screen stays reachable when the words run
  // out. Being out of quota is not a reason to lose your settings.
  if (screenId === "flow_arm" && user) {
    const [entitled, used] = await Promise.all([
      isEntitled(user).catch(() => true),        // unknown → let them through
      usageSummary(user).catch(() => null),
    ]);
    const free = Number(process.env.FREE_MONTHLY_WORDS ?? 2500) || 0;
    if (!entitled && free > 0 && (used?.month?.words ?? 0) >= free) {
      const paywall = buildScreen("paywall", {
        personality,
        language: profile?.language ?? "auto",
        onboarded: profile?.onboarded ?? false,
        email: user?.email,
        phone: user?.phone,
        params: body.params,
      });
      if (paywall) return reply.send(await localize(paywall, profile?.language ?? "auto"));
    }
  }
  const screen = buildScreen(screenId, {
    personality,
    language: profile?.language ?? "auto",
    onboarded: profile?.onboarded ?? false,
    email: user?.email,
    phone: user?.phone,
    usage,
    stats,
    history,
    params: body.params,
  });
  if (!screen) {
    return reply.code(404).send({ code: "bad_request", message: `Unknown screen '${screenId}'` });
  }
  return reply.send(await localize(screen, profile?.language ?? "auto"));
});

// --- Profile (REST): language + onboarding state ----------------------------

app.get("/v1/profile", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  return reply.send(await getProfile(user));
});

app.put("/v1/profile", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const body = (req.body ?? {}) as {
    language?: string;
    onboarded?: boolean;
    full_name?: string;
    gender?: string;
  };
  const patch: Partial<Profile> = {};
  if (typeof body.language === "string") patch.language = body.language;
  if (typeof body.onboarded === "boolean") patch.onboarded = body.onboarded;
  // The name + gender card has been sending these since it shipped; until now
  // they were parsed off the body and dropped, so the card's answers lived only
  // in the phone's own storage and a reinstall asked again.
  if (typeof body.full_name === "string") {
    const name = body.full_name.trim().slice(0, 120);
    if (name) patch.fullName = name;
  }
  if (body.gender === "female" || body.gender === "male" || body.gender === "other") {
    patch.gender = body.gender;
  }
  try {
    return reply.send(await updateProfile(user, patch));
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to save profile" });
  }
});

// --- Privacy audit (receipts screen) ----------------------------------------
//
// Feeds the in-app "Data & Privacy" screen. Nothing new is stored — this is
// just a projection of usage_events + the user's stated consent flags.
// Purpose: give users a concrete, honest answer to "what have you done with
// my stuff". Auditability, not marketing copy.

app.get("/v1/privacy/audit", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const [windows, personality] = await Promise.all([
    usageWindows(user),
    getPersonality(user),
  ]);
  const res: PrivacyAuditResponse = {
    windows,
    // Backend today deletes audio after the STT call regardless of the flag,
    // so this reports the flag's *stated intent* honestly (false unless the
    // user has opted in). Do not toggle to true until server-side retention
    // is actually implemented — a mislabelled "false" is safer than a false "true".
    audioRetained: personality.retainAudio === true,
    learningFromRuns: personality.learnFromSent === true,
    upstreamProviders: computeUpstreamProviders(),
    links: [
      { label: "Read policy", url: "https://tailzu.space/privacy" },
      { label: "Contact support", url: "mailto:support@tailzu.space" },
      { label: "Delete my data", url: "mailto:privacy@tailzu.space?subject=Delete%20my%20data" },
    ],
  };
  return reply.send(res);
});

/**
 * Which SaaS providers your text/audio may have gone to under the current
 * server configuration. Derived from env — the "delete provider X" toggle
 * (env change) automatically drops it from this list, so the audit stays
 * honest without a code push.
 */
function computeUpstreamProviders(): string[] {
  const out = new Set<string>();
  if (cfg.STT_PROVIDER === "openai" || cfg.OPENAI_API_KEY) out.add("OpenAI");
  if (cfg.STT_PROVIDER === "groq" || cfg.GROQ_API_KEY) out.add("Groq");
  if (cfg.DEEPGRAM_API_KEY) out.add("Deepgram");
  if (cfg.OPENROUTER_API_KEY) out.add("OpenRouter (cleanup LLM)");
  if (cfg.SUPABASE_URL) out.add("Supabase (auth + metering only)");
  return [...out];
}

// --- Account: delete everything we hold about a user ------------------------
//
// The Settings screen's "Delete account" button fires this. We remove the
// user's saved personality, profile, and usage_events, then ask Supabase Auth
// to delete the account itself (requires the service-role key; falls back to a
// "please email us" message when only the anon key is configured).
//
// This is intentionally destructive and irreversible — we don't hold a
// tombstone. The endpoint returns a small JSON summary of what was deleted so
// the client can show a receipt.

app.delete("/v1/account", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  const admin = supabase();
  const summary = {
    personality: false, profile: false, usageEvents: 0,
    history: false, pushTokens: false, authAccount: false,
  };

  if (admin) {
    // Delete usage rows and application-level tables. Errors are logged but
    // don't abort the sequence — the user still gets a partial receipt.
    try {
      const { count } = await admin
        .from("usage_events")
        .delete({ count: "exact" })
        .eq("user_id", user.id);
      summary.usageEvents = count ?? 0;
    } catch (err) { req.log.error({ err }, "delete usage_events"); }

    try {
      const { error } = await admin.from("personalities").delete().eq("user_id", user.id);
      summary.personality = !error;
    } catch (err) { req.log.error({ err }, "delete personalities"); }

    try {
      const { error } = await admin.from("profiles").delete().eq("user_id", user.id);
      summary.profile = !error;
    } catch (err) { req.log.error({ err }, "delete profiles"); }

    // Verbatim dictated input + output — the most sensitive per-user data. The
    // endpoint claims "all associated data" is deleted, so this MUST be cleared
    // (it was silently left behind before).
    try {
      const { error } = await admin.from("cleanup_history").delete().eq("user_id", user.id);
      summary.history = !error;
    } catch (err) { req.log.error({ err }, "delete cleanup_history"); }

    // Push tokens (device targeting) — also user-identifying; clear them too.
    try {
      const { error } = await admin.from("push_tokens").delete().eq("user_id", user.id);
      summary.pushTokens = !error;
    } catch (err) { req.log.error({ err }, "delete push_tokens"); }

    // Auth deletion requires the service-role key. When it fails we return a
    // partial-success message rather than pretending the account is gone.
    try {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      summary.authAccount = !error;
    } catch (err) {
      req.log.error({ err }, "delete auth user");
    }
  }

  return reply.send({
    status: summary.authAccount ? "deleted" : "partial",
    ...summary,
    message: summary.authAccount
      ? "Your account and all associated data have been deleted."
      : "Data removed. To finalize account deletion, email privacy@tailzu.space.",
  });
});

// --- Keyboard config (server-driven keyboard; cached by the native shell) ----

/**
 * Which keyboard is asking, from the one signal both send without being told
 * to: the HTTP client's default User-Agent. The Android keyboard talks through
 * OkHttp ("okhttp/…"); the iOS extension through URLSession, which names the
 * bundle and CFNetwork. Neither client asserts a platform, so neither can lie
 * about it — and an unknown agent is treated as iOS, the platform whose config
 * is safe to serve to anyone.
 */
function keyboardPlatform(userAgent: unknown): KeyboardPlatform {
  const ua = String(userAgent ?? "").toLowerCase();
  return /okhttp|dalvik|android/.test(ua) ? "android" : "ios";
}

app.get("/v1/keyboard/config", { config: AUTHED_RL }, async (req, reply) => {
  // Personality is per-user — the keyboard uses it to render the quick-swap
  // chip row (pinned presets) + honor the active preset's default tone.
  // Missing/failed auth just returns the config without pins; the keyboard
  // still works, it just shows the built-in tone cycle instead.
  let personality: Personality | undefined;
  // Also the rollout key: a user's experiment slice is derived from their id,
  // so it stays put across requests instead of re-rolling mid-session.
  let userId: string | undefined;
  try {
    const user = await resolveUser(req.headers["authorization"]);
    if (user) {
      userId = user.id;
      personality = await getPersonality(user);
    }
  } catch { /* keyboard should never fail on personality lookup */ }
  // Cache-Control: no-store — keyboard config carries per-user
  // `kb.personality.pinned` / activeId / activeTone. Any caching layer
  // (nginx, CDN) that indexed the response by URL alone could leak these
  // across users. Same policy as /v1/app/bootstrap and /v1/app/screen.
  noStoreSdui(reply);
  return reply.send(buildKeyboardConfig(personality, userId, { platform: keyboardPlatform(req.headers["user-agent"]) }));
});

// --- Keyboard telemetry ------------------------------------------------------
//
// Diagnostic COUNTERS from the keyboard. This is the missing half of remote
// control: 130+ behaviors are tunable and rollout-scoped, but without counters
// every experiment is judged by feel.
//
// PRIVACY: a keyboard extension sees everything the user types, so this
// endpoint is built to make leaking content impossible rather than unlikely.
// Counter NAMES are allowlisted and values must be finite numbers — a string
// is rejected outright, so there is no shape in which text could arrive, even
// if a future client tried to send it.
const TELEMETRY_COUNTERS = new Set([
  "keystrokes",
  "autocorrectApplied",
  "autocorrectReverted",
  "suggestionAccepted",
  "confusableOffered",
  "confusableAccepted",
  "swipeCommitted",
  "swipeAbandoned",
  "touchesCancelledRescued",
  "accentTrayOpened",
  "trackpadUsed",
  "micTaps",
  "dictationCommitted",
  "refineRequested",
  "refineFailed",
  "toneChanged",
  "voiceChanged",
  "memoryWarnings",
  "coldStarts",
]);
/** Cap a single counter so a buggy or hostile client can't skew aggregates. */
const TELEMETRY_MAX = 1_000_000;

app.post("/v1/keyboard/telemetry", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }
  const body = (req.body ?? {}) as {
    build?: unknown;
    appVersion?: unknown;
    platform?: unknown;
    counters?: unknown;
    windowMs?: unknown;
  };

  // Keep only known counters with finite numeric values.
  const counters: Record<string, number> = {};
  const raw = (body.counters ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    if (!TELEMETRY_COUNTERS.has(k)) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    counters[k] = Math.min(Math.floor(n), TELEMETRY_MAX);
  }
  // Nothing recognizable — accept quietly so a client on a newer/older counter
  // set never sees an error it would have to handle.
  if (!Object.keys(counters).length) return reply.send({ ok: true, recorded: 0 });

  // Which rollout slices this user is in, so a cohort can be compared against
  // the baseline. Derived server-side from the same salted hash the flags use
  // — the client never asserts its own bucket.
  const rules = activeRollouts();
  const buckets: Record<string, number> = {};
  for (const r of rules) buckets[r.flag] = bucketFor(user.id, r.flag);

  const short = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

  try {
    await recordKeyboardTelemetry(user, {
      build: short(body.build, 16),
      appVersion: short(body.appVersion, 32),
      platform: body.platform === "android" ? "android" : "ios",
      buckets,
      counters,
      windowMs: Math.max(0, Math.min(Number(body.windowMs) || 0, 7 * 24 * 60 * 60 * 1000)),
    });
  } catch (err) {
    // Telemetry must never surface as a user-visible failure — the keyboard
    // fires this in the background while someone is typing.
    req.log.error(err);
  }
  return reply.send({ ok: true, recorded: Object.keys(counters).length });
});

// --- Admin: cache control ----------------------------------------------------
//
// A tiny op-tools surface: bump the SDUI cache-version token so every client's
// next bootstrap reports a new value, which forces them to invalidate any
// screens they have cached. Guarded by ADMIN_SECRET (set in .env). When the
// secret isn't set the endpoint refuses every request — no accidental exposure.

app.post("/v1/admin/cache/bump", { config: AUTHED_RL }, async (req, reply) => {
  const provided = req.headers["x-admin-secret"];
  const expected = cfg.ADMIN_SECRET;
  if (!expected) {
    return reply
      .code(503)
      .send({ code: "not_configured", message: "ADMIN_SECRET is not set on the server" });
  }
  if (typeof provided !== "string" || provided.length === 0 || !safeStrEqual(provided, expected)) {
    return reply.code(401).send({ code: "unauthorized", message: "Bad or missing admin secret" });
  }
  const next = bumpCacheVersion();
  return reply.send({ ok: true, cacheVersion: next });
});

app.get("/v1/admin/cache/version", async (_req, reply) => {
  // Read-only, safe to expose (the token is already sent in every bootstrap).
  return reply.send({ cacheVersion: currentCacheVersion() });
});

// --- History + Stats (REST) -------------------------------------------------
//
// Opt-in per-user history log + a lightweight aggregation for the stats screen.
// Storage is gated by personality.learnFromSent / personality.retainHistory;
// the read endpoints here always return the caller's own rows (scoped via RLS
// when Supabase is configured, or an in-memory map under DEV_SKIP_AUTH).

const historyListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(HISTORY_MAX_LIMIT).optional(),
  before: z.string().datetime().optional(),
  // Row-id tie-breaker echoed back alongside `before` (see nextBeforeId).
  beforeId: z.string().uuid().optional(),
  kind: z.enum(["voice", "typing", "draft"]).optional(),
});

const historyIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const statsQuerySchema = z.object({
  window: z.enum(["week", "month", "all"]).default("week"),
});

app.get("/v1/history", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  const parsed = historyListQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid query" });
  }

  try {
    const { entries, nextBefore, nextBeforeId } = await listHistory(user, parsed.data);
    const res: HistoryListResponse = { entries };
    if (nextBefore) res.nextBefore = nextBefore;
    if (nextBeforeId) res.nextBeforeId = nextBeforeId;
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to load history" });
  }
});

app.delete("/v1/history/:id", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  const parsed = historyIdParamsSchema.safeParse(req.params ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: "invalid id" });
  }

  try {
    const ok = await deleteHistoryEntry(user, parsed.data.id);
    if (!ok) return reply.code(404).send({ code: "bad_request", message: "not found" });
    return reply.send({ ok: true });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to delete entry" });
  }
});

app.get("/v1/stats", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) {
    return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  }

  const parsed = statsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: parsed.error.issues[0]?.message ?? "invalid query" });
  }

  try {
    const stats = await statsForUser(user, parsed.data.window);
    const res: StatsResponse = stats;
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to compute stats" });
  }
});

// --- Voice (WebSocket): live streaming --------------------------------------

app.register(async (instance) => {
  // Same audio ceiling as /v1/transcribe-stream, in bytes. This WS collects
  // the whole clip in memory before running the batched pipeline, so an
  // unbounded chunks[] is a real OOM risk.
  const MAX_STREAM_BYTES = 30 * 1024 * 1024;
  const IDLE_TIMEOUT_MS = 60_000;

  // Rate-limited like every other authed route: the limit applies to the HTTP
  // upgrade request, so an anonymous connect flood can't amplify per-connection
  // resolveUser calls into the Supabase auth API.
  instance.get(WS_PATH, { websocket: true, config: AUTHED_RL }, (socket, req) => {
    const send = (msg: ServerMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };

    let started = false;
    let format: AudioFormat = "webm";
    let targetApp: TargetAppHint | undefined;
    let language: LanguageHint | undefined;
    let personalityOverride: Personality | undefined;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let authedUser: AuthedUser | null = null;
    let authReady = false;
    let closed = false;
    let ended = false; // one-shot guard: a second `end` frame must not re-run the pipeline
    let idleTimer: NodeJS.Timeout | null = null;

    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        send({ type: "error", code: "bad_request", message: "idle timeout" });
        safeClose();
      }, IDLE_TIMEOUT_MS);
    };

    const safeClose = () => {
      closed = true;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      try { socket.close(); } catch { /* ignore */ }
    };

    // Handshake/idle guard: arm the idle timer immediately on open so a socket
    // that connects (even with a valid token) but never sends `start`/audio is
    // torn down instead of lingering forever holding a socket + user ref.
    // Subsequent `start`/chunks re-arm it.
    armIdle();

    // Verify auth on connect (header carried through the upgrade request).
    // We DO NOT accept any binary frame until authReady = true — silent-drop
    // is safer than buffering unbounded audio for an unauthenticated caller.
    resolveUser(req.headers["authorization"]).then(async (user) => {
      if (!user) {
        send({ type: "error", code: "unauthorized", message: "Missing or invalid token" });
        safeClose();
        return;
      }
      const over = await enforceQuota(user);
      if (over) {
        send({ type: "error", code: "quota_exceeded", message: over });
        safeClose();
        return;
      }
      authedUser = user;
      authReady = true;
    }).catch((err) => {
      // A transient Supabase/quota failure here is a DETACHED rejection — with
      // no catch it becomes an unhandledRejection and (Node ≥20 default) kills
      // the whole process, dropping every connected user. Fail this socket only.
      app.log.error({ err }, "stream auth failed");
      try { send({ type: "error", code: "unauthorized", message: "Could not verify session" }); } catch { /* socket already gone */ }
      safeClose();
    });

    socket.on("message", async (data: Buffer, isBinary: boolean) => {
      if (closed) return;

      // Binary frame → audio chunk. Refuse until auth resolved AND client
      // sent "start"; cap total bytes; reset idle window.
      if (isBinary) {
        if (!authReady || !started) return; // silent drop
        totalBytes += data.length;
        if (totalBytes > MAX_STREAM_BYTES) {
          send({ type: "error", code: "audio_too_long", message: "stream size cap reached" });
          safeClose();
          return;
        }
        chunks.push(data);
        armIdle();
        return;
      }

      // Text frame → control message.
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send({ type: "error", code: "bad_request", message: "Invalid JSON control frame" });
        return;
      }

      if (msg.type === "start") {
        started = true;
        format = msg.format;
        targetApp = msg.targetApp;
        language = msg.language;
        personalityOverride = msg.personality;
        send({ type: "ready" });
        armIdle();
        return;
      }

      if (msg.type === "end") {
        // One-shot: a second "end" (double-tap, client retry) would otherwise
        // run STT + cleanup again → double metering, duplicate history, and
        // duplicate client events. Flip the guard synchronously, BEFORE the
        // first await, so the re-entrant call can't slip through.
        if (ended) return;
        ended = true;
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        const user = authedUser;
        if (!user) {
          send({ type: "error", code: "unauthorized", message: "Not authenticated" });
          safeClose();
          return;
        }
        if (chunks.length === 0) {
          send({ type: "error", code: "bad_request", message: "No audio received" });
          safeClose();
          return;
        }
        const audio = Buffer.concat(chunks);
        const t0 = Date.now();
        try {
          const personality = await resolvePersonality(user, personalityOverride);
          const lang = await effectiveLanguage(user, language, personality);
          // Capture transcript + final cleaned text for the (opt-in) history
          // write we do after the pipeline completes.
          let capturedTranscript = "";
          for await (const ev of runPipelineStream({
            audio,
            format,
            targetApp,
            language: lang,
            personality,
            variables: { email: user.email, phone: user.phone },
          })) {
            send(ev);
            if (ev.type === "transcript") capturedTranscript = ev.text;
            if (ev.type === "done") {
              await recordUsage({ user, source: "stream", ...ev.usage });
              await appendHistoryEntry(
                user,
                personality,
                {
                  kind: "voice",
                  targetApp,
                  language,
                  input: capturedTranscript,
                  output: ev.cleanedText,
                  durationMs: Date.now() - t0,
                  wordsIn: countWords(capturedTranscript),
                  wordsOut: ev.usage.words,
                },
                ev.usage.audioSeconds,
              );
            }
          }
        } catch (err) {
          req.log.error(err);
          send({ type: "error", code: "internal", message: "Pipeline failed" });
        } finally {
          safeClose();
        }
      }
    });

    socket.on("close", () => { closed = true; if (idleTimer) clearTimeout(idleTimer); });
    socket.on("error", () => { closed = true; if (idleTimer) clearTimeout(idleTimer); });
  });
});

  return app;
}

// --- Boot -------------------------------------------------------------------

// Only bind a port when this module is the process entry point. Tests import
// buildApp() directly and drive the server in-process via app.inject().
if (process.env.NODE_ENV !== "test") {
  const cfg = getConfig();

  // Last-resort guards. Detached rejections/exceptions (e.g. a floating auth
  // promise on a WebSocket, a background timer) would otherwise terminate the
  // process on Node ≥20's default `--unhandled-rejections=throw`, dropping every
  // connected user. Log + report instead of crashing on a single stray error.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
    try { captureException(reason); } catch { /* observability optional */ }
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
    try { captureException(err); } catch { /* observability optional */ }
  });

  try {
    const app = await buildApp();
    await app.listen({ port: cfg.PORT, host: cfg.HOST });
    // Announce the EFFECTIVE speech config on every boot.
    //
    // "no [stt] error lines" is ambiguous on its own: it means the Sarvam leg
    // never rejected, but it equally means the leg never RAN — with
    // STT_PROVIDER left at groq, nothing Sarvam-related executes and nothing
    // is logged, so a misconfiguration is indistinguishable from success.
    // Printing the resolved values once at startup makes "which engine is
    // actually serving dictation?" answerable from the first page of logs.
    console.log(
      `[stt] config: provider=${cfg.STT_PROVIDER}` +
      ` sarvamKey=${cfg.SARVAM_API_KEY ? "set" : "MISSING"}` +
      ` sarvamModel=${cfg.SARVAM_STT_MODEL} mode=${cfg.SARVAM_STT_MODE}` +
      ` groqKey=${cfg.GROQ_API_KEY ? "set" : "missing"}` +
      ` live=${cfg.STT_LIVE_PROVIDER} liveDual=${cfg.STT_LIVE_DUAL}`,
    );
    if (cfg.STT_PROVIDER !== "auto" && cfg.SARVAM_API_KEY) {
      console.warn(
        `[stt] WARNING: SARVAM_API_KEY is set but STT_PROVIDER=${cfg.STT_PROVIDER}` +
        " — Sarvam is NOT being used for one-shot dictation. Set STT_PROVIDER=auto" +
        " to run it alongside Whisper and keep the better transcript.",
      );
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
