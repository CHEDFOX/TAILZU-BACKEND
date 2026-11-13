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
 *   POST /v1/agent                → Ask: one step of the on-screen agent (NDJSON)
 *   /v1/connectors, /v1/tasks     → connected apps and the assistant's tasks (CONNECTORS)
 *   /v1/code/*                    → Xode: connect GitHub, projects, work branches (CODE_GITHUB)
 *   GET  /oauth/client-metadata.json → Tailzu's published OAuth client, for the apps' sign-in (CIMD)
 *   POST /v1/assistant/ask        → the phone's Ask: one command, one JSON answer (CONNECTORS)
 *   POST /v1/speak                → voice out: text → spoken audio (TTS)
 *   GET  /v1/personality          → read the user's saved style profile
 *   PUT  /v1/personality          → save the user's style profile
 *
 * Every output is shaped by the user's personality + the target-app context,
 * resolved here on the backend (the app just sends the inputs).
 *
 * This file builds the app and wires it: the HTTP plumbing (src/http), the
 * services (connectors, Xode, artifacts, media, the front door, the bots), and
 * one register call per route module (src/routes). The routes themselves live
 * in those modules.
 */
// First: the addresses a server keeps until its .env says the move to x0bot.com is done (domainHold.ts).
import "./domainHold.js";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import transcribeStream from "./routes/writing/transcribe-stream.js";
import { registerLiveRoutes } from "./routes/app/live.js";
import { installLiveWrites, liveJob, livePublish } from "./live/writes.js";
import { registerMediaRoutes, loadMediaRegistry, getMediaRegistry } from "./routes/app/media.js";
import { registerSeoRoutes } from "./routes/site/seo.js";
import { registerNotesRoutes } from "./routes/notes.js";
import { createConnectors, type Connectors } from "./connectors/index.js";
import { registerConnectorRoutes } from "./routes/connectors/connectors.js";
import { createCode } from "./code/index.js";
import { startOAuthSweeper } from "./code/oauth.js";
import { createArtifacts } from "./artifacts/index.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { liveViewerOf } from "./artifacts/livehost.js";
import { AttachmentRegistry, createFront } from "./front/index.js";
import { createMedia, registerMedia, startMediaSweep } from "./media/index.js";
import { registerFilesRoutes } from "./routes/files.js";
import { registerFrontRoutes } from "./routes/ask/front.js";
import { registerCodeRoutes } from "./routes/code/code.js";
import { registerCodeJobRoutes } from "./routes/code/codeJobs.js";
import { registerCodeInternalRoutes } from "./routes/code/codeInternal.js";
import { createBots } from "./bots/index.js";
import { botPorts } from "./bots/wire.js";
import { registerBotRoutes } from "./routes/bots/bots.js";
import { registerBotsShellRoutes } from "./routes/bots/botsShell.js";
import { registerBotsYouRoutes } from "./routes/bots/botsYou.js";
import { registerBotsBotsRoutes } from "./routes/bots/botsBots.js";
import { registerBotsKeybotRoutes } from "./routes/bots/botsKeybot.js";
import { registerBotsCodeRoutes } from "./routes/bots/botsCode.js";
import { registerXodeFlowRoutes } from "./routes/bots/botsXode.js";
import { registerBotsFirstRunRoutes } from "./routes/bots/botsFirstRun.js";
import { createAppleSignIn } from "./auth/appleSignIn.js";
import { registerBotsPushAskRoutes } from "./routes/bots/botsPushAsk.js";
import { registerRoutineRoutes } from "./routes/bots/routines.js";
import { registerAskDecideRoutes } from "./routes/ask/askDecide.js";
import { registerTalkRoutes } from "./routes/ask/talk.js";
import { registerContextRoutes } from "./routes/ask/context.js";
import { createPersonContext } from "./context/index.js";
import { registerEverydayRoutes } from "./routes/bots/everyday.js";
import { everyday } from "./everyday/index.js";
import { createRoutines, routineStore, startRoutines } from "./routines/index.js";
import { installAiConsent, registerAiConsentRoutes } from "./privacy/aiConsent.js";
import { installAiFetchGuard } from "./privacy/aiGate.js";
import { openAiModeration, setModeration } from "./botsBots/filter.js";
import { startOpsAlerts } from "./ops/alerts.js";
import { eventStore as routineEvents } from "./shell/events.js";
import { registerBotLooksRoutes } from "./routes/bots/botLooks.js";
import { registerNativeLooksRoutes } from "./routes/app/nativeLooks.js";
import { registerOracleRoutes } from "./routes/bots/oracle.js";
import { registerMailRoutes } from "./routes/bots/mail.js";
import { registerMeetRoutes } from "./routes/bots/meet.js";
import { registerCinemaRoutes } from "./routes/bots/cinema.js";
import { buildCinemaService } from "./cinema/index.js";
import { cinemaOn } from "./bots/builtin.js";
import { meetService, setMeetPeople } from "./meet/service.js";
import { meetStore } from "./meet/store.js";
import { spacePeople } from "./meet/people.js";
import { botsAreaParts } from "./botsBots/index.js";
import { Blocks } from "./botsBots/blocks.js";
import { googleEvents, startAutoJoin } from "./meet/calendar.js";
import { GoogleSession } from "./connectors/google/oauth.js";
import { registerBlipRoutes } from "./routes/bots/blipCatalog.js";
import { registerLaunchRoutes } from "./routes/app/launchMotion.js";
import { registerBotSoundsRoutes } from "./routes/bots/botSounds.js";
import { jobsHandoffFromConfig } from "./code/jobs/handoff/index.js";
import { sessionOffers } from "./code/live/offers.js";
import { jobStore } from "./code/jobs/store.js";
import { createAgent } from "./code/agent/index.js";
import { createPrCare, startCareSweep, type PrCare } from "./code/prcare/index.js";
import type { WebhookHooks } from "./code/webhook.js";
import { createGithubActions, createJobs } from "./code/jobs/index.js";
import { registerCustomConnectorRoutes } from "./routes/connectors/connectorsCustom.js";
import { registerOAuthClientMetadataRoute } from "./routes/connectors/oauthClientMetadata.js";
import { startDirectorySync } from "./connectors/registry.js";
import { registerAssistantRoutes } from "./routes/ask/assistant.js";
import { RunLedger, runStore, startRunSweeper } from "./runs/index.js";
import { registerDemoRoutes } from "./routes/site/demo.js";
import { initControl, registerControlRoutes } from "./control/index.js";
import { initPush, notifyApproval, notifyCodeJob, pushEngine, registerPushRoutes } from "./push/index.js";
import { registerPushTokenRoutes, SupabasePushTokens } from "./push/tokens.js";
import { registerReviewCodeRoute } from "./routes/account/reviewCode.js";
import { registerDeviceLinkRoutes } from "./routes/account/deviceLink.js";
import { registerDeviceRoutes } from "./routes/account/devices.js";
import { getConfig } from "./config.js";
import { resolveUser, supabase } from "./auth/supabase.js";
import { enforceQuota, recordUsage } from "./usage/metering.js";
import { captureException, fastifyLoggerOptions, initSentry } from "./observability.js";
import { getProfile } from "./profile/store.js";
import { isValidTtsVoice } from "./experience/ttsVoices.js";
import { cleanNickname } from "./experience/assistantName.js";
import { bumpCacheVersion } from "./experience/cacheVersion.js";
import { setMediaRegistryAccessor } from "./experience/mediaRegistry.js";
import type { Personality } from "../../shared/types/api.js";
import { planStream } from "./agent/llm.js";
import { registerHealthRoutes } from "./routes/site/health.js";
import { registerPolicyPageRoutes } from "./routes/site/policyPages.js";
import { registerDevicePageRoutes } from "./routes/site/devicePage.js";
import { registerBillingRoutes } from "./routes/billing/billing.js";
import { registerSitePageRoutes } from "./routes/site/sitePages.js";
import { registerWellKnownRoutes } from "./routes/site/wellKnown.js";
import { registerTranscribeRoutes } from "./routes/writing/transcribe.js";
import { registerRefineRoutes } from "./routes/writing/refine.js";
import { registerTrainRoutes } from "./routes/writing/train.js";
import { registerVocabularyRoutes } from "./routes/writing/vocabulary.js";
import { registerDraftRoutes } from "./routes/writing/draft.js";
import { registerEditRoutes } from "./routes/writing/edit.js";
import { registerAskRoutes } from "./routes/ask/ask.js";
import { registerAgentRoutes } from "./routes/ask/agent.js";
import { registerSpeakRoutes } from "./routes/writing/speak.js";
import { registerPersonalityRoutes } from "./routes/account/personality.js";
import { registerAppScreenRoutes } from "./routes/app/appScreens.js";
import { registerProfileRoutes } from "./routes/account/profile.js";
import { registerAccountRoutes } from "./routes/account/account.js";
import { registerKeyboardRoutes } from "./routes/app/keyboard.js";
import { registerHistoryRoutes } from "./routes/account/history.js";
import { effectiveLanguage } from "./profile/language.js";
import { registerErrorHandling } from "./http/errors.js";
import { registerRequestHooks } from "./http/hooks.js";
import { registerDeviceScope } from "./http/deviceScope.js";
import { registerPlugins } from "./http/plugins.js";
import { registerStaticFileRoutes } from "./routes/app/staticFiles.js";

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
registerErrorHandling(app);
registerRequestHooks(app);
// A terminal's own sign-in (Xode in the terminal, auth/deviceTokens.ts) reaches Xode's routes only: 403 device_scope elsewhere.
registerDeviceScope(app);
await registerPlugins(app, { cfg });

