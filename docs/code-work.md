# The Code bot's work core: layers 5, 6 and 7

Layer 1 (`docs/code-brain.md`) is which model to ask and what it may cost, layer 2 the loop that writes code, layer 3 what the bot finds on the web (`docs/web-search.md`), layer 4 what it knows about one repo (`docs/code-project-brain.md`). **Layers 5 to 7 are what the bot does with that knowledge before it types a line**: find where a change belongs, plan it, keep an honest account of the work, choose and check the libraries it uses, write research down, and, in an empty repo, plan a whole project. They are libraries for the agent loop to call, plus four thin routes. Nothing here edits a file, runs a command or merges anything; the loop does, through the workspace and the environment router, under the policy (`docs/github-app.md`, section 5).

```
tulmi/src/code/
  work/         layer 5
    model.ts      the one door to a model for these files: askJson (callModel, the job's budget, JSON checked), fencing, forModel
    cues.ts       the free reading of a request: quoted strings, UI words, identifiers, paths, routes, errors, stack frames
    locate.ts     where does this request belong?
    impact.ts     what a change reaches, from the import graph
    plan.ts       what to change, in what order, how to prove it
    worklog.ts    the per-job log, and the markdown for the PR
    worklogStore.ts   the log's store (memory twin and Supabase)
    findings.ts   the checks against the baseline: we broke it, it was already broken, we fixed it
  resources/    layer 6
    finder.ts     "a date picker for React" -> a ranked shortlist with a pick
    audit.ts      the project's dependencies against OSV
    brief.ts      a research brief, committed to docs/research/
    licences.ts semver.ts osv.ts lockfiles.ts net.ts read.ts   their parts
  newproject/   layer 7
    detect.ts     is this repo empty?
    intake.ts     at most five questions
    spec.ts       the spec (strong tier) and the stack (rules)
    planDoc.ts    PLAN.md and its milestones
    scaffold.ts   the official starter command, as a step spec
    milestones.ts a branch, a draft PR and a preview link per milestone
    intakeStore.ts   the intake's store
  routes (src/routes/code.ts)   POST /v1/code/projects/:id/{locate,resources,audit,intake}
```

No npm dependency was added. Every model call goes through `callModel` (layer 1) with the job's budget, at the cheapest tier that does the work; every network call takes an injected `fetchFn`, every clock an injected `now`, so the tests (`tests/code-work-*`, `code-resources-*`, `code-newproject-*`) reach nothing. The four routes are **off unless `CODE_PROJECT_BRAIN=true`**, as the brain is; the libraries need nothing but the brain's handle.

## 1. Layer 5: locate

```ts
const where = await locate(task, brain, { model, read });
// { targets: [{ path, lines?, why, signals, score }], related, tests, confidence, question? }
```

Most of the cost of a coding job is paid in the first minute, by a model reading the wrong files. The brain already knows the repo, so finding the right file is a search problem first and a model problem only when the search is honestly unsure.

1. **Cues, free** (`cues.ts`). From the request's own words: quoted strings, the words of a UI ("the button that says Get started"), identifiers (`fetchUsers`), file paths, routes (`/api/users`), error lines and the first stack frame, and the feature nouns ("checkout", "login"). A secret in the request makes the whole request "tainted": nothing of it, and none of the words read from it, is ever shown to a model.
2. **Five signals**, each a ranked list of files and each a read of the brain, no model: a file the request names (or a stack frame points at) (`path`), `findTexts` (the strings a person sees; very strong for a UI task), `findSymbols`, `findFiles` and `feature`. How central a file is and how often it changes are a weak prior, no more. When the free cues find fewer than two *strong* hits, the cheap tier is asked once for synonyms (signup, register, create account) and the signals run again.
3. **Fusion.** Weighted reciprocal-rank fusion (`K = 6`): a file's score is the sum, over the signals that found it, of the signal's weight × how good the match was × 1/(K + rank). Weights depend on the request (a UI task trusts the visible text more, a named identifier or route trusts symbols more, an error or a stack frame trusts the path most). A file two signals agree on beats a file one signal found, however well. A text match on some of the words only (not all) counts for nothing.
4. **One hop.** `neighbors()` of the top three and `testsFor()`: the places a change spills into.
5. **Confidence**, from the margin between the first and second file and from how many of the signals that found anything agree on the first:

