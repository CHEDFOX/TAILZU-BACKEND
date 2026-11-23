/**
 * ASK FOR WORDS, ASK LIKE A CHAT (agent/grammar.ts wantsWords, agent/lines.ts splitSay, run.ts's SAY continuation). Asked for a poem,
 * Ask put it into a document's Title field; a book's summary was cut off at its 240th character; a poem written as one SAY and three
 * plain lines came out as its first line.
 */
import { describe, expect, it } from "vitest";
import { wantsWords, modeOf } from "../src/agent/grammar.js";
import { splitSay } from "../src/agent/lines.js";

describe("words asked for are the answer, not a task", () => {
  it("a poem, a story, names, ideas — with no place named", () => {
    for (const s of ["write me a short poem about rain", "make up a story about a dragon", "give me three names for a cat", "come up with ideas for a birthday", "tell me a joke"]) {
      expect(wantsWords(s), s).toBe(true);
    }
  });
  it("a place named keeps it a task: they said where it goes", () => {
    for (const s of ["write a poem about rain here", "write a summary into the doc", "write a poem in this box"]) expect(wantsWords(s), s).toBe(false);
  });
  it("things that are sent are tasks: an email, a message, a reply", () => {
    for (const s of ["write an email to Priya", "draft a message to the team", "compose a reply"]) expect(wantsWords(s), s).toBe(false);
  });
  it("the grammar's own split is unchanged for everything else", () => {
    expect(modeOf("save this")).toBe("do");
    expect(modeOf("where is export?")).toBe("show");
  });
});

describe("a long SAY is cut at its sentences, never mid-word", () => {
  it("short ones are left alone", () => {
    expect(splitSay("SAY Canberra is the capital of Australia.")).toEqual(["SAY Canberra is the capital of Australia."]);
    expect(splitSay("POINT e4 | Export")).toEqual(["POINT e4 | Export"]);
  });
  it("a paragraph becomes sentences, each within the limit, nothing lost", () => {
    const para = Array.from({ length: 8 }, (_, i) => `This is sentence number ${i + 1} of a long answer about a book.`).join(" ");
    const out = splitSay(`SAY ${para}`);
    expect(out.length).toBeGreaterThan(1);
    for (const l of out) { expect(l.startsWith("SAY ")).toBe(true); expect(l.length - 4).toBeLessThanOrEqual(240); }
    expect(out.map((l) => l.slice(4)).join(" ")).toBe(para);
  });
  it("one sentence longer than the limit is cut at a space", () => {
    const long = Array.from({ length: 60 }, () => "word").join(" ");
    const out = splitSay(`SAY ${long}`);
    for (const l of out) expect(l.endsWith("wor")).toBe(false);
    expect(out.map((l) => l.slice(4)).join(" ")).toBe(long);
  });
});
