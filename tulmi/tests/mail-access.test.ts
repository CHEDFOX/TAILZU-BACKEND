/**
 * THE MAIL BOT IN SPACES: WHOSE BUSINESS IT IS AND WHO ELSE MAY REACH IT (mail/access.ts). The registry (business -> owner) and the addresses
 * given to members, each store with its memory twin and its Supabase one doing the same thing; and resolve(): the owner's own (an unknown
 * business too, so older businesses keep working), the admin of a space the owner agreed to the line in (everything), a member given
 * addresses (only those, only while still a member: agreed to the line as it is now, no block, Spaces on), anyone else nobody (null).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberRow, SpaceRow } from "../src/botsBots/spaces.js";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { fakeSupabase } = await import("./work-fixtures.js");
const access = await import("../src/mail/access.js");
const { spacePeople } = await import("../src/meet/people.js");
const { resetConfigForTests } = await import("../src/config.js");

afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

const RAVI = "11111111-1111-4111-8111-111111111111";
const AANYA = "22222222-2222-4222-8222-222222222222";
const SAM = "33333333-3333-4333-8333-333333333333";
const NEW = "44444444-4444-4444-8444-444444444444";
const STRANGER = "55555555-5555-4555-8555-555555555555";
const OLD = "66666666-6666-4666-8666-666666666666";
const KIM = "77777777-7777-4777-8777-777777777777";

describe("the process's own stores", () => {
  it("are memory when there is no Supabase, and the same one each time", () => {
    expect(access.mailBusinesses()).toBeInstanceOf(access.MemoryMailBusinesses);
    expect(access.mailBusinesses()).toBe(access.mailBusinesses());
    expect(access.mailHandlers()).toBeInstanceOf(access.MemoryMailHandlers);
    expect(access.mailHandlers()).toBe(access.mailHandlers());
  });
});

describe.each([
  ["memory", () => ({ store: new access.MemoryMailBusinesses(), sb: null })],
  ["supabase", () => { const sb = fakeSupabase({ tables: ["mail_businesses"] }); return { store: new access.SupabaseMailBusinesses(sb as never), sb }; }],
])("the registry of whose each business is (%s)", (_n, make) => {
  it("keeps whose a business is, and says nobody's for one it never heard of", async () => {
    const { store } = make();
    expect(await store.whose("leaf-co")).toBeNull();
    await store.keep("leaf-co", RAVI);
    expect(await store.whose("leaf-co")).toBe(RAVI);
    // Made again under the same id by someone else: theirs now.
    await store.keep("leaf-co", AANYA);
    expect(await store.whose("leaf-co")).toBe(AANYA);
    await store.forget("leaf-co");
    expect(await store.whose("leaf-co")).toBeNull();
  });

  it("learns an owner's list: what is missing or says someone else, and leaves what is right alone", async () => {
    const { store, sb } = make();
    await store.keep("leaf-co", RAVI);
    await store.keep("stale-co", OLD);
    const before = sb?.log.length ?? 0;
    await store.claim(RAVI, ["leaf-co"]);
    // Nothing to write: one read, no write.
    if (sb) expect(sb.log.length).toBe(before);
    await store.claim(RAVI, ["leaf-co", "new-co", "stale-co"]);
    expect([await store.whose("leaf-co"), await store.whose("new-co"), await store.whose("stale-co")]).toEqual([RAVI, RAVI, RAVI]);
    if (sb) expect(sb.log.at(-1)).toEqual({ table: "mail_businesses", op: "upsert", args: [[{ business_id: "new-co", user_id: RAVI }, { business_id: "stale-co", user_id: RAVI }]] });
    await store.claim(RAVI, []);
  });

  it("says which of some people have a business here", async () => {
    const { store } = make();
    await store.keep("leaf-co", RAVI);
    await store.keep("tea-co", RAVI);
    await store.keep("sam-co", SAM);
    expect(await store.owning([RAVI, AANYA, SAM])).toEqual(new Set([RAVI, SAM]));
    expect(await store.owning([])).toEqual(new Set());
  });
});

describe.each([
  ["memory", () => new access.MemoryMailHandlers()],
  ["supabase", () => new access.SupabaseMailHandlers(fakeSupabase({ tables: ["mail_handlers"] }) as never)],
])("the addresses given to members (%s)", (_n, make) => {
  const SUPPORT = { businessId: "leaf-co", ownerId: RAVI, addressId: 2, addressEmail: "Support@LeafandCo.in", memberId: SAM };

  it("gives an address once, its email kept lowercase, and reads it by member and by business", async () => {
    const s = make();
    expect(await s.give(SUPPORT)).toBe(true);
    expect(await s.give(SUPPORT)).toBe(false);
    await s.give({ ...SUPPORT, addressId: 3, addressEmail: "billing@leafandco.in" });
    await s.give({ ...SUPPORT, businessId: "tea-co", addressId: 9, addressEmail: "hi@tea.in", memberId: NEW });
    expect((await s.ofMember(SAM)).map((h) => [h.businessId, h.addressId, h.addressEmail])).toEqual([["leaf-co", 2, "support@leafandco.in"], ["leaf-co", 3, "billing@leafandco.in"]]);
    expect((await s.ofBusinesses(["tea-co"])).map((h) => h.memberId)).toEqual([NEW]);
    expect(await s.ofBusinesses([])).toEqual([]);
    expect(await s.ofMember(STRANGER)).toEqual([]);
  });

  it("gives it again when the row was another owner's (an old business under the same id)", async () => {
    const s = make();
    await s.give({ ...SUPPORT, ownerId: OLD });
    expect(await s.give(SUPPORT)).toBe(true);
    expect((await s.ofMember(SAM)).map((h) => h.ownerId)).toEqual([RAVI]);
  });

  it("takes an address back by its id or its email, only the owner's row for that member", async () => {
    const s = make();
    await s.give(SUPPORT);
    // The same address re-added under a new id: one row each.
    await s.give({ ...SUPPORT, addressId: 12 });
    await s.give({ ...SUPPORT, memberId: NEW });
    await s.take({ businessId: "leaf-co", ownerId: AANYA, addressId: 2, addressEmail: "support@leafandco.in", memberId: SAM });
    expect(await s.ofMember(SAM)).toHaveLength(2);
    await s.take({ businessId: "leaf-co", ownerId: RAVI, addressId: 2, addressEmail: "SUPPORT@leafandco.in", memberId: SAM });
    expect(await s.ofMember(SAM)).toEqual([]);
    expect(await s.ofMember(NEW)).toHaveLength(1);
  });

  it("forgets an address removed and a business deleted", async () => {
    const s = make();
    await s.give(SUPPORT);
    await s.give({ ...SUPPORT, addressId: 3, addressEmail: "billing@leafandco.in" });
    await s.give({ ...SUPPORT, businessId: "tea-co", addressId: 9, addressEmail: "hi@tea.in" });
    await s.forgetAddress("leaf-co", 3);
    expect((await s.ofMember(SAM)).map((h) => h.addressId)).toEqual([2, 9]);
    await s.forgetBusiness("leaf-co");
    expect((await s.ofMember(SAM)).map((h) => h.businessId)).toEqual(["tea-co"]);
  });
});

describe("the Supabase stores", () => {
  it("never write a row for something that isn't an account, and read none for it", async () => {
    const b = new access.SupabaseMailBusinesses(fakeSupabase({ tables: ["mail_businesses"] }) as never);
    await expect(b.keep("leaf-co", "dev-user")).rejects.toThrow(/not an account/);
    expect(await b.owning(["dev-user"])).toEqual(new Set());
    const h = new access.SupabaseMailHandlers(fakeSupabase({ tables: ["mail_handlers"] }) as never);
    await expect(h.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 2, addressEmail: "a@b.in", memberId: "dev-user" })).rejects.toThrow(/not an account/);
    expect(await h.ofMember("dev-user")).toEqual([]);
  });

  it("say so when the table can't be read", async () => {
    await expect(new access.SupabaseMailBusinesses(fakeSupabase({ error: "no table" }) as never).whose("leaf-co")).rejects.toThrow(/mail_businesses read failed/);
    await expect(new access.SupabaseMailHandlers(fakeSupabase({ error: "no table" }) as never).ofMember(SAM)).rejects.toThrow(/mail_handlers read failed/);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------ resolve

/** A space as the test writes it: its admin, and its members oldest first (consent: the line they agreed to). */
interface SpaceDef { id: string; owner: string; name: string; draft?: boolean; members: Array<{ id: string; name: string; consent?: 0 | 1 | 2 }> }