| Confidence | What happens |
| --- | --- |
| over 0.75 | done; **no model call** (a path, a symbol, a route, a trace or a UI text is usually enough) |
| 0.45 to 0.75 | the cheap tier reads excerpts of the top eight (the head, the exports, the matched lines and the 20 around them) and picks, or says it cannot separate two |
| under 0.45, or a tie that is still there | `question`: a crisp question with two or three labelled options (real candidates first, then features); the agent loop turns it into `needs_you` |

A model that is down, or a job that cannot afford a call, costs only the step it was for: the answer so far stands, with the confidence it had. Excerpts come from the workspace's `read` when the route or the loop gives one, and from the brain's own rows (summary, exports, matched strings) when not.

## 2. Layer 5: plan

```ts
const plan = await planChange(task, where, brain, { model, read, remainingPaise });
// { steps: [{ n, do, files: [{ path, action: edit | create | delete }] }], impact, verify, risk, milestones?, notes }
```

The code tier writes the steps (the router moves it to strong for a risky or hard change, and to a cheaper one when the money is short), and **nothing else**. Everything a person needs in order to trust the plan is worked out from the brain instead of asked of the model:

* **Impact**: the importers of every changed file, the routes the changed files serve, the tests that cover them, config, migrations and env names touched, and the public API changed (`impact.ts`, from the graph).
* **Verify**: the commands that prove it, in order: the affected tests first (only those, when the runner can take a file list: `vitest run <files>`, `jest <files>`, `pytest <files>`, `go test <packages>`), then the project's own typecheck, lint and build from the baseline plan. A runner with nothing to check for this change is skipped, not run for nothing.
* **Risk**: the classifier's view of the request (layer 1), raised by the impact (money, auth, migrations, wide reach).

**Validation.** A model that is wrong about the repo is the commonest failure of a plan, so every file in it is checked against the brain before the plan is believed:

| In the plan | The rule |
| --- | --- |
| `edit`, `delete` | the path must exist. A path that does not, but whose tail or name matches exactly one file, is mended (and said); any other is asked about once, with the files that are really there, and if it is still wrong it is dropped and said |
| `create` | the path must not exist yet. One that does is an `edit` |
| never | anything under `.github/workflows/`, a path outside the repo or inside `.git`, the runner's own files, an `.env` or a key: dropped and said, whatever the model meant |
| too big | **more than 12 files, or more than 3 features,** is split into `milestones`, each its own branch and pull request |

A plan with nothing left after this is a `PlanError`, not an empty plan.

## 3. Layer 5: the work log

```ts
const log = new WorkLog(jobId, { now });
await log.edit("edit", ["src/components/Button.tsx"], "Renamed the prop");   // also step, read, command, finding, decision, question, note
await worklogMarkdown(jobId);                                               // the section of the PR body a reviewer reads
```

A pull request from a bot is only as trustworthy as its account of itself. As a job goes, the loop writes down, in order, eight kinds of entry: `step`, `read`, `edit`, `command` (with its exit code, duration and summary, and the baseline verdict), `finding`, `decision`, `question` and `note`. `worklogMarkdown` writes up what changed and why, the files, the checks and what they said, the findings and the decisions.

* **Nothing secret is kept.** Every line, every path and every leaf of `data` goes through the policy's secret scan before it is stored: a token on its own becomes `[redacted]`, a line the scan flags only as a whole (`api_key: "..."`) is withheld, a private key's block becomes a note, and whatever still trips the scan is replaced outright. The log goes into a pull request; it must not be a way for a secret to get there. The scan is the commit policy's (`docs/github-app.md`, "The secret scan"): GitHub tokens, AWS keys, Slack tokens, private keys and named values (`api_key = ...`). A bare key of a provider it does not know (a Stripe `sk_live_...` on its own) is not recognised by it, here or anywhere else the policy scans.
* **A log that cannot be written is a log that is lost**, never a job that fails: `append` swallows the error and returns `null`.
* Entries are cut (1,500 characters a text) and a job keeps 2,000 of them; past 1,000 the quiet kinds (`read`, `note`) are dropped so the rest still fit.

## 4. Layer 5: findings

