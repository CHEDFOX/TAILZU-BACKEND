/**
 * POST /v1/app/bootstrap: the theme, the navigation, the flags and the first screen a client starts with.
 */

import { type BootstrapResponse, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { getConfig } from "../../config.js";
import type { Allowance } from "../../usage/allowance.js";
import { withAppKnobs } from "../appKnobs.js";
import { desktopLists } from "../appLists.js";
import { botsNav, botsFonts, BOTS_WARM_SCREEN_IDS } from "../bots/index.js";
import { looksFlags } from "../bots/looks.js";
import { BOTS_FIRST_RUN_SCREEN, botsAuthTree, BOTS_FIRST_RUN_IDS } from "../bots/screens/firstRun.js";
import { BOTS_OFFLINE_FLAGS } from "../bots/screens/outbox.js";
import { soundsFlags } from "../bots/sounds.js";
import { CACHE_VERSION } from "../cacheVersion.js";
import { deskNav } from "../desk.js";
import { DESKTOP_LATEST, installerUrl, desktopOs, publishedRelease } from "../desktopRelease.js";
import { FLOW_IDLE_TIMEOUT_MS, FLOW_TRANSPORT } from "../flow.js";
import { getMediaRegistryFn } from "../mediaRegistry.js";
import { onboardAuthTree, onboardAppsOn } from "../onboard.js";
import { AUTH_SDUI, AUTH_UI, authScreenTree } from "../phone/auth.js";
import { INTRO_BUILT_IN } from "../phone/intro.js";
import { navigationFor } from "../phone/navigation.js";
import { PAYWALL_CONFIG, PAYWALL_BLOCK } from "../phone/paywall.js";
import { manageFlags } from "../phone/subscription.js";
import { FONTS, THEME } from "../phone/theme.js";
import { POLICY, freeMonthlyWords, freeForAll } from "../policy.js";
import { sw } from "../settingsWords.js";
import { titleCaseLabels } from "../titleCase.js";
import { DESKTOP_UI } from "./desktopUi.js";
import { wordsMilestoneCard, LAUNCH_CARD } from "./launchCard.js";
import { applyPlatformFlags } from "./platformFlags.js";
import { arrivalPrompt, PROMPT_AFTER_MS, PUSH_ASK } from "./pushPrompt.js";
import { setupActivity } from "./setupActivity.js";
import { landingScreenId, pickInitialScreenId, WARM_SCREEN_IDS } from "./startScreen.js";

/** App Store numeric id, assigned by App Store Connect. Digits only; anything
 *  else is treated as unset so a half-filled value cannot ship a broken link. */
const APP_STORE_ID_DEFAULT = "6784811357"; // eas.json → submit.production.ios.ascAppId
const APP_STORE_ID = /^\d{6,}$/.test(process.env.APP_STORE_ID ?? "")
  ? (process.env.APP_STORE_ID as string)
  : APP_STORE_ID_DEFAULT;

/**
 * Whether the sign-in gate offers SMS. Env-gated so it can be turned on the
 * moment Twilio is verified in Supabase, without a deploy — and turned off just
 * as fast if SMS delivery goes bad in a region.
 */
const AUTH_ENABLE_PHONE = process.env.AUTH_ENABLE_PHONE !== "false";

export function buildBootstrap(
  opts: {
    onboarded?: boolean;
    /** Has this person ever reached the tab shell before? Decides which tab
     *  the app opens on — see navigationFor. */
    landedBefore?: boolean;
    profileComplete?: boolean;
    launchCount?: number;
    languagesSet?: boolean;
    /** The SERVER's answer, from the entitlements table. The client asks
     *  RevenueCat too, but only this one can lift a server-side cap. */
    entitled?: boolean;
    /** Words used this month, so the app can show the meter and the keyboard
     *  can stop before it starts. */
    wordsUsed?: number;
    /** The user's real ceiling — the plan's words plus what they have earned
     *  by coming back. Null when usage could not be read; the flags then fall
     *  back to the flat free tier, which is the conservative direction. */
    allowance?: Allowance | null;
    /**
     * Which OS is asking.
     *
     * Present so the two platforms can diverge HERE rather than by shipping
     * both variants and letting the device choose. `visibleIf: { platform }`
     * still works and is still the right tool for a small difference inside one
     * screen; this is for the differences that are not small — a flag that must
     * be on for one OS and off for the other, or a screen whose whole shape
     * differs — and for being able to change Android without touching a single
     * byte of what iOS receives.
     */
    platform?: "ios" | "android";
    /** This launch is App Review or Play Review. No intro, no arrival prompt;
     *  the caller already forces onboarded + entitled. */
    isReviewer?: boolean;
    /** The address the auth screen offers a password field for. Empty outside
     *  a submission window, which removes the path entirely. */
    reviewEmail?: string;
    /**
     * Google on Android through Supabase's OAuth page rather than the native
     * client. `callback` is where Supabase lands after Google (a page on this
     * server); `resume` is the app scheme that page hands the session to.
     * Null when AUTH_GOOGLE_WEB is off, and the app then uses the native
     * client exactly as before.
     */
    googleWeb?: { callback: string; resume: string } | null;
    /**
     * Leave the Google button out of the server-composed sign-in screen.
     * Set by the server for an Android client that has not declared the
     * `googleWeb` capability — the store bundle on a fresh install — because
     * that JavaScript cannot come back from Google. See authScreenTree.
     */
    googleHidden?: boolean;
    /**
     * The bridge for that same client: Supabase's authorize URL, which the
     * old bundle can open as a plain link and which returns on tulmi://.
     * Set only when the web path is switched on, because it needs the same
     * dashboard work; null leaves the button out instead.
     */
    googleLink?: string | null;
    /**
     * WHAT THIS PHONE ALREADY HAS, as reported in the bootstrap capabilities.
     *
     * The microphone permission and the keyboard's Full Access belong to the
     * device, not to the account — so signing out and back in with a different
     * email does not un-grant them. The steps that ask for them are then steps
     * with nothing to ask, and showing them is asking someone to do something
     * they have already done.
     *
     * Both default to false, which shows the steps: a step shown unnecessarily
     * costs a tap, a step skipped wrongly leaves the keyboard never enabled.
     */
    micGranted?: boolean;
    keyboardReady?: boolean;
    /**
     * Where the live subscription was bought — RevenueCat's own `store`, as
     * recorded on the entitlement row: "app_store", "play_store", "paddle",
     * "stripe", "rc_billing", "promotional".
     *
     * It travels because ENTITLEMENT IS NOT ENOUGH TO ACT ON. One account can
     * be reached from a phone and a window, and only one of those can change
     * an App Store subscription — Apple allows nothing else to cancel one, and
     * Paddle cannot be reached from iOS Settings. A client that knows only
     * "paid" can say nothing true about how to stop paying, and can offer a
     * second subscription on a different store to somebody who already has
     * one, which bills them twice for the same entitlement.
     */
    billingStore?: string;
    /** False once a Razorpay subscription has been cancelled (it then runs
     *  only to its period's end). Unknown for the stores'. */
    billingRenews?: boolean;
    /** The pay page signed for this account (razorpay.payLink), sent to a
     *  desktop in place of the configured link. */
    payUrl?: string;
    /**
     * "phone" (the default, and every mobile client) or "desktop".
     *
     * A window is not a handset, and the two steps above are about a handset.
     * Absent means phone, so nothing that does not send it changes.
     */
    formFactor?: string;
    /** The desktop's operating system — "mac", "windows" or "linux" — when
     *  the window says. Apple's button is drawn on a Mac and left out on
     *  the others; a phone never sends this. */
    os?: string;
    /**
     * THE DESK: a desktop that declared DeskShell gets Tailzu's own pages
     * (experience/desk.ts) — the masthead's tabs, landing on Today — instead
     * of the phone's. An older installer does not declare it and keeps the
     * rail and the phone's screens.
     */
    desk?: boolean;
    /** The desk's window can take notes (it said "DeskNotes"): it gets the
     *  Notes tab. An older one has no hotkey for it and does not. */
    deskNotes?: boolean;
    /** The desk's window can show the assistant's Tasks (it said
     *  "DeskConnectors") and connected apps are on: it gets the Tasks tab. */
    deskTasks?: boolean;
    /** Signed in at all — setup's first step. */
    signedIn?: boolean;
    /** Words ever written, for setup's last step: a first sentence said. */
    wordsEver?: number;
    /** Nothing to set up (an App Review account). */
    setupDone?: boolean;
    /**
     * THE ASKING BUILD DRAWS THE NEW ONBOARDING (canOnboard: it declared both
     * OnboardStage and BlipSpot, and ONBOARD_V2 is on). Everything new is sent
     * only on this: the stage tree as the sign-in screen, "onboard" as the
     * first screen of a person who is not onboarded yet (a window included),
     * and no automatic "onboarded" mark from device signals, because the flow
     * itself ends at Done. Absent, a client gets exactly what it always did.
     */
    onboardV2?: boolean;
    /**
     * THE ASKING BUILD IS A STORE BUILD (onboardStore.ts: it cannot draw the
     * stage, but draws everything the store variant is made of). It is routed
     * as onboardV2 is (the first screen, no intro film, no mark from device
     * signals) and keeps the sign-in it has always had.
     */
    onboardStore?: boolean;
    /** Connected apps are switched on (CONNECTORS). With onboardV2 it decides
     *  whether the flow has its two apps steps, and so how long its bar is. */
    connectorsOn?: boolean;
    /**
     * THE BOTS APP (experience/bots, docs/bots-app.md): BOTS_APP is on and the
     * build draws its kit. Its tabs (Bots, Activity, You) and its Home instead
     * of today's; a window keeps its desk pages (Today, Notes, its settings)
     * behind the sidebar. Absent, the bootstrap is exactly today's.
     */
    botsApp?: boolean;
  } = {},
): BootstrapResponse {
  const botsApp = opts.botsApp === true;
  const desk = opts.desk === true && opts.formFactor === "desktop";
  const onboardV2 = opts.onboardV2 === true;
  // The one flow either way: which build draws it is only the screen's business.
  const newFlow = onboardV2 || opts.onboardStore === true;
  const setup = setupActivity(opts);
  const nav = botsApp ? botsNav() : desk ? deskNav(opts.deskNotes === true, opts.deskTasks === true) : navigationFor(!!opts.landedBefore);
  return withAppKnobs({
    schemaVersion: SDUI_SCHEMA_VERSION,
    // Opaque cache token — clients invalidate any cached screens when this
    // changes. Bumps on every process restart plus any admin-triggered bump.
    cacheVersion: CACHE_VERSION,
    // Typefaces to register at boot. Empty by default; the app falls back to
    // the platform font and nothing waits on the network.
    ...(Object.keys(FONTS).length || botsApp ? { fonts: botsApp ? { ...FONTS, ...botsFonts() } : FONTS } : {}),
    theme: THEME,
    navigation: nav,
    // The server owns onboarding AND the intro. Intro plays whenever all 4
    // frames are uploaded to the media store; falls through to onboarding /
    // home when they're not, so we never render an intro screen with
    // missing images.
    // THE TAB AND THE SCREEN HAVE TO BE THE SAME PLACE.
    //
    // These were decided independently — the tab by `initialTabId`, the screen
    // by pickInitialScreenId — and for a returning user they disagreed: the
    // tab bar lit Stats while the screen showing was Train. The bar is not a
    // label on the screen, it is a claim about where you are, and a bar that
    // lies is worse than a bar that is wrong, because the first tap on the tab
    // you appear to be on does nothing.
    //
    // Only a TAB ROOT is redirected. intro and onboarding come before the tabs
    // exist and must survive this untouched — landing a first-run user on
    // Stats because a tab id says so would skip the two steps that obtain the
    // microphone and the keyboard.
    // The desk opens on Today. A window has no setup steps to walk (no
    // keyboard to add, the OS asks for the microphone), so there is nothing to
    // come before it.
    //
    // A window that is not onboarded yet starts the new flow first, with the
    // desk behind it; onboarded, it opens on Today as ever.
    // The Bots app's own first run (Languages, Name, Keylessbord, First words, Plans) for someone not onboarded yet.
    // The Bots app never opens on the old app's screens (the intro film, the microphone and keyboard steps, onboarding v2):
    // it has its own first run, and Keylessbord's own screen sets up the microphone and the keyboard. Once through, Home.
    initialScreenId: botsApp ? (!opts.onboarded && opts.isReviewer !== true ? BOTS_FIRST_RUN_SCREEN : landingScreenId(nav, "home"))
      : desk && !(onboardV2 && !opts.onboarded) ? "desk_today" : landingScreenId(nav, pickInitialScreenId(
      !!opts.onboarded,
      // Uploaded media OR the built-in mark. The intro used to require a file,
      // so out of the box it silently never played — which reads as a broken
      // feature rather than an unconfigured one. It now opens on the brand mark
      // assembling itself, and an upload replaces that.
      !!getMediaRegistryFn?.()?.["intro"]?.url || INTRO_BUILT_IN,
      // Which bootstrap this is, for the whole install. The one thing that can
      // tell "the app is opening" from "the app asked again".
      Number(opts.launchCount ?? 0),
      {
        micGranted: !!opts.micGranted,
        keyboardReady: !!opts.keyboardReady,
        formFactor: opts.formFactor,
      },
      newFlow,
      opts.isReviewer === true,
    )),
    flags: ((): BootstrapResponse["flags"] => {
      const flags: BootstrapResponse["flags"] = {
        // Policy URLs — Settings screen links open these in-browser.
        // Served from x0bot.com (proxied to the backend by Caddy — see
        // deploy/Caddyfile) so the URL a user copies from the address bar looks
        // like a real domain rather than an internal api. host. Same content
        // either way.
        "policy.privacy.url": POLICY.privacy,
        "policy.terms.url": POLICY.terms,
        "support.url": "mailto:support@x0bot.com",

        // The desktop's chrome — gate, rail, tray, notifications. Sent only to
        // a window that said it was one, because a phone has no tray to label
        // and would carry the whole block on every launch for nothing.
        ...(opts.formFactor === "desktop" ? {
          "desktop.shell": DESKTOP_UI,
          // The one-key router's lists, Ask's grammar, the tray's tones and the
          // rest the desktop kept built in (appLists.ts).
          ...desktopLists({ botsApp }),
          // Closing the window really closes it, so opening it again starts
          // on the landing page with fresh numbers — not on whatever page it
          // was hidden on an hour ago. The tray, the pill and the hotkey live
          // in other windows and keep running.
          "desktop.window.closeAction": "close",
          // THE CURRENT RELEASE. An installed build older than `latest` is told
          // once, and the click opens the download page. Raise it with each
          // release (desktop/package.json's version); `min` only when an old
          // build would break against this backend.
          //
          // Read from what was published for this OS (desktopRelease.ts), so a
          // build that lands tells every older install without anyone raising
          // a number. DESKTOP_LATEST is only the floor for an OS with nothing
          // published with a version yet. The click downloads the installer.
          "desktop.update": ((rel) => ({
            latest: rel.version || DESKTOP_LATEST,
            min: "",
            url: installerUrl(opts.os) ?? "https://x0bot.com/download",
            notes: "",
            // For a build that installs its own update: the tray's notice then
            // opens the window's card instead of the browser.
            ...(rel.version && rel.sha512 ? { sha512: rel.sha512 } : {}),
          }))(desktopOs(opts.os) ? publishedRelease(desktopOs(opts.os)!) : { version: "", sha512: "" }),
        } : {}),
        // The desk: its pages, where its settings live, and where out of words
        // leads — the plan page, not the phone's full-screen paywall.
        // Setup's Live Activity (iOS): the step they left off at, until done.
        ...(setup ? { "liveActivity.setup": setup } : {}),
        // The Bots app: its pages draw their own tab bar and sidebar; "bots.looks" names the bots' catalog (bots/looks.ts).
        // "bots.sounds" names the bots' sounds (bots/sounds.ts): pull-a-bot's and the moments'.
        ...(botsApp ? {
          "bots.app": true, ...BOTS_OFFLINE_FLAGS, ...looksFlags(), ...soundsFlags(),
          // Never the old app's screens: buying goes to the Bots app's Plans, and the settings button and the profile card to You.
          "paywall.screenId": "bots.plans", "nav.settingsScreenId": "bots.you", "profile.hostScreenId": "bots.you",
        } : {}),
        ...(desk ? {
          "desktop.desk": true,
          "desktop.desk.settingsScreenId": "desk_settings",
          "quota.screenId": "desk_plan",
          // The masthead's proportions: the mark's width and the name's size
          // in pixels, and the tabs in the middle of the window.
          "desktop.mast": { logo: 19, brand: 18, tabs: "center" },
        } : {}),
        // In the Bots app, a refusal for the usage limit (or the free words)
        // opens Usage: how much is used, when it resets, and a bigger plan.
        ...(botsApp ? { "quota.screenId": "bots.usage" } : {}),

        // HOW A WINDOW PAYS.
        //
        // RevenueCat has no desktop SDK, so `iap.subscribe` — which is what
        // every row on the paywall fires — has nothing to call there. Web
        // Billing is its own checkout, opened in the user's browser, and the
        // identity already lines up: the app user id is the Supabase user id
        // on both sides, so a purchase here writes the same entitlements row a
        // phone purchase does and the webhook needs no change at all.
        //
        // Only to a desktop, because a phone has a store and must use it —
        // sending an external purchase link to an iOS build is the
        // anti-steering rule Apple rejects for, and the surest way to get one.
        ...(opts.formFactor === "desktop" && getConfig().REVENUECAT_WEB_PAYWALL_URL
          ? { "paywall.web.url": opts.payUrl ?? getConfig().REVENUECAT_WEB_PAYWALL_URL }
          : {}),

        // Post-splash intro — max duration + background. `intro.media` is
        // spliced in below from whatever's under the "intro" key in the media
        // registry, so uploading is the entire "swap the intro animation"
        // operation. Absent → client skips the intro entirely.
        "intro.maxDurationMs": 4500,
        "intro.background": THEME.color.bg,
        "intro.showEveryLaunch": false,

        // The Training tab's second door. The screen behind it is a real
        // spoken conversation now, built from modules that already shipped —
        // so this is the whole switch, and turning it off again is one edit.
        "train.realtime": true,

        // Paywall gating. When `paywall.entitlement` is set, the client checks
        // RevenueCat for that entitlement on boot; when the user does NOT
        // have it and `paywall.blockUntilEntitled` is true, the client
        // navigates to the "paywall" screen after onboarding. `paywall.config`
        // is the whole PaywallConfig so clients can pre-warm plan copy without
        // a separate fetch.
        "paywall.entitlement": PAYWALL_CONFIG.entitlement ?? "pro",
        // The app prefers these over its own baked copies. Absent or empty,
        // it falls back to the manifest exactly as before, so a server without
        // them set changes nothing.
        ...(getConfig().REVENUECAT_IOS_KEY
          ? { "billing.revenueCatKey.ios": getConfig().REVENUECAT_IOS_KEY! } : {}),
        ...(getConfig().REVENUECAT_ANDROID_KEY
          ? { "billing.revenueCatKey.android": getConfig().REVENUECAT_ANDROID_KEY! } : {}),
        // What the SERVER believes, alongside what the client asks RevenueCat.
        // The app hides the paywall on either, so a webhook that has not
        // landed yet never leaves a paying user staring at one.
        "billing.entitled": opts.entitled === true,
        // Whether this is a first run is the server's answer: it knows
        // whether onboarding is done. The app's own flag for it was never
        // set, so every launch waited out the first-run splash.
        "boot.firstRun": opts.onboarded !== true,
        ...(opts.billingStore ? { "billing.store": opts.billingStore } : {}),
        ...(opts.entitled === true ? manageFlags(opts.billingStore) : {}),
        // A Razorpay subscription is cancelled in the app; once it has been,
        // the row offering that turns into the date it ends.
        ...(opts.entitled === true && opts.billingRenews === false ? { "billing.ending": true } : {}),
        "quota.wordsUsed": Math.max(0, Math.round(opts.wordsUsed ?? 0)),
        // The CEILING, earned words included. `quota.wordsFree` keeps its name
        // because every existing client reads it; what changed is that it is no
        // longer a constant. A user who has come back four days running sees
        // 2,900 here, and 2,900 is what the server will enforce.
        "quota.wordsFree": opts.allowance?.total ?? freeMonthlyWords(),
        // The plan's own words, so the app can show the earned part separately.
        "quota.wordsBase": freeMonthlyWords(),
        "quota.wordsEarned": opts.allowance?.earned ?? 0,
        "quota.wordsRemaining": opts.allowance?.remaining
          ?? Math.max(0, freeMonthlyWords() - (opts.wordsUsed ?? 0)),
        // The streak. NOT what tomorrow is worth — that number no longer
        // exists to send, because naming it turns anticipation into
        // arithmetic and a known reward into a price.
        /**
         * IS THIS ACCOUNT PAID — the server's own answer.
         *
         * The phones never needed one: they ask RevenueCat directly and
         * `paywall.entitlement` tells them which entitlement to look for. The
         * desktop has no RevenueCat SDK, so it had no way to know at all —
         * which meant it could not hide a paywall from somebody who had
         * already paid, or confirm a purchase that had just gone through.
         *
         * This is also the more honest source for anyone: it comes from the
         * entitlements table the webhook writes, which is the same thing every
         * quota check on the server reads. The client remains not-evidence —
         * this flag only decides what is SHOWN.
         */
        // Free for everyone counts as "no limit" here: every client already
        // draws that state — the meter as the month's count, no paywall, no
        // words-left. `billing.entitled` stays the truth about paying.
        "quota.entitled": opts.entitled === true || freeForAll(),
        "billing.free": freeForAll(),
        "quota.streakDays": opts.allowance?.streakDays ?? 0,
        "quota.earnMaxed": opts.allowance?.maxed === true,
        // The one flag every gate reads: out of words and not paying.
        "quota.exceeded":
          !freeForAll() && opts.entitled !== true
          && (opts.wordsUsed ?? 0) >= (opts.allowance?.total ?? freeMonthlyWords()),
        // DISABLED for now: the paywall was auto-showing on every open (user
        // lacks `pro`) and its purchase fails with "could not complete purchase"
        // because the App Store IAP products aren't purchasable yet (not
        // "Ready to Submit" / Paid Apps Agreement / sandbox tester). That blocked
        // the mic-flow testing. Re-enable (PAYWALL_BLOCK = true) once the IAP
        // products are live in App Store Connect + RevenueCat so a purchase
        // actually completes. The paywall screen itself still exists and can be
        // opened manually.
        //
        // AND NEVER BLOCK A SURFACE THAT CANNOT PAY. The desktop has no store:
        // its only way through is the Web Billing link, and without one
        // configured a hard block is a locked door with no handle — the app
        // demands a subscription and offers no way to buy one. The day this
        // flips to true, that is the shape of the bug it would otherwise ship.
        "paywall.blockUntilEntitled": PAYWALL_BLOCK && !freeForAll() &&
          !(opts.formFactor === "desktop" && !getConfig().REVENUECAT_WEB_PAYWALL_URL),
        // The free tier, in WORDS REFINED per month. The app reads this to show
        // progress and to know when to put the paywall in front of someone —
        // without it the client has to guess the number, and a guess that
        // disagrees with the server means a user hitting a wall the UI never
        // warned them about. 0 = unlimited.
        "quota.freeMonthlyWords": freeForAll() ? 0 : freeMonthlyWords(),
        "paywall.showAfterOnboarding": false,
        "paywall.config": PAYWALL_CONFIG as unknown as Record<string, unknown>,

        // Show the native language picker (client-side gliding-greeting screen)
        // right after auth for users who haven't picked a language yet. The
        // flow is: auth → language → "onboarding" (voice permission) →
        // "onboarding_keyboard" (enable keyboard → Settings) → home.
        // postLanguageScreenId is intentionally unset: after the pick the
        // client falls through to initialScreenId, which is "onboarding" for
        // new users and "home" for returning ones.
        // OFF. The pick asked for something the phone already knows, and it
        // was the origin of a stale-language bug: what it stored was the only
        // thing the keyboard ever read, so a later change in Settings did not
        // reach dictation. The app now takes the device's language when
        // nothing is stored, Settings still changes it, and the Languages card
        // asks the better question — which languages, plural.
        //
        // Back to true and the native grid returns, no build.
        "needsLanguagePick": false,

        // A screen to present on top of the first one, this launch only.
        // Absent on most launches. The app pushes it dismissibly — the same
        // shape the soft paywall already uses — so it is a card over the app,
        // not a gate in front of it. Any screen id works here; today the only
        // thing worth asking twice is which languages you speak.
        // (Not in the Bots app: its first run asks the languages, and the prompt was the old app's Languages screen.)
        ...(arrivalPrompt(opts) && !botsApp
          ? {
              promptScreenId: arrivalPrompt(opts)!,
              // Not at the door. A card that lands the instant the app opens
              // interrupts whatever the user came to do, which is the same
              // mistake as asking during onboarding — just later. Waiting a
              // few seconds means it arrives in a pause rather than in the
              // way, and the client drops it entirely if the user starts
              // doing something in the meantime.
              promptAfterMs: PROMPT_AFTER_MS,
            }
          : {}),

        // Phones only: the desktop has no push.
        ...(opts.formFactor !== "desktop" ? { "push.ask": PUSH_ASK } : {}),

        // IN-APP mic capture mode — the app's counterpart to the keyboard's
        // kb.mic.mode, so both surfaces are switchable from here with no app
        // update:
        //   "oneshot" — tap, speak, tap stop; the whole clip is transcribed at
        //               once. Slower to first word, but it's the path that
        //               runs multi-engine fusion, so it's the most ACCURATE.
        //   "live"    — words appear while speaking (WebSocket). Feels faster;
        //               single engine, no fusion.
        // Which engine backs "live" is a separate SERVER-side choice
        // (STT_LIVE_PROVIDER) and needs no client flag at all.
        "voice.mode": "oneshot",

        // The "Hello, name + gender" profile card shows as an overlay on these
        // screen ids. It's placed on the "personality" (You) tab — so right
        // after the activation screen lands the user on You, the card is the
        // first thing they complete there. (Client default is ["home"]; this
        // moves it to You.)
        // "home" as well as "personality": someone whose phone already had the
        // microphone and the keyboard skips both setup steps and opens on
        // home, and the name/gender card is the one thing still owed. Listed
        // here rather than by routing them somewhere else, because home IS
        // where that person belongs — the card is what is missing, not the
        // screen under it.
        "profileGate.screenIds": ["personality", "home"],

        // Meta on iPhone (the app's src/telemetry/meta.ts): on. Apple's tracking prompt comes first, and only those who allow
        // it are tracked; the rest are counted in aggregate. A build from 80 on asks once this bootstrap is in hand (build 79
        // asked only before any bootstrap, so never). The App Privacy answers declare tracking for Device ID and Product
        // Interaction to match. The app's own fallback stays off, so a phone that never reached the server never asks.
        "ads.meta.ios.enabled": true,

        // Flow Session warm-keeping (iOS). When true, the app re-arms the
        // background mic on every foreground so the keyboard dictates WITHOUT
        // reopening the app (the Wispr Flow feel). DISABLED for now: on a build
        // without the "don't publish a live session when the engine failed to
        // start" fix, a failed arm-on-foreground leaves a false-active session
        // that makes every mic tap animate into a dead mic. Re-enable once a
        // build with that arm() hardening ships. Costs background mic time
        // (indicator + battery) either way.
        // Whether the name + gender card has been filled in, ANSWERED BY THE
        // SERVER. It used to be a flag in the phone's own storage, which meant
        // a reinstall or a second device asked the same user again. Their
        // answers live on the profile now, so this follows the account.
        "profile.complete": opts.profileComplete === true,
        // Art behind the name-and-gender card. The app has read this flag
        // since the card was built, and nothing ever served it — the slot was
        // wired at one end only. A plain url, because the card is native and
        // resolves nothing; absent until something is uploaded to
        // `profile.card`, so the card stays as it is today.
        ...(getMediaRegistryFn?.()?.["profile.card"]?.url
          ? { "profileCard.media": getMediaRegistryFn!()["profile.card"]!.url }
          : {}),
        // SMS sign-in. The auth gate runs BEFORE there is a session, so it
        // reads this from the (auth-optional) bootstrap. Off until an SMS
        // provider is actually live in Supabase — turning it on without one
        // gives every user who picks the phone pill a dead end.
        "auth.enablePhone": AUTH_ENABLE_PHONE,
        // The one address that signs in with a password instead of a code.

        // Empty for everyone outside a submission window, and the app draws

        // nothing at all when it is empty.

        "auth.reviewEmail": opts.reviewEmail ?? "",
        // Google on Android, by way of Supabase's own OAuth page — see
        // AUTH_GOOGLE_WEB in config.ts. Absent when off, and absence is the
        // signal: the app falls back to the native client.
        ...(opts.googleWeb ? { "auth.googleWeb": opts.googleWeb } : {}),
        "kb.flow.armOnForeground": true,
        "kb.flow.idleTimeoutMs": FLOW_IDLE_TIMEOUT_MS,
        // How each utterance travels to the server. The APP reads this when it
        // arms the session, so it must be in the boot flags as well as the
        // keyboard config — and both must say the same thing.
        "kb.flow.transport": FLOW_TRANSPORT,
      };

      const reg = getMediaRegistryFn?.() ?? {};
      const intro = reg["intro"];
      if (intro?.url && flags) {
        flags["intro.media"] = { url: intro.url };
      }

      // The sign-in screen's backdrop.
      //
      // It rides in the BOOT FLAGS rather than in a screen, because the auth
      // gate runs before there is a session and so can never fetch a screen —
      // bootstrap is the only channel that reaches it. Uploading to `hero.auth`
      // is therefore the entire operation: no deploy, and certainly no build.
      //
      // contentType travels with it because the client has to choose between a
      // Video node and an Image node before it can render anything, and it has
      // no other way to know which this is.
      // The whole sign-in screen. Rides here for the same reason the backdrop
      // does: bootstrap is the only channel that reaches the app before there
      // is a session. The app draws it only when auth.sdui is on, and keeps
      // its own screen as the fallback either way.
      if (flags) {
        flags["auth.sdui"] = AUTH_SDUI;
        flags["auth.scrim"] = AUTH_UI.scrim;
        const authOpts = {
          googleHidden: opts.googleHidden === true,
          googleLink: opts.googleHidden === true ? (opts.googleLink ?? null) : null,
          appleHidden: opts.formFactor === "desktop" && opts.os !== "mac",
        };
        // The new onboarding's Welcome, Sign in and Code, for a build that
        // draws them; every other build keeps the screen it has always had.
        // (AUTH_SDUI off still sends everyone to the native sign-in.)
        // THE BOTS APP's Welcome, Sign in and Code (screens/firstRun.ts): the same
        // sign-in components, drawn as its boards.
        flags["auth.screen"] = botsApp
          ? botsAuthTree({ ...authOpts, desktop: opts.formFactor === "desktop", terms: POLICY.terms, privacy: POLICY.privacy })
          : onboardV2
          ? onboardAuthTree({
              ...authOpts,
              desktop: opts.formFactor === "desktop",
              connectorsOn: onboardAppsOn(opts.connectorsOn === true),
            })
          : authScreenTree(opts.formFactor === "desktop", authOpts);
        flags["auth.suction"] = AUTH_UI.entry.suction;
        // A keyboard mic tap mid-flow is held exactly as it is on the old
        // steps. (Also the default in appKnobsData.ts; set here so a knob
        // sync that forgets it cannot let a tap past the new flow.)
        if (newFlow) flags["boot.firstRunGateIds"] = ["onboarding", "onboarding_keyboard", "onboard"];
        // The Bots app's first run (About you, Name) holds a keyboard tap the same way.
        if (botsApp) flags["boot.firstRunGateIds"] = [...(newFlow ? ["onboarding", "onboarding_keyboard", "onboard"] : ["onboarding", "onboarding_keyboard"]), ...BOTS_FIRST_RUN_IDS];
        // The Bots app asks the name and gender card's question in its first run (About you, the same write), so
        // the card itself is never laid over a screen for someone still in it: not while the run is on, and not
        // after it in the same launch, while this bootstrap still says the answer is owed. Someone onboarded
        // before the run asked it keeps the card where it has always been.
        if (botsApp && !opts.onboarded) flags["profileGate.screenIds"] = [];
        // And someone onboarded before the run asked it is asked by the run's own screen, not the native card:
        // bots.name-it, which for an onboarded account is About you alone and closes once saved. Over Home after
        // a pause, like any arrival prompt, and only while the answer is owed.
        if (botsApp && opts.onboarded) {
          flags["profileGate.screenIds"] = [];
          if (opts.profileComplete !== true && opts.isReviewer !== true && !flags.promptScreenId) {
            flags.promptScreenId = BOTS_FIRST_RUN_SCREEN;
            flags.promptAfterMs = PROMPT_AFTER_MS;
          }
        }
      }

      /**
       * A PHONE IS PORTRAIT AND A WINDOW IS NOT, so one upload cannot be right
       * for both when the art is a composition.
       *
       * Sign-in art with a mark, a headline and rules at its corners is placed,
       * not tiled. Cropped to a portrait phone it loses its own edges; letter-
       * boxed into one it becomes a strip. So a desktop client may be given its
       * own upload — `hero.auth.desktop` — and falls back to the shared one
       * when nobody has made a landscape version, which is what every install
       * has today.
       *
       * And FIT follows the same split. A phone crops to fill, because a
       * backdrop behind one column should reach the edges. A window contains,
       * because cropping a 16:9 composition into a window that is never 16:9
       * cuts exactly the corners the composition put something in. `present`
       * still wins outright where it is set, so a deliberate choice at upload
       * time is never overruled by this.
       */
      const isDesk = opts.formFactor === "desktop";
      const authArt = (key: string) =>
        (isDesk ? reg[`${key}.desktop`] : undefined) ?? reg[key];
      const authSpec = (m: NonNullable<ReturnType<typeof authArt>>) => ({
        url: m.url,
        ...(m.contentType ? { contentType: m.contentType } : {}),
        // The screen paints this behind the media so the gap before a video's
        // first frame is the art's own ground rather than a black flash. It is
        // also what fills the letterbox when the fit is "contain", so art that
        // does not match the window should set it to the art's own ground.
        background: m.present?.background ?? "#000000",
        fit: m.present?.fit ?? (isDesk ? "contain" : "cover"),
      });

      // The code step gets its own backdrop when one is uploaded, and falls
      // back to the entry's when it is not — so a single upload still dresses
      // the whole flow, and a second one is an option rather than a duty.
      const authCodeBg = authArt("hero.auth.code");
      if (authCodeBg?.url && flags) {
        flags["auth.background.code"] = authSpec(authCodeBg);
      }

      const authBg = authArt("hero.auth");
      if (authBg?.url && flags) {
        flags["auth.background"] = authSpec(authBg);
      }

      // One platform's differences, applied last so they always win.

      return applyPlatformFlags(flags, opts.platform ?? "ios");
    })(),
    // Central copy — every screen can reference these with "@key". On the
    // phone every word starts with a capital (titleCase.ts), like the screens.
    labels: (opts.formFactor === "desktop" ? (l: Record<string, string>) => l : titleCaseLabels)({
      "app.name": "X0 Bot",
      // The desktop masthead's chip for "no limit": free, not paid, right now.
      ...(freeForAll() ? { "desktop.mast.unlimited": "Free" } : {}),
      "settings.privacyPolicy": "Privacy Policy",
      "settings.termsOfService": "Terms of Service",
      "settings.support": "Contact Support",
      "onboarding.title": "Welcome To X0 Bot",
      "onboarding.subtitle": "Speak Or Type Rough — X0 Bot Makes It Sound Like You.",
      "onboarding.cta": "Get Started",

      // Stats screen (see statsScreen). Kept as label refs so localisation
      // controls copy without redeploying the backend.
      "stats.title": "Your usage",
      "stats.hero.subtitle": "This month, in your voice",
      "stats.kv.weekWords": "Words this week",
      "stats.kv.audio": "Audio dictated",
      "stats.kv.saved": "Minutes saved",
      "stats.effort.template":
        "Your effort: you'd have spent {minutes} minutes typing what X0 Bot cleaned up in seconds.",
      "stats.sparkline.label": "Requests, last 30 days",
      "stats.cta.history": "See history",

      // History screen (see historyScreen).
      "history.title": "History",
      "history.subtitle":
        "Every cleanup you've kept, newest first. Tap to copy, × to remove.",
      // History is kept by default (history/store.ts HISTORY_DEFAULT_ON) and
      // the phone has no switch for it, so an empty list means nothing has
      // been written yet — not a setting to go and find.
      "history.empty": sw("e.hist"),
      "history.delete.error": "Couldn't reach history. Try again.",

      // FOR APP BUILDS THAT STILL FRAME A RAW ERROR. Those builds fill
      // "Mic error: {message}" / "Voice error: {message}" with the error's own
      // text ("Mic error: Error Domain=NSOSStatusErrorDomain …"). Sent as whole
      // sentences with no {message} slot, the raw text has nowhere to go and
      // those builds show these words instead. Current builds no longer read
      // these keys (they say ui.VoiceToggle.errorMic / errorTranscribe).
      "ui.VoiceToggle.errorMicTemplate": "Couldn't start the microphone. Try again.",
      "ui.VoiceToggle.errorVoiceTemplate": "Couldn't turn that into text. Try again.",
    }),
    languages: [
      { code: "en", name: "English", greeting: "Hello", regions: ["US","GB","CA","AU","IN"] },
      { code: "hi", name: "हिन्दी", greeting: "नमस्ते", regions: ["IN"] },
      { code: "es", name: "Español", greeting: "Hola", regions: ["ES","MX","AR"] },
      { code: "fr", name: "Français", greeting: "Bonjour", regions: ["FR","CA"] },
      { code: "ar", name: "العربية", greeting: "مرحبا", regions: ["AE","SA","EG"] },
      { code: "pt", name: "Português", greeting: "Olá", regions: ["PT","BR"] },
      { code: "de", name: "Deutsch", greeting: "Hallo", regions: ["DE"] },
      { code: "it", name: "Italiano", greeting: "Ciao", regions: ["IT"] },
      { code: "ru", name: "Русский", greeting: "Привет", regions: ["RU"] },
      { code: "ja", name: "日本語", greeting: "こんにちは", regions: ["JP"] },
      { code: "ko", name: "한국어", greeting: "안녕하세요", regions: ["KR"] },
      { code: "zh", name: "中文", greeting: "你好", regions: ["CN"] },
      { code: "bn", name: "বাংলা", greeting: "নমস্কার", regions: ["BD","IN"] },
      { code: "ta", name: "தமிழ்", greeting: "வணக்கம்", regions: ["IN","LK"] },
      { code: "te", name: "తెలుగు", greeting: "నమస్కారం", regions: ["IN"] },
      { code: "mr", name: "मराठी", greeting: "नमस्कार", regions: ["IN"] },
      { code: "gu", name: "ગુજરાતી", greeting: "નમસ્તે", regions: ["IN"] },
      { code: "pa", name: "ਪੰਜਾਬੀ", greeting: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", regions: ["IN"] },
      { code: "ur", name: "اردو", greeting: "السلام علیکم", regions: ["PK","IN"] },
      { code: "tr", name: "Türkçe", greeting: "Merhaba", regions: ["TR"] },
      { code: "id", name: "Indonesia", greeting: "Halo", regions: ["ID"] },
      { code: "vi", name: "Tiếng Việt", greeting: "Xin chào", regions: ["VN"] },
      { code: "th", name: "ไทย", greeting: "สวัสดี", regions: ["TH"] },
      { code: "nl", name: "Nederlands", greeting: "Hallo", regions: ["NL"] },
    ],
    // Version gate (dormant: thresholds are at/below the shipped app version, so
    // it won't fire — flip these to force/suggest an update from the server).
    update: {
      minVersion: "0.5.0",
      latestVersion: "1.0.0",
      title: "Update X0 Bot",
      message: "A newer version of X0 Bot is available with the latest improvements.",
      cta: "Update now",
      url: {
        android: "https://play.google.com/store/apps/details?id=com.tulmi.app",
        // The numeric id is assigned by App Store Connect and is not known
        // until the app exists there, so it comes from the environment. Until
        // APP_STORE_ID is set the key is OMITTED rather than shipped with a
        // placeholder: a gate that says "update now" and opens a dead App
        // Store page is worse than one that says it without a button, and the
        // placeholder id000000000 would have done exactly that on the day this
        // gate first fired.
        ...(APP_STORE_ID ? { ios: `https://apps.apple.com/app/id${APP_STORE_ID}` } : {}),
        default: "https://x0bot.com",
      },
    },
    // The words card wins over a standing announcement. Someone about to be
    // stopped mid-sentence does not need to hear about a feature first, and
    // two cards on one open is one too many.
    ...(() => {
      const card = wordsMilestoneCard({ ...opts, ...(botsApp ? { plansScreenId: "bots.plans" } : {}) }) ?? LAUNCH_CARD;
      return card ? { launchCard: card } : {};
    })(),
    cacheTtlSeconds: 300,
    warmScreenIds: botsApp ? BOTS_WARM_SCREEN_IDS : WARM_SCREEN_IDS,
  });
}
