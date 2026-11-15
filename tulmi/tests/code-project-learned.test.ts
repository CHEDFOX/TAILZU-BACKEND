/**
 * WHAT EARLIER WORK LEARNED HERE (src/code/project/learned.ts), and how it reaches the book. What these hold down:
 *   - a candidate is cleaned: a chapter these facts may use, words that say something, and nothing phrased as an order;
 *   - one job's sighting is a guess; a SECOND JOB seeing the same thing makes it found; the same job twice proves nothing;
 *   - the owner's word is confirmed from the start, outranks anything inferred, and is never aged out;
 *   - a fact dies: an old guess nobody saw again, one about files the project no longer has, and the weakest past the cap;
 *   - the book carries them as ordinary facts with the source "earlier work here", and a JOB is shown them with how sure they are;
 *   - a fact is never an instruction: the words it reaches a job with say it is something found, not something to obey.
 */
import { describe, expect, it } from "vitest";
import {
  GUESS_LIFE_MS, LEARNED_MAX, cleanCandidate, factsOf, learn, ownerSays, prune, sameFact, type Candidate, type LearnedFact,
} from "../src/code/project/learned.js";
import { bookForJobs, bookMarkdown, LEARNED_SHOWN, type ProjectBook } from "../src/code/project/book.js";

const NOW = 1_700_000_000_000;
const fact = (over: Partial<LearnedFact> = {}): LearnedFact => ({
  chapter: "run", text: "the suite needs postgres up first, started by docker compose up db", job: "job-1",
  status: "guessed", at: NOW, seenAt: NOW, seen: 1, ...over,
});

describe("a candidate", () => {
  const ok: Candidate = { chapter: "run", text: "the test suite needs docker compose up db before it will pass" };

  it("is kept when it names a chapter these facts may use", () => {
    expect(cleanCandidate(ok)?.chapter).toBe("run");
    expect(cleanCandidate({ ...ok, chapter: "state" })).not.toBeNull();
    expect(cleanCandidate({ ...ok, chapter: "rules" })).not.toBeNull();
  });

  it("is refused for a chapter that is the repository's to fill, so the work cannot write the project's history", () => {
    for (const chapter of ["what", "build", "recent", "why", "direction", "nonsense"]) {
      expect(cleanCandidate({ ...ok, chapter }), chapter).toBeNull();
    }
  });

  it("is refused when it says nothing, or when it is an order rather than something true here", () => {
    expect(cleanCandidate({ ...ok, text: "it broke" })).toBeNull();
    for (const text of [
      "always run the tests before committing anything at all",
      "never edit the generated files in this project ever",
      "you must use the shared client for every request",
      "make sure the database is running before the suite",
      "remember to update the changelog with each change",
    ]) expect(cleanCandidate({ ...ok, text }), text).toBeNull();
  });

  it("is cut to one line, and keeps at most a few paths", () => {
    const long = cleanCandidate({ ...ok, text: `${"x".repeat(400)}\n\nmore`, paths: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] })!;
    expect(long.text.length).toBeLessThanOrEqual(280);
    expect(long.text).not.toContain("\n");
    expect(long.paths).toHaveLength(4);
  });
});

describe("learning", () => {
  const c: Candidate = { chapter: "run", text: "the suite needs postgres up first, started by docker compose up db" };

  it("keeps a new thing as a guess, said by the job that found it", () => {
    const out = learn([], [c], { job: "job-1", now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "guessed", seen: 1, job: "job-1" });
  });

  it("makes it found when a SECOND job sees the same thing, however it is worded", () => {
    const first = learn([], [c], { job: "job-1", now: NOW });
    const again = learn(first, [{ ...c, text: "The suite needs Postgres up first — started by: docker compose up db." }], { job: "job-2", now: NOW + 1000 });
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ status: "found", seen: 2 });
    expect(again[0]!.seenAt).toBe(NOW + 1000);
  });

  it("is not moved by the same job saying it twice: one job's own repetition proves nothing", () => {
    const first = learn([], [c], { job: "job-1", now: NOW });
    const again = learn(first, [c], { job: "job-1", now: NOW + 1000 });
    expect(again[0]).toMatchObject({ status: "guessed", seen: 1 });
  });

  it("takes the owner's word as confirmed from the start, and lets it outrank what was only inferred", () => {
    const owned = learn([], [{ ...c, owner: true }], { job: "job-1", now: NOW });
    expect(owned[0]!.status).toBe("confirmed");
    const guessedFirst = learn([], [c], { job: "job-1", now: NOW });
    const thenOwner = learn(guessedFirst, [{ ...c, owner: true }], { job: "job-2", now: NOW + 1 });
    expect(thenOwner[0]!.status).toBe("confirmed");
  });

  it("drops what cannot be used and keeps what can, in one go", () => {
    const out = learn([], [c, { chapter: "what", text: "this project is a shop for cats and dogs" }, { chapter: "run", text: "no" }], { job: "job-1", now: NOW });
    expect(out).toHaveLength(1);
  });
});

