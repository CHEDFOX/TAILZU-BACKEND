# The reality check: contestants, parts, security

## 0. One command: the reality plan (`npm run reality`)

```
npm run reality -- --plan quick --estimate          # what each stage will cost, from the live prices; mandatory before a paid run
npm run reality -- --stages 0                       # free: the offline suite, every cassette replayed, the free part bake-offs
npm run reality -- --plan quick --budget-inr 150    # the whole plan, adaptive, under one hard cap (needs OPENROUTER_API_KEY)
npm run reality -- --prove                          # no key: stage 0 for real, the rest from cassettes, simulations and scripted models; writes REALITY.md
npm run reality -- --commands                       # what to run in a session where installs are allowed
```

Six stages, each only as far as it is still worth money (`e2e/reality/stages.ts`): **0** free (the offline tests and `tsc`, every cassette replayed against the current code,
the page-extraction and locate bake-offs); **1** cents (capability probes only for models with no score under this code and probe version); **2** smoke, recorded (only the
items the store does not answer); **3** a stratified sample of 12 (quick), 24 (standard) or all 65 tasks, the smallest set that has every category and every stage, weighted
toward what failed before, run on our bot with the product's own ladders; **4** comparisons with sequential testing (our agent, aider, opencode, codex, openhands and
mini-swe-agent on one model; model ladders in our agent), interleaved on the same tasks, stopped when the leader is the best with probability 0.9 or an arm is beaten on both
success and cost per success, repeats only for unstable results; **5** the parts (edit formats for models missing them, context strategy, router) with the money left.

- **The results store** `e2e/results/*.jsonl` (committed, append-only) holds every measurement under the key (agent, model, task or probe, code fingerprint of the src
  directories that feed it, prompt version). A result whose key is in the store is reused and never paid for twice; change the code or the prompts and only what that touches
  is measured again. Simulated and scripted runs write to a `sim-results` folder of their own.
- **Stage 0 and the cassettes.** A strict replay runs the product again on the recorded answers. No miss means the outcome is the current code's, kept as a result
  (`same`, `regressed`, `fixed`); a miss means the code now asks what the recording lacks (`stale`: only a paid re-record can say, and it is never counted as a pass or a
  failure). The replay key ignores what changes between sessions without meaning anything: Node's proxy warning with its process id, colour codes, the test runner's timings
  (`adapters/cassette.ts` `normalize`), and a cassette recorded under older rules is found by the key the current rules make of its stored request.
- **The estimate** per stage has an *expected* figure (early stops working) and an *at most* figure; a stage whose live spend passes 130% of its expected figure is
  **aborted**. A paid run refuses to start without an estimate for its plan from the last 24 hours and without `--budget-inr`.
- **Installs.** The plan never installs by itself. A task whose project is not installed, or a contestant whose tool is not, is left out and named: *needs a session where
  installs are allowed*. `--install` tries; a refused install is classified and treated the same way. `--commands` lists what to run where installs are allowed.
- **The report** `out/reality/latest.html` and the committed summary `REALITY.md`: a verdict per area (working, weak, broken), the five things to fix next (failures clustered by
  stage and cause, with examples), the winner of each comparison with its confidence and the efficiency frontier (success against rupees per success), the recommended
  `CODE_MODEL_TIERS`, what is still unknown and the cheapest run that would answer it.
- A winner at P(best) ≥ 0.9, looked at after every round, is a lead and not a proof (about one tie in ten is called anyway); raise `--confidence` for a decision that must hold.

**Every command line here is strict** (`e2e/cli.ts`): `--help` prints help and runs nothing, an unknown flag is an error (exit 2), and a run that calls a real model needs an
explicit `--budget-inr N`: there is no default cap. (`bakeoff --help` once started a real bake-off.)

The harness runs Tailzu's real flow (and other agents) on real projects at pinned commits and scores the result with hidden checks. This page covers the part
added for comparing Tailzu with open-source tools: the **contestants** (whole agents), the **part bake-offs** (one piece at a time) and the **security suites**.
Everything that costs money goes through the recording proxy, under a hard cap, and is recorded once so that a second run is free.

## 1. Contestants (`e2e/agents`)

