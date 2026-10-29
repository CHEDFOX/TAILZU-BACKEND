/**
 * The new onboarding's words, in English and in Hinglish.
 *
 * The English is the source and the Hinglish is the design's own, looked up
 * line for line (onboardHinglishSeeds, merged into the translator's seeds in
 * i18n.ts). This file stands in for the translator the way
 * i18n-assistant.test.ts does, and asserts the model is never asked for any of
 * it. Kept apart from onboard.test.ts because it replaces the file system for
 * the translation cache and the OpenAI client, which that file's server needs.
 */
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ items: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: { messages: Array<{ content: string }> }) => {
          const input = body.messages[1]!.content;
          const items = JSON.parse(input.slice(input.indexOf("Input JSON:") + "Input JSON:".length)) as string[];
          seen.items.push(...items);
          return { choices: [{ message: { content: JSON.stringify({ items: items.map((s) => "MODEL:" + s) }) } }] };
        },
      },
    };
  },
}));
// The translation cache stays in memory. It starts WITH a model's old guess for
// a word the onboarding also uses, as a server that has run for a while would:
// the design's line must win over it.
vi.mock("node:fs/promises", () => ({
  readFile: async (path: unknown) => {
    if (String(path).endsWith("hinglish.json")) return JSON.stringify({ Continue: "MODEL-GUESS" });
    throw new Error("no cache here");
  },
  writeFile: async () => {},
  mkdir: async () => {},
}));

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const { localize } = await import("../src/experience/i18n.js");
const { buildScreen, DAILY_LANGUAGES } = await import("../src/experience/catalog.js");
const { OB_EN, OB_HG, OB_STORE_EN, OB_STORE_HG, onboardAuthTree, onboardHinglishSeeds } = await import("../src/experience/onboard.js");
const { STORE_NEEDS } = await import("../src/experience/onboardStore.js");
const { EN, hinglishSeeds } = await import("../src/connectors/words.js");
const { CATALOG } = await import("../src/connectors/catalog.js");

const google = (id: string, name: string, connected = false) =>
  ({ id, name, category: "x", oneLine: CATALOG.find((c) => c.id === id)!.oneLine, auth: "oauth", connected, level: "send", auto: [] });
const APPS = [
  google("google-calendar", "Google Calendar"), google("google-docs", "Google Docs"), google("google-tasks", "Google Tasks"),
  google("google-sheets", "Google Sheets"), google("google-forms", "Google Forms", true),
];
const can = new Set(["OnboardStage", "BlipSpot"]);
const screen = (extra: Record<string, unknown> = {}) =>
  buildScreen("onboard", { personality: {}, language: "hinglish", platform: "ios", formFactor: "phone", connectorsOn: true, assistant: { apps: APPS, names: {} }, can, ...extra } as never)!;

