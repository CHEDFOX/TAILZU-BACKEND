/**
 * THE ONE "TAILZU STATUS" COMMENT A PULL REQUEST CARRIES: WRITTEN HERE, EDITED IN PLACE, NEVER A SECOND ONE.
 *
 * PR care talks to a pull request in two ways. Under a reviewer's comment it REPLIES (a thread is a conversation). Everything else (what the checks said,
 * that a fix is out, that a conflict was merged, that it is waiting for the person) goes in ONE comment on the pull request's conversation, which is edited
 * as things change. So a pull request never fills up with Tailzu's notes, and a reader looks in one place.
 *
 * The comment's id is kept in the care row. If that comment was deleted (the update says it is gone) or the id was lost, the pull request's comments are
 * searched for the one that begins with STATUS_MARK AND was written by a bot (nobody else's comment is ever edited); only if there is none is a new one made.
 * The body is the same text for the same state, and a body that did not change is not written again.
 *
 * Everything here is Tailzu's own words, or GitHub's, cut and cleaned of anything that looks like a secret: it is written to a page other people read.
 */
import { createHash } from "node:crypto";
import type { GithubApp, RepoRef } from "../github.js";
import { cut } from "../work/model.js";
import { redactText } from "../work/worklog.js";
import { NOTES_KEEP, STATUS_MARK, type CareRow, type CareState, type CiOutcome } from "./types.js";

const CI_WORDS: Record<CiOutcome, string> = {
  green: "All checks pass.",
  pending: "Checks are still running.",
  fixing: "Checks are failing; a fix is being made.",
  also_red: "Checks are failing, but not because of this pull request. Nothing was changed.",
  infra: "A check failed, but not because of the code. Nothing was changed.",
  capped: "Checks are still failing after the automatic fixes for today. Waiting for you.",
  unfixed: "Checks are failing and Tailzu could not fix them. Waiting for you.",
  blind: "Tailzu cannot read this repository's checks (the GitHub App needs Checks and Commit statuses read access).",
};

const time = (at: number): string => new Date(at).toISOString().slice(5, 16).replace("T", " ");

/** The comment's text for a row. A pure function of the state, so it is the same text twice. */
export function statusBody(row: Pick<CareRow, "origin" | "state" | "ciRounds">, now: number): string {
  const s: CareState = row.state;
  const lines: string[] = [STATUS_MARK, "**Tailzu status**", ""];
  const open = s.jobs.filter((j) => !j.done);
  if (s.ended) {
    lines.push(s.ended === "released" ? "Tailzu has stopped looking after this pull request, as you asked." : `This pull request is ${s.ended}. Tailzu has stopped looking after it.`);
  } else {
    lines.push(`- **Checks:** ${s.ci ? `${CI_WORDS[s.ci.outcome]}${s.ci.note ? ` ${redactText(s.ci.note, 300)}` : ""}` : "Not looked at yet."}`);
    lines.push(`- **Branch:** ${s.conflict ? `${redactText(s.conflict.note, 300)}` : "No conflict with the default branch."}`);
    lines.push(`- **Reviews:** ${open.some((j) => j.kind === "review") ? "Working on a reviewer's ask." : s.handled.length ? "Every comment so far has been answered." : "No comments yet."}`);
    if (open.length) lines.push(`- **Working on:** ${open.map((j) => ({ ci: "fixing CI", review: "a reviewer's ask", conflict: "the conflict" }[j.kind])).join(", ")}.`);
    if (s.waiting) lines.push("", `> **Waiting for you.** ${redactText(s.waiting.text, 700).replace(/\n+/g, "\n> ")}`);
  }
  const notes = s.notes.slice(-NOTES_KEEP);
  if (notes.length) lines.push("", "Latest:", ...notes.map((n) => `- ${time(n.at)} UTC: ${redactText(n.text, 300).replace(/\n+/g, " ")}`));
  lines.push("", `<sub>${row.origin === "handed" ? "You handed this pull request to Tailzu." : "Tailzu opened this pull request."} This comment is edited in place; Tailzu does not post more. Updated ${time(now)} UTC.</sub>`);
  return cut(lines.join("\n"), 8000);
}

/** The text that decides whether the comment needs writing again: the body without the time it was updated. */
const stable = (body: string): string => createHash("sha1").update(body.replace(/Updated [\d-]+ [\d:]+ UTC\./, "")).digest("hex");

/**
 * Writes the status comment: edits the one it has, finds it again if it lost track, or makes it. Returns the comment's id and whether anything was written.
 * Throws GitHub's refusal when the App may not comment (the caller keeps going: a missing status never stops a fix).
 */
export async function writeStatus(github: Pick<GithubApp, "updateIssueComment" | "issueComments" | "createIssueComment">, repo: RepoRef, row: CareRow, now: number): Promise<{ id: number; wrote: boolean; hash: string }> {
  const body = statusBody(row, now);
  const hash = stable(body);
  if (row.statusCommentId && row.state.statusHash === hash) return { id: row.statusCommentId, wrote: false, hash };
  if (row.statusCommentId && (await github.updateIssueComment(repo, row.statusCommentId, body))) return { id: row.statusCommentId, wrote: true, hash };
  const mine = (await github.issueComments(repo, row.prNumber)).find((c) => c.body.startsWith(STATUS_MARK) && /\[bot\]$/i.test(c.author));
  if (mine && (await github.updateIssueComment(repo, mine.id, body))) return { id: mine.id, wrote: true, hash };
  const made = await github.createIssueComment(repo, row.prNumber, body);
  return { id: made.id, wrote: true, hash };
}