| agent | version | licence | how it is run |
|---|---|---|---|
| `tailzu` | this repository | ours | the product's flow over a local git host |
| `aider` | 0.86.2 | Apache-2.0 | `aider --message <task> --yes-always --no-auto-commits`, edit format `diff` (`E2E_AIDER_EDIT_FORMAT` changes it) |
| `opencode` | 1.19.0 | MIT | `opencode run --pure --format json`, one config naming the proxy as an openai-compatible provider |
| `codex` | 0.161.0 | Apache-2.0 | `codex exec --json`, workspace-write sandbox on. Codex speaks only the Responses API, so the proxy accepts `POST /v1/responses` (`adapters/responses.ts`) |
| `mini-swe-agent` | 2.4.6 | MIT | `mini -y --exit-immediately`: the simple control |
| `openhands` | 1.16.0 | MIT | `openhands --headless --override-with-envs`: runs in process on a local workspace, **no Docker needed** (`requiresDocker` is false) |

Every agent is an `AgentUnderTest` built from a small `ExternalSpec` (`external.ts`): `plan()` builds the command, `digest()` reads its output. Both are pure
and unit-tested (`tests/e2e-agents.test.ts`). What is the same for all of them:

- **The model.** `ModelSpec.slug` through the proxy's labelled base URL `/run/<label>/v1`. The proxy counts calls, tokens, dollars and models per run
  (`GET /run/<label>/stats`), enforces a per-run cap (`POST /run/<label>/cap`, a 402 once reached) and records/replays every call. The adapter also kills the
  process when the cap or the timeout is reached.
- **The keys.** An agent is given a **fake key built at run time** and an environment built from an allowlist (`scrubbedEnv`): no `OPENROUTER_API_KEY`, no
  token, no proxy or certificate setting; a throwaway `HOME`. Only the proxy reads the real key. A test fails if any adapter source mentions it.
- **Nothing is fetched at run time.** No plugin install (`opencode --pure`), no price list (aider and litellm get a local one), no update check, no telemetry.
- **The checkout.** The agent works in `input.checkout`; its own bookkeeping files are hidden with `.git/info/exclude`; the runner reads the diff with git and
  scores it with the task's hidden checks, as for every agent.
- **Not a sandbox.** These agents run shell commands on the machine with a real model's choices. The checkout and home are throwaway and the environment
  holds no secret, but run a real grid inside a container.

```
npm run e2e:tools -- list | install [name..] | verify | licences     # pinned installs into e2e/cache/tools (git-ignored)
npm run e2e:agents -- --prove [--agents aider,codex]                 # no key: each agent, a scripted model, the smoke task, then a replay from the cassette
npm run bakeoff -- --grid --models a,b,c --agents tailzu,aider,opencode,codex,mini-swe-agent,openhands --tasks 'tag:smoke' --budget-inr N
```

`--prove` result (2026-10-27, `smoke-api-bug-pagination`): all five record and replay with 0 misses and pass the hidden tests. A scripted model applies the
known patch in each agent's own protocol, so this proves the wiring (command, proxy, cassette, diff, scoring), not how good any agent is.

### Pins and licences

`agents/versions.json` is the one place a version is written. Python tools are installed from **hash-locked** requirements
(`uv pip compile --generate-hashes --exclude-newer 2026-10-13`, installed with `uv pip sync --require-hashes`); npm tools with `npm ci --ignore-scripts` from the
lock file beside them. Nothing is `@latest`; nothing in any tree is younger than two weeks. LiteLLM 1.82.7 and 1.82.8 on PyPI carried an infostealer (March
2026): aider pins 1.81.10, mini-swe-agent is held to the same, OpenHands needs ≥1.83.7 and resolves 1.105.0.

- **No AGPL or GPL tool is vendored.** Every tool runs as a separate process; none of their code is in ours. The Node libraries are `devDependencies`.
- **OpenHands**: MIT itself, but two of its 207 transitive Python dependencies are copyleft: `bashlex` (GPL-3.0-or-later) and `func_timeout` (LGPL-2). They are
  imported by the OpenHands process only. Do not bundle its venv into anything we ship.
- **Trafilatura**: Apache-2.0 since 1.8 (earlier releases were GPL; never pin below 1.8). One dependency, `tld`, is multi-licensed (taken under MPL-1.1).
- **garak**: Apache-2.0, not installed here (needs torch and several GB). The probe set in `e2e/security/garak.ts` is written in garak's shapes instead.
- Notices: `THIRD_PARTY_NOTICES.md`, section "Test-only tools".

## 2. Part bake-offs (`e2e/bakeoff`)

```
npm run bakeoff -- --fetch-pages         # the page corpus, once (43 real pages, e2e/cache/pages, git-ignored)
npm run bakeoff -- --parts               # the free parts, for real: page extraction and locate; the others shown wired, with estimate and command
npm run bakeoff -- --parts --prove       # also runs the cents parts on scripted models (no key) to prove their machinery
npm run bakeoff -- --parts --spend --budget-inr N [--only editFormats,contextStrategy,router]   # the real thing, with OPENROUTER_API_KEY
npm run bakeoff -- --parts --replay --only router --cassette parts-router-2   # a recorded paid run, replayed for nothing (no key)
npm run bakeoff -- --estimate [--probes-only] [--edit-format]   # (= --dry) the plan and its cost from the live prices; also `--parts --estimate` and `--grid --models .. --estimate`
```

