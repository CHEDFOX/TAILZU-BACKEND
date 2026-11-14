/**
 * The server-driven app: POST /v1/app/bootstrap, POST /v1/app/screen, and the screens' cache version.
 */

import { greetingName, providerNameToSave } from "../bots/botsFirstRun.js";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { reportMilestones } from "../../ads/meta.js";
import { resolveUser } from "../../auth/supabase.js";
import { getEntitlement, isEntitled } from "../../billing/entitlements.js";
import { payLink } from "../../billing/razorpay.js";
import type { Bots } from "../../bots/service.js";
import type { JobRouter } from "../../code/jobs/router.js";
import type { AppConfig } from "../../config.js";
import type { Connectors } from "../../connectors/index.js";
import { assistantView } from "../../connectors/list.js";
import { withControl, requireAdmin } from "../../control/index.js";
import { isOurPayPage } from "../../domains.js";
import { deskVoices } from "../../experience/appLists.js";
import { ASSISTANT_SCREENS } from "../../experience/assistant/screens.js";
import { buildBootstrap } from "../../experience/bootstrap/bootstrap.js";
import { FONT_BRICOLAGE_CAPABILITY } from "../../../../shared/types/sdui.js";
import { botsAppOn, botsOnly, isBotsScreen, botsDepsFor, emptyDeps, buildBotsScreen } from "../../experience/bots/index.js";
import { looksCan, playsFormat } from "../../experience/bots/looks.js";
import { BOTS_HANDOFF_IDS } from "../../experience/bots/screens/handoff.js";
import { bumpCacheVersion, currentCacheVersion } from "../../experience/cacheVersion.js";
import { localize } from "../../experience/i18n.js";
import { canOnboard, onboardLanguage } from "../../experience/onboard/screens.js";
import { hasAlreadyDictated } from "../../experience/onboard/guard.js";
import { canOnboardStore, onboardMode } from "../../experience/onboard/store.js";
import { buildScreen } from "../../experience/screens.js";
import { statsForUser } from "../../history/stats.js";
import { listHistory, MAX_LIMIT as HISTORY_MAX_LIMIT } from "../../history/store.js";
import { listNotes, getNote } from "../../notes/store.js";
import { getPersonality, updatePersonality } from "../../personality/store.js";
import { getProfile, updateProfile, touchLastSeen } from "../../profile/store.js";
import { pushEngine } from "../../push/index.js";
import { usageSummary, allowanceFor } from "../../usage/metering.js";
import { markSeen } from "../../widgets/glanceStore.js";
import { AUTH_RESUME_SCHEME_URL } from "../site/demo.js";
import { noStoreSdui, clip, gzipLargeJson } from "../../http/helpers.js";
import { getMediaRegistry } from "./media.js";
import { serveScreen } from "../../experience/sdui2/gate.js";

export interface AppScreenRouteDeps {
  rateLimit: { rateLimit: { max: number; timeWindow: number } };
  cfg: AppConfig;
  connectors: Connectors | null;
  bots: Bots | null;
  jobs: JobRouter | null;
}

