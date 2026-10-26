/**
 * THE YES THAT AN ACTION WAITS FOR.
 *
 * Some things the Code bot does only after a person says yes: merging a pull
 * request, committing to a branch it didn't make, deleting a branch, and the
 * rest of what policy.ts calls "ask" (and, with Face ID on the phone, the
 * "ask_strict" ones: a force-push, a commit that looks like it holds a secret).
 * Each takes two requests (policy.ts gate):
 *
 *   1. ask: nothing is done; the server looks at what would happen, writes down
 *      WHAT was looked at (this person, this project, this action, this branch,
 *      and where it matters the commit the branch was at and a fingerprint of
 *      what would be written) and answers with an approval id and a summary to
 *      show;
 *   2. say yes with that id: the action goes ahead, and only if everything is
 *      still as it was when it was looked at.
 *
 * The phone will put Face ID in front of the second request of the strict ones.
 * This book is what makes the second request mean "that exact thing": an id
 * that is unknown, for another person, project, action or branch, used already,
 * or older than ten minutes, does nothing; and one whose branch has moved on,
 * or whose contents are different, is refused by the caller, which compares
 * what it finds now with what is written here.
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

export interface Approval {
  id: string;
  userId: string;
  projectId: string;
  /** The policy's action id ("pr.merge", "commit.other_branch", ...). */
  action: string;
  /** The branch it is about; "" for an action on no branch (starting an empty repo). */
  branch: string;
  /** The commit the branch (or the pull request's head) was at when it was looked at, where that matters. */
  headSha?: string;
  prNumber?: number;
  /** A digest of what would be written (the files and the message of a commit, the commit a branch would be moved to), where that matters. */
  fingerprint?: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** What identifies an approval's owner and subject: all of it has to match for an id to be found. */
export interface ApprovalKey { userId: string; projectId: string; action: string; branch: string }

export type TakeResult = { ok: true; approval: Approval } | { ok: false; reason: "unknown" | "expired" };

export class ApprovalBook {
  private readonly items = new Map<string, Approval>();

  constructor(private readonly o: { now?: () => number; ttlMs?: number } = {}) {}

  private now(): number { return (this.o.now ?? Date.now)(); }

  /** A new approval. Asking again for the same person, project, action and branch replaces the one before. */
  issue(a: Omit<Approval, "id" | "expiresAt">): Approval {
    const now = this.now();
    for (const [id, x] of this.items) {
      if (x.expiresAt <= now || (x.userId === a.userId && x.projectId === a.projectId && x.action === a.action && x.branch === a.branch)) this.items.delete(id);
    }
    while (this.items.size >= BOOK_MAX) this.items.delete(this.items.keys().next().value as string);
    const approval: Approval = { ...a, id: randomBytes(24).toString("base64url"), expiresAt: now + (this.o.ttlMs ?? APPROVAL_TTL_MS) };
    this.items.set(approval.id, approval);
    return { ...approval };
  }

  /**
   * Uses an approval up. It is gone from the book the moment it is found for
   * this person, project, action and branch, whatever happens to the action
   * after: a second try needs a new look. One that belongs to someone else, or
   * to another action or branch, is left alone and answers "unknown".
   */
  take(id: string, who: ApprovalKey): TakeResult {
    const a = this.items.get(id);
    if (!a || a.userId !== who.userId || a.projectId !== who.projectId || a.action !== who.action || a.branch !== who.branch) return { ok: false, reason: "unknown" };
    this.items.delete(id);
    return a.expiresAt <= this.now() ? { ok: false, reason: "expired" } : { ok: true, approval: a };
  }
}