// --- Media store -----------------------------------------------------------
// Serves /media/* as static files from MEDIA_DIR (mounted volume so uploads
// survive container recreation). Admin routes (/v1/media/*) handle upload +
// list + delete. The bootstrap response surfaces the registry as
// `bootstrap.media` so clients can resolve keys → URLs without a separate
// request. Registered AFTER rate-limit so admin endpoints can be throttled.
const MEDIA_DIR = process.env.MEDIA_DIR || "/data/media";
const MEDIA_PUBLIC_URL = process.env.MEDIA_PUBLIC_URL
  || `${process.env.PUBLIC_ORIGIN || "https://api.x0bot.com"}/media`;
await loadMediaRegistry(MEDIA_DIR);
// Let the SDUI catalog reach into the media registry (for e.g. surfacing
// the "mic.animation" media URL into the keyboard config's flags). Avoids a
// circular import between routes/app/media.ts and the screens (experience/mediaRegistry.ts).
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
await registerStaticFileRoutes(app, { downloadsDir: DOWNLOADS_DIR });

await app.register(transcribeStream);
// Live updates (src/live, docs/bots-app.md "Live updates"): WS /v1/live carries "this changed" to every device a person has
// open, and every write the Bots app makes over HTTP says which topics it changed, after its response (live/writes.ts).
registerLiveRoutes(app);
installLiveWrites(app);

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
  // Their name for the keyboard reaches every prompt, so it is a name and
  // nothing else: refused outright rather than dropped, so the Settings field
  // can say why. "" clears it.
  if (p.assistantName !== undefined) {
    const nick = cleanNickname(p.assistantName);
    if (nick === null) return { status: 400, message: "A name is letters, spaces, ' and -, up to 24 characters." };
    p.assistantName = nick;
  }
  const over = tooLong(p.tone) ?? tooLong(p.signature) ?? tooLong(p.customInstructions)
    ?? tooLong(p.vocabulary) ?? tooLong(p.snippets);
  return over ? { status: 413, message: over } : null;
}

