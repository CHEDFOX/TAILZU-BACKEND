/**
 * RED CI, READ: IS THIS PULL REQUEST'S TO FIX, OR NOT?
 *
 * A pull request's checks can be red for four reasons, and only one of them is a thing a fix on the branch can cure:
 *
 *   it is this change's   the code (or a test) the branch changed is wrong: a fix job
 *   it is the base's      the same checks fail on the default branch's head: they were red before this pull request, and pushing to the branch would only
 *                         hide that behind unrelated edits. Tailzu says so and pushes NOTHING
 *   it is CI's            the log shows the network, a registry, a full disk or a runner that went away, or the SAME error is in the base's log: not the code.
 *                         Tailzu says so and pushes NOTHING (it does not close and reopen, push an empty commit or re-run anything to kick CI)
 *   it is not decided     checks are still running: wait for the next event
 *
 * What it reads is GitHub's: the commit's check runs and statuses (github.ts checksOf), and for a failing GitHub Actions job the end of its log
 * (jobLogTail). A log is the CI's own output: DATA. It is cleaned of anything that looks like a secret here, and it goes to the fixing job as data, never
 * as an instruction.
 */
import type { CommitChecksView, GithubApp, PullInfo, RepoRef } from "../github.js";
import { redactText } from "../work/worklog.js";
import { LOG_READ_CHARS, LOG_SHOWN_CHARS } from "./types.js";

/** A check run's conclusions that mean the code is red. (Cancelled, skipped, neutral and "needs approval" are not a failure of the code.) */
const RED_RUN = new Set(["failure", "timed_out"]);
const RED_STATUS = new Set(["failure", "error"]);

export interface FailingCheck {
  name: string;
  kind: "run" | "status";
  /** The check run's id (Actions: its job's id). */
  id?: number;
  url: string;
  /** What the check itself says (its title and summary, or the status's description). */
  said: string;
}

export interface CiReading {
  failing: FailingCheck[];
  /** Something is still queued or running: the picture is not whole. */
  pending: boolean;
  /** Nothing could be read at all. */
  blind: boolean;
  /** How many checks passed. */
  passing: number;
}

/** What a commit's checks come to. Pure. */
export function readChecks(view: CommitChecksView): CiReading {
  const failing: FailingCheck[] = [];
  let pending = false;
  let passing = 0;
  for (const r of view.runs) {
    if (r.status !== "completed") { pending = true; continue; }
    if (r.conclusion && RED_RUN.has(r.conclusion)) failing.push({ name: r.name, kind: "run", id: r.id, url: r.url, said: [r.title, r.summary].filter(Boolean).join(": ") });
    else if (r.conclusion === "success") passing += 1;
  }
  // The newest status of each context is what GitHub's combined status holds already; "pending" is a CI that has not finished.
  for (const s of view.statuses) {
    if (s.state === "pending") pending = true;
    else if (RED_STATUS.has(s.state)) failing.push({ name: s.context, kind: "status", url: s.url, said: s.description });
    else if (s.state === "success") passing += 1;
  }
  return { failing, pending, blind: view.denied.includes("checks") && view.denied.includes("statuses"), passing };
}

/** What a log says when it is CI's own trouble and not the code's. */
const INFRA: RegExp[] = [
  /\bE(?:CONNRESET|TIMEDOUT|NOTFOUND|AI_AGAIN|CONNREFUSED|PIPE)\b/,
  /\bgetaddrinfo\b/i,
  /could not resolve host/i,
  /temporary failure in name resolution/i,
  /\b50[234]\b[^\n]{0,40}(?:bad gateway|service unavailable|gateway time-?out)/i,
  /(?:registry|mirror|download|fetch)[^\n]{0,60}(?:timed out|time-out|unavailable|connection reset)/i,
  /\bTLS handshake timeout\b/i,
  /the runner has received a shutdown signal/i,
  /the hosted runner[^\n]{0,80}lost communication/i,
  /no space left on device/i,
  /received request to deprovision/i,
  /npm (?:ERR!|error) (?:network|code E(?:TIMEDOUT|CONNRESET))/i,
  /error: (?:RPC failed|unable to access)/i,
  /rate limit exceeded/i,
];

