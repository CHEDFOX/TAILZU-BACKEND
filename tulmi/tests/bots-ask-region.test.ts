/**
 * Ask speaks to where the person is: "any language works" and global examples for everyone, "Hinglish works" and
 * Indian examples for someone in India (by time zone, as the pay page tells its markets apart).
 */
import { describe, expect, it } from "vitest";
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { IST, fakeDeps } from "../src/experience/bots/fixtures.js";
import { walk } from "../src/experience/bots/lint.js";

const texts = async (tz: number) => {
  const s = await buildBotsScreen({
    screenId: "bots.ask", client: "phone", tzOffsetMinutes: tz, user: { id: "11111111-2222-3333-4444-555555555555", name: "Maya", email: "maya@example.com" },
    can: new Set(["BotsKit"]), desk: { pages: false, notes: false },
  }, fakeDeps());
  return walk(s.root as never).map((n) => String((n as { props?: { content?: unknown } }).props?.content ?? "")).join(" | ");
};

describe("Ask by region", () => {
  it("everyone else: any language, global examples", async () => {
    const t = await texts(0);
    expect(t).toContain("any language works");
    expect(t).not.toContain("Hinglish");
    expect(t).not.toMatch(/Goa|Mummy/);
  });
  it("India: Hinglish, Indian examples", async () => {
    const t = await texts(IST);
    expect(t).toContain("Hinglish works");
  });
});
