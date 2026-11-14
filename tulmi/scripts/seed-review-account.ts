/**
 * THE REVIEW ACCOUNT'S SPACE AND ITS FITNESS BOT (docs: perms §0 and §7).
 *
 *   cd tulmi && npx tsx scripts/seed-review-account.ts <account id> [--name "Review Family"] [--bot "Gym Buddy"]
 *
 * Apple's and Google's reviewers sign in with one account and have to REACH each screen the build's declarations are for. Two
 * of the three need something to exist first:
 *
 *   "Review Family"  a space the account RUNS, so Spaces › Review Family › Invite exists, which is where *Add from contacts*
 *                    and the invite preview are. Without a space the reviewer lands on Spaces' start screen instead, which
 *                    has the same button but not the page the review notes name.
 *   "Gym Buddy"      a bot the account made whose name is a fitness word, so the edit page draws *Count my workouts*. A
 *                    built-in never draws it, and nor does a bot called anything else. Build 8.9.1's *Count my steps with
 *                    Motion & Fitness* and *Also count my sleep* are on that same row.
 *   a plan item with a place (8.9.1)   so *Plan Ease › "Pick up dry cleaning" › Remind me when I get there* exists, which is
 *                    where the arrival reminder is. Without a place the switch is not drawn at all, because the server has
 *                    nothing to point the phone at. It REPEATS DAILY and sits in the evening, because the armed set holds
 *                    only events that are still to come (`armedArrivals`): a one-off at 6 pm was gone from the review route
 *                    by 6 pm on the day it was seeded, and on every day after. Its place is a name the server can always
 *                    resolve from `places/cities.ts` ("Bengaluru"), so the switch is there with no geocoder configured.
 *
 * It does NOT switch health, sleep or the arrival reminder on: only the phone's own flow can, which is the point of each row.
 * The reviewer taps them.
 *
 * Idempotent: a space with that name, or a bot with that slug, is left exactly as it is. Needs SUPABASE_URL and
 * SUPABASE_SERVICE_KEY in the environment (the same ones the server runs with). Prints what it made and what was there.
 */
export {};


const userId = process.argv[2] ?? "";
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const SPACE = arg("name", "Review Family");
const BOT = arg("bot", "Gym Buddy");
const PURPOSE = "Counts my gym days and keeps my streak";

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
  console.error("seed-review-account: the first argument is the review account's id (a uuid).");
  console.error('  npx tsx scripts/seed-review-account.ts 11111111-1111-4111-8111-111111111111 --name "Review Family"');
  process.exit(2);
}

const { supabase } = await import("../src/auth/supabase.js");
const admin = supabase();
if (!admin) {
  console.error("seed-review-account: no service key. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.");
  process.exit(2);
}

const { Bots } = await import("../src/bots/index.js");
const { Spaces } = await import("../src/botsBots/spaces.js");
const { isFitnessBot } = await import("../src/bots/door.js");

if (!isFitnessBot(BOT, PURPOSE)) {
  console.error(`seed-review-account: "${BOT}" has no fitness word in it, so the health row would not be drawn for it.`);
  process.exit(2);
}

const bots = new Bots();
const spaces = new Spaces(bots);

// ------------------------------------------------------------------ the bot
const mine = await bots.list(userId);
const had = mine.find((b) => !b.builtin && b.name.toLowerCase() === BOT.toLowerCase());
if (had) {
  console.log(`bot:   "${had.name}" (${had.slug}) was already there; left as it is${had.skills.health ? ", health on" : ""}`);
} else {
  const { bot } = await bots.create(userId, { name: BOT, purpose: PURPOSE, colour: "moss" });
  console.log(`bot:   made "${bot.name}" (${bot.slug}); its health row is off, as it must be — only the phone turns it on`);
}

// ------------------------------------------------------------------ the space
const list = await spaces.list(userId);
const space = list.find((s) => s.name.toLowerCase() === SPACE.toLowerCase());
if (space) {
  console.log(`space: "${space.name}" (${space.id}) was already there; left as it is`);
} else {
  const made = await spaces.create(userId, SPACE, "Reviewer");
  console.log(`space: made "${SPACE}" (${made.id}); Spaces › ${SPACE} › Invite is where Add from contacts is`);
}

// ------------------------------------------------------------------ the plan item with a place (build 8.9.1)
//
// *Remind me when I get there* is drawn only for an item whose place the server has geocoded, so the review account needs one
// item with a real place on it. Idempotent: an item with this title on the day is left exactly as it is.
const { calendar } = await import("../src/calendar/index.js");
const { cityNamed } = await import("../src/places/cities.js");
const ITEM = arg("item", "Pick up dry cleaning");
// A city this server knows by name, with no geocoder configured (PLACES_GEOCODER is off by default): `peekPlace` answers
// from `cities.ts`, so the arrival switch is drawn on any server the reviewer's account signs in to. "Koramangala,
// Bengaluru" is not one of those names and resolved to nothing.
const PLACE = arg("place", "Bengaluru");
if (!cityNamed(PLACE)) {
  console.error(`seed-review-account: this server cannot point at "${PLACE}" by name, so Remind me when I get there would`);
  console.error("  not be drawn. Use a city from src/places/cities.ts, or prime the geocoder first.");
  process.exit(2);
}
const cal = calendar();
const today = new Date().toISOString().slice(0, 10);
// A fortnight's window, because the item repeats daily and the review notes name it by day.
const listed = await cal.list(userId, { from: today, to: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10), tz: "330" }).catch(() => null);
const had2 = listed?.events.find((e) => e.title.toLowerCase() === ITEM.toLowerCase());
if (had2) {
  console.log(`item:  "${had2.title}" was already there; left as it is${had2.arrive ? ", arrival reminder on" : ""}`);
} else {
  // Daily, and late enough that today's is still to come through a working day in any of the reviewers' own time zones.
  const made = await cal.addEvent(userId, { title: ITEM, day: today, time: "21:30", place: PLACE, tz: 330, repeat: "daily" });
  console.log(`item:  made "${made.title}", every day at 9:30 pm at ${PLACE}; its Remind me when I get there is off, as it must be`);
}

console.log("");
console.log("Next, by hand, for the review:");
console.log(`  App Store Connect › App Review Information: the account's sign-in, and the routes in the review notes.`);
console.log(`  Play Console › App access: the same, plus Bots › ${BOT} › Edit › Count my workouts from Health Connect.`);
console.log(`  Put ${userId} in PERM_HEALTH_ANDROID_USERS, so the row is there while Google's own list propagates.`);
console.log(`  Build 8.9.1: put ${userId} in PERM_HEALTH_SLEEP_ANDROID_USERS too, for the same reason, once Play has approved sleep.`);
console.log(`  Build 8.9.1 routes: Plan Ease › From this phone › Plan around my calendar, and Sync with Reminders under it;`);
console.log(`  You › What pings you › Hold calls during a Focus and Wait while I'm driving; Bots › ${BOT} › Edit ›`);
console.log(`  Count my steps with Motion & Fitness and Also count my sleep; Plan Ease › "${ITEM}"`);
console.log(`  (every day, 9:30 pm) › Add to my calendar and Remind me when I get there.`);
