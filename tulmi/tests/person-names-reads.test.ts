/**
 * THE NAME YOU GIVE SOMEONE, WHERE IT IS ACTUALLY READ (docs/social.md §2; src/botsBots/personNames.ts).
 *
 * The unit rules are in person-names.test.ts. This is the half that matters: that a name a person gave reaches every read that
 * shows a name, that it is THEIRS alone, and that it never displaces the name a row carries for its own reasons — a deleted
 * account's name is read back off `sender_name`, and nothing here may break that.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.SPACES_ENABLED = "true";
  process.env.NODE_ENV = "test";
});

const pushes = vi.hoisted(() => [] as Array<{ userId: string; kind: string; vars: Record<string, string>; data: Record<string, string> }>);
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  const { signedIn } = await import("./spaces-rig.js");
  return { ...real, resolveUser: async (h: string | undefined) => signedIn(h) };
});
vi.mock("../src/push/index.js", () => ({ pushEngine: () => ({ notify: async () => null }) }));

const { A_, M_, R_, AREA, spacesServer } = await import("./spaces-rig.js");

type S = Awaited<ReturnType<typeof spacesServer>>;
const name = (s: S, who: string, subject: string, n: string) => s.call("PUT", `${AREA}/people/${subject}/name`, who, { name: n });

describe("a name a person gave, in the reads that show a name", () => {
  it("names a space's members for the one who gave them, and for nobody else", async () => {
    const s = await spacesServer({ pushes });
    const id = await s.family();
    expect((await name(s, A_, M_, "Amma")).status).toBe(200);

    const members = async (who: string) =>
      ((await s.call("GET", `${AREA}/spaces/${id}`, who)).body.space.members as Array<{ userId: string; name: string }>)
        .map((m) => `${m.userId === who ? "(you)" : m.name}`).sort();

    // Aanya called her Mom. Rohan is in the same space and still sees the name her member row carries.
    expect(await members(A_)).toContain("Amma");
    // Rohan is in the same space and still reads the name her member row carries.
    expect(await members(R_)).not.toContain("Amma");
    expect(await members(R_)).toContain("Mom");
  });

  it("names the people you can message, and the groups you can start one in", async () => {
    const s = await spacesServer({ pushes });
    await s.family();
    await name(s, A_, M_, "Amma");
    const contacts = await s.call("GET", `${AREA}/threads/contacts`, A_);
    const people = (contacts.body.people as Array<{ userId: string; name: string }>);
    expect(people.find((p) => p.userId === M_)?.name).toBe("Amma");
    // The same name inside the groups you could start a chat in, so one screen never shows two names for one person.
    const inGroups = (contacts.body.groupSpaces as Array<{ people: Array<{ userId: string; name: string }> }>)
      .flatMap((g) => g.people).find((p) => p.userId === M_);
    expect(inGroups?.name).toBe("Amma");
  });

  it("is a one-to-one chat's own name, because that chat's name IS the other person", async () => {
    const s = await spacesServer({ pushes });
    await s.family();
    await name(s, A_, M_, "Amma");
    const { id } = (await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).body;
    expect((await s.call("GET", `${AREA}/threads/${id}`, A_)).body.thread.name).toBe("Amma");
    // Mom never gave Aanya a name, so her side reads the name Aanya's row carries.
    expect((await s.call("GET", `${AREA}/threads/${id}`, M_)).body.thread.name).toBe("Aanya S.");
  });

  it("is the name over every message of theirs, for the reader who gave it", async () => {
    const s = await spacesServer({ pushes });
    const id = await s.family();
    await s.call("POST", `${AREA}/spaces/${id}/feed`, M_, { text: "Dinner at 8?" });
    await name(s, A_, M_, "Amma");
    const from = async (who: string) =>
      ((await s.call("GET", `${AREA}/spaces/${id}/feed`, who)).body.messages as Array<{ from: { userId: string; name: string } }>)
        .find((m) => m.from.userId === M_)?.from.name;
    expect(await from(A_)).toBe("Amma");
    expect(await from(R_)).toBe("Mom");
  });

  it("a name taken off goes back to the one the row carries, everywhere at once", async () => {
    const s = await spacesServer({ pushes });
    const id = await s.family();
    await name(s, A_, M_, "Amma");
    const seen = async () => ((await s.call("GET", `${AREA}/spaces/${id}`, A_)).body.space.members as Array<{ userId: string; name: string }>)
      .find((m) => m.userId === M_)?.name;
    expect(await seen()).toBe("Amma");
    expect((await name(s, A_, M_, "")).body).toEqual({ name: "" });
    expect(await seen()).toBe("Mom");
  });

  it("stands in the chats list's own last line too, so one row never shows two names for one person", async () => {
    const s = await spacesServer({ pushes });
    const id = await s.family();
    await s.call("POST", `${AREA}/spaces/${id}/feed`, M_, { text: "Dinner at 8?" });
    await name(s, A_, M_, "Amma");
    const row = async (who: string) => ((await s.call("GET", `${AREA}/threads`, who)).body.threads as Array<{ spaceId: string | null; last: { text: string } | null }>)
      .find((t) => t.spaceId === id)?.last?.text;
    // last_text is stored as "Mom: Dinner at 8?" — the name baked in when it was written. Aanya reads her own name in it.
    expect(await row(A_)).toBe("Amma: Dinner at 8?");
    expect(await row(R_)).toBe("Mom: Dinner at 8?");
  });

  it("nobody names themselves, and a name is screened like every other", async () => {
    const s = await spacesServer({ pushes });
    await s.family();
    expect((await name(s, A_, A_, "Me")).status).toBe(400);
  });
});
