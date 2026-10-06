import { describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

/**
 * A usage table of 2,500 rows behind a PostgREST that, like Supabase, never
 * returns more than 1,000 rows to one select. 1,800 of them are this month.
 */
const now = Date.now();
const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
const ROWS = Array.from({ length: 2500 }, (_, i) => ({
  id: i + 1,
  audio_seconds: 1,
  word_count: 2,
  // The first 700 are before this month, the rest inside it.
  created_at: new Date(i < 700 ? monthStart - 86_400_000 * 3 : Math.min(now - 1000, monthStart + 1000 + i)).toISOString(),
}));

function fakeTable() {
  let rows = ROWS.slice();
  let lo = 0, hi = 999;
  const q: any = {
    select: () => q,
    eq: () => q,
    gte: (_c: string, iso: string) => { rows = rows.filter((r) => r.created_at >= iso); return q; },
    order: () => q,
    range: (a: number, b: number) => { lo = a; hi = b; return q; },
    then: (ok: (v: unknown) => unknown) => {
      const page = rows.slice(lo, Math.min(hi + 1, lo + 1000));
      return Promise.resolve({ data: page, error: null }).then(ok);
    },
  };
  return q;
}

vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  dataClientFor: () => ({ from: () => fakeTable() }),
}));

// eslint-disable-next-line import/first
import { allowanceFor, usageSummary } from "../src/usage/metering.js";

describe("reading the meter past a thousand rows", () => {
  const user = { id: "u-paging", email: "p@b.c" } as never;

  it("sums the whole month, and the whole history, not the first thousand rows", async () => {
    const s = await usageSummary(user, 330);
    expect(s.month.requests).toBe(1800);
    expect(s.month.words).toBe(3600);
    expect(s.total.requests).toBe(2500);
  });

  it("agrees with the allowance's own count of the month", async () => {
    const [s, a] = await Promise.all([usageSummary(user), allowanceFor(user)]);
    expect(a?.used).toBe(s.month.words);
  });
});
