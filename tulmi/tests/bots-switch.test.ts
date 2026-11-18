/**
 * A SWITCH PER BOT (config BOTS_OFF, bots/builtin.ts).
 *
 * Four bots are listed the moment BOTS is on and had no switch of their own; two have one (LINGO, CINEMA) and three
 * are gated by whether their service is set up. This is the one control that reaches all of them, and these are the
 * things it has to get right:
 *
 *   - empty changes nothing, which is what every server running today has
 *   - naming a bot hides it, whether or not it had a switch before
 *   - hiding a bot does NOT free its name, or somebody takes it and collides the day it comes back
 *   - it cannot switch a bot ON: a bot still has to be set up before it can be listed
 */
import { afterEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
});
const { resetConfigForTests } = await import("../src/config.js");
const { builtinBots, builtinBot, isBuiltinSlug } = await import("../src/bots/builtin.js");
const { RESERVED_SLUGS } = await import("../src/bots/types.js");

const set = (v: string | undefined) => {
  if (v === undefined) delete process.env.BOTS_OFF;
  else process.env.BOTS_OFF = v;
  resetConfigForTests();
};
const slugs = () => builtinBots().map((b) => b.slug);
afterEach(() => set(undefined));

describe("a switch per bot", () => {
  it("lists every bot when it is empty, which is what a server running today does", () => {
    set("");
    expect(slugs()).toEqual(["code", "keybot", "plan", "travel", "talk"]);
  });

  it("hides the one it names, including bots that never had a switch of their own", () => {
    set("travel");
    expect(slugs()).not.toContain("travel");
    expect(slugs()).toContain("code");
    expect(builtinBot("travel")).toBeNull();
  });

  it("hides several, and does not care about spaces or capitals", () => {
    set(" Travel , TALK ");
    expect(slugs()).toEqual(["code", "keybot", "plan"]);
  });

  it("does nothing for a name that is not a bot", () => {
    set("notabot,,travel");
    expect(slugs()).toEqual(["code", "keybot", "plan", "talk"]);
  });

  it("KEEPS THE NAME RESERVED while the bot is hidden, so nobody can take it and collide when it returns", () => {
    set("travel,talk");
    // Gone from the list...
    expect(slugs()).not.toContain("travel");
    // ...and still nobody else's to take.
    expect(isBuiltinSlug("travel")).toBe(true);
    expect(isBuiltinSlug("talk")).toBe(true);
    expect(RESERVED_SLUGS).toContain("travel");
    expect(RESERVED_SLUGS).toContain("talk");
  });

  it("cannot switch a bot ON: a bot that is not set up stays unlisted whatever this says", () => {
    // The meeting bot needs RECALL_API_KEY, which these tests do not set. Naming it here is not a way in.
    set("");
    expect(slugs()).not.toContain("meet");
    set("code");
    expect(slugs()).not.toContain("meet");
  });

  it("comes back the moment it is taken out of the list", () => {
    set("travel");
    expect(slugs()).not.toContain("travel");
    set("");
    expect(slugs()).toContain("travel");
  });
});