describe("a fact dying", () => {
  it("is an old guess no second job ever saw", () => {
    const old = fact({ seenAt: NOW - GUESS_LIFE_MS - 1 });
    expect(prune([old], { now: NOW })).toEqual([]);
    expect(prune([fact({ seenAt: NOW - 1000 })], { now: NOW })).toHaveLength(1);
  });

  it("is not something found twice, nor anything the owner confirmed, however old", () => {
    const found = fact({ status: "found", seen: 2, seenAt: NOW - GUESS_LIFE_MS * 3 });
    const owned = fact({ status: "confirmed", seenAt: NOW - GUESS_LIFE_MS * 10 });
    expect(prune([found, owned], { now: NOW })).toHaveLength(2);
  });

  it("is a fact about files the project no longer has, when the files are known", () => {
    const about = fact({ paths: ["src/gone.ts"] });
    expect(prune([about], { now: NOW, paths: new Set(["src/here.ts"]) })).toEqual([]);
    expect(prune([about], { now: NOW, paths: new Set(["src/gone.ts"]) })).toHaveLength(1);
    // One of its files still there is enough: the fact has somewhere to be about.
    expect(prune([fact({ paths: ["src/gone.ts", "src/here.ts"] })], { now: NOW, paths: new Set(["src/here.ts"]) })).toHaveLength(1);
    // Not checked at all when the file list is unknown, so a build that could not list them forgets nothing.
    expect(prune([about], { now: NOW })).toHaveLength(1);
  });

  it("is the weakest, once a project is at the cap", () => {
    const many = Array.from({ length: LEARNED_MAX + 5 }, (_, i) => fact({ text: `a thing number ${i} that is long enough to keep`, status: i < 3 ? "found" : "guessed", seen: i < 3 ? 2 : 1 }));
    const out = prune(many, { now: NOW });
    expect(out).toHaveLength(LEARNED_MAX);
    // What survived leads with what is surest.
    expect(out.slice(0, 3).every((f) => f.status === "found")).toBe(true);
  });
});

describe("the owner's word on one", () => {
  it("confirms it, or forgets it", () => {
    const kept = [fact(), fact({ text: "another thing that is quite long enough" })];
    expect(ownerSays(kept, kept[0]!.text, "confirm", NOW + 5)[0]).toMatchObject({ status: "confirmed" });
    const left = ownerSays(kept, kept[0]!.text, "forget", NOW + 5);
    expect(left).toHaveLength(1);
    expect(left[0]!.text).toBe(kept[1]!.text);
  });

  it("matches the fact however they typed it back", () => {
    const kept = [fact()];
    expect(ownerSays(kept, `  ${fact().text.toUpperCase()}.  `, "forget", NOW)).toEqual([]);
    expect(sameFact("A thing, here!", "a thing here")).toBe(true);
    expect(sameFact("a thing here", "another thing here")).toBe(false);
  });
});

describe("how they reach the book and a job", () => {
  const book = (facts: LearnedFact[]): ProjectBook => ({
    version: 1, project: "u/app", commit: "a".repeat(40), builtAt: NOW, gaps: [], questions: [], facts: factsOf(facts),
  });

  it("are ordinary facts of the book, sourced to the work and not to the repository", () => {
    const b = book([fact()]);
    expect(b.facts[0]).toMatchObject({ chapter: "run", source: { kind: "job", ref: "job-1" }, status: "guessed" });
    expect(bookMarkdown(b)).toContain("earlier work here");
    // A guess is marked as one for the person reading, as every other guess in the book is.
    expect(bookMarkdown(b)).toMatch(/~ the suite needs postgres/);
  });

  it("reach a job with how sure they are, and as something found rather than something to obey", () => {
    const text = bookForJobs(book([fact(), fact({ text: "the lint step needs node 22, not 20, or it crashes", status: "found", seen: 2 })]));
    expect(text).toContain("## What earlier work here learned");
    expect(text).toContain("(one job found this; check it) the suite needs postgres");
    // Found twice: no hedge, and still no imperative.
    expect(text).toContain("- the lint step needs node 22");
    expect(text).not.toMatch(/you must|always |never /i);
  });

  it("show the owner's own as theirs, and stop at a handful", () => {
    expect(bookForJobs(book([fact({ status: "confirmed" })]))).toContain("(the owner) the suite needs postgres");
    const many = Array.from({ length: LEARNED_SHOWN + 4 }, (_, i) => fact({ text: `a learned thing number ${i} long enough to keep` }));
    const lines = bookForJobs(book(many)).split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(LEARNED_SHOWN);
  });

  it("are nothing at all when nothing has been learned: no heading, no empty section", () => {
    expect(bookForJobs(book([]))).not.toContain("earlier work");
  });
});
