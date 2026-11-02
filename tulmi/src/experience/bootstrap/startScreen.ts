/**
 * Which screen a client opens on, and which screens it keeps warm.
 */

import type { NavigationShell } from "../../../../shared/types/sdui.js";

/**
 * When the intro plays: "firstRun" (default), "everyLaunch", or "never".
 *
 * firstRun means "until they finish onboarding" — the cinematic belongs to
 * meeting the product, and a returning user opening the app to write something
 * does not want to sit through it.
 */
const INTRO_PLAY_WHEN =
  process.env.INTRO_PLAY_WHEN === "everyLaunch" ? "everyLaunch"
  : process.env.INTRO_PLAY_WHEN === "never" ? "never"
  : "firstRun";

/**
 * The screens an install should hold before it needs them.
 *
 * The client used to warm the four tab destinations and nothing else, so every
 * screen one tap deeper — settings, stats detail, the personality editor —
 * waited on the network the first time it was opened, on every install and
 * again after every cacheVersion bump. That first wait is the one users read as
 * "the app is slow", because it happens exactly when they are exploring.
 *
 * Listed here rather than derived from the switch in buildScreen, because most
 * of what that switch can build should NOT be warmed:
 *
 *   - intro, onboarding, onboarding_keyboard — seen once, and by the time this
 *     list is read the user is past them.
 *   - keyboard_record, flow_arm, keyboard_primer — transient mic screens whose
 *     content only means anything in the moment they are opened.
 *   - anything taking params (personality_detail) — there is no id to warm.
 *
 * paywall IS warmed: it has the heaviest media of any screen, and the moment it
 * appears is the moment a slow load costs money.
 */
export const WARM_SCREEN_IDS = [
  // One tap from the You tab's training card and it holds the whole refine
  // loop — exactly the "the app is slow" wait this list exists to remove.
  "training_chat",
  "history",
  "stats",
  "personality",
  "settings",
  "languages",
  "voices",
  "dictionary",
  "haptics",
  "paywall",
];

// --- Screens ----------------------------------------------------------------

/**
 * Which screen the app opens on. Runs at bootstrap time so its output is
 * baked into the response the client uses.
 *
 * Onboarding is now a SINGLE activation screen (see onboardingWelcome) — the
 * old intro montage + welcome + language + keyboard-enable sequence collapsed
 * into one. So the routing is simply:
 *   - Not-onboarded → onboarding (the activation screen).
 *   - Otherwise → home.
 * (The separate client-side language greeting still runs before this when the
 * needsLanguagePick flag is set — that's independent of this decision.)
 */
/**
 * Where the app opens.
 *
 * The intro was unreachable until now: this returned only home/onboarding, and
 * no client code routed to "intro" either — so the screen existed, the media
 * key existed, and nothing could ever play it. Uploading a file would not have
 * helped, which is the confusing part of that kind of bug.
 *
 * It plays only when a file is actually there. An intro slot with nothing in it
 * must not cost the user a black screen on the way in.
 *
 * "FIRST RUN" IS A COUNT, NOT A STATE
 *
 * This asked `!onboarded`, and that is a state which stays true for a while —
 * through the auth screen, the language pick, the keyboard step. The client
 * calls this endpoint far more often than once per launch (after sign-in, on
 * every foreground, on every refresh) and it treats the answer as "where the
 * app opens" every time. So a not-yet-onboarded user got the opening film again
 * after signing in, again when the keyboard's mic tap woke the app, and again
 * whenever a foreground reset the stack off a transient mic screen — each time
 * over whatever they had actually asked for, dismissed by a tap, and looking
 * like the film was leaking into the app at random.
 *
 * It was one bug wearing three costumes, and the mistake is in the sentence:
 * an opening plays ONCE, and "once" is counted, not inferred.
 *
 * launchCount is the count. The client bumps a persisted counter on every
 * bootstrap, so the very first call an install ever makes is 1 and there is no
 * second 1 — not after auth, not on foreground, not on any refresh. Everything
 * after that gets home or onboarding, which is what those callers wanted all
 * along.
 *
 * 0 means the client did not say (unreadable storage, an older bundle). That
 * resolves to no intro: a missing opening costs a first impression, a repeating
 * one costs trust in the whole app.
 */
/**
 * The screen that belongs to the tab we are landing on.
 *
 * The tab and the screen used to be decided independently, and for a
 * returning user they disagreed: the bar lit Stats while Train was on screen.
 * A tab bar is not a label on the screen, it is a claim about where you are —
 * and a bar that lies is worse than one that is wrong, because the first tap
 * on the tab you appear to be on does nothing at all.
 *
 * ONLY A TAB ROOT IS REDIRECTED. intro and onboarding come before the tabs
 * exist, and sending a first-run user to Stats because a tab id says so would
 * skip the two steps that obtain the microphone and the keyboard. Anything
 * that is not already a tab's own screen is returned untouched.
 */
