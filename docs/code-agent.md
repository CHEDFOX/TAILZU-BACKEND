# The Code bot's agent loop: layer 8

Layers 1 to 7 are the parts (`docs/code-brain.md`: which model, what it costs; `docs/code-project-brain.md`: what the bot knows about a repo; `docs/web-search.md`; `docs/code-work.md`: locate, plan, the work log, libraries, new projects) and the environment router (`docs/code-router.md`: where a command runs, leases, the policy's commit). **Layer 8 is the worker that ties them together.** A person says "fix this" in the app; a server finds where it belongs, plans it, does it with a model and tools, checks it against what the project was before, commits it through the policy, opens a pull request and says what it did, spending the budget it was given and stopping to ask whenever it has to.

It is `tulmi/src/code/agent/`. No npm dependency was added. By default it runs inside the API server; with `CODE_JOBS_MODE=cloudflare` the same loop runs on a Cloudflare Workflow instead (section 12, `docs/cloudflare-jobs.md`). The clock, the sleep, the model, the network, the runner and every store come in through `AgentDeps` (`deps.ts`), so the whole loop runs offline in the tests (`tests/code-agent-*.test.ts`, over `tests/agent-rig.ts`).

```
tulmi/src/code/agent/
  types.ts         the phases, AgentState (kept in the job's checkpoint), the numbers that bound the loop
  changeset.ts     the staged edits, and every refusal made before anything is staged
  checks.ts        the project's checks in one runner step, and reading what each said
  context.ts       what the model is shown each turn: compact, capped, data fenced
  tools.ts         read_file ... done: what each tool really does
  runner.ts        the runner port, and the environment router behind it
  report.ts        the commit message, the pull request body, the final report
  run.ts           one run of the loop: the state, the claim it writes through, the ways it stops
  phases.ts        prepare ... report, each a function over a Run that can be entered again
  loop.ts          the driver (runLoop), the single-advance entry (advanceLoop), and the budget stop
  orchestrator.ts  the worker: claims, checkpoints, concurrency, the person's word, rewind, the project's settings
  merge.ts         the merge phase (a PR-care job for a conflict): the default branch merged in on a runner, judged, resolved by the model
  rewind.ts        the rewind points (the staged edits after each step) and the files of a revert commit
  settings.ts      how a project's jobs are worked: guided or free-form, and "always show me the plan first"
  index.ts         createAgent(): wired from the Code object and the job router
```

## 1. The phases

```
prepare ──┬─ a question, research, a library to find ─────────────────────────────┐
          │                                                                        ▼
          ├─ an empty repo ─► new_project ──► (the first milestone, as below) ─► plan
          │                   intake ► spec ► PLAN.md committed ► starter step
          │
          └─ otherwise ─► baseline ─► locate ─► plan ─► work ─► verify ─► [design] ─► commit ─► pr ─► report ─► done
                                        │         │       ▲        │            │
                                  needs_you  needs_you    └─ fix ──┘            └─ major differences: back to work (2 rounds at most)
                               (which file?)  (the OK)   (3 rounds at most)
```

| Phase | What it does | Where it can stop |
| --- | --- | --- |
| `prepare` | Brings the project brain up to the default branch, classifies the request (`brain/classify.ts`), notes whether the repo is empty. | |
| `new_project` | Empty repo only. **Intake**: at most five questions the person's words do not answer, one at a time. **Spec** and **PLAN.md** (`newproject/`). PLAN.md (and the starter's template files, if the stack has any) is **committed** through the workspace as the first commit. The stack's **official starter** is emitted as one runner step (`create-next-app` and the like) whose changes are kept and committed by the server. Then the first milestone is rewritten as the task and the job goes on to `plan` as an ordinary task on a project that now has files. | a question (`needs_you`); no computer for the starter: asks "Try again" or "Skip the setup" |
| `baseline` | The project's own checks (install, typecheck, lint, test, build), run once on the untouched branch in **one** runner step, each with its own exit code and the names of what fails (`checks.ts`). Recorded on the brain with the commit they were run at, and reused for a week while the default branch has not moved. **Unknown** if they cannot be run (no checks found, no computer free, the branch already has commits, unreadable output): the job goes on, says so, and the pull request stays a draft. | |
| `locate` | `work/locate.ts`. Sure enough: no model. Unsure: a question with labelled options, asked **once**. | a question (`needs_you`) |
| `plan` | `work/plan.ts`. Then the policy is asked in advance what the commit this plan leads to would do (`decide`). A standing "never" ends the job with the reason. A **high-risk** plan, or one the policy would ask about, waits for the person's OK through the approval book. | the OK (`needs_you`) |
| `work` | A model with tools (section 3), one turn at a time. Every edit is **staged**, never written. | a question from the model; the budget |
| `verify` | The plan's checks (the affected tests first, then typecheck and lint) run in one runner step **with the staged edits laid over a fresh checkout**; the result is compared to the baseline (`work/findings.ts compareToBaseline`). What this change broke goes back to `work` as a fix round, with the failing output in front of the model. Three rounds at most, then the job stops with a report and **nothing committed**. A check that was already failing is **flagged and does not block**. | |
| `design` | **Only for a job built from an approved design** (`AgentState.spec`, `docs/artifacts.md` sections 6 and 11), and only if `CODE_DESIGN_CHECK` is on. After the checks pass and before the commit: start the project's dev server on the runner (the preview, `docs/cloudflare-jobs.md` section 11), open the route the design is for, shoot it and the approved design at mobile and desktop, and compare (a cheap pixel gate first, the vision tier only if they differ, metered in the job's budget). **Major** differences send the job back to `work` with the differences and the fix hints in front of the model, **twice at most**, and the checks run again before the next look. After the last round one more look is taken and what still differs is **reported**. It **never blocks the commit**: no live runner, not a web app, no `dev` script, a dev server that will not start, no browser or shot viewer, a budget too small (about 240 paise), a failed shot, a model with no usable answer: the round is skipped with one sentence for the report and the job goes on. Its stages are saved one by one, so a restart or a wait resumes it without doing anything twice | |
| `commit` | The **server** commits all the staged edits at once through `workspace().commit`, so the policy, the secret scan, the Blip author and the co-author trailer always apply. If the policy asks, the job waits for the person's OK; if it says never, the job stops with the reason. | the OK (`needs_you`) |
| `pr` | A draft pull request: the plan, the checks, what was already broken, the **whole work log** (`worklogMarkdown`) and the findings. Taken out of draft **only when the checks ran and found nothing this change broke**, and only if the policy allows it (a standing permission, or the person's yes). | the OK to mark it ready |
| `report` | What changed, the PR link, the checks, the findings, **"already broken before Tailzu" as its own list**, the cost in rupees and what to do next. The job is finished through the router, which pushes `job_done`. | |

A job that changes nothing (a question, "nothing needed changing") skips `verify`, `design`, `commit` and `pr`: the model's summary is the report. A job with no design to match skips `design`; its phase list is otherwise the same.

Two jobs take other roads through this table. A **free-form** job (section 14) goes from `baseline` straight to `work`, with no `locate` and, unless the person asked to see the plan first, no `plan`. A **PR-care job for a conflict** (`docs/pr-care.md` section 5) has a `merge` phase after `baseline`: a runner merges the default branch into the branch, the model judges which files clash and resolves them in `work`, and `commit` makes a **merge commit with two parents** instead of an ordinary one; its `pr` is the existing pull request, which is not rewritten.

**Verify comes first, and the commit checks it.** What is committed must be exactly what the checks passed. `verify` writes a digest of the staged edits it passed (`AgentState.verified`) and `commitStaged` refuses any other: edits that were never verified, or that changed after they were, throw `Unverified` before GitHub is asked for anything. No order of phases, no model turn and no restart can commit edits the checks have not seen. (A merge commit is verified the same way, with the project's own typecheck, lint, test and build run on the merged result.)

## 2. Who runs a job, and what a restart does

**One runner per job.** A job made through `POST /v1/code/jobs` on a server that has the agent is an **agent job**. It is driven by whoever holds its **claim**: `agent_holder`, `agent_epoch` and `agent_expires_at` on the job (migration `0030_code_agent.sql`), separate from the step lease the router keeps.

* A server claims a job with one compare-and-set (`casJob`): the epoch must still be what it read, the job in a state it can be claimed in, and nobody's time on the claim left. Two servers reading the same job both try; one wins. The epoch goes up by one.
* **Every write the loop makes carries the epoch** (`claimFor` in `orchestrator.ts`). A server that went quiet and was replaced finds its next write turned away (`LostClaim`) and stops. So a slow server cannot undo what the new one did.
* The claim lasts **two minutes**, renewed by a heartbeat every 40 seconds and on every save. The **ticker** (every 15 seconds, the same one as the router's, `code/jobs/ticker.ts`) hands back a claim that ran out (the epoch goes up, which fences the old holder for good) and any server's next poll claims the job.
* At most **`CODE_AGENT_CONCURRENCY`** (4) jobs run at once on a server; the rest wait their turn in the database, oldest first.
* A server that is shutting down stops its loops and lets go of its claims, so another takes the jobs up at once.

**Checkpoints.** The agent's whole state (`AgentState`: phase, plan, located files, **the staged changeset**, the last turns of the conversation, what the checks said, the commits made, the pull request, what it waits for) is written into the job's checkpoint (`checkpoint.agent`) **after every model turn and every tool call**. When a server dies, the next one reads it and carries on:

| It died while | The next server |
| --- | --- |
| the model was thinking | asks again for that turn (the turn it was in is not in the state) |
| a tool call of a turn was done and the next not | runs the calls that have no result yet; a call already answered is not run again, so **an edit is never made twice** (and a call's id keeps it out of the work log twice) |
| a runner step was out | **adopts** it (`state.run`: the step's index and commands), whether it has finished or not, instead of asking for another |
| the commit was being made | looks at the branch: if every staged file is already there as staged, the commit was made and is **not made again**; if the branch moved, stops rather than commit over someone's work |
| the pull request was opened | `openDraftPr` finds the open one and its description is updated |

A loop that fails on something unexpected (GitHub down, a bug) is not the person's: the claim is let go with a wait that doubles (15 seconds, then 30), and the third time running the job is failed with a plain reason.

## 3. The tools

`read_file`, `list_dir`, `grep`, `glob`, `search_code`, `edit_file`, `write_file`, `delete_file`, `run`, `web_search`, `read_page`, `research`, `find_resources`, `flag_finding`, `note`, `ask_user`, `done` (`tools.ts`). There is **no** tool that commits, pushes or touches git: the server does that after the checks.

| Tool | What it really does |
| --- | --- |
| `read_file {path, from?, to?}` | The work branch **with the staged edits applied**, numbered lines, 12,000 characters at most (ask for a range for the rest). A file that looks like it holds a secret is not shown. With the live session (section 13) it is answered at once from the job's own copy of the code; without it, from GitHub's API, as it always was. |
| `list_dir {path}` | The same overlay for folders. A skipped folder (`node_modules`, `dist`) is listed by name. |
| `grep {pattern, path?, glob?, ignoreCase?, context?, filesOnly?, maxResults?}` | **Exact search**, like ripgrep: a JavaScript regular expression, line by line, each match `path:line:text` (context lines `path-line-text`). Sees the staged edits. At most 500 matches (100 by default), a pattern of at most 300 characters; a dangerous pattern (a back-reference, `(a+)+`) is refused with the reason, and a search that runs out of time or work comes back `partial` and says so. Without the live session it searches up to 60 files through GitHub's API, and says which it did not reach. |
| `glob {pattern}` | Files by name: `src/**/*.test.ts`, `*.md`, `tests/{a,b}/*.js` (a pattern with no `/` matches the name at any depth). The most recently changed first, at most 500. Sees the staged edits. |
| `search_code {query}` | The project brain's index, for **where a feature lives** (files, symbols, the text people see). It does not see the staged edits. Use `grep` for an exact name or string. |
| `edit_file {path, old, new}` | An exact replace of text that occurs **once**; says what it found otherwise (not there, or N times). Staged. |
| `write_file`, `delete_file` | Stage a whole file, or a deletion. |
| `run {cmd, why}` | Up to 20 commands on a runner, **with the staged edits laid over the checkout** (`overlay` on the step; nothing it changes is kept); the exit code and the end of the output. At most 10 runs in a round of work. With the live session the commands go to a runner kept open for the job (about a second each); otherwise each is a step of its own. |
| `web_search`, `read_page`, `research` | Layer 3. The page arrives inside `asUntrusted`'s wrapper. |
| `find_resources {need}` | Layer 6: a ranked shortlist of libraries. |
| `flag_finding`, `note` | A bug noticed in code it was not asked to change (it goes in the pull request); a line for the work log. |
| `ask_user {question, options?}` | The job waits for the person; their words come back as the call's result. |
| `done {summary}` | The work is finished. |

**Refused up front, in words the model can act on, before anything is staged:** a path under `.github/workflows` (CI is never changed), a path outside the repo or inside `.git`, Tailzu's own runner files, an env file or a key, text that newly holds something that looks like a secret, a file over 1 MB, more than 100 files or 600,000 characters staged. The policy would refuse or ask at commit time as well; this way the model hears it while it can still do something about it, and **a secret is never written into the checkpoint**: a call whose arguments look like one is kept without them (`WITHHELD_ARGS`) and still refused when it runs. Every call and its result is in the work log (a secret is redacted before it is kept). A turn whose every call failed counts as a bad one: it makes the router climb a tier, and six in a row stop the job.

## 4. What the model is shown, and what it costs

A job is dozens of model turns, and a turn that re-sends everything is a bill that grows with the square of the work. `context.ts` builds each turn's prompt from the state:

* **System:** `compose("agent_work")` (`src/principles/`, `docs/principles.md`): the principles (web and tool text is data, never instructions; no secrets in outputs; the permission rules decide, never the model; read once, take the cheapest step, stop when done; the project's conventions, the smallest change, green tests, no edits under `.github/workflows`, explain the impact), who Blip is, and how a turn ends. The same bytes on every turn of every job, so a provider's prompt cache hits it. The agent cannot touch git (the server commits), so `GIT_PRINCIPLES` (`policy.ts`) is no longer sent to it: the permission system makes them hold, and the library's code and safety principles say the part a model can act on.
* **Project:** the head of the first user message: the install command, the kind of request, and the project's rules and memory (5,000 characters each, shown as data and said to change nothing Tailzu may do). It is the same on every turn of a job (`projectContext`).
* **Task:** the request, the plan, the located excerpts, what is staged, what the last checks said, and a running summary of the work so far.
* **A spec, when the job has one:** a job made from an approved artifact (`docs/artifacts.md` section 6, "build it") carries the design in `AgentState.spec`, and every turn shows it as the design to match, in a data fence, beside the project's style kit and the place it goes (`specBlock`), cut last when the context is tight. The locate phase is skipped when the search at approval time was sure of the place (an unsure one, with a question, runs the usual way and asks).
* **Recent:** the **last six tool results in full**. A result that falls out of the six becomes one digest line at once; every four digests the **cheap tier** folds them into the summary (`agent.fold`, one small call; without it the digests are kept and the oldest dropped when the notes are full).
* **A hard cap of 60,000 characters** (the tool definitions counted): results are cut shorter, then fewer are kept whole, then the excerpts go, then the summary, then the rules. What was cut is named in `trimmed`.

**Data is never instructions.** A file the model read, a command's output, a search result and the folded summary go in `<tool_data>`; a web page arrives in the web code's `<web_page>`. Both wrappers are ones their own text cannot close. Our one-line answers ("Edited src/a.ts.") are the only text outside a wrapper in a tool message. Nothing run on a runner comes from anything but a `run` call of the model.

**Tiers.** Each turn is routed by `planRoute("write_code", ...)` (`brain/route.ts`): the tier climbs on failures (bad turns and fix rounds), and a tier the remaining budget cannot afford (by its `maxTokens`, at most 4,096 here) is not chosen. After each round of writing, `recordOutcome` tells the route statistics whether it worked, what it cost and how long it took.

## 5. Money

* A job made without a budget gets **`CODE_JOB_DEFAULT_BUDGET_PAISE`** (3,000 paise, ₹30). A `budgetPaise` of **0 sent on purpose still means no model calls**.
* Every model call the loop makes (the work turns, the classifier, locate, plan, folding, the web tools, intake) is charged to the job with `budget: "job"`; the gateway refuses a call the job cannot afford.
* **When the money runs out the job stops cleanly** (`BudgetExceeded`, `loop.ts budgetStop`). The checks are run on the staged edits (they cost no model money). If they come out **no worse than the project was before Tailzu touched it**, the edits are committed (a message that says it is part of the work) and the report says so; **otherwise they stay staged**, in the checkpoint, and nothing on the branch changes. The report offers **"continue with ₹X more"** (half of what was spent, at least ₹10, in whole rupees); the job waits (`waiting_for_you`, `waiting_on: budget`) and the person is pushed `needs_you`.
* `POST /v1/code/jobs/:id/budget {addPaise}` raises the budget. A job that stopped for the money goes on from where it was; nothing is done twice.

## 6. Waiting for the person

A job that needs the person is **parked**: `waiting_for_you`, nobody's claim, the state saved, the person pushed `needs_you` (`code_needs_you`, "Tailzu needs you"). Their word is written into the state by a route and the job goes back to `running`; the orchestrator's next poll claims it and the same phase runs again and finds the answer.

| It waits for | `waiting_on` | The person says it with |
| --- | --- | --- |
| a question: which file (locate), an intake question, the model's own `ask_user`, "try the starter again or skip it" | `answer` | `POST /v1/code/jobs/:id/answer {answer}` |
| the OK to a high-risk plan, a commit or "mark the pull request ready" the policy asks about | `approval` | `POST .../approve` (a question, then a yes with the `approvalId`), or `POST .../deny` |
| more money | `budget` | `POST .../budget {addPaise}` |

`approve` is the same two steps as every other question in the Code bot (`routes/code.ts`): with no `approvalId` it changes nothing and answers with what would be done and the id to say yes with (and whether Face ID goes with it); with the id, it says yes. An approval that ran out is asked again, with a fresh id. **Deny** ends the job for a plan or a commit ("You didn't approve the plan, so nothing was changed."); for "mark ready" the pull request just stays a draft.

## 7. Routes

All the owner's only (the router's `job` looks the job up by the person's id: anyone else is told `404 not_found`), all behind the session, and `404 agent_off` on a server without the agent (it needs the Code bot's GitHub client **and** the project brain, `CODE_PROJECT_BRAIN`).

```
POST /v1/code/jobs                   { projectId, branch, task, budgetPaise?, mode?, planFirst? }  -> { job }; enqueued for the agent at once. mode "guided" | "freeform" and planFirst true | false are for this job and beat the project's setting (sections 14 and 15)
GET  /v1/code/jobs/:id               -> { job, steps, agent? }   where the agent is: phase, waiting, plan, staged, commits, PR, verify, findings, report
POST /v1/code/jobs/:id/answer        { answer }                  409 not_waiting if it asked nothing
POST /v1/code/jobs/:id/approve       { approvalId? }             a question, then { approved, job }; 409 approval_expired / approval_invalid / not_waiting
POST /v1/code/jobs/:id/deny                                      -> { job }
POST /v1/code/jobs/:id/budget        { addPaise }                409 job_over
POST /v1/code/jobs/:id/stop                                      the loop is told, any step that is out is dropped
GET  /v1/code/jobs/:id/log                                       -> { entries } the work log, in order
POST /v1/code/jobs/:id/message       { text }                    -> { delivered: true }  the person's words to a job that is working (section 13); 404 live_off, 409 job_over
POST /v1/code/jobs/:id/live                                      -> { url, ticket, expiresAt }  a pass for the app's live view of the job (section 13); 404 live_off
POST /v1/code/jobs/:id/rewind        { toStep, approvalId? }     -> { kind: "restored" | "reverted" | "needs_approval", ... }  go back to a step (section 16)
GET  /v1/code/jobs/:id/checkpoints                               -> { checkpoints: [{ step, at, note, files }] }  the steps a rewind can go to
GET  /v1/code/projects/:id/settings                              -> { settings: { mode, planFirst } }
PUT  /v1/code/projects/:id/settings  { mode?, planFirst? }       -> the same, after the change
POST /v1/code/runner/ticket          { deviceId }                -> { url, ticket, expiresAt }  a pass for a computer's presence socket (docs/desktop-runner-session.md); 404 live_off
```

The agent's state holds the person's code (the staged edits, the last files it read), so `GET /v1/code/jobs` and the job in every response are sent **without** `checkpoint.agent`; `agent` in `GET /:id` says where it is in words and paths.

## 8. Safety, in one place

* **No write token on a runner, and no write but the server's commit.** The agent writes to the repo only through `workspace().commit` after the checks; the policy (branch protection, workflows, secrets, a branch Tailzu did not make), the Blip author and the co-author trailer always apply.
* **Text from outside is data.** A page, a file, a command's output, the project's own rules: fenced, labelled, and never obeyed. A prompt-injection attempt in a page or a file changes nothing the loop does (`code-agent-safety.test.ts`).
* **Nothing is run on a guess.** The only commands that reach a runner are the project's own checks and a `run` the model asked for, with the staged edits laid over the checkout, nothing kept.
* **A change that breaks the project is never committed by the loop.** Three failed fix rounds stop it; running out of budget commits only what is no worse than the baseline.
* **Privacy.** The job's checkpoint holds the agent's state while the job lives: the staged edits, and the last files and outputs it read, in `code_jobs.checkpoint`, readable only by the person (the row policies from `0023`). A step's overlay is emptied as soon as the step ends. The state stays in the row after the job is over; pruning it on finish is a decision for the privacy policy.

## 9. Setting up

1. Run `tulmi/supabase/migrations/0030_code_agent.sql` (or `full_schema.sql`) after `0029`, **before** the new release takes `POST /v1/code/jobs`: the job has new columns and three new waits. For free-form jobs, plan-first, rewind and PR care also run `0034_code_chat_and_care.sql` (the settings, the rewind points, PR care's rows, and three columns on the steps); without it each of those stores keeps its rows in memory and a restart forgets them, and nothing else depends on it.
2. Optionally set `CODE_JOB_DEFAULT_BUDGET_PAISE` (default 3000) and `CODE_AGENT_CONCURRENCY` (default 4). `CODE_GITHUB` and `CODE_PROJECT_BRAIN` must be on.
3. Nothing else: the worker starts with the router's ticker when the server is ready and stops when it closes.
4. Optional: run the jobs on Cloudflare instead (`CODE_JOBS_MODE=cloudflare`, section 12). Nothing in sections 1 to 8 changes for the person.

## 10. What needs a live check

The tests run the whole loop offline, over a fake GitHub, a scripted model and a scripted runner. These are what only a real run can show:

* **A real model's tool calls.** The scripted model answers with exactly-formed calls. A real one will sometimes send arguments that are not JSON, call a tool that does not exist, or stop with words and no call; the loop answers each (nudge once, then take the words as the answer; six bad turns end the job), but the wording of the system prompt and the tier choice want a look at real transcripts, and ₹30 as a default budget wants a look at real costs.
* **The overlay on a real runner.** `.tailzu/run.mjs` lays the staged edits over the checkout on GitHub's free computers and on a PC (`applyOverlay`): tested against a real git repo and `node`, not yet on GitHub Actions or the desktop app (which does not exist yet and must lay `overlay` and honour `discard` itself).
* **The checks' output.** `failingNames` reads vitest, jest, pytest, go, cargo, tsc and ESLint output as they print today; a project's own reporter may print something else, and then a failure is known by its exit code only (which is safe: it blocks, it never passes).
* **PostgREST.** The claim's conditions (`agent_expires_at.is.null,agent_expires_at.lte.…` in `casJob`) and the three list queries are tested against a stub that records them, and the in-memory store gives the same answers; two real servers racing for one job on Supabase have not been seen.
* **The starter.** `create-next-app` and the like through a real runner, and their changes coming back through the router's commit (size limits, the policy asking about something the starter wrote).
* **The push.** `code_needs_you` is registered with the push engine; the phone's wording and screen are the app's to build, and so is every screen for answer, approve, deny, budget and stop.
* **A restart in production.** The crash tests kill an orchestrator in the middle of work and bring another up over the same stores; a real deploy is the same thing with a database in between.

* **The design round on the real thing.** The preview through the Worker's preview host, Browser Rendering's shots of it and of an artifact's host page, the vision tier's real verdicts (does it keep to the JSON, are its `major` and `minor` where a person would put them, do its fix hints make the model fix the right thing), and what a round costs in paise. `docs/artifacts.md` section 11 has the list.

## 11. Tests

`tests/code-agent-loop.test.ts` (the happy path, fix rounds, already-broken, the baseline, the tools), `-ask` (every wait: the model's question, locate, plan approval and deny, commit and ready approvals, the budget), `-resume` (a crash after two edits, an adopted run, two servers, a slow server fenced, concurrency, closing, loop errors), `-safety` (refused paths, secrets, prompt injection), `-newproject` (an empty repo), `-routes` (the HTTP), `-units` (the parts, the claim in the store, the router's overlay, the runner), and `code-run-script.test.ts` / `code-jobs-placement.test.ts` for `applyOverlay` and the ticker. The live session's tests are `code-live-search` (the search and its safety), `-tools` (the model's `grep`, `glob`, `read_file`, `list_dir` over a fake room, and without one), `-agent` (the loop's hooks: the room, closing the session before the person is asked and before the job ends, progress events, the person's words), `-routes`, `-minutes`, `-runner` (`run.mjs`'s session mode against a fake room), `-workflow` and `-tickets`; and in `jobs/test/` the room, the session, presence, the viewer and a whole agent job over a real room. The design round's are `code-agent-design.test.ts` (route finding, the dev command, every skip, the rounds, the budget, resuming after a restart or a wait, the report), with `artifacts-{pixels,shots,shots-route,compare}.test.ts` and `web-browser-shot.test.ts` for what it calls. Free-form, plan-first, rewind and the settings' routes are `code-agent-freeform.test.ts`; the merge phase's is in `code-pr-care-conflict.test.ts`. `tests/agent-rig.ts` is the rig: a real orchestrator, router, policy and workspace over `FakeGithub`, the fixture brain, a scripted model (`scriptedModel`) and a runner that answers from a script (`ScriptRunner`).

## 12. Running the loop on Cloudflare (`CODE_JOBS_MODE=cloudflare`)

The loop above is one function that runs a job to its end in one process. For Cloudflare Workflows it is also available **one advance at a time**, with the same phases, the same claim and the same checkpoints; the Worker in `jobs/` imports it straight from `tulmi/src` (no copy). The set-up, the deploy and the limits are in `docs/cloudflare-jobs.md`.

**The entry.** `advanceLoop(env, {turns?})` in `loop.ts` runs the phase the job is in up to its next checkpoint and returns a small value, never state:

```
{ next: "continue" }                                             more to do: call again
{ next: "wait", waitingOn, wakeAt?, waitMs? }                    nothing to do until: the person (answer | approval | budget),
                                                                 a runner's report (runner), a time (retry), or the claim (claim)
{ next: "end", why: "finished" | "lost" | "stopped" | "over" }   the job is over
```

`AgentOrchestrator.advance(jobId, {holder, turns?})` claims the job (the same compare-and-set as section 2), calls `advanceLoop` and lets the claim go. In the **work** phase an advance is `turns` model rounds (a round is a model turn and its tool calls; the Worker uses 2), after which the phase yields and the state is saved; a runner step that is out is **polled once** (`pollOnce`, `RunPending`) instead of waited for, and the wait comes back as `{next:"wait", waitingOn:"runner", waitMs}`. Every other phase in the table of section 1 is one advance (a phase that finishes returns `continue`, and the next advance runs the next phase).

**Who drives.** One Workflow instance per job, its id the job's id: `step.do("advance-<n>")` for each advance, `waitForEvent("wake")` for the person (seven days, then the job is ended with a report) and for a runner, `step.sleep` for a claim or a back-off. The VPS posts a signed `/v1/event` after it writes the person's word, so the instance wakes at once; the Worker's one-minute cron looks again at any job nobody has driven for five minutes, so a lost event is harmless.

**What stays the same.**

* **The claim** (section 2) is the second guard: the Workflow engine retries a failed step and the epoch fences a step that was cut off. The Worker's claim is five minutes long (it has no heartbeat).
* **Checkpoints** stay in Supabase, after every model turn and tool call. A step's result is the small value above.
* **The routes** (section 7) are still the VPS's. In cloudflare mode `POST /v1/code/jobs`, `answer`, `approve`, `deny`, `budget` and `stop` write what they always wrote, then call the Worker; a job that cannot be started because the Worker cannot be reached in three signed attempts is failed with a reason the person can read.
* **Money, safety and the model's tools** are the code of sections 3 to 8, unchanged.

**What is different.**

* An **approval** used to live in the server's memory. The plan phase now also keeps the approval record in the job's state (`Waiting.approval.bound`); the next advance restores it (`approvals.ts` `peek` / `restore`), so a yes given to the VPS reaches a loop running in another process. In `local` mode this is harmless.
* **Push** is still sent from the VPS: the Worker asks for it with a signed `POST /v1/internal/code/notify {jobId, kind, text}`; the VPS pushes to the job's owner, looked up from the job.
* A person's **own computer is not offered** as a place for these jobs: which PCs are online is the VPS's memory. GitHub's free computers are.
* Web reads (`read_page`, `web_search`, `find_resources`) go through the `safeFetch` seam (`tulmi/src/web/safeFetch.ts`): the VPS installs `egressFetch`, the Worker installs `workerSafeFetch`. A page that needs its scripts is rendered by Cloudflare's Browser Rendering (`WEB_BROWSER=cloudflare`).

**Tests.** `tests/code-agent-advance.test.ts` (the entry: every wait and end, a claim held, a passive orchestrator), `tests/code-jobs-cloudflare.test.ts` (the VPS hand-off in the routes), `tests/jobs-handoff-*.test.ts`, `tests/code-internal-notify.test.ts`; and in `jobs/test/`: `loop-in-workerd.test.ts` runs a whole job (plan, edit, checks, commit, PR, a question, finish) advance by advance inside the Workers runtime over this same `agent-rig.ts`.

## 13. The live session

The model works the way a person with an editor and a terminal does, not the way a script with a network round trip for each look does. With the jobs on Cloudflare (`docs/cloudflare-jobs.md` section 10) the loop is given four optional ports, `AgentDeps.live` (`tulmi/src/code/live/ports.ts`). Without them, which is the VPS in local mode and any test that gives none, nothing in this document changes.

| Port | What the loop asks | What it is |
| --- | --- | --- |
| `files` | read, list, glob, grep over the job's code | The job's **room**: a copy of the branch head in a Durable Object's SQLite, with the staged edits laid over every answer. Reads and searches are instant and cost no model and no runner |
| (the runner) | `run` | One runner kept open for the job. **Opened late** (the first `run`, not the start of the job), **closed after two idle minutes** (`CODE_SESSION_IDLE_SEC`), at most `CODE_SESSION_MAX_MIN` (20) minutes of it per job; after the cap commands are steps of their own, as before |
| `inbox` | the person's words | `POST /v1/code/jobs/:id/message {text}`: kept in the room (or, in local mode, in the process's memory) and shown to the model at the **start of its next turn**, in the person's own words, as part of the task. It is acknowledged only after it is saved in the job's state, so a restart shows it again rather than never, and an id keeps it from being shown twice. It never changes what Tailzu may do: the policy, the budget and the safety rules are the same whatever is said |
| `progress` | events for the app's live view | The phase, each tool call (`grep slug`, `edit_file src/util.ts`) and the first line of its result, the output of a running command, the cost so far, and the end. Scrubbed of secrets, never a file's contents. Fire and forget: a lost event is a gap in a view, never a failed job |
| `closeSession`, `endJob` | the rules only the loop can keep | `closeSession("needs_you")` is called **before** the person is asked anything (a session open while a person thinks costs minutes); `closeSession("job_end")` before the job is finished (a job cannot be done with a step out); `endJob` after, which **deletes the job's copy of the code**. Tailzu never keeps a person's code |

What the loop does to keep these honest:

* **The staged edits are given to the room whenever they change** (`Changeset.rev`), and travel with every command as its overlay, so a grep, a read and a test run all see the same code: the branch plus the work so far.
* **A commit invalidates the copy** (`Tools.invalidate`): it is of the commit before this one. The next need makes it again.
* **Nothing the live session does can fail a job.** A room that is down, a runner that does not come, a progress hook that throws: the tools go back to GitHub's API and the runner back to a step of its own. The only thing the session can change is how long things take.
* **Output is scrubbed** before it goes into a checkpoint, a work log or an event.

The tools' own descriptions tell the model to use `grep` for anything exact, `glob` for names, `search_code` for "where is the feature" and `read_file` after, and to batch commands in a `run`.

## 14. Free-form jobs

The guided road is right when the task names its place: locate, plan, work. It is wrong for "why does checkout sometimes fail?", "find out what is eating the memory", "try a few things and see": there is no place to locate yet, and a plan written before the exploring is a guess. A **free-form** job (`AgentState.mode = "freeform"`) lets the model decide the order of explore, change and run:

```
prepare ► baseline ► work (read, search, run, edit, run again ... in the model's own order) ► verify ► commit ► pr ► report
```

* **Chosen** by the front door (a code task whose words are open-ended: debug, investigate, find out why, track down, an intermittent or flaky failure; `docs/front-door.md`), by `mode: "freeform"` on `POST /v1/code/jobs`, or for every job of a project by its setting (section 15). A job's own word beats the project's; the default is guided. The same job on the same project is guided or free-form, never half of each.
* **The same rails.** Free-form means the model chooses the order, not that it chooses the rules. The budget (a turn the money cannot cover is not made), the policy, the staged changeset, the secret scan, text from outside as data, checkpoints, and **verify before commit** (section 1) are exactly the guided job's. It never gets a tool that commits.
* **Held in a way of its own.** The model is told, in the task, that the order is its to decide and how much it has. A free-form job has at most **40 steps** (a step is a turn and its tool calls; the guided job has 60 turns) and **25 runs** in all (a guided round has 10): investigating means running things, and a model that may decide anything is easy to lose in. At the step cap the work is called done with a note, and goes on to the checks with what is staged.
* **Plan-first still plans.** A free-form job with "show me the plan first" runs one locate (that never stops to ask) and one plan, waits for the yes, and only then works.

## 15. "Always show me the plan first"

A person who wants to see what Tailzu intends before it does anything sets `planFirst` (on the project, `PUT /v1/code/projects/:id/settings { planFirst: true }`, or on one job). Then **every task's plan goes to the person for a yes before any work**, whatever its risk, in either mode: the job parks (`waiting_for_you`, `approval`, the plan's steps and files in the summary), and goes on when they `approve` (the two-step question of section 6) or ends when they `deny`, with nothing changed. Without the setting only a high-risk plan, or one the policy would ask about, waits, as before. The setting is the project's (`code_project_settings`, migration 0034, one row per project, the owner's); a job's `planFirst` beats it in either direction. PR care's jobs obey it too.

## 16. Rewind

After every step of the model's work the staged edits as they then stood are kept with a line on what the step did (`rewind.ts`; `code_job_checkpoints`; the last 60 steps and 3 MB of staged text in all, the oldest dropped first; they go with the job and are the owner's to read). `GET /v1/code/jobs/:id/checkpoints` lists them; `POST /v1/code/jobs/:id/rewind { toStep }` goes back to one (`0` is before any work):

* **Before the commit** the staged edits are put back as they stood after that step; what the model did since is forgotten (it is given the notes it had then); and the job goes on working from there. The loop that was running is fenced off first (the claim's epoch moves), so it can write nothing more. A job that is over and made no commit has nothing to go on with (`409 job_over`).
* **After the commit** a **new commit** returns the files the job changed to what they were at that step (the staged text of the step, or the branch as it was before the job's first commit), made through the policy like any commit. **History is never rewritten**: no reset, no force, no rebase; the old commits stay as its parents. The job ends. If the policy would ask for the person's yes, the answer is `{ kind: "needs_approval", approvalId, ... }` and the same call with that `approvalId` makes the commit; a standing "never" refuses it (`403 policy_denied`) and nothing is pushed. If the branch already is what the step had, no commit is made.