// --- Pages and public endpoints ---------------------------------------------
registerHealthRoutes(app, { cfg });
registerPolicyPageRoutes(app, { cfg });
// x0bot.com/device: where `xode login` sends the person to approve the terminal.
registerDevicePageRoutes(app);
registerBillingRoutes(app, { cfg });
registerSitePageRoutes(app, { cfg });

// What search and answer engines read: the language pages, the questions, the
// sitemap and llms.txt. Served through the site's proxy, canonical at
// x0bot.com, built from seo/facts.ts like every other page's facts.
registerSeoRoutes(app);

// The landing page at /, its copy at /v1/site, and the live demo — a visitor's
// own voice written clean, no account. See routes/site/demo.ts for why the demo is
// off by default and how it is bounded when on.
registerDemoRoutes(app, {
  downloadsDir: DOWNLOADS_DIR,
  siteDir: cfg.SITE_DIR,
});
registerWellKnownRoutes(app);

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
// Connected apps: Ask acting in the person's own apps through MCP. Off unless
// CONNECTORS is true; the routes then say so and the agent's planner is untouched.
const connectors: Connectors | null = cfg.CONNECTORS
  ? createConnectors({
      notify: async (userId, task, a) => notifyApproval(
        userId, task.id, (await connectors?.hub.resolve(userId, a.connector).catch(() => undefined))?.name ?? "an app",
      ),
    })
  : null;
