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

// ================================================================== build 8.9.1 (docs: perms2)
//
// The same four places as above: this file (the card), `app/app.config.ts`'s usage strings (the system prompt's own line),
// `docs/store-privacy.md` (App Privacy and Data safety) and the privacy policy. `tests/perm-words.test.ts` pairs them.
//
// Two of these have NO card, because they ask nothing: *Add to my calendar* (the phone's own editor runs outside the app) and
// the Focus row (iOS's own Focus Filter, and Android's Do Not Disturb, need no permission at all). A card in front of a thing
// that asks nothing is a step that buys the person nothing.

/** *Add to my calendar*: the phone's own event editor, already filled in. No permission, nothing read, nothing sent. */
export const CAL_ADD = {
  button: "Add to my calendar",
  /** iPhone: the editor said it saved. */
  saved: "Added to your calendar.",
  /** No calendar app on the phone at all. */
  unavailable: "There's no calendar app on this phone.",
  error: "Couldn't open your calendar.",
  /** The line that rides in the event's notes, so the person can see where it came from. */
  madeWith: "Made with X0 Bot",
  shareRow: "Adding a plan to your calendar",
  shareSub: "Your phone's own editor, opened already filled in. X0 Bot is told only that you saved it, and never reads your calendar.",
} as const;

/** *Plan around my calendar*: busy times only, for the next two weeks. */
export const CAL_BUSY = {
  row: "Plan around my calendar",
  rowSub: "Busy times only, for two weeks. Switching it off deletes them.",
  /** Android instead: the server's own connector, and no permission on the phone. */
  androidRow: "Connect Google Calendar",
  androidSub: "X0 Bot reads your Google Calendar through your account, not from this phone.",
  title: "Plan around your calendar",
  lines: [
    "X0 Bot reads when you're busy in your iPhone's calendars for the next two weeks: just when each event starts and ends. Not its name, place, notes or who's invited.",
    // What is really built (docs: perms2 §2.3): the overlap line on the day, the times Move offers, and whether a call
    // rings. Plan Make picks its own slots and does not read them yet, so the line does not claim it does.
    "Plan Ease marks anything on your plan that overlaps one, keeps the times it offers you clear of them, and lets a call wait instead of ringing inside one. Turning this off deletes them. They're never sent to AI services or used for ads.",
    "Next, your iPhone asks you.",
  ],
  /**
   * THE SAME CARD ON ANDROID (8.9.1, behind PERM_CALENDAR_READ_ANDROID). Two lines differ and no more: Android has no "full
   * access" grant to explain, and it reads the PHONE'S calendars, not "your iPhone's". The last line must not say iPhone.
   */
  linesAndroid: [
    "X0 Bot reads when you're busy in your phone's calendars for the next two weeks: just when each event starts and ends. Not its name, place, notes or who's invited.",
    "Plan Ease marks anything on your plan that overlaps one, keeps the times it offers you clear of them, and lets a call wait instead of ringing inside one. Turning this off deletes them. They're never sent to AI services or used for ads.",
    "Next, your phone asks you.",
  ],
  cta: "Continue",
  /** The row, once it is on: "Busy times from your calendar · as of 9:40". */
  on: "Busy times from your calendar",
  denied: "X0 Bot can't see your calendar. Plan Ease will plan without it.",
  blocked: "Calendar is off for X0 Bot",
  openSettings: "Open Settings",
  off: "Deleted. Plan Ease will plan without them.",
  shareRow: "When you're busy",
  shareSub: "Start and end times only, for two weeks, from your phone's calendars. Never an event's name, place or people. Deleted when you switch it off.",
} as const;

/** *Sync with Reminders*: the one list X0 Bot makes, called X0 Bot. */
export const REMINDERS = {
  row: "Sync with Reminders",
  rowSub: "One list, called X0 Bot. Your other lists are never opened.",
  androidRow: "Connect Google Tasks",
  androidSub: "X0 Bot keeps your Google Tasks in step through your account, not from this phone.",
  title: "Sync with Reminders",
  lines: [
    "X0 Bot makes one list in Reminders called X0 Bot and keeps it in step with your Plan Ease to-dos. A to-do you add in either place shows up in both, with its due date and whether it's done.",
    "It never opens your other lists.",
    "Turning this off stops the syncing; nothing is deleted from either side.",
    "Next, your iPhone asks you.",
  ],
  /**
   * The AI clause, which App Review 5.1.2(i) asks for: say plainly when personal data reaches a third-party AI. It names the
   * permission the person has already given or not (privacy/aiConsent.ts), so the card tells the truth either way.
   */
  aiYes: "Items in the X0 Bot list become Plan Ease to-dos, kept and used like the ones you type: you've let X0 Bot use AI, so Plan Ease's AI reads them to plan your day, as it reads your other to-dos.",
  aiNo: "Items in the X0 Bot list become Plan Ease to-dos, kept and used like the ones you type. X0 Bot doesn't send your to-dos to AI unless you allow it.",
  cta: "Continue",
  on: "Synced with Reminders",
  denied: "X0 Bot can't see your Reminders. Your to-dos stay in the app.",
  blocked: "Reminders is off for X0 Bot",
  openSettings: "Open Settings",
  off: "The X0 Bot list stays in Reminders. You can delete it there.",
  shareRow: "Your X0 Bot Reminders list",
  shareSub: "Only that one list: each item's title, due date and whether it's done. Your other lists are never opened.",
} as const;