```ts
const verdict = compareToBaseline(baseline, results, { touched });
// { broke, alreadyBroken, fixed, ignored, checks, ok, summary }
```

Before its first edit a job runs the project's own checks on the untouched branch and keeps what they said (layer 4). After its edits it runs them again. A red check proves nothing by itself: if the tests were red when the bot arrived, a red test is the project's, not the bot's, and blocking the pull request on it (or "fixing" it) would be wrong twice.

| Verdict | Meaning |
| --- | --- |
| `broke` | it passed at baseline and fails now: a blocker |
| `alreadyBroken` | it failed at baseline too: flagged "was already broken before Tailzu", not ours |
| `fixed` | it failed at baseline and passes now |
| `ignored` | lint errors in files the change did not touch: the project's lint debt is not the change's |

Things are told apart by name: a test is its name as printed; a lint problem is its file and rule (line and column are left out, because a line number moves when a file is edited above it). A check that failed with no names (a build) is compared as a whole. When a check was already failing and the baseline did not keep what failed, Tailzu says it cannot prove the change made it worse, and claims neither. A check with no baseline at all counts as `broke` when it fails: nothing says it was red before.

`flagFinding({ severity, path, line?, text }, { log })` is for what the bot notices while reading code it was not asked about (a bug, a security smell, dead code): cleaned, cut, and written to the work log, from where it goes into the PR body.

## 5. Layer 6: finding a library

```ts
const found = await findResources("a date picker for React", brain, { fetchFn, closedSource });
// { need, ecosystem, candidates (ranked, six), pick, pickReason, notes }
```

Choosing a library is the decision a project lives with longest, and the one a model is worst at from memory (it recommends what was popular when it was trained). So this **asks no model**. It searches with layer 3 (the registries, GitHub and Hacker News), takes the first six packages that really exist, and looks each one up:

| Check | From | Judged |
| --- | --- | --- |
| Licence | the registry, as an SPDX id | MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, Unlicense and MPL-2.0: ok. LGPL and EPL: warn. GPL and AGPL: **strong warning for a closed-source project** (a private repo is taken for one), warn otherwise. None or unknown: warn ("all rights are reserved"). `A OR B` is as good as the better, `A AND B` as bad as the worse |
| Maintenance | last publish, `deprecated`, an archived repo, stars and open issues when GitHub will say | |
| Security | OSV, `POST https://api.osv.dev/v1/query` at the version it would install | how many, how bad (CVSS v3 computed), and the version that fixes them |
| Size | npm's unpacked size and dependency count (PyPI: the release's size and `requires_dist`) | |
| Popularity | weekly downloads | |
| Stack fit | its peer dependencies against the project's framework versions (the brain's manifests) | React 17 only, in a React 18 project, is poor |

The score is out of 100: relevance 25, licence 20, maintenance 20, security 15, popularity 10, size 5, fit 5, **minus 30 for each thing that rules a package out** (deprecated, archived, an unfixed critical vulnerability, a strongly warned licence). `pick` is the best one nothing rules out; if every one is ruled out it is `null` and `pickReason` says why, rather than naming the least bad. A lookup that failed leaves the package scored on what is known, with the reason saying what is not (`security: not checked`), never as if the answer were clean.

## 6. Layer 6: the dependency audit

```ts
const audit = await auditDeps(brain, fetchManifest);
// { source, approximate, checked, scanned, vulnerable: [{ name, version, severity, fixedIn, vulns }], counts, notes }
```

What is *installed* decides whether a vulnerability matters, and only a lockfile says what is installed. So the audit reads the lockfiles the brain knows exist (`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml` v5/v6/v9, `yarn.lock` v1 and berry, `poetry.lock`, `Pipfile.lock`) through `fetchManifest(path)`, parses them for name and version (`lockfiles.ts`, plain text, no YAML or TOML library), and sends the packages to OSV (`POST /v1/querybatch`, a thousand at a time; at most 3,000 packages). The distinct advisories (fifty at most; the rest are reported without detail, and it says so) are fetched for their severity and fix.