export function landingScreenId(nav: NavigationShell, picked: string): string {
  if (nav.kind !== "tabs") return picked;
  // "home" was the Train tab's screen, and every "go to the app" still says
  // it: the first launch, the return from the intro. With Train folded into
  // You it is no tab's screen, and without this it would open on its own,
  // outside the tabs. It means the landing tab.
  const isTabRoot = picked === "home" || nav.tabs.some((t) => (t.screenId ?? t.id) === picked);
  if (!isTabRoot) return picked;
  const landing = nav.tabs.find((t) => t.id === nav.initialTabId);
  return landing ? (landing.screenId ?? landing.id) : picked;
}

export function pickInitialScreenId(
  onboarded: boolean,
  introReady: boolean,
  launchCount: number,
  device: { micGranted?: boolean; keyboardReady?: boolean; formFactor?: string } = {},
  onboardV2 = false,
  reviewer = false,
): string {
  const firstEver = launchCount === 1;
  // NEITHER STEP HAS ANYTHING TO ASK A WINDOW.
  //
  // Both exist to obtain something from a phone: a permission the OS grants to
  // an app, and a keyboard added in Settings. A desktop has no keyboard
  // extension to add, and its microphone is granted by the operating system
  // outside the app — Windows in Privacy settings, macOS in its own prompt at
  // first use. No screen we draw can move either one.
  //
  // The desktop already refused to show them, by discarding this answer and
  // landing on the first tab. That worked and was the wrong shape: the client
  // was correcting the server rather than telling it something it did not
  // know. It reports its form factor now, and the answer comes back right.
  const askDevice = device.formFactor !== "desktop";
  // The new onboarding opens on Welcome, which is the opening: for someone not
  // onboarded yet the intro film would be a second one.
  const play = introReady && !(onboardV2 && !onboarded) && (
    INTRO_PLAY_WHEN === "everyLaunch" ||
    (INTRO_PLAY_WHEN === "firstRun" && firstEver && !onboarded)
  );
  if (play) return "intro";
  // ONE FLOW IN PLACE OF THE TWO STEPS. The new onboarding asks for the
  // microphone and the keyboard itself, and only for what is still missing
  // (onboardStart picks where it begins), so there is nothing left to route by
  // device: a person who is not onboarded gets it, a window included (it never
  // had onboarding before), and the first launch of an install gets it on a
  // device that has not granted both even if the account is done.
  if (onboardV2) {
    // A reviewer goes straight in, even on the first launch of a fresh install.
    if (reviewer) return "home";
    const missing = askDevice && !(device.micGranted && device.keyboardReady);
    return !onboarded || (launchCount === 1 && missing) ? "onboard" : "home";
  }
  // THE FLAG IS ABOUT THE ACCOUNT. THE MICROPHONE AND THE KEYBOARD ARE ABOUT
  // THE PHONE.
  //
  // `onboarded` outranked the device entirely, and the two are not about the
  // same thing. Sign in on a NEW phone and the flag says the asking is done,
  // so the app opened straight into the tabs on a device that had granted
  // nothing: a microphone that refuses and a keyboard that was never added,
  // with no step anywhere to explain either.
  //
  // The first launch of an install is the one moment the device's answer is
  // worth more than the profile's. It is per-install, so a new phone gets the
  // steps and the phone that already did them is not asked twice.
  //
  // It also cannot become a loop, which is the reason the flag outranked the
  // device in the first place. Declining routes onward and still finishes, and
  // this only ever fires on launch number one — so someone who said no is not
  // returned to the same screen the next time they open the app.
  //
  // launchCount is 0 from a client too old to send it, and 0 is not 1, so
  // those clients keep exactly the behaviour they have now.
  if (launchCount === 1 && askDevice) {
    if (!device.micGranted) return "onboarding";
    if (!device.keyboardReady) return "onboarding_keyboard";
  }
  if (onboarded) return "home";
  // ONBOARDING ONLY ASKS FOR WHAT IT DOES NOT HAVE.
  //
  // Its two steps exist to obtain the microphone and the keyboard, and both
  // are properties of the phone. A second account on the same phone — the
  // same person signing in with a different email — has already granted them,
  // and every step below is skipped in order until one has something to ask.
  //
  // Nothing left to ask means onboarding is done, whatever the profile says:
  // the caller marks it so, and this returns the app.
  if (askDevice) {
    if (!device.micGranted) return "onboarding";
    if (!device.keyboardReady) return "onboarding_keyboard";
  }
  return "home";
}