if (connectors) app.addHook("onClose", async () => { await connectors.hub.close(); });
// More apps: the MCP Registry's remote servers, copied in every 12 hours, only
// while people may add apps by link (connectors/registry.ts). Never in a
// request's way; a failed run waits for the next one. The first run waits a
// minute, so a server that is only starting and stopping (a test) never crawls.
if (connectors?.custom.enabled) {
  const stop = startDirectorySync({ store: connectors.directory, log: app.log });
  app.addHook("onClose", async () => { stop(); });
}
// The run ledger (src/runs): every Ask run on the desktop and the phone,
// written down after its answer has gone, and its receipt. The sweep closes
// runs nobody will finish and lets go of people's words when their time is
// up; it never runs in a request's way.
const ledger = new RunLedger({ log: app.log });
const stopRuns = startRunSweeper({ store: runStore(), log: app.log });
app.addHook("onClose", async () => { stopRuns(); });
registerConnectorRoutes(app, { rateLimit: AUTHED_RL, connectors });
// Xode's GitHub side: connect an install, pick a repo, start a work
// branch (src/code). Off unless CODE_GITHUB is true; the routes then answer
// 404 code_off, and with the GitHub App not set up, 503 not_configured.
// With CODE_JOBS_MODE=cloudflare the jobs (the agent loop, the project brain's builds) run on the Worker in jobs/: this server hands
// them over (signed calls, docs/cloudflare-jobs.md) and starts no orchestrator and no ticker. "local" (the default) is as it always was.
const jobsHandoff = jobsHandoffFromConfig(cfg, app.log);
const code = cfg.CODE_GITHUB ? createCode(jobsHandoff ? { brain: cfg.CODE_PROJECT_BRAIN ? { remote: jobsHandoff } : false } : {}) : null;
// PR care (src/code/prcare) is made after the jobs and the agent it uses; the webhook reads its hooks on each delivery, so they are filled in below.
const careHooks: WebhookHooks = {};
let care: PrCare | null = null;
registerCodeRoutes(app, { rateLimit: AUTHED_RL, code, hooks: careHooks });
// The project brain (code/project): its lines go to the server's log, and its push timers stop with the server.
if (code?.brain) {
  code.brain.useLog(app.log);
  app.addHook("onClose", async () => { code.brain!.dispose(); });
}
// Xode's jobs and the environment router (src/code/jobs, docs/code-router.md): where each step that
// needs a computer runs (the person's PC, then GitHub's free minutes, then paid compute by their own rule), the
// runner protocol the desktop app will speak, and a ticker (every 15 s, started when the server is ready and
// stopped when it closes) that takes back leases that ran out and looks at the steps out on GitHub.
// GitHub's free computers are a real provider (code/jobs/githubActions.ts) whenever the App or the sign-in is
// set up: a step is a throwaway tailzu-run/ branch in the person's own repo, and its result comes back to
// POST /v1/code/runner/gh-result with GitHub's identity token. Whether a project can use it (the App's
// Workflows and Actions permissions, or the sign-in's `workflow` scope) and whether the person has it switched
// on (github_enabled) is decided per project and person when a step is placed. Paid compute has no provider
// yet. The person is told through the push engine.
// With the live session on (jobs on Cloudflare), this server's own router counts the month's Actions minutes too and can hand a runner the way
// into a job's room, so a step it places (a waiting job looked at again when a heartbeat arrives) is the same as one the Worker places.
const liveSession = !!(jobsHandoff?.configured && cfg.CODE_LIVE_SESSION);
const offerSession = liveSession ? sessionOffers({ secret: cfg.CODE_JOBS_SECRET!, jobsUrl: cfg.CODE_JOBS_URL!, idleSec: cfg.CODE_SESSION_IDLE_SEC }) : undefined;
const githubActions = code ? createGithubActions({ code, log: app.log, ...(offerSession ? { offerSession } : {}) }) : null;
// A job's news goes to the person (the push engine) and to PR care, which writes the end of a job it started on the pull request.
const notifyJob: typeof notifyCodeJob = async (userId, kind, data) => { liveJob(userId, data.jobId); await notifyCodeJob(userId, kind, data); care?.onJobEvent(userId, kind, data); };
const codeJobs = code ? createJobs({ code, github: githubActions, notify: notifyJob, log: app.log, ...(liveSession ? { actions: true, ...(offerSession ? { offerSession } : {}) } : {}) }) : null;
// The agent loop (src/code/agent, docs/code-agent.md): the worker that drives a job made through POST /v1/code/jobs
// from the person's words to a pull request, claiming each job in the database so that no two servers run one, at
// most CODE_AGENT_CONCURRENCY at a time, checkpointing after every step so a restart carries on without redoing an
// edit or a commit. It needs the project brain (CODE_PROJECT_BRAIN) as well; without it jobs are left to whatever
// drives the router, as before. The ticker above hands back the claims of servers that went quiet.
const codeAgent = code && codeJobs ? createAgent({ code, jobs: codeJobs, notify: notifyJob, log: app.log, ...(jobsHandoff ? { remote: jobsHandoff } : {}) }) : null;
// PR care (src/code/prcare, docs/pr-care.md): looks after the pull requests Tailzu opened (and ones the person hands over) after they are open: red CI, a reviewer's
// ask, a conflict with the default branch. GitHub's events reach it through the webhook; it needs the App subscribed to them (docs/github-app.md). It makes jobs on
// the agent above, so it exists only where that does.
if (code && codeJobs && codeAgent) {
  care = createPrCare({ code, jobs: codeJobs, agent: codeAgent, notify: notifyJob, log: app.log });
  if (care) {
    const c = care;
    careHooks.care = (event, payload) => c.onEvent(event, payload);
    careHooks.pushed = (project) => c.baseMoved(project);
    const stopCare = startCareSweep(c, { log: app.log });
    app.addHook("onClose", async () => { stopCare(); await c.idle(); });
  }
}
registerCodeJobRoutes(app, {
  rateLimit: AUTHED_RL, code, jobs: codeJobs, githubActions, agent: codeAgent, care,
  // The live session's passes (docs/cloudflare-jobs.md section 10): only when the jobs run on the Worker, and it can be reached.
  ...(jobsHandoff?.configured && cfg.CODE_LIVE_SESSION ? { live: { jobsUrl: cfg.CODE_JOBS_URL!, secret: cfg.CODE_JOBS_SECRET! } } : {}),
  // On the Worker the ticker is the Cron Trigger: this server starts none.
  ...(jobsHandoff ? { tickEveryMs: null, onStepResult: (jobId: string) => { void jobsHandoff.wake(jobId, "runner"); } } : {}),
});
// Artifacts (src/artifacts, docs/artifacts.md): live things a bot makes and the person sees and clicks in the app, run by the viewer in a
// sandbox with no network. Off unless ARTIFACTS is true (the routes then answer 404 artifacts_off). With Xode on, a project's
// artifacts look like the project and "build it" makes a job (the routes use `code`, the job router and the agent above).
const artifacts = createArtifacts({ log: app.log });
registerArtifactRoutes(app, { rateLimit: AUTHED_RL, artifacts, code, jobs: codeJobs, agent: codeAgent, viewer: liveViewerOf(cfg) });
// The front door (src/front, docs/front-door.md): one smart entry point for a message, POST /v1/ask with a `message` (the desktop's old ask,
// with a `question`, is the route below as it always was). Off unless FRONT_DOOR is true: those bodies are then answered 404 front_door_off.
// The overload guards (src/guard) are on the routes that spend money either way; GET /v1/admin/guard shows them.
// Media and files (src/media, docs/media.md): a PDF, an office file, a spreadsheet, a picture, a recording, a video or a zip is read once and a question about it is
// answered from the few chunks that matter. Off unless MEDIA_INGEST is true: the attachment registry then keeps its "coming soon" for those kinds and /v1/files answers
// 404 media_off. Bytes go to R2, text and chunks to migration 0035's tables, office files and hard PDFs to the worker (media-worker/).
const media = createMedia({ log: app.log });
// The projects' code copies (code/project/copies.ts): one unused for a month goes, and past the disk cap the longest unused. Looked at every six hours.
if (code?.copies) {
  const sweepCopies = () => { void code.copies!.sweep().then((n) => { if (n) app.log.info({ removed: n }, "code copies swept"); }).catch(() => undefined); };
  setTimeout(sweepCopies, 60_000).unref();
  setInterval(sweepCopies, 6 * 3_600_000).unref();
}
// Sign in with Apple, ended when the account is (src/auth/appleSignIn.ts): null until the Sign in with Apple key is set.
const appleSignIn = createAppleSignIn(supabase());
if (media) startMediaSweep(media, { log: app.log });
registerFilesRoutes(app, { rateLimit: AUTHED_RL, media, artifacts, code });
const attachments = new AttachmentRegistry();
if (media) registerMedia(attachments, media);
const front = createFront({ artifacts, code, jobs: codeJobs, agent: codeAgent, log: app.log, attachments });
// The bots platform (src/bots, docs/bots.md): everything is a bot (Code, Keylessbord, Plan, Travel), and a person makes their own, each with its tools, knowledge, memory and an
// API endpoint for their own apps. Off unless BOTS is true: /v1/bots answers 404 bots_off and "Ask any bot" on POST /v1/ask does too. It runs on what is above: the connected
// apps (same permission tiers), the files, the artifact core, Xode's chat and the web; migration 0038 keeps the bots, their keys (hashed), commands and memory.
const bots = createBots({ ports: botPorts({ connectors, media, artifacts, code }), ...(front ? { guard: front.guard } : {}) });
registerBotRoutes(app, { rateLimit: AUTHED_RL, bots });
// Routines (src/routines, docs/routines.md): a bot does something on a schedule, without being asked each time. On with the bots platform
// unless ROUTINES=false; every minute the ones that are due run as their owner, through the bot's own road. Migration 0062 keeps them.
const routines = createRoutines({
  store: routineStore(), bots, events: routineEvents(), publish: livePublish,
  notify: async (userId, msg) => { try { await pushEngine()?.notify(userId, msg); } catch { /* the answer is still on the routine */ } },
});
if (routines) {
  const stopRoutines = startRoutines(routines, app.log);
  app.addHook("onClose", async () => { stopRoutines(); });
}
registerRoutineRoutes(app, { rateLimit: AUTHED_RL, routines });
// The server watches its own disk, memory and CPU, and tells its owner before one runs out (src/ops/alerts.ts; OPS_ALERT_USER_ID).
{
  const owner = getConfig().OPS_ALERT_USER_ID;
  if (owner) {
    const stopOps = startOpsAlerts({
      send: async (m) => { await pushEngine()?.notify(owner, { kind: "ops_alert", key: m.key, vars: { title: m.title, body: m.body } }); },
      log: app.log,
    });
    app.addHook("onClose", async () => { stopOps(); });
  }
}
// Everyday tools (src/everyday, docs/everyday.md): flights, hotels, currency and weather for every bot that fits, free, no sign-in.
registerEverydayRoutes(app, { rateLimit: AUTHED_RL, everyday: everyday() });
// The person's context (src/context, docs/context.md): who they are, who they message, their last asks and open work, for the one key's
// brain and Ask's first step. Off with CONTEXT=false; migration 0065 keeps it.
const personContext = createPersonContext({ jobs: codeJobs, connectors, routines: routineStore() });
registerContextRoutes(app, { rateLimit: AUTHED_RL, context: personContext });
// The one key's brain (src/askDecide, docs/ask-decide.md): what the person meant, in any language.
registerAskDecideRoutes(app, { rateLimit: AUTHED_RL, bots, context: personContext });
// The voice chat (src/talk, docs/talk.md): one key anywhere, turn after turn; the answer streamed as NDJSON.
registerTalkRoutes(app, { rateLimit: AUTHED_RL, bots, context: personContext });
const botsAreaDeps = { rateLimit: AUTHED_RL, bots, code, jobs: codeJobs, connectors, media, artifacts, agent: codeAgent, routines };
registerBotsShellRoutes(app, botsAreaDeps);
const you = registerBotsYouRoutes(app, botsAreaDeps);
// The bots area's parts, made once here so the meeting bot reads the same Spaces (who is whose admin) as its routes do.
const botsParts = botsAreaParts({ bots, connectors });
const botsArea = registerBotsBotsRoutes(app, botsAreaDeps, { parts: botsParts });
registerBotsKeybotRoutes(app, botsAreaDeps);
registerBotsCodeRoutes(app, botsAreaDeps);
// The Xode flow (code/flow, routes/bots/botsXode.ts): read and hear the direction, agree a plan, approve it, judge each message against it.
registerXodeFlowRoutes(app, botsAreaDeps);
registerBotsFirstRunRoutes(app, botsAreaDeps);
registerBotsPushAskRoutes(app, botsAreaDeps);
// The bots' looks and moments: the catalog the apps draw and play, and pushing a new one (experience/bots/looks.ts).
registerBotLooksRoutes(app, { rateLimit: AUTHED_RL });
// The native looks: the nlook catalog the widgets and the Live Activity draw, and the art and fonts they draw with
// (experience/native/*, docs/native-looks.md). Answers 404 while NATIVE_LOOKS is off, which is the default.
registerNativeLooksRoutes(app, { rateLimit: AUTHED_RL });
// The Oracle's card: when and where a person was born, for the Oracle to read their sky from (src/oracle, docs/oracle.md).
registerOracleRoutes(app, { rateLimit: AUTHED_RL, bots });
// Who is whose space admin (meet/people.ts; nobody while Spaces is off), made once from the bots area's Spaces: the meeting bot and the mail
// bot read the same people.
const spacesPeople = spacePeople({ spaces: botsParts.spaces, blocks: new Blocks(Date.now, { log: app.log }) });
// The mail bot's pages: a business's mail on our mail server, passed to its worker inside the account of the business's owner, and the
// worker's signed notice that mail needs a person (src/mail, docs/mail.md). In a space, an admin reaches a member's businesses whole, and a
// member answers only the addresses its owner gave them (mail/access.ts).
registerMailRoutes(app, { rateLimit: AUTHED_RL, bots, people: spacesPeople });
// The meeting bot (src/meet, docs/meet.md): a bot in a person's video calls through Recall.ai, Recall's two signed webhooks and the stage page
// its voice plays through. With a Google Calendar connected it joins their calendar's meetings by itself (the sweep, every five minutes).
registerMeetRoutes(app, {
  rateLimit: AUTHED_RL, bots,
  calendarConnected: async (userId) => {
    if (!connectors) return false;
    return (await connectors.store.listConnections(userId)).some((c) => c.connectorId === "google-calendar" && Boolean(c.tokensEnc));
  },
});
// In a space, its admin sees the meetings of the members who agreed to the line about the admin, is told when they take the bot to one,
// and may send it to theirs (meet/people.ts; nobody while Spaces is off).
setMeetPeople(spacesPeople);
if (connectors && meetService()) {
  const stopAutoJoin = startAutoJoin({
    store: meetStore(),
    source: googleEvents(new GoogleSession({ store: connectors.store, google: connectors.google })),
    schedule: (u, ev) => meetService()!.schedule(u, ev),
    cancel: (u, id) => meetService()!.cancel(u, id),
  });
  app.addHook("onClose", async () => { stopAutoJoin(); });
}
// The cinema bot (src/cinema, docs/cinema.md): films made shot by shot and pictures, every model through OpenRouter. Its tick moves each film
// on (the stills, the takes, the checks, the cut) every few seconds; only while it is switched on (CINEMA=true) and BOTS is on.
const cinema = bots && cinemaOn() ? buildCinemaService() : null;
registerCinemaRoutes(app, { rateLimit: AUTHED_RL, bots, service: cinema });
if (cinema) {
  const stopCinema = cinema.start();
  app.addHook("onClose", async () => { stopCinema(); });
}
registerBotSoundsRoutes(app, { rateLimit: AUTHED_RL });
// Blip on the desktop: his moves and poses, and pushing new ones (experience/bots/blip.ts).
registerBlipRoutes(app, { rateLimit: AUTHED_RL });
// The phone's launch motion, and pushing a new one (experience/phone/launch.ts).
registerLaunchRoutes(app, { rateLimit: AUTHED_RL });
const frontRoutes = registerFrontRoutes(app, {
  rateLimit: AUTHED_RL, front, bots,
  // "Ask any bot": a bot shared into a space reads what the space shared, as data, as in its chat.
  ...(bots ? { sharedFor: botsArea.sharedFor } : {}),
  quota: (user) => enforceQuota(user),
  // The model's words are not the person's: recorded at zero words, like the old ask, so the call still shows in usage. What the front
  // door's own calls cost goes on the usage meter (a bot's answer is written down by the bots platform).
  used: (user, paise) => {
    you.spending.record(user.id, "tailzu", paise);
    return recordUsage({ user, source: "rest", audioSeconds: 0, words: 0, model: "front" });
  },
});
// The Worker's way back to the push engine (the push credentials stay here).
registerCodeInternalRoutes(app, { rateLimit: AUTHED_RL, secret: jobsHandoff ? cfg.CODE_JOBS_SECRET : null, store: jobStore(), notify: notifyJob });
// "Sign in with GitHub" tokens unused for 30 days are revoked at GitHub (code/oauth.ts), on a timer, even
// with the switch off: revoking only destroys. Never in a request's way.
if (code?.oauth) {
  const stopOAuth = startOAuthSweeper({ oauth: code.oauth, log: app.log });
  app.addHook("onClose", async () => { stopOAuth(); });
}
// Apps a person adds by link (CUSTOM_CONNECTORS): adding, removing, and their tools one by one.
registerCustomConnectorRoutes(app, { rateLimit: AUTHED_RL, connectors });
// The page an app's auth server reads to learn who Tailzu is (oauth.ts). Only
// worth serving while connected apps are on; built from the same config the
// sign-in sends, so the two cannot disagree.
if (connectors) {
  registerOAuthClientMetadataRoute(app, {
    clientMetadataUrl: connectors.signIn.clientMetadataUrl ?? "", redirectUrl: connectors.redirectUrl, rateLimit: AUTHED_RL,
  });
}
// UNAUTH_RL removed — every previously-unauth route was gated on
// per-user hashed tokens anyway, so AUTHED_RL is the right cap and
// avoids the 429-storm we saw on /v1/keyboard/config launch traffic.

