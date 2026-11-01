/**
 * THE PROJECT BOOK (src/code/project/book.ts): what the project is, how it stands, what changed, why, and where it is heading, as facts with their
 * sources; what is not known said as a gap; the owner asked, and their words kept as confirmed; the few facts a chat or a job needs.
 */
import { describe, expect, it } from "vitest";
import { bookBrief, bookForJobs, bookMarkdown, buildBook, cleanAnswers, planLines, reasonsIn, type BookInput } from "../src/code/project/book.js";
import { SupabaseProjectBrainStore } from "../src/code/project/store.js";
import { fakeSupabase, fixtureBrain } from "./work-fixtures.js";

const NOW = Date.UTC(2026, 10, 1);
const DAY = 86_400_000;
const file = (path: string, o: { tests?: string[]; hot?: number; todo?: number; summary?: string } = {}) => ({
  path, blobSha: "c".repeat(40), lang: "TypeScript", bytes: 100, symbols: [], imports: [], rank: 0.1, hot: o.hot ?? 0, todo: o.todo ?? 0, tests: o.tests ?? [], summary: o.summary ?? "",
});

function input(over: Partial<BookInput> = {}): BookInput {
  return {
    project: "alice/shop", commit: "f".repeat(40), now: NOW,
    view: {
      welcome: "A small online shop for handmade goods. It has a cart and a checkout.",
      structure: { languages: [{ lang: "TypeScript", pct: 91 }], fileCount: 120, frameworks: ["Next.js"], monorepo: null, entryPoints: [{ path: "src/app/page.tsx", why: "Next.js page" }], ci: ["GitHub Actions"] } as never,
      features: [{ name: "Checkout", summary: "Takes payment with Stripe and sends a receipt.", files: [], fileCount: 4, routes: [], texts: [] }] as never,
      conventions: { formatter: ["prettier"], linter: ["eslint"], rules: [{ path: "CONTRIBUTING.md", text: "Every change comes with a test." }] } as never,
      baseline: { recorded: { headSha: "e".repeat(40), at: NOW - DAY, healthy: false, results: [{ kind: "test", exitCode: 0, durationMs: 1, summary: "" }, { kind: "lint", exitCode: 1, durationMs: 1, summary: "", failing: ["src/cart.ts: no-unused-vars"] }] } } as never,
    },
    files: [file("src/cart.ts", { hot: 6, todo: 3 }), file("src/checkout.ts", { tests: ["src/checkout.test.ts"], hot: 2 }), file("src/old/legacy.ts"), file("docs/adr/0001-use-stripe.md", { summary: "Stripe over PayPal for India." }) as never],
    map: null,
    commits: [
      { sha: "1".repeat(40), message: "fix(cart): keep the coupon after a refresh", at: NOW - 2 * DAY },
      { sha: "2".repeat(40), message: "feat: wishlist", at: NOW - 5 * DAY },
      { sha: "3".repeat(40), message: "chore: move to pnpm because npm installs were slow in CI", at: NOW - 10 * DAY },
      { sha: "4".repeat(40), message: "feat: first release", at: NOW - 90 * DAY },
    ],
    history: [{ sha: "1".repeat(40), at: NOW - 2 * DAY, files: ["src/cart/coupon.ts", "src/cart/index.ts"] }, { sha: "2".repeat(40), at: NOW - 5 * DAY, files: ["src/wishlist/list.ts"] }],
    merged: [{ number: 41, title: "Keep the coupon", body: "We store it in the session instead of local storage, so that it survives a refresh on another tab.", draft: false, labels: [], at: NOW - 2 * DAY, url: "u41", author: "a" }],
    open: [{ number: 43, title: "Gift cards", body: "", draft: true, labels: [], at: NOW - DAY, url: "u43", author: "a" }],
    issues: [
      { number: 7, title: "Checkout fails on Safari", body: "", labels: ["bug"], milestone: null, comments: 9, updatedAt: NOW - DAY, url: "u7" },
      { number: 9, title: "Wishlist sharing", body: "", labels: ["enhancement"], milestone: "v2", comments: 2, updatedAt: NOW - 3 * DAY, url: "u9" },
    ],
    milestones: [{ title: "v2", description: "Wishlists and gift cards.", open: 3, closed: 5, dueOn: NOW + 20 * DAY, url: "um" }],
    docs: { "ROADMAP.md": "# Roadmap\n\n- [x] Cart\n- [ ] Gift cards\n- [ ] Multi-currency\n" },
    owner: null,
    ...over,
  };
}

