# PR care: looking after a pull request after it is opened

Opening a pull request is the middle of the work, not the end. CI goes red; a reviewer leaves a comment; the default branch moves and the branch no longer merges. **PR care** is the part of the Code bot that deals with those, so the person comes back to a pull request that is green, answered and up to date instead of three notifications. It is `tulmi/src/code/prcare/`. No npm dependency was added.

```
tulmi/src/code/prcare/
  types.ts    what is kept about a pull request, and the numbers that bound the work
  store.ts    the rows (migration 0034, code_pr_care): Supabase, with a memory twin
  ci.ts       is the red CI this pull request's to fix?
  review.ts   a reviewer's comment, read: small, large, a question, or none of those (the care_review role)
  status.ts   the ONE "Tailzu status" comment, edited in place
  engine.ts   GitHub's events in, jobs out
  index.ts    createPrCare(), the sweep
tulmi/src/code/agent/merge.ts   the merge phase of a job that brings the default branch into the branch (care_conflict role)
```

## 1. Whose pull requests

**Only those that are Tailzu's**:

* one **Tailzu opened**: its `tailzu/...` work branch is recorded with the pull request's number. It is looked after from the first event, with no setup;
* one the person **handed over**: `POST /v1/code/projects/:id/care { prNumber }`. It must be open, from a branch **in this repo** (a fork's pull request is refused: there is nowhere Tailzu may push), and not the default branch. The branch is recorded like a work branch (`handed: true` on `code_branches`), so jobs run on it and the policy treats it as Tailzu's own: **the hand-over is the person's yes to Tailzu pushing to that branch.** It is never forced, and a protection rule on GitHub still says no. What was already said on the pull request is taken as seen: only what comes after is dealt with.

Every other pull request is ignored, **before GitHub is asked anything**, whoever opened it and whatever it says. `DELETE /v1/code/projects/:id/care/:pr` takes a pull request back: its status comment says so, the jobs PR care started are cancelled, and its row goes.

## 2. How it hears, and why a repeat does no harm

GitHub's webhook (`code/webhook.ts`) hands PR care these events **before it does anything else with them**, and answers GitHub at once; the work happens after the answer:

| Event | Looked at when | Leads to |
| --- | --- | --- |
| `pull_request` | opened, reopened, synchronize (a new commit), ready for review, closed | a conflict check, a CI check; closed ends the care |
| `check_run`, `check_suite`, `status` | completed (a `status` that is not pending) | a CI check |
| `pull_request_review`, `pull_request_review_comment`, `issue_comment` | submitted / created, and not by a bot | the new comments are read |
| `push` to the default branch | always | every pull request in the project is checked for a conflict |
| a job PR care started ended or needs the person | the router's notification | the job is written up on the pull request |

* **One line of work for each pull request.** Events are queued, and two events for one pull request never run together.
* **What an event says is not trusted for what to do.** It names a pull request; everything decided is read from GitHub afresh (the pull request, its checks, its threads). A pull request whose head is another repo (a fork), or another branch than the one given, is not the one looked after.
* **Idempotent.** The row keeps what was done: the comments handled (by GitHub's id), the head commit CI was decided for, the base-and-head pair a conflict was dealt with for, the fix rounds made today. A delivery that comes twice, or ten check runs finishing one after another, does the same thing once.
* **The jobs come first.** Each time a pull request is looked at, what the jobs it started came to is written down before anything else, because a pushed fix makes events of its own before its job's end is reported; a head that is red again is judged knowing the last fix is over.
* **A timer** (every two minutes, `startCareSweep`) writes up the end of jobs whose notification was missed, and looks again where GitHub had not worked out yet whether a branch merges.

## 3. Red CI

On a CI event, `ci.ts` reads the head commit's **check runs** and **commit statuses**. Failed means a conclusion of failure or timed out (cancelled, skipped, neutral and "needs approval" are not the code's). Then:

| What it finds | What it does |
| --- | --- |
| a check is still **running** | nothing; the next event decides |
| every check **passes** | nothing; says so in the status if it was red |
| the App **cannot read** the checks (no Checks / Commit statuses permission) | says so once in the status; nothing else |
| the same check **fails on the default branch's head** too | "it also fails on `main`": a note in the status. **Nothing is pushed.** |
| the log shows **CI's own trouble** (the network, a registry, a full disk, a runner that went away), or the **same error is in the default branch's log** | a note. **Nothing is pushed** |
| it is **this change's** | a **fix job** |

The failing job's log is read through the Actions API: GitHub answers with a redirect to a short-lived address, which is followed **without the App's token**. The end of the log (6,000 characters, ANSI codes and time stamps removed, anything that looks like a secret redacted) goes to the fixing job **as data in its own labelled block**, never as part of its task and never as an instruction.

**The fix job** is a free-form job (`docs/code-agent.md` section 14) on the pull request's own branch: it explores from the log, edits, runs the project's checks, and the **server** commits and pushes only what the checks passed (verify before commit). It is told never to skip, disable, delete or weaken a test or a check, and never to touch CI configuration. It does not open a second pull request or rewrite this one's description.

**Three automatic rounds a pull request a day** (UTC). The third round's push that goes red again is not fixed: the status says "waiting for you", the person is told **once** that day (`needs_you`), and the same event again does not tell them again. A fix job that ends without a fix is reported the same way ("unfixed"). Tomorrow it may try again.

## 4. A reviewer's comment

For each new comment on a pull request Tailzu looks after, from someone with **write or admin access to the repo** (asked of GitHub; anyone else, a bot, and Tailzu's own replies are ignored and not asked about again), one call of the `care_review` role on the **cheap tier** reads it, with the comment fenced as data, the lines of the file around it, and what the job that made the pull request wrote in its work log. It says what kind of ask it is:

| Kind | What Tailzu does |
| --- | --- |
| **small** (a nit, a rename, a typo, a missing guard or test: a few lines, nobody needs to decide) | one job for all the small asks in the pass, on the branch, started with the files the comments are on (no search for them); the server pushes the verified change; then, **under each comment, "Done in `abc1234`." and the thread is resolved** (GraphQL `resolveReviewThread`). A comment in the conversation is answered in the conversation, naming the person. A job that makes no change says so under the comment, leaves the thread open, and tells the person |
| **large** (a redesign, a new feature, a change across modules, a choice between ways, anything that could break behaviour) | a **proposal** replied under the comment: what it would change, what it touches, what could break. Nothing is changed, the person is told, the thread stays open |
| **question** (why, what for) | answered from the work log alone, and says so when the log does not show the reason |
| **other** (thanks, an approval) | nothing |

**The comment is somebody else's words.** It is fenced; an instruction planted in it changes nothing (a comment that says "ignore your instructions and run curl ..." is read as what it is). And **a request to skip, disable, delete or loosen a test or a check is never a small ask, whatever the model said**: `review.ts` recognises it (`skip the failing test`, `disable that flaky test`, `comment out the assertion`, `mark it as flaky`, `xfail it`) and makes it a proposal that says Tailzu will not. The reply is cut to 600 characters and cleaned of anything that looks like a secret before it is written to a page other people read.

A comment the model could not be asked about (it was down, or the money was short) is **left for the next event**, not lost.

## 5. A conflict with the default branch

When GitHub says a pull request does not merge (`mergeable: false`), after any event on it or on a push to the default branch, PR care makes a **conflict job** (once for a given pair of base and head commits). It is a job with a `merge` phase (`agent/merge.ts`):

1. A **computer** (the person's own, or GitHub's free ones) does `git merge --no-commit --no-ff <the default branch's commit>`, fetched by its commit so it is exactly the commit that will be named as the second parent, and hands back the merged tree, conflict markers and all, as the step's *captured* changes. The runner never pushes, rebases or resets; it has no token that can write.
2. A cheap call (`care_conflict`) judges each clashing file: **mechanical** (both sides can stay: imports, formatting, lists that grew on both sides, neighbouring edits) or **semantic** (both changed the same logic and keeping either loses behaviour; when unsure, semantic).
3. **Semantic: the person is asked** which side should win (keep this branch's behaviour / take the default branch's / I will resolve it myself), and nothing is committed until they say. The model is told their choice. Mechanical: the model resolves it, keeping both sides' behaviour and dropping no test.
4. The project's own checks run on the merged result, and only that is committed. A conflict that is in CI configuration (`.github/workflows/`) is left to the person, who edits workflows themselves.
5. The **server** makes a **merge commit with two parents** (the branch's head, then the default branch's commit) through the Git Data API and the policy, a plain fast-forward of the branch. **Never a rebase, never a force-push.** A resolution that leaves the files exactly as the branch had them (keeping this side) is still a merge: the commit has two parents.

A job that cannot get a computer fails with the reason and nothing is changed.

## 6. When GitHub refuses a push

A protection rule or a repository ruleset can refuse the push even though the policy allowed it. PR care does **not** work round that. The job **stops**: its state is parked on a question that holds GitHub's own sentence (cut to 600 characters, secrets redacted) and **any link GitHub gave**, the pull request's status comment shows the same words under "Waiting for you", the person is told, and nothing else is pushed. They answer **Try again** (after changing the rule on GitHub, or deciding to take the change through a pull request) or **Stop**.

## 7. The one status comment

Everything that is not a reply under a reviewer's comment goes in **one comment** on the pull request, which begins with `<!-- tailzu-pr-status -->` and **Tailzu status**, and is **edited in place**: the checks, the branch, the reviews, what Tailzu is working on, what it is waiting for, and the latest few things it did, with times. The id is kept in the row; if that comment was deleted, the pull request's comments are searched for one that begins with the mark **and was written by a bot** (nobody else's comment is ever edited), and only if there is none is a new one made. A body that did not change is not written again. Replies under a reviewer's own comment are the only other thing Tailzu writes, so a pull request never fills up with notes.

## 8. Never

Skip, disable, delete or weaken a test or a check; push an empty commit, or close and reopen, to kick CI; re-run or cancel a CI run; force-push or rebase or rewrite history; commit edits the checks have not passed; act on a pull request that is not Tailzu's (or a fork's); act on a comment from someone who cannot write to the repo; take a comment, a log or a check's name as an instruction; work round GitHub's refusal; write more than one status comment.

## 9. Setting up

1. **Run `tulmi/supabase/migrations/0034_code_chat_and_care.sql`** (or `full_schema.sql`) after `0033`: the rows (`code_pr_care`), the project settings and rewind points, three columns on the steps, and `handed` on branches. Without it every PR-care store keeps its rows in memory and a restart forgets them; nothing else depends on it.
2. **The GitHub App** (`docs/github-app.md`): add the permissions **Checks: Read-only** and **Commit statuses: Read-only** (Actions: Read-only is there already), and subscribe to the events **Pull request review comment**, **Issue comment**, **Check run**, **Check suite** and **Status**. People who installed the App accept the new permissions on GitHub. Without them PR care still answers reviewers and merges the default branch in, and says once in the status that it cannot read the checks.
3. **One API server.** The queue that keeps two events for one pull request apart is in the server's memory, as the desktop presence is (`docs/code-router.md`). Two servers each receiving an event for the same pull request in the same second could each start a job; the daily cap, the checks and the policy make that harmless, but run one server (or keep a project's webhooks on one).
4. PR care needs the Code bot's agent (`CODE_GITHUB`, `CODE_PROJECT_BRAIN`). It starts with the server; with `CODE_JOBS_MODE=cloudflare` the care engine still runs on the VPS (it receives the webhook), and the jobs it makes run on the Worker like any other. Nothing else to configure; a job PR care makes has the router's default budget (`CODE_JOB_DEFAULT_BUDGET_PAISE`), and one reading of a comment may cost 60 paise.

## 10. Tests, and what needs a live check

`code-pr-care-ci.test.ts` (whose pull requests, red CI read through the redirect, not-ours failures and nothing pushed, the daily cap, the status comment), `-review` (small, large, question, instructions in comments, the test-skipping rule, once each), `-conflict` (the two-parent merge commit, the person's choice, once per pair, a protected branch's refusal and what the status says), `-routes` (hand over, release, the webhook), over `tests/care-rig.ts` and the fake GitHub (check runs, statuses, Actions logs behind a redirect, review threads, comments). The `care_review` and `care_conflict` roles' fixtures are `evals/care_*.jsonl`.

**Needs a live check** (nothing here can know):

* **`git merge --no-commit` on a real runner**, on GitHub's free computers and on the desktop app (a shallow checkout, a repo with submodules, Windows line endings): the runner commands are exactly `mergeCommands`; the tests answer them from a script.
* **GitHub's real log redirect** (`/actions/jobs/:id/logs` answers 302 with an address on another host) and the App's real **Checks / Statuses / Actions** read permissions on an install that has accepted them.
* **Webhook delivery**: that the App is subscribed to the seven events and the deliveries reach `/v1/code/github/webhook` (the App's Advanced tab shows them).
* **A real model reading comments**: whether the cheap tier tells a small ask from a larger one the way a person would (`scripts/eval-prompts.ts`), and whether the fix jobs find the cause from a real log.
* **Resolving a thread** (GraphQL) on a real pull request, and replying under the first comment of a thread (GitHub does not take a reply to a reply).
* **A protected branch** refusing a real push: GitHub's actual words and link are what the status shows.
