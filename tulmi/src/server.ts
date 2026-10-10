/**
 * Tulmi backend HTTP/WS server.
 *
 *   GET  /healthz                 → liveness
 *   POST /v1/transcribe-clean     → voice: multipart audio → cleaned text
 *   WS   /v1/transcribe-stream    → voice (live): PCM up, partials/finals down
 *   POST /v1/refine               → typing: text → polished text (autocorrect)
 *   POST /v1/draft                → screen: screen content + intent → reply
 *   POST /v1/edit                 → selection: text + spoken instruction → rewrite
 *   POST /v1/ask                  → screen: screen content + question → answer
 *   POST /v1/speak                → voice out: text → spoken audio (TTS)
 *   GET  /v1/personality          → read the user's saved style profile
 *   PUT  /v1/personality          → save the user's style profile
 *
 * Every output is shaped by the user's personality + the target-app context,
 * resolved here on the backend (the app just sends the inputs).
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import transcribeStream from "./routes/transcribe-stream.js";
import { registerMediaRoutes, loadMediaRegistry, getMediaRegistry } from "./routes/media.js";
import { PRIVACY_POLICY_HTML, PRIVACY_POLICY_EFFECTIVE } from "./routes/policies/privacy.js";
import { TERMS_HTML, TERMS_EFFECTIVE } from "./routes/policies/terms.js";
import { pricingHtml } from "./routes/policies/pricing.js";
import { payCsp, payHtml, type PayOffer } from "./routes/pay.js";
import { DOWNLOAD_PAGE_HTML } from "./routes/download.js";
import { registerSeoRoutes } from "./routes/seo.js";
import { registerNotesRoutes } from "./routes/notes.js";
import { getNote, listNotes } from "./notes/store.js";
import { registerDemoRoutes, sitePage, AUTH_RESUME_SCHEME_URL } from "./routes/demo.js";
import { initControl, registerControlRoutes, requireAdmin, withControl } from "./control/index.js";
import { initPush, pushEngine, registerPushRoutes } from "./push/index.js";
import { registerPushTokenRoutes, SupabasePushTokens } from "./push/tokens.js";
import { registerReviewCodeRoute } from "./routes/reviewCode.js";
import { getConfig, VERSION } from "./config.js";
import { resolveUser, supabase, type AuthedUser } from "./auth/supabase.js";
import { sameSecret } from "./auth/secret.js";
import { localUserId } from "./auth/jwt.js";
import { allowanceFor, enforceQuota, recordUsage, usageSummary } from "./usage/metering.js";
import { recordKeyboardTelemetry } from "./usage/telemetry.js";
import { activeRollouts, bucketFor } from "./experience/rollout.js";
import { captureException, fastifyLoggerOptions, initSentry } from "./observability.js";
import { getProfile, updateProfile, touchLastSeen, type Profile } from "./profile/store.js";
import { applyRevenueCatEvent, getEntitlement, isEntitled } from "./billing/entitlements.js";
import {
  RazorpayError, cancelForUser, checkoutSignatureOk, createSubscription, fetchPlan, fetchSubscription,
  formatPeriod, formatPrice, ownerOf, payCaller as payLinkCaller, payLink, planFor, razorpayReady, SUB_ID,
  syncSubscription, webhookSignatureOk, type Market, type Period, type RzPlan,
} from "./billing/razorpay.js";
import { runPipeline } from "./pipeline/index.js";
import { recentDictations } from "./pipeline/session.js";
import { joinWithSpace } from "./pipeline/join.js";
import { estimateDurationSeconds } from "./pipeline/stt.js";
import {
  assist, draftReply, editSelection, answerAbout, inferStyle, refineVariants, updateStylePortrait, LLM_TONES,
  portraitFromUsage, converseTurn, portraitFromTranscript, spokenLanguage, type ConverseTurn,
} from "./pipeline/cleanup.js";
import { mergePortraitWords } from "./pipeline/portraitDimensions.js";
import { synthesize } from "./pipeline/tts.js";
import {
  getPersonality,
  resolvePersonality,
  upsertPresetTone,
  updatePersonality,
} from "./personality/store.js";
import { PERSONALITY_PRESETS, applyPresetOverrides } from "./experience/personalityPresets.js";
import { DEFAULT_TTS_VOICE, isValidTtsVoice } from "./experience/ttsVoices.js";
import {
  type KeyboardPlatform,
  buildBootstrap,
  buildScreen,
  buildKeyboardConfig,
  bumpCacheVersion,
  currentCacheVersion,
  setMediaRegistryAccessor,
  PAYWALL_CONFIG, POLICY,
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
  AskRequest,
  AskResponse,
  DraftRequest,
  DraftResponse,
  EditRequest,
  EditResponse,
  HealthResponse,
  HistoryListResponse,
  LanguageHint,
  Personality,
  PersonalityResponse,
  RefineRequest,
  RefineResponse,
  SpeakRequest,
  TargetAppHint,
  FieldKind,
} from "../../shared/types/api.js";
import { cleanLabel, fieldKindOf } from "./pipeline/field.js";
import { capSurroundings } from "./pipeline/sensitive.js";

/**
 * Learn from ordinary use, ONCE PER SESSION, off the user's path.
 *
 * A session is a run of refines with no gap longer than
 * PORTRAIT_SESSION_GAP_MINUTES. The roll-up fires on the FIRST refine after
 * such a gap, which reads back the sitting that just ended — so the user
 * coming back is itself the trigger, and there are no timers or background
 * jobs anywhere. One consequence worth knowing: the last session before
 * someone stops using the app waits until they return. Nothing is lost.
 *
 * A second trigger backstops a session that never ends. Someone dictating all
 * afternoon would otherwise never cross a gap, so every PORTRAIT_LEARN_EVERY
 * refines within one sitting also rolls up.
 *
 * Fire-and-forget after the response has gone out, and the whole body is
 * wrapped: a portrait that fails to update is invisible, a refine that throws
 * because of it is not.
 */
function learnFromUsage(user: AuthedUser, personality: Personality): void {
  const cfg = getConfig();
  if (!cfg.PORTRAIT_LEARN_EVERY) return;
  void (async () => {
    try {
      const now = Date.now();
      const sp = personality.stylePortrait;
      const last = sp?.lastSeenAt ? Date.parse(sp.lastSeenAt) : 0;
      const gapMs = cfg.PORTRAIT_SESSION_GAP_MINUTES * 60_000;
      // A new sitting has started when the previous refine is older than the
      // gap. The very first refine ever is a new sitting too, but there is
      // nothing behind it to read, so it only opens the session.
      const newSession = !!last && now - last > gapMs;
      const seen = (sp?.observed ?? 0) + 1;
      const longSession = seen >= cfg.PORTRAIT_LEARN_EVERY;

      if (!newSession && !longSession) {
        await updatePersonality(user, (existing) => ({
          ...existing,
          stylePortrait: {
            ...existing.stylePortrait,
            observed: seen,
            lastSeenAt: new Date(now).toISOString(),
            firstSeenAt: existing.stylePortrait?.firstSeenAt ?? new Date(now).toISOString(),
          },
        }));
        return;
      }

      const { entries } = await listHistory(user, { limit: cfg.PORTRAIT_LEARN_WINDOW });
      const next = await portraitFromUsage(
        sp,
        entries.map((e) => ({
          input: e.input, output: e.output, targetApp: e.targetApp, createdAt: e.createdAt,
        })),
        sp?.tzOffsetMinutes,
      );
      await updatePersonality(user, (existing) => ({
        ...existing,
        stylePortrait: {
          ...existing.stylePortrait,
          // A null reply means too little evidence or a bad completion. The
          // counters still move: retrying the same thin window on every refine
          // would burn a call each time and still learn nothing.
          ...(next
            ? {
                ...(next.core ? { core: next.core } : {}),
                // WORDS ACCUMULATE, everything else is a fresh read. Someone's
                // slang is learned a term at a time over months, and a
                // replace would forget every word that happened not to come up
                // in the last forty messages.
                words: mergePortraitWords(existing.stylePortrait?.words, next.words),
                ...(next.styles?.length ? { styles: next.styles } : {}),
                ...(next.rhythms?.length ? { rhythms: next.rhythms } : {}),
                updatedAt: new Date(now).toISOString(),
              }
            : {}),
          observed: 0,
          // Sittings, not roll-ups: the long-session backstop must not inflate
          // the number the writer uses to decide how settled the portrait is.
          sessions: (existing.stylePortrait?.sessions ?? 0) + (newSession ? 1 : 0),
          lastSeenAt: new Date(now).toISOString(),
          firstSeenAt: existing.stylePortrait?.firstSeenAt ?? new Date(now).toISOString(),
        },
      }));
    } catch {
      // Learning is a nice-to-have riding on a request that already succeeded.
    }
  })();
}

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

const isClientError = (err: { statusCode?: number }) =>
  !!err.statusCode && err.statusCode >= 400 && err.statusCode < 500;

// Route unhandled errors through the observability layer (Sentry when
// configured, console otherwise) — the error handler below writes the
// response, this only tees the event.
//
// 5xx only. A 4xx is the caller's mistake, not the server's, and every 429
// and malformed body used to be reported too — noise that buried real errors,
// and a way for anyone to spend the error-reporting quota by being refused.
app.addHook("onError", async (req, _reply, err) => {
  if (!isClientError(err)) captureException(err, { route: req.routeOptions?.url, method: req.method });
});

// A 5xx says that something failed, never what. Fastify's default handler
// puts err.message in the body, and for an unexpected throw that is an
// internal detail — a file path, an SQL error, an upstream's own words. The
// full error goes to the log (and Sentry, via onError above); 4xx keep
// Fastify's shape, since their message is written for the caller.
app.setErrorHandler((err, req, reply) => {
  if (isClientError(err)) return reply.code(err.statusCode!).send(err);
  req.log.error({ err }, "request failed");
  return reply.code(500).send({ code: "internal", message: "Something went wrong. Try again in a moment." });
});

// Every HTML page this server renders (the site, the policies, the SEO pages,
// the auth callback, the admin console) goes out with the headers that stop
// it being framed or content-sniffed. A route that sets its own wins.
app.addHook("onSend", async (_req, reply, payload) => {
  if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) {
    reply.header("X-Content-Type-Options", "nosniff");
    if (!reply.hasHeader("X-Frame-Options")) reply.header("X-Frame-Options", "DENY");
    if (!reply.hasHeader("Referrer-Policy")) reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  return payload;
});

/**
 * A SCREEN IS JSON THAT REPEATS ITSELF — every text names its face, size and
 * colour — so it packs down hard: the Stats tab, with a month of days behind
 * it, is ~250 KB as text and ~12 KB gzipped; the keyboard's config is 42 KB
 * and 9 KB. The phone, the keyboards and the desktop all ask for gzip and
 * undo it themselves. Small replies go as they are.
 */