describe("the lines", () => {
  it("every English line has its Hinglish, and none is empty", () => {
    expect(Object.keys(OB_HG).sort()).toEqual(Object.keys(OB_EN).sort());
    for (const [k, v] of Object.entries(OB_EN)) expect(v.trim(), k).not.toBe("");
    for (const [k, v] of Object.entries(OB_HG)) expect(v.trim(), k).not.toBe("");
    expect(Object.keys(OB_EN).length).toBe(106);
  });

  it("a line with parts has the same parts in both voices; a line with a slot has the same slot", () => {
    for (const k of Object.keys(OB_EN) as Array<keyof typeof OB_EN>) {
      expect(OB_HG[k].split("|").length, k).toBe(OB_EN[k].split("|").length);
      expect(OB_HG[k].match(/\{\w+\}/g)?.sort(), k).toEqual(OB_EN[k].match(/\{\w+\}/g)?.sort());
    }
  });

  it("How careful names the level by the word Connected apps shows for it, in both voices", () => {
    const seeds = hinglishSeeds(CATALOG.map((c) => c.name), CATALOG);
    expect(OB_EN["s7.foot"]).toContain(EN["lv.look"]);
    expect(seeds.get(EN["lv.look"])).toBe("Dekh sakta hoon");
    expect(OB_HG["s7.foot"]).toContain("Dekh sakta hoon");
  });

  it("the lines the design changed are the ones the product needs", () => {
    expect(OB_EN["s1.fine"]).toBe("Takes about two minutes.");
    expect(OB_HG["s1.cta"]).toBe("Chalo, set up karte hain");
    expect(OB_HG["cd.p"]).toBe("Maine {to} par {len} digit ka code bheja hai.");
    expect(OB_EN["s2.more"]).toBe("+ {n} more");
  });

  it("seeds map each English line to its Hinglish, with the slot filled and the flows split into parts", () => {
    const seeds = onboardHinglishSeeds();
    expect(seeds.get("Continue")).toBe("Aage chalo");
    expect(seeds.get("Hi, I’m X0.")).toBe("Hi, main X0 hoon.");
    const rest = DAILY_LANGUAGES.length - DAILY_LANGUAGES.filter((l) => l.india || l.value === "en").length;
    expect(seeds.get(`+ ${rest} more`)).toBe(`+ ${rest} aur`);
    expect(seeds.has("+ {n} more")).toBe(false);
    // The flows are drawn one pill per part, so each part is a seed.
    expect(seeds.get("Show you")).toBe("Dikhaunga");
    expect(seeds.get("I remember")).toBe("Yaad rakhunga");
    expect(seeds.get("Your yes")).toBe("Aapki haan");
    expect(seeds.get("Every time")).toBe("Har baar");
    expect(seeds.has("Show you|Your yes|I remember")).toBe(false);
    // The code entry fills these two itself.
    expect(seeds.get("I sent a {len}-digit code to {to}.")).toBe("Maine {to} par {len} digit ka code bheja hai.");
  });

  it("agrees with the assistant's table wherever the two say the same thing", () => {
    const theirs = hinglishSeeds(CATALOG.map((c) => c.name), CATALOG);
    const apart: string[] = [];
    for (const [from, to] of onboardHinglishSeeds()) {
      if (theirs.has(from) && theirs.get(from) !== to) apart.push(from);
    }
    // Two English lines are the same in both designs and were given different
    // Hinglish: "Continue" (Add by link: "Aage badho"; the onboarding: "Aage
    // chalo") and "Try saying" (Ask: "Aise bolke dekho"; the onboarding: "Aise
    // bolo"). That is why the onboarding's lines are applied to its own screen
    // and not merged into the shared seeds (the next tests hold both sides).
    // Any other overlap would be a surprise, so the list is exactly those two.
    expect(apart).toEqual(["Continue", "Try saying"]);
    // And the lines taken from that table are there to be taken.
    for (const k of ["connect", "st.ok", "st.no", "s6.sug", "s6.more", "a2.ai", "err.connect"] as const) expect(EN[k]).toBeTruthy();
  });
});

describe("a Hinglish profile reads the design's words and the model is not asked", () => {
  it("every step of the screen, phone and window", async () => {
    for (const extra of [{}, { platform: "android" }, { formFactor: "desktop" }, { connectorsOn: false }]) {
      seen.items.length = 0;
      const json = JSON.stringify(await localize(screen(extra), "hinglish"));
      expect(seen.items, JSON.stringify(extra)).toEqual([]);
      const lines = ["s2.h", "s2.p", "s4.h", "s4.hold", "s8.cta", "ob.err.finish", "ob.cont"] as const;
      for (const k of lines) expect(json, k).toContain(JSON.stringify(OB_HG[k]).slice(1, -1));
      // Make me yours is the phone's.
      if (!("formFactor" in extra)) expect(json).toContain(JSON.stringify(OB_HG["s5.blocked"]).slice(1, -1));
      expect(json).not.toContain("MODEL");
    }
  });

  it("the design's line beats a model's old guess already in the cache", async () => {
    const json = JSON.stringify(await localize(screen(), "hinglish"));
    expect(json).toContain("Aage chalo");
    expect(json).not.toContain("MODEL-GUESS");
  });

  it("and it stays on its own screen: another screen with the same English keeps its own Hinglish", async () => {
    const own = JSON.stringify(await localize(screen(), "hinglish"));
    expect(own).toContain("Aise bolo");
    expect(own).not.toContain("Aise bolke dekho");
    // Ask says "Try saying" too, in the design's other words: reworded by nobody.
    const ask = buildScreen("assistant_ask", {
      personality: {}, language: "hinglish", platform: "ios", formFactor: "phone", connectorsOn: true,
      assistant: { apps: APPS, names: {} }, can,
    } as never)!;
    const asked = JSON.stringify(await localize(ask, "hinglish"));
    expect(asked).toContain("Aise bolke dekho");
    expect(asked).not.toContain("Aise bolo");
    // The cache's old "Continue" is the model's own and still wins for every screen but this one.
    expect(JSON.stringify(await localize({ schemaVersion: 1, screenId: "x", root: { type: "Text", props: { content: "Continue" } } } as never, "hinglish"))).toContain("MODEL-GUESS");
  });

  it("the speech bubbles, the toasts that are said when a permission is blocked, and the flows", async () => {
    const out = (await localize(screen(), "hinglish")) as any;
    const json = JSON.stringify(out);
    for (const k of ["s2.say", "s3.say", "s4.say2", "s5.say", "s6.say", "s7.say", "s8.say"] as const) expect(json, k).toContain(JSON.stringify(OB_HG[k]).slice(1, -1));
    // onBlocked is a branch of requestPermission, and said aloud.
    expect(JSON.stringify(out.actions.askMic)).toContain(OB_HG["s5.blocked"]);
    for (const part of ["Dekhna", "Jawab", "Dikhaunga", "Aapki haan", "Yaad rakhunga", "Poochunga", "Har baar"]) expect(json, part).toContain(`"${part}"`);
    // The apps' own names are theirs and stay as they are; the shared table's words are used.
    expect(out.state.n["google-calendar"]).toBe("Google Calendar");
    expect(json).toContain("Jud gaya");
    expect(json).toContain("Jodo");
    expect(json).toContain("Main Google Calendar tabhi use karta hoon");
  });

  it("the sign-in tree, which is English until there is an account, localizes the same way when it is asked", async () => {
    seen.items.length = 0;
    const tree = onboardAuthTree({ connectorsOn: true });
    const wrapped = { schemaVersion: 1, screenId: "onboard", root: tree } as never;
    const json = JSON.stringify(await localize(wrapped, "hinglish"));
    // Everything but the consent line, which is today's AUTH_UI.legal and has no
    // Hinglish of its own in the design (the tree is English before an account).
    expect(seen.items).toEqual(["Continuing means you agree to our ", "Terms", " and ", "Privacy Policy"]);
    for (const k of ["s1.h", "s1.cta", "si.say", "si.h", "si.trust", "cd.h", "cd.say2"] as const) expect(json, k).toContain(JSON.stringify(OB_HG[k]).slice(1, -1));
    // Props that only these node types carry.
    for (const k of ["si.email", "si.phone", "cd.change", "cd.resend", "cd.wrongE", "cd.p"] as const) expect(json, k).toContain(JSON.stringify(OB_HG[k]).slice(1, -1));
    expect(json).toContain("Namaste!");
  });

  it("another language goes to the translator as every other screen does, with the app's names left alone", async () => {
    seen.items.length = 0;
    await localize(screen(), "hi");
    expect(seen.items).toContain("Which languages do you speak?");
    expect(seen.items).not.toContain("Google Calendar");
    expect(seen.items).not.toContain("G");
    expect(seen.items).not.toContain("Hinglish");
  });
});

