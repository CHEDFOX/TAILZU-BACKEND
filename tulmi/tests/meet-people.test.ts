/**
 * THE MEETING BOT IN SPACES: WHOSE MEETINGS A SPACE'S ADMIN SEES (meet/people.ts): only members who agreed to the line about the admin as it
 * is now, never in a draft, never with a block between them either way, each member once across the admin's spaces (the first), with the
 * names the space has; the other way round, the admins who see a member's meetings, each once; and nobody at all while Spaces is off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberRow, SpaceRow } from "../src/botsBots/spaces.js";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; });

const { spacePeople, NO_PEOPLE } = await import("../src/meet/people.js");
const { resetConfigForTests } = await import("../src/config.js");

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

/** A space as the test writes it: its admin, whether it is a draft, and its members oldest first (consent: the line they agreed to). */
interface SpaceDef { id: string; owner: string; name: string; draft?: boolean; members: Array<{ id: string; name: string; consent?: 0 | 1 | 2 }> }

/** Spaces with the three reads people.ts makes. Its list keeps drafts in on purpose: people.ts must not count on mine() leaving them out. */
function fakeSpaces(defs: SpaceDef[]) {
  const rowOf = (d: SpaceDef): SpaceRow => ({ id: d.id, owner_id: d.owner, name: d.name, created_ms: 1, draft_ms: d.draft ? 5 : null, named: !d.draft });
  const rowsOf = (d: SpaceDef): MemberRow[] => d.members.map((m, i) => ({
    space_id: d.id, user_id: m.id, name: m.name, can_approve: true, joined_ms: i,
    consent_ms: m.consent ? 1_000 : null, consent_v: m.consent === 2 ? 2 : m.consent === 1 ? 1 : null,
  }));
  return {
    async mine(userId: string) {
      return defs.filter((d) => d.members.some((m) => m.id === userId)).map((d) => ({ id: d.id, name: d.name, perms: [], admin: d.owner === userId }));
    },
    async spaceRow(id: string) { const d = defs.find((x) => x.id === id); return d ? rowOf(d) : null; },
    async memberRows(id: string) { const d = defs.find((x) => x.id === id); return d ? rowsOf(d) : []; },
  };
}

/** Blocks, both ways round, whoever made them. */
function fakeBlocks(pairs: Array<[string, string]>) {
  return {
    async hiddenFor(userId: string) {
      const out = new Set<string>();
      for (const [a, b] of pairs) {
        if (a === userId) out.add(b);
        if (b === userId) out.add(a);
      }
      return out;
    },
  };
}

const AANYA = "u-aanya";
const RAVI = "u-ravi";
const MOM = "u-mom";
const NEW = "u-new";
const OLD = "u-old";
const SAM = "u-sam";

const HOME: SpaceDef = {
  id: "s-home", owner: AANYA, name: "Home", members: [
    { id: AANYA, name: "Aanya Sharma", consent: 2 },
    { id: RAVI, name: "Ravi Kumar", consent: 2 },
    { id: MOM, name: "Mom", consent: 2 },
    { id: NEW, name: "New Person" },
    { id: OLD, name: "Old Line", consent: 1 },
  ],
};

describe("the members a space's admin sees", () => {
  it("are those who agreed to the line about the admin as it is now, with the space's names", async () => {
    const people = spacePeople({ spaces: fakeSpaces([HOME]), blocks: fakeBlocks([]) });
    expect(await people.membersOf(AANYA)).toEqual([
      { userId: RAVI, name: "Ravi Kumar", spaceId: "s-home" },
      { userId: MOM, name: "Mom", spaceId: "s-home" },
    ]);
    // A member is nobody's admin there.
    expect(await people.membersOf(RAVI)).toEqual([]);
  });

  it("leave out a draft, and anyone with a block between them, whoever made it", async () => {
    const draft: SpaceDef = { id: "s-draft", owner: SAM, name: "", draft: true, members: [{ id: SAM, name: "Sam" }, { id: RAVI, name: "Ravi", consent: 2 }] };
    const people = spacePeople({ spaces: fakeSpaces([HOME, draft]), blocks: fakeBlocks([[MOM, AANYA]]) });
    expect((await people.membersOf(AANYA)).map((p) => p.userId)).toEqual([RAVI]);
    expect(await people.membersOf(SAM)).toEqual([]);
  });

  it("list someone in two of their spaces once, under the first", async () => {
    const work: SpaceDef = { id: "s-work", owner: AANYA, name: "Work", members: [{ id: AANYA, name: "Aanya" }, { id: SAM, name: "Sam", consent: 2 }, { id: RAVI, name: "Ravi (work)", consent: 2 }] };
    const people = spacePeople({ spaces: fakeSpaces([HOME, work]), blocks: fakeBlocks([]) });
    expect(await people.membersOf(AANYA)).toEqual([
      { userId: RAVI, name: "Ravi Kumar", spaceId: "s-home" },
      { userId: MOM, name: "Mom", spaceId: "s-home" },
      { userId: SAM, name: "Sam", spaceId: "s-work" },
    ]);
  });
});

describe("the admins who see a member's meetings", () => {
  it("are the admins of their spaces, once each, when they agreed to the line and there is no block", async () => {
    const work: SpaceDef = { id: "s-work", owner: SAM, name: "Work", members: [{ id: SAM, name: "Sam Lee" }, { id: RAVI, name: "Ravi K.", consent: 2 }] };
    const again: SpaceDef = { id: "s-again", owner: AANYA, name: "Again", members: [{ id: AANYA, name: "Aanya" }, { id: RAVI, name: "Ravi again", consent: 2 }] };
    const people = spacePeople({ spaces: fakeSpaces([HOME, work, again]), blocks: fakeBlocks([]) });
    expect(await people.adminsOf(RAVI)).toEqual([
      { userId: AANYA, name: "Aanya Sharma", spaceId: "s-home", memberName: "Ravi Kumar" },
      { userId: SAM, name: "Sam Lee", spaceId: "s-work", memberName: "Ravi K." },
    ]);
    // The line not agreed to as it is now (or at all): no admin sees their meetings.
    expect(await people.adminsOf(OLD)).toEqual([]);
    expect(await people.adminsOf(NEW)).toEqual([]);
    // Their own space's admin is themself: nobody.
    expect(await people.adminsOf(AANYA)).toEqual([]);

    const blocked = spacePeople({ spaces: fakeSpaces([HOME, work]), blocks: fakeBlocks([[AANYA, RAVI]]) });
    expect((await blocked.adminsOf(RAVI)).map((a) => a.userId)).toEqual([SAM]);
  });
});

describe("while Spaces is off", () => {
  it("there is nobody, either way round", async () => {
    vi.stubEnv("SPACES_ENABLED", "false");
    resetConfigForTests();
    const people = spacePeople({ spaces: fakeSpaces([HOME]), blocks: fakeBlocks([]) });
    expect(await people.membersOf(AANYA)).toEqual([]);
    expect(await people.adminsOf(RAVI)).toEqual([]);
    vi.stubEnv("SPACES_ENABLED", "true");
    resetConfigForTests();
    expect(await people.membersOf(AANYA)).toHaveLength(2);
  });

  it("and with no Spaces at all, nobody", async () => {
    expect(await NO_PEOPLE.membersOf(AANYA)).toEqual([]);
    expect(await NO_PEOPLE.adminsOf(RAVI)).toEqual([]);
  });
});