* An ecosystem with no lockfile falls back to the manifests' declared ranges **at their minimum** (`^4.17.0` is 4.17.0), and the answer is marked `approximate`: a vulnerable minimum may not be what is installed, and a clean one may be.
* `vulnerable` is the vulnerable packages only, worst first, each with its worst severity, its advisories and `fixedIn`, the lowest version that fixes them all.
* If OSV cannot be reached, `checked` is `false` and **nothing is claimed**: an unchecked project is never reported as a clean one.
* `manifestReader(d, userId, projectId)` (`read.ts`) is the `fetchManifest` the routes and the loop use: the workspace's read of the default branch, and, for a lockfile over 1 MB (common), the git blob instead, up to 20 MB. A file that cannot be read is a `null`, and the audit notes it (`yarn.lock:unreadable`).

## 7. Layer 6: the research brief

```ts
const brief = await researchBrief("Which auth library should we use?", { brain, workspace }, { depth: "quick" | "standard" | "deep", web });
// { markdown, path, commit, research }
```

"Which auth library?" is worth a page a team can read again in six months, not a chat message. `researchBrief` runs layer 3's `research()` (search, read the pages that matter, an answer that cites them), bound to the job's model, budget and daily limits, with the project's stack as context, then renders:

*question, short answer, details, options compared, a recommendation for **this** project, gaps, and numbered sources, each with the day it was read.*

The short answer, the options and the recommendation come from one more call (the cheap tier for `quick`, the code tier otherwise) given the cited answer and the project's stack and **nothing from the web**: it can weigh what the research found against what the project has, and cannot add a claim the research did not make. It may cite `[n]` only for sources that exist; other citations are removed. If that call cannot be had, the brief still stands: the research answer is the details, its first paragraph the short answer, and the options and recommendation are left out, and the brief says so. Research that read no source at all is a `BriefError("empty")` and nothing is committed; a hit research limit is `BriefError("limit")`.

The brief is **committed** to the work branch as `docs/research/<yyyy-mm-dd>-<slug>.md` through `workspace().commit`, so the policy applies as for any commit: a branch the bot made takes it at once; any other branch is a question for the person (`commit` is then the question, not a sha). A name that is taken gets `-2`, `-3`. The text is scanned for secrets first.

## 8. Layer 7: starting a new project

An empty repo ("Build me a booking app", in a repo with a README and a LICENSE) is a *new project*, not a change. The classifier already says `plan_project` when it is told the repo is empty; `isEmptyRepo(brain)` / `emptyRepoVerdict(brain)` (`detect.ts`) is what tells it: no commits, no files, or only the boilerplate GitHub puts in a new repo (README, LICENSE, `.gitignore`, `.editorconfig`, CONTRIBUTING, CHANGELOG, `.github` templates and funding files) and no language, framework, package manager, lockfile or entry point. A brain that has not been built is not called empty.

### Intake

At most **five questions**, in this order: *what* (and for whom), *platforms*, *features*, *constraints* (budget, hosting, stack), *examples*. A question is **skipped when the person's own words already answer it** (read with rules, no model): "a booking site for yoga studios, with login and payments, on Vercel, like Calendly" answers all five. A product named with no audience gets only "Who is it for?". An answer stands whatever it says; "skip" and "you decide" are answers too and mean the planner chooses and says what it assumed. A secret in an answer is redacted before it is kept or shown to a model.

The state (the first message, the answers, which questions were put, then the spec and stack) is kept per project (`code_intake`). An intake that cannot be saved is asked again from what it was given; it is never an error to the person.

### Spec and stack

Once nothing is left to ask, the **strong** tier writes the spec (`buildSpec`): name, summary, users, platforms, features (priority `must`, at most six, `should`, `later`), non-goals, data model, screens or endpoints, risks, assumptions and `needs` (auth, database, payments, seo, realtime, files, ai). It is told to prefer the smallest thing that works and to put every guess in `assumptions`. The reply is checked and cut to size. If no model can be had (down, or the money is out), the spec is what the answers say, plainly (`source: "rules"`), and the reply says `degraded: true`: planning is never blocked on a model.

The stack is **rules, not a model's taste**, each leaving a reason in plain words (`chooseStack`):