const gzipped = promisify(gzip);
async function gzipLargeJson(req: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> {
  if (typeof payload !== "string" || payload.length < 8_192) return payload;
  if (!/\bgzip\b/i.test(String(req.headers["accept-encoding"] ?? ""))) return payload;
  if (reply.hasHeader("content-encoding")) return payload;
  reply.header("content-encoding", "gzip");
  reply.header("vary", "accept-encoding");
  reply.removeHeader("content-length");
  return gzipped(payload);
}

// AN EMPTY JSON BODY IS NOT A MALFORMED ONE.
//
// Fastify's default parser rejects `content-type: application/json` with no
// body outright — FST_ERR_CTP_EMPTY_JSON_BODY, 400, thrown before any handler
// runs. The app sets that header on every request it makes and only attaches a
// body when it has one, so DELETE /v1/account arrived as a header with nothing
// behind it and was refused at the door.
//
// Which is how Delete account came to be a button that could never work. The
// request left the phone, reached the server, and was turned away by the
// parser; the handler was never entered, nothing was ever deleted, and the app
// showed "Couldn't delete the account" no matter how many times it was tapped.
// Every endpoint the app calls without a body had the same hole.
//
// Empty now means `{}`, which is what a body-less request means. Malformed
// JSON still fails, exactly as before — this widens what is accepted by one
// case, the empty one, and nothing else.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string", bodyLimit: 1 * 1024 * 1024 },
  (req, body, done) => {
    // Razorpay signs the body exactly as sent, so its webhook keeps it.
    if (typeof body === "string" && req.url.startsWith("/v1/billing/razorpay")) {
      (req as unknown as { rawBody?: string }).rawBody = body;
    }
    const raw = typeof body === "string" ? body.trim() : "";
    if (raw === "") return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  },
);

// One file, and a handful of text fields: the most any route reads is six
// (/v1/transcribe-clean). Unbounded, a single request could stream field after
// field for as long as the connection stayed open.
await app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 20 },
});
// One frame is a few KB of PCM (the largest a client sends is its pre-roll,
// ~96 KB). The library default is 100 MB per frame, buffered whole before any
// route code can refuse it.
await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

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
  // THE CLICK IS THE DOWNLOAD. An installer is never something to show in
  // a tab, so it is named as an attachment: the site's Download button
  // starts the file and the page stays where it was.
  setHeaders(res, filePath) {
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
  },
});

// --- Typefaces for the phone app ---------------------------------------------
// The app bundles no fonts and loads the ones the bootstrap names (FONTS in
// experience/catalog.ts) from here, so a change of typeface is a deploy, not
// a store release. Shipped in the image (tulmi/fonts); OFL.txt is their
// licence. The names in catalog.ts carry a ?v= so a changed file is a new URL.
const FONTS_DIR = process.env.FONTS_DIR || path.join(process.cwd(), "fonts");
if (fs.existsSync(FONTS_DIR)) {
  await app.register(fastifyStatic, {
    root: FONTS_DIR,
    prefix: "/fonts/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "365d",
    immutable: true,
  });
}

await app.register(transcribeStream);

/** The one answer to a request with no valid session. */
const unauthorized = (reply: FastifyReply) =>
  reply.code(401).send({ code: "unauthorized", message: "Missing or invalid token" });

/** A client-sent value made safe to log: printable ASCII, bounded. */
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[^\x20-\x7E]/g, "").slice(0, n);

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** A client-sent UTC offset in minutes, clamped to the real range, or
 *  undefined when absent or out of range. Prefer it over the stored one. */
function reqTz(v: unknown, stored?: number): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 14 * 60) return Math.round(v);
  return stored;
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

/**
 * Bound a personality the CLIENT sent, whether to save it (PUT /v1/personality)
 * or to use it for one request in place of the saved one (the `personality`
 * override on /v1/transcribe-clean, /v1/refine, /v1/draft). Either way its
 * text reaches the prompt, so it gets the same ceilings in both places — the
 * override used to skip them and carry up to the 1 MB body limit of unmetered
 * prompt. Normalises `languages` in place. Returns the refusal, or null.
 */
function personalityProblem(p: Personality | undefined): { status: 400 | 413; message: string } | null {
  if (p == null) return null;
  if (typeof p !== "object" || Array.isArray(p)) return { status: 400, message: "personality must be an object" };
  // Every selected language becomes an exemplar in the recognizer's prompt, so
  // an unbounded array is unbounded prompt. Twenty is far past any real answer.
  if (p.languages !== undefined) {
    if (!Array.isArray(p.languages)) return { status: 400, message: "languages must be an array" };
    p.languages = p.languages
      .filter((l): l is string => typeof l === "string")
      .map((l) => l.trim().toLowerCase().slice(0, 16))
      .filter(Boolean)
      .slice(0, 20);
  }
  // The read-aloud voice is forwarded to OpenAI verbatim, so only an id from
  // the curated set is ever let through. An invalid one is dropped in place
  // (like a bad language above) rather than rejected — a PUT that also changed
  // other fields still saves them, and the stored/default voice is kept — but
  // it is never stored, so arbitrary input can never reach the synthesis call.
  if (p.ttsVoice !== undefined && !isValidTtsVoice(p.ttsVoice)) {
    delete p.ttsVoice;
  }
  const over = tooLong(p.tone) ?? tooLong(p.signature) ?? tooLong(p.customInstructions)
    ?? tooLong(p.vocabulary) ?? tooLong(p.snippets);
  return over ? { status: 413, message: over } : null;
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
  // The published site wins; this file's copy is the fallback, so the legal
  // text is never unreachable even if the site directory is empty.
  const published = sitePage(cfg.SITE_DIR, "privacy");
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", published ? "public, max-age=60" : "public, max-age=3600");
  return published ?? PRIVACY_POLICY_HTML;
});

app.get("/terms", async (_req, reply) => {
  const published = sitePage(cfg.SITE_DIR, "terms");
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", published ? "public, max-age=60" : "public, max-age=3600");
  return published ?? TERMS_HTML;
});

// The prices, on a page of their own (tailzu.space/pricing), linked from the
// site's footer rather than set on the landing page. Built from the paywall's
// plans and the allowance the server enforces, so the three never disagree.
app.get("/pricing", async (_req, reply) => {
  const published = sitePage(cfg.SITE_DIR, "pricing");
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", "public, max-age=300");
  return published ?? pricingHtml({
    free: cfg.FREE_FOR_ALL,
    plans: PAYWALL_CONFIG.plans,
    freeWords: cfg.FREE_MONTHLY_WORDS,
    earnMaxWords: cfg.EARN_MAX_WORDS,
    terms: POLICY.terms,
    privacy: POLICY.privacy,
  });
});

// Tailzu's pay page (tailzu.space/pay): where the desktop's Subscribe
// goes. Both markets' plans at Razorpay's prices; the browser picks one.
app.get("/pay", async (req, reply) => {
  // Nothing is sold while Tailzu is free: the page that would take a
  // payment sends people to the one that says so — unless it is a test link
  // (scripts/paylink.sh), proving the live checkout before launch.
  const q = (req.query ?? {}) as Record<string, string>;
  if (cfg.FREE_FOR_ALL && !payLinkCaller(q)?.test) return reply.redirect("/pricing", 302);
  const nonce = randomBytes(16).toString("base64");
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", "no-store");
  reply.header("Content-Security-Policy", payCsp(nonce));
  return payHtml({
    keyId: razorpayReady() ? cfg.RAZORPAY_KEY_ID : "",
    offers: await payOffers(),
    nonce,
    pricing: "https://tailzu.space/pricing",
    terms: POLICY.terms,
    privacy: POLICY.privacy,
  });
});

/**
 * The plans the pay page shows, for both markets: each plan on sale, named
 * as the app names it (Elite yearly, Lite monthly) and priced as Razorpay
 * holds it. The saving is worked out per market from those prices, never
 * carried over from the store prices, which may not match.
 */
async function payOffers(): Promise<PayOffer[]> {
  const label = (period: Period) => PAYWALL_CONFIG.plans.find((p) => p.id === period)?.label ?? period;
  const perYear = (p: RzPlan | null) =>
    p ? (p.period === "yearly" ? 1 : p.period === "monthly" ? 12 : 0) / Math.max(1, p.interval) : 0;
  const offers: PayOffer[] = [];
  for (const market of ["IN", "world"] as Market[]) {
    const m = planFor(market, "monthly");
    const a = planFor(market, "annual");
    const [monthly, annual] = await Promise.all([m ? fetchPlan(m.id) : null, a ? fetchPlan(a.id) : null]);
    let badge: string | undefined;
    if (monthly && annual && monthly.item.currency === annual.item.currency && perYear(monthly) && perYear(annual)) {
      const save = 1 - (annual.item.amount * perYear(annual)) / (monthly.item.amount * perYear(monthly));
      // To the nearest whole percent: ₹5,999 against twelve of ₹999 is 49.96%,
      // which is "Save 50%", not the 45% that rounding down to fives said.
      if (save >= 0.1) badge = `Save ${Math.round(save * 100)}%`;
    }
    for (const [period, configured, plan] of [["monthly", m, monthly], ["annual", a, annual]] as const) {
      if (!configured) continue;
      offers.push(plan
        ? { market, period, label: label(period), price: formatPrice(plan), per: formatPeriod(plan), buyable: true,
            ...(period === "annual" ? { badge, lead: true } : {}) }
        : { market, period, label: label(period), price: "—", per: "Not available right now", buyable: false });
    }
  }
  return offers;
}

/** Throttled per address: these are reached from a public page. Loose,
 *  because through tailzu.space the address is the site proxy's, which many
 *  buyers share. */
const PAY_RL = { config: { rateLimit: { max: 30, timeWindow: 60_000 } } };

/** The caller of a pay-page call: the account its signed link names. */
function payCaller(b: Record<string, unknown>): string | null {
  return payLinkCaller(b)?.userId ?? null;
}

/**
 * A subscription for the caller, made here and never by hand: the plan is
 * one on sale for the market and period asked for, and the account goes in
 * its notes. Refused for an account that already pays — a second
 * subscription on top of a live one bills them twice for the same thing.
 */
app.post("/v1/pay/razorpay/subscription", PAY_RL, async (req, reply) => {
  if (!razorpayReady()) return reply.code(503).send({ code: "not_configured" });
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const userId = payCaller(b);
  if (!userId) return reply.code(401).send({ code: "link_expired" });
  if (cfg.FREE_FOR_ALL && !payLinkCaller(b)?.test) return reply.code(409).send({ code: "free" });
  const market: Market | null = b.market === "IN" ? "IN" : b.market === "world" ? "world" : null;
  const period: Period | null = b.period === "monthly" ? "monthly" : b.period === "annual" ? "annual" : null;
  const plan = market && period ? planFor(market, period) : undefined;
  if (!plan) return reply.code(400).send({ code: "no_such_plan" });
  if (await isEntitled({ id: userId } as AuthedUser).catch(() => false)) {
    return reply.code(409).send({ code: "already_subscribed" });
  }
  try {
    const sub = await createSubscription(userId, plan);
    return reply.send({ subscriptionId: sub.id });
  } catch (err) {
    const e = err as RazorpayError;
    req.log.error({ code: e.code, detail: e.message }, "pay: razorpay refused a subscription");
    return reply.code(502).send({ code: e.code ?? "razorpay", description: e.message });
  }
});

/**
 * The checkout's success, from the buyer's browser: unlocks at once.
 *
 * Two checks. Razorpay's signature, HMAC_SHA256(payment_id|subscription_id)
 * with the key secret, says the payment is real; the subscription's own
 * notes, read back from Razorpay, must name the caller, or the payment is
 * someone else's being replayed. Then its current state is saved.
 */
app.post("/v1/pay/razorpay/verify", PAY_RL, async (req, reply) => {
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const userId = payCaller(b);
  if (!userId) return reply.code(401).send({ ok: false, code: "link_expired" });
  const paymentId = String(b.razorpay_payment_id ?? "");
  const subId = String(b.razorpay_subscription_id ?? "");
  if (!SUB_ID.test(subId) || !checkoutSignatureOk(paymentId, subId, String(b.razorpay_signature ?? ""))) {
    return reply.code(400).send({ ok: false, code: "bad_signature" });
  }
  try {
    const sub = await fetchSubscription(subId);
    if (ownerOf(sub) !== userId) return reply.code(403).send({ ok: false, code: "not_yours" });
    const res = await syncSubscription(sub, "checkout");
    req.log.info({ rz: res }, "[billing] razorpay checkout");
    return reply.code(res.ok ? 200 : 500).send({ ok: res.ok, entitled: !!res.entitledUntil && res.entitledUntil > Date.now() });
  } catch (err) {
    req.log.error({ detail: (err as Error).message }, "pay: razorpay verify failed");
    return reply.code(502).send({ ok: false, code: "razorpay" });
  }
});

