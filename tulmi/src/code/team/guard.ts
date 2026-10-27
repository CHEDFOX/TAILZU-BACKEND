/**
 * THE OWNED-PATH GUARD: A HELPER CHANGES ITS OWN FILES AND NOBODY ELSE'S.
 *
 * Disjoint ownership is what lets helpers work side by side and be merged without a conflict, so it is held where every edit passes, the changeset
 * (agent/changeset.ts): an `edit_file`, `write_file` or `delete_file` of a path outside the part's `ownedPaths` is refused BEFORE anything is staged, with a tool
 * error that says what to do instead. Reading is free everywhere. A refusal is remembered (`refused`, the same array as the helper's state, so it is in its
 * checkpoint): the lead sees what the helper asked for, puts it in the review and in the pull request, and makes the change itself where it is needed.
 *
 * The lead is held the same way while it does part 0 (the contracts): it changes the contracts and nothing the helpers will own.
 */
import { owns } from "./globs.js";

export interface PathGuard {
  /** Null when the path may be changed; else the words for the model. */
  check(path: string): string | null;
}

export class OwnedPaths implements PathGuard {
  /**
   * `label` is how the part is named in the refusal ("part 2 (the invoice API)"). `refused` is kept: every refused path is added once (at most REFUSED_MAX).
   * `lead` changes the words: the contracts' author is the lead, who has nobody to ask.
   */
  constructor(private readonly o: { label: string; globs: readonly string[]; refused: string[]; lead?: boolean }) {}

  check(path: string): string | null {
    if (owns(this.o.globs, path)) return null;
    if (!this.o.refused.includes(path) && this.o.refused.length < REFUSED_MAX) this.o.refused.push(path);
    const mine = this.o.globs.slice(0, 6).join(", ") + (this.o.globs.length > 6 ? ` and ${this.o.globs.length - 6} more` : "");
    if (this.o.lead) {
      return `${path} is not part of the shared contracts. While you do ${this.o.label} you change only ${mine}; the helpers own the rest. Leave it, and say in your answer what the contracts need from it.`;
    }
    return `${path} is not yours. You are ${this.o.label}, and you may change only ${mine}; another part or the lead owns ${path}. `
      + "Do not edit it and do not work round this. Ask the lead: write what you need changed there in a `note` and in your `done` summary, finish your own files, and the lead will see the request.";
  }
}

/** The most refused paths a part remembers. */
export const REFUSED_MAX = 20;
