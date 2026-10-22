/**
 * Apps held back for testers while their vendor reviews them
 * (CONNECTORS_TESTER_ONLY_IDS / CONNECTORS_TESTERS).
 */
import { describe, expect, it } from "vitest";
import { mayConnect } from "../src/connectors/list.js";

const cfg = (only: string, testers: string) =>
  ({ CONNECTORS_TESTER_ONLY_IDS: only, CONNECTORS_TESTERS: testers }) as Parameters<typeof mayConnect>[2];

describe("apps held back for testers", () => {
  it("shows every app to everyone when nothing is held back", () => {
    expect(mayConnect("google-calendar", undefined, cfg("", ""))).toBe(true);
    expect(mayConnect("google-calendar", "a@b.com", cfg("", "x@y.com"))).toBe(true);
  });
  it("shows a held-back app only to a tester, by email without case", () => {
    const c = cfg("google-calendar, google-tasks", " Owner@Tailzu.space ,qa@tailzu.space");
    expect(mayConnect("google-calendar", "owner@tailzu.space", c)).toBe(true);
    expect(mayConnect("Google-Tasks", "QA@tailzu.space", c)).toBe(true);
    expect(mayConnect("google-calendar", "someone@gmail.com", c)).toBe(false);
    expect(mayConnect("google-calendar", undefined, c)).toBe(false);
  });
  it("leaves the apps that are not held back alone", () => {
    const c = cfg("google-calendar", "owner@tailzu.space");
    expect(mayConnect("google-docs", "someone@gmail.com", c)).toBe(true);
    expect(mayConnect("notion", undefined, c)).toBe(true);
  });
});