/**
 * Cancel from inside the app: signed in, for the caller's own subscription.
 * Razorpay is told to stop at the end of the period (cancel_at_cycle_end);
 * access runs to that end.
 */
app.post("/v1/billing/razorpay/cancel", { config: { rateLimit: { max: 10, timeWindow: 60_000 } } }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  try {
    const res = await cancelForUser(user.id);
    if (!res.ok) return reply.code(404).send({ code: res.code ?? "no_subscription" });
    const until = res.until ? new Date(res.until) : null;
    return reply.send({
      ok: true,
      until: until?.toISOString() ?? null,
      message: until
        ? `Cancelled. Unlimited stays on until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`
        : "Cancelled. Unlimited stays on until the end of the period you paid for.",
    });
  } catch (err) {
    const e = err as RazorpayError;
    req.log.error({ code: e.code, detail: e.message }, "pay: razorpay refused a cancel");
    return reply.code(502).send({ code: e.code ?? "razorpay" });
  }
});

// What went wrong in a buyer's checkout, in the checkout's own words. The pay
// page sends Razorpay's error code here when a payment or the checkout fails,
// so the cause is one grep away:
//   docker compose logs --since 1h | grep "pay:"
// Unauthenticated by necessity (the buyer is on a web page), so it is capped,
// trimmed to printable text and only ever logged.
app.post("/v1/pay/report", { config: { rateLimit: { max: 20, timeWindow: 60_000 } } }, async (req, reply) => {
  const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const code = clip(b.code, 80);
  if (code) req.log.warn({ where: clip(b.where, 20), code, detail: clip(b.detail, 600) }, "pay: checkout failed");
  return reply.code(204).send();
});

// OS-aware desktop-app download page (tailzu.space/download). The page itself
// HEAD-checks /downloads/* so platforms without a published installer show as
// "coming soon" instead of a dead link.
app.get("/download", async (_req, reply) => {
  const published = sitePage(cfg.SITE_DIR, "download");
  reply.type("text/html; charset=utf-8");
  reply.header("Cache-Control", published ? "public, max-age=60" : "public, max-age=3600");
  return published ?? DOWNLOAD_PAGE_HTML;
});

// What search and answer engines read: the language pages, the questions, the
// sitemap and llms.txt. Served through the site's proxy, canonical at
// tailzu.space, built from seo/facts.ts like every other page's facts.
registerSeoRoutes(app);

// The landing page at /, its copy at /v1/site, and the live demo — a visitor's
// own voice written clean, no account. See routes/demo.ts for why the demo is
// off by default and how it is bounded when on.
registerDemoRoutes(app, {
  downloadsDir: DOWNLOADS_DIR,
  siteDir: cfg.SITE_DIR,
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

const MAX_CLIP_SECONDS = 15 * 60;

function formatFromFilename(name: string | undefined): AudioFormat | null {
  const ext = name?.split(".").pop()?.toLowerCase() as AudioFormat | undefined;
  return ext && ALLOWED_FORMATS.includes(ext) ? ext : null;
}

const AUTHED_RL = {
  rateLimit: { max: cfg.RATE_LIMIT_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS },
};

// --- The control plane ------------------------------------------------------
// Live rules over every payload the server sends — see src/control. The
// console is GET /admin; the rules live on the tulmi_control volume.
initControl({ dir: process.env.CONTROL_DIR || "/data/control" });
registerControlRoutes(app, { bumpCache: bumpCacheVersion, rateLimit: AUTHED_RL });
// Smart notifications: the engine is built here (routes need it), started in
// main() once the server listens.
if (cfg.PUSH_ENGINE) initPush({ accessToken: cfg.EXPO_ACCESS_TOKEN });
registerPushRoutes(app, { rateLimit: AUTHED_RL });
// The desktop's note-taker: a hotkey, the room's audio, notes kept in the app.
registerNotesRoutes(app, { rateLimit: AUTHED_RL, effectiveLanguage });
// UNAUTH_RL removed — every previously-unauth route was gated on
// per-user hashed tokens anyway, so AUTHED_RL is the right cap and
// avoids the 429-storm we saw on /v1/keyboard/config launch traffic.

// The fixed review pair. 404s unless BOTH REVIEW_EMAIL and REVIEW_CODE are set,
// so in ordinary operation this route does not exist. See routes/reviewCode.ts.
//
// ITS OWN LIMIT, far below the app's.
//
// The code has to be SIX DIGITS — the code screen strips non-digits and
// truncates to six, because it is the same screen every user types an emailed
// code into, and giving the reviewer a different one would prove nothing about
// the flow being reviewed. So the secret is one of a million, standing behind
// an address that every client is told.
//
// A million falls to the app's ordinary limiter in days. Eight attempts a
// quarter-hour turns it into years, which is longer than the pair is meant to
// exist: it is set for a submission and cleared when review passes. The
// reviewer needs one attempt, and two if they fumble.
registerReviewCodeRoute(app, {
  rateLimit: { max: 8, timeWindow: 15 * 60_000 },
});

app.post("/v1/transcribe-clean", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);

  let audio: Buffer | null = null;
  let format: AudioFormat | null = null;
  let targetApp: TargetAppHint | undefined;
  let language: LanguageHint | undefined;
  let personalityOverride: Personality | undefined;
  let context: string | undefined; // whatever's already in the field, if any
  let fieldKind: FieldKind | undefined; // what kind of field, when the client read it
  let fieldLabel: string | undefined; // its label or placeholder, cleaned
  let surroundings: string | undefined; // what is on the screen around the field
  let privateField = false; // a private window or a sensitive app: screen off limits
  let tzOffsetMinutes: number | undefined; // the device's current UTC offset
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
    } else if (part.fieldname === "fieldKind") {
      fieldKind = fieldKindOf(part.value);
    } else if (part.fieldname === "fieldLabel") {
      fieldLabel = cleanLabel(part.value, 60);
    } else if (part.fieldname === "surroundings") {
      surroundings = capSurroundings(part.value);
    } else if (part.fieldname === "privateField") {
      privateField = part.value === "true" || part.value === "1";
    } else if (part.fieldname === "tzOffsetMinutes") {
      const n = Number(part.value); if (Number.isFinite(n)) tzOffsetMinutes = n;
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
  // The live route's ceiling (~15 minutes), for the same reason: past it the
  // recognisers refuse the file anyway (OpenAI's cap is 25 MB), and a clear
  // answer beats a failed pipeline after the upload. Read from the container
  // header where there is one (wav, m4a); others are bounded by the 50 MB
  // multipart cap alone.
  if (estimateDurationSeconds(audio, format) > MAX_CLIP_SECONDS) {
    return reply.code(413).send({
      code: "audio_too_long",
      message: "That recording is longer than 15 minutes. Record it in shorter parts.",
    });
  }

  // The multipart text fields feed the LLM prompt exactly like /v1/refine's
  // JSON body does — cap them the same way (multipart's own fieldSize limit is
  // ~1 MiB, far above MAX_TEXT_LENGTH).
  const fieldOver = tooLong(context) ?? tooLong(tonePrompt);
  if (fieldOver) return reply.code(413).send({ code: "bad_request", message: fieldOver });
  const badPersonality = personalityProblem(personalityOverride);
  if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  const t0 = Date.now();
  try {
    // The session is read while everything else is: it waits on nothing.
    const recentRead = recentDictations(user);
    const personality = personalityOverride ?? await getPersonality(user);
    const lang = await effectiveLanguage(user, language, personality);
    const result = await runPipeline({
      audio,
      format,
      targetApp,
      fieldKind,
      fieldLabel,
      surroundings,
      privateField,
      language: lang,
      personality,
      tone: tone ?? personality.activeTone,
      tonePrompt,
      context,
      variables: { email: user.email, phone: user.phone },
      recent: await recentRead,
      tzOffsetMinutes: reqTz(tzOffsetMinutes, personality.stylePortrait?.tzOffsetMinutes),
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
        // Whose voice wrote it. Without these the Voices card could only ever
        // show the tone currently selected, which is a setting, not a habit.
        tone: tone ?? personality.activeTone,
        presetId: personality.activePresetId,
        // Read only to tell the next stretch of this dictation from a new
        // one, so a dictation written pause by pause is one History card.
        context,
      },
      result.usage.audioSeconds,
    );
    learnFromUsage(user, personality);
    return reply.send(result);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Pipeline failed" });
  }
});

// --- Typing (REST): refine typed text ---------------------------------------
//
//   POST /v1/refine          body.tone (else the active tone), and optionally a
//                            whole `personality` to use in place of the saved one
//   POST /v1/refine/<tone>   the route IS the tone; the saved personality
//
// One per tone so the client can pick the endpoint from the user's active
// tone; /v1/refine stays for legacy callers. All of them share one brain,
// assist(): it separates any embedded instruction ("…make it shorter, in
// bullet points") from the message, writes in the tone, and uses body.context
// (whatever is already in the field) as the draft or conversation to continue
// or reply to. An inline tonePrompt still wins on the per-tone routes, so a
// custom tone can reuse them and the route's tone is just the label/default.
// "none" does not restyle: it keeps the user's own voice and repairs only what
// speaking or thumb-typing cost them.
const refineRoute = (routeTone?: string) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await resolveUser(req.headers["authorization"]);
    if (!user) return unauthorized(reply);

    const body = (req.body ?? {}) as RefineRequest;
    if (!body.text || !body.text.trim()) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
    }
    // Cap EVERY prompt-bound field, not just body.text — context, tonePrompt
    // and `alternative` (a second recognizer's reading, forwarded by the live
    // path) reach the prompt too, and uncapped they let one request smuggle up
    // to the 1 MB bodyLimit of unmetered input tokens past MAX_TEXT_LENGTH.
    const over =
      tooLong(body.text) ?? tooLong(body.context) ?? tooLong(body.tonePrompt) ?? tooLong(body.alternative);
    if (over) return reply.code(413).send({ code: "bad_request", message: over });
    const override = routeTone ? undefined : body.personality;
    const badPersonality = personalityProblem(override);
    if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

    const quota = await enforceQuota(user);
    if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

    const t0 = Date.now();
    try {
      const recentRead = recentDictations(user);
      const personality = override ?? await getPersonality(user);
      const tone = routeTone ?? body.tone ?? personality.activeTone;
      const lang = await effectiveLanguage(user, body.language, personality);
      const refinedText = await assist(body.text, {
        tone,
        tonePrompt: body.tonePrompt,
        context: body.context,
        targetApp: body.targetApp,
        fieldKind: fieldKindOf(body.fieldKind),
        fieldLabel: cleanLabel(body.fieldLabel, 60),
        surroundings: capSurroundings(body.surroundings),
        privateField: body.privateField === true,
        language: lang,
        // A second engine's reading of the same speech, when the live path saw
        // the two disagree — reconciled before the writing task.
        alternative: body.alternative,
        personality,
        variables: { email: user.email, phone: user.phone },
        // What they dictated in the last few minutes, read by the server
        // (never sent by a client), with where and when.
        recent: await recentRead,
        tzOffsetMinutes: reqTz(body.tzOffsetMinutes, personality.stylePortrait?.tzOffsetMinutes),
      });
      const usage = { audioSeconds: 0, words: countWords(refinedText), model: cfg.CLEANUP_MODEL };
      await recordUsage({ user, source: "rest", ...usage });
      await appendHistoryEntry(user, personality, {
        kind: "typing",
        targetApp: body.targetApp || (routeTone ? "Generic" : undefined),
        language: body.language,
        input: body.text,
        output: refinedText,
        durationMs: Date.now() - t0,
        wordsIn: countWords(body.text),
        wordsOut: usage.words,
        tone,
        presetId: personality.activePresetId,
        // A late tail of a dictation already written arrives with that text
        // as its context; it joins the same History card (see coalesce).
        context: body.context,
      });
      learnFromUsage(user, personality);
      // The same join hint /v1/transcribe-clean gives: the live path pastes
      // this after what the field already holds (`context`).
      const res: RefineResponse = { refinedText, usage, joinWithSpace: joinWithSpace(body.context, refinedText) };
      return reply.send(res);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ code: "cleanup_failed", message: "Refine failed" });
    }
  };

