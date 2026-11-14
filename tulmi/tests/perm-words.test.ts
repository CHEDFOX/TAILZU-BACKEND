// THE SAME PURPOSE, SAID THE SAME WAY IN FOUR PLACES (docs: perms §8 "Words pairing"; perms2 §12 "Words pairing").
//
// A person reads the purpose of a permission four times, written by three packages in two repos: the card just before the
// system prompt (screens/permitWords.ts), the system prompt's own line (app/app.config.ts), the privacy policy the stores
// link to (routes/site/policies/privacy.ts) and the store answers the owner pastes (docs/store-privacy.md). If any one of
// them drifts, the store reads the app as doing something it did not declare, which is the one thing section 1 exists to
// prevent. This is the cross-repo check that catches the drift, the way native/check-contract.ts catches a contract's.
//
// The phone's repo may not be beside this one (CI builds them apart): those checks are skipped, not failed.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";

const {
  ARRIVAL, CAL_ADD, CAL_BUSY, CONTACTS, DRIVE, FOCUS, HEALTH, LOCATE, MOTION, REMINDERS, SLEEP,
  healthLines, locateLines, motionLines, remindersLines, sleepLines,
} = await import("../src/experience/bots/screens/permitWords.js");
const { PRIVACY_POLICY_HTML, PRIVACY_POLICY_EFFECTIVE } = await import("../src/routes/site/policies/privacy.js");

const HERE = import.meta.dirname;
const STORE_PRIVACY = fs.readFileSync(path.resolve(HERE, "../../docs/store-privacy.md"), "utf8");
const CONFIG_PATH = path.resolve(HERE, "../../../TAILZU-FRONTEND/app/app.config.ts");
const config = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : null;
/** One usage string of app.config.ts, as its constant is written there (several lines, joined with +). */
const usageOf = (name: string): string => new RegExp(`const ${name} =\\s*([\\s\\S]*?);\\n`).exec(config ?? "")?.[1] ?? "";

