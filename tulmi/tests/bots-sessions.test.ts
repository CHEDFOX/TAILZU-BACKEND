/**
 * SESSIONS, AND EVERY WORD KEPT (src/botsBots/sessions.ts, chat.ts; migration 0102):
 *
 *   - a session never closes: words said a month later carry on in the one last touched
 *   - a new one starts only when it is asked for (the + on the bot's page)
 *   - a session takes its name from the first words, and keeps the frame it is given
 *   - chat turns are no longer thrown away at 200: that is only how many are handed back
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.DEV_SKIP_AUTH = "true"; });

const { Sessions, nameFrom, GAP_MS, THREAD_KEEP } = await import("../src/botsBots/sessions.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
type SessionRow = import("../src/botsBots/sessions.js").SessionRow;

const rig = (start = 1_800_000_000_000) => {
  const clock = { t: start };
  const rows = new MemoryTable<SessionRow>();
  return { clock, rows, s: new Sessions(() => clock.t, rows) };
};

describe("a session", () => {
  it("takes its name from the first words, cut at a word", () => {
    expect(nameFrom('  “a 30 second ad for my chai stall”  ')).toBe("a 30 second ad for my chai stall");
    const long = nameFrom("a ".repeat(200));
    expect(long.length).toBeLessThanOrEqual(121);
    expect(long.endsWith("…")).toBe(true);
  });

  it("carries on in the one last touched, however long the silence", async () => {
    const { s, clock } = rig();
    const first = await s.current("u1", "cinema", "a chai ad");
    clock.t += 400 * 86_400_000;
    const later = await s.current("u1", "cinema", "something else");
    expect(later.id).toBe(first.id);
  });

  it("starts a new one only when it is asked for", async () => {
    const { s } = rig();
    const first = await s.current("u1", "cinema", "a chai ad");
    const second = await s.open("u1", "cinema", "a Diwali poster");
    expect(second.id).not.toBe(first.id);
    expect(second.title).toBe("a Diwali poster");
    // And the next word belongs to the new one, because it was touched last.
    expect((await s.current("u1", "cinema")).id).toBe(second.id);
  });

  it("is its own bot's, and its own person's", async () => {
    const { s } = rig();
    const mine = await s.current("u1", "cinema", "x");
    expect((await s.current("u1", "plan", "y")).id).not.toBe(mine.id);
    expect((await s.current("u2", "cinema", "z")).id).not.toBe(mine.id);
    expect(await s.get("u2", mine.id)).toBeNull();
  });

  it("is named by the first words only once, and keeps the frame it is given", async () => {
    const { s, clock } = rig();
    const one = await s.open("u1", "cinema");
    expect(one.title).toBe("");
    await s.touch("u1", one.id, "a 30s ad for my chai stall");
    expect((await s.get("u1", one.id))!.title).toBe("a 30s ad for my chai stall");
    clock.t += 1000;
    await s.touch("u1", one.id, "make it rain harder");
    expect((await s.get("u1", one.id))!.title).toBe("a 30s ad for my chai stall");
    await s.frame("u1", one.id, "u/u1/cinema/films/f1/still-2.png");
    expect((await s.get("u1", one.id))!.frame).toBe("u/u1/cinema/films/f1/still-2.png");
  });

  it("lists newest first, as the thread draws them", async () => {
    const { s, clock } = rig();
    const a = await s.open("u1", "cinema", "first");
    clock.t += 60_000;
    const b = await s.open("u1", "cinema", "second");
    expect((await s.list("u1", "cinema")).map((x) => x.id)).toEqual([b.id, a.id]);
    clock.t += 60_000;
    await s.touch("u1", a.id);
    expect((await s.list("u1", "cinema")).map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it("knows how long a silence has to be to be drawn as one, and how many the thread holds", () => {
    expect(GAP_MS).toBe(6 * 3_600_000);
    expect(THREAD_KEEP).toBe(45);
  });
});