describe("the book", () => {
  it("holds every chapter as facts with their sources, and says what it cannot know", () => {
    const b = buildBook(input());
    const of = (c: string) => b.facts.filter((f) => f.chapter === c).map((f) => f.text);
    expect(of("what")).toEqual(["A small online shop for handmade goods. It has a cart and a checkout.", "Checkout: Takes payment with Stripe and sends a receipt."]);
    expect(of("build")).toContain("Written in TypeScript 91%, 120 files.");
    expect(of("state")).toEqual(expect.arrayContaining([
      "test: passes.", "lint: fails (1 failure, the first: src/cart.ts: no-unused-vars).", "1 of 3 source files have a test that imports them (33%).",
      "src/cart.ts changed 6 times lately and no test covers it.", "3 TODOs and FIXMEs in the code, most in src/cart.ts (3).",
    ]));
    expect(of("recent")).toEqual(expect.arrayContaining([
      "Last change 2026-10-30: fix(cart): keep the coupon after a refresh", "3 commits in the last 30 days: 1 fixes, 1 features, 1 chores.",
      "Most work in src/cart (1 commit), src/wishlist (1 commit).", "Merged #41 2026-10-30: Keep the coupon",
    ]));
    expect(of("why")).toEqual(expect.arrayContaining([
      "Decision record: docs/adr/0001-use-stripe.md, Stripe over PayPal for India.",
      "#41 (Keep the coupon): We store it in the session instead of local storage, so that it survives a refresh on another tab.",
      "chore: move to pnpm because npm installs were slow in CI",
    ]));
    expect(of("direction")).toEqual(expect.arrayContaining([
      "Milestone \"v2\": 5 of 8 done, due 2026-11-21. Wishlists and gift cards.", "Done: Cart", "Planned: Gift cards", "Planned: Multi-currency",
      "In flight: #43 Gift cards (draft)", "2 open issues: 1 bug, 1 feature request.", "#7 Checkout fails on Safari [bug], 9 comments",
    ]));
    expect(of("rules")).toEqual(["Formatted with prettier; linted with eslint.", "CONTRIBUTING.md: Every change comes with a test."]);
    const checks = b.facts.find((f) => f.text === "test: passes.")!;
    expect(checks.source).toEqual({ kind: "check", ref: "test at eeeeeee" });
    expect(b.facts.find((f) => f.text.startsWith("#7 "))!.source).toEqual({ kind: "issue", ref: "#7", url: "u7" });
    expect(b.questions.map((q) => q.id)).toEqual(["for", "next", "keep"]);
    expect(b.gaps).toEqual([]);
  });

  it("says plainly what it could not read, and asks the owner when nothing says where the project is going", () => {
    const b = buildBook(input({ commits: null, merged: null, open: null, issues: null, milestones: null, docs: {}, files: [], view: { ...input().view, baseline: null } }));
    expect(b.gaps).toEqual([
      "How it stands: the project's own checks have not been run yet (they run before the first change).",
      "What changed lately: the history could not be read.",
      "Why it is this way: no decision records, and no reasons in the recent pull requests and commits.",
      "Where it is heading: the issues could not be read (the GitHub App may not be allowed to read them).",
      "Where it is heading: no milestones or roadmap file, so this rests on open pull requests and issues until the owner says.",
    ]);
  });

  it("keeps the owner's words as confirmed, first, and stops asking what they answered", () => {
    const owner = cleanAnswers({ for: "Small Indian craft sellers <b>", next: "Gift cards, then UPI", keep: "" }, NOW, null)!;
    expect(owner).toEqual({ for: "Small Indian craft sellers b", next: "Gift cards, then UPI", at: NOW });
    const b = buildBook(input({ owner }));
    expect(b.facts.filter((f) => f.status === "confirmed").map((f) => [f.chapter, f.text])).toEqual([
      ["what", "Small Indian craft sellers b"], ["direction", "Next, in the owner's words: Gift cards, then UPI"],
    ]);
    expect(b.questions.map((q) => q.id)).toEqual(["keep"]);
    expect(cleanAnswers({ keep: "The public API of src/api" }, NOW + 1, owner)).toEqual({ ...owner, keep: "The public API of src/api", at: NOW + 1 });
    expect(cleanAnswers({ nothing: 1 }, NOW, null)).toBeNull();
  });
});