describe("the card's words", () => {
  it("say the phone's own map service, and that only the name is kept", () => {
    const ios = locateLines("ios").join(" "), android = locateLines("android").join(" ");
    expect(ios).toContain("your phone's map service (Apple)".replace("your phone's", "Your phone's"));
    expect(android).toContain("Your phone's map service (Google)");
    for (const w of [ios, android]) {
      expect(w).toContain("keeps only that name");
      expect(w).toContain("not your exact spot");
      expect(w).toContain("never looks again on its own");
      expect(w).toContain("Next, your phone asks you.");
    }
  });

  it("name the source the person's own phone has, and the two things read", () => {
    expect(healthLines("Gym Buddy", "ios").title).toBe("Let Gym Buddy count your workouts");
    expect(healthLines("Gym Buddy", "ios").lines[0]).toContain("Apple Health");
    expect(healthLines("Gym Buddy", "android").lines[0]).toContain("Health Connect");
    const l = healthLines("Gym Buddy", "ios").lines.join(" ");
    expect(l).toContain("your daily steps");
    expect(l).toContain("31 days");
    expect(l).toContain("never sent to AI services");
  });

  it("the contact picker has no card, because there is no prompt to introduce", () => {
    expect(Object.keys(CONTACTS)).not.toContain("title");
    expect(Object.keys(CONTACTS)).not.toContain("cta");
    expect(CONTACTS.button).toBe("Add from contacts");
  });

  // ---------------------------------------------------------------- build 9.0 (docs: perms2)

  it("Add to my calendar has no card either: nothing is asked and nothing is read", () => {
    expect(Object.keys(CAL_ADD)).not.toContain("title");
    expect(Object.keys(CAL_ADD)).not.toContain("cta");
    expect(CAL_ADD.button).toBe("Add to my calendar");
    expect(CAL_ADD.shareSub).toContain("never reads your calendar");
  });

  it("the Focus row has no card: iOS's own filter and Android's Do Not Disturb ask nothing", () => {
    expect(Object.keys(FOCUS)).not.toContain("title");
    expect(Object.keys(FOCUS)).not.toContain("cta");
    // And it never claims to know WHICH Focus, because iOS never says.
    expect(FOCUS.live).toBe("A Focus with X0 Bot's filter is on");
    expect(FOCUS.shareSub).toContain("Never which Focus");
  });

  it("the busy card promises times only, two weeks, and deletion when it goes off", () => {
    const l = CAL_BUSY.lines.join(" ");
    expect(l).toContain("just when each event starts and ends");
    expect(l).toContain("Not its name, place, notes or who's invited");
    expect(l).toContain("Turning this off deletes them");
    expect(l).toContain("never sent to AI services or used for ads");
    expect(CAL_BUSY.lines.at(-1)).toBe("Next, your iPhone asks you.");
    expect(CAL_BUSY.cta).toBe("Continue");
  });

  it("the Reminders card says one list, and tells the truth about AI either way (5.1.2(i))", () => {
    const yes = remindersLines(true).join(" "), no = remindersLines(false).join(" ");
    for (const l of [yes, no]) {
      expect(l).toContain("one list in Reminders called X0 Bot");
      expect(l).toContain("It never opens your other lists.");
      expect(l).toContain("nothing is deleted from either side");
      expect(l).toContain("Next, your iPhone asks you.");
    }
    // With the AI permission given, the card says a model reads them; without it, that it does not until they allow it.
    expect(yes).toContain("Plan Ease's AI reads them to plan your day");
    expect(no).toContain("doesn't send your to-dos to AI unless you allow it");
    expect(no).not.toContain("Plan Ease's AI reads them");
  });

  it("the motion card names the ten minutes, the 31 days, and no places", () => {
    const l = motionLines("Gym Buddy").lines.join(" ");
    expect(motionLines("Gym Buddy").title).toBe("Count your steps with Motion & Fitness");
    expect(l).toContain("Gym Buddy reads your daily steps");
    expect(l).toContain("10 minutes or more");
    expect(l).toContain("no places, no times finer than a day");
    expect(l).toContain("31 days");
    expect(l).toContain("never sent to AI services or used for ads");
  });

  it("the driving card promises one word and never where", () => {
    const l = DRIVE.lines.join(" ");
    expect(l).toContain("whether it's in a car");
    expect(l).toContain("never where");
    expect(l).toContain("Next, your iPhone asks you.");
    expect(DRIVE.shareSub).toContain("not kept past that call");
  });

  it("the sleep card names the source, and refuses bed times and stages", () => {
    expect(sleepLines("Gym Buddy", "ios").title).toBe("Let Gym Buddy count your sleep");
    expect(sleepLines("Gym Buddy", "ios").lines[0]).toContain("Apple Health");
    expect(sleepLines("Gym Buddy", "android").lines[0]).toContain("Health Connect");
    const l = sleepLines("Gym Buddy", "ios").lines.join(" ");
    expect(l).toContain("how long you slept each night");
    expect(l).toContain("Not when you went to bed or woke, and not your sleep stages");
    expect(l).toContain("31 days");
    expect(l).toContain("never sent to AI services or used for ads");
  });

  it("the arrival card says the phone watches, and that the server is never told", () => {
    const l = ARRIVAL.lines.join(" ");
    expect(l).toContain("Your iPhone watches for this place itself");
    expect(l).toContain("never told where you are or that you arrived");
    expect(l).toContain("Precise Location");
    expect(ARRIVAL.shareSub).toContain("Nothing comes back");
  });
});

