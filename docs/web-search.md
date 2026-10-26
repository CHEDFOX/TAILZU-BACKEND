# Web search and research

Layer 3 of the Code bot's brain: how Tailzu finds things on the web for programming help, and writes up what it found. Like the page reader (`docs/web-reader.md`) it is **shared code**, `tulmi/src/web/`, with **no HTTP routes**; the Code bot's glue is `tulmi/src/code/webTools.ts`.

```
web/search/types.ts      the plan, the result, the source, and the AskFn a model is handed in as
web/search/catalog.ts    the lists: ~65 official-docs sites, padding sites, source weights, hosts that may be indexed, sites to seed
web/search/plan.ts       planSearch(question, ctx): rules first, a tiny model only when unsure
web/search/http.ts       the one way out: egress guard, 10 s, 1 MiB, gzip by the bytes
web/search/sources/      npm, pypi, crates, github, stackoverflow, mdn, hn, wikipedia  (direct, keyless)
                         searxng, ddg, brave                                           (general web search)
web/search/rank.ts       merge, dedupe, score (source x intent x authority x freshness x position)
web/search/engine.ts     search(question, opts): cache, index, direct sources, discovery, rank
web/search/index.ts      SearchStore (memory and Supabase): the search cache and our own coding index; indexPage()
web/search/seed.ts       sitemap reading for scripts/seed-web-index.ts
web/research.ts          research(question, { depth, ask, search, read, limits }): read, answer, cite
code/webTools.ts         makeWebTools(): the three tools, bound to callModel, tiers, the job's budget and daily limits
```

`src/web/search/` and `src/web/research.ts` import nothing from `src/code`: the model arrives as an `ask` function, the search and the page reader as `search` and `read` functions. No npm dependency was added.

## 1. The pipeline

```
question ──► planSearch ──► { intent, queries ≤3, sources, site?, freshness, confidence }
                │  rules (free); a tiny model only when confidence < 0.7
                ▼
             search():   1. cache      the same normalised plan in the last 6 h (24 h for a package)
                         2. our index  ≤ 5 chunks of documentation we already hold
                         3. direct     the plan's sources, all at once (Promise.allSettled)
                         4. discovery  SearXNG → DuckDuckGo → Brave, only if 1-3 left it thin
                │
                ▼
             rank: merge by canonical address / package / repo, score, top `limit`
```

`search(question, { ctx, depth, limit = 8, ask, fetchFn, now })` returns `{ plan, results, via, cached, notes? }`. Each result is `{ title, url, snippet, source, published?, meta?, score, reasons[] }`. `via` lists the sources that found something, in the order they were asked; `notes` says what stood aside or failed, as `source:code` (`ddg:blocked`, `github:rate_limited`, `npm:timeout`, `discovery:daily_cap`), never a query.

* **`depth: "quick"`** searches with the plan's first query; `"standard"` with all of them (two per source, one for GitHub, two for discovery).
* **Discovery runs** when the question is `general` or `how_to`, or when there are fewer than `limit` *strong* results (score 0.8 or more). An engine is tried only if it has something to use (a SearXNG address, a Brave key), and the next only when one **fails, is blocked, or finds nothing**. The first query of a plan with a `site` is asked as `query (site:react.dev OR site:...)`.
* **The cache** key is the sha256 of intent, sorted lower-cased queries, sorted sources, sorted site and freshness. A search that found nothing is not kept (it may only have been unlucky). A search made **with a GitHub token is never written** (a token can see private repositories, and the cache is shared); it may read.
* A search never throws for a source: it is a note.

## 2. The planner

Rules first, for nothing:

