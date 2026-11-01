import { describe, expect, it } from "vitest";
import { casesOf } from "../scripts/xode-cases.js";

describe("real chats into cases (scripts/xode-cases.ts)", () => {
  it("lists each marked turn with the turns before it and the message after it, left for a person to label", () => {
    const history = [
      { q: "what is this?", a: "A shop." },
      { q: "where is login?", a: "In src/auth.ts." },
      { q: "where is the daily limit message?", a: "I could not find it.", f: "reaction" as const },
      { q: "??", a: "It is in src/limits.ts:12." },
    ];
    const cases = casesOf("abcdef12-0000-4000-8000-000000000000", "alice/shop", history);
    expect(cases).toEqual([{
      id: "real-abcdef12-2", repo: "alice/shop", before: ["what is this?", "where is login?"], say: "where is the daily limit message?",
      did: "?", says: [], flag: "reaction", missed: "I could not find it.", then: "??",
    }]);
    expect(casesOf("abcdef12-0000-4000-8000-000000000000", "alice/shop", history.slice(0, 2))).toEqual([]);
  });
});
