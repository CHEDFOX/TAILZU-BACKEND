/**
 * ADAPTIVE EFFORT (src/code/agent/effort.ts): a free-form turn that decides thinks at its tier's level, one that carries out a decision thinks "low".
 */
import { describe, expect, it } from "vitest";
import { effortLevel, feedbackMark, turnEffort, type TurnFacts } from "../src/code/agent/effort.js";

type Ex = TurnFacts["exchanges"][number];
const ex = (...calls: Array<[name: string, ok: boolean]>): Ex => ({ text: "", calls: calls.map(([name], i) => ({ id: `c${i}`, name, arguments: "{}" })), results: calls.map(([, ok]) => ({ ok, content: "" })) });
const facts = (exchanges: Ex[], o: Partial<TurnFacts> = {}): TurnFacts => ({ exchanges, freshFeedback: false, answered: false, said: false, ...o });
const effortOf = (exchanges: Ex[], o: Partial<TurnFacts> = {}) => turnEffort(facts(exchanges, o)).effort;

describe("which turns think hard", () => {
  it("every turn until the first edit that applied is HIGH: understanding the task (and a question, which never edits, is HIGH throughout)", () => {
    expect(effortOf([])).toBe("high");
    expect(effortOf([ex(["search_code", true])])).toBe("high");
    expect(effortOf([ex(["read_file", true]), ex(["grep", true]), ex(["run", true]), ex(["read_file", true])])).toBe("high");
    // An edit that did not apply is not a decision carried out yet.
    expect(effortOf([ex(["read_file", true]), ex(["edit_file", false])])).toBe("high");
  });

  it("after the first edit, reading, searching, listing and applying edits are LOW", () => {
    const edited = ex(["edit_file", true]);
    expect(effortOf([ex(["read_file", true]), edited])).toBe("low");
    expect(effortOf([edited, ex(["read_file", true], ["grep", true])])).toBe("low");
    expect(effortOf([edited, ex(["list_dir", true])])).toBe("low");
    expect(effortOf([edited, ex(["write_file", true], ["delete_file", true])])).toBe("low");
    // One edit that did not apply is re-read and re-applied: still mechanical. Twice in a row, it is rethought.
    expect(effortOf([edited, ex(["edit_file", false])])).toBe("low");
    expect(effortOf([edited, ex(["edit_file", false]), ex(["edit_file", false])])).toBe("high");
  });

  it("is HIGH after a failed command, for the review once a command passes with edits staged, and when the model wrote words and no tool", () => {
    const edited = ex(["edit_file", true]);
    expect(effortOf([edited, ex(["run", false])])).toBe("high");
    expect(effortOf([edited, ex(["done", false])])).toBe("high");
    expect(effortOf([edited, ex(["run", true])])).toBe("high");
    expect(effortOf([edited, { text: "I think it is done.", calls: [], results: [] }])).toBe("high");
  });

  it("is HIGH when a check, a test request or a finding comes back, when the person answered, and when they said something new", () => {
    const after = [ex(["edit_file", true]), ex(["read_file", true])];
    expect(effortOf(after)).toBe("low");
    expect(effortOf(after, { freshFeedback: true })).toBe("high");
    expect(effortOf(after, { answered: true })).toBe("high");
    expect(effortOf(after, { said: true })).toBe("high");
    expect(turnEffort(facts(after, { answered: true })).why).toMatch(/answered/);
  });

  it("lowers only: a LOW turn on a thinking tier is 'low', the tier's level otherwise, and a tier that does not think stays off", () => {
    expect(effortLevel("medium", "low")).toBe("low");
    expect(effortLevel("high", "low")).toBe("low");
    expect(effortLevel("medium", "high")).toBe("medium");
    expect(effortLevel("none", "low")).toBe("none");
    expect(effortLevel("low", "low")).toBe("low");
    expect(feedbackMark("")).toBe("");
    expect(feedbackMark("tests failed")).not.toBe(feedbackMark("lint failed"));
  });
});