// The fixed review pair. 404s unless BOTH REVIEW_EMAIL and REVIEW_CODE are set,
// so in ordinary operation this route does not exist. See routes/account/reviewCode.ts.
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
// Signing in on a computer with the phone: the window's QR, approved on the phone (routes/account/deviceLink.ts, migration 0049).
// Off (link_off) without the service key, which mints the window's session. Its own limits, per address and per person.
registerDeviceLinkRoutes(app);
// Xode in the terminal: its own sign-in (whoami, sign out) and the person's list of them (migration 0066). Limits of their own.
registerDeviceRoutes(app);

// --- Writing: dictation, typing, the screen and the person's voice ----------
registerTranscribeRoutes(app, { rateLimit: AUTHED_RL, tooLong, personalityProblem });
registerRefineRoutes(app, { tooLong, personalityProblem, cfg, rateLimit: AUTHED_RL });
registerTrainRoutes(app, { rateLimit: AUTHED_RL, tooLong, cfg });
registerVocabularyRoutes(app, { rateLimit: AUTHED_RL });
registerDraftRoutes(app, { rateLimit: AUTHED_RL, tooLong, personalityProblem, cfg });
registerEditRoutes(app, { rateLimit: AUTHED_RL, tooLong, personalityProblem, cfg });
registerAskRoutes(app, { rateLimit: AUTHED_RL, cfg, frontRoutes, tooLong, personalityProblem });