app.post("/v1/refine", { config: AUTHED_RL }, refineRoute());
app.post("/v1/refine/none", { config: AUTHED_RL }, refineRoute("none"));
for (const toneId of LLM_TONES) {
  app.post(`/v1/refine/${toneId}`, { config: AUTHED_RL }, refineRoute(toneId));
}

// --- Training (REST): variant generation + style-portrait learning ----------
//
// The Train tab's loop: /variants turns one input into three differently-
// styled refinements; the user taps the one that sounds most like them and
// /pick absorbs that choice into the evolving style portrait
// (personality.stylePortrait), which every refine path then injects into its
// prompt. Tone-scoped picks also train that tone's note.

app.post("/v1/train/variants", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
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
  if (!user) return unauthorized(reply);
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
  // A model call like its siblings, so behind the same gate: without it an
  // account past its allowance could keep the model busy through this route.
  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
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
        ...existing.stylePortrait,
        core: next.core,
        words: mergePortraitWords(existing.stylePortrait?.words, next.words),
        ...(next.styles?.length ? { styles: next.styles } : {}),
        tones: {
          ...(existing.stylePortrait?.tones ?? {}),
          ...(toneKey && next.toneNote ? { [toneKey]: next.toneNote } : {}),
        },
        examples: (existing.stylePortrait?.examples ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      },
    }));
    const examples = merged.stylePortrait?.examples ?? 1;
    // The thread's next two rows come back with the pick: what was taken from
    // it, and the next thing to answer. Sent from here rather than held on the
    // client so the prompts are one server-side list — the app never runs out
    // of them, and changing them is a deploy rather than a release.
    return reply.send({
      ok: true,
      examples,
      learned: `Learned${toneLabel ? ` · ${toneLabel}` : ""}`,
      next: TRAIN_PROMPTS[examples % TRAIN_PROMPTS.length],
    });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Couldn't save your pick" });
  }
});

/**
 * What the Train thread asks next, after a pick.
 *
 * Everyday moments with a real decision in them about how to say something —
 * that is where a person's own register actually shows. Deliberately not
 * generated: an LLM asked for "a texting scenario" writes prompts that all
 * sound the same, and this list costs nothing and never fails.
 */
const TRAIN_PROMPTS = [
  "A friend asks how your week's going. One line.",
  "You're running late. What do you send?",
  "Someone you barely know asks for a favour you'd rather not do.",
  "A friend got good news. First thing you'd write back.",
  "You need to say no to a work thing without making it a whole conversation.",
  "Someone apologises for something small. What do you say?",
  "You're double-booked and have to move a plan. How do you put it?",
  "A friend is having a bad day and hasn't asked for anything.",
  "You forgot to reply for three days. What do you open with?",
  "Someone asks what you did at the weekend.",
];

// --- Training by conversation ----------------------------------------------
//
// The spoken half of the Train tab. /converse answers one turn out loud;
// /portrait reads the whole exchange once, at the end, and rewrites the style
// portrait from it. Split that way on purpose: the reply has a person waiting
// on it and must be fast, the portrait does not and can take the better model.
//
// The transcript is never stored. It arrives in the request body, is used, and
// is gone — what survives a conversation is the portrait it produced.

const TRANSCRIPT_MAX_CHARS = 4 * cfg.MAX_TEXT_LENGTH;

/** Read and bound a transcript from a request body. Shared by both routes. */
function readTurns(raw: unknown): { turns: ConverseTurn[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Missing 'turns'" };
  // A cap on count, on each turn, and on the whole: this body is
  // user-controlled, every character of it reaches an LLM prompt, and none of
  // it is metered. 200 turns of 2,000 used to be 400,000 characters a call.
  if (raw.length > 200) return { error: "Too many turns" };
  const turns: ConverseTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const { role, text } = t as { role?: unknown; text?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed) turns.push({ role, text: trimmed.slice(0, 2000) });
  }
  // Past the whole-transcript ceiling the OLDEST turns go: the reply answers
  // the latest ones, and a portrait has plenty to read in what is left.
  let total = turns.reduce((n, t) => n + t.text.length, 0);
  while (total > TRANSCRIPT_MAX_CHARS && turns.length > 1) total -= turns.shift()!.text.length;
  return turns.length ? { turns } : { error: "Missing 'turns'" };
}

/** Said when the conversation model has nothing usable to say twice running. */
const CONVERSE_KEEP_GOING = "Go on, I'm listening.";

app.post("/v1/train/converse", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  const body = (req.body ?? {}) as { turns?: unknown; language?: string };
  const read = readTurns(body.turns);
  if ("error" in read) return reply.code(400).send({ code: "bad_request", message: read.error });
  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
  try {
    const personality = await getPersonality(user);
    // A reply the meta filter drops ("could you say that again?") used to be
    // a 500, and a 500 ends the spoken session: the person talks into a
    // screen that has stopped. One more try, then a line that keeps them
    // talking — a conversation that pauses is better than one that dies.
    const text = (await converseTurn(read.turns, { personality, language: body.language }))
      || (await converseTurn(read.turns, { personality, language: body.language }))
      || CONVERSE_KEEP_GOING;
    // The MODEL's words are not the person's: nothing they dictated is in
    // this reply, so none of it comes off their allowance. Recorded at zero
    // words so the call still shows in usage.
    await recordUsage({
      user,
      source: "rest",
      audioSeconds: 0,
      words: 0,
      model: getConfig().CLEANUP_MODEL,
    });
    // The voice to say it in, read from the reply itself: a Bengali answer
    // spoken by the English voice the screen opened with is not an answer.
    // Older clients ignore the field and keep the screen's voice.
    const speak = spokenLanguage(text)?.locale;
    return reply.send(speak ? { reply: text, speak } : { reply: text });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't answer that" });
  }
});

app.post("/v1/train/portrait", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  const read = readTurns((req.body as { turns?: unknown } | undefined)?.turns);
  if ("error" in read) return reply.code(400).send({ code: "bad_request", message: read.error });
  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });
  try {
    const personalityNow = await getPersonality(user);
    const next = await portraitFromTranscript(personalityNow.stylePortrait, read.turns);
    // Core only. A conversation is not held in any one voice, so it has
    // nothing to say about a specific tone's note — and merging under the lock
    // keeps the notes the picking loop learned exactly as they were.
    // Over the portrait that is there, not in place of it: this used to write
    // a new object with four fields, and every word, style, rhythm, session
    // count and timezone the rest of the app had learned was gone after one
    // spoken session.
    const merged = await updatePersonality(user, (existing) => ({
      ...existing,
      stylePortrait: {
        ...(existing.stylePortrait ?? {}),
        core: next.core,
        tones: existing.stylePortrait?.tones ?? {},
        examples: (existing.stylePortrait?.examples ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      },
    }));
    return reply.send({ ok: true, examples: merged.stylePortrait?.examples ?? 1 });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Couldn't save what it heard" });
  }
});

// --- Words and snippets, one at a time (the desk's Words page) ---------------
// The vocabulary is one newline-separated string and the snippets another, and
// both are saved whole by PUT /v1/personality. A page with an add field and a
// remove link per row needs to change ONE line without holding the rest, so
// these do that under the personality lock.
const WORD_MAX = 80, SNIP_SAY_MAX = 40, SNIP_GET_MAX = 600, LINES_MAX = 400;
const oneLine = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

app.post("/v1/words", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  const b = (req.body ?? {}) as { add?: unknown; remove?: unknown; kind?: unknown };
  const add = oneLine(b.add, WORD_MAX), remove = oneLine(b.remove, WORD_MAX);
  if (!add && !remove) return reply.code(400).send({ code: "bad_request", message: "Say which word to add or remove" });
  const same = (a: string, z: string) => a.toLowerCase() === z.toLowerCase();
  const merged = await updatePersonality(user, (existing) => {
    let lines = String(existing.vocabulary ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let dictionary = existing.dictionary ?? [];
    if (add && !lines.some((l) => same(l, add))) lines = [...lines, add].slice(-LINES_MAX);
    if (remove) {
      lines = lines.filter((l) => !same(l, remove));
      // A proof mark on the page is a dictionary pair, named by what it is
      // written as.
      if (b.kind === "pair") dictionary = dictionary.filter((d) => !same(String(d.replacement ?? ""), remove));
    }
    return { ...existing, vocabulary: lines.join("\n"), dictionary };
  });
  return reply.send({ ok: true, words: String(merged.vocabulary ?? "").split("\n").filter(Boolean).length });
});

app.post("/v1/snippets", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  const b = (req.body ?? {}) as { say?: unknown; get?: unknown; remove?: unknown };
  const say = oneLine(b.say, SNIP_SAY_MAX).replace(/=/g, ""), remove = oneLine(b.remove, SNIP_SAY_MAX);
  // What it writes may span lines; stored on one, the way the parser reads it.
  const get = String(b.get ?? "").trim().slice(0, SNIP_GET_MAX).replace(/\r?\n/g, "\\n");
  if (!remove && (!say || !get)) return reply.code(400).send({ code: "bad_request", message: "A snippet needs a name and what it writes" });
  const key = (l: string) => l.slice(0, Math.max(0, l.indexOf("="))).trim().toLowerCase();
  await updatePersonality(user, (existing) => {
    let lines = String(existing.snippets ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes("="));
    if (remove) lines = lines.filter((l) => key(l) !== remove.toLowerCase());
    if (say && get) lines = [...lines.filter((l) => key(l) !== say.toLowerCase()), `${say} = ${get}`].slice(-LINES_MAX);
    return { ...existing, snippets: lines.join("\n") };
  });
  return reply.send({ ok: true });
});

// --- Screen (REST): draft a personalized reply ------------------------------

app.post("/v1/draft", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);

  const body = (req.body ?? {}) as DraftRequest;
  if (!body.intent || !body.intent.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'intent'" });
  }
  const tooBig = tooLong(body.intent) ?? tooLong(body.screenContent) ?? tooLong(body.recipient);
  if (tooBig) return reply.code(413).send({ code: "bad_request", message: tooBig });
  const badPersonality = personalityProblem(body.personality);
  if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

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
      tone: personality.activeTone,
      presetId: personality.activePresetId,
    });
    const res: DraftResponse = { draftText, usage };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Draft failed" });
  }
});