/** The Focus row. No card: iOS's Focus Filter and Android's Do Not Disturb ask nothing. */
export const FOCUS = {
  row: "Hold calls during a Focus",
  rowSub: "A leave-by or a bill due today comes as a notice instead. The rest waits until the Focus ends.",
  androidRow: "Hold calls during Do Not Disturb",
  /** The three steps, in order: the iPhone has no way to open a Focus from an app, so the row explains instead. */
  steps: [
    "Open Settings › Focus and pick a Focus.",
    "Tap Focus Filters › Add Filter.",
    "Pick X0 Bot, and choose what waits.",
  ],
  /** Which Focus is on is never known: iOS says only that one with X0 Bot's filter is. */
  live: "A Focus with X0 Bot's filter is on",
  idle: "No Focus with X0 Bot's filter is on",
  /** What waits: the one choice the filter carries. */
  holdCalls: "Hold Plan Ease calls",
  holdAll: "Hold calls and other pings",
  shareRow: "Whether a Focus is on",
  shareSub: "On or off, and whether calls alone or calls and pings wait. Never which Focus. Kept 12 hours at most.",
} as const;

/** *Count my steps with Motion & Fitness*, instead of Apple Health. */
export const MOTION = {
  row: "Count my steps with Motion & Fitness instead",
  rowSub: "Steps your iPhone counts, and walks, runs and rides of 10 minutes or more.",
  /** `{bot}` is the bot's own name. */
  title: "Count your steps with Motion & Fitness",
  lines: [
    "Your iPhone counts your steps, and notices walks, runs and rides. {bot} reads your daily steps and any walk, run or ride of 10 minutes or more. Nothing else: no places, no times finer than a day.",
    "X0 Bot keeps daily totals for 31 days, for this bot only. Switching it off deletes them (our backups clear within 30 days).",
    "They're never sent to AI services or used for ads.",
    "Next, your iPhone asks you.",
  ],
  /**
   * THE ONE LINE THAT DIFFERS ON ANDROID (8.9.1, behind PERM_MOTION_ANDROID). iPhone: steps, and walks, runs and rides of
   * 10 minutes or more. Android: steps, and nothing else — said plainly, because there is no reliable workout source there
   * and a fitness bot's streak must not be built on a workout nobody measured.
   */
  linesAndroid: [
    "Your phone counts your steps. {bot} reads your daily steps from the phone's own step counter. Nothing else: no workouts, no places, no times finer than a day.",
  ],
  /** The card's last line on Android. The iPhone's says "Next, your iPhone asks you", which must never show on Android. */
  lastAndroid: "Next, your phone asks you.",
  /** "Motion & Fitness" is iOS's own name for the grant; Android's is Physical activity, so the title names neither. */
  titleAndroid: "Count your steps",
  rowAndroid: "Count my steps with the phone's step counter",
  rowSubAndroid: "Steps your phone counts. No workouts.",
  /** The row once it is on, for an Android bot counting from the step counter. */
  rowOnAndroid: "Counting my steps with the phone's step counter",
  rowOnSubAndroid: "Steps your phone counts. No workouts. Switching it off deletes them.",
  /** A day the phone was never opened on has no count, and X0 Bot does not invent one (the step counter has no history). */
  gapAndroid: "A day you didn't open X0 Bot has no step count.",
  /** Nothing counted yet on Android: the place to look is the phone's own permission page, not Health Connect. */
  emptyAndroid: "No steps counted yet. If you turned it off: Settings › Apps › X0 Bot › Permissions › Physical activity.",
  unavailableAndroid: "This phone can't count steps.",
  blockedAndroid: "Physical activity is off for X0 Bot",
  shareRowAndroid: "Your steps, from your phone's step counter",
  shareSubAndroid: "Daily totals only, for a fitness bot you switched it on for. No workouts. 31 days.",
  cta: "Continue",
  /** CMPedometer counts the phone's own steps, never a Watch's: the row says so rather than letting a Watch day look missing. */
  phoneOnly: "Steps your iPhone counts",
  /**
   * The row ONCE IT IS ON, for a bot whose days come from Motion & Fitness (`skills.healthSource`, 0094). Without these the
   * same bot's row said "Count my workouts from Apple Health", which is not where its numbers come from.
   */
  rowOn: "Counting my steps with Motion & Fitness",
  rowOnSub: "Steps your iPhone counts, and walks, runs and rides. Switching it off deletes them.",
  denied: "X0 Bot can't read your steps. You can still tell {bot} when you've been.",
  blocked: "Motion & Fitness is off for X0 Bot",
  openSettings: "Open Settings",
  shareRow: "Your steps, from Motion & Fitness",
  shareSub: "Daily totals and walks, runs and rides of 10 minutes or more, for a fitness bot you switched it on for. 31 days.",
} as const;

