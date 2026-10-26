# The Code bot's environment router

A coding task is a **job**. It runs as **steps**. An **edit** step (read, change and commit files through GitHub's API) needs no computer. An **exec** step (install, build, test) does, and the router decides where it runs, using the cheapest place there is. The agent's brain that makes the steps is not built yet: the router is driven by the methods in `tulmi/src/code/jobs/router.ts`, which the brain and the tests call.

Switched on with the rest of the Code bot (`CODE_GITHUB`), after `tulmi/supabase/migrations/0023_code_jobs.sql`.

## 1. Where an exec step runs

In this order, the first that fits (`code/jobs/placement.ts`, one pure function, tested against every combination):

1. **The person's own PC.** Free, and the code never leaves their machine. A Tailzu desktop app of theirs must be online, have "run commands" switched on, be allowed on this project, and not be busy.
2. **GitHub's free computers (GitHub Actions).** Free up to GitHub's monthly allowance: 2,000 minutes on a free plan (`CODE_GITHUB_FREE_MINUTES`). That allowance is shared with everything else the person runs there, so Tailzu counts only its own use and keeps **a tenth back**: with nothing used, 1,800 minutes are Tailzu's. It counts only if the project has it set up (the provider says so) and the person hasn't switched it off. *The provider is the next step; the router already has its interface (`GithubActionsProvider`).*
3. **Paid compute**, and only by the person's own rule (below). *Interface only for now (`PaidProvider`).*
4. **Otherwise the job waits** (`waiting_for_compute`), the person is told (`compute_paused`), and it carries on by itself when a place frees up: a PC sends a heartbeat, a result frees a PC, the month turns over, or a setting changes.

A server with no GitHub or paid provider never chooses them, and says so in the reason it gives.

## 2. The person's paid rule

Settings, `GET` and `PUT /v1/code/settings/compute`:

| `paidRule` | What happens when only paid compute is left |
| --- | --- |
| `never` (the default) | It isn't used. The step waits. |
| `ask` | The job goes to `waiting_for_you` and the person gets `compute_ask` with the price. `POST /v1/code/jobs/:id/compute-ok` says yes for **this job**: it raises the job's budget by what the step is expected to cost (or `maxPaise`), and later steps of the job that fit that budget run without asking again. |
| `auto` | It is used without asking while this month's paid use stays inside `autoCapPaise`. Beyond the cap it asks, as `ask` does. |

`never` beats everything, including a budget the person said yes to earlier. A step is never sent to paid compute that doesn't exist on the server; it waits instead of asking for money that can't be spent. A free place that appears while a job waits for a yes takes the job; the question goes away.

A job's `budgetPaise` is what the person has said it may spend (`createJob` can start it above 0). What a paid place reports it used goes into the job's `spentPaise` and the month's `paidPaise`. GitHub minutes go into the month's `githubMinutes`. The month is the calendar month in UTC (`code_compute_usage`).

## 3. Leases, fencing and checkpoints

A step that is out has a **lease**: one holder (a device id, a run id), an expiry **90 seconds** ahead, and an **epoch** that goes up by one on **every dispatch**. The holder keeps the lease with a heartbeat from a PC that says it is busy running the step, or with `progress` for the job. Every result and every progress call carries the epoch it was given; anything with an older one is refused as `409 stale_lease`. So a PC that went quiet and was replaced can never count: two machines never both count. Until the ticker has taken a lease back, the holder with the current epoch is still the holder, so a result a few seconds late still lands if nobody else has been given the step. The same result sent twice is counted once.

The **ticker** (`code/jobs/ticker.ts`, every 15 seconds, started when the server is ready and stopped when it closes, like the stuck-task sweeper) takes back leases that ran out, places the step again, and gives waiting jobs another look. A job whose lease is lost **five times** is failed, with the reason, and the person gets `job_failed`.

Every change that depends on the lease goes through the store's `casJob` (the epoch, the state and the expiry must still be what the caller read), and everything for one person runs under one lock, so a ticker, a request and a second server can't both win.

The **checkpoint** is `{ stepIndex, headSha, notes }`, written after every step that finishes: the last finished step (-1 before any), the commit the branch was at, and a line in plain words. When a step's place goes quiet the step goes back to `pending` and is placed again; only that step runs again, from the branch as it is. The person gets `job_moved` when it changes kind of place (their PC went offline, it continues on GitHub).

## 4. The desktop runner protocol

All authenticated as the person; the app names itself with a device id it made. (The desktop app's side comes later.)

* `POST /v1/code/runner/heartbeat` `{ deviceId, name, allowRun, projects: [projectId] | "all", busy }`. Online for 60 seconds. Send one about every 30. Presence is kept in this server's memory only, so run one backend (as `docker-compose.yml` does) or keep a person's requests on one; a restart only means the next heartbeats put every PC back.
* `GET /v1/code/runner/next?deviceId=&wait=` returns the one step dispatched to this PC, `{ jobId, stepIdx, epoch, commands, timeoutSec, repo: { kind, cloneUrl, branch, headSha, readToken?, readTokenExpiresAt?, tarballUrl? } }`, or `204`. It waits up to 25 seconds (`wait` is seconds; 0 answers at once). `repo` is the existing `runnerAccess(…, "read")`: a token for one repo that can read and nothing else; for a sign-in project, a one-time download link instead, and the person's own token is never given to anything.
* `POST /v1/code/runner/progress` `{ jobId, epoch }` keeps the lease.
* `POST /v1/code/runner/result` `{ jobId, stepIdx, epoch, exitCode, outputTail, minutes, changes?: [{ path, content | null }] }`. At most 4 MB.

**The PC never holds a token that can write.** Its changes come back in the result and the **server** commits them, through the same policy as any other commit (`commitToBranch`), as a run nobody is watching (`attended: false`). Only a step that exited 0 has its changes committed. Where the policy would ask (a branch Tailzu didn't make, a workflow file, something that looks like a secret) the job goes to `waiting_for_you`, the person gets `commit_ask`, and the changes wait **in the server's memory** (never the database: they may hold the very thing that made it ask). `POST /v1/code/jobs/:id/commit-ok` is the usual two-step question (the first call answers it, the second, with the `approvalId`, commits). If the server restarts first, the step simply runs again. Output is kept to the last 8 KB, and none of it if it looks like it holds a secret.

## 5. For the brain

```
createJob(userId, projectId, branch, task, budgetPaise)   a branch Tailzu made; 20 jobs not over at most
addEditStep(jobId, { summary, files, headSha })           an edit done through the workspace; moves the checkpoint
requestExec(jobId, commands, timeoutSec, estimateMinutes) routes it; one exec step at a time
finishJob(jobId, { ok: true } | { ok: false, reason })    done / failed (job_done, job_failed)
cancelJob(jobId)                                          nothing more is dispatched; late results are refused
```

Routes for the app: `POST /v1/code/jobs`, `GET /v1/code/jobs`, `GET /v1/code/jobs/:id` (with steps), `POST /v1/code/jobs/:id/cancel`, `…/compute-ok`, `…/commit-ok`, and the settings. A place that runs a step somewhere else (GitHub, paid) reports back by calling `submitResult(userId, result, kind)` with the epoch it was dispatched under.

States: `queued`, `running`, `waiting_for_compute`, `waiting_for_you`, `paused` (reserved for a person pausing by hand; the router never sets it), `done`, `failed`, `cancelled`.

## 6. Telling the person

The router calls an injected `notify(userId, kind, data)`: `compute_ask`, `compute_paused`, `commit_ask`, `job_moved`, `job_done`, `job_failed`. In the server it is the push engine (`notifyCodeJob`), as event pushes that skip the daily caps; the words, the on/off and the screen each are control-plane knobs (`push.code_*`). The push opens `home` until the phone's Code screen exists. A person is told once when a job *enters* a waiting state, not every time a pass finds it still there.

## 7. Setting up

1. Run `tulmi/supabase/migrations/0023_code_jobs.sql` (or `full_schema.sql`) after 0022.
2. Optionally set `CODE_GITHUB_FREE_MINUTES` (default 2000).
3. Privacy policy: Tailzu now also keeps, per job, the first 500 characters of the task, the commands run, the last 8 KB each step printed, and per month the GitHub minutes and paise used.
