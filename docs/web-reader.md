# The page reader and its browser

Tailzu reads web pages for the Code bot's search tools (layer 3), for its agent loop, and later for anything a person asks it to look up. This is that one piece of shared code: `tulmi/src/web/`. It has **no HTTP routes**; other code calls it.

```
web/extract.ts   HTML in, compact markdown out (pure: no network, no clock)
web/reader.ts    readPage(url): fetch, extract, cache, cut to size; asUntrusted(page)
web/cache.ts     the extracted result, kept (memory, or Supabase, migration 0026)
web/error.ts     WebError and its codes
web/browser/     our own headless Chrome, for pages that only exist once their scripts have run
  cdp.ts         a minimal DevTools-protocol client over WebSocket
  chrome.ts      findChrome(), launch()
  guard.ts       the proxy every byte Chrome sends goes through (the browser's SSRF guard)
  engine.ts      BrowserEngine.render(url), rendererFrom(engine)
  index.ts       getRenderer(): the server's own browser, or null
```

No npm dependency was added: Node's builtins and the `undici` the server already has.

## 1. What it reads, and how

`readPage(url, opts)` returns `{ url, finalUrl, title, lang, text, headings, links, via, truncated, bytes, fetchedAt, contentType }`, or throws `WebError`.

* **The address** is tidied first: `http:` becomes `https:` (the one exception is the test-only `keepHttp` option, which throws outside a test run), the `#fragment` goes, and a GitHub file page (`github.com/o/r/blob/ref/path`) becomes the file itself on `raw.githubusercontent.com`.
* **The fetch** goes through `connectors/egress.ts` (below) with 15 seconds and 3 MiB, `Accept: text/html,text/plain,application/json;q=0.9,*/*;q=0.5`, and the User-Agent `WEB_BOT_UA`. No cookie is ever sent. The size and time limits are enforced again in the reader, whatever fetch is behind it. The charset comes from the header, else `<meta charset>`, else UTF-8.
* **HTML** becomes markdown: `#` headings, `-` lists, fenced code (exact whitespace, language from `language-x`, `lang-x` or `highlight-x`), `` `inline code` ``, pipe tables, and link text inline with the URLs collected in `links` (absolute, deduped, 200 at most, http(s) only). The content root is `<main>`, else the largest `<article>` (unless the page is a feed of many), else `[role=main]`, else the body with its link-heavy blocks (menus, tag clouds) removed.
* **Other types**: text and markdown pass through, JSON is pretty-printed, a PDF, an image or any other binary is `unsupported_type`.
* **`section`** returns only the text under the first heading that contains those words (case does not matter), up to the next heading of the same or a higher level. `sectionFound: false` says no heading matched, and the whole page comes back. This is the cheap way to read one part of a long document.
* **`maxChars`** (default 40,000) cuts on a paragraph boundary and never leaves a code fence open; `truncated` says so.
* **A page that is an empty shell** its scripts fill in (under 200 characters of text, and an empty `#root`, `#app` or `#__next`, many script tags, or a `<noscript>` asking for JavaScript) is first tried against its own `__NEXT_DATA__` and JSON-LD (`articleBody`, `description`). Still empty: with a `render` hook it is rendered in the browser (`via: "browser"`), without one the answer is `needs_browser`.
* **The cache** keeps the extracted result, never the HTML, under the sha256 of the normalised address (lower-case host, no fragment, sorted query), for `WEB_CACHE_TTL_MIN` minutes (default 360; a day or more for `*.readthedocs.io`, `docs.*`, `developer.mozilla.org`, `nodejs.org/api` and `raw.githubusercontent.com` at a commit). It never keeps an error, or an address whose query looks like a secret (`token`, `key`, `sig`, `signature`, `auth`, `code`, `session`, `password`, `X-Amz-*`, `access_token` and the like). A hit is `via: "cache"`. It is shared by everyone, which is safe because the reader logs in as nobody.
* **`purpose`**: `"user"` (the default) means a person asked for this very page, so `robots.txt` is skipped, as a browser skips it. `"index"` means we are gathering pages ourselves: `robots.txt` is read once a day per host (`User-agent: TailzuBot` before `*`, longest matching rule wins, a tie goes to Allow; a file that cannot be read means stay away for 15 minutes), a disallowed path is `robots`, and there is at most one request a second per host.

Errors are `blocked_address`, `bad_url`, `too_large`, `timeout`, `http_<status>`, `unsupported_type`, `robots` and `needs_browser`. Their messages never contain the address.

### Putting a page in a prompt

```ts
const page = await readPage(url, { render: getRenderer() ?? undefined });
messages.push({ role: "user", content: asUntrusted(page) });
```

`asUntrusted` wraps the text in `<web_page url="..." fetched="...">...</web_page>`, with a line ahead of it saying the page is data and not instructions. A `<web_page` or `</web_page` inside the text becomes `&lt;web_page`, so a page cannot close the wrapper and speak outside it. Secret-looking query values in the address are blanked. Layer 3 decides where the title and the links go.

