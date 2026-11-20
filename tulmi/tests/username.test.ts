import { beforeEach, describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import {
  CHANGE_EVERY_MS, checkShape, claim, cleanUsername, free, idFor, resetUsernamesForTests, setUsernameClockForTests,
  usernameOf, USERNAME_MAX, USERNAME_MIN,
} from "../src/profile/username.js";

let clock = Date.parse("2026-03-20T12:00:00Z");
beforeEach(() => {
  resetUsernamesForTests();
  clock = Date.parse("2026-03-20T12:00:00Z");
  setUsernameClockForTests(() => clock);
});
const aMonthPasses = () => { clock += CHANGE_EVERY_MS + 1; };

describe("what counts as a username", () => {
  it("takes the @ off, and the case and spaces with it", () => {
    expect(cleanUsername("  @Aanya ")).toBe("aanya");
    expect(cleanUsername("@@ROHAN")).toBe("rohan");
  });

  it("is nothing when it could never be one", () => {
    expect(cleanUsername(42)).toBe("");
    expect(cleanUsername("ab")).toBe("");
    expect(cleanUsername("a".repeat(USERNAME_MAX + 1))).toBe("");
  });

  it("says what is wrong in a line a person can read", () => {
    expect(checkShape("")).toEqual({ ok: false, why: "Pick a username." });
    expect(checkShape("ab")).toEqual({ ok: false, why: `At least ${USERNAME_MIN} characters.` });
    expect(checkShape("aa nya")).toEqual({ ok: false, why: "Letters, numbers, - and _ only." });
    expect(checkShape("aanya!")).toEqual({ ok: false, why: "Letters, numbers, - and _ only." });
    expect(checkShape("-aanya")).toEqual({ ok: false, why: "Start and end with a letter or number." });
    expect(checkShape("aanya-")).toEqual({ ok: false, why: "Start and end with a letter or number." });
  });

  it("allows a hyphen and an underscore in the middle, as the names we give out have", () => {
    expect(checkShape("swift-otter-042")).toEqual({ ok: true, name: "swift-otter-042" });
    expect(checkShape("@Aanya_R")).toEqual({ ok: true, name: "aanya_r" });
  });
});

describe("taking one", () => {
  it("is theirs once claimed, and nobody else's", async () => {
    expect(await claim("u1", "aanya")).toBe("ok");
    expect(await usernameOf("u1")).toBe("aanya");
    expect(await idFor("@Aanya")).toBe("u1");
    expect(await claim("u2", "aanya")).toBe("taken");
    expect(await usernameOf("u2")).toBe("");
  });

  it("claiming the one you already hold is fine, and changes nothing", async () => {
    await claim("u1", "aanya");
    expect(await claim("u1", "aanya")).toBe("ok");
    expect(await usernameOf("u1")).toBe("aanya");
  });

  it("never gives a name away twice, even once it is given up", async () => {
    expect(await claim("u1", "aanya")).toBe("ok");
    aMonthPasses();
    expect(await claim("u1", "aanya-r")).toBe("ok");
    expect(await usernameOf("u1")).toBe("aanya-r");
    // The one they let go means them or nobody: never someone else.
    expect(await free("aanya")).toBe(false);
    expect(await claim("u2", "aanya")).toBe("taken");
    expect(await idFor("aanya")).toBe(null);
  });

  it("keeps ours, and says only that they are taken", async () => {
    for (const ours of ["x0bot", "support", "admin", "everyone"]) {
      expect(await free(ours)).toBe(false);
      expect(await claim("u1", ours)).toBe("taken");
    }
  });

  it("paces changes once they have picked one themselves", async () => {
    // The first claim stands in for the name they were given at sign-up; the next waits a month.
    expect(await claim("u1", "first-one")).toBe("ok");
    expect(await claim("u1", "second-one")).toBe("too_soon");
    expect(await usernameOf("u1")).toBe("first-one");
    aMonthPasses();
    expect(await claim("u1", "second-one")).toBe("ok");
  });

  it("refuses a shape outright rather than reaching the database", async () => {
    await expect(claim("u1", "ab")).rejects.toThrow();
    expect(await free("ab")).toBe(false);
  });
});

describe("what a look-up gives away", () => {
  it("answers free or not, and nothing about whose it is", async () => {
    await claim("u1", "aanya");
    expect(await free("aanya")).toBe(false);
    expect(await free("rohan")).toBe(true);
  });

  it("gives nobody for a name nobody holds", async () => {
    expect(await idFor("nobody-here")).toBe(null);
    expect(await idFor("!!")).toBe(null);
  });
});