describe("the system prompt says what the card said", () => {
  it.skipIf(!config)("LOCATION_USAGE names the tap, arrival reminders, and that only the area's name is kept", () => {
    const usage = usageOf("LOCATION_USAGE");
    expect(usage, "app.config.ts has no LOCATION_USAGE").not.toBe("");
    expect(usage).toContain(LOCATE.button);
    // 9.0: the string gained arrival reminders, and says whose phone does the watching.
    expect(usage).toMatch(/arrival /);
    expect(usage).toMatch(/your iPhone itself can remind you/);
    expect(usage).toMatch(/keeps the area's name, not your/);
    expect(usage).toMatch(/never told where you go/);
  });

  it.skipIf(!config)("HEALTH_USAGE names steps, workouts, sleep, the fitness bot, and no ads", () => {
    const usage = usageOf("HEALTH_USAGE");
    expect(usage, "app.config.ts has no HEALTH_USAGE").not.toBe("");
    expect(usage).toMatch(/steps and workouts/);
    expect(usage).toMatch(/sleep if you turn it on/);
    expect(usage).toMatch(/fitness bot/);
    expect(usage).toMatch(/never uses it for ads/);
  });

  it.skipIf(!config)("CALENDAR_USAGE says busy times only, and never event names", () => {
    const usage = usageOf("CALENDAR_USAGE");
    expect(usage, "app.config.ts has no CALENDAR_USAGE").not.toBe("");
    expect(usage).toMatch(/when you're busy/);
    expect(usage).toMatch(/Plan around my calendar/);
    expect(usage).toMatch(/never event names/);
    expect(usage).toMatch(/never uses your calendar for ads/);
  });

  it.skipIf(!config)("REMINDERS_USAGE names the one list, the AI clause and no other list", () => {
    const usage = usageOf("REMINDERS_USAGE");
    expect(usage, "app.config.ts has no REMINDERS_USAGE").not.toBe("");
    expect(usage).toMatch(/one Reminders list, called X0 Bot/);
    expect(usage).toMatch(/Sync with Reminders/);
    expect(usage).toMatch(/including by AI if you/);
    expect(usage).toMatch(/doesn't open your other lists/);
  });

  it.skipIf(!config)("MOTION_USAGE names the fitness bot, the driving check and no ads", () => {
    const usage = usageOf("MOTION_USAGE");
    expect(usage, "app.config.ts has no MOTION_USAGE").not.toBe("");
    expect(usage).toMatch(/Motion & Fitness to count your steps/);
    expect(usage).toMatch(/fitness bot/);
    // If N0 cuts the driving check, this clause leaves the string AND the switch is not drawn: the pair moves together.
    expect(usage).toMatch(/whether you're driving just before Plan Ease calls/);
    expect(usage).toMatch(/never uses/);
  });

  it.skipIf(!config)("every usage string in the build has a screen here, and the ones with no screen are absent", () => {
    // The other half of rule 1 is in the native package's own checks; this is the half the server can see: a string for a
    // thing this server never draws would be a declaration with no feature behind it.
    // A real Info.plist key, not a comment saying the key is absent: "Name: value" at the start of a line's content.
    const key = (name: string) => new RegExp(`^[ \\t]*${name}:\\s*["'\`A-Z_]`, "m").test(config!);
    expect(key("NSContactsUsageDescription"), "the build asks for Contacts, which this build's picker does not need").toBe(false);
    expect(key("NSLocationAlwaysUsageDescription"), "the build asks for Always location, which no screen here uses").toBe(false);
    expect(key("NSLocationAlwaysAndWhenInUseUsageDescription"), "the build asks for Always location").toBe(false);
    // 9.0: Focus Status is NOT how the Focus row works (it is iOS's own Focus Filter, which asks nothing), so its key must
    // never appear; nor may a write-only calendar key, because nothing writes through a grant.
    expect(key("NSFocusStatusUsageDescription"), "the build asks for Focus Status, which nothing here reads").toBe(false);
    expect(key("NSCalendarsWriteOnlyAccessUsageDescription"), "the build asks to write calendars, which nothing here does").toBe(false);
    // And the four 9.0 keys that DO have a screen here are present (each is checked for its words above).
    expect(key("NSCalendarsFullAccessUsageDescription"), "the busy-times row has no calendar key").toBe(true);
    expect(key("NSRemindersFullAccessUsageDescription"), "the Reminders row has no reminders key").toBe(true);
    expect(key("NSMotionUsageDescription"), "the Motion row has no motion key").toBe(true);
    expect(key("NSHealthShareUsageDescription"), "the health row has no health key").toBe(true);
  });

  it.skipIf(!config)("NSHealthUpdateUsageDescription is there, and says only that nothing is written", () => {
    // Apple refuses the upload without it (ITMS-90683), because HealthKit also carries Health's save calls. So the key is
    // present on purpose, and the one thing that matters is that its words claim no writing (Appendix B item 1).
    const usage = usageOf("HEALTH_UPDATE_USAGE");
    expect(usage, "app.config.ts has no HEALTH_UPDATE_USAGE").not.toBe("");
    expect(usage).toMatch(/never writes to Apple Health/);
    expect(usage).toMatch(/only reads/);
  });

  it.skipIf(!config)("the reduced-accuracy key is gone, so arrival reminders can watch a place", () => {
    // With NSLocationDefaultAccuracyReduced true, every Core Location service runs reduced, fence monitoring included
    // (perms2 §7.1). The key leaving is what makes the prompt start on Precise; only an area's name is still ever kept.
    expect(/^[ \t]*NSLocationDefaultAccuracyReduced:/m.test(config!)).toBe(false);
  });
});

describe("the policy and the store answers say the same", () => {
  it("the policy has a section for each of the three, and the old blanket denial is gone", () => {
    expect(PRIVACY_POLICY_HTML).toContain('id="location"');
    expect(PRIVACY_POLICY_HTML).toContain('id="contacts"');
    // ONE health anchor, and it is on the section's own heading: #health is what the Android rationale activity opens
    // (HealthRationaleActivity.kt) and what Play's Health Connect form links to, so both land on the section itself.
    expect(PRIVACY_POLICY_HTML).toContain('<h3 id="health">1.5.1 Apple Health and Health Connect</h3>');
    expect(PRIVACY_POLICY_HTML).not.toContain('id="health-section"');
    expect(PRIVACY_POLICY_HTML).not.toContain("the app does not ask for your contacts, your device's calendars or reminders, your location");
  });

  it("the policy says what the card says: the map service, the picker, the 31 days, the backups", () => {
    expect(PRIVACY_POLICY_HTML).toContain("map service");
    expect(PRIVACY_POLICY_HTML).toContain("X0 Bot's servers never do");
    expect(PRIVACY_POLICY_HTML).toContain("the one email address you tapped");
    expect(PRIVACY_POLICY_HTML).toContain("31 days");
    expect(PRIVACY_POLICY_HTML).toContain("encrypted backups within 30 days");
  });

  it("the AI section says health, busy times, Focus and driving are never sent", () => {
    expect(PRIVACY_POLICY_HTML).toMatch(/Never sent:<\/strong> health data from Apple Health or Health Connect/);
    expect(PRIVACY_POLICY_HTML).toContain("Nor do the busy times read from your phone's calendars, whether a Focus is on, or whether you are driving");
  });

  // ---------------------------------------------------------------- build 8.9.1's own sections
  it("the policy has a section for each of 8.9.1's things, with the promise the card made", () => {
    for (const id of ["calendar", "reminders", "focus", "motion", "safety"]) {
      expect(PRIVACY_POLICY_HTML, id).toContain(`id="${id}"`);
    }
    expect(PRIVACY_POLICY_HTML).toContain("Never its name, place, notes, who is invited");
    expect(PRIVACY_POLICY_HTML).toContain("It never opens your other lists");
    expect(PRIVACY_POLICY_HTML).toContain("Never which Focus");
    expect(PRIVACY_POLICY_HTML).toContain('"driving" or "not driving"');
    expect(PRIVACY_POLICY_HTML).toContain("Not when you went to bed or woke, and not your sleep stages");
    expect(PRIVACY_POLICY_HTML).toContain("X0 Bot's servers are never told where you are, or that you arrived");
    // The blanket "no calendars or reminders" denial is gone, and the background-location line is the new one.
    expect(PRIVACY_POLICY_HTML).not.toContain("the app does not ask for your device's calendars or reminders");
    expect(PRIVACY_POLICY_HTML).toContain("X0 Bot never reads your location in the background");
  });

  it("the abuse-prevention section says keyed hash, 30 days, counted not joined, and no ads", () => {
    const s = PRIVACY_POLICY_HTML;
    expect(s.replace(/\s+/g, " ")).toContain("keyed hash of your IP address");
    expect(s.replace(/\s+/g, " ")).toContain("never the address itself");
    expect(s.replace(/\s+/g, " ")).toContain("We only count with it: we never use it to link your account to anyone else's.");
    expect(s.replace(/\s+/g, " ")).toContain("we ignore it after 12 months");
    expect(s.replace(/\s+/g, " ")).toContain("None of this is used for ads or tracking");
    expect(s.replace(/\s+/g, " ")).toContain("we never close an account on this alone");
    // And it never claims to be anonymous, which a keyed hash of an IPv4 address is not (perms2 §8.3).
    expect(s).not.toMatch(/anonymous hash|anonymised IP/i);
  });

  it("the retention list has a line for each new thing", () => {
    for (const line of ["fifteen days at most", "twelve hours at most", "Arrival reminders:", "Keeping X0 Bot safe:"]) {
      expect(PRIVACY_POLICY_HTML, line).toContain(line);
    }
  });

  it("Section 4 names the sign-in IPs our authentication provider keeps, which are not ours (perms2 §11.4)", () => {
    const s4 = PRIVACY_POLICY_HTML.slice(
      PRIVACY_POLICY_HTML.indexOf("4. Data retention"),
      PRIVACY_POLICY_HTML.indexOf("5. Your rights"),
    ).replace(/\s+/g, " ");
    expect(s4).toContain("Supabase, our authentication provider");
    expect(s4).toContain("records the IP address of each sign-in in its own logs");
    // And it does not blur that with 1.10, which keeps a keyed hash and never the address.
    expect(s4).toContain("we never store a raw IP address ourselves");
  });

  it("the Focus row's two choices each say what they really do", () => {
    const s = PRIVACY_POLICY_HTML.replace(/\s+/g, " ");
    // "calls": the reminder still arrives, as a notice. "calls and other pings": it waits too. Neither touches other bots.
    expect(s).toContain('With "calls", a leave-by or a bill due today still reaches you, as an ordinary notification instead of a call');
    expect(s).toContain('with "calls and other pings" those wait too, and one notice lists what waited when the Focus ends');
    expect(s).toContain("Other bots' notifications are not affected either way.");
  });

  it("the busy times' card and the policy claim only the three things that are built", () => {
    const s = PRIVACY_POLICY_HTML.replace(/\s+/g, " ");
    expect(s).toContain("a day's item that overlaps one says so, the times it offers you when you move something are kept clear of them, and a call that would ring inside one waits or arrives as a notice instead");
    // The card said "keep your plan and its calls clear of them", which promised Plan Make's own slots too.
    expect(CAL_BUSY.lines.join(" ")).toContain("keeps the times it offers you clear of them");
    expect(CAL_BUSY.lines.join(" ")).not.toContain("keep your plan and its calls clear of them");
  });

  it("the effective date moved with the change", () => {
    expect(PRIVACY_POLICY_EFFECTIVE).toBe("November 14, 2026");
    expect(PRIVACY_POLICY_HTML).toContain(`Effective: ${PRIVACY_POLICY_EFFECTIVE}`);
  });

  it("store-privacy.md declares all three and no longer calls them not collected", () => {
    expect(STORE_PRIVACY).toContain("Coarse Location");
    expect(STORE_PRIVACY).toContain("Approximate location");
    expect(STORE_PRIVACY).toContain("Fitness info");
    expect(STORE_PRIVACY).toMatch(/Health and Fitness \| Health \| App Functionality/);
    expect(STORE_PRIVACY).not.toContain("The phone's contacts are never read |");
    expect(STORE_PRIVACY).not.toContain("no location permission or API");
    expect(STORE_PRIVACY).not.toContain("No contacts, calendar or location permission is in the build");
  });

  it("store-privacy.md keeps the retention times the card promises", () => {
    expect(STORE_PRIVACY).toContain("31 days");
    expect(STORE_PRIVACY).toContain("within 30 days");
    expect(STORE_PRIVACY).toContain("ACCESS_COARSE_LOCATION");
    expect(STORE_PRIVACY).toContain("READ_EXERCISE");
    // And the permissions a library might merge in are still named as blocked.
    for (const p of ["ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION", "READ_CONTACTS", "ACTIVITY_RECOGNITION"]) {
      expect(STORE_PRIVACY, p).toContain(p);
    }
  });

  it("store-privacy.md says what 9.0 added, and no longer says calendars and reminders are never read", () => {
    expect(STORE_PRIVACY).not.toContain("the phone's calendars or reminders (the\napp keeps its own calendar on the server)");
    expect(STORE_PRIVACY).toContain("busy times");
    expect(STORE_PRIVACY).toContain("Device ID");
    // Device ID is declared from 9.0 (attestation and the install id), so it may not also be in the "not collected" line.
    expect(STORE_PRIVACY).not.toMatch(/Identifiers' \*\*Device ID\*\* \(no IDFA/);
    expect(STORE_PRIVACY).toContain("Fraud prevention, security, and compliance");
    expect(STORE_PRIVACY).toContain("READ_SLEEP");
  });
});
