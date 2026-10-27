# The reality check: contestants, parts, security

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
```

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