/** *Wait while I'm driving*: the same Motion grant, answering one word just before a call. */
export const DRIVE = {
  row: "Wait while I'm driving",
  rowSub: "Plan Ease's calls wait while you're in a car. A leave-by call is skipped.",
  title: "Wait while you're driving",
  lines: [
    "Just before Plan Ease calls you, your iPhone checks whether it's in a car. If it is, the call waits, and a leave-by call is skipped because you're already on your way.",
    "X0 Bot is told only “driving” or “not driving”, never where.",
    "Next, your iPhone asks you.",
  ],
  /**
   * THE SAME CARD ON ANDROID (8.9.1, behind PERM_MOTION_DRIVE_ANDROID). Android has no motion history to query, only the
   * car-entered and car-left moments the phone happened to be awake for, so the honest line says the check can come back
   * "don't know" — and the server's rule for that is to ring as it does today.
   */
  linesAndroid: [
    "Just before Plan Ease calls you, your phone checks whether you're in a car. If you are, the call waits, and a leave-by call is skipped because you're already on your way.",
    "X0 Bot is told only “driving” or “not driving”, never where. On Android the answer is sometimes neither, and then the call comes as it does now.",
    "Next, your phone asks you.",
  ],
  rowSubAndroid: "Plan Ease's calls wait while you're in a car, when your phone can tell. A leave-by call is skipped.",
  blockedAndroid: "Physical activity is off for X0 Bot",
  cta: "Continue",
  denied: "X0 Bot can't tell when you're driving. Calls will come as they do now.",
  blocked: "Motion & Fitness is off for X0 Bot",
  openSettings: "Open Settings",
  shareRow: "Whether you're driving",
  shareSub: "One word, “driving” or “not driving”, just before a Plan Ease call. Never where you are, and not kept past that call.",
  shareSubAndroid: "One word, “driving” or “not driving” — sometimes neither — just before a Plan Ease call. Never where you are, and not kept past that call.",
} as const;

/** *Also count my sleep*, on a fitness bot whose health is already on. */
export const SLEEP = {
  row: "Also count my sleep",
  rowSub: "How long you slept each night. No bed or wake times, no stages.",
  /** `{bot}` is the bot's name; `{source}` is Apple Health or Health Connect. */
  title: "Let {bot} count your sleep",
  lines: [
    "It reads how long you slept each night from {source}. Not when you went to bed or woke, and not your sleep stages.",
    "X0 Bot keeps nightly totals for 31 days, for this bot only. Switching it off deletes them (our backups clear within 30 days).",
    "They're never sent to AI services or used for ads.",
    "Next, your phone asks you.",
  ],
  cta: "Continue",
  denied: "Nothing from {source} yet. If you turned sleep off, switch this off and on to ask again.",
  off: "Off. The nights it counted are deleted.",
  shareRow: "How long you slept",
  shareSub: "Nightly minutes only, for a fitness bot you switched it on for. No bed or wake times, no stages. 31 days.",
} as const;

/** *Remind me when I get there*: the phone's own system watches the place. */
export const ARRIVAL = {
  row: "Remind me when I get there",
  rowSub: "Your iPhone watches for the place itself. X0 Bot is never told you arrived.",
  title: "Remind you when you get there",
  lines: [
    "Your iPhone watches for this place itself and shows the reminder when you arrive. X0 Bot is never told where you are or that you arrived.",
    "This needs Location While Using with Precise Location on.",
    "Next, your iPhone asks you.",
  ],
  cta: "Continue",
  /** `{place}` is the place's own name, as the server geocoded it. */
  armed: "Reminds you at {place}, until it's done.",
  approximate: "Arrival reminders need Precise Location. Turn it on for X0 Bot in Settings.",
  denied: "X0 Bot can't set that up without location. The reminder you already have still comes.",
  blocked: "Location is off for X0 Bot",
  openSettings: "Open Settings",
  shareRow: "Reminding you when you arrive",
  shareSub: "The place goes to your iPhone, which watches for it itself. Nothing comes back: X0 Bot is never told where you are or that you arrived.",
} as const;

