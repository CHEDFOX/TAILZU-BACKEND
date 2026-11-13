/**
 * THE WORDS OF THE THREE CARDS, IN ONE PLACE (docs: perms, the design's §5 and §7).
 *
 * One card stands before every system prompt: Continue and nothing else (App Review 5.1.1(iv), task #113). The way out is not
 * tapping. These are the words on those cards, and the words the Privacy screen and the policy page repeat.
 *
 * They are here, and not in the screens, because the same purpose has to be said in four places and never drift:
 *   - this file (the card the person reads just before the system asks),
 *   - `app/app.config.ts`'s LOCATION_USAGE / HEALTH_USAGE (the system prompt's own line),
 *   - `docs/store-privacy.md` (App Privacy and Data safety),
 *   - `routes/site/policies/privacy.ts` (the policy the stores link to).
 * `tests/perm-words.test.ts` pairs them, as native/check-contract.ts pairs the contract.
 *
 * The contact picker has NO card: it runs outside the app, asks nothing, and returns only the one email the person tapped. A
 * card in front of a picker is a step that buys the person nothing.
 *
 * Pure: plain strings. Nothing here reads the environment, a store or a model.
 */

/** What the system prompt itself says on each platform, so a card can name the right one. Mirrors app.config.ts. */
export const HEALTH_SOURCE = { ios: "Apple Health", android: "Health Connect" } as const;
/** Whose map service names the area: the phone's own, not ours. */
export const MAP_SERVICE = { ios: "Apple", android: "Google" } as const;

// ------------------------------------------------------------------ location

export const LOCATE = {
  /** The quiet second button on the day-starts card. */
  button: "Use my location",
  title: "Find your area",
  /** The three lines, in order. `{map}` is the phone's own map service: Apple's on iPhone, Google's on Android. */
  lines: [
    "X0 Bot looks up where you are once. Your phone's map service ({map}) turns that into an area name.",
    "X0 Bot keeps only that name, like HSR Layout, not your exact spot, and uses it with map services to work out travel times. It never looks again on its own.",
    "Next, your phone asks you.",
  ],
  cta: "Continue",
  /** After the fix: the person checks the words before anything is stored. */
  confirm: "Is this right?",
  save: "Save",
  type: "Type it instead",
  /** The phone could not name the place, or the fix timed out. */
  none: "Couldn't find your area. Type it instead.",
  denied: "X0 Bot can't see where you are. Type your area instead.",
  blocked: "Location is off for X0 Bot.",
  openSettings: "Open Settings",
  /** You › Privacy › What this phone shares, and the Forget there. */
  shareRow: "Where your day starts",
  shareSub: "Only the area's name, from one tap on Use my location. Never your exact spot.",
  forget: "Forget",
} as const;

/** The card's lines with the platform's own map service in them. */
export const locateLines = (platform: "ios" | "android"): string[] =>
  LOCATE.lines.map((l) => l.replace("{map}", MAP_SERVICE[platform]));

// ------------------------------------------------------------------ contacts (no permission, so no card)

export const CONTACTS = {
  button: "Add from contacts",
  /** The picker would not open (no Contacts app, or the system refused the intent). */
  error: "Couldn't open your contacts. Type their email.",
  /** The preview the sender reads before sending (App Review 5.1.2(v)). */
  seeWhole: "See the whole email",
  shareRow: "Adding someone from your contacts",
  shareSub: "Your phone's own picker. Only the one email you tap, and only when you send the invite. The book is never read.",
} as const;

// ------------------------------------------------------------------ health

export const HEALTH = {
  /** The row on the bot's edit page. `{source}` is Apple Health or Health Connect. */
  row: "Count my workouts from {source}",
  /**
   * The same row with no source in it, for the off-only row: a bot that is counting keeps a way to stop on every client and
   * whatever the switches say, and there the phone that turned it on may not be the one reading (policy §1.5.1).
   */
  rowOff: "Counting steps and workouts",
  rowSub: "Steps and workouts only. Switching it off deletes what it counted.",
  /** `{bot}` is the bot's own name. */
  title: "Let {bot} count your workouts",
  lines: [
    "It reads two things from {source}: your daily steps, and your workouts (what kind, and how long). Nothing else: no heart rate, sleep, weight or routes.",
    "X0 Bot keeps daily totals for 31 days, for this bot only. Switching it off deletes them (our backups clear within 30 days).",
    "They're never sent to AI services or used for ads.",
    "Next, your phone asks you.",
  ],
  cta: "Continue",
  /** The sheet was answered but nothing came back. HealthKit never says a read was refused, so a silent zero would be a lie. */
  emptyIos: "Nothing from Apple Health yet. If you turned it off: Health › Sharing › Apps › X0 Bot.",
  /** The same on Android, where the place to look is Health Connect's own app permissions. */
  emptyAndroid: "Nothing from Health Connect yet. If you turned it off: Health Connect › App permissions › X0 Bot.",
  /**
   * The quiet re-read came back denied: a new phone, a reinstall, or a permission taken back. The row still says on, so the
   * bot's page has to say the counting has stopped and how to start it again.
   */
  notHere: "Not shared from this phone. Switch it off and on in Edit to reconnect.",
  deniedAndroid: "Health Connect didn't share your workouts. You can still tell {bot} when you've been.",
  blockedAndroid: "Health Connect is off for X0 Bot",
  openHealthConnect: "Open Health Connect",
  unavailable: "Health Connect isn't on this phone",
  getHealthConnect: "Get Health Connect",
  /** The Play listing for Health Connect, where a phone without it gets it. */
  healthConnectUrl: "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata",
  shareRow: "Your steps and workouts",
  shareSub: "Only for a fitness bot you switched it on for. Daily totals, 31 days, deleted when you switch it off. Never sent to AI services.",
} as const;

/** The health card's title and lines, for one bot on one platform. */
export function healthLines(bot: string, platform: "ios" | "android"): { title: string; lines: string[] } {
  const source = HEALTH_SOURCE[platform];
  return {
    title: HEALTH.title.replace("{bot}", bot),
    lines: HEALTH.lines.map((l) => l.replace("{source}", source)),
  };
}
