# The Code bot's brain, layer 4: the project brain

Layer 1 (`docs/code-brain.md`) is which model to ask and what it may cost, layer 2 the loop that writes code, layer 3 what the bot finds on the web (`docs/web-search.md`). **Layer 4 is what the bot knows about one repo.** When a person adds a repo as a project, Tailzu reads it once, builds an accurate and cheap-to-query understanding of it, and keeps that understanding fresh as the repo moves, paying only for what changed. It lives in `tulmi/src/code/project/` (`code/brain/` is the model layer; this is a different thing).

It is **switched off by default**: `CODE_PROJECT_BRAIN=true` turns it on (it also needs the Code bot's GitHub App, `docs/github-app.md`) and migration `0028_code_project_brain.sql` must be run. With it off, both routes answer `404 brain_off`, adding a project builds nothing, and push events are ignored.

```
snapshot.ts      the tree, then the code in ONE tarball (or blob by blob)     tar.ts: our own tar reader
merkle.ts        what changed since last time, from git's own shas
scan.ts          structure: languages, package managers, frameworks, workspaces, entry points,
                 commands, CI, env var names, Docker, README
symbols.ts       functions, classes, routes, per language, by regex
graph.ts         the import graph (resolved), in-degree + PageRank, neighbours
texts.ts         the visible strings (JSX, HTML, i18n, Flutter, Android, iOS, Python, Go)
tests.ts         which tests cover which file
conventions.ts   style, commit style, and the project's own rules files, verbatim and capped
hotspots.ts      history: what changes most, what changes together, TODOs
registry.ts      npm / PyPI lookups, through layer 3's sources
features.ts      clustering files into features
summarize.ts     a cheap model, on a budget: lines for files, folders, the repo, features, a welcome
memory.ts        the TAILZU.md text (kept in the database, never committed)
baseline.ts      the plan of checks to run before the first edit, and recordBaseline
build.ts         one build, start to end
store.ts         ProjectBrainStore (memory twin and Supabase), migration 0028
index.ts         the door: build / get / open / ensureFresh, BrainSync (push), the facade on Code
```

Everything but `summarize.ts` and the welcome message works **without a model** and is complete on its own: if the model is down or the money is out, the brain is still true, it just has fewer plain-English lines (`summaries: "partial"`). Two npm dependencies read code, `web-tree-sitter` and `tree-sitter-wasm` (section 3a, licences in `THIRD_PARTY_NOTICES.md`); there is still no tar library.

## 1. What a build does

```
 5  the tree          3 GitHub calls: the branch, its commit, `git/trees/{sha}?recursive=1`
15  the contents      ONE tarball request for the whole repo, or the blobs of what changed
35  each file         symbols, routes, imports, strings, TODOs                (no model)
50  the whole         the graph and its ranks, the test map, conventions, history, hotspots, features
70  SAVED             everything above is written (status still "building"): usable from here on
85  the words         lines for the files that matter, the folders, the repo; the features named
95  the memory and the welcome message
100 ready
```

`GET .../brain` reports that percentage and phase while it runs. A failed build leaves the earlier rows as they were and says why in plain words (never a path, a line of code, or GitHub's own message).

### What is read

Only files that carry meaning, chosen from the tree before anything is downloaded. Skipped: vendored and output folders (`node_modules`, `vendor`, `dist`, `build`, `out`, `.next`, `target`, `coverage`, `__pycache__`, `.git`, and the like), generated and minified files, source maps, **lockfiles** (their existence is recorded, because they say which package manager), binaries (a NUL in the first 8 KB, or a binary extension), and files over 512 KB.

| Cap | Value | When it is hit |
| --- | --- | --- |
| Tarball, compressed | 300 MB | **tree-only mode** (below) |
| Tarball, inflated | 2 GB | tree-only mode |
| Files read | 20,000 | the most useful first: manifests and docs, then source, then tests, then the rest |
| Text held in memory | 60 MB | the same order |
| One file | 512 KB | skipped, counted |

**Tree-only mode** is for a repo too big to download, or one GitHub will not hand over as a tarball. The brain is built from the tree and the few core files (manifests, configs, docs) fetched one by one: every readable file still gets a row, with no symbols, so it can be found by name, grouped by folder and paired with its tests. The structure says `mode: "tree-only"`. A later incremental build stays tree-only; asking for a full build tries the download again.

### The tar reader

`tar.ts` reads the gzip stream as it arrives (`zlib.createGunzip()`), a header at a time, without ever holding the archive. It understands ustar (the `prefix` field only when the magic is `ustar\0` and version `00`), pax `path` records (per entry and global), GNU long names (`L`, `K`), and base-256 sizes; it checks every header's checksum; and it stops with `truncated` or `too_big` rather than throwing a raw zlib or socket error. The token goes to `api.github.com` only: the tarball request is redirected to `codeload.github.com`, and the redirect is followed **without** the token.

## 2. Incremental updates: git is a Merkle tree

A file's blob sha is a hash of its bytes; a folder's tree sha is a hash of its entries' names and shas. A folder's sha is therefore the same exactly when nothing under it changed. The brain keeps the sha of every file it analysed and every folder it summarised, so `diffSnapshots(prev, next)` (`merkle.ts`, pure) is a comparison of two maps:

| Thing | If its sha is the same | If not |
| --- | --- | --- |
| A file | symbols, imports, texts and summary stand: not fetched, not analysed, not summarised | fetched and analysed again (summarised again if it is one of the files that get a line) |
| A file that is gone | | its rows are dropped |
| A folder | its summary stands | made again if something under it was re-summarised |

Changes **roll up to the root**: a changed file changes every folder above it, so the repo overview is remade whenever anything summarised changes. A changed file's blob is fetched with `git/blobs/{sha}` when 200 or fewer changed, otherwise by the tarball again. What spans files (the graph, the ranks, the test map, the features) is rebuilt from the kept rows plus the new ones, which is cheap and needs no GitHub call. A build whose head is the one already kept does nothing and saves `ready`.

An incremental build becomes a **full build by itself** when a file that decides how imports resolve changed (a `tsconfig`, `go.mod`, a package's name): the kept rows hold what imports resolved to, not what they said.

An incremental build gets a fifth of the budget (below); a rebuild after a partial one pays only for what is missing.

## 3. What it knows, with no model

* **Structure**: languages by bytes, package managers (from lockfiles and manifests), frameworks, workspaces and monorepo packages, entry points (never tests), **commands** with the package manager's prefix (`pnpm run test`, not `npm`), CI workflows, environment variable *names*, Docker (files, images, ports, services), the README's title.
* **Symbols and routes**, by **tree-sitter** where a grammar is loaded (section 3a) and otherwise by regex per language (TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin, Dart, Ruby, PHP, Swift, C#, and a generic fallback; routes for Express, Fastify, Hono, Koa, NestJS, Next.js, FastAPI, Flask, Django, Rails, Go's net/http and Gin, Spring, Laravel, ASP.NET, Rust and Flutter's GoRoute), after blanking comments so commented-out code is not a symbol. The environment variables a file reads are recorded too. Capped at 120 symbols a file. Every pattern has a fixture in the tests.
* **The import graph**, resolved: TypeScript/JavaScript with `tsconfig` `paths` and `baseUrl`, Python (absolute, relative, packages), Go (module path), Dart (`package:`). Ranked by in-degree and 20 iterations of PageRank, normalised. `neighbors(path)` is one hop each way.
* **Visible text**: the strings a person sees, with `file:line`: JSX/TSX text and attributes, HTML, i18n JSON, Flutter `Text(...)`, Android `strings.xml`, iOS `.strings`, Python and Go user-facing strings. Any line the secret scanner (`policy.ts`) flags is dropped. At most 200 a file and 30,000 a project.
* **Tests**: which test files cover which source files (by name, nearest first, and by import), which frameworks run them, and which hot or central files have no test.
* **Conventions**: the formatter and linter (from config files and dev dependencies), indentation, quotes, semicolons and naming (sniffed from the source), the commit message style (the last 30 messages: Conventional Commits or freeform, with the scopes used), branch naming, and the project's own **rules**: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md` and `CONTRIBUTING.md`, kept verbatim (6,000 characters a document, 16,000 in all) as "project rules" the bot reads as the owners' convention. They are text from a repo: they never raise the bot's permissions.
* **History and hotspots**: the last 100 commits (four requests at a time), what changed most, what changes together, TODO/FIXME counts per file. It **stops asking when GitHub's rate limit falls below 500** and keeps what it has; a commit touching more than 40 files is stored empty (a mass rename tells nothing). Hotspots are code files only; a hotspot that is central and untested is where to be careful.
* **Features**: files are clustered, with no model, by route segment, folder name, shared file-name word, co-change and imports into features (a cluster needs two files, or one with two routes), which the cheap model then names and describes; if it never does, the plain names stand.

## 3a. Reading code with tree-sitter

`symbols.ts`, `graph.ts` and `texts.ts` each ask `analyse(path, language, text)` (`src/code/project/treesitter`) first. It parses the file once, runs the language's **tags-style queries** (`treesitter/queries/<language>/*.scm`, embedded in `queries.gen.ts` by `npm run gen:queries`) and hands back the file's symbols, imports, routes, the names it refers to, and the words a person reads in it. It answers `null`, and the regex reader that was always there answers instead, whenever the parser cannot: `CODE_TREE_SITTER=false`; no grammar for the language, or this runtime does not carry it; a file over 600,000 characters, or with a line over 4,000 (minified code); a parse over 3 seconds; a file more than a quarter syntax error. A grammar that fails to load is remembered as failed for the life of the process, and its language is read by regex. Nothing in a build can fail because of the parser.

* **What the queries find.** Definitions, exported or not, with the line they start and **end** on; classes with their members as `Owner.method` (nothing local to a function body); references (calls, `new`, types, JSX tags, base classes); imports in each language's form; HTTP routes (Express, Fastify, Hono, Koa and NestJS; FastAPI, Flask and Django; Rails and Sinatra; Go's net/http, Gin, Echo and chi; Spring and Ktor; Laravel; ASP.NET; actix, Rocket and axum; Vapor; Flutter's GoRoute; Next.js file routes stay with the path reader); JSX and HTML text and attributes. One combined query per grammar, since a query costs a walk of the tree whatever its patterns.
* **Fourteen grammars**: TypeScript, TSX, JavaScript (JSX), Python, Go, Rust, Java, Kotlin, Ruby, PHP, Swift, C#, Dart, HTML. All MIT, exact-pinned (`web-tree-sitter` 0.27.1, `tree-sitter-wasm` 2.0.4). **On the VPS** every grammar is a file in `node_modules`, compiled the first time a repo has a file in that language: a repo of TypeScript never loads Kotlin. **On the Cloudflare Worker** (`jobs/src/grammars.ts`) a grammar must be bundled, because a Worker may not compile WebAssembly at run time; the bundle carries the engine and **eleven** grammars (9.6 MiB of WebAssembly, each loaded by a dynamic `import()` only when a build asks for it) and leaves out Kotlin, Swift and C#, which compile to 60, 80 and 195 MB of machine code in the 128 MB isolate (measured in workerd). Those three are read by regex on the Worker and by the parser on the VPS. A build with more than 32 MB of text on the Worker does not use the parser at all.
* **Worker bundle** (`wrangler deploy --dry-run`): **2,741 KiB** (671 KiB gzip) before, **12,962 KiB** (1,842 KiB gzip) now, 12.7 MiB of the 64 MiB the Workers limits page allows; all fourteen grammars would be 25 MiB. About 88 KiB of the growth is the secret scan's rules (`docs/github-app.md`, "The secret scan"). The Worker's tests load each carried grammar in workerd and parse with it.

**Measured** (`npm run bench:symbols`; the TypeScript compiler API, `evals/symbols/truth.ts`, is the ground truth for the second table, so it does not grade the parser with its own queries). Precision and recall of definitions, regex against tree-sitter:

| | regex P / R | tree-sitter P / R |
| --- | --- | --- |
| Hand-written fixtures, 11 languages (gold in `evals/symbols/gold.ts`: 185 definitions, 16 routes, 27 imports) | 95.5% / 69.2% | 100% / 100% |
| Routes (fixtures) | 87.5% / 87.5% | 100% / 100% |
| Imports (fixtures) | 100% / 96.3% | 100% / 100% |
| **`tulmi/src`, 402 TypeScript files, 6.6 MB**: exported top-level definitions (3,632) | 99.1% / 100% (32 invented) | 100% / 100% |
| all top-level definitions (6,518) | 98.1% / 97.7% (126 invented, 148 missed) | 100% / 100% |
| top-level definitions and methods (7,530) | 98.1% / 84.6% (1,160 methods missed) | 100% / 100% |
| imports (1,929) | 99.0% / 100% (19 invented) | 99.9% / 100% (1 invented) |
| where a definition ends (`endLine`) | not available | 100% |

Per language on the fixtures, the regex reader's recall is TypeScript 73.3%, Python 92.9%, Go 100%, Rust 63.2%, Java 46.7%, Kotlin 47.1% (precision 61.5%), Ruby 75.0%, PHP 75.0%, Swift 56.3%, C# 64.3%, Dart 64.7%; TSX is 100% for both. The parser is 100% in each.

The fixtures were written by us while the queries were, so the 100% there says the engine passes the tests it grew up with; the compiler check is the one nobody tuned for. Three files of `tulmi/src` (more definitions than a row keeps) are left out of the corpus and one is declined by the parser and read by regex; both are counted in the bench's header.

**What it costs.** A full build of `tulmi/` itself (406 files, 5.9 MB) takes **4.0 s with the regexes and 5.3 s with the parser** (best of six runs, wall clock, on a machine that was doing other work), plus **0.4 s once per process** to start the engine and load the TypeScript and TSX grammars. Parsing is the cost; nothing else in a build changed.

## 3b. The repo map

`repomap.ts` is Aider's idea written for Tailzu's brain. A file **defines** names (its symbols) and **refers to** names (what the parser found it calling, instantiating, extending and using as a type: `code_brain_files.refs`, at most 120 a file, migration 0035). A file that refers to a name another file defines depends on it. The dependencies, with the import edges the brain already resolves, are a graph over the repo's files, ranked by **PageRank personalised on the request**: the walk restarts at the files and identifiers the request names, so the rank is closeness to what was named, not popularity. Edges are weighted as Aider weights them (the square root of how often a name is used; ten times for a name the request mentions and for a distinctive one such as `parseConfigFile`; a tenth for `_private` names and for names defined in more than five files), and every edge also runs **backwards at twice its weight**: Aider's walk follows references only and can never reach a caller. A repo read by regex has no references; its map is the import graph.

It is **locate's sixth signal** (`work/locate.ts`), and the funnel's second look: when the five signals are already sure (over `CONFIDENT`) or the request names exactly one strong place, the map is not asked; otherwise its neighbours of what was named are fused in with weight 2.5 (`MAP_DEFAULTS`; `back` 2, the named files themselves left to the other signals). A brain without `refs`, a Worker without the grammar or `MapSettings.on = false` have no sixth signal and nothing else changes. The graph is kept in memory while the brain's row does not change.

**Measured** (`npm run bench:locate`; the map's weight and direction were chosen on the DEV half of the tasks, the TEST half was only read). Locate's file ranking, five signals against five plus the map:

| Tasks | DEV: top-1 / top-3 / top-8 / MRR, map off to on | TEST: the same |
| --- | --- | --- |
| Acme Shop fixtures (12 requests of the brain's own tests; not split) | 91.7% in top-1, top-3 and top-8, unchanged | |
| "fix the bug in `<symbol>`" (120 generated from `tulmi/src`, the answer is its definition) | 98.5 / 100 / 100 / 0.990, unchanged | 98.2 / 98.2 / 98.2 / 0.982 to 96.4 / 98.2 / 98.2 / 0.973 (one task) |
| "update the code that uses `<X>` and `<Y>`" (120 generated, the answer is the file that uses both) | 0 / 8.5 / 10.2 / 0.038 to **11.9 / 45.8 / 61.0 / 0.291** | 0 / 11.5 / 16.4 / 0.055 to **11.5 / 39.3 / 60.7 / 0.274** |

The old signals find a definition and cannot find a caller; the map finds the callers and costs one task in the test half of the first set. `tests/code-work-locate-map.test.ts` holds those bounds on a smaller sample.

## 4. The words, and what they cost

`summarize.ts` puts a layer of plain English on top, so the bot and the person can read what a file is for without opening it:

* **Which files**: at most 150, picked by how central they are, how hot, and whether they start a program or serve a route. Folders get a line from their children's lines, and the repo one overview from the folders'.
* **How**: the `cheap` tier through `callModel` (layer 1: `data_collection: "deny"`, nothing logged), about ten files to a call, JSON out. A model sees a file as an excerpt of about 2,500 characters: its head (past any licence header), then the signatures of what it exports and the routes it serves. The excerpts go in as fenced **data**, with the instruction that nothing inside is an instruction. What comes back is checked: only paths that were asked about, cut to 240 characters, a line the secret scanner flags dropped.
* **The welcome message**: at most 900 characters, a sentence about the repo, its health if a baseline has been recorded, and 3 to 5 first tasks. Up to 15 npm and PyPI lookups (layer 3's sources) say which dependencies are deprecated or far behind.

**The budget.** `CODE_IMPORT_BUDGET_PAISE` (default **1000 paise**, ten rupees; 0 to 1,000,000) caps what one build may spend on models. A meter adds what each call really cost and refuses a call (`BudgetExceeded`) the moment its worst case would pass what is left. The files may use the first 65%, folders up to 80%, and the last fifth is kept for the repo overview, the feature names and the welcome, so a big repo cannot starve the three things a person reads first. An incremental build gets 20% of the budget. When the money runs out, or the model fails twice in a row, what is done is kept and the brain says `summaries: "partial"`; the rest of it is untouched. `spentPaise` says what the build cost.

## 5. Privacy

* **No secrets are kept.** `.env*`, private keys, certificates and credentials files: only the fact that they exist (their path) is recorded. `.env.example` is read for *names* only; values after `=` are dropped as the file is decoded.
* **No secrets are sent to a model.** A file the secret scanner flags is not excerpted; it is summarised from its symbol names. Visible strings, summaries, baseline output and rules are scanned the same way.
* **Nothing is logged** that came from a file: no path, no line, no byte. The build logs counts and timings.
* **The model sees excerpts, not the repo**, through a gateway that asks the provider not to keep the data. Nothing is sent anywhere when `CODE_PROJECT_BRAIN` is off.
* **The memory is not committed.** `memoryMarkdown(brain)` renders the `TAILZU.md` text (24,000 characters at most: structure, commands, conventions, rules, features, hotspots, baseline health) and it lives in `code_brain.memory`. Nothing is written to the person's repo.
* The brain is **the person's own**: rows are readable by the owner of the project (row-level security) and written only by the server's service role. Deleting the project (or the account) deletes the brain, since every table cascades from `code_projects`.

## 6. Routes

```
POST /v1/code/projects/:id/brain { mode? }   202 { status, progress, headSha, builtAt, summaries, welcome, structure, features, ... }
GET  /v1/code/projects/:id/brain             200 the same: status none | building | ready | failed | stale
```

`POST` starts a build in the background and answers 202 at once; `mode` is `"full"` or `"incremental"` (the default, or full if nothing has been built). A build already running is returned as it is, not started twice. `GET` is the status to poll. Both are for the project's owner only: another person's project, an unknown id and a malformed id are all the same plain `404 not_found`. A `mode` that is neither is `400`; a suspended install is `409 suspended`; no session is `401`.

**Adding a project** (`POST /v1/code/projects`) starts the first, full build by itself and answers with `brain: { status: "building" }`; adding the same repo again does not build again.

The response carries the structure, but not the build's own bookkeeping (the per-file extracts and skipped-blob memory that make incremental builds cheap).

## 7. Staying fresh: the push webhook

Subscribe the GitHub App to **Push** (`docs/github-app.md`). The webhook answers fast and **never calls GitHub inline**:

1. A push to the repo's **default branch** (not another branch, not a tag, not a deletion) finds every project on that repo, for every person, and marks its brain `stale`. A project with no brain yet is left alone: its first build is the full one.
2. A **60-second debounce** (per project; each push moves the timer) then starts one incremental build, however many pushes came.
3. If a build is running when the timer fires, the new one **queues** and runs when that one ends, from the row the first left.

`ensureFresh(userId, projectId, { waitMs = 30000 })` is for the layer that starts a job: if the brain was built from an older commit than the default branch's head now (or a push marked it stale), it updates it incrementally and waits, up to `waitMs`; it answers `{ fresh, updated, status, headSha }`. A project with no brain starts a full build and answers at once, not fresh.

**On Cloudflare.** With `CODE_JOBS_MODE=cloudflare` (`docs/cloudflare-jobs.md`) the builds this section starts (a project added, the push webhook's incremental build after its debounce, the refresh route, `ensureFresh`) are Workflow instances on the jobs Worker, id `brain-<projectId>-<headSha>` (one build per head). This server still receives the webhook, keeps the debounce and marks the brain `building` at once (and `failed`, in plain words, if the Worker could not be reached in three signed attempts); `ensureFresh` hands the build over and does not wait for it, so a job goes on with the brain as it is. The Worker runs `buildProjectBrain` (one step, with the raised CPU limit) and writes the progress into the same row, so `GET /v1/code/projects/:id/brain` is unchanged. The build holds up to 60 MB of text in a 128 MB isolate, which is the risk to watch for large repos.

## 8. For layer 5 (the planner): what to call

What layers 5 to 7 do with these calls (locate, plan, the work log, the library finder and audit, the research brief, the new-project planner) is `docs/code-work.md`.

```ts
const brain = code.brain!;                                   // null when CODE_PROJECT_BRAIN is off
await brain.ensureFresh(userId, projectId);                  // before a job
const b = await brain.open(userId, projectId);               // a handle over one project's brain
await b.findFiles("login form");                             // by path, symbol, summary words
await b.findSymbols("handleLogin");                          // symbols and routes, with path
await b.findTexts("Sign up");                                // visible strings, with file:line
await b.neighbors("src/lib/api.ts");                         // { imports, importedBy }
await b.testsFor("src/lib/api.ts");                          // tests that cover it
await b.feature("checkout"); await b.features();
await b.file("src/lib/api.ts"); await b.paths();             // one file's row; every path (5,000 at most)
await b.deps();                                              // what the manifests declare: name, ecosystem, range
await b.hotspots(); await b.coChanged("src/lib/api.ts");
await b.memory();                                            // the TAILZU.md text
await b.baselinePlan();                                      // [{ kind, cwd, cmd }]
```

Every call is a read of the kept rows: no GitHub call, no model. In Supabase, `findFiles`, `findSymbols` and `findTexts` use generated `tsvector` columns with prefix matching (`to_tsquery('simple', 'tok:*')`), then the same scoring as the in-memory twin (`search.ts`), so the two behave alike.

**The baseline.** `baselinePlan` is the list of checks to run before the first edit (`install`, `typecheck`, `lint`, `test`, `build`, with the package manager's prefix and the folder to run it in; the root's command stands for the whole repo, and only where the root has none are the packages' own used, four at most per kind). **Nothing here runs a command.** The agent loop hands the plan to the environment router (`docs/code-router.md`) and, once it has run, calls `recordBaseline(projectId, headSha, results)` with `[{ kind, exitCode, durationMs, summary, failing? }]`. It is kept with the commit it was run at (the health line in the memory and the welcome is brought up to date), after anything that looks like a secret is replaced by a note and every line is cut (300 characters a summary, 200 a name, 20 names a check).

## 9. Data (migration 0028)

`supabase/migrations/0028_code_project_brain.sql`, also appended to `full_schema.sql`; it can be run again (every create is `if not exists`, every policy dropped first).

| Table | One row per | Holds |
| --- | --- | --- |
| `code_brain` | project | status, progress, head and tree sha, structure, conventions, features, memory, welcome, baseline, history, `summaries_state`, `spent_paise`, `error` |
| `code_brain_files` | project and path | blob sha (the Merkle leaf), language, symbols, imports, **refs** (migration 0035: the names the file refers to, for the repo map), rank, hotness, TODOs, tests, summary, and a generated `tsv` (GIN-indexed) |
| `code_brain_dirs` | project and folder | tree sha, summary |
| `code_brain_texts` | project, path and line | a visible string, its kind, and a generated, GIN-indexed `tsv` |

All four reference `code_projects (id) on delete cascade`, so a deleted project (or account) takes its brain with it; they are **not** in the account-deletion list of explicit `user_id` deletes for that reason. Row-level security is on: owners may `select` the rows of their own projects, and nobody but the service role writes.

## 10. Switches

| Variable | Default | |
| --- | --- | --- |
| `CODE_PROJECT_BRAIN` | `false` | the whole layer; needs the GitHub App and migration 0028 |
| `CODE_IMPORT_BUDGET_PAISE` | `1000` | model money for one build, in paise (see section 4) |
| `CODE_TREE_SITTER` | `true` | read code with tree-sitter (section 3a); `false` reads everything with the regexes, as before. Also off by itself on the Worker for a build of more than 32 MB of text |

The tiers the summaries use are layer 1's (`CODE_MODEL_TIERS`, the `cheap` tier).

## 11. To check live (the tests use fakes)

* **OpenRouter**: that the `cheap` tier's slugs exist, and what a build really costs in paise on a real repo of a few hundred files; tune `CODE_IMPORT_BUDGET_PAISE` from that.
* **GitHub**: the tarball stream on a real repo (redirect to codeload without the token, a 100+ MB repo, a private repo), the tree's `truncated` flag on a huge one, and the rate-limit behaviour of the history step.
* **Supabase**: run migration 0028 and watch the generated `tsv` columns and the prefix search on real data. Run 0035 (`refs`) before the tree-sitter release; until it is run the store says once that the column is missing and the repo map has no references to rank by.
* **The Worker's memory** with the parser on a real, large repo: the grammars were measured in workerd on 300 files of one language (`jobs/src/grammars.ts`), not on a 20,000-file build with 60 MB of text.
* **The App**: that **Push** is ticked on the live GitHub App (existing Apps need it added; see `docs/github-app.md`) and a real push shows up as `stale` and then an incremental build a minute later.