export function registerAppScreenRoutes(app: FastifyInstance, deps: AppScreenRouteDeps): void {
  const { rateLimit: AUTHED_RL, cfg, connectors, bots, jobs: codeJobs } = deps;
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
        /** The bots' catalog as this build has it (anim/SPEC.md 3.9): version, format, whether it compiled, and
         *  the first scenes that went wrong or that its governor slowed. Nothing about the person. */
        looks?: unknown;
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
    // THE BOTS' CATALOG, AS THIS BUILD HAS IT (anim/SPEC.md 3.9), so a push is never a silent no-op. Only when
    // there is something to say: the catalog did not compile, or a scene went wrong or was slowed on the device.
    // The whole report is at most 512 bytes and holds nothing about the person; it is clipped again here.
    const looksSaid = reqBody.capabilities?.looks as
      { v?: number; f?: number; ok?: boolean; why?: string; bad?: string[]; slow?: string[] } | undefined;
    if (looksSaid && typeof looksSaid === "object"
      && (looksSaid.ok === false || !!looksSaid.bad?.length || !!looksSaid.slow?.length)) {
      req.log.warn(
        {
          looks: clip(JSON.stringify(looksSaid), 512),
          bundle: clip(reqBody.capabilities?.bundle, 40) || "unknown",
          platform: clip(reqBody.capabilities?.platform, 20) || "unknown",
        },
        "[boot] the bots' catalog is not playing on this build",
      );
    }
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
    //
    // Not for the new onboarding: there the flow itself ends at Done, which is
    // what marks it, so nothing about the device may mark it first.
    const onboardV2 = canOnboard(reqBody.capabilities?.components);
    // The same flow for a store build, which cannot draw the stage (onboardStore.ts).
    const onboardStore = canOnboardStore(reqBody.capabilities?.components, isDesktop ? "desktop" : "phone");
    const newOnboarding = onboardV2 || onboardStore;

    // SOMEONE WHO HAS ALREADY DICTATED IS ONBOARDED, WHATEVER THE PROFILE SAYS.
    //
    // The new flow's only mark is its Done. An account made before it, and above
    // all one that only ever used the desktop app (which had no onboarding), never
    // had the mark, and would be walked through it once as if new. Words or
    // history is "has dictated" (onboardGuard.ts). Written once, so the profile
    // says what is true from here on, and used now for this answer; the write
    // failing costs the same check next launch, never the boot. Not for the old
    // flow, which has always decided this its own way.
    const dictatedBefore = newOnboarding && !!user && !!profile && !profile.onboarded && !isReviewer
      && await hasAlreadyDictated(user, usage?.total?.words ?? 0);
    if (dictatedBefore && user) {
      updateProfile(user, { onboarded: true }).catch((e) => {
        req.log.warn({ err: e }, "[boot] could not mark an account that has already dictated as onboarded");
      });
    }
    if (user && profile && !profile.onboarded && micGranted && keyboardReady && !newOnboarding) {
      updateProfile(user, { onboarded: true }).catch((e) => {
        // Losing this write costs a repeat of the same skip next launch, not a
        // broken app — so it must never fail the bootstrap.
        req.log.warn({ err: e }, "[boot] could not mark onboarded after skipping setup");
      });
    }

    // THE BOTS APP (experience/bots): the switch, a build that draws its kit, and the testers while that list is set.
    const botsApp = botsAppOn({ on: cfg.BOTS_APP, testers: cfg.BOTS_APP_TESTERS, email: user?.email, components: reqBody.capabilities?.components });
    // The Bots app has no step after sign-in (App Review 4: nothing is asked once they are in): a signed-in account is
    // onboarded here, and Home opens on its welcome. The write failing costs the same mark next launch, never the boot.
    const botsIn = botsApp && !!user && !!profile && !profile.onboarded && !isReviewer;
    if (botsIn && user) {
      // Onboarded with the name Google or Apple sent saved on the account (when it has none), so it is there from the first visit.
      const name = providerNameToSave(user, profile.fullName);
      updateProfile(user, { onboarded: true, ...(name ? { fullName: name } : {}) }).catch((e) => {
        req.log.warn({ err: e }, "[boot] could not mark a Bots app account onboarded after sign-in");
      });
    }
    const bootstrap = buildBootstrap({
      botsApp,
      // Only the nlook catalog's flag reads this, to keep the sync off the phones of people no rule names.
      ...(user ? { userId: user.id } : {}),
      // Bricolage's three faces only to a Bots app build that sets them (sdui 3j FontBricolage).
      fontBricolage: botsApp && (reqBody.capabilities?.components ?? []).includes(FONT_BRICOLAGE_CAPABILITY),
      looksFormat: playsFormat(looksCan(new Set((reqBody.capabilities?.components ?? []).map(String)), user?.id)),
      onboarded: isReviewer || botsIn || (!newOnboarding && micGranted && keyboardReady) || dictatedBefore || (profile?.onboarded ?? false),
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
      payUrl: user && isOurPayPage(cfg.REVENUECAT_WEB_PAYWALL_URL)
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
      // The Tasks tab: the window can show it ("DeskConnectors") and the
      // assistant's connected apps are switched on.
      deskTasks: !!connectors && Array.isArray(reqBody.capabilities?.components)
        && reqBody.capabilities!.components!.includes("DeskConnectors"),
      // Plan Ease on the desktop (the app release): its notices, and "add this".
      deskNotices: Array.isArray(reqBody.capabilities?.components)
        && reqBody.capabilities!.components!.includes("DeskNotices"),
      deskAddThis: Array.isArray(reqBody.capabilities?.components)
        && reqBody.capabilities!.components!.includes("DeskAddThis"),
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
            callback: `${process.env.PUBLIC_ORIGIN || "https://api.x0bot.com"}/auth/callback`,
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
          + `&redirect_to=${encodeURIComponent(`${process.env.PUBLIC_ORIGIN || "https://api.x0bot.com"}/auth/callback?state=${randomBytes(24).toString("base64url")}`)}`
          + `&prompt=select_account`
        : null,
      micGranted,
      keyboardReady,
      // The new onboarding, for a build that declared the pieces it is drawn
      // with; and whether it has its connected-apps steps (their count sets the
      // progress bar's length, which both stages must agree on).
      onboardV2,
      onboardStore,
      connectorsOn: !!connectors,
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
    // The tray's own voices, first beside its tones (appLists.ts deskVoices): per person, so sent here, never a knob.
    if (isDesktop && bootstrap.flags) bootstrap.flags["desktop.voices"] = deskVoices(personality);
    // Usage statistics (the app's telemetry/analytics.ts, PostHog) only for someone who turned them on in You › Privacy: consent
    // first, even for anonymous usage (App Review 5.1.1(ii)). A console rule can still turn them off for everyone.
    if (bootstrap.flags) bootstrap.flags["analytics.enabled"] = personality?.usageStats === true;
    // META: what a new account has reached since it was made, once each
    // (src/ads/meta.ts): signed up, switched the keyboard on, dictated. A
    // desktop reports it from here; a phone is handed it to log through Meta's
    // SDK, which ties it to the install and the ad behind it. Not a reviewer's.
    if (user && !isReviewer) {
      const metaEvents = await reportMilestones({
        req,
        user,
        personality,
        desktop: isDesktop,
        keyboardOn: keyboardReady || reqBody.capabilities?.device?.keyboardEnabled === true,
        wordsEver: usage?.total?.words ?? 0,
      });
      if (metaEvents.length) (bootstrap as unknown as { metaEvents?: unknown }).metaEvents = metaEvents;
    }
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
        device?: {
          width?: number; height?: number; formFactor?: string; os?: string;
          /** The new onboarding starts past the steps these two make unnecessary. */
          keyboardReady?: boolean; locale?: string;
        };
        appVersion?: string;
        /** What this bundle can render. Absence is the only honest signal that a
         *  screen needing something new must not be sent to it. */
        components?: string[];
        /** Vocabulary 2 (shared/types/sdui.ts section 8): the kernel, the blocks this build really has, and the
         *  binary's runtime, which tells "open X0 again" from "update X0". Absent on every build before V1. */
        vocab?: number;
        blocks?: string[];
        runtime?: string;
      };
    };
    const screenId = body.screenId;
    if (!screenId) {
      return reply.code(400).send({ code: "bad_request", message: "Missing 'screenId'" });
    }

    const user = await resolveUser(req.headers["authorization"]);
    // A tapped push opens its screen with the push's data as the params, so its
    // id comes back here: the engine counts it as answered (src/push).
    if (user && typeof body.params?.pushId === "string") pushEngine()?.markOpened(user.id, body.params.pushId, typeof body.params.kind === "string" ? body.params.kind.slice(0, 40) : undefined);
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

    // THE BOTS APP's screens (experience/bots): every "bots.*" id, and "home" itself, which is where every "go to
    // the app" in today's flows still points (the intro's end, the onboarding's Done). Only for a request the Bots
    // app is on for; any other build is answered exactly as before, and a "bots.*" id it asks for is unknown.
    const botsOn = botsAppOn({ on: cfg.BOTS_APP, testers: cfg.BOTS_APP_TESTERS, email: user?.email, components: body.capabilities?.components });
    // The window's notes pages (where "Your notes are ready" opens) are Notes' own pages in the Bots app.
    // A build that draws only the Bots app has nothing else to draw: any other id it is sent to (an old link, a
    // notification, a Live Activity) opens Home, but for the keyboard's handoff screens, drawn in its look.
    const oldId = botsOnly(body.capabilities?.components) && !isBotsScreen(screenId) && !BOTS_HANDOFF_IDS.has(screenId)
      && !["home", "desk_notes", "desk_note"].includes(screenId);
    const botsId = !botsOn ? screenId : screenId === "home" || oldId ? "bots.home" : screenId === "desk_notes" ? "bots.notes" : screenId === "desk_note" ? "bots.note" : screenId;
    const botsParams = screenId === "desk_note" && body.params?.noteId !== undefined ? { ...body.params, id: body.params.noteId } : body.params;
    if (isBotsScreen(botsId)) {
      if (!botsOn) return reply.code(404).send({ code: "bad_request", message: `Unknown screen '${screenId}'` });
      // The X0 widget's "last thing done" is news until it is opened: its job's page, or Activity (everything until now). Never in the way.
      if (user && botsId === "bots.code.job" && typeof botsParams?.id === "string") void markSeen(user.id, { ids: [botsParams.id] });
      else if (user && botsId === "bots.activity") void markSeen(user.id, { all: true });
      const tz = typeof body.tzOffsetMinutes === "number" && Number.isFinite(body.tzOffsetMinutes) ? body.tzOffsetMinutes : 0;
      // Through the looks' own gate: with BOTS_SCENES off, a BotMoments2 build is treated as a format-1 one here
      // too, so momentProps, idleSurprises, playable and canScenes all send what today's builds already get.
      const comps = looksCan(new Set(Array.isArray(body.capabilities?.components) ? body.capabilities!.components!.map(String) : []), user?.id);
      const deps = user
        ? botsDepsFor({
            bots, jobs: codeJobs, connectors,
            minutesSaved: (u, offset) => statsForUser(u, "week", offset).then((st) => st.minutesSaved),
            inject: (o) => app.inject({ method: o.method as "GET", url: o.url, headers: o.headers, ...(o.payload === undefined ? {} : { payload: o.payload as object }) })
              .then((r) => ({ statusCode: r.statusCode, body: r.body })),
          }, user, String(req.headers["authorization"] ?? ""), tz)
        : emptyDeps();
      const screen = await buildBotsScreen({
        screenId: botsId, client: screenFormFactor, params: botsParams, tzOffsetMinutes: tz, can: comps,
        ...(screenFormFactor === "desktop" ? {} : { platform: platformOf(body.capabilities?.platform) }),
        // The name they are greeted by: their own, else the one Google or Apple gave (botsFirstRun.ts greetingName).
        user: user ? { id: user.id, ...(greetingName(user, profile?.fullName) ? { name: greetingName(user, profile?.fullName) } : {}), ...(user.email ? { email: user.email } : {}) } : null,
        desk: { pages: comps.has("DeskShell"), notes: comps.has("DeskNotes") },
      }, deps);
      // Vocabulary 2's one door: a screen that states `needs` is checked with the device's own compiler and
      // served only to a client that declared every block it needs (experience/sdui2). A screen that says
      // nothing comes back untouched, which is every screen today.
      const gated = serveScreen(screen, { ...body.capabilities, platform: platformOf(body.capabilities?.platform) }, { client: screenFormFactor, ...(user ? { userId: user.id } : {}) });
      if (gated.audit) req.log.info(gated.audit);
      return reply.send(await localize(withControl(req, reply, gated.screen, screenCtx(botsId)), profile?.language ?? "auto"));
    }

    // Load per-screen aggregates only for the screens that need them.
    // usageSummary covers legacy stats numbers; statsForUser adds the
    // history-derived "minutes saved" + sparkline for the SDUI stats screen.
    // The desk's pages that show today's or this month's numbers read the
    // meter in the caller's own day.
    const USAGE_SCREENS = new Set(["stats", "desk_today", "desk_insights", "desk_settings"]);
    //
    // EVERY READ BELOW STARTS AT ONCE and the screen waits for them together.
    // They were awaited one after another — usage, then stats, then the meter,
    // then history, notes, the plan — so a page paid the sum of its reads, and on
    // the desk a slow sum is the "Loading…" a person sees between two pages.
    // Each read keeps its own failure rule; only the waiting changed.
    const usageRead = user && USAGE_SCREENS.has(screenId)
      ? usageSummary(user, typeof body.tzOffsetMinutes === "number" ? body.tzOffsetMinutes : undefined)
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
    const STATS_SCREENS = new Set(["stats", "personality", "home", "desk_today", "desk_insights", "desk_day", "desk_app", "desk_train"]);
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
    const statsWait = statsRead
      ? (STATS_BLOCKING.has(screenId)
          ? statsRead
          : Promise.race([
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
    const allowanceRead =
      user && ALLOWANCE_SCREENS.has(screenId)
        ? allowanceFor(user).catch(() => null)
        : undefined;
    const historyRead =
      user && (screenId === "history" || screenId === "desk_today" || screenId === "desk_history")
        ? listHistory(user, { limit: screenId === "desk_history" ? HISTORY_MAX_LIMIT : 50 }).then((r) => r.entries)
        : undefined;
    // The desk's Notes page and one note. A failed read draws the page empty
    // rather than failing it; a desktop on a static token has none to read.
    const notesRead = user && screenId === "desk_notes"
      ? listNotes(user).catch(() => [])
      : undefined;
    const noteRead = user && screenId === "desk_note" && typeof body.params?.noteId === "string"
      ? getNote(user, body.params.noteId).catch(() => null)
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
    const entitlementRead =
      user && ENTITLEMENT_SCREENS.has(screenId)
        ? getEntitlement(user).catch(() => null)
        : undefined;
    // The assistant's side of the desk: Connected apps in Settings and the Tasks
    // page. Only for a window that said it can show them ("DeskConnectors"),
    // and only while CONNECTORS is on; a failed read draws the page without.
    // An app added by link has a page of its own (what it can do, tool by
    // tool): the app it is about comes in the params, and is asked for its tools.
    const toolsOf = typeof body.params?.id === "string" && body.params.id.length <= 64 ? body.params.id : undefined;
    const assistantRead = user && connectors && screenId === "onboard"
      && (canOnboard(body.capabilities?.components)
        // The store variant has the apps steps only when its build can open what Connect leads to.
        || (onboardMode(body.capabilities?.components, screenFormFactor) === "store"
          && body.capabilities?.components?.includes("ActionUrl") === true))
      // The new onboarding's Connect your apps step, for a phone and a window
      // alike: the apps and where each stands, read fresh on every fetch so a
      // connected tile and the Continue button follow the refresh.
      ? assistantView(connectors, user.id, { apps: true }, user.email).catch(() => undefined)
      : user && connectors && screenFormFactor === "desktop"
      && Array.isArray(body.capabilities?.components) && body.capabilities!.components!.includes("DeskConnectors")
      && (screenId === "desk_settings" || screenId === "desk_tasks" || screenId === "desk_connector")
      ? assistantView(connectors, user.id, {
          apps: screenId === "desk_settings", tasks: screenId === "desk_tasks",
          tools: screenId === "desk_connector" ? toolsOf : undefined,
        }, user.email).catch(() => undefined)
      // The phone's You tab: its Hand it to me card shows the connected apps and
      // the next tasks. A failed read leaves the card without them; the tab never fails for it.
      : user && connectors && screenFormFactor !== "desktop" && screenId === "personality"
        ? assistantView(connectors, user.id, { apps: true, tasks: true }, user.email).catch(() => undefined)
      // The phone's own: Connected apps, Tasks, the confirm sheet and an added
      // app's tools (experience/assistant/). No capability to ask for: they
      // are made of pieces every build draws. Ask (assistant_ask) reads
      // nothing: its answer comes when they ask.
      : user && connectors && screenFormFactor !== "desktop" && ASSISTANT_SCREENS.has(screenId) && screenId !== "assistant_ask"
        ? assistantView(connectors, user.id, {
            apps: screenId === "assistant_apps", tasks: screenId === "assistant_tasks" || screenId === "assistant_approve",
            tools: screenId === "assistant_app_tools" ? toolsOf : undefined,
          }, user.email).catch(() => undefined)
        : undefined;
    const [usage, stats, allowance, history, notes, note, entitlement, assistant] = await Promise.all([
      usageRead, statsWait, allowanceRead, historyRead, notesRead, noteRead, entitlementRead, assistantRead,
    ]);
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
      assistant,
      connectorsOn: !!connectors,
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
      keyboardReady: body.capabilities?.device?.keyboardReady === true,
      locale: typeof body.capabilities?.device?.locale === "string" ? body.capabilities.device.locale.slice(0, 35) : undefined,
      // The keyboard's handoff screens are drawn in the Bots app's look for it.
      bots: botsOn,
      can: new Set(
        Array.isArray(body.capabilities?.components)
          ? body.capabilities!.components!.map(String)
          : [],
      ),
    });
    if (!screen) {
      return reply.code(404).send({ code: "bad_request", message: `Unknown screen '${screenId}'` });
    }
    const gatedOld = serveScreen(screen, { ...body.capabilities, platform: platformOf(body.capabilities?.platform) }, { client: screenFormFactor, ...(user ? { userId: user.id } : {}) });
    if (gatedOld.audit) req.log.info(gatedOld.audit);
    return reply.send(await localize(withControl(req, reply, gatedOld.screen, screenCtx(screenId)),
      // The onboarding speaks the first language its Languages step saved, until
      // the profile says one (see onboardLanguage). Every other screen: the profile's.
      screenId === "onboard"
        ? onboardLanguage(profile?.language, personality?.languages)
        : profile?.language ?? "auto"));
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
}
