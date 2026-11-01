# Xode's chat, scored: the router against the one loop (2026-11-01)

**After this run** (the same day, the same brain build, real models; the loop only):

- `what-next` asked "which direction?" with answers to tap instead of recommending. The question back with answers to tap is now offered only when a
  change was asked (it settles a change before work); anything else is answered. Re-run: ✅ answer, ₹0.02.
- `change` had started its job in this run (₹0.19). Before the fix it spent all five steps reading, answered with a plan, then climbed to the code tier
  (₹1.08, no job). A change now looks three steps, and its last step may only act: start the job, or ask.
- `vps-setup` had leaked DeepSeek's own call tokens (`<｜DSML｜ invoke …>`) as its answer in the run before; those are now read as a call, and a last step
  that only promises to look gets one more call for the answer. ✅ here, ₹0.40.
- `copy` still names the plan's usage-limit sentence (src/you/usage.ts) rather than the daily spend cap's (src/front/index.ts:129). Both are real limits;
  the question does not say which.


| | passed | cost | time |
|---|---|---|---|
| loop | 13 of 15 | ₹3.32 | 129.1s |

## chedfox/tailzu-backend
1687 files; brain ₹3.02 in 98.2s; the owner's answers given.

| case | expected | router | loop |
|---|---|---|---|
| what-for: "what is this project, and who is it for?" | answer | - | ✅ answer, ₹0.14, 7.3s, 5 calls |
| what-next: "What should we do" | answer | - | ❌ ask, ₹0.05, 3.6s, 2 calls<br>did answer |
| where-book: "where is the project book built?" | answer | - | ✅ answer, ₹0.11, 11.0s, 4 calls |
| how-cite: "how does the chat avoid citing lines it never read?" | answer | - | ✅ answer, ₹0.10, 4.1s, 3 calls |
| copy: "what does the app say when the daily spend limit is reached?" | answer | - | ❌ answer, ₹0.76, 17.5s, 11 calls<br>says used what X0 Bot may spend |
| recent: "what changed lately?" | answer | - | ✅ answer, ₹0.04, 2.4s, 2 calls |
| thanks: "thanks!" | answer | - | ✅ answer, ₹0.02, 1.6s, 2 calls |
| bare-fix: "fix it" | ask | - | ✅ ask, ₹0.01, 1.5s, 1 calls |
| change: "add a test that bookCard puts the owner's words first" | job | - | ✅ job, ₹0.19, 12.2s, 4 calls |
| sql-copy: "give me the database code for the project book migration, to copy paste" | answer | - | ✅ answer, ₹0.15, 6.2s, 4 calls |
| vps-setup: "what commands do I run to set up and deploy the server on my VPS?" | answer | - | ✅ answer, ₹0.40, 7.0s, 4 calls |
| github-env: "what settings does the server need in .env for GitHub?" | answer | - | ✅ answer, ₹0.45, 15.5s, 10 calls |
| route: "where is POST /v1/ask handled?" | answer | - | ✅ answer, ₹0.03, 1.9s, 2 calls |
| local: "how do I run it on my own computer?" | answer | - | ✅ answer, ₹0.33, 7.6s, 4 calls |
| providers: "which other model providers could we use instead of OpenRouter? give options" | answer | - | ✅ answer, ₹0.54, 29.6s, 10 calls |

### The answers

#### what-for: "what is this project, and who is it for?"

**loop** (answer):

> This is **Tulmi** — an AI language layer for the phone, and this repo is its backend plus the bots platform around it.
> 
> **What it is.** The README opens with the product: "Your **AI language layer** for the phone. Speak, type, or point it at your screen — Tulmi turns rough input into clean, ready-to-send text **in your own voice**, across **most world languages**, with best-in-class **Hindi / Hinglish / code-switching** as the flagship" (`README.md:3-6`). Three ways in, one brain: Speak (transcribe + clean, insert at cursor), Type (rewrite rough text), Screen (a floating bubble on Android / Share-sheet on iOS reads the screen and drafts a reply) (`README.md:10-14`). Every output is shaped by two things the backend owns — **Personality** (tone/style) and **Context** (which app, who you're writing to, what's on screen) (`README.md:16-19`). The apps are deliberately thin: "they capture inpu

#### what-next: "What should we do"

**loop** (ask):

