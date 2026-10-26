/**
 * THE YES THAT A MERGE WAITS FOR.
 *
 * Merging a pull request writes to the default branch, the one thing Tailzu
 * otherwise never does, so it takes two requests (pulls.ts):
 *
 *   1. ask to merge: nothing is merged; the server looks at the pull request,
 *      writes down WHAT was looked at (this person, this project, this branch,
 *      this pull request at this head commit) and answers with an approval id
 *      and a summary to show;
 *   2. say yes with that id: the merge goes ahead, and only if the branch
 *      still points at the commit that was looked at.
 *
 * The phone will put Face ID in front of the second request. This book is what
 * makes the second request mean "that exact thing": an id that is unknown, for
 * another person, project or branch, used already, or older than ten minutes,
 * merges nothing.
 *
 * Kept in the server's memory, not the database: it lives ten minutes, and a
 * restart in that time only means asking again. An approval is a plain random
 * id with nothing in it; what it stands for is held here.
 */
import { randomBytes } from "node:crypto";

/** How long an approval can be used for. */
export const APPROVAL_TTL_MS = 10 * 60_000;
/** Approvals held at once; the oldest go first. Far more than any real use. */
const BOOK_MAX = 5000;

export interface MergeApproval {
  id: string;
  userId: string;
  projectId: string;
  branch: string;
  prNumber: number;
  /** The pull request's head commit when it was looked at. */
  headSha: string;
  /** Epoch ms. */
  expiresAt: number;
}

export type TakeResult = { ok: true; approval: MergeApproval } | { ok: false; reason: "unknown" | "expired" };

export class ApprovalBook {
  private readonly items = new Map<string, MergeApproval>();

  constructor(private readonly o: { now?: () => number; ttlMs?: number } = {}) {}

  private now(): number { return (this.o.now ?? Date.now)(); }

  /** A new approval. Asking again for the same person, project and branch replaces the one before. */
  issue(a: Omit<MergeApproval, "id" | "expiresAt">): MergeApproval {
    const now = this.now();
    for (const [id, x] of this.items) {
      if (x.expiresAt <= now || (x.userId === a.userId && x.projectId === a.projectId && x.branch === a.branch)) this.items.delete(id);
    }
    while (this.items.size >= BOOK_MAX) this.items.delete(this.items.keys().next().value as string);
    const approval: MergeApproval = { ...a, id: randomBytes(24).toString("base64url"), expiresAt: now + (this.o.ttlMs ?? APPROVAL_TTL_MS) };
    this.items.set(approval.id, approval);
    return { ...approval };
  }

  /**
   * Uses an approval up. It is gone from the book the moment it is found for
   * this person, project and branch, whatever happens to the merge after: a
   * second try needs a new look. One that belongs to someone else, or to
   * another branch, is left alone and answers "unknown".
   */
  take(id: string, who: { userId: string; projectId: string; branch: string }): TakeResult {
    const a = this.items.get(id);
    if (!a || a.userId !== who.userId || a.projectId !== who.projectId || a.branch !== who.branch) return { ok: false, reason: "unknown" };
    this.items.delete(id);
    return a.expiresAt <= this.now() ? { ok: false, reason: "expired" } : { ok: true, approval: a };
  }
}