/** Whether a log reads as the CI's own trouble. */
export const isInfraNoise = (log: string): boolean => INFRA.some((re) => re.test(log));

/**
 * What a failure looks like once the parts that change from run to run are taken out: the last line that names an error, with numbers, hashes and
 * times blanked. Two logs with the same signature failed the same way.
 */
export function signatureOf(log: string): string {
  const lines = log.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = [...lines].reverse().find((l) => /\b(?:error|failed|failure|exception|assert\w*|cannot|unable|timed out)\b|✕|×/i.test(l)) ?? lines.at(-1) ?? "";
  return hit.toLowerCase().replace(/\b[0-9a-f]{7,40}\b/g, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").slice(0, 160);
}

export type CiDecision =
  | { kind: "green" }
  | { kind: "pending" }
  | { kind: "blind" }
  | { kind: "also_red"; names: string[] }
  | { kind: "infra"; names: string[]; why: string }
  | { kind: "fix"; names: string[]; log: string };

/** The end of a failing check's log, or what the check says of itself when GitHub gives no log. Already cleaned. */
async function logOf(github: Pick<GithubApp, "actionsJobOf" | "jobLogTail">, repo: RepoRef, c: FailingCheck): Promise<string> {
  if (c.kind === "run" && c.id !== undefined) {
    try {
      const job = await github.actionsJobOf(repo, c.id);
      const tail = job === null ? null : await github.jobLogTail(repo, job, LOG_READ_CHARS);
      if (tail) return tail;
    } catch { /* the check's own words below */ }
  }
  return c.said;
}

/**
 * Decides what to do about a pull request's checks. Reads the head's checks, then (only when something is red) the base's, and the logs of what is red.
 * `readBase` is the default branch's head commit, where the same checks are compared.
 */
export async function decideCi(
  github: Pick<GithubApp, "checksOf" | "actionsJobOf" | "jobLogTail" | "branchHead">, repo: RepoRef, pull: Pick<PullInfo, "headSha" | "baseRef">,
): Promise<CiDecision> {
  const mine = readChecks(await github.checksOf(repo, pull.headSha));
  if (mine.blind) return { kind: "blind" };
  if (mine.pending) return { kind: "pending" };
  if (!mine.failing.length) return { kind: "green" };

  // Red on the default branch's head too?
  let baseFailing: FailingCheck[] = [];
  try {
    const baseHead = await github.branchHead(repo, pull.baseRef);
    baseFailing = readChecks(await github.checksOf(repo, baseHead)).failing;
  } catch { /* the base cannot be read: it is not ruled out, and the fix job goes on */ }
  const baseNames = new Set(baseFailing.map((c) => c.name));
  const baseSigs = baseFailing.length ? new Set((await Promise.all(baseFailing.slice(0, 4).map((c) => logOf(github, repo, c)))).map(signatureOf).filter(Boolean)) : new Set<string>();

  const own: Array<{ check: FailingCheck; log: string }> = [];
  const alsoRed: string[] = [];
  const infra: Array<{ name: string; why: string }> = [];
  for (const check of mine.failing.slice(0, 6)) {
    if (baseNames.has(check.name)) { alsoRed.push(check.name); continue; }
    const log = redactText(await logOf(github, repo, check), LOG_READ_CHARS);
    if (baseSigs.has(signatureOf(log)) && signatureOf(log)) { infra.push({ name: check.name, why: "the same error is in the default branch's log" }); continue; }
    if (isInfraNoise(log)) { infra.push({ name: check.name, why: "the log shows a network, registry or runner problem" }); continue; }
    own.push({ check, log });
  }
  if (!own.length) {
    return infra.length
      ? { kind: "infra", names: infra.map((i) => i.name), why: infra[0]!.why }
      : { kind: "also_red", names: alsoRed };
  }
  const log = own.map((o) => `== ${o.check.name} ==\n${o.log}`).join("\n\n");
  return { kind: "fix", names: own.map((o) => o.check.name), log: log.length > LOG_SHOWN_CHARS ? log.slice(-LOG_SHOWN_CHARS) : log };
}