| Intent | Found when | Queries | Sources |
| --- | --- | --- | --- |
| `error_fix` | a stack trace (JS, Java, Python, Go frames), `Error:`-shaped lines, `error TS2345`, `error[E0382]`, `npm ERR!`, `EADDRINUSE`... | the one line that names the error, **quoted, with paths, line numbers, addresses and ids stripped** (the `2345` in `TS2345` stays); that line plus the framework; the library the trace passed through | github (issues), stackoverflow |
| `package_lookup` | `npm/yarn/pnpm/pip/cargo X`, `X package/module/crate`, `install X` | the name | the registries the words or project point at (all three when unknown), github |
| `compare_libs` | `X vs Y`, `best library for ...`, `alternatives to X` | `X vs Y`, `... comparison` | hn, github (not the registries: they would be searched for the words "x vs y"); freshness `year` |
| `version_news` | `latest`, `release notes`, `changelog`, `what's new in`, `breaking changes`, `v5` | the question, `X release notes`, `X changelog` | github, hn, a registry; `site` the framework's docs; freshness `month` or `year` |
| `api_docs` | an API or method name (`useEffect`, `fs.readFile`, `os.path.join()`, backticked) **and** a framework: named in the question, or in `ctx` (framework, then dependencies), or the standard library the name belongs to (`Array.prototype.map` is JavaScript's and goes to MDN, `os.path.join` and `itertools.groupby` are Python's, `fs.readFile` is Node's; a name both share, like `os`, goes to the project's language), or else the project's language. With several names, the thing asked about comes first: a dotted name, then a backticked one, then a hook, then a bare word like `thisArg` | `framework name`, the question | mdn (for the web platform), stackoverflow; `site` = the framework's official docs |
| `how_to` | `how do I`, `how to`, `is there a way to` | the question without the politeness, plus the framework | stackoverflow, mdn |
| `general` | everything else | the question | stackoverflow, wikipedia |

Each rule that fires scores its intent; the highest wins; a rival of another kind within 0.15 takes 0.15 of the confidence away (`how do I install node` is how-to and package at once). Kinds that agree are merged (`api_docs` + `how_to`; an `error_fix` of 0.8 or more wins outright, since the names inside an error message are not API or package questions). **Under 0.7 and with an `ask`,** one tiny-level call with a strict JSON schema decides; its intent, queries, sources, site and freshness win, validated (sources that exist, hosts that look like hosts); a model that is down, over budget or off-schema costs only certainty.

**Scrubbing.** A question is pasted from a terminal and a terminal holds tokens. Before any rule reads it, keys (`ghp_`, `sk-`, `AKIA`, `xox`), JWTs, `Bearer` headers, `token=`/`password=`/`api_key=` pairs, e-mail addresses and long letter-and-digit runs are removed, and an address in the text keeps its host and path and loses its query, fragment and `name:password@`. Queries from a model are scrubbed too. Queries go to third parties and into a cache everyone shares.

**The official-docs map** (`catalog.ts`, 65 entries): react.dev, nextjs.org/docs, vuejs.org, nuxt.com, svelte.dev, angular.dev, docs.python.org, developer.mozilla.org, nodejs.org/api, typescriptlang.org, go.dev, doc.rust-lang.org, docs.djangoproject.com, fastapi.tiangolo.com, tailwindcss.com/docs, supabase.com/docs, vercel.com/docs, prisma.io/docs, docs.expo.dev, docs.flutter.dev, developer.android.com, developer.apple.com, docs.docker.com, kubernetes.io, postgresql.org, docs.github.com, ... A name is found in a question by its **aliases** only (`next.js`, `nextjs`; not the plain words `next`, `node` or `go`, which are reached through `ctx`). `react-native` is not `react`. The ranker uses the same map to know an official page by host and path prefix (not a lookalike, not a subdomain).

## 3. The sources

All keyless unless said. Every call goes through `connectors/egress.ts` (https, port 443/8443, public addresses only, checked at connect time) with **10 seconds, 1 MiB** (PyPI 6 MiB, sitemaps 6 MiB and 30 s), `fetchFn` injectable, our `WEB_BOT_UA`, no cookie. Free limits are the services' own as documented when this was written: **check them before relying on one**.