## 2. The safety model

A page is hostile input twice over: it can aim our network access at places it should not reach, and its text goes into a model's prompt. Four layers answer that.

1. **The egress guard** (`connectors/egress.ts`, reused, not copied). Every fetch: https only, port 443 or 8443, no `name:password@`, and every address a name resolves to is checked for private, loopback, link-local, reserved and IPv4-in-IPv6 ranges **inside the connection's own DNS lookup**, so the address checked is the address dialled (DNS rebinding cannot win). Three redirects at most, each checked like the first.
2. **The guard proxy** (`browser/guard.ts`). Chrome makes its own requests, so they all go to a small proxy on `127.0.0.1`: `CONNECT` (https, websockets) and absolute-URI `GET` only; ports 80 and 443 only; the name is resolved there, **every** address is checked with `isBlockedAddress`, and the connection is made to the checked address, never to the name again. `--proxy-bypass-list=<-loopback>` takes away Chrome's exemption for localhost and link-local addresses, and `--host-resolver-rules` stops Chrome resolving any name itself, so nothing reaches the network but through the guard. A refusal is a 403 with `X-Tailzu-Guard: blocked`; the engine reads it, so a page the guard turns away, at its own address or on any redirect it takes, is `blocked` (`blocked_address` from `readPage`). Chrome does make a few housekeeping calls to Google when it starts; they go through the guard like everything else.
3. **Hidden text is never read.** The extractor drops elements that are `hidden`, `aria-hidden="true"`, or hidden by an inline style (`display:none`, `visibility:hidden`, `font-size:0`, `opacity:0`, zero size with overflow hidden, a clip to nothing, text pushed far off screen), plus script, style, noscript, svg, template, iframes, form controls, navigation, headers, footers and sidebars outside the main content, and cookie banners. The browser engine does the same on **computed** styles before it hands the HTML back, which catches what a stylesheet hides. Zero-width, bidi-control and "tag" characters are stripped from everything returned (the zero-width joiner and non-joiner stay between two non-ASCII characters, where Indic and Persian text and emoji need them). Alt text, titles, aria-labels and comments never reach the output.
4. **Data, not instructions.** `asUntrusted` (above). Nothing the reader returns should be put in a prompt any other way.

The browser also runs every page in its own incognito context with downloads denied, discards the context afterwards, and shows pages no cookies, because it has none. A page that opens a dialog is refused the dialog. Nothing in `src/web` logs a page body, a cookie, or an address with a query string.

**Running as root** (a container usually is) needs Chrome's `--no-sandbox`, which gives up the sandbox between a page and the machine. The guard keeps a page off the network, but a Chrome exploit would still be a root process. Run the browser where nothing else is at stake.

## 3. Turning the browser on

```
WEB_BROWSER=local        # off by default
CHROME_PATH=             # empty: /opt/pw-browsers/chromium*, then google-chrome, chromium, chromium-browser on PATH
WEB_BOT_UA=              # the User-Agent; default Mozilla/5.0 (compatible; TailzuBot/1.0; +https://tailzu.com/bot)
WEB_CACHE_TTL_MIN=360    # needs migration 0026 for Supabase; memory without it
```

`getRenderer()` returns the server's engine when `WEB_BROWSER=local` and a Chrome is found, else `null`. One Chrome starts on first use, takes at most three pages at once (more wait; a very long queue answers busy), shuts itself down after 60 seconds idle, and is started again if it dies.

### Tests

`tests/web-extract`, `web-reader` and `web-cache` need nothing. `tests/web-guard` talks to the guard proxy with raw sockets and a local server. `tests/web-browser` runs a real headless Chrome against a local page server and a local "secret" server, and is skipped where `findChrome()` finds none; it checks that the page's script ran (`via: "browser"`), that hidden text is gone, that the secret server got no request, and that no Chrome process or `tailzu-chrome-*` profile folder is left behind.

## 4. What's next

* **Layer 3** (search tools, `docs/web-search.md`) is the first caller, and is built: `code/webTools.ts` passes `render: getRenderer() ?? undefined`, `web/research.ts` uses `section` to keep reads cheap, and `scripts/seed-web-index.ts` uses `purpose: "index"` because it gathers pages itself. The Code bot's `read_page` and research read as `purpose: "user"`: a person's agent opening a page is a browser, not a crawler.
* **Layer 8: render where the job runs.** A page for a person's own errand is better opened on their desktop (their browser, their network), and a Code bot job's page on its GitHub Actions runner (Chrome preinstalled). Both are another provider of the same `Renderer`. `browser/engine.ts`, `guard.ts`, `cdp.ts` and `chrome.ts` import nothing from the app but `isBlockedAddress`, so they can be bundled into the runner script or the app. Not built yet.
* Not done: per-hop `robots.txt` checks on redirects (the final host is checked after the fetch), `Crawl-delay`, opening web components' shadow DOM, scrolling a page to wake lazy-loaded content (content that fades in on scroll starts at `opacity:0` and is removed as hidden), and reading PDFs.