// --- Selection (REST): voice-edit the selected text -------------------------
//
// The desktop's "edit the selection out loud": the user highlights some text
// and says what to do with it. editSelection() rewrites the TEXT to follow the
// INSTRUCTION and returns only the rewritten text, to replace the selection in
// place. It produces user-facing written text, so — like /v1/refine — it meters
// the output words, writes a typing-history row (the instruction as input, the
// original selection as context) and learns from the use.
app.post("/v1/edit", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);

  const body = (req.body ?? {}) as EditRequest;
  // BOTH are required: nothing to rewrite, or nothing to do, is a bad request.
  if (!body.text || !body.text.trim() || !body.instruction || !body.instruction.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'text' and 'instruction'" });
  }
  // Cap every prompt-bound field, same as /v1/refine: text + instruction +
  // context + surroundings + tonePrompt all reach the prompt, and uncapped
  // they would smuggle up to the 1 MB bodyLimit of unmetered input tokens.
  const over = tooLong(body.text) ?? tooLong(body.instruction) ?? tooLong(body.context)
    ?? tooLong(body.surroundings) ?? tooLong(body.tonePrompt);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });
  const override = body.personality;
  const badPersonality = personalityProblem(override);
  if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  const t0 = Date.now();
  try {
    const personality = override ?? await getPersonality(user);
    const tone = body.tone ?? personality.activeTone;
    const lang = await effectiveLanguage(user, body.language, personality);
    const editedText = await editSelection(body.text, body.instruction, {
      tone,
      tonePrompt: body.tonePrompt,
      context: body.context,
      targetApp: body.targetApp,
      fieldKind: fieldKindOf(body.fieldKind),
      fieldLabel: cleanLabel(body.fieldLabel, 60),
      surroundings: capSurroundings(body.surroundings),
      privateField: body.privateField === true,
      language: lang,
      personality,
      variables: { email: user.email, phone: user.phone },
    });
    // The rewritten text is user-facing written words, like a refine — so it
    // is metered by its word count and recorded.
    const usage = { audioSeconds: 0, words: countWords(editedText), model: cfg.CLEANUP_MODEL };
    await recordUsage({ user, source: "rest", ...usage });
    await appendHistoryEntry(user, personality, {
      kind: "typing",
      targetApp: body.targetApp,
      language: body.language,
      // The instruction is what they said; the rewritten text is what they get;
      // the original selection is the context it carried on from.
      input: body.instruction,
      output: editedText,
      durationMs: Date.now() - t0,
      wordsIn: countWords(body.instruction),
      wordsOut: usage.words,
      tone,
      presetId: personality.activePresetId,
      context: body.text,
    });
    learnFromUsage(user, personality);
    const res: EditResponse = { editedText, usage };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Edit failed" });
  }
});

// --- Screen (REST): answer a question about what is on screen ---------------
//
// The desktop's "ask about the screen": the app captured the visible text on
// device (`screenContent`, reference only) and the user asks a question about
// it. answerAbout() answers concisely in the question's language. The answer is
// the MODEL's words, not the user's dictation — so, exactly like
// /v1/train/converse, it is metered at zero words and written to NO dictation
// history. `speak` is the read-aloud locale, derived from the answer the same
// way converse derives it.
app.post("/v1/ask", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);

  const body = (req.body ?? {}) as AskRequest;
  if (!body.question || !body.question.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'question'" });
  }
  // Every prompt-bound field capped: the question, the captured screen, and any
  // surroundings a client sends along with it.
  const over = tooLong(body.question) ?? tooLong(body.screenContent) ?? tooLong(body.surroundings);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });
  const badPersonality = personalityProblem(body.personality);
  if (badPersonality) return reply.code(badPersonality.status).send({ code: "bad_request", message: badPersonality.message });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  try {
    const personality = body.personality ?? await getPersonality(user);
    const lang = await effectiveLanguage(user, body.language, personality);
    const answer = await answerAbout(body.screenContent ?? "", body.question, {
      targetApp: body.targetApp,
      language: lang,
      personality,
    });
    // The MODEL's words are not the person's: nothing they dictated is in this
    // answer, so none of it comes off their allowance. Recorded at zero words
    // (and zero seconds) so the call still shows in usage — exactly like
    // /v1/train/converse — and NO dictation-history row is appended.
    await recordUsage({ user, source: "rest", audioSeconds: 0, words: 0, model: cfg.CLEANUP_MODEL });
    // The voice to read it in, derived from the answer itself: a Hindi answer
    // read aloud by an English voice is not the answer. Older clients ignore
    // the field and keep the screen's voice.
    const speak = spokenLanguage(answer)?.locale;
    // AND THE VOICE TO READ IT IN. The locale decides the language; this
    // decides whose voice — the one the user picked (personality.ttsVoice), or
    // the default when they have not. Sent so the desktop's ask feature can
    // hand it straight to /v1/speak. Only ever a voice from the curated set.
    const voice = isValidTtsVoice(personality.ttsVoice) ? personality.ttsVoice : DEFAULT_TTS_VOICE;
    const res: AskResponse = { answer, ...(speak ? { speak } : {}), voice };
    return reply.send(res);
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "cleanup_failed", message: "Couldn't answer that" });
  }
});

// --- Text-to-speech (REST): text → spoken audio -----------------------------

app.post("/v1/speak", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);

  const body = (req.body ?? {}) as SpeakRequest;
  if (!body.text || !body.text.trim()) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'text'" });
  }
  const over = tooLong(body.text) ?? tooLong(body.instructions);
  if (over) return reply.code(413).send({ code: "bad_request", message: over });

  const quota = await enforceQuota(user);
  if (quota) return reply.code(429).send({ code: "quota_exceeded", message: quota });

  // Which voice to speak in. A voice the client sent is honoured only if it is
  // one of the curated set; anything else (a typo, an unknown OpenAI voice, or
  // nothing at all) falls back to the user's stored voice, then the default.
  // An unknown id is NEVER forwarded to OpenAI — that would 400 mid-sentence.
  // The personality is only read when it is actually needed (no valid body
  // voice), so an ordinary speak with a good voice stays a single call.
  let voice: string;
  if (isValidTtsVoice(body.voice)) {
    voice = body.voice;
  } else {
    const personality = await getPersonality(user);
    voice = isValidTtsVoice(personality.ttsVoice) ? personality.ttsVoice : DEFAULT_TTS_VOICE;
  }

  try {
    const { audio, contentType } = await synthesize({
      text: body.text,
      voice,
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
  if (!user) return unauthorized(reply);
  const personality = await getPersonality(user);
  const res: PersonalityResponse = { personality };
  return reply.send(res);
});

app.put("/v1/personality", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  const personality = (req.body ?? {}) as Personality;
  const bad = personalityProblem(personality);
  if (bad) return reply.code(bad.status).send({ code: "bad_request", message: bad.message });
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
  /** With all:false, the keys picked by hand go too (the You tab's switch). */
  clear: z.boolean().optional(),
});

