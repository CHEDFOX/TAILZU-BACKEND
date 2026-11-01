# Xode on any ask: a file to copy, setting it up, what the project cannot say (2026-11-01)

`npx tsx e2e/xode-eval.ts --only backend --modes loop` with real models on chedfox/tailzu-backend: 13 of 15 for ₹1.25 (the quick read ₹3.18).

| | passed | cost | time |
|---|---|---|---|
| loop | 13 of 15 | ₹1.25 | 73.2s |

## chedfox/tailzu-backend
1686 files; brain ₹3.18 in 99.1s; the owner's answers given.

| case | expected | router | loop |
|---|---|---|---|
| what-for: "what is this project, and who is it for?" | answer | - | ✅ answer, ₹0.05, 3.1s, 2 calls |
| what-next: "What should we do" | answer | - | ✅ answer, ₹0.05, 4.1s, 2 calls |
| where-book: "where is the project book built?" | answer | - | ✅ answer, ₹0.11, 7.7s, 5 calls |
| how-cite: "how does the chat avoid citing lines it never read?" | answer | - | ✅ answer, ₹0.07, 3.9s, 3 calls |
| copy: "what does the app say when the daily spend limit is reached?" | answer | - | ❌ answer, ₹0.18, 7.4s, 6 calls<br>says used what X0 Bot may spend |
| recent: "what changed lately?" | answer | - | ✅ answer, ₹0.03, 1.9s, 2 calls |
| thanks: "thanks!" | answer | - | ✅ answer, ₹0.01, 1.4s, 2 calls |
| bare-fix: "fix it" | ask | - | ✅ ask, ₹0.01, 1.2s, 1 calls |
| change: "add a test that bookCard puts the owner's words first" | job | - | ❌ answer, ₹0.10, 7.3s, 6 calls<br>did job |
| sql-copy: "give me the database code for the project book migration, to copy paste" | answer | - | ✅ answer, ₹0.04, 3.8s, 4 calls |
| vps-setup: "what commands do I run to set up and deploy the server on my VPS?" | answer | - | ✅ answer, ₹0.13, 3.2s, 4 calls |
| github-env: "what settings does the server need in .env for GitHub?" | answer | - | ✅ answer, ₹0.12, 6.7s, 4 calls |
| route: "where is POST /v1/ask handled?" | answer | - | ✅ answer, ₹0.09, 6.8s, 5 calls |
| local: "how do I run it on my own computer?" | answer | - | ✅ answer, ₹0.14, 5.7s, 4 calls |
| providers: "which other model providers could we use instead of OpenRouter? give options" | answer | - | ✅ answer, ₹0.12, 9.2s, 5 calls |

### The answers

#### what-for: "what is this project, and who is it for?"

**loop** (answer):