1. what the person asked for wins ("Next.js", "Flutter", "on Vercel"); a framework Tailzu cannot set up yet (Rails, Laravel, Go...) is named, and the nearest one it can is used, said plainly;
2. phones and not the web: **Expo**;
3. a website search engines should find (public pages, a shop, a blog): **Next.js**;
4. a website behind a login, a dashboard, a tool: **Vite + React**;
5. an API: **FastAPI** when the work is Python's (data, AI, documents), else **Fastify**;
6. people sign in or data is kept: **Supabase** (Postgres and sign-in, with row-level security);
7. hosting, free tiers first: Vercel for Next.js, Cloudflare Pages for a single-page app, Supabase free for the data, Render's free web service for an API, Expo's free build tier for an app; hosting they already have wins.

### PLAN.md

`planMarkdown(spec, stack)` is the plan a person can read, argue with and hold the bot to: Goals, Stack (with a reason for each part), Data, Screens (or Endpoints), **Milestones**, Risks and assumptions, Definition of done, and **a hand-off** (how to run it on their own host: what to connect, the build settings, the environment variables **by name**, the database, a domain, and how to take Tailzu's access away). Pure: the same spec and stack give the same file. It is committed by the loop like any file.

The milestones come from a fixed recipe, with no model: **M0 is always the scaffold, CI and a preview link**; then accounts and data if the spec needs them; then the must-haves three at a time; then the should-haves; then launch readiness. Each has its scope, acceptance criteria written as things a person can check, and the commands that must pass.

### Scaffold

`scaffoldStep(stack)` is the **official starter command** for the stack, non-interactive, as a step spec for the environment router (`docs/code-router.md`). **It runs nothing.**

| Stack | Starter |
| --- | --- |
| next | `npx create-next-app@latest . --ts --eslint --app --src-dir --use-npm --yes` |
| vite-react / -vue / -svelte | `npm create vite@latest . -- --template react-ts` (`vue-ts`, `svelte-ts`) |
| expo | `npx create-expo-app@latest . --template blank-typescript` |
| flutter | `flutter create . --platforms=android,ios,web` |
| django | `django-admin startproject config .` (in a virtualenv Tailzu makes) |
| fastapi, fastify, express | no official generator: a minimal template Tailzu writes (`files`), with a health route and a test |

A generator wants an empty folder, and a new repo is not empty, so the step first moves what is there aside (a portable `node -e`), runs the starter, and puts back what the starter did not write; what the starter wrote over is kept beside it as `<name>.original`. Then come the commands that prove it works (install, build, the template's test). At most 20 commands of 2,000 characters, which is what the job router accepts.

### Milestones on GitHub

Each milestone is its own branch and its own **draft** pull request (`milestones.ts`):

* **Branch** `tailzu/m<k>-<slug>` (`tailzu/m0-scaffold-ci-and-preview`). A branch Tailzu makes is its own (`code/projects.ts`), so it commits to it freely; the policy still guards every other branch and every workflow file. A branch of that name that Tailzu did not make is left alone (`branch_exists`).
* **PR** description: the acceptance checklist (`- [ ]` lines), the checks that must pass, the scope, and the work log, rewritten as the work goes on (only the description; a title someone changed is theirs). Nothing merges without the person's yes. A milestone that has no commits yet cannot have a PR (`nothing_to_review`).
* **Preview link.** Looked for in the PR commit's deployments (a successful one that is not Production), then its commit statuses, then its check runs (a check's own link is usually the host's dashboard, so the address is looked for in its words too). Only `*.vercel.app`, `*.netlify.app`, `*.pages.dev`, `*.workers.dev` and the like, or any other `https` address a deployment names; a host's dashboard, `http`, and an address with a login in it are not previews. With none, the person gets a **one-time tip** per project to connect a host.

## 9. The routes

All four are the project owner's only (another person's project, an unknown id and a malformed id are the same plain `404 not_found`), answer `404 brain_off` while `CODE_PROJECT_BRAIN` is off (before the session is looked at), `401` without a session, and `400 bad_request` for a body that is not what was asked.

```
POST /v1/code/projects/:id/locate    { task }                        200 { targets, related, tests, confidence, question? }
POST /v1/code/projects/:id/resources { need }                        200 { need, ecosystem, candidates, pick, pickReason, notes }
POST /v1/code/projects/:id/audit     {}                              200 { source, approximate, checked, scanned, vulnerable, counts, notes }
POST /v1/code/projects/:id/intake    { request?, reply?, answers?, proceed? }
                                                                     200 { state: "asking", questions, answered, repo }
                                                                         { state: "done", spec, stack, plan, answered, degraded, repo,
                                                                           milestones: [{ k, title, branch }] }
```

| Route | Body limits | Notes |
| --- | --- | --- |
| `locate` | `task` 3 to 4,000 characters | `409 brain_not_ready` if the project has never been read. Model calls are the cheap tier under a **100 paise** cap. Excerpts are read from the default branch, only when the search was unsure |
| `resources` | `need` 3 to 300 characters | works without a built brain (it only reads the registries); a private repo is taken for closed source |
| `audit` | none | `409 brain_not_ready` if never read. Lockfiles are read from the default branch |
| `intake` | `request` up to 4,000, `reply` up to 1,500, `answers` an object of at most 10 texts of 1,500, `proceed` a boolean | the spec call is the strong tier under an **800 paise** cap. `repo` says whether the repo is empty and why |

These routes have no job behind them, so the caps above stand in for a job's budget; the agent loop calls the libraries directly with the job's own. They are doors for the agent loop's own use first.

## 10. Data (migration 0029)

`supabase/migrations/0029_code_worklog.sql`, also appended to `full_schema.sql`; it can be run again.

| Table | One row per | Holds |
| --- | --- | --- |
| `code_worklog` | entry | `job_id` (references `code_jobs`, on delete cascade), a bigint identity `id` for the order, `kind` (the eight), `text` (up to 2,000), `files`, `data` |
| `code_intake` | project | `state` (asking, ready, done), the request, the answers, the questions put, the spec, the stack, and the one-time `tips` |

Row-level security is on both: the owner may `select` their own rows, and nobody but the service role writes. Both cascade from their parent, so deleting a job, a project or an account takes them along. Without the migration the Supabase stores' writes fail: the work log is lost (and the job goes on) and an intake is asked again, so nothing breaks, but nothing is kept.

## 11. Switches and permissions

No new environment variable. The work core follows the brain (`CODE_PROJECT_BRAIN=true`, migrations 0028 and 0029), the tiers (`CODE_MODEL_TIERS`) and the research limits of layer 3.

**GitHub App, optional.** Preview links need three **read-only** repository permissions on the App: **Deployments**, **Commit statuses** and **Checks**. Without them (or without a host connected) the previews are simply not found, GitHub's refusal is not an error, and the person gets the one-time tip instead. Everything else the milestones do (make a branch, open a draft PR, change that PR's description) is under the permissions the App already has.

