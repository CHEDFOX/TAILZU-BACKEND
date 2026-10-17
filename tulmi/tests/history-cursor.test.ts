/**
 * The history list's paging cursor, as the database writes it.
 *
 * PostgREST returns timestamptz as "…+00:00"; the route validates `before`
 * with z.string().datetime(), which takes only "Z". Every nextBefore the list
 * handed out was therefore refused as the next page's cursor.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

const rows = [0, 1, 2].map((i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, kind: "voice", input: "a", output: "b",
  created_at: `2026-09-30T10:00:0${3 - i}.123456+00:00`,
}));
let dataset: Array<Record<string, unknown>> = rows;
/** A query builder that answers every chained call with itself and resolves
 *  to the dataset — capped at 1000 rows unless ranged, as PostgREST is. */
function builder(): unknown {
  let range: [number, number] | null = null;
  let limit = Infinity;
  const b: unknown = new Proxy({}, {
    get: (_t, k) => {
      if (k === "then") {
        return (ok: (v: unknown) => void) => ok({
          data: range ? dataset.slice(range[0], range[1] + 1) : dataset.slice(0, Math.min(limit, 1000)),
          error: null,
        });
      }
      if (k === "range") return (a: number, z: number) => { range = [a, z]; return b; };
      if (k === "limit") return (n: number) => { limit = n; return b; };
      return () => b;
    },
  });
  return b;
}
vi.mock("../src/auth/supabase.js", () => ({ dataClientFor: () => ({ from: () => builder() }) }));

const { listHistory, statsForUser } = await import("../src/history/store.js");

describe("the history cursor", () => {
  it("is one the route accepts back, with its microseconds", async () => {
    const page = await listHistory({ id: "u1" } as never, { limit: 2 });
    expect(page.nextBefore).toBe("2026-09-30T10:00:02.123456Z");
    expect(z.string().datetime().safeParse(page.nextBefore).success).toBe(true);
    expect(page.entries[0]!.createdAt).toBe("2026-09-30T10:00:03.123456Z");
  });
});

describe("stats over a long history", () => {
  it("counts every row, not the first page the database hands back", async () => {
    const now = Date.now();
    dataset = Array.from({ length: 2_500 }, (_, i) => ({
      created_at: new Date(now - i * 60_000).toISOString(), words_out: 2, kind: "typing", output: "hi there",
    }));
    const stats = await statsForUser({ id: "u2" } as never, "all");
    expect(stats.requests).toBe(2_500);
    expect(stats.wordsOut).toBe(5_000);
    dataset = rows;
  });
});
