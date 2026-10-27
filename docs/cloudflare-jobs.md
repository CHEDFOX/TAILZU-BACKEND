# The Code bot's jobs on Cloudflare

The Code bot's long work (the agent loop of `docs/code-agent.md`, the project brain's builds of `docs/code-project-brain.md`) can run on **Cloudflare Workflows** while the API server stays on the VPS. It is optional, off by default, and the VPS behaves exactly as it always has until you switch it on (`CODE_JOBS_MODE=local`).

Why: a job is dozens of model turns, sometimes for hours, and waits days for a person. On the VPS that is a process that must stay up and a lease to keep alive. A Workflow instance is kept by Cloudflare: it survives a restart or deploy of anything, waits for free while it sleeps, and is retried by the platform.

The Worker is `jobs/`. It contains **no copy of the logic**: it imports `tulmi/src/...` and Wrangler bundles it. A fix to the loop is a fix for both.

On top of that the Worker has a **live session** (section 10): a copy of a job's code kept in a Durable Object so the bot reads and searches it at once, a runner kept open for the whole job so a command takes about a second, and the person's own computers as the first place to run. It is on by default with `cloudflare` and can be switched off with `CODE_LIVE_SESSION=false`.

## 1. The split

| | VPS (`tulmi/`) | Cloudflare (`jobs/`) |
| --- | --- | --- |
| The API, sign-in, every route the app calls | yes | no |
| `POST /v1/code/jobs`, answer / approve / deny / budget / stop | accepts, checks the owner, writes the person's word into Supabase, **then calls the Worker** | |
| The agent loop (plan, work, verify, commit, PR, report) | only with `CODE_JOBS_MODE=local` | one Workflow instance per job |
| The project brain's builds | only with `local` | one Workflow instance per build |
| The router's ticker (leases, steps out on GitHub, jobs waiting for a place) | only with `local` | cron, every minute |
| Push notifications (`needs_you`, `job_done`, ...) | **yes, always**: the push credentials never leave the VPS | asks the VPS with a signed call |
| The desktop runner routes, GitHub's runner reports (`/v1/code/runner/*`) | yes (the old HTTP runner; and the passes for the live session's sockets) | |
| Which of a person's computers are online (presence) | in `local` mode only | `UserDevices`, one Durable Object per person, over WebSockets the desktop app keeps open (section 10) |
| A job's copy of the code, its open runner, the app's live view | | `JobRoom`, one Durable Object per job (section 10) |
| Supabase | shared: the same project, the same `code_*` tables | reads and writes with the service key |
| GitHub App key, OpenRouter key | has them | has them too (secrets, section 4) |
| A page that needs a browser | `WEB_BROWSER=chrome` or `cloudflare` | `WEB_BROWSER=cloudflare` (Browser Rendering's REST API) |

### The flow

```
 app ──► VPS  POST /v1/code/jobs ──► row in Supabase (code_jobs)
              │
              └── signed POST {CODE_JOBS_URL}/v1/start {jobId} ─────────────► Worker
                                                                             │ AGENT_JOB.create({id: jobId})   (exists? fine)
                                                                             ▼
                                                              AgentJob Workflow instance (id = jobId)
                                                                step advance-0 ─► one advance of the loop
                                                                step advance-1 ─► ...
                                                                │  the loop parks: needs the person
                                                                ▼
                                    Worker ── signed POST /v1/internal/code/notify ──► VPS ─► push to the owner
                                                                step.waitForEvent("wake", PERSON_WAIT)
 app ──► VPS  POST .../answer ──► Supabase gets the answer, then
              └── signed POST {CODE_JOBS_URL}/v1/event {jobId, kind} ─────► Worker ─► instance.sendEvent("wake")
                                                                step advance-n ─► the loop reads the answer, goes on
                                                                ... commit, PR, report ► job_done (notify again) ► instance ends
```

**What travels is only ids.** Both directions carry a job id and a kind (`answer`, `approve`, `deny`, `budget`, `stop`, `runner`). What the person said, the plan, the staged files and the work log are in Supabase, where they always were, so a message that is lost, late, repeated or replayed can at worst make the Worker look at a job that has not changed.

## 2. How a job runs on the Worker

`jobs/src/agentJob.ts`. The instance id **is the job id**, so starting twice is one job.

* **One advance per step.** `step.do("advance-<n>")` asks the orchestrator for one advance (`AgentOrchestrator.advance`, `advanceLoop` in `tulmi/src/code/agent/loop.ts`): claim the job, run the phase it is in up to its next checkpoint (in the work phase, `ADVANCE_TURNS` model rounds, default 2), let the claim go. It returns a small value, never state:
  `{next: "continue"} | {next: "wait", waitingOn, wakeAt?, waitMs?} | {next: "end", why}`.
* **Waits are Workflow waits, not polling.**
  * the person (a question, an approval, more money): `step.waitForEvent("wake", {timeout: PERSON_WAIT})`, 7 days by default. `waitForEvent` **throws** on a timeout, so it is caught and the job is ended with a report that says nobody came; what was committed stays on the branch.
  * a step out on a runner (GitHub's computers): `waitForEvent("wake")` for 10 s, then 30, then 60. The VPS wakes it the moment the runner reports (`onStepResult`); otherwise the time is simply up and the step is looked at.
  * a claim someone else holds, or a failure being backed off from: `step.sleep` for the time given.
* **The claim is the second guard.** The Workflow engine runs a step to completion and retries it on failure; the job's own claim (`agent_holder`, `agent_epoch`, `agent_expires_at`, `docs/code-agent.md` section 2) makes sure that even a retried or doubled step runs nothing twice: every write the loop makes carries the epoch, so a step that was cut off cannot write after its replacement has begun. The holder name includes the step's attempt number.
* **Checkpoints stay in Supabase**, as before: after every model turn and every tool call. A Workflow step's result is a few bytes (the 1 MiB limit per step is nowhere near).
* **A job cannot loop for ever.** At most 3,000 advances (a Workflow may have 10,000 steps, each advance and each wait is one), then it is ended with a report. A step that runs out of retries ends the job with a plain reason instead of leaving it running with nobody to drive it.
* **The cron is the safety net.** Every minute it runs the router's ticker (leases that ran out, steps out on GitHub that never reported, jobs waiting for a place), hands back agent claims that ran out, and nudges any agent job that nobody has driven for five minutes: it wakes its Workflow, makes it if the VPS's `/v1/start` never arrived, or runs it again if it ended. So a lost `/v1/event` is harmless.

### The project brain

`jobs/src/buildBrain.ts`, instance id `brain-<projectId>-<headSha>` (83 characters; the limit is 100), so one build per head however often it is asked for. A finished instance of that id is deleted and made again when a rebuild is asked for (`restart()` would reuse the old parameters).

Two steps: `check` (is it still wanted? a brain already ready at this commit is not built again) and `build`. **The build is one step on purpose.** The snapshot, the per-file analysis, the import graph and the words are one function over tens of megabytes held in memory from stage to stage; a step may hand on 1 MiB, so splitting it would mean rewriting the build to save and reload between stages. It does save as it goes (the analysis at 70%, the words later; a rebuild pays only for what is missing) so a retry after a crash is cheap. The step gets the Worker's raised CPU limit (`limits.cpu_ms` 300,000 = 5 minutes, the most Workers Paid allows) and a 30-minute timeout. Waiting on GitHub, Supabase and the model is not CPU time.

**The risk to know about is memory, not time:** an isolate has 128 MB. The build holds at most 60 MB of text, and a repo that does not fit makes the step fail (the brain's row says why) rather than be half-read. If that happens for real repos, the fix is to save and reload between stages, which is a change to `tulmi/src/code/project/build.ts` that both sides would share.

## 3. The signed calls

Every call in both directions is `POST` with a small JSON body and three headers. `tulmi/src/code/jobs/handoff/sign.ts`, used by both sides.

* Signature: HMAC-SHA256 over `METHOD \n PATH \n TIMESTAMP \n NONCE \n BODY`, key `CODE_JOBS_SECRET`, compared in constant time. The **nonce is inside the signature**, so it cannot be swapped for a fresh one on a recorded request.
* The timestamp must be within **5 minutes** of the verifier's clock. Each nonce is accepted **once**: the Worker keeps them in a Durable Object (SQLite) for ten minutes (`jobs/src/nonceGuard.ts`), the VPS in memory.
* A body over 16 KB is refused unread. Answers carry a short code (`bad_signature`, `expired`, `replayed`, `bad_request`) and never a value from the request or the environment.
* **Retries:** the VPS tries up to **3** times (a new timestamp and nonce each time, 10 s each, waits of 0.5 s and 2 s) on a network failure, a timeout, 408, 425, 429 or 5xx. Any other answer is final. If `start` cannot get through, **the job is marked failed with a reason the person can read** ("Tailzu could not hand this job to the machine that runs it, after trying three times. Nothing was changed. Try again in a little while."); a brain build's row is marked `failed` the same way. A `wake` that cannot get through is only logged: the person's word is already in the database and the cron looks again.
* The calls from the VPS are `/v1/start`, `/v1/event`, `/v1/brain` and `/v1/message` (the person's word to a working job: it goes into the job's room, which wakes the Workflow). The WebSockets are not signed calls: they open with a **ticket** (section 10).
* `POST /v1/internal/code/notify` on the VPS is open only when `CODE_JOBS_MODE=cloudflare` and a secret is set (otherwise 404, as if it did not exist). The body names a job, never a person: the VPS looks the owner up itself. A job that does not exist is 404; a job that is not an agent job is 403. `kind` must be one of the eight the router knows (`minutes_low` is the newest); `text` is cut to 300 characters.

## 4. What to set

### On the Worker (`jobs/wrangler.jsonc`)

Plain settings are in `vars` (a few are blank for you to fill in); **secrets are not in the file**, they are set one by one:

| Secret | What |
| --- | --- |
| `CODE_JOBS_SECRET` | The same value as on the VPS. `openssl rand -hex 32`. Signs every call in both directions. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | The same Supabase project as the VPS. The jobs read and write the `code_*` tables with the service key. |
| `OPENROUTER_API_KEY` | The model door. |
| `GITHUB_APP_CLIENT_SECRET` | The GitHub App's, as on the VPS. |
| `GITHUB_APP_PRIVATE_KEY` | The App's private key: PEM, or base64 of it. The PKCS#1 file GitHub gives you works as it is (the Worker converts it, section 6). |
| `CONNECTOR_TOKEN_KEY` | The VPS's value (32 bytes, base64). It opens the stored GitHub sign-in tokens. |
| `CLOUDFLARE_API_TOKEN` | An API token with **Browser Rendering - Edit**. |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | Only with `CODE_GITHUB_OAUTH=true`. |

`vars` to fill in: `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_ID`, `CLOUDFLARE_ACCOUNT_ID`, and `PUBLIC_ORIGIN` (the VPS's own address: the Worker's calls back go there). `ADVANCE_TURNS` (2) and `PERSON_WAIT` (`7 days`) are tunable. `RUNTIME=worker` is set for you.

For the live session (section 10) the Worker also takes five plain `vars`: `CODE_JOBS_URL` (**this Worker's own public address**, the same value as on the VPS: runners are told to connect to it; **blank means the live session is off**), `CODE_LIVE_SESSION` (`true`), `CODE_SESSION_IDLE_SEC` (`120`), `CODE_SESSION_MAX_MIN` (`20`) and `CODE_ACTIONS_MONTHLY_MIN` (`2000`). There is no new secret: the tickets are signed with `CODE_JOBS_SECRET`, which both sides already have.

**Not on the Worker, on purpose:** push credentials (they stay on the VPS), the speech and payment keys, `GITHUB_APP_WEBHOOK_SECRET` (the webhooks still arrive at the VPS).

### On the VPS (`tulmi/.env`)

```
CODE_JOBS_MODE=cloudflare
CODE_JOBS_URL=https://tailzu-jobs.<your-subdomain>.workers.dev
CODE_JOBS_SECRET=<the same value>
# the live session (section 10); these are the defaults, set them only to change them. Set the same values on the Worker.
CODE_LIVE_SESSION=true
CODE_SESSION_IDLE_SEC=120
CODE_SESSION_MAX_MIN=20
CODE_ACTIONS_MONTHLY_MIN=2000
```

`CODE_GITHUB` and `CODE_PROJECT_BRAIN` stay on, as in local mode. With `cloudflare` the VPS starts **no** agent orchestrator and **no** ticker. A start that cannot reach the Worker fails the job with a reason instead of hanging; the config warns on boot if the URL or the secret is missing, if the URL is not https, or if the secret is under 32 characters.

## 5. Deploy

Needs a Cloudflare account on **Workers Paid** (raising the CPU limit past 30 s and the volume of Workflow steps need it; see section 7). Run `tulmi/supabase/migrations/0031_code_runner_minutes.sql` (or `full_schema.sql`) first if you want the live session: it keeps the month's GitHub Actions minutes.

```bash
cd jobs
npm ci                         # exact-pinned; .npmrc sets legacy-peer-deps, see section 8
npx wrangler login             # opens a browser; or set CLOUDFLARE_API_TOKEN for CI

# 1. Fill in the blank vars in wrangler.jsonc (GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_ID,
#    CLOUDFLARE_ACCOUNT_ID, PUBLIC_ORIGIN).

# 2. Deploy. This creates both Workflows, the three Durable Objects (migration tags v1 and v2) and the cron. Until the secrets are in
#    (next step) the Worker answers /v1/health but a job cannot run, and the cron logs why.
npx wrangler deploy

# 3. The secrets, one each (each takes effect at once):
npx wrangler secret put CODE_JOBS_SECRET
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GITHUB_APP_CLIENT_SECRET
npx wrangler secret put GITHUB_APP_PRIVATE_KEY      # paste the PEM, or `base64 -w0 key.pem`
npx wrangler secret put CONNECTOR_TOKEN_KEY
npx wrangler secret put CLOUDFLARE_API_TOKEN
# (or all at once from a JSON file, deleted afterwards: npx wrangler secret bulk secrets.json)

# 4. Check
curl https://tailzu-jobs.<your-subdomain>.workers.dev/v1/health          # {"ok":true}
npx wrangler workflows list                                              # tailzu-agent-job, tailzu-build-brain
```

Then on the VPS: set the three variables of section 4, `docker compose up -d --build` (see `DEPLOY.md`), and make a job from the app. To follow it:

```bash
npx wrangler workflows instances list tailzu-agent-job
npx wrangler workflows instances describe tailzu-agent-job <jobId>       # steps, retries, errors
npx wrangler tail                                                        # live logs (observability is on)
```

**Cron changes take a while to propagate** (the docs say up to 15 minutes), so the ticker may not run for the first minutes after the first deploy; the jobs themselves do not depend on it. **To go back** to the VPS: set `CODE_JOBS_MODE=local` and restart. A job that was running on the Worker is an ordinary agent job in Supabase: the VPS's orchestrator picks it up from its checkpoint once the Worker's claim has run out (at most 5 minutes). Terminate the Worker's instances (`npx wrangler workflows instances terminate tailzu-agent-job <jobId>`) so that the two do not take turns; the claim keeps a stray step from writing in any case.

## 6. Where the shared code had to change to run on a Worker

None of it changes what the VPS does. The tests of the VPS side are the old tests plus new ones.

* **`safeFetch` seam** (`tulmi/src/web/safeFetch.ts`). Everything that fetches a stranger's address (the page reader, the search sources, the resource finder) goes through a function the runtime installs. The VPS installs `egressFetch` (resolves the name inside the connection and refuses a private answer); the Worker installs `workerSafeFetch` (`web/workerSafeFetch.ts`): https only, ports 443 and 8443, no `user:pass@`, no address written as an IP, no `localhost` / `.internal` / `.local` and similar names, redirects walked by hand (at most 3, each hop checked), the same size caps and timeouts. With nothing installed the seam **fails closed**.
  **What it does not do, and why that is acceptable:** a public name that resolves to a private address (DNS rebinding) is not caught by the Worker's guard. A Worker's `fetch()` leaves from Cloudflare's network, which has no route to our private addresses (a Worker reaches a private network only through Workers VPC or a Tunnel binding, which this Worker does not have), and it cannot fetch a raw IP ([known issues](https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses)). That is **relied on, not tested here**, and the Worker holds no credential that a fetched page could be tricked into carrying.
* **The GitHub App JWT.** GitHub gives the key as PKCS#1 (`BEGIN RSA PRIVATE KEY`). Node's `createPrivateKey` reads that; WebCrypto and jose's `importPKCS8` do not. The Worker mode (`GithubApp` option `keyMode: "webcrypto"`) rewraps PKCS#1 as PKCS#8 (a fixed ASN.1 header around the same bytes, `tulmi/src/code/appKey.ts`) and signs with jose `importPKCS8`; a key that is already PKCS#8 passes through. The VPS path is unchanged. Both are tested.
* **`cloudflareRenderer`** (`web/browser/cloudflare.ts`). `getRenderer()` returns it for `WEB_BROWSER=cloudflare` (the VPS can use it too). It POSTs to `https://api.cloudflare.com/client/v4/accounts/<id>/browser-run/content` with the API token and gets the rendered HTML back, then the reader's own extractor and safety rules run on that, as for the VPS's Chrome. The address is judged before it is sent and the page's final address (`meta.finalUrl`) afterwards.
* **Config** reads `process.env`, which the Worker fills from `env` (`jobs/src/env.ts` does it itself on every entry, and sets `RUNTIME=worker`). With `RUNTIME=worker` the settings only the VPS needs (speech keys, etc.) are not asked for. `dotenv` is aliased to an empty shim in `wrangler.jsonc`.
* **Approvals across processes.** An approval used to live in the VPS's memory. The plan phase now keeps the approval record in the job's state (`Waiting.approval.bound`) and the next advance restores it (`approvals.ts` `peek` / `restore`), so a person's yes reaches a loop running in another process.
* **Import graph.** The Worker imports only what it needs: the bundle has no undici, no `node:dns` / `node:net`, no Groq or MCP SDK. Types and a few functions the Worker needs were moved to neutral files (`connectors/egressTypes.ts`, `connectors/state.ts`, `pipeline/openrouter.ts`, `pipeline/script.ts`, `web/browser/types.ts`) and re-exported from where they were.

### Known limits of cloud mode

* **A person's own computer is used for jobs the Worker runs only when the desktop app speaks the new protocol** (`docs/desktop-runner-session.md`): it keeps a WebSocket open to the Worker, which is how the Worker knows it is online (section 10). An app that only sends the old HTTP heartbeat is invisible to the Worker's router, which then places the step on GitHub's free computers, or waits, or asks about paid compute. (This was a gap before the live session: presence was in the VPS's memory only.)
* A very large repo can exhaust a brain build's memory (section 2).
* The agent state lives in Supabase between advances, which costs a read and a write per advance that the in-process loop did not pay.

## 7. Costs and limits

Checked against the live docs on 2026-10-27. Prices change; the pages are the authority.

| What | Limit or price | Page |
| --- | --- | --- |
| Plan | Workers Paid: the Free plan allows 10 ms of CPU and 50 subrequests, far under what a job needs. Paid gives 30 s of CPU (raisable to 5 min), 10,000 subrequests (raisable) and 50,000 concurrent Workflow instances | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| CPU per step | 30 s default; `limits.cpu_ms` up to 300,000 (5 min). This Worker asks for 300,000 | [Workers limits: CPU time](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) |
| Memory | 128 MB per isolate | [Workers limits: memory](https://developers.cloudflare.com/workers/platform/limits/#memory) |
| Subrequests | 10,000 per invocation by default, up to 10 million; this Worker asks for 100,000 | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| Worker size | 64 MiB per the Workers limits page (the Workflows limits page still says 3 MB Free and 10 MB Paid). This bundle is 2,486 KiB, about 2.4 MiB (601 KiB gzip), under all of them | [Workers limits: Worker size](https://developers.cloudflare.com/workers/platform/limits/#worker-size) |
| Step result, event payload | 1 MiB each (a job's steps return a few bytes) | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| Steps per instance | 10,000 default, up to 25,000 (a job is capped at 3,000 advances) | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| `step.sleep` / waiting | up to 365 days; a waiting instance does not count toward concurrency | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| Instance id | at most 100 characters of letters, digits, `-`, `_` | [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/) |
| Event type | letters, digits, `-`, `_` only (a `.` is refused), so the event is `wake` | [Events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/) |
| Retention | set to 3 days (done) / 14 days (failed) for jobs and 1 / 3 for brain builds, to keep storage small; the default is 30 days on Paid | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) |
| Workflows price | CPU and requests at Workers prices; **steps** 500,000 a month included then $0.80 per 100,000, **storage** 1 GB-month included then $0.20 per GB-month (steps and storage have been billed since 10 August 2026) | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) |
| Cron | UTC; a trigger takes up to 15 minutes to take effect after a change; 30 s of CPU for a trigger more often than hourly, 15 minutes of wall time | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) |
| Browser Rendering ("Browser Run") | 10 hours a month included on Paid, then $0.09 per hour; 30 requests per second on `/content`; a browser timeout of 60 s | [pricing](https://developers.cloudflare.com/browser-run/pricing/), [limits](https://developers.cloudflare.com/browser-run/limits/), [`/content`](https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/) |
| Durable Objects (the live session) | Paid, SQLite-backed: 1 million requests a month included then $0.15 per million; **duration** 400,000 GB-s included then $12.50 per million GB-s, charged on the object's 128 MB; SQLite **rows read** 25 billion included, **rows written** 50 million included then $1.00 per million (a delete is a row written, and each `setAlarm` is one), **stored data** 5 GB-month included then $0.20 per GB-month. A request is an HTTP request, an RPC call, an alarm, or a WebSocket message; incoming WebSocket messages are billed at 20 to 1 (100 messages are 5 requests), outgoing messages and protocol pings are free | [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Object limits | 10 GB of SQLite per object; a row, string or blob at most 2 MB; at most 100 bound parameters per query; a `LIKE`/`GLOB` pattern at most 50 bytes; an incoming WebSocket message at most 32 MiB (the room refuses more than 2 MB itself); 500 classes per account on Paid | [limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Node.js compatibility | `nodejs_compat`; from compatibility date 2026-08-04 it is on by default (the flag is kept so the file means the same with an older date) | [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) |

**A rough bill, as an estimate and not a measurement.** A job's cost on Cloudflare is its **steps** (one per advance, one per wait, so a job of 30 model turns is on the order of 40 to 60 steps) plus a little CPU: the model's time is waiting, which is free. 500,000 included steps is then roughly 10,000 jobs a month before the $0.80 per 100,000 starts. The cron is 43,200 invocations a month, far inside the 10 million requests included. The cost that dominates is still the model, which is the person's budget as before (`docs/code-agent.md` section 5). Read the real numbers from the Workflows page in the dashboard after the first week.

## 8. Cloudflare facts that differ from what was assumed

Found by reading the current docs, and what was done about each:

1. **`vitest-pool-workers` is deprecated.** It is now `@cloudflare/vitest-plugin` (`cloudflareTest()` in the Vite config), which needs Vitest 4. `jobs/` uses it, with Vitest 4.1.12 exact-pinned ([migration guide](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/)).
2. **"Browser Rendering" is now "Browser Run"**, and the REST path is `/browser-run/content` on the product page but still `/browser-rendering/content` in the API reference. The renderer tries the first and falls back to the second on a 404. The page also describes a Workers binding that needs no API token; the task asked for the REST API with a token and that is what is built.
3. **`waitForEvent` throws on a timeout** (it does not return empty), so the person-wait catches it and ends the job with a report.
4. **`Workflow.create` throws if the id exists**, and **`restart()` keeps the old parameters**. Start is "create, and if it fails because the instance is there, that is the answer"; a brain build asked for again after it finished is deleted and created fresh.
5. **`NonRetryableError` is imported from `cloudflare:workflows`**, not `cloudflare:workers`.
6. **Event types may not contain a `.`.**
7. **The size limit is 64 MiB on the Workers page and 3/10 MB on the Workflows page.** The bundle is under both.
8. **Compatibility date 2026-08-04 or later turns `nodejs_compat` on by itself.** The newest date the pinned workerd (1.20261023.1) runs is 2026-10-23, which is the one used.
9. **`process.env` is filled from `env` by the runtime** with `nodejs_compat` and a recent date; `jobs/src/env.ts` does not rely on it and copies the bindings itself.
10. **A Worker cannot fetch a raw IP address.** The guard refuses IP literals outright, which agrees.
11. **`npm install` crashes** on this dependency tree without `legacy-peer-deps` (npm's arborist, with the vitest plugin's peer range); `jobs/.npmrc` sets it and the lockfile was checked with `npm ci`.

Found while building the live session (section 10):

12. **`Date.now()` in a Worker only moves when the code waits for I/O.** A search that never waits would never see time pass, so a time budget alone cannot stop a slow `grep` there (it can in Node). The search keeps the time budgets the task asked for (250 ms a file, 2.5 s in all) *and* a deterministic **work budget** (characters tested: 600,000 a file, 30 million in all). Whichever runs out first cuts the search short with `partial: true`. The tests run both: the time budget in Node, the work budget in workerd.
13. **A JavaScript regular expression cannot be interrupted**, in a Worker or anywhere, and there is no RE2. A pattern like `(a+)+$` on a long line can run for ever inside one call. So a pattern is read before it is run and refused if it has a back-reference, a repeated group with a repeat inside it, alternatives that overlap under an open-ended repeat, or more than five open-ended repeats (`patternProblem` in `tulmi/src/code/live/search.ts`); a pattern is at most 300 characters; a line is cut to 1,000 characters before it is tested; and the budgets above bound what is left. This is a reading of the pattern's shape, not a proof. A repo too big for the room is searched by `git grep` on the runner, which has PCRE's own backtrack limit.
14. **`LIKE` and `GLOB` in a Durable Object's SQLite take a pattern of 50 bytes at most**, and a query 100 bound parameters, so the search is not done in SQL: the room reads the rows and runs the search in JavaScript. Files go in 50 at a time inside `transactionSync`.
15. **`deleteAll()` removes the object's alarm only from compatibility date 2026-02-24.** The room calls `deleteAlarm()` and then `deleteAll()`, which is right for any date. The Worker's date is 2026-10-23.
16. **A hibernating object forgets everything in memory.** So nothing that must survive is in a field: a room keeps its session, queue and results in SQLite, a device its state in the socket's attachment (16 KB). The only timer is a search forwarded to a runner, which is a call the caller is waiting on.
17. **An exact-text auto-response is free.** `setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))` answers without waking the object and adds no duration. The desktop app's keepalive is therefore the plain text `ping`, not a JSON frame.
18. **A Workflow cannot wait on a long call into a Durable Object.** A command takes seconds to minutes; holding an RPC open for it would hold the step, and the object awake. The room returns at once, and when the runner reports it **sends the Workflow an event** (`sendEvent`, the same `wake` the person's answers use); the next advance asks for the result. Nothing waits on a socket.
19. **GitHub's `ubuntu-latest` Node may be older than 22**, and a global `WebSocket` needs 22. The session workflow tests for one (`node -e` on `typeof WebSocket`) and runs `actions/setup-node@v4` for Node 22 only when it is missing, so the common case does not pay for it.

## 9. Verified here, and what needs a real deploy

**Verified locally** (`cd jobs && npx vitest run`, `cd tulmi && npx vitest run`; the Workers tests run inside workerd through `@cloudflare/vitest-plugin`):

* The signature: good, bad, wrong secret, wrong path, changed body, expired, from the future, **replayed** (the real Durable Object), and a call back from the Worker to the VPS's notify route.
* Idempotent start (twice is one instance), events reaching a waiting instance, an event sent before the wait began, a Workflow ending when the job ends.
* **The whole agent loop inside workerd**: plan, edit, runner checks, commit, PR, a wait for an answer, finish, advance by advance with the real orchestrator over the test rig.
* The AgentJob Workflow through a scripted loop: continue, each kind of wait, a wait that times out, a step that throws and is retried, a job that never ends.
* A real project-brain build, full and incremental, inside workerd; the BuildBrain Workflow; the cron calling the ticker and rescuing a job nobody drives.
* `workerSafeFetch`'s rules; the PKCS#1-to-PKCS#8 JWT against WebCrypto; the Cloudflare renderer with a fake `fetch`; the config with `RUNTIME=worker`; the VPS hand-off client (retries, final answers, the failed-job reason) and notify route (signatures, owner rules).
* The live session (section 10): the room's copy (unpacking a tarball, the skip rules, secret files never held or named, the 50 MB cap and `remote`, the staged edits laid over reads, the search's ReDoS cuts, `deleteAll` at the job's end, the six-hour alarm), the runner hub (one-time tickets for the right job, step and lease; a command round trip with a fake runner; the overlay sent with it; idle, needs-you and cap closes), a person's computers online or offline and chosen first, the viewer socket (owner's ticket only) and a mid-task message reaching the model's next turn, all inside workerd. On the VPS side: the minutes ledger and its two lines, the loop's hooks and their order, the routes for the passes and the message, and `run.mjs`'s session mode run by `node` against a fake room.
* The bundle: `wrangler deploy --dry-run --outdir dist` succeeds, its config (compatibility date and flag, both Workflows, the cron, the CPU limit) is read back by the tests, and no Node-only module is in it.

**Needs a live deploy** (nothing here can show these):

* The real Cloudflare Workflows engine: Miniflare's is a faithful local one, but retries after a real crash, `waitForEvent` across days, and `sendEvent` timing under load are only seen live.
* The cron actually firing every minute, and what it costs.
* A real **Supabase from a Worker** (the same PostgREST calls, now from Cloudflare's network), and two real runners racing for one job's claim.
* A **GitHub App JWT signed on Cloudflare** with your actual key file, and GitHub accepting it.
* **Browser Rendering's `/content`** with a real API token, including which of the two paths your account answers.
* The memory use of a brain build of a real, large repo (section 2).
* That Cloudflare cannot reach the VPS's private network from a Worker (section 6): documented behaviour that is relied on.
* The real model's behaviour is as unproven as it is in local mode (`docs/code-agent.md` section 10).
* **The live session on the real thing** (section 10): a WebSocket upgrade through Cloudflare's edge to the three objects (the tests call the Worker's handler inside workerd, which is the same code but not the same network), a hibernating object waking on a message and on an alarm, `sendEvent` from an object to a Workflow that is in `waitForEvent`, the real cost of a day with a computer online, a real GitHub Actions run connecting back to the room (the Node 22 probe, the cache action, `persist-credentials: false`, the time the first command waits for the runner), the app's presence socket from a real desktop, and the tarball download of a real, large repository inside the five-minute limit.
* The VPS side in cloudflare mode against the deployed Worker: `CODE_JOBS_URL` reachable from the VPS, `PUBLIC_ORIGIN` reachable from Cloudflare, and the push arriving on a phone.

A suggested first check: make a job on a throwaway repo with a small task, watch `wrangler workflows instances describe`, and answer the first question from the app.


## 10. The live session

The aim is to make the bot work the way Claude Code does: **read, list, glob and grep the real files at once**, and run commands in **one runner kept open for the job**, so a command takes about a second instead of 30 to 60 (a new GitHub Actions run for each one). It exists only with the jobs on the Worker; the VPS in `local` mode behaves as it always has. The desktop app's half is `docs/desktop-runner-session.md`; the agent's tools are in `docs/code-agent.md`; the minutes ledger is in `docs/code-router.md`.

### What was added

| Piece | Where | What it does |
| --- | --- | --- |
| `UserDevices` | Durable Object, one per person (`jobs/src/userDevices.ts`) | Which of the person's computers are online: the desktop app keeps a WebSocket to `wss://<jobs>/v1/devices/connect`. Online **means a socket is open**. `online()`, `capable(projectId)`, `offer`, `cancel` |
| `JobRoom` | Durable Object, one per job (`jobs/src/jobRoom.ts`) | The job's copy of the code (SQLite), the read, list, glob and grep over it, the hub for the one runner, the app's live view, the person's mid-task words |
| Placement | `CloudDesktopProvider` (`jobs/src/desktops.ts`), the router | A **session step** is placed like any step: the person's computer if it is online, else a GitHub Actions run, else paid compute by their rule, else it waits. Nothing about the order changed; the router just now sees the computers |
| The live runner | `jobs/src/live.ts` | The agent's `run` and the files port, answered from the room. Opens the session late, never holds a call open for a command |
| Minutes | `tulmi/src/code/live/minutes.ts`, migration `0031_code_runner_minutes.sql` | The month's GitHub Actions minutes: told at 80%, GitHub not chosen from 95% |
| Runner, GitHub | `runScript.ts`, `workflow.ts` (`renderSessionWorkflow`) | `.tailzu/run.mjs` in session mode: connects out to the room and runs what it sends |
| Runner, desktop | `docs/desktop-runner-session.md` | The same protocol, for the app |

Bindings and migrations (`jobs/wrangler.jsonc`): `NONCES` (`NonceGuard`), `USER_DEVICES` (`UserDevices`) and `ROOMS` (`JobRoom`). Migration tag `v1` made `NonceGuard`; tag **`v2`** makes `UserDevices` and `JobRoom` (`new_sqlite_classes`). A deployed tag is never edited; the next class gets `v3`. All three use SQLite storage.

### The three doors (all on the Worker, `jobs/src/http.ts`)

| Door | Ticket | Made by |
| --- | --- | --- |
| `GET /v1/devices/connect` | `device` | the VPS: `POST /v1/code/runner/ticket {deviceId}` for a signed-in person |
| `GET /v1/rooms/<jobId>/runner` | `runner` | the Worker itself, when a session step is placed; handed to the runner in the step (`.tailzu/step.json` on GitHub, the offer for a PC) |
| `GET /v1/rooms/<jobId>/watch` | `viewer` | the VPS: `POST /v1/code/jobs/:id/live` for the job's **owner** |
| `POST /v1/message` | a signed call, like `/v1/event` | the VPS: `POST /v1/code/jobs/:id/message` |

A **ticket** is `t1.<claims>.<HMAC-SHA256>` made with `CODE_JOBS_SECRET` over a label of its own, so it cannot be mistaken for the signature of a call between the VPS and the Worker, and a ticket of one kind is refused where another is wanted. Device and viewer tickets last **2 minutes** and work **once** (the nonce goes to the same `NonceGuard` the signed calls use); a runner ticket lasts **15 minutes**, works once (the room remembers the nonce), and is made for one **job, step and lease epoch**: a ticket for an earlier lease is refused, and a later lease of the same step takes the session over. Nothing logs a ticket or puts one in an error.

### A job's copy of the code

On the first read, list, glob or grep, the Worker mints a **read-only, one-repository** token (the same `runnerAccess` a PC is given: it can never write) and the room downloads the tarball of the job's branch head and unpacks it **while it streams** (`tulmi/src/code/live/unpack.ts`), into `files(path, sha, size, content, mtime)` and `skipped(path, size, reason)`.

* **What is held** follows the project brain's snapshot rules (`rules.ts`): not vendored folders, lockfiles, generated or minified files, binaries, anything over 512 KB, or empty files. These are still **listed** by name and reason, so `list_dir` and `glob` show the folder as it is and a read of one is answered from GitHub.
* **Secret files are never held, and never named**: `.env`, keys, certificates, credentials files. (`.env.example` is held with only the *names* of its variables.) A listing that named `.env` would only tell a model there is something to go looking for.
* **At most 50 MB** of text and 20,000 files. Over that the room is `remote`: it holds nothing, grep and glob are answered by the **runner** (`git grep`, `git ls-files`), read and list come from GitHub's API.
* The agent's **staged edits** are given to the room whenever they change, and laid over every read, list, glob and grep, so the model sees its own work. A file it deleted is gone from the room's answers. A commit throws the copy away; the next need makes it again at the new head.
* **We never keep a person's code.** `deleteAll` runs when the job ends (the loop calls `endJob`, and the Workflow's cleanup step calls it again if the job was stopped or failed), and an **alarm deletes a copy nobody has touched for six hours**.
* **The tools**: `read` (numbered lines, capped), `list`, `glob` (most recently changed first, at most 500), `grep` (ripgrep's output: `path:line:text`, context lines `path-line-text`, `--` between groups, `ignoreCase`, `filesOnly`, a path or glob scope, at most 500 matches). Plain RPC methods over SQLite; no model, no network. Search safety is in section 8, items 12 to 14: a pattern is refused if its shape is dangerous, and a time budget and a work budget cut a search short with `partial: true`.
* If the room is down, not ready, or cannot hold the repo, **the tools use GitHub's API exactly as before**. Nothing about the live session can fail a job.

### The runner and the session's rules

The agent's `run` asks the room (`queueExec`), which returns **at once**. The first time, there is no runner: the Worker asks the router for a **session step** (one step, one command, the mark `tailzu:live-session`) which is placed as above and gives the runner a ticket. The runner connects out to the room (no inbound port), says hello, and the room sends the command **with the staged edits (the overlay)**, takes the output a line at a time, and when the runner says `done` keeps the result and **sends the job's Workflow an event** (section 8, item 18). The Workflow comes back, asks for the result, and has the exit code, the tail of the output (8 KB, scanned for secrets) and the duration.

| Rule | Value | Where |
| --- | --- | --- |
| Opened late | not at the start of the job; when the first command needs it. Reads and searches never open one | the live runner |
| Closed when idle | `CODE_SESSION_IDLE_SEC` (120) without a command: an **alarm** | the room |
| Closed before the person is asked anything | always: the loop closes the session before `needs_you` | the loop (`park`) |
| Closed at the job's end | before the job is finished, because a job cannot be done with a step out | the loop (`finish`, `failed`) |
| A cap per job | `CODE_SESSION_MAX_MIN` (20) minutes of session in all. It is also the GitHub workflow's `timeout-minutes` (+1), so GitHub stops a forgotten run as a last resort | the room's alarm, `workflow.ts` |
| A command after the cap | goes the old way: a step of its own through the router | the live runner |
| A command that cannot be a session command | a scaffold (`keepChanges: true`: the server commits what it changed) goes the old way too | the live runner |

If no runner connects in time (the room's alarm tells the Workflow), or the router finds no place for the session in the time the agent will wait, the command is dropped and the agent is told no computer was free, which is what the old step path says too, and the job waits or asks about paid compute as it always did. A runner that drops loses the command in flight (the agent is told the session ended before it finished, and can ask again, which opens a new session) and the session is closed. The step's lease is the router's usual one: a computer that goes quiet loses it and the step moves.

**Commands run in a checkout that is reset between commands**: tracked files restored and the files the last overlay made removed, so each command sees "the branch plus the staged edits"; `node_modules`, caches and build output are kept, which is what makes the second command fast. The checkout is made with `persist-credentials: false`, so **no token that can write is on the machine**, and the commands cannot see the way to ask GitHub for an identity.

**Output is scrubbed three times**: by the runner before it sends a line (`redact`, a private key held back from its first line to its last), by the room before it keeps or shows it, and by the agent before it is written into a checkpoint. A tool's name and a few words about it, and the first line of its result, are what the app's live view gets, scrubbed too; never a file's contents.

### GitHub Actions in session mode

The same three files on the throwaway `tailzu-run/` branch (`docs/code-router.md`), with the session's workflow: a **shallow** checkout (`fetch-depth: 1`) with `persist-credentials: false`; Node 22 only when the runner lacks a global `WebSocket` (section 8, item 19); the same dependency caches; `timeout-minutes` = the job's cap + 1. `step.json` carries `commands: ["tailzu:live-session"]`, `discard: true` and a `session` ({ url, ticket, idleSec, maxSec }). `run.mjs` does not run `commands`: it connects to the room, runs what it is sent one at a time (a time limit for each command, output streamed with secrets removed, `grep`/`glob` by `git` for a repo too big for the room), and leaves when the room closes, when the room has been silent for the idle time plus a 90-second grace *between commands*, or when the socket drops. Then it reports the step with the OIDC identity token, as any step does, with the minutes the session lasted. It sends no files back: a session's changes are the agent's staged edits, committed by the server.

The ticket sits in `step.json` on a branch in the person's **own** repository for the few minutes it exists. It opens one connection, once, to a room that is waiting for exactly that step, and the room hands a runner nothing but commands to run on the runner's own machine. That is the reason it is worth so little.

### The month's GitHub minutes

A live session keeps a runner open for a whole job, so Tailzu **counts the minutes it uses** (`code_runner_minutes`, migration `0031`; `code_add_runner_minutes` adds them and says whether *this* call took the month over the line, in one SQL call, so two results arriving together tell the person once):

* **80%** of `CODE_ACTIONS_MONTHLY_MIN` (2,000 by default, a free plan's): the person is told, **once** for the month (`minutes_low`, push `code_minutes_low`).
* **95%**: placement **stops choosing GitHub's computers** until the month turns over. The step falls through to the next place (their own computer, paid compute by their rule, or waiting), as it does when GitHub is used up.
* **A public repo's minutes are not counted**, because GitHub does not meter them.
* The count placement uses is the larger of this ledger and the older `code_compute_usage.github_minutes`, so starting to count in the middle of a month gives no fresh allowance.

### Costs

Idle is free: every socket is accepted with the Hibernation API (`ctx.acceptWebSocket`), so a computer that is online and quiet, or a runner or an app that is connected and waiting, costs **no duration** and its keepalive is answered by the runtime for free. What costs money, by the prices in section 7 (checked 2026-10-27):

* **Requests.** A connection is one request; each of the agent's tool calls into a room is one (an RPC); each message the runner sends is 1/20 of one. A job with a hundred tool calls and a few thousand output lines is on the order of a hundred and fifty requests: a few thousandths of a cent at $0.15 per million. A computer online all day is one request for the connection plus its `state` frames, a handful.
* **Duration** is only while an object is running: a copy being made (seconds, up to the five-minute limit: at most 38 GB-s, which is 0.5 cent only after the 400,000 included), a search, a command's bookkeeping. Waiting for the runner or the person is hibernation, which is free.
* **SQLite rows written** are the copy: one per file, and the same again when it is deleted (a delete is a write). A repo of 5,000 files is about 10,000 rows a job, so the 50 million included covers about 5,000 jobs a month and the rest is a cent per job. **Storage** is held for hours, not months.
* **GitHub Actions minutes** are the one real cost of a live session, and they are the person's own allowance, not ours. A job can use at most `CODE_SESSION_MAX_MIN` of them plus about a minute to start, so a free plan's 2,000 minutes cover on the order of ninety jobs that use all of it. Most jobs use far less: the session closes after two quiet minutes. A person whose computer is online uses none.

### Failures that are not failures

| What happens | What the person sees |
| --- | --- |
| The room cannot be reached or made | nothing: reads and searches use GitHub's API, commands use the old step path |
| No computer takes the session in time | what they saw before this existed: the job waits for a computer, or asks about paid compute |
| The runner's socket drops mid-command | nothing: the agent is told that command was lost and asks again, which opens a new session |
| The app's live view cannot connect | nothing about the job changes; the view is a window |
| A message the person sent could not be handed over | `502 unreachable`: "so it did not get your message" |
| `CODE_LIVE_SESSION=false`, or no `CODE_JOBS_URL` on the Worker | the Worker runs exactly as before this section |

### Switching it on

1. Run `0031_code_runner_minutes.sql`.
2. Set `CODE_JOBS_URL` in `jobs/wrangler.jsonc` to the Worker's own address, and deploy (this creates `UserDevices` and `JobRoom`, migration `v2`).
3. Nothing to change on the VPS beyond the three variables of section 4: the live settings default to on. Restart it.
4. Update the desktop app to speak `docs/desktop-runner-session.md`. Until then, jobs use GitHub's computers for sessions and the old step path for the rest.
