# The Code bot's jobs on Cloudflare

The Code bot's long work (the agent loop of `docs/code-agent.md`, the project brain's builds of `docs/code-project-brain.md`) can run on **Cloudflare Workflows** while the API server stays on the VPS. It is optional, off by default, and the VPS behaves exactly as it always has until you switch it on (`CODE_JOBS_MODE=local`).

Why: a job is dozens of model turns, sometimes for hours, and waits days for a person. On the VPS that is a process that must stay up and a lease to keep alive. A Workflow instance is kept by Cloudflare: it survives a restart or deploy of anything, waits for free while it sleeps, and is retried by the platform.

The Worker is `jobs/`. It contains **no copy of the logic**: it imports `tulmi/src/...` and Wrangler bundles it. A fix to the loop is a fix for both.

## 1. The split

| | VPS (`tulmi/`) | Cloudflare (`jobs/`) |
| --- | --- | --- |
| The API, sign-in, every route the app calls | yes | no |
| `POST /v1/code/jobs`, answer / approve / deny / budget / stop | accepts, checks the owner, writes the person's word into Supabase, **then calls the Worker** | |
| The agent loop (plan, work, verify, commit, PR, report) | only with `CODE_JOBS_MODE=local` | one Workflow instance per job |
| The project brain's builds | only with `local` | one Workflow instance per build |
| The router's ticker (leases, steps out on GitHub, jobs waiting for a place) | only with `local` | cron, every minute |
| Push notifications (`needs_you`, `job_done`, ...) | **yes, always**: the push credentials never leave the VPS | asks the VPS with a signed call |
| The desktop runner routes, GitHub's runner reports (`/v1/code/runner/*`) | yes | |
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
* `POST /v1/internal/code/notify` on the VPS is open only when `CODE_JOBS_MODE=cloudflare` and a secret is set (otherwise 404, as if it did not exist). The body names a job, never a person: the VPS looks the owner up itself. A job that does not exist is 404; a job that is not an agent job is 403. `kind` must be one of the seven the router knows; `text` is cut to 300 characters.

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

**Not on the Worker, on purpose:** push credentials (they stay on the VPS), the speech and payment keys, `GITHUB_APP_WEBHOOK_SECRET` (the webhooks still arrive at the VPS).

### On the VPS (`tulmi/.env`)

```
CODE_JOBS_MODE=cloudflare
CODE_JOBS_URL=https://tailzu-jobs.<your-subdomain>.workers.dev
CODE_JOBS_SECRET=<the same value>
```

`CODE_GITHUB` and `CODE_PROJECT_BRAIN` stay on, as in local mode. With `cloudflare` the VPS starts **no** agent orchestrator and **no** ticker. A start that cannot reach the Worker fails the job with a reason instead of hanging; the config warns on boot if the URL or the secret is missing, if the URL is not https, or if the secret is under 32 characters.

## 5. Deploy

Needs a Cloudflare account on **Workers Paid** (raising the CPU limit past 30 s and the volume of Workflow steps need it; see section 7).

```bash
cd jobs
npm ci                         # exact-pinned; .npmrc sets legacy-peer-deps, see section 8
npx wrangler login             # opens a browser; or set CLOUDFLARE_API_TOKEN for CI

# 1. Fill in the blank vars in wrangler.jsonc (GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_ID,
#    CLOUDFLARE_ACCOUNT_ID, PUBLIC_ORIGIN).

# 2. Deploy. This creates both Workflows, the Durable Object and the cron. Until the secrets are in
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

* **A person's own computer (the desktop runner) is not used for jobs the Worker runs.** Which PCs are online is kept in the VPS's memory (`DeviceBook`); the Worker has no way to see it, so the router there places a step on GitHub's free computers, or waits, or asks about paid compute. The desktop runner routes still answer on the VPS. (Making this work means keeping presence in Supabase; not done.)
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
| Worker size | 64 MiB per the Workers limits page (the Workflows limits page still says 3 MB Free and 10 MB Paid). This bundle is about 2.3 MiB (567 KiB gzip), under all of them | [Workers limits: Worker size](https://developers.cloudflare.com/workers/platform/limits/#worker-size) |
| Step result, event payload | 1 MiB each (a job's steps return a few bytes) | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| Steps per instance | 10,000 default, up to 25,000 (a job is capped at 3,000 advances) | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| `step.sleep` / waiting | up to 365 days; a waiting instance does not count toward concurrency | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) |
| Instance id | at most 100 characters of letters, digits, `-`, `_` | [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/) |
| Event type | letters, digits, `-`, `_` only (a `.` is refused), so the event is `wake` | [Events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/) |
| Retention | set to 3 days (done) / 14 days (failed) for jobs and 1 / 3 for brain builds, to keep storage small; the default is 30 days on Paid | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) |
| Workflows price | CPU and requests at Workers prices; **steps** 500,000 a month included then $0.80 per 100,000, **storage** 1 GB-month included then $0.20 per GB-month (steps and storage have been billed since 10 August 2026) | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) |
| Cron | UTC; a trigger takes up to 15 minutes to take effect after a change; 30 s of CPU for a trigger more often than hourly, 15 minutes of wall time | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) |
| Browser Rendering ("Browser Run") | 10 hours a month included on Paid, then $0.09 per hour; 30 requests per second on `/content`; a browser timeout of 60 s | [pricing](https://developers.cloudflare.com/browser-run/pricing/), [limits](https://developers.cloudflare.com/browser-run/limits/), [`/content`](https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/) |
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

## 9. Verified here, and what needs a real deploy

**Verified locally** (`cd jobs && npx vitest run`, `cd tulmi && npx vitest run`; the Workers tests run inside workerd through `@cloudflare/vitest-plugin`):

* The signature: good, bad, wrong secret, wrong path, changed body, expired, from the future, **replayed** (the real Durable Object), and a call back from the Worker to the VPS's notify route.
* Idempotent start (twice is one instance), events reaching a waiting instance, an event sent before the wait began, a Workflow ending when the job ends.
* **The whole agent loop inside workerd**: plan, edit, runner checks, commit, PR, a wait for an answer, finish, advance by advance with the real orchestrator over the test rig.
* The AgentJob Workflow through a scripted loop: continue, each kind of wait, a wait that times out, a step that throws and is retried, a job that never ends.
* A real project-brain build, full and incremental, inside workerd; the BuildBrain Workflow; the cron calling the ticker and rescuing a job nobody drives.
* `workerSafeFetch`'s rules; the PKCS#1-to-PKCS#8 JWT against WebCrypto; the Cloudflare renderer with a fake `fetch`; the config with `RUNTIME=worker`; the VPS hand-off client (retries, final answers, the failed-job reason) and notify route (signatures, owner rules).
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
* The VPS side in cloudflare mode against the deployed Worker: `CODE_JOBS_URL` reachable from the VPS, `PUBLIC_ORIGIN` reachable from Cloudflare, and the push arriving on a phone.

A suggested first check: make a job on a throwaway repo with a small task, watch `wrangler workflows instances describe`, and answer the first question from the app.
