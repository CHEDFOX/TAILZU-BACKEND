# The Code bot's environment router

A coding task is a **job**. It runs as **steps**. An **edit** step (read, change and commit files through GitHub's API) needs no computer. An **exec** step (install, build, test) does, and the router decides where it runs, using the cheapest place there is. What makes the steps is the brain: its first layer (which models to ask, what they may cost, what kind of request this is and which tier each step deserves) is `docs/code-brain.md`, and the **agent loop** (`docs/code-agent.md`) is the worker that drives a job from the person's words to a pull request. The router is driven by the methods in `tulmi/src/code/jobs/router.ts`, which the agent loop and the tests call.

Switched on with the rest of the Code bot (`CODE_GITHUB`), after `tulmi/supabase/migrations/0023_code_jobs.sql` (and `0024_code_github_actions.sql` for GitHub's free computers, `0030_code_agent.sql` for the agent loop, and `0031_code_runner_minutes.sql` for the live session's count of the month's minutes).

## 1. Where an exec step runs

In this order, the first that fits (`code/jobs/placement.ts`, one pure function, tested against every combination):

1. **The person's own PC.** Free, and the code never leaves their machine. A Tailzu desktop app of theirs must be online, have "run commands" switched on, be allowed on this project, and not be busy.
2. **GitHub's free computers (GitHub Actions).** Free up to GitHub's monthly allowance: 2,000 minutes on a free plan (`CODE_GITHUB_FREE_MINUTES`). That allowance is shared with everything else the person runs there, so Tailzu counts only its own use and keeps **a tenth back**: with nothing used, 1,800 minutes are Tailzu's. It counts only if the project has it set up (the provider says so: the App needs Workflows and Actions, a sign-in needs the `workflow` scope) and the person hasn't switched it off. A **public** repo's minutes aren't metered, so they don't count and don't hold a step back. This is real: `GithubActionsProvider` in `code/jobs/githubActions.ts`, section 7 below, and `docs/github-app.md` section 9. With the live session (section 9) the rule changes: Tailzu counts the minutes itself, tells the person at 80% of the month's allowance, and stops choosing GitHub's computers at 95% instead of keeping a tenth back.
3. **Paid compute**, and only by the person's own rule (below). *Interface only for now (`PaidProvider`).*
4. **Otherwise the job waits** (`waiting_for_compute`), the person is told (`compute_paused`), and it carries on by itself when a place frees up: a PC sends a heartbeat, a result frees a PC, the month turns over, or a setting changes.

A server with no GitHub or paid provider never chooses them, and says so in the reason it gives. If a step run on GitHub never starts or never reports, GitHub is marked **used up for that person for the month** and is not chosen again until it turns over (section 7).

## 2. The person's paid rule

Settings, `GET` and `PUT /v1/code/settings/compute`:

| `paidRule` | What happens when only paid compute is left |
| --- | --- |
| `never` (the default) | It isn't used. The step waits. |
| `ask` | The job goes to `waiting_for_you` and the person gets `compute_ask` with the price. `POST /v1/code/jobs/:id/compute-ok` says yes for **this job**: it raises the job's budget by what the step is expected to cost (or `maxPaise`), and later steps of the job that fit that budget run without asking again. |
| `auto` | It is used without asking while this month's paid use stays inside `autoCapPaise`. Beyond the cap it asks, as `ask` does. |

`never` beats everything, including a budget the person said yes to earlier. A step is never sent to paid compute that doesn't exist on the server; it waits instead of asking for money that can't be spent. A free place that appears while a job waits for a yes takes the job; the question goes away.

A job's `budgetPaise` is what the person has said it may spend. Made without one, it is `CODE_JOB_DEFAULT_BUDGET_PAISE` (3,000 paise, thirty rupees); a budget of **0 sent on purpose** still means no model calls, and the rule decides whether to ask for compute. What a paid place reports it used goes into the job's `spentPaise` and the month's `paidPaise`. The brain's model calls (`docs/code-brain.md`) are added to the same `spentPaise` and held to the same `budgetPaise`, so one budget bounds everything a job costs. GitHub minutes go into the month's `githubMinutes`. The month is the calendar month in UTC (`code_compute_usage`).

## 3. Leases, fencing and checkpoints

A step that is out has a **lease**: one holder (a device id, a run id), an expiry **90 seconds** ahead, and an **epoch** that goes up by one on **every dispatch**. The holder keeps the lease with a heartbeat from a PC that says it is busy running the step, or with `progress` for the job. Every result and every progress call carries the epoch it was given; anything with an older one is refused as `409 stale_lease`. So a PC that went quiet and was replaced can never count: two machines never both count. Until the ticker has taken a lease back, the holder with the current epoch is still the holder, so a result a few seconds late still lands if nobody else has been given the step. The same result sent twice is counted once.

The **ticker** (`code/jobs/ticker.ts`, every 15 seconds, started when the server is ready and stopped when it closes, like the stuck-task sweeper) takes back leases that ran out, places the step again, and gives waiting jobs another look. A job whose lease is lost **five times** is failed, with the reason, and the person gets `job_failed`.

Every change that depends on the lease goes through the store's `casJob` (the epoch, the state and the expiry must still be what the caller read), and everything for one person runs under one lock, so a ticker, a request and a second server can't both win.

The **checkpoint** is `{ stepIndex, headSha, notes, agent? }`, written after every step that finishes (`agent` is the agent loop's own state, which it writes after every model turn and tool call: `docs/code-agent.md`, section 2): the last finished step (-1 before any), the commit the branch was at, and a line in plain words. When a step's place goes quiet the step goes back to `pending` and is placed again; only that step runs again, from the branch as it is. The person gets `job_moved` when it changes kind of place (their PC went offline, it continues on GitHub).

With `CODE_JOBS_MODE=cloudflare` (`docs/cloudflare-jobs.md`) the ticker does not run on the API server: the jobs Worker's one-minute cron runs the same `tick` (and the agent's claim hand-back) over the same Supabase tables, and the server wakes a job's Workflow when a runner reports (`onStepResult`). The placement rules and the lease are unchanged; the one difference is that the Worker cannot see which desktop PCs are online (that is the server's memory), so it places on GitHub's computers or waits.

## 4. The desktop runner protocol

All authenticated as the person; the app names itself with a device id it made. (The desktop app's side comes later.)

* `POST /v1/code/runner/heartbeat` `{ deviceId, name, allowRun, projects: [projectId] | "all" | { allExcept: [projectId] }, busy, capabilities?: { liveOnly, container, os, arch } }`. Protocol version 2 (`docs/desktop-runner-session.md` section 9): the list is no longer cut at 200 (5,000 at most), `allExcept` allows every project of the person but these, and the capabilities say what the computer is (a live-only computer is offered a live session and no ordinary step; one that is not a container is offered steps first). Online for 60 seconds. Send one about every 30. Presence is kept in this server's memory only, so run one backend (as `docker-compose.yml` does) or keep a person's requests on one; a restart only means the next heartbeats put every PC back.
* `GET /v1/code/runner/next?deviceId=&wait=` returns the one step dispatched to this PC, `{ jobId, stepIdx, epoch, projectId, projectName, commands, timeoutSec, repo: { kind, cloneUrl, branch, headSha, readToken?, readTokenExpiresAt?, tarballUrl? } }`, or `204`. It waits up to 25 seconds (`wait` is seconds; 0 answers at once). `repo` is the existing `runnerAccess(…, "read")`: a token for one repo that can read and nothing else; for a sign-in project, a one-time download link instead, and the person's own token is never given to anything.
* `POST /v1/code/runner/decline` `{ jobId, epoch, deviceId }`: "not this computer". The lease is released **at once** (it used to run out after 90 seconds) and the step is placed again, never on a computer that declined it; `409 stale_lease` for a lease the caller does not hold.
* `POST /v1/code/runner/progress` `{ jobId, epoch }` keeps the lease.
* `POST /v1/code/runner/result` `{ jobId, stepIdx, epoch, exitCode, outputTail, minutes, changes?: [{ path, content | null }] }`. At most 4 MB.

GitHub's free computers report on their own route, `POST /v1/code/runner/gh-result`, with GitHub's identity token instead of a session (section 7); it ends in the same `submitResult`.

**A step whose changes the agent wants to read** (`capture: true`: the merge of the default branch into a branch, `docs/pr-care.md` section 5) is not committed by the router at all: the changes are kept on the step (`captured`, the person's code, so cleared as soon as the agent has them and when the job ends), and the only commit is the agent's own, through the policy.

**The PC never holds a token that can write.** Its changes come back in the result and the **server** commits them, through the same policy as any other commit (`commitToBranch`), as a run nobody is watching (`attended: false`). Only a step that exited 0 has its changes committed. Where the policy would ask (a branch Tailzu didn't make, a workflow file, something that looks like a secret) the job goes to `waiting_for_you`, the person gets `commit_ask`, and the changes wait **in the server's memory** (never the database: they may hold the very thing that made it ask). `POST /v1/code/jobs/:id/commit-ok` is the usual two-step question (the first call answers it, the second, with the `approvalId`, commits). If the server restarts first, the step simply runs again. Output is kept to the last 8 KB, and none of it if it looks like it holds a secret.

## 5. For the brain

```
createJob(userId, projectId, branch, task, budgetPaise?, { agent? })  a branch Tailzu made; 20 jobs not over at most; the budget left out is the default
addEditStep(jobId, { summary, files, headSha })           an edit done through the workspace; moves the checkpoint
requestExec(jobId, commands, timeoutSec, estimateMinutes, { overlay?, keepChanges? })
                                                          routes it; one exec step at a time
cancelExec(jobId)                                         drops the step that is out WITHOUT ending the job (whoever asked has stopped waiting)
finishJob(jobId, { ok: true } | { ok: false, reason })    done / failed (job_done, job_failed)
cancelJob(jobId, reason?)                                 nothing more is dispatched; late results are refused
```

**A trial.** `overlay` is a list of `{ path, content | null }` laid over the checkout before the commands run: the agent's staged edits, tried without being committed (at most 200 files and 400 KB of text; never a workflow, a path outside the repo, `.git` or one of Tailzu's runner files). `keepChanges: false` says the step's changes are not wanted, so none are committed whatever the runner sends back. The overlay rides in the step (`code_job_steps.overlay`) and in the shadow branch's `step.json` (`overlay`, `discard`), and is emptied as soon as the step ends: the code is not kept there. A PC's `GET /v1/code/runner/next` carries `overlay` and `discard` too, and must honour both.

Routes for the app: `POST /v1/code/jobs`, `GET /v1/code/jobs`, `GET /v1/code/jobs/:id` (with steps), `POST /v1/code/jobs/:id/cancel`, `…/compute-ok`, `…/commit-ok`, and the settings; and for a job the agent loop is driving, `…/answer`, `…/approve`, `…/deny`, `…/budget`, `…/stop` and `GET …/log` (`docs/code-agent.md`, section 7). A place that runs a step somewhere else (GitHub, paid) reports back by calling `submitResult(userId, result, kind)` with the epoch it was dispatched under.

States: `queued`, `running`, `waiting_for_compute`, `waiting_for_you`, `paused` (reserved for a person pausing by hand; the router never sets it), `done`, `failed`, `cancelled`. A job in `waiting_for_you` says what for in `waiting_on`: `paid` (a yes to paid compute) and `commit` (a yes to committing what a step produced) are the router's own, and the ticker does not move a job waiting for `commit`; `answer`, `approval` and `budget` are the agent loop's, and are the person's alone to end.

**The agent's claim.** An agent job (`code_jobs.agent`) also has a claim of its own, `agent_holder`, `agent_epoch` and `agent_expires_at`, that fences the agent loop's writes the way the lease fences a step's result (`docs/code-agent.md`, section 2). The ticker's pass hands back the claims that ran out, as it takes back leases. The two are independent: the agent holds its claim for the whole job and a lease only while a step is out.

## 6. Telling the person

The router calls an injected `notify(userId, kind, data)`: `compute_ask`, `compute_paused`, `commit_ask`, `job_moved`, `job_done`, `job_failed`, and, for the agent loop, `needs_you` (it is waiting for an answer, a yes or more budget; the push is `code_needs_you`, "Tailzu needs you"). In the server it is the push engine (`notifyCodeJob`), as event pushes that skip the daily caps; the words, the on/off and the screen each are control-plane knobs (`push.code_*`). The push opens `home` until the phone's Code screen exists. A person is told once when a job *enters* a waiting state, not every time a pass finds it still there.

## 7. GitHub's free computers

`GithubActionsProvider` (`code/jobs/githubActions.ts`) runs an exec step as a workflow run in the person's own repo, without touching their work branch. The full story is in `docs/github-app.md`, section 9; in short:

* **A shadow branch per step.** `tailzu-run/<job>-<step>-<epoch>` at one new commit on the job's checkpoint, adding only `.github/workflows/tailzu-run.yml`, `.tailzu/step.json` and `.tailzu/run.mjs`. The script runs the commands, sends the output tail and the changed files, and reports with a GitHub OIDC token to `POST /v1/code/runner/gh-result`. The branch is deleted after.
* **The lease's holder is `<branch>@<commit>`.** The server accepts the result only for that repo, branch, workflow, push and commit, with `aud` = `CODE_RUNNER_OIDC_AUDIENCE`, and then through the same `submitResult` as a PC, epoch fence and policy included. A stale epoch is `409 stale_lease`.
* **The ticker looks at the run** (`ComputeProvider.check`, every 15 seconds) and renews the lease while it goes on, since a computer of GitHub's sends no heartbeat. No run after 3 minutes, or a run that ended without reporting, marks GitHub used up for the month (`code_compute_usage.github_exhausted`) and moves the step like a lease that ran out, with `job_moved`. A run past its timeout plus 2 minutes is cancelled (if the App has Actions: write) and the step is placed again.
* **Minutes** are rounded up per job; a public repo counts none; the person's own CI that would also run on the push (read from `.github/workflows/*`, `ciNoise`) adds an estimate and never blocks.

## 8. Setting up

1. Run `tulmi/supabase/migrations/0023_code_jobs.sql` (or `full_schema.sql`) after 0022, and `0024_code_github_actions.sql` after that (the month's "GitHub is used up" flag). For the agent loop, `0030_code_agent.sql` after `0029` (the agent's claim, three more waits, and the overlay of a step).
2. Optionally set `CODE_GITHUB_FREE_MINUTES` (default 2000), `CODE_RUNNER_OIDC_AUDIENCE` (default `tailzu`), `CODE_JOB_DEFAULT_BUDGET_PAISE` (default 3000) and `CODE_AGENT_CONCURRENCY` (default 4). Give the App Workflows: Read and write and Actions: Read-only (`docs/github-app.md`).
3. Privacy policy: Tailzu now also keeps, per job, the first 500 characters of the task, the commands run, the last 8 KB each step printed, and per month the GitHub minutes and paise used, and whether GitHub's free minutes were found used up. A step run on GitHub also writes its commands to a temporary branch of the person's own repo.

## 9. The live session: session steps and the month's minutes

Only with the jobs on Cloudflare (`docs/cloudflare-jobs.md` section 10); the router changes are all optional and off by default, so the VPS in local mode and every older test behave as before.

**A session step** is an ordinary exec step whose only command is the mark `tailzu:live-session` (`SESSION_COMMAND`, `code/live/protocol.ts`), with `keepChanges: false`. It is **not** run as a command. It is placed like any other step, in the order of section 1, and the place it is given is, with the step, the way into the job's room: an address and a one-time **runner ticket** made for this step and this lease epoch (`code/live/offers.ts`, 15 minutes).

* On **a PC**, `runnerStepFor` adds `session: { url, ticket, expiresAt, idleSec, maxSec }` to the step the PC is given, which the PC uses to connect out to the room (`docs/desktop-runner-session.md`). With the jobs on the Worker the step is sent down the PC's open socket (`UserDevices.offer`); with the HTTP runner, `GET /v1/code/runner/next` carries it.
* On **GitHub's computers**, `.tailzu/step.json` carries the same `session`, and the shadow branch has the session's workflow (`renderSessionWorkflow`: a shallow checkout that keeps no token, Node 22 when needed, the caches, the job's cap as its timeout). A provider that was not given a way into a room does not take a session step (it is not a command to run).
* The step stays out for as long as the session lasts, and the usual rules hold: the lease (a PC keeps it with `progress`), the epoch fence, the ticker's check of the run. When the session closes the runner reports the step like any other (exit code 0, the minutes it lasted), and the router writes the checkpoint note "Closed the live session after N minutes." A job is finished only with no step out; the loop closes the session first, and the Worker gives the step a few seconds to report.

**The month's Actions minutes** (`createJobs({ actions: { monthlyMin } })`, `CODE_ACTIONS_MONTHLY_MIN`, 2,000):

* Every result from GitHub's computers for a **private** repo adds its minutes (rounded up per job) to `code_runner_minutes` (`code_add_runner_minutes`, one SQL call that adds and says whether this call crossed the line). A public repo's are not counted.
* **80%**: one `minutes_low` notification for the month (push `code_minutes_low`: "GitHub minutes running low"). It names the job whose result crossed the line, which is how the push is addressed.
* **95%**: placement no longer chooses GitHub: the step goes to the next place, or waits (`waiting_for_compute`, `compute_paused`) with the reason "free GitHub minutes are used up", and it goes on when a place frees up or the month turns over.
* The count placement uses is the larger of this ledger and `code_compute_usage.github_minutes`, so turning the ledger on mid-month gives no fresh allowance. Without `actions`, the older rule (a tenth kept back) applies and `GET /v1/code/settings/compute` says `headroomPercent: 10`; with it, `5`.
* The new notification kind is `minutes_low`; the VPS's internal notify route and the Worker's hand-off take eight kinds now.

Tests: `tests/code-live-minutes.test.ts` (the lines, the store's one-call crossing, the migration, the router at 80% and 95% and a public repo, a session step's offer to a PC and to GitHub), `tests/code-live-workflow.test.ts` (the session workflow as a golden file and step.json), `tests/code-live-runner.test.ts` (`run.mjs`'s session mode).