## 12. To check live (the tests use fakes)

* **OpenRouter**: that the `cheap`, `code` and `strong` slugs answer these prompts with JSON that fits the schemas (`work.locate.expand`, `work.locate.pick`, `work.plan`, `work.brief`, `work.spec`), and what a locate, a plan and a spec really cost in paise. The 100 and 800 paise caps on the routes were chosen without a measurement; tune them from one.
* **OSV**: `POST /v1/query`, `POST /v1/querybatch` (page limits, rate limiting, ecosystem names `npm` and `PyPI`) and `GET /v1/vulns/{id}` against real lockfiles, including a monorepo's and a 3 MB one.
* **Registries and GitHub**: npm's `/latest` document and downloads API, PyPI's JSON, and GitHub's repository search, as the finder reads them (licence fields in the odd shapes, `unpackedSize`, a missing repository link), and their rate limits without a token.
* **Previews**: a real Vercel, Netlify and Cloudflare Pages deployment on a draft PR: whether the address arrives as a deployment's `environment_url`, a status `target_url`, or only inside a check run's output, and that the three read-only permissions are enough.
* **Starters**: each official command on a real runner, with the flags as written (`create-next-app`, `create-vite`, `create-expo-app`, `flutter create`, `django-admin`). They change between versions, and `--yes` is the part most likely to drift. Also the `node -e` move-aside on a repo with a LICENSE, a README and a `.gitignore`.
* **Verify commands**: the affected-tests command for each runner on a real project (`vitest run <files>`, `jest <files>`, `pytest <files>`, `go test <packages>`), in a monorepo too.
* **The research brief**: a real `research()` and a real commit of `docs/research/...` onto a Tailzu branch, and that the daily research limit message reads well.
* **Supabase**: run migration 0029 and write and read a work log and an intake with the service key; check the owner-only `select` policies with a person's token.
