// THE SAME PURPOSE, SAID THE SAME WAY IN FOUR PLACES (docs: perms §8 "Words pairing").
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

const { CONTACTS, HEALTH, LOCATE, healthLines, locateLines } = await import("../src/experience/bots/screens/permitWords.js");
const { PRIVACY_POLICY_HTML, PRIVACY_POLICY_EFFECTIVE } = await import("../src/routes/site/policies/privacy.js");

const HERE = import.meta.dirname;
const STORE_PRIVACY = fs.readFileSync(path.resolve(HERE, "../../docs/store-privacy.md"), "utf8");
const CONFIG_PATH = path.resolve(HERE, "../../../TAILZU-FRONTEND/app/app.config.ts");
const config = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : null;

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
    expect(l).toContain("no heart rate, sleep, weight or routes");
    expect(l).toContain("31 days");
    expect(l).toContain("never sent to AI services");
  });

  it("the contact picker has no card, because there is no prompt to introduce", () => {
    expect(Object.keys(CONTACTS)).not.toContain("title");
    expect(Object.keys(CONTACTS)).not.toContain("cta");
    expect(CONTACTS.button).toBe("Add from contacts");
  });
});

describe("the system prompt says what the card said", () => {
  it.skipIf(!config)("LOCATION_USAGE names the tap, the purpose, and that only the area's name is kept", () => {
    const usage = /const LOCATION_USAGE =\s*([\s\S]*?);\n/.exec(config!)?.[1] ?? "";
    expect(usage, "app.config.ts has no LOCATION_USAGE").not.toBe("");
    expect(usage).toContain(LOCATE.button);
    expect(usage).toMatch(/travel times/);
    expect(usage).toMatch(/keeps the area's name, not your exact location/);
  });

  it.skipIf(!config)("HEALTH_USAGE names steps and workouts, the fitness bot, and no ads", () => {
    const usage = /const HEALTH_USAGE =\s*([\s\S]*?);\n/.exec(config!)?.[1] ?? "";
    expect(usage, "app.config.ts has no HEALTH_USAGE").not.toBe("");
    expect(usage).toMatch(/steps and workouts/);
    expect(usage).toMatch(/fitness bot/);
    expect(usage).toMatch(/never uses it for ads/);
  });

  it.skipIf(!config)("no usage string, entitlement or dangerous permission arrives without its screen", () => {
    // The other half of rule 1 is in the native package's own checks; this is the half the server can see: a string for a
    // thing this server never draws would be a declaration with no feature behind it.
    // A real Info.plist key, not a comment saying the key is absent: "Name: value" at the start of a line's content.
    // A real key with a string value. `Name: false` is the HealthKit plugin's own option for "do not write this key".
    const key = (name: string) => new RegExp(`^[ \\t]*${name}:\\s*["'\`A-Z_]`, "m").test(config!);
    expect(key("NSContactsUsageDescription"), "the build asks for Contacts, which this build's picker does not need").toBe(false);
    expect(key("NSLocationAlwaysUsageDescription"), "the build asks for Always location, which no screen here uses").toBe(false);
    expect(key("NSLocationAlwaysAndWhenInUseUsageDescription"), "the build asks for Always location").toBe(false);
    expect(key("NSMotionUsageDescription"), "the build asks for motion, which nothing here reads").toBe(false);
    expect(key("NSHealthUpdateUsageDescription"), "the build says it writes to Health, which nothing here does").toBe(false);
    expect(true).toBe(true);
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

  it("the AI section says health is never sent", () => {
    expect(PRIVACY_POLICY_HTML).toMatch(/Never sent:<\/strong> health data from Apple Health or Health Connect/);
  });

  it("the effective date moved with the change", () => {
    expect(PRIVACY_POLICY_EFFECTIVE).toBe("November 13, 2026");
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
});