| Source | Endpoint | Free limit | Notes |
| --- | --- | --- | --- |
| `npm` | `registry.npmjs.org/-/v1/search?text=&size=10`, then `/<pkg>/latest` and (if the search answer lacks it) `api.npmjs.org/downloads/point/last-week/<pkg>` for the best 3 hits | no key, no published hard limit | `meta`: version, license, repo, deprecated, modified, weekly downloads. Uses `/<pkg>/latest`, not `/<pkg>`: a popular package's whole document is megabytes |
| `pypi` | `pypi.org/pypi/<pkg>/json` | no key, CDN-cached | **exact names only** (PyPI has no search API); up to 2 package-shaped words of the query; 404 is "no such package"; a project with thousands of releases (boto3) passes the 6 MiB cap and counts as failed |
| `crates` | `crates.io/api/v1/crates?q=&per_page=10` | 1 request/second, **User-Agent required** | |
| `github` | `api.github.com/search/repositories?q=` / `search/issues?q=... is:issue` | **10 searches/minute** per address, 30 with a token | issues for `error_fix`/`how_to`, repositories otherwise. **`X-RateLimit-Remaining` is read on every answer; at 0 the source stands aside until `X-RateLimit-Reset` and makes no call.** Private repositories are dropped |
| `stackoverflow` | `api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=&site=stackoverflow&filter=withbody` | **300 calls/day** per address; 10,000 with `STACKEXCHANGE_KEY` | the API gzips every answer (inflated by the bytes, cap applies to the inflated size); `is_answered` and accepted answers go to `meta` for the ranker; `backoff` and `quota_remaining: 0` are obeyed |
| `mdn` | `developer.mozilla.org/api/v1/search?q=&locale=en-US` | no key, unpublished | |
| `hn` | `hn.algolia.com/api/v1/search?query=&tags=story` | about 10,000 requests/hour per address | every query word must match, so it is cut to its meaningful words (retried with two) |
| `wikipedia` | `en.wikipedia.org/w/rest.php/v1/search/page?q=&limit=5` | fair-use; answers 429 to bursts | a 429 stands it aside for a minute |
| `searxng` | `<WEB_SEARXNG_URL>/search?q=&format=json` | whatever our instance can do | first discovery source; see below |
| `ddg` | `html.duckduckgo.com/html/?q=` | **none promised; low volume only** | second; see below |
| `brave` | `api.search.brave.com/res/v1/web/search?q=` + `X-Subscription-Token` | paid (check Brave's current plans) | last, and only with `BRAVE_SEARCH_KEY` |

### General web search, and what it may and may not be

* **SearXNG is the way to scale.** It is a metasearch engine we host: set `WEB_SEARXNG_URL`. Its `json` format must be on (`search.formats` in its `settings.yml`), and the address has to be **public https** (443 or 8443): the egress guard refuses private addresses, so an instance on the server's own docker network has to be put behind the reverse proxy. An address that is not https is ignored with a warning at startup.
* **DuckDuckGo's HTML page is a guest, for low volume only.** It is a page for browsers, not an API; DuckDuckGo does not promise its markup and does not offer it to other products as a search service. It is the second source so the bot works with nothing set up, and it is held to **one request every two seconds per process** (a request that would wait over 8 s stands aside, so a burst falls through to the next source). A 202, a 403/429, or a page with no results that talks of an "anomaly" is read as a challenge: **the source rests for 10 minutes** and makes no call. Do not build on it. When volume matters, run SearXNG or buy Brave.
* **Brave** is the paid fallback, tried only after the free ones failed or found nothing. The key goes in a header, never in an address.

A per-person daily cap (below) counts each query's turn at these engines.

## 4. Ranking

`score = source weight × intent fit × authority × freshness × position` (and ×1.25 for an exact package name in a package lookup; ×(1 + 0.06 per extra source, 3 at most) for a page that independent sources both found). Two results are the same when their addresses normalise alike (lower-case host, no `www`, no fragment, no tracking parameters, sorted query, no trailing slash) or when they are one package or repository under two addresses; the better copy is kept and fills its gaps from the other.

* **Authority:** the plan's official docs host 1.45; any official docs 1.35; MDN 1.3; a registry entry 1.2; an accepted Stack Overflow answer 1.25, answered 1.1, **unanswered 0.85**; a GitHub issue closed after discussion 1.2; a repository 1.0 to 1.2 by stars; a known content farm ×0.8 (a short list in `catalog.ts`: geeksforgeeks.org, tutorialspoint.com, ...), a deprecated package ×0.5, an archived repository ×0.6.
* **Freshness** counts only when the plan asks (`year` or `month`). Documentation and registry entries are not aged by their date; an undated page loses a little.
* Each result carries its `reasons` ("official docs", "accepted answer", "exact name", "also found via ddg", "content farm", "deprecated", "old").

## 5. Our own coding index

Migration **`0027_web_search.sql`** (also appended to `full_schema.sql`; optional, memory without it) adds two tables, both with row-level security on and **no policy** (the server's service key only):

* **`web_search_cache`**: `key_hash` (pk), `plan` jsonb, `results` jsonb, `expires_at`.
* **`web_index`**: `id`, `url_hash`, `url`, `title`, `heading`, `chunk_no`, `body`, `lang`, `source`, `fetched_at`, and `tsv tsvector generated always as (to_tsvector('simple', title || heading || body)) stored` with a **GIN** index; `unique (url_hash, chunk_no)`. The `simple` configuration keeps code identifiers as written.

**`indexPage(page)`** cuts a read page along its headings into chunks of about 1,500 characters (a chunk closes at the next heading once it has 900; a fenced code block stays whole when it fits; a heading with nothing under it travels on to the next; 80 chunks at most) and **replaces** whatever the index held for that address (new chunks written over the old by `(url_hash, chunk_no)`, the surplus deleted after, so a search in between never finds the page missing). It refuses, in this order: an address that is not public http(s) (private or reserved IPs, `localhost`, names with no dot or ending `.local`, `.internal`, ...; `name:password@`); an address whose query looks like a secret (the page cache's check, `isCacheable`); **a host that is not documentation or a public reference** (`isIndexableHost`); a page with nothing in it.

> The host rule is deliberate. The index is searched by everyone. A page a person read because they were handed an unlisted link (a shared Google Doc, a paste, a Notion page) must not become findable by the next person. Official docs, the registries, MDN, Stack Overflow, Wikipedia, `docs.*`, `*.readthedocs.io` go in; `docs.google.com`, `notion.site`, `gist.github.com`, `pastebin.com` and the like never do, even though some start with `docs.`.

**`searchIndex(q, limit)`** cuts the question to its meaningful words (6 at most), asks for **all of them** and, only if that gave fewer than wanted, **any of them**. Supabase uses `.textSearch('tsv', q, { type: 'websearch', config: 'simple' })` for up to 60 candidates, and ranks them in Node (PostgREST cannot order by `ts_rank`) with BM25 (k1 1.2, b 0.75; a title word counts three times, a heading word twice) over the candidates; the memory twin does the same with BM25 over its whole corpus. Quoted phrases and `-excluded` words are honoured. The server prunes searches past their expiry, and pages last fetched over 120 days ago, as it writes (Supabase: one write in a hundred).

**Seeding.** `scripts/seed-web-index.ts` crawls the official-docs sitemaps in `SEED_SITES` (Vue, Next.js, Vite, Prisma, Expo, Supabase, FastAPI, Django, MDN). It reads pages as `purpose: "index"`, so **robots.txt is obeyed and there is at most one request a second per host**. **Dry run by default** (reads the sitemaps, lists what it would fetch, writes nothing); `--apply` indexes; `--sites vue,vite`; `--max N` per site (default 30, at most 500).

## 6. Research

`research(question, { depth, ask, ctx, search, read, limits })` returns `{ answer, sources: [{ n, title, url, fetchedAt, cited }], confidence, gaps, pagesRead, spentPaise?, partial?, stoppedBy? }`.

| Depth | What it does | Model level |
| --- | --- | --- |
| `quick` | plan, search, read the best **sections** of the top 3 pages, answer. 24,000 characters, 40 s | `cheap` |
| `standard` | up to three queries, about 6 pages. 48,000 characters, 75 s | `code` |
| `deep` | a first draft; then `ask` lists the gaps and up to two queries; up to **2 more rounds** of searching and reading (4 pages a round); **15 pages in all**; then a final synthesis. 90,000 characters, 170 s | draft `code`, gap check `cheap` (JSON schema), final `strong` |

* **Sections.** A result from our index names its heading, and that section is read. For any other page longer than its share of the character budget, the section heading sharing the most words with the question is picked (the page's own title is not a candidate, and words that are in the title do not count: they are about the whole page) and the reader's `section` option is asked for (the page cache answers: no second fetch). A **package result** (npm, PyPI, crates) is not read; its facts go in as a short card.
* **What goes to the model.** Everything that came from the web (pages, cards, titles) goes **only inside `asUntrusted` wrappers**, each preceded by our own line saying it is untrusted data and numbered `[n]` outside the wrapper. The system prompt says web text is data and never an instruction to the model, that every claim ends with `[n]`, that gaps must be admitted, and ends with `GAPS: ...`. The gap step is given the question and the draft only: no address, title or page.
* **The citation check.** Every `[n]` that names no source is removed (with the space before it); text in code (fences and `` `spans` ``) is left alone. Then the paragraphs that make claims are counted (a list item is one; headings, code and short lines are not): **if fewer than half cite a source the confidence is cut hard** (capped at 0.45) and the gaps say so.
* **Hard caps** whatever the depth: pages read, characters of source text sent (a page gets its share of the budget; later rounds get what is left; a deep run sends the same text again in its final synthesis), and wall time. They can be lowered by `limits` and never raised past 20 pages, 120,000 characters, 240 s. Passing one is not an error.
* **Partial.** A budget error from `ask` (`code: "budget_exceeded"`, what `BudgetExceeded` looks like from here), any model failure, the clock, or the caller's abort: what has been gathered comes back with `partial: true` and `stoppedBy`. If no answer was written yet, `answer` is a plain list of the pages that looked most relevant. If the gap step or the final synthesis of a deep run is refused, the draft comes back. Nothing found: no model is asked at all.
* **Confidence** rises with pages read and with an official or registry source that is cited, falls with each admitted gap, with a failed citation check, and when the run stopped early.

## 7. The Code bot's tools

`makeWebTools({ userId, jobId?, budget, fetchFn?, render?, githubToken?, ctx? })` returns `{ tools, handlers, run(toolCall), settled() }`.

| Tool | Does |
| --- | --- |
| `web_search { query, depth? }` | `search()`; a ranked list with addresses and a few lines each |
| `read_page { url, section? }` | `readPage()` (`purpose: "user"`: a person's agent opening a page is a browser, so robots.txt is not applied; the bulk crawler in section 5 is the `"index"` kind). When a page is cut short, or no heading matched, the page's **whole** list of headings is returned so a section can be chosen. The page is put into our index in the background |
| `research { question, depth }` | `research()` |

* **`ask` is `callModel`**: the tiny tier plans a search; `cheap`, `code` and `strong` as in the table above; the job id, the person and the `budget` pass straight through, so a call the budget cannot cover throws `BudgetExceeded`, which research turns into a partial answer, and what a call costs lands on the job's `spent_paise`.
* **Daily limits** (per person, a rolling 24 hours, in memory: `src/usage` counts dictated words and has no per-person counter of anything else, so a restart forgets a day at most): `WEB_SEARCH_DAILY` (200) general-web-search **queries at the engines** (the free direct sources are not counted; when the allowance is gone the search carries on with them and says so), and `WEB_RESEARCH_DAILY` (30) **research runs**. 0 turns that part off.
* **Everything the model reads is wrapped:** search results, pages, research answers (`<web_page url="search://results">`, `research://answer`), a page cannot close its wrapper, and errors are fixed words (`webErrorWords`), never the address or the page.
* **Nothing is logged:** not a query, not a question, not an address, and the person's id is not logged anywhere here (OpenRouter gets it only as the gateway's hash).

## 8. Safety, in one place

* Every outbound call: egress guard, 10 s, a size cap (the cap also applies to what gzip inflates to), `fetchFn` injectable.
* Web text reaches a model only inside `asUntrusted`; the system prompt says it is data; a page's `</web_page>` becomes `&lt;/web_page>`.
* Queries are scrubbed of credentials before anything else reads them; no query is logged with or without a person; the shared caches hold no person.
* A search with a GitHub token is never written to the shared cache; private repositories are dropped.
* The shared index takes only public-by-design hosts, never a secret-looking address.
* DuckDuckGo's page: one request in two seconds, a challenge believed and rested for ten minutes.
* Budget: every model call is through `callModel`; nothing here can spend past a job's budget.

## 9. Setting up

1. Optionally run `tulmi/supabase/migrations/0027_web_search.sql` (or `full_schema.sql`) after 0026. Without it the cache (300 searches) and index (2,000 pages) are in memory.
2. Optionally set, in `tulmi/.env` (all documented in `.env.example`): `WEB_SEARXNG_URL`, `BRAVE_SEARCH_KEY` (secret), `STACKEXCHANGE_KEY` (secret), `WEB_SEARCH_DAILY`, `WEB_RESEARCH_DAILY`. With none of them, search uses the direct sources and DuckDuckGo at low volume.
3. Optionally seed the index: `npx tsx scripts/seed-web-index.ts` (dry run), then `--apply`.

### Tests

`tests/web-search-plan` (rules for each intent, scrubbing, the model fallback, the docs map), `web-search-sources` (every source against fixtures in the shape the real services answer in, the DuckDuckGo parse, gzip, the rate limits, the way out, the config), `web-search-engine` (order, cache, discovery fall-through, dedupe, ranking), `web-search-index` (chunking, `indexPage`, BM25, both stores, the migration), `web-search-research` (depths, citation check, caps, partial, what the model is handed), `web-search-tools` (tool definitions, `callModel` binding, daily limits, wrappers, background indexing, no logging). None needs a network.

## 10. Known limits, and what needs a live check

* **DuckDuckGo may simply refuse.** While this was built, a real request from the build machine got the 202 challenge page; the parser is tested against fixtures in the shape of DuckDuckGo's markup, not against a live page. Check it from the production IP before counting on it, and expect to move to SearXNG or Brave.
* **SearXNG and Brave have never been called** (no instance, no key): their requests and parsers follow the documented shapes and are tested against fixtures. The first live search through each should be looked at.
* **GitHub search could not be reached from the build machine**; the repository and issue shapes are from GitHub's documentation.
* The free-tier numbers in section 3 are as documented when written. The Stack Exchange 300/day and GitHub 10/minute limits are per address, so several servers behind one address share them.
* The seed list was checked against the live sitemaps (all but Django's, which takes about 10 s to answer, were instant); sitemaps change, and `--max` keeps a mistake small.
* PyPI has no search: a question that names a package loosely ("that python http library") reaches PyPI only through the web engines.
* `read_page` skips robots.txt (it is a person's agent); research reads the pages the search found the same way. If that ever needs to be stricter, `purpose: "index"` in `webTools.ts` is the switch, at the price of some documentation sites refusing.
* Not done: reading PDFs, following pagination, searching in languages other than English, per-person (rather than per-process) limits shared across servers, and learning which sources answer best (the router's `code_route_stats` is for models, not sources).
