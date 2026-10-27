# Lead and helpers: the Code bot's way of doing a big goal

A small task is one agent job (`docs/code-agent.md`). A **big** goal (a feature across many files, several features at once, a change in more than one repo) is better as a **team**: the agent becomes a **lead** that splits the work into **parts** with clear file ownership, **helpers** build the parts in parallel (each a child agent job on its own branch), a model of **another family** reviews each part, and the lead merges the parts in dependency order, checks everything together and opens **one pull request**.

The code is `tulmi/src/code/team/` (nothing in it reaches a network or a store except `spawn.ts`, `integrate.ts`, `lead.ts` and `report.ts`, which go through the agent's `Run`). The agent's own phases and the orchestrator carry it; this page is what is new.

```
src/code/team/
  types.ts        the words: PartSpec, TeamPart, TeamState (the lead's state), PartContext (a helper's), the numbers, the views the routes and the stream send
  globs.ts        what a glob owns, and whether two globs can reach the same file (the segment-by-segment intersection, so a file nobody has made yet counts)
  split.ts        role team_split: the model proposes the parts, CODE decides whether they will do (validateSplit); a refused split is asked again with the reasons
  when.ts         leadDecision(): who gets a lead (never a small task); afterPlan(): the phase after the plan
  guard.ts        OwnedPaths: the changeset's guard for a helper (and for the lead during part 0); the tool error a helper reads
  budget.ts       the reserve, the slices, what a team costs at least, how many helpers at once
  diff.ts         the unified diff of a part's changes, for the reviewer
  changes.ts      a part's changed files, read as they were at the base and as they are on the helper's branch
  children.ts     what a helper job is doing, read from the job store (never from the lead's memory)
  spawn.ts        making a helper's job: its branch, its plan, its budget, its state; adopting one that was already made
  review.ts       role team_review: the reviewer of a part (a different family from the helper's)
  integrate.ts    merging a part into the lead branch: server-side, two parents, through the policy; a conflict goes to the runner merge flow
  lead.ts         the lead's phases: split, contracts (part 0), team (the loop over the helpers), the final check, the money
  report.ts       the parts table, the review summary, the combined work log, the links between projects' pull requests
```

## 1. When a job becomes a lead

`leadDecision` (`when.ts`) is asked after the plan is made and approved (the same plan that decides everything else, `planChange`):

| The plan or the person | A lead? |
| --- | --- |
| more than **12 files** (`FILES_MAX` in `work/plan.ts`) | yes, why `files` |
| more than **3 features**, parts of the app the files are in (`FEATURES_MAX`) | yes, why `features` |
| the goal spans **several projects** of the person's (`projects` on the job) | yes, why `repos` |
| the person asked for a team (`team: "on"`, or the words "with a team", "use helpers" at the front door) | yes, why `asked` |
| the person said no (`team: "off"` on the job, or the project's setting, or "do it yourself") | **never**, whatever the plan reaches |
| anything else: a small task | **no**, it is one job and costs nothing extra |
| `CODE_TEAM=false` on the server | never |

The setting is `team` in `PUT /v1/code/projects/:id/settings` (`"auto"` is the default, `"on"`, `"off"`; table `code_project_settings`, migration 0037). A job's own `team` beats the project's. The front door (`docs/front-door.md`) reads the request's words (`front/rules.ts`) and passes `team` on; a request that says nothing leaves it to the plan.

A helper is **never** a lead: a job with a `part` in its state skips the decision and does its part.

## 2. The split

`splitWork` (`split.ts`) is the `team_split` role on the **strong** tier (`routeStep("plan")` at high difficulty). It is shown the plan, the plan's files and what imports what among them, the parts of the app they are in and the project's file list (the brain's), and answers `parts`, each with:

```
{ id, title, goal, ownedPaths (globs), reads, dependsOn, acceptance, budgetShare, repo? }
```

**Code decides, not the model** (`validateSplit`). A split is accepted only if:

* **No two parts' `ownedPaths` can reach the same file.** `globs.ts` decides on the patterns (`src/api/**` and `src/**/index.ts` overlap, `src/a/**` and `src/b/**` do not), so a file a helper has yet to create counts. An overlap is **refused**: the model is told which two parts and which globs, and the split is asked again, **three rounds at most** (`SPLIT_ROUNDS_MAX`).
* **Part 0 is the shared contracts** (types, interfaces, schema, config): **owned by the lead and done first**. Every helper depends on it.
* Every file the plan names belongs to exactly one part; every glob is one the matcher can read; no part owns the whole repo; **workflow files and secret files are owned by nobody**.
* The dependencies are a graph without a cycle; the parts are renumbered in an order they can run, a part after what it needs; the budget shares are normalised.
* At least **two helpers** can run side by side (a team of one is a job), and there are at most **eight** (`PARTS_MAX`).

A split that cannot be made right is not forced: the lead does the work itself as an ordinary job and says so ("I could not divide this into parts that do not overlap, so I did it myself as one job") in the work log and the report.

## 3. Part 0, the helpers and the guard

1. **Part 0** is built by the lead itself in the ordinary `work` phase, with its changeset guarded to the contracts' globs (a lead that edits a helper's files in this stage gets the tool error below). It is verified, committed and pushed to the lead's branch (`tailzu/<slug>`). A split with no contracts (`none`) skips straight to the helpers.
2. **A helper** is a **child job**: `createJob` for the same project, its `parentId` the lead's, its branch `tailzu/<slug>-p<k>` cut by `createNamedBranch` **from the lead's head after part 0**. Its state is written by the lead: the part's plan (files, steps, checks from the impact graph), `phase: "work"`, and a `PartContext` (goal, `ownedPaths`, `reads`, `acceptance`, and in a fix round the reviewer's findings as data). It does not locate, plan or split; it works, verifies its own part, commits, pushes and ends. It opens **no pull request** and sends the person **no notification** of its own (the lead speaks for the team).
3. **The owned-path guard.** A helper's changeset is built with `OwnedPaths` (`guard.ts`): an `edit_file`, `write_file` or `delete_file` of a path outside its `ownedPaths` is **refused before anything is staged**, with a tool error the model reads: "`<path>` is not yours. You are part 2 and you may change only `src/api/**`; another part or the lead owns it. Do not edit it and do not work round this. Ask the lead: write what you need changed there in a `note` and in your `done` summary…". The refused paths are kept (`TeamPart.refused`) and shown to the reviewer and to the lead, who can act on them.
4. **Parallel.** At most `CODE_TEAM_PARALLEL` helpers work at once (**3** by default, 1 to 8), never more than the server drives at once, and fewer when the places to run them are few: **the person's own PC first** (free, one step at a time), **then GitHub Actions** (free minutes, shared and limited: about 20 minutes a helper is counted against what is left of the month), paid compute only by the person's own rule. With no PC and few minutes left, helpers go one after another instead of piling up waiting for a place. The sentence that says why the cap is lower than asked is in the work log.

## 4. The money

**One budget bounds all of it.** The person's budget on the lead job is the team's whole.

* The lead keeps a **reserve of 20%** (`RESERVE_FRACTION`) for itself: part 0, the reviews, a conflict, the full check, the pull request.
* The rest, the **pool**, is divided among the helpers by `budgetShare` (`sliceBudgets`: whole paise, the slices add up to the pool exactly). A helper's slice is **its own job's budget**, so the gateway stops it at its slice like any job.
* A slice is **taken from the lead's wallet when it is handed out** (the lead's spend goes up by the slice), so nothing the lead does afterwards can spend what a helper was given; what a part did not spend is **given back** when it ends. So the figure on the lead is the team's whole cost once it is over. Writing the amount before applying it makes the hand-out idempotent through a crash.
* A budget that cannot pay the reserve and at least **150 paise** (`PART_PAISE_MIN`) for each helper does not start a team: the lead parks asking for more (`waiting_for_you`, `budget`, with the figure that is short), and the person adds money (`POST .../budget`), or says "off".
* **A part that runs out** stops the way a job does: it is `exhausted`, not failed. The rest of the team goes on; the lead does not finish, it parks for money (`waitingOn: "budget"`, saying which part and how much) because a pull request without that part would be wrong. `POST /v1/code/jobs/:id/team/parts/:k/rerun { addPaise }` gives the part more (and adds the same to the lead's budget), or the person stops the part, or adds money to the job.

## 5. The review

Each finished part is read by `team_review` (`review.ts`) on the **review tier**, and **never by the family that wrote it** (`familyOf` of the helper's model against the reviewer's; the router is told `writerModel` and picks from `reviewCandidates`; a pinned model of the same family is refused after the fact too). The reviewer is shown the part's goal, its acceptance, the diff of what the helper changed (bounded: `REVIEW_DIFF_CHARS`), the refused paths and the helper's own checks, as data. It answers `pass` or `fix` with findings (`blocker`, `major`, `minor`, `note`).

* A **blocker or a major** finding makes a **fix round**: a new helper job on the same branch (free-form, with no plan of its own), given the findings and told to change nothing else. **At most two** (`REVIEW_FIX_ROUNDS_MAX`). After the second the part is `failed` with the findings that were left open, and the lead does not pretend otherwise.
* Minor findings and notes go into the pull request's review summary.
* A review that cannot be made (no reviewer of another family is available, the budget is short, the model is down) is **skipped with the reason**, written in the parts table ("review skipped"); it is not a pass.

## 6. Merging, the full check and the one pull request

The lead merges parts **in dependency order**, one at a time, each only after it is approved and everything it depends on is merged (`integrate.ts`):

* A merge is a **commit with two parents** (the lead's head and the part's head) made **by the server through the policy** (`Workspace.mergeCommit`: the Blip author, the secret scan, the questions the policy asks): the PR-care merge, reused. The tree is the lead's with the part's files laid over it. Nothing is rebased or forced; the lead's branch only moves forward.
* Because parts own disjoint files there is normally nothing to resolve. A file the lead changed since the part was cut (a person pushed, or a refused path that mattered) is a **conflict**, and the whole part goes through the **runner merge flow** (`agent/merge.ts`): a computer merges the part's branch into the lead's with git, the model judges and resolves what clashes, the project's checks run, and the server commits the result.
* A part whose files are already in the lead branch as the part has them is merged already; merging twice does nothing.

When every part is merged, the lead runs the **full verify** (the `verify` phase on the whole branch, compared with the baseline taken before anything started; what was already failing is flagged and does not block, as everywhere). What this team broke goes back to the lead for a fix round (three at most). If the job is built from an approved design (`docs/artifacts.md`), the **design round** (`docs/code-agent.md` section 1) runs once, on the whole, and only on the lead. Then:

**One pull request** (`pr` phase, opened by the lead only; helpers open none). A draft, taken out of draft only when the full verify found nothing this team broke **and every part merged and passed its review**; a part that failed, was stopped or ran out leaves it a draft. Its description carries, besides the usual plan and checks:

* the **parts table**: each part, what it was for, how it ended, the model that reviewed it (and that it was not the family that wrote it), the fix rounds, what it cost;
* the **review summary**: what each reviewer found and what was left open;
* the **combined work log**: the lead's own, then each helper's under its part (everything redacted before it goes into the person's repo).

## 7. Several repos

A goal over several projects (`POST /v1/code/jobs { projectId, projects: [otherProjectId, ...], ... }`; the other ids must be the person's own, and at most `REPOS_MAX` = 3 besides the job's own) is split **by repo**: the lead's own project is split into helper parts as usual, and each **other** project is one part with `repo` set. A project's part is not a helper: it is that project's **own job** (`spawnRepoLead`, a child of the lead like a helper), given its share of the goal as a task that stands alone (it does not know the other repo's files), which prepares, plans, splits if its plan is big, builds, verifies and opens **its own pull request**. So there is **one pull request per project**.

When the pull requests are open, the lead **cross-links** them: each description gets a block between `<!-- tailzu-team-links -->` and `<!-- /tailzu-team-links -->` listing the other projects' pull requests (replaced, not added to, if the lead runs it again). The report names all of them. The budget is divided between the parts by `budgetShare` like any other split. A goal over several projects that cannot be split into parts that do not overlap **stops with nothing changed** instead of falling back to one job, since one job cannot work in two repos.

## 8. Staying alive: checkpoints, waking and crashes

* **The parent checkpoints its children.** The lead's `TeamState` (parts, statuses, helper job ids, the money handed out, what was merged, what was written to whom) is saved in its checkpoint after every step, like any state. Nothing about the team lives only in the lead's memory.
* **A child that finishes wakes its parent.** When a helper ends, or needs the person (a question, a yes, money), the router tells the orchestrator (`onEnded`), which wakes the lead: locally the orchestrator re-claims it at once; on Cloudflare it sends the lead's Workflow a `wake` event (section 10). Otherwise the lead looks again every **20 seconds** while a helper is working (`TEAM_REST_MS`), and every five minutes while only the person can move things on. A helper that needs the person is the person's question on the **helper's** job (the app shows it); the lead shows the part as `blocked`.
* **A crash resumes without re-running finished parts.** The lead is a job like any other: another process adopts it from its checkpoint (`docs/code-agent.md` section 2). It reads the helpers' state from the job store, not from memory; a part that is `merged` is not touched; a helper job that was made but not yet recorded is **adopted** (`isChildOf`: same parent, part, round, attempt) instead of made twice; a hand-out of money that was written but not applied is applied once.
* **A lead that ends** (stopped by the person, out of budget, failed) cancels its helpers and gives back what they had not spent.
* A job that is a lead or a helper cannot be **rewound** (`docs/code-agent.md` section 16): a rewind of the lead would disagree with the branches it already merged.

## 9. The routes

Both are the owner's only, behind the session, `404 agent_off` without the agent.

```
GET  /v1/code/jobs/:id/team                       -> { job, team, children }
POST /v1/code/jobs/:id/team/parts/:k/stop                                       stop one part
POST /v1/code/jobs/:id/team/parts/:k/rerun        { addPaise? }                 run it again
```

* `GET .../team` says why there is a team (`files`, `features`, `repos`, `asked`), the stage (`contracts`, `run`, `final`, `done`), the money (the budget, what is spent, the lead's reserve, the helpers' pool), and for each part its id, title, goal, owned paths, status, branch, helper job, review (verdict, model, findings), fix rounds, refused paths and cost; and `children`, each helper job with its state and what it waits for. It carries no file contents. `404 not_found` for a job that leads no team.
* `POST .../stop` ends one part: its helper is stopped **now**, and the lead leaves it out and everything that depends on it (`skipped`). `409 part_over` for a part that is already merged, failed, stopped or skipped.
* `POST .../rerun` runs a part again after it `failed`, was `stopped` or `exhausted` (or its dependency did, `skipped`). `addPaise` (a whole number of paise) gives it more and adds the same to the job's budget. `409 part_not_over` for a part that is still going; `409 job_over` for a lead that has ended.
* The lead is the only one that writes its state, so these leave a **command** in its checkpoint (`teamCommands`, at most 20, each applied once by its id) and wake it to read it; a lead parked for a part's money goes on at once.
* `POST /v1/code/jobs` takes `team` (`"auto" | "on" | "off"`) and `projects`; the project's `GET/PUT .../settings` now carries `team`.
* **The stream** (`docs/code-agent.md` section 13) carries the board for the app's team view: `{ t: "team", parts: [{ id, title, status, jobId?, spentPaise, budgetPaise }], at }`, at most 12 parts, sent when a part's status changes. A viewer that joins late is sent the last board in its snapshot. No file text, no diff.

## 10. On Cloudflare (`CODE_JOBS_MODE=cloudflare`)

A helper is a job like any other: it needs a Workflow of its own, and a lead waiting for its helpers must not poll.

* **Starting a helper.** The lead writes the helper's state, then `deps.team.start(jobId)`. On the Worker that is `startAgentJob` (`jobs/src/workflows.ts`): the job's id is the instance's id, so a second start finds the first (a lead that came back after a crash asks again, and nothing runs twice). Locally `start` hands the job to the orchestrator's queue.
* **Waiting for the helpers.** When there is nothing for the lead to do until a helper moves, the advance returns `{ next: "wait", waitingOn: "team", waitMs }` and `AgentJob` (`jobs/src/agentJob.ts`) does `step.waitForEvent("wake")` with `waitMs` as the timeout (1 second to 1 hour; the lead asks for 20 seconds, or five minutes if only the person can move things). A timeout is not an error: the lead looks at its helpers again.
* **Waking.** A helper that ended or needs the person makes the orchestrator call `deps.team.wake(parentId)`: on the Worker `wakeAgentJob(env, parentId, "team")`, a `wake` event of kind `team`. The VPS can send the same through `POST /v1/event { jobId, kind: "team" }` (`team` is in `WAKE_KINDS`). An event sent before the lead reaches its wait is kept and delivered when it does (Workflows' event timing), so no wake is lost; a wake for a lead whose Workflow is over is dropped quietly.
* **More money for a helper** that ran out: `addBudget` is the orchestrator's own, then the helper's Workflow, which is waiting for the person (`budget`), is woken.
* **The board** goes through the job's room: the Durable Object's `compact` keeps four fields and the title (cut to 80 characters) of at most twelve parts and drops anything else the event carried.
* The Worker's claim is five minutes and the lead's advances are short (a look at the helpers, one merge, one review), so a Worker never holds a lead for long.

## 11. Setting up

```
CODE_TEAM=true             lead and helpers mode on (the default). false: every job is one job.
CODE_TEAM_PARALLEL=3       helpers working at once (1 to 8)
```

Run `supabase/migrations/0037_code_team.sql` (it adds `code_project_settings.team`, default `auto`, checked to `auto | on | off`; it is also at the end of `supabase/full_schema.sql`). Without it the settings route still works: the `team` setting just does not stick, and a job's own `team` on `POST /v1/code/jobs` does. Nothing else to set: it uses the models the router already picks for the strong and review tiers, so **a different family for review needs two families configured** (`docs/code-router.md`); with one, the reviews are skipped with that reason and the pull request stays a draft.

## 12. Safety, in one place

* **Ownership is enforced by code**, in the changeset, before staging. The model's promise to stay in its files is not relied on.
* **The split is validated by code**; a model that proposes overlapping parts is asked again and then not trusted.
* **Text from a helper, a reviewer and the repo is data** everywhere it is shown to another model (fenced, `forModel`), and a reviewer's finding is redacted and cut before a helper acts on it or the pull request prints it.
* **Merges and commits go through the policy** like any commit: the secret scan, the Blip author, the person's rules. A standing "never" stops the lead with the reason.
* **Workflow files and secret files are owned by nobody**, so no part can change them.
* **One budget**, the slices taken in advance, nothing spent past the person's figure.
* **Helpers can neither open a pull request nor mark one ready.** Only the lead does, once.

## 13. Tests

All with fake models, fake runners and fake tokens built at run time.

* `tests/code-team-split.test.ts`: the globs; split validation (an overlap is rejected and the reasons are given, part 0 comes first, dependency order, cycles, the plan's files covered, forbidden paths, budget shares); when a lead is used (a small task never gets one).
* `tests/code-team-flow.test.ts`: a whole team over a scripted rig: the owned-path guard and its tool error, helpers in parallel with the cap, a different reviewer family, the board.
* `tests/code-team-rounds.test.ts`: fix rounds (two at most), merge order, the conflict path through the runner merge flow, the full verify gating the pull request.
* `tests/code-team-money.test.ts`: the budget split, a team that cannot be afforded, one part running out and being given more, a lead that crashes and resumes, adoption of a helper already made, a lead that ends.
* `tests/code-team-repos.test.ts`: several repos become two linked pull requests.
* `tests/code-team-routes.test.ts`: `GET .../team`, stop and rerun and their refusals, the settings, the solo fallback, the stream's board.
* `tests/code-team-advance.test.ts`: the Worker's way of driving a lead (`advanceLoop` with `waitingOn: "team"`).
* `jobs/test/team-wake.test.ts`: the Workflow waits for its helpers with `waitForEvent`, is woken by a helper's end and by `/v1/event`, keeps an early wake, goes on at the timeout; starting a helper twice; a wake for a lead that is over; more money wakes a helper; the board through the room.
* `tests/team-rig.ts` is the rig: the agent rig with a 16-file repo, one scripted model for each job (so the lead, each helper and each reviewer answer what the test wrote for them), and a driver that settles the whole team.
* The two roles' evals are `evals/team_split.jsonl` and `evals/team_review.jsonl` (`docs/principles.md`).

## 14. What needs a live check

* How well a real strong model splits a real repo: whether its globs are tight enough that a fair share of splits pass the overlap check at the first try (the work log says how many times a split was asked), and whether the parts it picks are really independent. `npm run eval:prompts -- team_split team_review` runs the fixtures against real models.
* The cap against real compute: three helpers on one person's PC take their turns on the one runner; three on GitHub Actions use the month's minutes three times as fast.
* A conflict on a real repo with a real person pushing to the lead's branch while helpers work.
* Cost: a team is dearer than one job for the same goal (a split, a reviewer for each part, a merge, a full check); it pays only when the goal is big enough that one job would run out of turns or context. The thresholds (12 files, 3 features) are the milestone split's, kept so the two agree.