// Ask's own limit, shared by the desktop's on-screen agent and the phone's Ask.
const AGENT_RL = {
  rateLimit: { max: cfg.AGENT_RATE_LIMIT_MAX, timeWindow: cfg.AGENT_RATE_LIMIT_WINDOW_MS },
};
registerAgentRoutes(app, { rateLimit: AGENT_RL, cfg, ledger, connectors, context: personContext });

// --- The phone's Ask (REST): one command, no screen ------------------------
//
// The same planner and connected apps as /v1/agent, for Tailzu on the phone:
// one JSON answer ({ say, open?, taskId?, receipt }) instead of a stream,
// since there is no screen to act on step by step. See src/routes/ask/assistant.ts.
registerAssistantRoutes(app, {
  rateLimit: AGENT_RL,
  connectors,
  ledger,
  plan: (system, userMessage, signal, picture, log) => planStream(system, userMessage, {
    signal, picture,
    log: (call) => {
      app.log.info({ ask: call }, "assistant ask model call");
      log?.(call);
    },
  }),
  profileLanguage: (user) => getProfile(user).then((p) => p?.language),
  quota: (user) => enforceQuota(user),
  record: (user, result) => recordUsage({ user, source: "agent", audioSeconds: 0, words: result.words, model: result.model ?? "rules" }),
});
registerSpeakRoutes(app, { rateLimit: AUTHED_RL, tooLong, cfg });
registerPersonalityRoutes(app, { rateLimit: AUTHED_RL, personalityProblem, tooLong });

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

