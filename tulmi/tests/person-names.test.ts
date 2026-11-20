import { beforeEach, describe, expect, it } from "vitest";

process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.SPACES_ENABLED = "true";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { PersonNames, shownName } from "../src/botsBots/personNames.js";
// eslint-disable-next-line import/first
import { resetSpaceTablesForTests } from "../src/botsBots/spaceRows.js";

const AANYA = "11111111-1111-1111-1111-111111111111";
const ROHAN = "22222222-2222-2222-2222-222222222222";
const ME = "99999999-9999-9999-9999-999999999999";

let names: PersonNames;
beforeEach(() => {
  resetSpaceTablesForTests();
  names = new PersonNames();
});

describe("the name you give someone", () => {
  it("is yours, and nobody else's: the same account is Mom to one person and Aanya to another", async () => {
    await names.set(ME, AANYA, "Mom");
    await names.set(ROHAN, AANYA, "Aanya");
    expect(await names.nameFor(ME, AANYA)).toBe("Mom");
    expect(await names.nameFor(ROHAN, AANYA)).toBe("Aanya");
    // And neither can read the other's name for her.
    expect([...(await names.known(ME))]).toEqual([[AANYA, "Mom"]]);
    expect([...(await names.known(ROHAN))]).toEqual([[AANYA, "Aanya"]]);
  });

  it("is nothing until it is given", async () => {
    expect(await names.nameFor(ME, AANYA)).toBe("");
    expect((await names.known(ME)).size).toBe(0);
  });

  it("an empty name takes it off again", async () => {
    await names.set(ME, AANYA, "Mom");
    expect(await names.set(ME, AANYA, "   ")).toEqual({ name: "" });
    expect(await names.nameFor(ME, AANYA)).toBe("");
  });

  it("is tidied and bounded, as the names on the rows are", async () => {
    expect(await names.set(ME, AANYA, "  Mom   dearest ")).toEqual({ name: "Mom dearest" });
    const long = await names.set(ME, ROHAN, "r".repeat(80));
    expect(long.name).toHaveLength(40);
  });

  it("nobody names themselves", async () => {
    await expect(names.set(ME, ME, "Me")).rejects.toThrow();
    await expect(names.set(ME, "", "Nobody")).rejects.toThrow();
  });

  it("changing it replaces it, and does not pile up", async () => {
    await names.set(ME, AANYA, "Mom");
    await names.set(ME, AANYA, "Mum");
    expect(await names.nameFor(ME, AANYA)).toBe("Mum");
    expect((await names.mine(ME))).toHaveLength(1);
  });
});

describe("resolving over the name a row already carries", () => {
  it("takes the viewer's own name first, then the row's", () => {
    const known = new Map([[AANYA, "Mom"]]);
    expect(shownName(known, AANYA, "Aanya Rao")).toBe("Mom");
    // Nobody named: the row's own name, which is what every screen showed before this existed.
    expect(shownName(known, ROHAN, "Rohan")).toBe("Rohan");
    expect(shownName(null, AANYA, "Aanya Rao")).toBe("Aanya Rao");
    expect(shownName(undefined, AANYA, "Aanya Rao")).toBe("Aanya Rao");
  });

  it("never empties a name the row had", () => {
    expect(shownName(new Map([[AANYA, ""]]), AANYA, "Aanya Rao")).toBe("Aanya Rao");
    expect(shownName(new Map(), "", "Someone")).toBe("Someone");
  });
});