app.post("/v1/personality/haptics", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  const parsed = hapticsToggleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: "key or all required" });
  }
  const { key, all, clear } = parsed.data;
  if (key === undefined && all === undefined) {
    return reply.code(400).send({ code: "bad_request", message: "key or all required" });
  }
  try {
    const merged = await updatePersonality(user, (existing) => {
      const next = { ...existing };
      if (all !== undefined) next.hapticsAll = all;
      // "I know" on the You tab's switch: every key off, the hand-picked ones too.
      if (clear === true) next.hapticKeys = [];
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

/**
 * The saved dictionary as a list of terms.
 *
 * `vocabulary` is one free-text field the user types into, one term per line,
 * so this is where "what did they actually save" is decided. Blank lines and
 * a runaway paste are both dropped here rather than downstream — the density
 * chart counts entries, and an empty line would be an entry nobody wrote.
 */
function savedWords(personality: { vocabulary?: string } | undefined): string[] {
  return (personality?.vocabulary ?? "")
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 500);
}

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
  if (!user) return unauthorized(reply);
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
  if (!user) return unauthorized(reply);
  const body = (req.body ?? {}) as { presetId?: string; pinned?: boolean };
  // Bounded like every preset id (tone ids are ≤ 120): it is stored, and
  // sent back in every keyboard config.
  const presetId = String(body.presetId ?? "").trim().slice(0, 120);
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

// Register an Expo push token for the current user (every launch and every
// sign-in), and give it up on sign-out. A token belongs to the PHONE, so
// registering it takes it from any other account that held it — see
// src/push/tokens.ts. Best-effort from the client's side either way.
registerPushTokenRoutes(app, {
  resolveUser,
  tokens: () => {
    const sb = supabase();
    return sb ? new SupabasePushTokens(sb, (msg, err) => app.log.warn({ err }, msg)) : null;
  },
  rateLimit: AUTHED_RL,
});

// Learn a style profile from a sample of the user's own writing, merge it into
// their saved personality, and return the result.
app.post("/v1/personality/learn", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
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
 *
 * Throttled per address, far above anything RevenueCat sends (a 429 is only
 * retried later), so the secret cannot be guessed at line rate.
 */
app.post("/v1/billing/revenuecat", { config: { rateLimit: { max: 600, timeWindow: 60_000 } } }, async (req, reply) => {
  const expected = cfg.REVENUECAT_WEBHOOK_SECRET ?? "";
  if (!expected) {
    req.log.error("[billing] webhook hit with no REVENUECAT_WEBHOOK_SECRET set");
    return reply.code(503).send({ code: "not_configured" });
  }
  // Timing-safe, both spellings always compared: RevenueCat sends the value
  // verbatim, and a proxy or a dashboard edit may have put "Bearer " before it.
  const got = String(req.headers["authorization"] ?? "");
  const bare = sameSecret(got, expected);
  const bearer = sameSecret(got, `Bearer ${expected}`);
  if (!bare && !bearer) {
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

/**
 * Razorpay's webhook: every renewal, failed charge, pause and cancellation.
 *
 * No user auth — Razorpay is the caller — and authenticated instead by
 * HMAC_SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET
 * (X-Razorpay-Signature). With no secret it refuses everything, as the
 * RevenueCat one does: an open endpoint that grants access is a free
 * subscription for anyone who finds it.
 *
 * ONLY A SIGNAL. The event says which subscription changed; what is saved is
 * that subscription as Razorpay reports it now. Webhooks arrive late, twice
 * and out of order, and an old event can then never write an old state.
 *
 * 200 for anything authentic, even with nothing to do. A failed read or
 * write answers 500, so Razorpay sends it again.
 */
app.post("/v1/billing/razorpay", { config: { rateLimit: { max: 600, timeWindow: 60_000 } } }, async (req, reply) => {
  if (!cfg.RAZORPAY_WEBHOOK_SECRET) {
    req.log.error("[billing] razorpay webhook hit with no RAZORPAY_WEBHOOK_SECRET set");
    return reply.code(503).send({ code: "not_configured" });
  }
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
  if (!webhookSignatureOk(raw, String(req.headers["x-razorpay-signature"] ?? ""))) {
    return reply.code(401).send({ code: "unauthorized" });
  }
  const body = (req.body ?? {}) as {
    event?: string;
    payload?: { subscription?: { entity?: { id?: string } }; payment?: { entity?: { subscription_id?: string } } };
  };
  const event = String(body.event ?? "");
  const subId = String(body.payload?.subscription?.entity?.id ?? body.payload?.payment?.entity?.subscription_id ?? "");
  if (!SUB_ID.test(subId)) return reply.send({ ok: true, reason: `ignored ${event}` });
  try {
    const res = await syncSubscription(await fetchSubscription(subId), event);
    req.log.info({ rz: res, event }, "[billing] razorpay event");
    return reply.code(res.ok ? 200 : 500).send(res);
  } catch (err) {
    // Razorpay's own words go back with the 500: "The id provided does not
    // exist" means the keys work, "Authentication failed" means they do not.
    req.log.error({ event, subId, detail: (err as Error).message }, "[billing] razorpay event: could not read the subscription");
    return reply.code(500).send({ ok: false, reason: "could not read the subscription", detail: (err as Error).message.slice(0, 200) });
  }
});

/**
 * The window the client says it has, or nothing.
 *
 * Nothing is the right answer for a client that does not say: a guessed
 * height is worse than none, because a pane too tall hides the control and a
 * pane too short puts the next section in the opening view — which is the one
 * thing it exists to prevent.
 */
function viewportOf(
  d: { width?: number; height?: number } | undefined,
): { width: number; height: number } | undefined {
  const w = Number(d?.width), h = Number(d?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 200 || h < 320) return undefined;
  return { width: Math.round(w), height: Math.round(h) };
}

/**
 * The caller's OS, narrowed to what the catalog is allowed to branch on.
 *
 * Anything unrecognised becomes "ios" rather than throwing or spreading an
 * unknown string through the catalog: a screen must render for a client we do
 * not recognise, and the iOS tree is the fuller of the two.
 */
function platformOf(raw: unknown): "ios" | "android" {
  return String(raw ?? "").toLowerCase() === "android" ? "android" : "ios";
}

// SDUI endpoints intentionally use the AUTHED_RL tier even though the routes
// themselves are auth-optional. Reason: a normal launch fires bootstrap +
// several screens back-to-back (4–6 requests). The keyGenerator keys by the
// LOCALLY-verified user id when a valid JWT is present, so a real authed user
// gets their own bucket (even sharing a NAT egress IP with many others);
// anonymous callers fall back to per-IP (real IP now, thanks to trustProxy).
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
  const reqBody = (req.body ?? {}) as {
    launchCount?: number;
    capabilities?: {
      platform?: string;
      bundle?: string;
      appVersion?: string;
      lastBoot?: string;
      // Device-level facts the app reads before it asks. Optional: an older
      // bundle sends none of it, and every consumer here treats absent as
      // "not granted", which is the pre-existing behaviour.
      device?: { micGranted?: boolean; keyboardReady?: boolean; keyboardEnabled?: boolean };
      /**
       * This JavaScript can sign in with Google by way of Supabase's page and
       * come back on tulmi://. Declared by every bundle that carries the web
       * path; absent from the store binary's own bundle, which is how a fresh
       * install on Android is told apart from one the OTA has reached.
       */
      googleWeb?: boolean;
      /** What the bundle can render; the desk is sent only to one that
       *  declares DeskShell. */
      components?: string[];
    };
  };
  // WHICH BUNDLE IS ACTUALLY RUNNING.
  //
  // The app reports "embedded" when it is running the bundle baked into the
  // binary and the first eight characters of an update id when an OTA has
  // applied. Without this line the two are indistinguishable from the server,
  // which is exactly the ambiguity that has made every "I published, nothing
  // changed" report unfalsifiable — a fix that never arrived and a fix that
  // arrived and did not work look identical from here.
  //
  // One line, on the one request every launch makes.
  req.log.info(
    {
      // Clipped: every field is the client's, and this line is on every launch.
      bundle: clip(reqBody.capabilities?.bundle, 40) || "unknown",
      appVersion: clip(reqBody.capabilities?.appVersion, 40) || "unknown",
      launchCount: Number(reqBody.launchCount) || 0,
      platform: clip(reqBody.capabilities?.platform, 20) || "unknown",
      // How the PREVIOUS launch ended. A boot that hangs cannot report on
      // itself, so the app leaves a breadcrumb and the next launch carries it.
      lastBoot: clip(reqBody.capabilities?.lastBoot, 80) || "unknown",
      googleWeb: reqBody.capabilities?.googleWeb === true,
    },
    "[boot] client bundle",
  );
  // The server's own view of both, so the app never has to guess and a
  // modified client cannot claim either. Read in parallel with everything
  // else, so this costs no extra latency.
  // The ROW rather than the boolean, because where a subscription was bought
  // decides where it can be changed — Apple will not let anything else cancel
  // an App Store subscription, and Paddle cannot be reached from Settings.
  // isEntitled() is that same read with the answer thrown away.
  const [ent, usage, allowance] = user
    ? await Promise.all([
        getEntitlement(user).catch(() => null),
        usageSummary(user).catch(() => null),
        allowanceFor(user).catch(() => null),
      ])
    : [null, null, null];
  const entitled = ent !== null;
  // A REVIEWER GOES STRAIGHT IN.
  //
  // Both stores give the app to someone with a checklist and a few minutes. An
  // intro, a language pick, a permission primer and a keyboard walkthrough
  // between them and the feature is how a submission comes back as "we were
  // unable to locate the described functionality". The id is checked, not the
  // email — the email is what they type, the id is what their token proves.
  const reviewIds = new Set(
    cfg.REVIEW_USER_IDS.split(",").map((x) => x.trim()).filter(Boolean),
  );
  const isReviewer = !!user && reviewIds.has(user.id);
  // What the phone says it already has. Both are device-level — a different
  // account on the same handset inherits them — so they decide which setup
  // steps are worth showing. Coerced to a strict boolean: an older client
  // sends neither, which reads as false and shows both steps, exactly as
  // before this existed.
  const devCaps = reqBody.capabilities?.device as
    | { micGranted?: boolean; keyboardReady?: boolean; formFactor?: string; os?: string }
    | undefined;
  const micGranted = devCaps?.micGranted === true;
  const keyboardReady = devCaps?.keyboardReady === true;
  // A window says so. Everything else is a phone, including every client that
  // predates this field.
  const isDesktop = devCaps?.formFactor === "desktop";

  // NOTHING LEFT TO ASK MEANS ONBOARDING IS DONE.
  //
  // Both steps exist to obtain these two permissions. When the device already
  // has them, every step is skipped and the user goes straight into the app —
  // but the profile would still say not-onboarded, and would say so on every
  // launch forever. Recorded once, here, so the flag matches what is true.
  //
  // Guarded on !onboarded, so this is a single write for such a user and a
  // no-op on every launch after. A reviewer is already forced onboarded and
  // never reaches this.
  if (user && profile && !profile.onboarded && micGranted && keyboardReady) {
    updateProfile(user, { onboarded: true }).catch((e) => {
      // Losing this write costs a repeat of the same skip next launch, not a
      // broken app — so it must never fail the bootstrap.
      req.log.warn({ err: e }, "[boot] could not mark onboarded after skipping setup");
    });
  }

  const bootstrap = buildBootstrap({
    onboarded: isReviewer || micGranted && keyboardReady || (profile?.onboarded ?? false),
    // Have they ever been inside the app before? A reviewer always has — a
    // fresh account walked into You on every submission otherwise, which is
    // not the screen you want a reviewer to open on.
    landedBefore: isReviewer || !!personality?.shellSeenAt,
    // Both answers are required by the card, so either one proves it ran.
    profileComplete: !!(profile?.fullName || profile?.gender),
    launchCount: Number(reqBody.launchCount) || 0,
    languagesSet: isReviewer || !!personality?.languages?.length,
    // Entitled, so no paywall stands between a reviewer and the app. Guideline
    // 2.1 asks that the reviewer can exercise the paid functionality; it does
    // not ask them to buy it.
    entitled: entitled || isReviewer,
    billingStore: ent?.store,
    // Known for a Razorpay subscription: false once it has been cancelled.
    billingRenews: ent?.renews,
    // The pay page, signed for this account so its calls can name their
    // caller (razorpay.payLink). Only when it IS our pay page; any other
    // link goes out as configured.
    payUrl: user && cfg.REVENUECAT_WEB_PAYWALL_URL?.startsWith("https://tailzu.space/pay")
      ? payLink(cfg.REVENUECAT_WEB_PAYWALL_URL, user.id) : undefined,
    wordsUsed: usage?.month?.words ?? 0,
    // Setup's Live Activity: its first step is an account, its last a word.
    // A reviewer is shown none of it.
    signedIn: !!user,
    wordsEver: usage?.total?.words ?? 0,
    setupDone: isReviewer,
    allowance,
    platform: platformOf(reqBody.capabilities?.platform),
    // The desk: Tailzu's own pages for a desktop window that can draw them.
    desk: Array.isArray(reqBody.capabilities?.components)
      && reqBody.capabilities!.components!.includes("DeskShell"),
    deskNotes: Array.isArray(reqBody.capabilities?.components)
      && reqBody.capabilities!.components!.includes("DeskNotes"),
    isReviewer,
    // The address the app should offer a password field for. Sent to everyone
    // because knowing it grants nothing — the password is the credential and it
    // lives in Supabase. Empty until REVIEW_EMAIL is set, so the path does not
    // exist outside a submission window.
    //
    // NORMALISED, because the client compares `typed.trim().toLowerCase()` to
    // this string. An env value with a capital in it therefore matches nothing:
    // the reviewer types the address, gets a one-time code posted to a mailbox
    // nobody can open, and reports that they cannot sign in. A whole submission
    // cycle, spent on the shift key.
    reviewEmail: (cfg.REVIEW_EMAIL ?? "").trim().toLowerCase(),
    // Same origin the media URLs are built on: the callback has to be a page
    // THIS server serves, and it has to be the one Supabase is told about.
    googleWeb: cfg.AUTH_GOOGLE_WEB
      ? {
          callback: `${process.env.PUBLIC_ORIGIN || "https://api.tailzu.space"}/auth/callback`,
          resume: AUTH_RESUME_SCHEME_URL,
        }
      : null,
    // An Android client that has NOT declared the web path is running
    // JavaScript that cannot come back from Google — the store bundle on a
    // fresh install, before any OTA. Its Google button would strand the user,
    // so the screen it is handed has no Google button. Not tied to the
    // switch above: even with the switch off, that bundle cannot use it.
    googleHidden:
      platformOf(reqBody.capabilities?.platform) === "android"
      && reqBody.capabilities?.googleWeb !== true,
    // And what that client gets instead: Supabase's own sign-in as a plain
    // link, returning on the callback page above. Same switch as the web
    // path, because it needs the same dashboard work — the callback on
    // Supabase's redirect list, and the Google provider given its secret.
    //
    // The state is minted HERE because that bundle cannot mint one — and it
    // cannot check one either: it adopts any session link while signed out,
    // which only its update (the one that declares googleWeb) fixes. The state
    // is what gets this link past the callback page's refusal of stateless
    // returns; the protection itself lives in the updated app.
    googleLink: cfg.AUTH_GOOGLE_WEB && cfg.SUPABASE_URL
      ? `${cfg.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/authorize?provider=google`
        + `&redirect_to=${encodeURIComponent(`${process.env.PUBLIC_ORIGIN || "https://api.tailzu.space"}/auth/callback?state=${randomBytes(24).toString("base64url")}`)}`
        + `&prompt=select_account`
      : null,
    micGranted,
    keyboardReady,
    formFactor: isDesktop ? "desktop" : "phone",
    // Which desktop. Sign in with Apple is offered on a Mac and not on the
    // others: it works there in the sense that a browser flow works, and it
    // is a button nobody on Windows is looking for.
    os: typeof devCaps?.os === "string" ? devCaps.os : undefined,
  });
  // When they were last here. Fire and forget: a failed stamp must never cost
  // the boot, and nothing reads it on this path.
  if (user) void touchLastSeen(user).catch(() => {});
  // AND that they have now been inside. Written on the first bootstrap that
  // serves a finished onboarding, which is the moment the tabs actually
  // appear — so the next launch opens on Stats instead of You.
  //
  // After the bootstrap is built, deliberately: reading it and writing it in
  // the same request would land the new user on Stats on their very first
  // visit, which is the one thing this is here to prevent.
  if (user && bootstrap.navigation.kind === "tabs" && !personality?.shellSeenAt) {
    const onboarded = (bootstrap.flags ?? {})["onboarded"] === true
      || (profile?.onboarded ?? false);
    if (onboarded) {
      void updatePersonality(user, (existing) => ({
        ...existing,
        shellSeenAt: existing.shellSeenAt ?? new Date().toISOString(),
      })).catch(() => { /* a lost stamp costs one repeat, never the boot */ });
    }
  }
  // Attach the current media registry so clients can resolve keys → URLs
  // without a separate roundtrip. Keys are semantic ("brand.mark",
  // "onboarding.hero.png"); each entry has { url, contentType, size,
  // uploadedAt }. Missing key → clients fall back to bundled default.
  (bootstrap as unknown as { media?: Record<string, unknown> }).media = getMediaRegistry();
  const controlled = withControl(req, reply, bootstrap, {
    surface: "bootstrap",
    platform: isDesktop ? "desktop" : platformOf(reqBody.capabilities?.platform),
    formFactor: isDesktop ? "desktop" : "phone",
    appVersion: reqBody.capabilities?.appVersion,
    bundle: reqBody.capabilities?.bundle,
    userId: user?.id,
    locale: profile?.language,
    signedIn: !!user,
  });
  return reply.send(await localize(controlled, profile?.language ?? "en"));
});

app.post("/v1/app/screen", { config: AUTHED_RL, onSend: gzipLargeJson }, async (req, reply) => {
  noStoreSdui(reply);
  const body = (req.body ?? {}) as {
    screenId?: string;
    params?: Record<string, string | number | boolean | undefined>;
    /** Caller's UTC offset (minutes, JS -getTimezoneOffset() convention) so
     * per-day stats bucket in the USER'S day, not Greenwich's. */
    tzOffsetMinutes?: number;
    capabilities?: {
      platform?: string;
      device?: { width?: number; height?: number; formFactor?: string; os?: string };
      appVersion?: string;
      /** What this bundle can render. Absence is the only honest signal that a
       *  screen needing something new must not be sent to it. */
      components?: string[];
    };
  };
  const screenId = body.screenId;
  if (!screenId) {
    return reply.code(400).send({ code: "bad_request", message: "Missing 'screenId'" });
  }

  const user = await resolveUser(req.headers["authorization"]);
  // A tapped push opens its screen with the push's data as the params, so its
  // id comes back here: the engine counts it as answered (src/push).
  if (user && typeof body.params?.pushId === "string") pushEngine()?.markOpened(user.id, body.params.pushId);
  const [personality, profile] = user
    ? await Promise.all([getPersonality(user), getProfile(user)])
    : [{}, null];
  const screenFormFactor = body.capabilities?.device?.formFactor === "desktop" ? "desktop" : "phone";
  const screenCtx = (screen: string) => ({
    surface: "screen" as const,
    screen,
    platform: screenFormFactor === "desktop" ? "desktop" : platformOf(body.capabilities?.platform),
    formFactor: screenFormFactor,
    userId: user?.id,
    locale: profile?.language,
    signedIn: !!user,
  });

  // Load per-screen aggregates only for the screens that need them.
  // usageSummary covers legacy stats numbers; statsForUser adds the
  // history-derived "minutes saved" + sparkline for the SDUI stats screen.
  // The desk's pages that show today's or this month's numbers read the
  // meter in the caller's own day.
  const USAGE_SCREENS = new Set(["stats", "desk_today", "desk_insights", "desk_settings"]);
  const usage = user && USAGE_SCREENS.has(screenId)
    ? await usageSummary(user, typeof body.tzOffsetMinutes === "number" ? body.tzOffsetMinutes : undefined)
    : undefined;
  // "month" window: the Stats tab charts 14-day bars + 30-day streaks, which
  // a 7-day projection can't feed. tzOffsetMinutes keeps "today"/"evening"
  // meaning the user's clock.
  // THE ONLY PLACE THE APP EVER TELLS US ITS CLOCK. Remembered on the portrait
  // so the usage roll-up can turn a row's UTC timestamp into the hour the user
  // actually wrote it — without it, `rhythms` stays empty, because a day-part
  // computed against the wrong timezone is a confident lie that the writing
  // model would then act on for months.
  if (user && typeof body.tzOffsetMinutes === "number" && Number.isFinite(body.tzOffsetMinutes)) {
    const tz = Math.max(-14 * 60, Math.min(14 * 60, Math.round(body.tzOffsetMinutes)));
    void updatePersonality(user, (existing) => ({
      ...existing,
      stylePortrait: { ...existing.stylePortrait, tzOffsetMinutes: tz },
    })).catch(() => { /* a stats call must never fail over this */ });
  }
  // The Stats tab AND the You tab both chart these now — the You cards carry
  // a ring each for the thing they are about — so both pay for the read.
  // The training tab charts what the app has been learning FROM — the days
  // the person actually wrote — under the numbers for what it has learned.
  // Same read, one more screen.
  const STATS_SCREENS = new Set(["stats", "personality", "home", "desk_today", "desk_insights", "desk_day", "desk_app"]);
  /**
   * AN AGGREGATE MUST NOT GATE THE TAB SOMEONE LANDS ON.
   *
   * This is a month-wide roll-up over every row the user has written, and on
   * the stats screen it is the point — waiting for it is waiting for the
   * content. On the training tab it is one strip of bars below the fold, and
   * on the You tab it is a ring; neither is worth holding the screen for, and
   * home is where the app OPENS. A slow read there is the whole app feeling
   * slow, which is exactly how it was described.
   *
   * So the screens that are ABOUT the numbers wait for them, and the screens
   * that merely show some give them a deadline. Past it the screen is built
   * without them — the feed is simply not drawn, which is already what a user
   * with no history sees — and the next fetch, with the read warm, has them.
   */
  const STATS_BLOCKING = new Set(["stats", "desk_insights", "desk_day", "desk_app"]);
  const STATS_DEADLINE_MS = 700;
  const statsRead = user && STATS_SCREENS.has(screenId)
    ? statsForUser(user, "month", Number(body.tzOffsetMinutes) || 0,
                   savedWords(personality), personality?.languages ?? []).catch(() => undefined)
    : undefined;
  const stats = statsRead
    ? (STATS_BLOCKING.has(screenId)
        ? await statsRead
        : await Promise.race([
            statsRead,
            new Promise<undefined>((r) => setTimeout(() => r(undefined), STATS_DEADLINE_MS)),
          ]))
    : undefined;
  // The words meter. Only the stats screen draws it, so only the stats screen
  // pays for the read.
  // The words screen is a statement about this number, so it has to read it
  // too — a screen that says "out of words" without knowing how many is a
  // guess with a button on it.
  const ALLOWANCE_SCREENS = new Set(["stats", "words_out", "desk_settings", "desk_plan"]);
  const allowance =
    user && ALLOWANCE_SCREENS.has(screenId)
      ? await allowanceFor(user).catch(() => null)
      : undefined;
  const history =
    user && (screenId === "history" || screenId === "desk_today" || screenId === "desk_history")
      ? (await listHistory(user, { limit: screenId === "desk_history" ? HISTORY_MAX_LIMIT : 50 })).entries
      : undefined;
  // The desk's Notes page and one note. A failed read draws the page empty
  // rather than failing it; a desktop on a static token has none to read.
  const notes = user && screenId === "desk_notes"
    ? await listNotes(user).catch(() => [])
    : undefined;
  const note = user && screenId === "desk_note" && typeof body.params?.noteId === "string"
    ? await getNote(user, body.params.noteId).catch(() => null)
    : undefined;
  // THE ONE SCREEN THAT MUST NOT SELL TO A SUBSCRIBER, so the one screen that
  // pays for this read. The row rather than the boolean: which store sold it
  // decides where it can be changed, and nothing else can answer that.
  //
  // A failed read draws the sales page, deliberately. A screen that hid the
  // plans because a lookup timed out would be a screen nobody could buy from,
  // and the clients still refuse a second purchase on another store.
  // Stats reads it too: it drew the free words-left meter for everybody,
  // subscribers included, because it was never told who had paid. And the
  // desk's settings and plan pages say which plan this is.
  const ENTITLEMENT_SCREENS = new Set(["paywall", "stats", "desk_settings", "desk_plan"]);
  const entitlement =
    user && ENTITLEMENT_SCREENS.has(screenId)
      ? await getEntitlement(user).catch(() => null)
      : undefined;
  // THE GATE. On iOS the keyboard's mic opens the app on `flow_arm`, so this
  // route is where an out-of-words user is stopped — before a session arms,
  // and without needing a keyboard build to enforce it.
  //
  // Only for flow_arm: every other screen stays reachable when the words run
  // out. Being out of quota is not a reason to lose your settings.
  if (screenId === "flow_arm" && user && !cfg.FREE_FOR_ALL) {
    const [entitled, allowance] = await Promise.all([
      isEntitled(user).catch(() => true),        // unknown → let them through
      // The EARNED ceiling, not the flat one. Reading FREE_MONTHLY_WORDS
      // directly here would stop a user at 2,500 while the stats screen was
      // showing them 3,400 — the gate and the meter have to be the same number
      // or the earned words are a decoration.
      allowanceFor(user).catch(() => null),
    ]);
    if (!entitled && allowance && allowance.total > 0 && allowance.used >= allowance.total) {
      const paywall = buildScreen("paywall", {
        personality,
        language: profile?.language ?? "auto",
        onboarded: profile?.onboarded ?? false,
        email: user?.email,
        phone: user?.phone,
        params: body.params,
      });
      if (paywall) {
        return reply.send(await localize(withControl(req, reply, paywall, screenCtx("paywall")),
          profile?.language ?? "auto"));
      }
    }
  }
  const screen = buildScreen(screenId, {
    personality,
    entitlement,
    // The editor seeds itself from ctx.dictionary, which nothing ever set —
    // so it opened blank on every visit however much the user had saved.
    dictionary: personality?.dictionary,
    language: profile?.language ?? "auto",
    onboarded: profile?.onboarded ?? false,
    email: user?.email,
    phone: user?.phone,
    // The You tab greets the person by name. ScreenContext has carried this
    // field all along and nothing ever filled it, so every screen that asked
    // for a name got undefined and drew around it.
    name: profile?.fullName,
    usage,
    allowance,
    stats,
    history,
    notes,
    note,
    params: body.params,
    // The client has always sent this and the catalog has never been able to
    // read it, so every per-OS difference had to ship as BOTH variants with a
    // visibleIf and be resolved on the device. That works, but it means an
    // Android-only change cannot be pushed without also touching what iOS
    // receives — and a screen that differs structurally between the two cannot
    // be expressed at all. Now the server knows, so it can simply send the
    // right one.
    platform: platformOf(body.capabilities?.platform),
    // HOW TALL THE WINDOW IS, which the client has been sending all along.
    //
    // A screen that scrolls cannot lay its opening view out with flex — a
    // scroll container is sized by its content — so "one window tall" has to
    // be a number, and the only honest source for it is the phone. Reading it
    // here means the training tab's first view is exact on EVERY installed
    // bundle, rather than depending on one that knows a new prop.
    viewport: viewportOf(body.capabilities?.device),
    // A window, not a handset. Separate from `platform` (which tree it can
    // draw) and from `viewport` (how wide it is): this is the input device.
    formFactor: body.capabilities?.device?.formFactor === "desktop" ? "desktop" : "phone",
    tzOffsetMinutes: typeof body.tzOffsetMinutes === "number" ? body.tzOffsetMinutes : undefined,
    appVersion: typeof body.capabilities?.appVersion === "string" ? body.capabilities.appVersion : undefined,
    os: typeof body.capabilities?.device?.os === "string" ? body.capabilities.device.os : undefined,
    can: new Set(
      Array.isArray(body.capabilities?.components)
        ? body.capabilities!.components!.map(String)
        : [],
    ),
  });
  if (!screen) {
    return reply.code(404).send({ code: "bad_request", message: `Unknown screen '${screenId}'` });
  }
  return reply.send(await localize(withControl(req, reply, screen, screenCtx(screenId)),
    profile?.language ?? "auto"));
});

// --- Profile (REST): language + onboarding state ----------------------------

app.get("/v1/profile", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  return reply.send(await getProfile(user));
});

app.put("/v1/profile", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);
  const body = (req.body ?? {}) as {
    dictionary?: unknown[];
    language?: string;
    onboarded?: boolean;
    full_name?: string;
    gender?: string;
  };
  const patch: Partial<Profile> = {};
  // A language code ("en", "zh-Hant-TW"), bounded: it is stored, and read back
  // as the locale and the prompt's fallback language on every request.
  if (typeof body.language === "string") patch.language = body.language.trim().slice(0, 35);
  if (typeof body.onboarded === "boolean") patch.onboarded = body.onboarded;
  // The name + gender card has been sending these since it shipped; until now
  // they were parsed off the body and dropped, so the card's answers lived only
  // in the phone's own storage and a reinstall asked again.
  if (typeof body.full_name === "string") {
    const name = body.full_name.trim().slice(0, 120);
    if (name) patch.fullName = name;
  }
  // The dictionary the editor sends. It was destructured nowhere and dropped
  // on the floor: the user got a success haptic, and their rows were gone on
  // the next screen load. It is stored on the PERSONALITY blob (jsonb, so no
  // migration) because that is where every other writing-behaviour setting
  // already lives and where the refine prompt reads from.
  if (Array.isArray(body.dictionary)) {
    const clean = body.dictionary
      .filter((r): r is { word: string; replacement: string } =>
        !!r && typeof r === "object" &&
        typeof (r as { word?: unknown }).word === "string" &&
        typeof (r as { replacement?: unknown }).replacement === "string")
      .map((r) => ({ word: r.word.trim().slice(0, 80), replacement: r.replacement.trim().slice(0, 200) }))
      .filter((r) => r.word && r.replacement)
      // Bounded, because every entry becomes prompt on every refine.
      .slice(0, 200);
    await updatePersonality(user, (existing) => ({ ...existing, dictionary: clean }));
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
  if (!user) return unauthorized(reply);

  const admin = supabase();

  // NO SERVICE KEY, NO DELETION, AND SAY SO.
  //
  // supabase() returns null whenever SUPABASE_SERVICE_KEY is unset, and the
  // whole block below was simply skipped — then answered 200 with a cheerful
  // summary of six things that did not happen. The app reads 200 as success:
  // it showed "Your account has been deleted." and signed the user out, and
  // the account was still there to sign back into.
  //
  // That is the exact failure Apple's 5.1.1(v) is written about, and it is
  // worse than having no delete button, because the user believes it is done.
  // A deletion that cannot run must fail in front of the person who asked.
  if (!admin) {
    req.log.error("account delete attempted with no service-role key");
    return reply.code(503).send({
      code: "delete_unavailable",
      message: "Account deletion is temporarily unavailable. Please try again shortly.",
    });
  }

  // Every table holding this user's rows. Each also cascades from auth.users,
  // but they are cleared first and one at a time, so a table whose foreign key
  // was never given ON DELETE CASCADE cannot make the auth delete below fail.
  // cleanup_history is the verbatim dictated input + output — the most
  // sensitive per-user data, and once silently left behind. Errors are logged
  // and do not abort the sequence.
  const summary = {
    personality: false, profile: false, usageEvents: 0,
    history: false, pushTokens: false, authAccount: false,
  };
  const tables: Array<[string, keyof typeof summary | null]> = [
    ["usage_events", "usageEvents"], ["personalities", "personality"], ["profiles", "profile"],
    ["cleanup_history", "history"], ["push_tokens", "pushTokens"],
    ["keyboard_telemetry", null], ["push_log", null], ["entitlements", null],
  ];
  for (const [table, key] of tables) {
    try {
      const { error, count } = await admin.from(table).delete({ count: "exact" }).eq("user_id", user.id);
      if (error) req.log.error({ err: error }, `delete ${table}`);
      if (key === "usageEvents") summary.usageEvents = count ?? 0;
      else if (key) summary[key] = !error;
    } catch (err) { req.log.error({ err }, `delete ${table}`); }
  }

  // Deleting the auth user takes anything missed above with it (cascade).
  try {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    summary.authAccount = !error;
  } catch (err) {
    req.log.error({ err }, "delete auth user");
  }

  // The auth record IS the account. Everything above is data the account
  // owned; if this one did not go, the account did not go, and the only
  // honest answer is an error — the app then keeps the user signed in and
  // tells them it failed, which is recoverable. Reporting success here is
  // not: it signs them out believing they are gone.
  if (!summary.authAccount) {
    req.log.error({ summary }, "account delete: auth record survived");
    return reply.code(500).send({
      code: "delete_incomplete",
      message: "We could not finish deleting the account. Please try again.",
    });
  }

  return reply.send({
    status: "deleted",
    ...summary,
    message: "Your account and all associated data have been deleted.",
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

app.get("/v1/keyboard/config", { config: AUTHED_RL, onSend: gzipLargeJson }, async (req, reply) => {
  // Personality is per-user — the keyboard uses it to render the quick-swap
  // chip row (pinned presets) + honor the active preset's default tone.
  // Missing/failed auth just returns the config without pins; the keyboard
  // still works, it just shows the built-in tone cycle instead.
  let personality: Personality | undefined;
  // Also the rollout key: a user's experiment slice is derived from their id,
  // so it stays put across requests instead of re-rolling mid-session.
  let userId: string | undefined;
  /**
   * What is left to spend, so the mic can say so BEFORE the user speaks.
   *
   * The 429 on the transcribe route is the authority and stays the backstop —
   * a config is cached and can be minutes stale. But being refused after
   * saying a sentence is a worse way to learn this than being told when you
   * reach for the button, so the keyboard is given the number too.
   */
  let quota: { remaining: number; total: number; entitled: boolean } | undefined;
  try {
    const user = await resolveUser(req.headers["authorization"]);
    if (user) {
      userId = user.id;
      const [p, entitled, allowance] = await Promise.all([
        getPersonality(user),
        isEntitled(user).catch(() => true),          // unknown → let them through
        allowanceFor(user).catch(() => null),
      ]);
      personality = p;
      if (allowance) {
        quota = { remaining: allowance.remaining, total: allowance.total, entitled: entitled || cfg.FREE_FOR_ALL };
      }
    }
  } catch { /* keyboard should never fail on personality lookup */ }
  // Cache-Control: no-store — keyboard config carries per-user
  // `kb.personality.pinned` / activeId / activeTone. Any caching layer
  // (nginx, CDN) that indexed the response by URL alone could leak these
  // across users. Same policy as /v1/app/bootstrap and /v1/app/screen.
  noStoreSdui(reply);
  // Which binary is asking: iOS "K37" → 37, Android "A2" → 2. Older builds
  // send nothing. The K-number gates iOS-only features (kbBuild); either
  // number lets a control rule target a build range on its own platform.
  const stamp = String(req.headers["x-tulmi-keyboard-build"] ?? "").match(/^([KA])(\d{1,5})$/i);
  const kbPlatform = keyboardPlatform(req.headers["user-agent"]);
  // WHICH KEYBOARD IS ON THE PHONE, every time one opens. The telemetry
  // upload says it too, but only every half hour; this says it the moment the
  // keyboard asks for its settings — and if no line appears when a keyboard
  // opens, that keyboard is not reaching the server at all.
  //   docker compose logs backend | grep "keyboard config"
  req.log.info(
    { build: stamp ? stamp[0]!.toUpperCase() : "none", platform: kbPlatform, signedIn: !!userId },
    "keyboard config",
  );
  const isIosStamp = !!stamp && stamp[1]!.toUpperCase() === "K";
  const kbConfig = buildKeyboardConfig(personality, userId, {
    platform: kbPlatform,
    quota,
    ...(isIosStamp ? { kbBuild: Number(stamp![2]) } : {}),
  });
  return reply.send(withControl(req, reply, kbConfig, {
    surface: "keyboard",
    platform: kbPlatform,
    formFactor: "phone",
    ...(stamp ? { build: Number(stamp[2]) } : {}),
    userId,
    signedIn: !!userId,
  }));
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
  // The touch path, counted (K39+): so a dropped keystroke is a number.
  "planeTouches",
  "planeMissed",
  "liftRescued",
  "liftRolled",
  "cancelRescued",
  "trayRetracted",
  "remounts",
  "keyMs",
  "slowKeys",
  // The keystroke budget and what a rebuild costs (iOS): over a 60 Hz frame
  // (16 ms), and the key tree's build time summed, with how many missed it.
  "keysOverFrame",
  "remountMs",
  "slowRemounts",
  // How close the iOS extension runs to its memory ceiling: one sample per
  // open, and how many of those were at or over each band.
  "memSampled",
  "memOver30MB",
  "memOver40MB",
  "memOver50MB",
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
  if (!user) return unauthorized(reply);
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

  // Numbers only, by construction — safe to log, and the quickest way to read
  // a phone's touch path: `docker compose logs backend | grep "keyboard telemetry"`.
  req.log.info({ build: short(body.build, 16), counters }, "keyboard telemetry");
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
  if (!requireAdmin(req, reply)) return;
  return reply.send({ ok: true, cacheVersion: bumpCacheVersion() });
});

app.get("/v1/admin/cache/version", async (_req, reply) => {
  // Read-only, safe to expose (the token is already sent in every bootstrap).
  return reply.send({ cacheVersion: currentCacheVersion() });
});

// --- History (REST) ---------------------------------------------------------
//
// Opt-in per-user history log. Storage is gated by personality.learnFromSent /
// personality.retainHistory; these endpoints only ever touch the caller's own
// rows (listHistory/deleteHistoryEntry filter by the authenticated user id).

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
/**
 * Why a card was removed from History, when the app says: "it doesn't sound
 * like me" or "just a clean-up". Either way it is deleted; the reason is
 * logged so the first can be counted apart from tidying up. Anything else is
 * ignored rather than refused — a delete never fails over its reason.
 */
const historyDeleteQuerySchema = z.object({
  reason: z.enum(["not_me", "cleanup"]).optional(),
});

app.get("/v1/history", { config: AUTHED_RL }, async (req, reply) => {
  const user = await resolveUser(req.headers["authorization"]);
  if (!user) return unauthorized(reply);

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
  if (!user) return unauthorized(reply);

  const parsed = historyIdParamsSchema.safeParse(req.params ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ code: "bad_request", message: "invalid id" });
  }

  const why = historyDeleteQuerySchema.safeParse(req.query ?? {});
  const reason = why.success ? why.data.reason : undefined;

  try {
    const ok = await deleteHistoryEntry(user, parsed.data.id);
    if (!ok) return reply.code(404).send({ code: "bad_request", message: "not found" });
    if (reason) req.log.info({ event: "history.delete", reason }, "history entry removed");
    return reply.send({ ok: true, ...(reason ? { reason } : {}) });
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ code: "internal", message: "Failed to delete entry" });
  }
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
    const push = pushEngine();
    if (push) {
      push.start(cfg.PUSH_TICK_SEC * 1000);
      console.log(`[push] smart notifications on, every ${cfg.PUSH_TICK_SEC}s` +
        ` expoToken=${cfg.EXPO_ACCESS_TOKEN ? "set" : "not set"}`);
    } else {
      console.log(`[push] smart notifications off (${cfg.PUSH_ENGINE ? "no Supabase" : "PUSH_ENGINE=false"})`);
    }
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