> Which direction do you want to take first? [Run the checks and add tests to the untested hot files (ans… | Close a specific gap from docs/bots-gaps.md (tell me which) | Work on Xode quality on cheap models (prompts, routing, cos… | Something else — I'll describe it]

#### where-book: "where is the project book built?"

**loop** (answer):

> The project book is built in **`tulmi/src/code/project/book.ts`** — the whole thing lives in that one file.
> 
> What's there, from the lines I read:
> 
> - The chapters and their titles: `CHAPTERS` at `tulmi/src/code/project/book.ts:28` and `CHAPTER_TITLES` at `:30-33` (what, build, run, state, recent, why, direction, rules).
> - The fact shape: `FactStatus` `:35`, `Source` `:36`, `BookFact` `:37` — every fact carries where it came from and how sure it is.
> - The owner questions: `OWNER_QUESTIONS` `:39-43`, `QuestionId` `:44`, `OwnerAnswers` `:45`.
> - The output shape: `ProjectBook` `:47-57` (version, project, commit, builtAt, facts, gaps, questions) and `BookInput` `:59`.
> - The builder itself: `buildBook(i: BookInput): ProjectBook` at `tulmi/src/code/project/book.ts:88`.
> - The renderers that turn a book into text: `bookMarkdown` `:310`, `bookBrief` `:340`, `bookForJobs` `:363`, `bookCard` `:381`, 

#### how-cite: "how does the chat avoid citing lines it never read?"

**loop** (answer):

> The chat never trusts the model's citations: after the answer is written, every `path:line` in it is checked against what the run actually saw, and anything that doesn't resolve is removed from the text.
> 
> The record of what was seen is `Anchors` (tulmi/src/code/chat/cite.ts:25-61). It's filled only from real observations:
> 
> - `read(path, text)` — a file whose text was read; the line count is exact.
> - `lines(path, total)` — a file whose line count is known exactly from the job's copy of the code.
> - `known(path, bytes, named)` — a file the brain only knows by size: the max is an upper bound (a line is assumed at least 6 characters), plus any lines the brain itself named.
> - `hit(path, line)` — a line a search result named, so the file is at least that long.
> 
> Then `resolves` is the gate: the path must be in the map, `from >= 1`, `to >= from`, and `to` must be within the known maximum — exact 

#### copy: "what does the app say when the daily spend limit is reached?"

**loop** (answer):

> There is no daily spend limit in this code — the limits are per **stretch** (a paid month is used in five: days 1–4, 5–9, 10–15, 16–22, 23 to the end) and per **month**; the free plan has no stretches, just one monthly allowance, and every line it gets says "this month" (`tulmi/src/you/usage.ts:11-15`).
> 
> When the limit is reached, the refusal is a 429 with `code: "quota_exceeded"`, `reason: "usage_limit"`, plus `resetsAt` and `upgrade`, and the message is the sentence "You've reached this stretch's limit. It resets Thu 9 am." — the apps then open the bootstrap's `quota.screenId`, which in the Bots app is the Usage page (`tulmi/src/you/limits.ts:17-18`). The same refusal is thrown to a bot's answer via `gate()` (`tulmi/src/you/limits.ts:172-175`), and the message is built by `outLine()` so the refusal a job gets and the line the Usage page shows can never disagree (`tulmi/src/you/usage.ts

#### recent: "what changed lately?"

**loop** (answer):

> Recent work, from the project's own history:
> 
> - **Last change, 2026-11-01** (commit `68153f8`): "Xode answers any ask of its project: files exactly, the web, setup guides, the run book."
> - **100+ commits in the last 30 days** (range `4eed028..68153f8`).
> - **Where the work went:** `tulmi/tests` (70 commits), `tulmi/src/experience` (54), `tulmi/src/code` (25), `tulmi/src/routes` (20).
> 
> Files that changed most often lately, and none of them has a test covering it:
> 
> - `tulmi/src/code/chat/answer.ts` — 11 changes
> - `tulmi/src/experience/bots/screens/keybot.ts` — 8 changes
> - `tulmi/src/experience/bots/screens/code.ts` — 6 changes
> - `tulmi/src/code/project/build.ts` — 5 changes
> - `tulmi/scripts/razorpay-plans.mjs` — 3 changes
> 
> So the recent push is the bot experience layer (screens, personality) and the code bot's chat/build path, with a lot of test-writing alongside — but those five hot files 

#### thanks: "thanks!"

**loop** (answer):

> Glad it helped! Anything else you want to look at in the Tailzu backend — the Xode bot, the screens, or the jobs runner?

#### bare-fix: "fix it"

**loop** (ask):

> What should I fix? [A specific bug (share the error or behavior) | Run checks and fix the issues they find]

#### change: "add a test that bookCard puts the owner's words first"

**loop** (job, task: "Add a test that `bookCard` puts the owner's words first.

What I found (from reading tulmi/src/code/project/book.ts):
- `bookCard` is the function at tulmi/src/code/project/book.ts:377-382 (its doc co"):

> Started. I'm working on a new branch, xode/stub-1, and will show you what I change before anything is merged.

#### sql-copy: "give me the database code for the project book migration, to copy paste"

**loop** (answer):

> The migration already exists in the repo — nothing to change. It's `tulmi/supabase/migrations/0060_project_book.sql`, four lines: it adds a nullable `book jsonb` column to `public.code_brain` (line 3), with a comment saying the book holds the owner's own answers (who the project is for, what comes next, what must not change) and lives with the project's brain (lines 1–2). It's `add column if not exists`, so it's safe to run again.
> 
> Copy-paste:
> 
> ```sql
> alter table public.code_brain add column if not exists book jsonb;
> ```
> 
> Run it in the Supabase SQL editor after 0059, and it needs 0028 (`code_brain`) to exist first. The same block is also inlined in `tulmi/supabase/full_schema.sql` (around line 1768, under the `0028_code_project_brain.sql` section) if you're rebuilding the whole schema instead.

#### vps-setup: "what commands do I run to set up and deploy the server on my VPS?"

**loop** (answer):

> Setup and deploy, from the project's own files:
> 
> **First time on the VPS** (DEPLOY.md:33-93):
> ```bash
> ssh root@YOUR_VPS_IP
> docker --version
> docker ps
> ss -tlnp | grep -E ':(80|443|8770)\b'
> command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
> git clone https://YOUR_TOKEN@github.com/chedfox/tulmi.git   # token only if the repo is private
> cd tulmi
> cp .env.example tulmi/.env
> nano tulmi/.env        # GROQ_API_KEY (STT) + OPENROUTER_API_KEY (refine); keep STT_PROVIDER=groq and DEV_SKIP_AUTH=true for the first run
> docker compose up -d --build
> curl http://localhost:8770/healthz
> ```
> The health check should answer `{"status":"ok","service":"tulmi-backend","version":"0.1.0"}` (DEPLOY.md:89-90). If 8770 is taken, use `FLOW_PORT=NNNN docker compose up -d --build` (DEPLOY.md:93). The backend binds to `127.0.0.1:8770` by default, so it stays private and can't clash with your other apps

#### github-env: "what settings does the server need in .env for GitHub?"

**loop** (answer):

> For the Code bot's GitHub App, `tulmi/.env` needs these (docs/github-app.md:189-203):
> 
> | Variable | What it is |
> | --- | --- |
> | `CODE_GITHUB` | `true` to switch the Code bot on. Default `false` |
> | `GITHUB_APP_ID` | The App's number. Only used as the JWT's issuer when there is no client id |
> | `GITHUB_APP_SLUG` | The App's URL name; the install link is `https://github.com/apps/<slug>/installations/new` |
> | `GITHUB_APP_CLIENT_ID` | The client id (`Iv23...`). The JWT's issuer, and the OAuth client of the install step |
> | `GITHUB_APP_CLIENT_SECRET` | The client secret. Secret |
> | `GITHUB_APP_PRIVATE_KEY` | The `.pem`: raw, or base64 of it (`base64 -w0 key.pem`, or line breaks as `\n`). Secret |
> | `GITHUB_APP_WEBHOOK_SECRET` | The webhook secret. Secret; use one with no `$` in it (Docker Compose rewrites those in env files) |
> | `CONNECTOR_TOKEN_KEY` | Already set for Connected apps. The Cod

#### route: "where is POST /v1/ask handled?"

**loop** (answer):

> POST /v1/ask is handled in `tulmi/src/routes/front.ts` — that file is the HTTP front door for the assistant, with the ask route plus streaming, stop and feedback routes. The route is registered into the app from `tulmi/src/server.ts` (the `buildApp` wiring, around lines 312–3792).
> 
> I haven't read the exact handler lines yet, so I can't cite the precise line for the route definition — say the word and I'll open `tulmi/src/routes/front.ts` and give you the line numbers.

#### local: "how do I run it on my own computer?"

**loop** (answer):

> The backend is the part you run locally, and the repo's own quick start is in README.md:77-87:
> 
> ```bash
> cd tulmi
> cp ../.env.example .env      # then fill in your keys
> npm install
> npm run dev                  # starts the server
> ```
> 
> `npm run dev` is `tsx watch tulmi/src/server.ts` (tulmi/package.json:11), so the server comes up on the PORT/HOST from your `.env` (defaults are in .env.example). Node 20 or newer is required (tulmi/package.json:7-9).
> 
> Keys go in `tulmi/.env` only — never in code, logs or the apps. The minimum to get a real answer out of it: `OPENROUTER_API_KEY` (the cleanup/reply model, .env.example) and one STT provider — `GROQ_API_KEY` is the default, or `SARVAM_API_KEY` / `OPENAI_API_KEY` depending on `STT_PROVIDER`. Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`) is needed for auth and usage metering; for local poking around, `DEV_SKIP_AUTH=true` e

#### providers: "which other model providers could we use instead of OpenRouter? give options"

**loop** (answer):

> Short answer: the code is already written so the model door is one OpenAI-compatible client, so the realistic options are (a) point `baseURL` at another gateway, or (b) go direct to each vendor. But four things in the code are OpenRouter-specific and would need work in any swap.
> 
> What the code actually depends on (all read):
> - One client, OpenAI SDK, `baseURL: "https://openrouter.ai/api/v1"`, key from `OPENROUTER_API_KEY` — tulmi/src/pipeline/openrouter.ts:10-31. So the transport is swappable by config, not by rewrite.
> - `OPENROUTER_API_KEY` is required at boot — tulmi/src/config.ts:311; attribution headers `OPENROUTER_APP_URL` / `OPENROUTER_APP_NAME` — tulmi/src/config.ts:1031-1032, sent.
> - Model names are OpenRouter slugs, `"<vendor>/<model>"` — tulmi/src/config.ts:308-312, and the tier ladders are full of them — tulmi/src/code/brain/tiers.ts:73-98.
> - OpenRouter-only features you'd los