/**
 * ANDROID'S FIRST ARRIVAL CARD (8.9.1, behind PERM_ARRIVAL_ANDROID), which the iPhone's cannot be reused for. On iPhone the
 * SYSTEM watches the region and the app is never woken, so "never in the background" is true there. On Android a geofence is
 * delivered TO THE APP, which is background location use under Play's Location Permissions policy — so the second line is
 * Play's PROMINENT DISCLOSURE, not wording we are free to soften, and it has to stand BEFORE the system flow. The words
 * "even when the app is closed or not in use" are the ones Play's policy names, and the background-location declaration,
 * the demo video and the Data safety rows all have to describe this same thing.
 */
export const ARRIVAL_ANDROID = {
  row: "Remind me when I get there",
  rowSub: "Your phone watches for the place itself. Nothing about it is sent to X0 Bot's servers.",
  title: "Remind you when you get there",
  lines: [
    "Your phone watches for this place and shows the reminder when you arrive. Nothing about where you are, or that you arrived, is sent to X0 Bot's servers.",
    "X0 Bot uses your location in the background, even when the app is closed or not in use, only to show the arrival reminders you turn on. Your location is never sent to X0 Bot or anyone else.",
    "This needs precise location — Approximate is not enough to tell when you have arrived.",
    "Next, your phone asks you.",
  ],
  cta: "Continue",
  denied: "X0 Bot can't set that up without location. The reminder you already have still comes.",
  blocked: "Location is off for X0 Bot",
  shareRow: "Reminding you when you arrive",
  shareSub: "The place goes to your phone, which watches for it itself, and wakes X0 Bot to show the reminder — so Android needs location set to Allow all the time. Nothing comes back: X0 Bot's servers are never told where you are or that you arrived.",
} as const;

/**
 * ANDROID'S SECOND STEP, the Android 11+ hand-off. The system shows NO prompt for "Allow all the time", so the only way on
 * is the phone's own location page — and Play requires the app to explain why FIRST. So: our card, then openSettings. Never
 * Settings with no explanation, and never a second system prompt, which the system would refuse and which would read as a
 * dead button. The iPhone's `approximate` line sits in the same slot and says the same kind of thing.
 */
export const ARRIVAL_BACKGROUND_ANDROID = {
  title: "Let your phone watch for this place",
  lines: [
    "Your phone watches for this place itself and shows the reminder when you arrive. Nothing about where you are, or that you arrived, is sent to X0 Bot's servers.",
    "For that to work when X0 Bot is closed or not in use, Android needs location set to Allow all the time. Only you can set that, on your phone's own location page, so the next tap takes you there.",
    "X0 Bot uses your location in the background for nothing else: no tracking, no route, no history, and nothing about where you are ever leaves your phone.",
  ],
  cta: "Open Settings",
  /** Shown once they are back, if it is still not set: no nagging, no second card. */
  still: "Arrival reminders need Allow all the time. You can turn it on in Settings whenever you like.",
} as const;

/**
 * The motion card's words for one bot on one platform. The iPhone's lines are the shape; Android swaps the FIRST line (steps
 * only, no workouts) and the LAST one (which must not say iPhone), and keeps the two in between.
 */
export function motionLines(bot: string, platform: "ios" | "android" = "ios"): { title: string; lines: string[] } {
  const ios = MOTION.lines.map((l) => l.replace("{bot}", bot));
  if (platform !== "android") return { title: MOTION.title, lines: ios };
  return {
    title: MOTION.titleAndroid,
    lines: [MOTION.linesAndroid[0]!.replace("{bot}", bot), ...ios.slice(1, -1), MOTION.lastAndroid],
  };
}

/** The sleep card's words for one bot on one platform. */
export function sleepLines(bot: string, platform: "ios" | "android"): { title: string; lines: string[] } {
  const source = HEALTH_SOURCE[platform];
  return {
    title: SLEEP.title.replace("{bot}", bot),
    lines: SLEEP.lines.map((l) => l.replace("{source}", source)),
  };
}

/** The Reminders card's lines, with the AI clause the person's own AI permission makes true. */
export function remindersLines(aiOn: boolean): string[] {
  return [REMINDERS.lines[0]!, REMINDERS.lines[1]!, aiOn ? REMINDERS.aiYes : REMINDERS.aiNo, REMINDERS.lines[2]!, REMINDERS.lines[3]!];
}
