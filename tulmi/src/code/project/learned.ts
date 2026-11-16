/**
 * WHAT EARLIER WORK LEARNED HERE: THE ONE PART OF THE BOOK THAT COMES FROM DOING, NOT FROM READING.
 *
 * Every other fact in the book (book.ts) is read from the repository: a file, a commit, a pull request, an issue, the
 * project's own checks, or the owner's own words. That is most of what is worth knowing, and it costs nothing.
 *
 * It is not everything. A job that spends three fix rounds finding out that the suite needs a service up first, or that
 * one check fails on the default branch anyway, has learned something true about this project that is written down
 * nowhere in it. Today that dies with the job, and the next job pays for it again. These are those facts.
 *
 * WHERE THEY LIVE. In `BookState` (`code_brain.book`), beside the owner's answers, because they are the other thing the
 * book cannot recompute: the repository does not hold them. Every rebuild of the book merges them back in
 * (`buildBook`, `BookInput.learned`), so the default branch moving does not forget them. No migration: that column is JSON.
 *
 * HOW ONE IS EARNED, AND HOW IT DIES. A fact starts as a GUESS, from one job. Seen again in another job it becomes FOUND.
 * Only the owner makes anything CONFIRMED, which is the rule everywhere else in the book. A guess nobody has seen again
 * within `GUESS_LIFE_MS` is dropped, as is anything naming a file the project no longer has, and the weakest go first
 * when a project is at `LEARNED_MAX`. So a wrong note costs one job a bad hint and then leaves, while a true one hardens.
 *
 * WHAT IT IS NEVER. Not permission. These facts go to a job inside the book, which is fenced as data like every other
 * text from outside, and nothing in them changes what Tailzu may do: the policy decides that, whatever any text says
 * (`policy.ts`). They are shown with their confidence, never as an instruction, and the owner can read and delete them.
 */
import type { BookFact, Chapter, Source } from "./book.js";

/** A fact a job's own work established, as it is kept between jobs. */
export interface LearnedFact {
  /** The book chapter it belongs in: how the project runs, how it stands, or its rules. */
  chapter: Extract<Chapter, "run" | "state" | "rules">;
  /** One short line, in the project's own names. */
  text: string;
  /** The job it came from first, so a reader can go and look. */
  job: string;
  /** How sure: one sighting is a guess, two is found, only the owner confirms. */
  status: "guessed" | "found" | "confirmed";
  /** When it was first learned, and when it was last seen to be true. */
  at: number;
  seenAt: number;
  /** How many jobs have now found it. */
  seen: number;
  /** The files it is about, if any: a fact whose files are all gone is a fact about a project that has moved on. */
  paths?: string[];
}

/** The most a project keeps. Past it the weakest and oldest go first. */
export const LEARNED_MAX = 40;
/** How long a fact only one job has ever seen is kept: a fortnight of work either proves it again or it was a one-off. */
export const GUESS_LIFE_MS = 14 * 86_400_000;
/** The longest one line may be, as the book's own facts are cut. */
export const LEARNED_CHARS = 280;

const one = (s: unknown, n = LEARNED_CHARS): string => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Two facts are the same fact when their words match bar case, spacing and punctuation: that is what a second sighting means. */
export const sameFact = (a: string, b: string): boolean => key(a) === key(b);
const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const CHAPTERS_ALLOWED = new Set(["run", "state", "rules"]);

/** One candidate as a job offers it, before it is known whether the project has seen it before. */
export interface Candidate {
  chapter: string;
  text: string;
  paths?: readonly string[];
  /** The owner's own words (they answered a question with it), which is the one thing that makes a fact confirmed from the start. */
  owner?: boolean;
}

/**
 * A candidate kept only if it is worth keeping: a chapter these facts may use, words that are more than a shrug, and
 * nothing that reads as an instruction rather than a fact about the project. Null when it is not.
 */