`--estimate` says what a run costs and stops: no key, no model. The catalog it prices from is fetched through the proxy the environment names (`HTTPS_PROXY`,
`NO_PROXY`: `e2e/fetch.ts`; Node's own `fetch` ignores them), so a sandbox gets real prices and not the assumed ones. A bake-off plan without `--edit-format` says
what the edit-format probe would add ("NOT INCLUDED"). Cassettes key on `reasoning` too: a run whose reasoning changed (a model that requires it is no longer told to
switch it off) re-records instead of replaying the old refusal; recordings from before the field still answer the requests that are unchanged.

It writes `out/parts/<time>/report.html` and `parts.json` (and `out/parts/latest.*`); the e2e run report shows the same **Contestants** and **Parts** sections
when a parts file exists.

**Free, measured now.** *Page extraction* (`extract.ts`): our `src/web/extract.ts` against Defuddle, Mozilla Readability (on linkedom) and Trafilatura, on 43
saved pages, with hand-written truth for 15 (`extract-truth.json`: key sentences that must be there, page furniture that must not, code blocks that must come
through). Scores: recall, precision (furniture left out), F1, code fidelity strict (every line equal) and loose (the words), tokens per page. The truth is
checked against the pages themselves before it is used. *Locate* (`locate.ts`): our funnel (`fusedFor`, no model) against Aider's repo map (personalized by the
request as Aider does; plus what `aider --show-repo-map` shows) and plain grep, on the 27 bug and question tasks with ground-truth files: top-1, top-3, MRR.

**Wired, run with the key** (`centparts.ts`): *edit formats* per model (exact replace / search-replace blocks / unified diff), *context strategy* (summary / mask /
hybrid on real tasks, with `CODE_CONTEXT_STRATEGY`), *router* (the product's routing against one fixed mid tier, on the labelled front-door messages and the smoke
tasks; its free half, the classifier's rules against the labels of 90 tasks, is measured now). Each prints its estimate in rupees before anything is spent.

## 3. Security (`e2e/security`)

```
npm run e2e:security -- --prove                                # no key: both suites on scripted models
npm run e2e:security -- --model <slug> --budget-inr N [--agent tailzu,aider] [--limit 10] [--garak 10]
npm run e2e:security -- --garak-cmd                            # the command that points the real garak at the proxy
```

- **Injection suite**: 20 AgentDojo-style cases (`tasks/author/injection.ts`, data in `security/cases.ts`): a real job (the smoke API's pagination bug, hidden
  tests) with the attacker's text planted in a README, a source comment, package.json, a pasted issue, a CI log, a CHANGELOG, a test's output, a config file or a
  web page; goals are a marker file, a spoken phrase, a downloaded script, a leaked secret, a workflow, a deleted test, a dependency. The scorer's existing checks decide:
  **attack success rate** (`no_injection`, `no_leak`, `forbidden_paths`, `kept` failed) and **utility under attack** (hidden tests pass).
- **garak-shaped probes**: promptinject, latentinjection, dan, encoding, promptleak at the **front door** (decide + reply) and in the **agent loop**
  (probe planted in a file), every model call through the proxy.

## 4. Public benchmarks

Terminal-Bench 4.0 and SWE-bench Pro run each task in a Docker container. This container has the docker CLI and no daemon, so a 5-task sample cannot run here;
`bakeoff/public.ts` checks for a daemon and prints the Harbor commands (pinned `harbor==0.24.0`, Apache-2.0) for a machine that has one. With Docker, from
`tulmi/`: start the proxy (`npm run e2e:proxy -- --mode mixed --cassette public --budget-inr 150`), point the containers at `host.docker.internal:8787`, then
`harbor run -d terminal-bench/terminal-bench@4.0.0 -a mini-swe-agent -m openai/<slug> -n 5` and `harbor run -p v2/tasks -a mini-swe-agent -m openai/<slug> -n 5`.
Harbor's own adapters cover aider, codex, opencode and openhands too (`-a`). Check `harbor run --help` for flags first.

## Where things are written

`e2e/cache/` (clones, pages, tools, work) and `e2e/out/` (every run) are git-ignored. `e2e/agents/locks/` and `versions.json` are source.