/** Spaces with the three reads people.ts makes. */
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
      for (const [a, b] of pairs) { if (a === userId) out.add(b); if (b === userId) out.add(a); }
      return out;
    },
  };
}

/** Aanya is the admin of Home, where Ravi agreed to the line about her. Ravi is the admin of Shop: Sam agreed to it, New never did. */
const HOME: SpaceDef = { id: "s-home", owner: AANYA, name: "Home", members: [{ id: AANYA, name: "Aanya Sharma", consent: 2 }, { id: RAVI, name: "Ravi Kumar", consent: 2 }] };
const SHOP: SpaceDef = {
  id: "s-shop", owner: RAVI, name: "Shop", members: [
    { id: RAVI, name: "Ravi K." }, { id: SAM, name: "Sam Lee", consent: 2 }, { id: NEW, name: "New One", consent: 1 }, { id: KIM, name: "Kim", consent: 2 },
  ],
};

async function world(o: { spaces?: SpaceDef[]; blocks?: Array<[string, string]> } = {}) {
  const businesses = new access.MemoryMailBusinesses();
  const handlers = new access.MemoryMailHandlers();
  await businesses.keep("leaf-co", RAVI);
  await handlers.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 2, addressEmail: "support@leafandco.in", memberId: SAM });
  await handlers.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 3, addressEmail: "Billing@leafandco.in", memberId: SAM });
  // Given before New agreed to the line as it is now.
  await handlers.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 2, addressEmail: "support@leafandco.in", memberId: NEW });
  const people = spacePeople({ spaces: fakeSpaces(o.spaces ?? [HOME, SHOP]), blocks: fakeBlocks(o.blocks ?? []) });
  return { businesses, handlers, people, acc: access.mailAccess({ businesses, handlers, people }) };
}