// --- The server-driven app, the person's account and the keyboards ----------
registerAppScreenRoutes(app, { rateLimit: AUTHED_RL, cfg, connectors, bots, jobs: codeJobs });
registerProfileRoutes(app, { rateLimit: AUTHED_RL, appleSignIn });
// The AI permission: GET/PUT /v1/you/ai-consent (privacy/aiConsent.ts).
registerAiConsentRoutes(app, { rateLimit: AUTHED_RL });
registerAccountRoutes(app, { rateLimit: AUTHED_RL, code, appleSignIn, media, jobs: codeJobs, agent: codeAgent });
registerKeyboardRoutes(app, { rateLimit: AUTHED_RL, cfg });
registerHistoryRoutes(app, { rateLimit: AUTHED_RL });

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

  // The AI permission (privacy/aiGate.ts): every call to an AI service asks whether its person agreed. Installed here, not in
  // buildApp, so the tests that build the app are not stopped by it (tests/ai-consent.test.ts installs it itself).
  if (cfg.AI_CONSENT_GATE) { installAiConsent(); installAiFetchGuard(); }
  // What is posted in Spaces is screened (botsBots/filter.ts): the word list always, OpenAI's moderation model too where there is a key.
  if (cfg.OPENAI_API_KEY) setModeration(openAiModeration(cfg.OPENAI_API_KEY));

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
