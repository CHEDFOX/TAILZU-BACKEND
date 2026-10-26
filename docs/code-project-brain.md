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

Everything but `summarize.ts` and the welcome message works **without a model** and is complete on its own: if the model is down or the money is out, the brain is still true, it just has fewer plain-English lines (`summaries: "partial"`). No npm dependency was added: no tree-sitter, no tar library.

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
* **Symbols and routes**, by regex per language (TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin, Dart, Ruby, PHP, Swift, C#, and a generic fallback; routes for Express, Fastify, Hono, Koa, NestJS, Next.js, FastAPI, Flask, Django, Rails, Go's net/http and Gin, Spring, Laravel, ASP.NET, Rust and Flutter's GoRoute), after blanking comments so commented-out code is not a symbol. The environment variables a file reads are recorded too. Capped at 120 symbols a file. Every pattern has a fixture in the tests.
* **The import graph**, resolved: TypeScript/JavaScript with `tsconfig` `paths` and `baseUrl`, Python (absolute, relative, packages), Go (module path), Dart (`package:`). Ranked by in-degree and 20 iterations of PageRank, normalised. `neighbors(path)` is one hop each way.
* **Visible text**: the strings a person sees, with `file:line`: JSX/TSX text and attributes, HTML, i18n JSON, Flutter `Text(...)`, Android `strings.xml`, iOS `.strings`, Python and Go user-facing strings. Any line the secret scanner (`policy.ts`) flags is dropped. At most 200 a file and 30,000 a project.
* **Tests**: which test files cover which source files (by name, nearest first, and by import), which frameworks run them, and which hot or central files have no test.
* **Conventions**: the formatter and linter (from config files and dev dependencies), indentation, quotes, semicolons and naming (sniffed from the source), the commit message style (the last 30 messages: Conventional Commits or freeform, with the scopes used), branch naming, and the project's own **rules**: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md` and `CONTRIBUTING.md`, kept verbatim (6,000 characters a document, 16,000 in all) as "project rules" the bot reads as the owners' convention. They are text from a repo: they never raise the bot's permissions.
* **History and hotspots**: the last 100 commits (four requests at a time), what changed most, what changes together, TODO/FIXME counts per file. It **stops asking when GitHub's rate limit falls below 500** and keeps what it has; a commit touching more than 40 files is stored empty (a mass rename tells nothing). Hotspots are code files only; a hotspot that is central and untested is where to be careful.
* **Features**: files are clustered, with no model, by route segment, folder name, shared file-name word, co-change and imports into features (a cluster needs two files, or one with two routes), which the cheap model then names and describes; if it never does, the plain names stand.

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

## 8. For layer 5 (the planner): what to call

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
| `code_brain_files` | project and path | blob sha (the Merkle leaf), language, symbols, imports, rank, hotness, TODOs, tests, summary, and a generated `tsv` (GIN-indexed) |
| `code_brain_dirs` | project and folder | tree sha, summary |
| `code_brain_texts` | project, path and line | a visible string, its kind, and a generated, GIN-indexed `tsv` |

All four reference `code_projects (id) on delete cascade`, so a deleted project (or account) takes its brain with it; they are **not** in the account-deletion list of explicit `user_id` deletes for that reason. Row-level security is on: owners may `select` the rows of their own projects, and nobody but the service role writes.

## 10. Switches

| Variable | Default | |
| --- | --- | --- |
| `CODE_PROJECT_BRAIN` | `false` | the whole layer; needs the GitHub App and migration 0028 |
| `CODE_IMPORT_BUDGET_PAISE` | `1000` | model money for one build, in paise (see section 4) |

The tiers the summaries use are layer 1's (`CODE_MODEL_TIERS`, the `cheap` tier).

## 11. To check live (the tests use fakes)

* **OpenRouter**: that the `cheap` tier's slugs exist, and what a build really costs in paise on a real repo of a few hundred files; tune `CODE_IMPORT_BUDGET_PAISE` from that.
* **GitHub**: the tarball stream on a real repo (redirect to codeload without the token, a 100+ MB repo, a private repo), the tree's `truncated` flag on a huge one, and the rate-limit behaviour of the history step.
* **Supabase**: run migration 0028 and watch the generated `tsv` columns and the prefix search on real data.
* **The App**: that **Push** is ticked on the live GitHub App (existing Apps need it added; see `docs/github-app.md`) and a real push shows up as `stale` and then an incremental build a minute later.