describe("how a person reaches a business", () => {
  it("its owner reaches it as their own, and a business the registry never heard of is the viewer's own", async () => {
    const { acc } = await world();
    expect(await acc.resolve(RAVI, "leaf-co")).toEqual({ ownerId: RAVI, access: "own" });
    expect(await acc.resolve(STRANGER, "older-co")).toEqual({ ownerId: STRANGER, access: "own" });
  });

  it("the admin of a space its owner agreed to the line in reaches it whole, inside the owner's account", async () => {
    const { acc } = await world();
    expect(await acc.resolve(AANYA, "leaf-co")).toEqual({ ownerId: RAVI, access: "admin", owner: { id: RAVI, name: "Ravi Kumar" } });
  });

  it("a member given addresses reaches only those, by their emails, lowercase", async () => {
    const { acc } = await world();
    expect(await acc.resolve(SAM, "leaf-co")).toEqual({ ownerId: RAVI, access: "handler", addresses: new Set(["support@leafandco.in", "billing@leafandco.in"]) });
    expect(await acc.adminName(SAM, RAVI)).toBe("Ravi K.");
  });

  it("nobody else: a stranger, someone given an address before agreeing to the line as it is now, a row of another owner's", async () => {
    const { acc, handlers } = await world();
    expect(await acc.resolve(STRANGER, "leaf-co")).toBeNull();
    expect(await acc.resolve(NEW, "leaf-co")).toBeNull();
    // Kim is in Ravi's space, but her row was given by an older business's owner under the same id: it opens nothing of Ravi's.
    await handlers.give({ businessId: "leaf-co", ownerId: OLD, addressId: 4, addressEmail: "old@leafandco.in", memberId: KIM });
    expect(await acc.resolve(KIM, "leaf-co")).toBeNull();
  });

  it("a block either way ends it: between the owner and a member, between the admin and the owner", async () => {
    const blocked = await world({ blocks: [[SAM, RAVI]] });
    expect(await blocked.acc.resolve(SAM, "leaf-co")).toBeNull();
    const fromAdmin = await world({ blocks: [[RAVI, AANYA]] });
    expect(await fromAdmin.acc.resolve(AANYA, "leaf-co")).toBeNull();
    // The owner's own way in never changes.
    expect(await fromAdmin.acc.resolve(RAVI, "leaf-co")).toEqual({ ownerId: RAVI, access: "own" });
  });

  it("leaving the space ends it, and a draft space is nobody's: the rows stay, doing nothing", async () => {
    const left = await world({ spaces: [HOME, { ...SHOP, members: SHOP.members.filter((m) => m.id !== SAM) }] });
    expect(await left.acc.resolve(SAM, "leaf-co")).toBeNull();
    expect(await left.handlers.ofMember(SAM)).toHaveLength(2);
    const draft = await world({ spaces: [{ ...HOME, draft: true }, SHOP] });
    expect(await draft.acc.resolve(AANYA, "leaf-co")).toBeNull();
  });

  it("the admin's way in wins over addresses given to them", async () => {
    const { acc, handlers } = await world();
    await handlers.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 2, addressEmail: "support@leafandco.in", memberId: AANYA });
    expect((await acc.resolve(AANYA, "leaf-co"))?.access).toBe("admin");
  });

  it("is nobody's but the owner's while Spaces is off", async () => {
    vi.stubEnv("SPACES_ENABLED", "false");
    resetConfigForTests();
    const { acc } = await world();
    expect(await acc.resolve(AANYA, "leaf-co")).toBeNull();
    expect(await acc.resolve(SAM, "leaf-co")).toBeNull();
    expect(await acc.resolve(RAVI, "leaf-co")).toEqual({ ownerId: RAVI, access: "own" });
    expect(await acc.membersOf(RAVI)).toEqual([]);
  });

  it("a registry or a space that can't be read never opens anyone else's: the viewer's own, or nobody", async () => {
    const { handlers, people } = await world();
    const down: import("../src/mail/access.js").MailBusinesses = {
      async whose() { throw new Error("db down"); }, async keep() {}, async claim() {}, async owning() { return new Set<string>(); }, async forget() {},
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await access.mailAccess({ businesses: down, handlers, people }).resolve(SAM, "leaf-co")).toEqual({ ownerId: SAM, access: "own" });
    const businesses = new access.MemoryMailBusinesses();
    await businesses.keep("leaf-co", RAVI);
    const noSpaces = { async membersOf() { throw new Error("spaces down"); }, async adminsOf() { throw new Error("spaces down"); } };
    const acc = access.mailAccess({ businesses, handlers, people: noSpaces });
    expect(await acc.resolve(AANYA, "leaf-co")).toBeNull();
    expect(await acc.resolve(SAM, "leaf-co")).toBeNull();
    expect(await acc.adminsOf(SAM)).toEqual([]);
    warn.mockRestore();
  });
});