describe("reading plans and reasons", () => {
  it("takes the bullets of a roadmap file, or of a README heading about what is next", () => {
    expect(planLines("README.md", "# Shop\n\n- not a plan\n\n## Roadmap\n\n- Gift cards\n1. UPI\n\n## Install\n\n- npm i\n")).toEqual(["Planned: Gift cards", "Planned: UPI"]);
    expect(planLines("docs/ROADMAP.md", "- [x] Cart\n* [ ] Gift cards\n")).toEqual(["Done: Cart", "Planned: Gift cards"]);
  });

  it("finds the sentences that give a reason, and nothing else", () => {
    expect(reasonsIn("## Summary\nAdds caching.\n\nWe moved to Redis because the in-memory cache was lost on every deploy.\n```js\nbecause = 1\n```")).toEqual([
      "We moved to Redis because the in-memory cache was lost on every deploy.",
    ]);
    expect(reasonsIn("fix: typo")).toEqual([]);
  });
});

describe("what a chat and a job are told", () => {
  it("gives a question the chapter it is about, with sources, and the owner's words always", () => {
    const b = buildBook(input({ owner: { next: "Gift cards, then UPI", at: NOW } }));
    const brief = bookBrief(b, "where is this project heading?", 6).split("\n");
    expect(brief[0]).toBe("[Where it is heading] Next, in the owner's words: Gift cards, then UPI (you said)");
    expect(brief.every((l) => l.startsWith("[Where it is heading]"))).toBe(true);
    expect(bookBrief(b, "why do we use stripe?", 4)).toContain("[Why it is this way] Decision record: docs/adr/0001-use-stripe.md");
  });

  it("gives a job where the project is heading and what changed lately", () => {
    const out = bookForJobs(buildBook(input({ owner: { for: "Craft sellers", at: NOW } })));
    expect(out).toMatch(/^## Who it is for\n- \(the owner\) Craft sellers\n## Where the project is heading\n- Milestone "v2"/);
    expect(out).toContain("## Recent work\n- Last change 2026-10-30");
  });

  it("reads as a book, each line with its source", () => {
    const md = bookMarkdown(buildBook(input({ owner: { next: "Gift cards", at: NOW } })));
    expect(md).toMatch(/^# alice\/shop: the project book\n\nAs of commit `fffffff`, 2026-11-01\./);
    expect(md).toContain("## Where it is heading\n\n- ✓ Next, in the owner's words: Gift cards _(you said)_");
    expect(md).toContain("- #7 Checkout fails on Safari [bug], 9 comments _(issue #7)_");
    expect(md).toContain("## Questions for you");
  });
});

describe("the book of a real brain", () => {
  it("is made from the brain's rows when GitHub cannot be reached, keeps the owner's answers, and says what it could not read", async () => {
    const f = await fixtureBrain({ files: [{ path: "src/cart.ts", hot: 4 }], features: [{ name: "Cart", summary: "Holds what you buy.", files: [], fileCount: 1, routes: [], texts: [] }] });
    const book = (await f.brain.book())!;
    expect(book.facts.map((x) => x.text)).toContain("Cart: Holds what you buy.");
    expect(book.gaps).toContain("What changed lately: the history could not be read.");
    const answered = (await f.brain.answerBook({ next: "Payments" }))!;
    expect(answered.facts.find((x) => x.status === "confirmed")!.text).toBe("Next, in the owner's words: Payments");
    expect((await f.store.getBrain(f.projectId))!.book!.owner!.next).toBe("Payments");
  });
});

describe("keeping the owner's answers", () => {
  it("keeps them in the database, and in this process until migration 0060 is run", async () => {
    const sb = fakeSupabase({ tables: ["code_brain"] });
    const from = sb.from.bind(sb);
    let column = false;
    // Before the migration: a write that names the column is refused the way Postgres refuses it.
    (sb as { from: unknown }).from = (table: string) => {
      const q = from(table);
      const upsert = q.upsert.bind(q);
      q.upsert = (row: Record<string, unknown>, o: unknown) => (!column && "book" in row
        ? { select: () => ({ single: async () => ({ data: null, error: { message: 'column "book" of relation "code_brain" does not exist' } }) }) }
        : upsert(row, o)) as never;
      return q;
    };
    const store = new SupabaseProjectBrainStore(sb as never, () => NOW);
    const id = "11111111-1111-4111-8111-111111111111";
    await store.saveBrain(id, { status: "ready", headSha: "a".repeat(40) });
    const saved = await store.saveBrain(id, { book: { owner: { next: "Payments", at: NOW } } });
    expect(saved.book).toEqual({ owner: { next: "Payments", at: NOW } });
    expect((await store.getBrain(id))!.book).toEqual({ owner: { next: "Payments", at: NOW } });
    expect(sb.tables.code_brain![0]!.book).toBeUndefined();
    column = true;
    const fresh = new SupabaseProjectBrainStore(sb as never, () => NOW);
    await fresh.saveBrain(id, { book: { owner: { keep: "The API", at: NOW } } });
    expect(sb.tables.code_brain![0]!.book).toEqual({ owner: { keep: "The API", at: NOW } });
  });
});

describe("what a real project taught it (chedfox/tailzu-backend)", () => {
  it("reads a commit body's reason as one sentence, though it is wrapped", () => {
    expect(reasonsIn("Checks run install, build, typecheck, lint, test: lint failed before a\nchange and passed after only because the build ran last.\n\n- second point")).toEqual([
      "Checks run install, build, typecheck, lint, test: lint failed before a change and passed after only because the build ran last.",
    ]);
  });

  it("keeps only what is still missing from a gaps list, and marks a roadmap's done items", () => {
    expect(planLines("docs/bots-gaps.md", "- ✓ Delete account deletes at once\n- Keyboard settings not applied\n- ~~Old thing~~\n")).toEqual(["Open: Keyboard settings not applied"]);
    expect(planLines("ROADMAP.md", "- ✓ Cart\n- Gift cards\n")).toEqual(["Done: Cart", "Planned: Gift cards"]);
  });

  it("names the folders the work went to, deep enough to say something", async () => {
    const { busiestAreas } = await import("../src/code/project/book.js");
    const commits = [["tulmi/src/bots/a.ts"], ["tulmi/src/bots/b.ts"], ["tulmi/src/code/c.ts"], ["tulmi/tests/x.test.ts"]];
    // "tulmi/src" holds 3 of the 4 commits, so it is split one level down; a file that is not that deep counts for no folder.
    expect(busiestAreas(commits, 3)).toEqual([["tulmi/src/bots", 2], ["tulmi/src/code", 1]]);
    expect(busiestAreas([["a/b/c.ts"], ["d/e/f.ts"]], 3)).toEqual([["a/b", 1], ["d/e", 1]]);
  });
});