export function cleanCandidate(c: Candidate): { chapter: LearnedFact["chapter"]; text: string; paths?: string[] } | null {
  const chapter = String(c.chapter ?? "");
  if (!CHAPTERS_ALLOWED.has(chapter)) return null;
  const text = one(c.text);
  // A line that is too short to say anything, or that tells the reader what to do instead of what is true here.
  if (text.length < 15) return null;
  if (/^(?:always|never|you (?:must|should)|make sure|remember to|be sure)\b/i.test(text)) return null;
  const paths = (c.paths ?? []).map((p) => one(p, 300)).filter(Boolean).slice(0, 4);
  return { chapter: chapter as LearnedFact["chapter"], text, ...(paths.length ? { paths } : {}) };
}

/**
 * What a project knows after a job offered these candidates: a new one is a guess, one already known is seen again (and a
 * guess becomes found), and the owner's own confirmation is never lowered by either. Capped and pruned (`prune`).
 */
export function learn(
  kept: readonly LearnedFact[],
  candidates: readonly Candidate[],
  o: { job: string; now: number },
): LearnedFact[] {
  const out = kept.map((f) => ({ ...f }));
  for (const raw of candidates) {
    const c = cleanCandidate(raw);
    if (!c) continue;
    const at = out.find((f) => sameFact(f.text, c.text));
    if (at) {
      // The owner's words outrank anything the work inferred, whenever they arrive.
      if (raw.owner === true) { at.status = "confirmed"; at.seenAt = o.now; continue; }
      // Seen again, by a different job: that is what makes a guess a fact. The same job saying it twice proves nothing.
      if (at.job !== o.job) {
        at.seen += 1;
        at.seenAt = o.now;
        if (at.status === "guessed") at.status = "found";
      }
      continue;
    }
    out.push({
      chapter: c.chapter, text: c.text, job: o.job, status: raw.owner === true ? "confirmed" : "guessed",
      at: o.now, seenAt: o.now, seen: 1, ...(c.paths ? { paths: c.paths } : {}),
    });
  }
  return prune(out, { now: o.now });
}

/**
 * What is still worth keeping: nothing about files the project no longer has, no guess older than `GUESS_LIFE_MS` that
 * no second job ever saw, and at most `LEARNED_MAX`, the weakest and oldest going first. The owner's confirmed facts are
 * kept whatever their age: they are not ours to forget.
 */
export function prune(facts: readonly LearnedFact[], o: { now: number; paths?: ReadonlySet<string> }): LearnedFact[] {
  const alive = facts.filter((f) => {
    if (f.status === "confirmed") return true;
    if (f.status === "guessed" && o.now - f.seenAt > GUESS_LIFE_MS) return false;
    // A fact about files that have all gone is about a project that has moved on. Checked only when the file list is known.
    if (o.paths && f.paths?.length && !f.paths.some((p) => o.paths!.has(p))) return false;
    return true;
  });
  const rank = { confirmed: 3, found: 2, guessed: 1 } as const;
  return [...alive]
    .sort((a, b) => rank[b.status] - rank[a.status] || b.seen - a.seen || b.seenAt - a.seenAt)
    .slice(0, LEARNED_MAX);
}

/** The owner's word on one of them: confirmed, or gone. */
export function ownerSays(facts: readonly LearnedFact[], text: string, verdict: "confirm" | "forget", now: number): LearnedFact[] {
  if (verdict === "forget") return facts.filter((f) => !sameFact(f.text, text)).map((f) => ({ ...f }));
  return facts.map((f) => (sameFact(f.text, text) ? { ...f, status: "confirmed" as const, seenAt: now } : { ...f }));
}

/** These facts as the book carries them, so every reader of the book reads them the same way as the rest. */
export const factsOf = (facts: readonly LearnedFact[]): BookFact[] =>
  facts.map((f) => ({
    chapter: f.chapter,
    text: f.text,
    source: { kind: "job", ref: f.job } satisfies Source,
    status: f.status,
    at: f.at,
  }));