describe("the store variant reads the same Hinglish, and the model is not asked", () => {
  const store = (extra: Record<string, unknown> = {}) => screen({ can: new Set([...STORE_NEEDS, "ActionUrl"]), ...extra });

  it("every step, with the apps and without", async () => {
    for (const extra of [{}, { platform: "android" }, { connectorsOn: false }, { can: new Set(STORE_NEEDS) }]) {
      seen.items.length = 0;
      const built = store(extra);
      expect(JSON.stringify(built)).not.toContain("OnboardStage");
      const json = JSON.stringify(await localize(built, "hinglish"));
      expect(seen.items, JSON.stringify(Object.keys(extra))).toEqual([]);
      for (const k of ["s1.h", "s1.cta", "s1.say", "s2.h", "s3.h", "s4.h", "s4.say2", "s5.h", "s5.blocked", "s8.h", "s8.cta", "ob.cont", "ob.err.finish", "s4.err", "s4.busy"] as const) {
        expect(json, k).toContain(JSON.stringify(OB_HG[k]).slice(1, -1));
      }
      expect(json).not.toContain("MODEL");
    }
  });

  it("the four lines only it says: the mic button's own words (stopLabel and transcribingLabel are translated for it), and the how", async () => {
    const json = JSON.stringify(await localize(store(), "hinglish"));
    for (const k of Object.keys(OB_STORE_EN) as Array<keyof typeof OB_STORE_EN>) {
      expect(json, k).toContain(JSON.stringify(OB_STORE_HG[k]).slice(1, -1));
      expect(json, k).not.toContain(JSON.stringify(OB_STORE_EN[k]).slice(1, -1));
    }
    expect(onboardHinglishSeeds().get(OB_STORE_EN["st.live"])).toBe(OB_STORE_HG["st.live"]);
    // The slots in them are the same in both voices.
    for (const k of Object.keys(OB_STORE_EN) as Array<keyof typeof OB_STORE_EN>) {
      expect(OB_STORE_HG[k].match(/\{\w+\}/g)?.sort(), k).toEqual(OB_STORE_EN[k].match(/\{\w+\}/g)?.sort());
    }
  });

  it("English reads as written, and another language goes to the translator with the mic button's words", async () => {
    const en = JSON.stringify(await localize(store(), "en"));
    expect(en).toContain(OB_STORE_EN["st.tap"]);
    seen.items.length = 0;
    await localize(store(), "hi");
    // (Writing it… was asked for already, by the stage's own Try it: the translator remembers.)
    expect(seen.items).toContain(OB_STORE_EN["st.live"]);
    expect(seen.items).toContain(OB_STORE_EN["st.again"]);
  });
});
