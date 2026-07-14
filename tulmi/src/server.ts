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
import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import transcribeStream from "./routes/transcribe-stream.js";
import { registerMediaRoutes, loadMediaRegistry, getMediaRegistry } from "./routes/media.js";
import { PRIVACY_POLICY_HTML, PRIVACY_POLICY_EFFECTIVE } from "./routes/policies/privacy.js";
import { TERMS_HTML, TERMS_EFFECTIVE } from "./routes/policies/terms.js";
import { getConfig, VERSION } from "./config.js";
import { resolveUser, supabase, type AuthedUser } from "./auth/supabase.js";
import { enforceQuota, recordUsage, usageSummary, usageWindows } from "./usage/metering.js";
import { captureException, fastifyLoggerOptions, initSentry } from "./observability.js";
import { getProfile, updateProfile } from "./profile/store.js";
import { runPipeline, runPipelineStream } from "./pipeline/index.js";
import { clean, draftReply, inferStyle, refineWithTone, LLM_TONES, expandSnippets } from "./pipeline/cleanup.js";
import { detectCommand } from "./pipeline/commands.js";
import { synthesize } from "./pipeline/tts.js";
import {
  getPersonality,
  savePersonality,
  resolvePersonality,
  learnVocabularyCorrections,
} from "./personality/store.js";
import {
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
  bodyLimit: 50 * 1024 * 1024, // 50 MB — generous ceiling for an audio clip
  // Trust the reverse proxy (Nginx / Caddy) so `req.ip` reports the real
  // client IP from X-Forwarded-For rather than 127.0.0.1. Without this every
  // caller shares the same rate-limit bucket — a single burst 429s everyone.
  trustProxy: true,
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
  keyGenerator: (req) => {
    const auth = req.headers["authorization"];
    if (typeof auth === "string" && auth.length > 7) {
      // Hash the bearer so log lines / error reports never carry raw JWTs, and
      // so an attacker rotating a fake token can't "look" like a fresh user
      // per request. Truncated to 24 hex = 96 bits, plenty for a rate-limit key.
      const tok = auth.replace(/^Bearer\s+/i, "").trim();
      return "u:" + createHash("sha256").update(tok).digest("hex").slice(0, 24);
    }
    return "ip:" + req.ip;
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

  // Iterate multipart parts: one file ("audio") + optional text fields.
  for await (const part of req.parts()) {
    if (part.type === "file") {
      format = formatFromFilename(part.filename) ?? "m4a";
      audio = await part.toBuffer();
    } else if (part.fieldname === "targetApp") {
      targetApp = String(part.value);
    } else if (part.fieldname === "language") {
      language = String(part.value) as LanguageHint;
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

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  const t0 = Date.now();
  try {
    const personality = await resolvePersonality(user, personalityOverride);
    const result = await runPipeline({
      audio,
      format,
      targetApp,
      language,
      personality,
      variables: { email: user.email },
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
  const over = tooLong(body.text);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  const t0 = Date.now();
  try {
    const personality = await resolvePersonality(user, body.personality);
    // Typed input supports command mode too — a user can end their text with
    // "…MAKE IT SHORTER" and get the same per-run override as a voice caller.
    const { transcript, command } = detectCommand(body.text);
    const refinedText = await clean(transcript, {
      targetApp: body.targetApp,
      language: body.language,
      personality,
      command: command ?? undefined,
      variables: { email: user.email },
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

app.post("/v1/refine/none", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
  const body = (req.body ?? {}) as { text?: string; language?: string };
  if (!body.text || !body.text.trim()) return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
  const over = tooLong(body.text);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });
  try {
    const personality = await getPersonality(user);
    // Snippet expansion only — no LLM.
    const refinedText = expandSnippets(body.text.trim(), personality.snippets, { targetApp: "Generic" });
    const usage = { audioSeconds: 0, words: countWords(refinedText), model: "none" };
    return reply.send({ refinedText, usage });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Refine failed" });
  }
});

for (const toneId of LLM_TONES) {
  app.post(`/v1/refine/${toneId}`, { config: AUTHED_RL }, async (req, reply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });
    const body = (req.body ?? {}) as { text?: string; language?: string };
    if (!body.text || !body.text.trim()) return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
    const over = tooLong(body.text);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });
    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
    const t0 = Date.now();
    try {
      const personality = await getPersonality(user);
      // Command mode still applies — a user can tack "…MAKE IT SHORTER"
      // on the end and the detected command overrides the tone prompt for
      // that run. Applied outside the tone module so tonePrompts stays
      // single-purpose.
      const { transcript, command } = detectCommand(body.text);
      const refinedText = await refineWithTone(transcript, toneId, {
        language: body.language,
        personality,
      });
      // If the user issued a command, apply it as a second-pass tweak.
      // Keeps the tone prompt uncontaminated by command wording.
      const finalText = command
        ? await clean(refinedText, { language: body.language, personality, command, variables: { email: user.email } })
        : refinedText;
      const usage = {
        audioSeconds: 0,
        words: countWords(finalText),
        model: cfg.CLEANUP_MODEL,
      };
      await recordUsage({ user, source: "rest", ...usage });
      await appendHistoryEntry(user, personality, {
        kind: "typing",
        targetApp: "Generic",
        language: body.language,
        input: body.text,
        output: finalText,
        durationMs: Date.now() - t0,
        wordsIn: countWords(body.text),
        wordsOut: usage.words,
      });
      return reply.send({ refinedText: finalText, usage });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Refine failed" });
    }
  });
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
    const draftText = await draftReply(
      body.screenContent ?? "",
      body.intent,
      {
        targetApp: body.targetApp,
        language: body.language,
        personality,
        variables: { email: user.email },
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
  const over =
    tooLong(personality.tone) ??
    tooLong(personality.signature) ??
    tooLong(personality.customInstructions) ??
    tooLong(personality.vocabulary) ??
    tooLong(personality.snippets);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });
  try {
    // Merge the partial update into the existing profile so a PUT with just
    // { activePresetId } doesn't blow away the user's vocabulary, sign-off,
    // and pinned list. Full replace was the wrong contract now that the new
    // personality screen makes small, frequent updates.
    const existing = await getPersonality(user);
    await savePersonality(user, { ...existing, ...personality });
    const res: PersonalityResponse = { personality: { ...existing, ...personality } };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to save personality" });
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
    const existing = await getPersonality(user);
    const current = Array.isArray(existing.pinnedPresetIds) ? [...existing.pinnedPresetIds] : [];
    // Toggle when `pinned` is omitted (star icon UX). Otherwise honor the
    // explicit flag — lets a settings screen force-add or force-remove.
    const explicit = typeof body.pinned === "boolean" ? body.pinned : !current.includes(presetId);
    let next: string[];
    if (explicit) {
      // Add — cap at MAX_PINNED, evicting the oldest to make room. Matches
      // the "star already has 6 → drop the first" UX shipping apps use.
      if (current.includes(presetId)) next = current;
      else next = [...current, presetId].slice(-MAX_PINNED);
    } else {
      next = current.filter((id) => id !== presetId);
    }
    const merged: Personality = { ...existing, pinnedPresetIds: next };
    await savePersonality(user, merged);
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
    const merged = { ...(await getPersonality(user)), ...inferred };
    await savePersonality(user, merged);
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
// several screens back-to-back (4–6 requests), which trips the 20/min unauth
// cap almost immediately. The keyGenerator differentiates keys per-user via
// the token hash, so a real authed user gets their own bucket; anonymous
// callers still share by IP (real IP now, thanks to trustProxy).
app.post("/v1/app/bootstrap", { config: AUTHED_RL }, async (req, reply) => {
  noStoreSdui(reply);
  // Auth is optional here so the shell can boot; when present, the user's
  // profile decides whether onboarding still needs to run.
  const user = await resolveUser(req.headers["authorization"]);
  const profile = user ? await getProfile(user) : null;
  const bootstrap = buildBootstrap({ onboarded: profile?.onboarded ?? false });
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
  const stats =
    user && screenId === "stats" ? await statsForUser(user, "week") : undefined;
  const history =
    user && screenId === "history"
      ? (await listHistory(user, { limit: 50 })).entries
      : undefined;
  const screen = buildScreen(screenId, {
    personality,
    language: profile?.language ?? "auto",
    email: user?.email,
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
  const body = (req.body ?? {}) as { language?: string; onboarded?: boolean };
  const patch: { language?: string; onboarded?: boolean } = {};
  if (typeof body.language === "string") patch.language = body.language;
  if (typeof body.onboarded === "boolean") patch.onboarded = body.onboarded;
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
  const summary = { personality: false, profile: false, usageEvents: 0, authAccount: false };

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

app.get("/v1/keyboard/config", { config: AUTHED_RL }, async (req, reply) => {
  // Personality is per-user — the keyboard uses it to render the quick-swap
  // chip row (pinned presets) + honor the active preset's default tone.
  // Missing/failed auth just returns the config without pins; the keyboard
  // still works, it just shows the built-in tone cycle instead.
  let personality: Personality | undefined;
  try {
    const user = await resolveUser(req.headers["authorization"]);
    if (user) personality = await getPersonality(user);
  } catch { /* keyboard should never fail on personality lookup */ }
  // Cache-Control: no-store — keyboard config carries per-user
  // `kb.personality.pinned` / activeId / activeTone. Any caching layer
  // (nginx, CDN) that indexed the response by URL alone could leak these
  // across users. Same policy as /v1/app/bootstrap and /v1/app/screen.
  noStoreSdui(reply);
  return reply.send(buildKeyboardConfig(personality));
});

// --- Admin: cache control ----------------------------------------------------
//
// A tiny op-tools surface: bump the SDUI cache-version token so every client's
// next bootstrap reports a new value, which forces them to invalidate any
// screens they have cached. Guarded by ADMIN_SECRET (set in .env). When the
// secret isn't set the endpoint refuses every request — no accidental exposure.

app.post("/v1/admin/cache/bump", async (req, reply) => {
  const provided = req.headers["x-admin-secret"];
  const expected = cfg.ADMIN_SECRET;
  if (!expected) {
    return reply
      .code(503)
      .send({ code: "not_configured", message: "ADMIN_SECRET is not set on the server" });
  }
  if (typeof provided !== "string" || provided.length === 0 || provided !== expected) {
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
    const { entries, nextBefore } = await listHistory(user, parsed.data);
    const res: HistoryListResponse = nextBefore ? { entries, nextBefore } : { entries };
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

  instance.get(WS_PATH, { websocket: true }, (socket, req) => {
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
          // Capture transcript + final cleaned text for the (opt-in) history
          // write we do after the pipeline completes.
          let capturedTranscript = "";
          for await (const ev of runPipelineStream({
            audio,
            format,
            targetApp,
            language,
            personality,
            variables: { email: user.email },
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
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
