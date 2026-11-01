# chedfox/tailzu-backend: the project book

As of commit `65105ce`, 2026-11-01. Each line says where it comes from; ✓ means you confirmed it, ~ means it is a guess.

## What it is

- chedfox/tailzu-backend: Your AI language layer for the phone. Built with TypeScript, SQL, Python, React, Fastify, esbuild. _(the project's index (README and code))_
- code: 191 files and 60 routes, led by tulmi/src/config.ts. _(feature code)_
- experience: 65 files, led by shared/types/api.ts. _(feature experience)_
- supabase: 61 files, led by docs/SUPABASE.md. _(feature supabase)_
- evals: 57 files, led by tulmi/evals/agent/types.ts. _(feature evals)_
- connectors: 42 files and 15 routes, led by tulmi/src/connectors/state.ts. _(feature connectors)_
- bots: 38 files and 43 routes, led by tulmi/src/bots/index.ts. _(feature bots)_
- bots bots: 25 files, led by tulmi/src/botsBots/rows.ts. _(feature bots bots)_
- search: 24 files, led by tulmi/src/web/search/types.ts. _(feature search)_

## How it is built

- Written in TypeScript 96%, SQL 2%, Python 1%, JavaScript 1%, 1673 files. _(languages)_
- Built with React, Fastify, esbuild, Supabase, Zod, Vitest. _(frameworks)_
- A multi-package repo of 3 packages: tailzu-jobs, tulmi-backend, tailzu-viewer. _(monorepo)_
- Starts at jobs/src/index.ts (conventional entry file). _(file jobs/src/index.ts)_
- Starts at tulmi/src/server.ts (conventional entry file). _(file tulmi/src/server.ts)_
- Starts at viewer/src/index.ts (conventional entry file). _(file viewer/src/index.ts)_
- Starts at media-worker/licenses_check.py (runs as a script (__main__)). _(file media-worker/licenses_check.py)_
- CI: .github/workflows/ci.yml. _(ci)_
- The backend is the brain. The frontend is a generic renderer. We change the entire app from the server, without shipping a build. _(file docs/ARCHITECTURE.md)_

## How it stands now

- 587 of 834 source files have a test that imports them (70%). _(tests)_
- tulmi/src/experience/bots/screens/keybot.ts changed 11 times lately and no test covers it. _(file tulmi/src/experience/bots/screens/keybot.ts)_
- tulmi/src/code/chat/answer.ts changed 9 times lately and no test covers it. _(file tulmi/src/code/chat/answer.ts)_
- tulmi/src/experience/bots/screens/code.ts changed 6 times lately and no test covers it. _(file tulmi/src/experience/bots/screens/code.ts)_
- tulmi/scripts/razorpay-plans.mjs changed 3 times lately and no test covers it. _(file tulmi/scripts/razorpay-plans.mjs)_
- tulmi/src/experience/bots/screens/bots.ts changed 3 times lately and no test covers it. _(file tulmi/src/experience/bots/screens/bots.ts)_
- 3 TODOs and FIXMEs in the code, in tulmi/src/code/project/hotspots.ts, tulmi/supabase/full_schema.sql, tulmi/supabase/migrations/0028_code_project_brain.sql. _(todo)_
- ~ 26 files nothing reaches from the entry points, such as tulmi/src/code/brain/index.ts, tulmi/src/code/live/index.ts, tulmi/src/code/resources/index.ts. _(project map)_

## What changed lately

- Last change 2026-11-01: The project book: what the project is, how it stands, what changed, why, where it is heading _(commit cba0e21)_
- 100 or more commits in the last 30 days. _(commit 242c19b..cba0e21)_
- Most work in tulmi/src/experience/bots (48 commits), tulmi/src/code/chat (10 commits), tulmi/src/code/agent (9 commits), tulmi/src/code/project (6 commits). _(history)_

## Why it is this way

- Xode: harder real conversations (commander feature, express security…: Checks run install, build, typecheck, lint, test: lint failed before a change and passed after only because the build ran last. _(commit c943770)_
- e2e: record the stage-4 agents comparison runs (aborted on cost): The estimate is the reason the guard tripped: it priced these cells at about Rs 2 each against an actual mean of about Rs 13, so the guard binds far below the Rs 120 cap. _(commit 47a6983)_
- Xode chat reads like a chat: no echo, shaped answers, follow-ups: "what?", "why?", "explain", "matlab?" go on from the last answer instead of a new clarify, in the language the reaction was said in. _(commit ee2a140)_
- The Bots app is on by default, so the desktop gets the new look: BOTS_APP was off unless the server's .env said otherwise. _(commit 71f16b5)_
- Keybot setup: ways out that work, Continue opens Settings, the phone'…: Continue opens Settings until the phone says Keybot is on, then replaces the page with Now just talk, whose Done leaves the setup instead of landing on it again. _(commit dd14f64)_
- Usage limits: the owner's dollars, counted at what each use really co…: Each stretch may use its own amount instead of a share by its days; the stretches keep their days (4, 5, 6, 7, then the rest). _(commit 126e786)_
- Home's welcome: the bot turns and walks off as the card comes in: Once he has waved (helloSeen) he walks off the side, drawn by BlipWalkOut on a build that declares it (slid off with MorphOut otherwise), and a card that is due comes in over him as he goes. _(commit 07e9a25)_
- First-day Home: the bots are there, and the bot says hello by the nam…: The phone's empty Home shows the bot tiles (Keybot, Code, Plan, Travel and Make) in place of the Keybot row, and the hello uses the name from Name it (X0 when none was given) instead of Blip. _(commit 3515c46)_
- Bots app: the carrying bot, answers written in as they come, Stop; usage meters instead of money _(commit a6c0ae9)_
- Make free-form the Code bot's default, and measure it on harder tasks: The locate funnel and brain become a suggest_files tool and hints instead of a gate. _(commit fb47757)_
- Record the first paid reality run (quick plan, ₹30.80): Recorded so later runs replay instead of paying. _(commit 8c38be3)_

## Where it is heading

- Open: Keyboard settings saved but not applied: look, key height, key sounds, hold space to speak, Keybot key _(file docs/bots-gaps.md)_
- Open: Monthly spend limit does not cover front-door answers or Keybot (only Code bot jobs and bot answers). _(file docs/bots-gaps.md)_
- Open: Your words: no "sounds like" field or edit; words aren't grouped by kind (names, places, work). _(file docs/bots-gaps.md)_
- Open: Bot keys: no "Try it" run on the keys page. _(file docs/bots-gaps.md)_
- Open: Desktop reply drafts and rewrite cards in the pill (DKeyReply, DKeyRewrite). _(file docs/bots-gaps.md)_
- Open: Code bot: (no QR: the preview runs inside the project, item 11) "Open on my phone" for previews, the live dev-server preview link, a real cost/time estimator _(file docs/bots-gaps.md)_
- In flight: #1 Add history, stats, media store, and cache versioning _(pull #1)_
- No open issues. _(issue open issues)_

## Not known yet

- How it stands: the project's own checks have not been run yet (they run before the first change).

## Questions for you

- Who is this project for, and what do they mainly use it for? One or two lines.
- What should come next? The two or three things you most want built or fixed.
- Is there anything that must not change: an API, a design, a rule?
