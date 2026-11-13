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
 *                    built-in never draws it, and nor does a bot called anything else.
 *
 * It does NOT switch health on: only the phone's own flow can, which is the point of the row. The reviewer taps it.
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

console.log("");
console.log("Next, by hand, for the review:");
console.log(`  App Store Connect › App Review Information: the account's sign-in, and the three routes in the review notes.`);
console.log(`  Play Console › App access: the same, plus Bots › ${BOT} › Edit › Count my workouts from Health Connect.`);
console.log(`  Put ${userId} in PERM_HEALTH_ANDROID_USERS, so the row is there while Google's own list propagates.`);