> **Tailzu** is an AI language layer for the phone — and this repo, `alice/tailzu-backend`, is its backend. The clearest single statement of what the product is lives in `tulmi/src/seo/facts.ts`, which the project describes as "the single source of what the product is, said once: definition, store links, home page copy, languages and prices" ( holds `DEFINITION`, `:40-47` holds `HOME`). I haven't read those lines yet, so I can't quote the definition itself — say the word and I'll pull it.
> 
> What the project's own index says it is:
> 
> - A TypeScript + Python codebase, ~1,686 files, built with Fastify, Supabase, Zod, SQL, React and esbuild.
> - A monorepo of three packages: `tailzu-jobs`, `tulmi-backend`, `tailzu-viewer`.
> - Three feature areas: the **code project runner** (projects, jobs, policies, GitHub connections for the bot's own runner), **experience and bots** (bot kits, live bots, persona

#### what-next: "What should we do"

**loop** (answer):

> I don't have a specific request from you yet, so let me point at what the project itself says is worth doing next.
> 
> The owner's stated direction is: **make Xode the best coding bot on cheap models, then open the bots platform to everyone** (project book, direction). The open gaps in `docs/bots-gaps.md` line up with that:
> 
> - **Code bot** (the Xode-first priority): no "Open on my phone" for previews, no live dev-server preview link, no real cost/time estimator (item 11 notes the preview runs inside the project, no QR).
> - **Bot keys**: no "Try it" run on the keys page.
> - **Keyboard settings** saved but not applied: look, key height, key sounds, hold space to speak, Keybot key.
> - **Monthly spend limit** doesn't cover front-door answers or Keybot — only Code bot jobs and bot answers.
> - **Your words**: no "sounds like" field or edit; words aren't grouped by kind.
> - **Desktop**: reply drafts an

#### where-book: "where is the project book built?"

**loop** (answer):

> The project book is built in `tulmi/src/code/project/book.ts` — the pure builder is `buildBook(i: BookInput): ProjectBook` at `tulmi/src/code/project/book.ts:88`, with the chapter list and titles at lines 28–33 and the `ProjectBook` shape at lines 47–57.
> 
> What calls it is the brain handle in `tulmi/src/code/project/index.ts`: `book()` (line 522) gathers the free sources — recent commits, merged and open pull requests, issues, milestones, doc files, the project map and the run/ops files (lines 533–544) — then calls `buildBook({...})` at line 545 and caches the result in the `books` map (line 550). It is rebuilt when the default branch head, the brain's build time or the owner's answers change (the cache key at line 526), and `answerBook()` (line 554) saves the owner's answers and rebuilds it (line 560). The module is re-exported from `tulmi/src/code/project/index.ts:59`.

#### how-cite: "how does the chat avoid citing lines it never read?"

**loop** (answer):

> The chat never trusts the model's citations on their own: it keeps a ledger of what it actually saw, then strips any citation that doesn't resolve against that ledger.
> 
> **The ledger (`Anchors`)** — `tulmi/src/code/chat/cite.ts:25-61`. One entry per file, holding the most lines the file could have (`max`), whether that count is exact (`exact`), and the specific lines that were named (`lines`). It's filled only from real observations:
> 
> - `read(path, text)` — a file whose text was read; line count is exact.
> - `lines(path, total)` — exact count from the job's own copy of the code.
> - `hit(path, line)` — a line a search result named, e.g. a grep hit; that line exists, so the file is at least that long.
> - `known(path, bytes, named)` — a file the brain only knows by size: `max` is an upper bound (a line is assumed to be at least 6 characters), not exact.
> 
> **Where the ledger gets fed** — `tulmi/s

#### copy: "what does the app say when the daily spend limit is reached?"

**loop** (answer):

> There are two different daily-spend limits in the code, and they say different things.
> 
> **The usage meter (stretches/month, the main one).** The refusal is a 429 with `code: "quota_exceeded"`, `reason: "usage_limit"`, plus `resetsAt` and `upgrade` (tulmi/src/you/limits.ts:17-18). The sentence is built by `outLine` (tulmi/src/you/usage.ts:194-200):
> 
> - "You've reached this stretch's limit. It resets Thu 9 am." — when the stretch is used up (tulmi/src/you/usage.ts:197-199)
> - "You've reached this month's limit. It resets …" — when the month is used up, or the plan has no stretches (tulmi/src/you/usage.ts:196-199)
> 
> The apps open the bootstrap's `quota.screenId` (the Bots app's Usage page) on it (tulmi/src/you/limits.ts:18, tulmi/src/you/usage.ts). Note this is a stretch/month limit, not strictly a per-day one — the closest thing to "daily" is the near-limit line "You've used most of this stre

#### recent: "what changed lately?"

**loop** (answer):

> The last change was on 2026-11-01: **"Fix the jobs Worker's 5 failing tests; a full read's last parts get their words"** (commit 6929469).
> 
> Beyond that, the project has been very active — 100 or more commits in the last 30 days (range e0ceb08..6929469), with the work concentrated in:
> 
> - `tulmi/tests` — 70 commits
> - `tulmi/src/experience` — 55 commits
> - `tulmi/src/code` — 24 commits
> - `tulmi/src/routes` — 21 commits
> 
> A few files have been churning without test coverage lately:
> 
> - `tulmi/src/code/chat/answer.ts` — changed 11 times, no test
> - `tulmi/src/experience/bots/screens/keybot.ts` — changed 9 times, no test
> - `tulmi/src/experience/bots/screens/code.ts` — changed 6 times, no test
> - `tulmi/src/code/project/build.ts` — changed 4 times, no test
> - `tulmi/scripts/razorpay-plans.mjs` — changed 3 times, no test
> 
> Note: this is from the project's own history summary, not from me reading the co

#### thanks: "thanks!"

**loop** (answer):

> Koi baat nahi! Jab bhi kuch chahiye — koi screen, bot, ya code change — bata dena.

#### bare-fix: "fix it"

**loop** (ask):

> What should I fix in the project? [A bug or error | A specific feature or file | Run checks and fix any issues they find]

#### change: "add a test that bookCard puts the owner's words first"

**loop** (answer):

> `bookCard` is at tulmi/src/code/project/book.ts:381. It already puts the owner's words first: line 383 collects every fact with `status === "confirmed"`, and line 386 makes that the first part, headed "The owner's words (newest; they win over anything older)". Every other chapter is taken with `status !== "confirmed"` (line 384), so owner facts never appear twice. The parts are then joined in order (lines 397-403), and a part is dropped only when the card would pass `max` (line 401) — so a test should also pin that the owner's part survives a tight `max`, since it is the first part and the loop breaks on the first part that does not fit.
> 
> I found no test file for the book: `**/book*.test.ts` matches nothing, and the only hits for "bookCard" are in tulmi/e2e/XODE-EVAL-2026-11-01.md (lines 238, 379-385), which is an eval log, not a test. So this is a new test file, not an addition to an ex

#### sql-copy: "give me the database code for the project book migration, to copy paste"

**loop** (answer):

> Here it is — the whole migration is four lines, `tulmi/supabase/migrations/0060_project_book.sql`:
> 
> ```sql
> -- The project book (tulmi/src/code/project/book.ts): the part of it that is not read from the code, GitHub or the checks, the owner's own answers
> -- (who the project is for, what comes next, what must not change). Kept with the project's brain, and gone with it.
> alter table public.code_brain add column if not exists book jsonb;
> ```
> 
> It only adds a nullable `book jsonb` column to `public.code_brain` (line 3), so it is safe to re-run (`if not exists`) and needs no backfill. Run it in the Supabase SQL editor, or with the CLI: `supabase db push` from `tulmi/` if that is how the other migrations are applied. The column is dropped with the brain row, as the comment on line 2 says.

#### vps-setup: "what commands do I run to set up and deploy the server on my VPS?"

**loop** (answer):

> <read_file">
> <parameter="path">deploy/ship.sh</parameter

#### github-env: "what settings does the server need in .env for GitHub?"

**loop** (answer):

> For GitHub, the server reads these from `tulmi/.env` (docs/github-app.md:189-203, DEPLOY.md:934-937):
> 
> **Required for the GitHub App (the Code bot's connection):**
> - `CODE_GITHUB` — `true` to switch the Code bot on; default `false` (docs/github-app.md:193)
> - `GITHUB_APP_ID` — the App's number; used as the JWT issuer when there is no client id (docs/github-app.md:194)
> - `GITHUB_APP_SLUG` — the App's URL name; the install link is `https://github.com/apps/<slug>/installations/new` (docs/github-app.md:195)
> - `GITHUB_APP_CLIENT_ID` — the client id (`Iv23...`), JWT issuer and OAuth client of the install step (docs/github-app.md:196)
> - `GITHUB_APP_CLIENT_SECRET` — the client secret (secret) (docs/github-app.md:197)
> - `GITHUB_APP_PRIVATE_KEY` — the `.pem`, raw or `base64 -w0` of it, or with `\n` for line breaks (secret) (docs/github-app.md:198)
> - `GITHUB_APP_WEBHOOK_SECRET` — the webhook secret 

#### route: "where is POST /v1/ask handled?"

**loop** (answer):

> `POST /v1/ask` is registered in `tulmi/src/server.ts:1965`, and it is one route with two handlers behind it:
> 
> - **The desktop's old "ask about the screen"** — handled inline. It needs `question`, caps the prompt-bound fields, enforces quota, then calls `answerAbout(screenContent, question, …)` and answers `{ answer, speak?, voice }`.
> - **The front door** — hands the body to `frontRoutes.ask(req, reply, user)` when `frontRoutes.owns(req.body)` is true. `owns` is true for a body with a string `message` and no `question` (`tulmi/src/routes/front.ts:354`), and the handler itself is `const ask: FrontRoutes["ask"]` at `tulmi/src/routes/front.ts:192`, registered in `registerFrontRoutes` (`tulmi/src/routes/front.ts:160`).
> 
> So: the route is in `server.ts`, the front-door branch (bots, streaming, idempotency) is in `tulmi/src/routes/front.ts:192`. Related routes in the same file: `POST /v1/ask/sto

#### local: "how do I run it on my own computer?"

**loop** (answer):

> The backend is the part you run locally. From the repo root:
> 
> ```bash
> cd tulmi
> cp ../.env.example .env      # then fill in your keys
> npm install
> npm run dev                  # starts the server
> ```
> 
> That is the project's own quick start (README.md:79-83). `npm run dev` is `tsx watch tulmi/src/server.ts` (tulmi/package.json:11), so the server starts on the `PORT`/`HOST` from your `.env` (`.env.example` lists both under "--- Server ---"). Node 20 or newer is required (tulmi/package.json:7-9).
> 
> You need to fill in `.env` before it will do anything useful. The minimum the book names: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (auth + usage metering), and a speech-to-text key — `GROQ_API_KEY` if `STT_PROVIDER=groq` (the default), or `SARVAM_API_KEY` with `STT_PROVIDER=sarvam`/`auto` — plus `OPENROUTER_API_KEY` for the cleanup LLM. Put the values in `.env` only; they are never

#### providers: "which other model providers could we use instead of OpenRouter? give options"

**loop** (answer):

> **Short answer: the code is already written against the OpenAI SDK, so any provider that speaks the OpenAI-compatible `/chat/completions` API is a drop-in — the only real work is the model slugs and the cost/reasoning plumbing.**
> 
> What the code actually depends on (all of it OpenRouter-specific):
> 
> - One client, one base URL: `tulmi/src/pipeline/openrouter.ts:19-31` — `new OpenAI({ apiKey: cfg.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1"... })`. Everything else in the repo goes through `openrouter()` (`tulmi/src/agent/llm.ts:58`, `:320`).
> - Model names are OpenRouter slugs, `vendor/model` (`tulmi/src/code/brain/tiers.ts:75-97`), and the review tier picks a *different vendor prefix* from the writer's (, `:35-37`, `familyOf` at `:112`). So a provider swap must keep a vendor-prefixed naming scheme, or `familyOf` needs a mapping.
> - Reasoning is sent in OpenRouter's own form (`r

