# Artifacts: live things a bot makes, and the person sees and clicks

An **artifact** is a small live thing a bot makes (a web page, a React component, an SVG, a diagram, some markdown) that the person sees and clicks in the app, beside the chat, like Claude's artifacts. This is the server's side of it: what is kept, how a bot and a person change it, what it costs, how it can look like a person's own project, and how an approved one becomes a Code bot job. It lives in `tulmi/src/artifacts/` and `tulmi/src/routes/artifacts.ts`, and it is for every bot, not only the Code bot.

It is **switched off by default**: `ARTIFACTS=true` turns it on, and migration `0032_artifacts.sql` must be run. With it off every `/v1/artifacts` route answers `404 artifacts_off`, before the session.

The other side is the **viewer** (the `viewer/` package): a page on a site of its own, never the app's, inside an iframe with `sandbox="allow-scripts"` and no network. The app is the iframe's parent, and the two talk only by `postMessage`, in the messages of `tulmi/src/artifacts/protocol.ts`, the one file both sides import. The viewer never holds a Tailzu token: whatever needs the server (saved data, asking the bot) goes up to the app, which calls the API as the person.

```
protocol.ts   the contract with the viewer: the messages, ARTIFACT_LIBS, ELEMENT_ID_ATTR, LIMITS, DesignKitCss
types.ts      what is kept; what a change returns (Change); the numbers
versions.ts   a snapshot every tenth version, patches between; contentAt(); exact edits
store.ts      artifacts, artifact_versions, artifact_data, artifact_kits: memory twin and Supabase (0032)
validate.ts   size, secrets, imports, no network, self-contained
scan.ts       "the element at line 14, column 7" -> that element's source, and nothing else
limits.ts     rate limits and a person's daily spend
model.ts      the one way to ask a model: a tier, a cap, a check on the answer, one climb
edit.ts       the efficiency engine: edit an element, edit by instruction, fix the viewer's error
service.ts    what a bot, a person and a share link may do, in one place
tools.ts      artifact_create, artifact_update, artifact_rewrite: the bot's tools
kitparse.ts   the readers that turn a project's files into design tokens
kit.ts        designKit (the project's look, cached per head) and componentArtifact (a component in place)
build.ts      "build it": an approved artifact becomes a Code bot job; the compare seam
pixels.ts     a PNG reader and writer in pure TypeScript, and the cheap gate that decides whether two shots differ (section 11)
shothost.ts   the page a screenshot of an artifact is taken of: it frames the viewer, sends `load`, marks `#done` (section 11)
shots.ts      screenshots of a web page and of an artifact (Cloudflare Browser Rendering, or a local Chrome); where they are kept; their signed links
compare.ts    the compare step: both shots, the gate, then the vision tier; implements CompareHook
```

## 1. The flow

1. **A bot makes one.** `artifact_create {type, title, content, projectId?}` (or the app's `POST /v1/artifacts`). The text is checked (section 4) and kept as version 1. The app loads it into the viewer (`load` message) with the project's look if it has one (`kit`).
2. **The viewer runs it** and tells the app what happened: `rendered`, or an `error` (`compile`, `runtime`, `import`, `limit`).
3. **An error is fixed for free.** The app forwards it (`POST /v1/artifacts/:id/errors`); the server sends a cheap model the error and the dozen lines around it, never the artifact, and the fix lands as a new version (section 3). The viewer reloads.
4. **The person points and says.** Select mode makes every element outline on hover; a click sends `select {elementId}` and nothing else. The person says what to change (`POST /v1/artifacts/:id/edit {instruction, elementId}`): the model is sent that element, a few lines around it and the kit, on the cheap tier. With no element, the model answers with exact replacements, not a rewrite.
5. **The bot changes it.** `artifact_update {id, edits}` sends only the lines that change: no model call on the server at all, and the stored version is just those edits. `artifact_rewrite` is for when most of it changes.
6. **Back and forth.** Every change is a version; `GET /:id/versions` lists them, `POST /:id/revert {version}` makes a *new* version with an old one's text. Nothing is lost.
7. **Saved data and asking the bot.** An artifact can save things while it runs (`storage` messages, a key and a JSON value, shared or the viewer's own) and can ask the bot a question (`ask`, metered against whoever is using it).
8. **Share.** `POST /:id/share` makes a secret link anyone can read; `othersCanSave` lets them save data too; `DELETE /:id/share` takes it back.
9. **Build it.** `POST /:id/build {projectId}` turns the version the person approved into a Code bot job whose **spec** it is (section 6).

## 2. Versions: snapshots and patches

Version 1 is a **snapshot** (the whole text). After it, a version is a **patch** against the one before: `{"e":[[start,deleteLength,"inserted"],...],"n":lengthOfTheResult}`, positions in the previous text. **Every tenth version is a snapshot again** (1, 11, 21, ...), so no version is more than nine patches from a whole text, and `contentAt(version)` rebuilds any version from the nearest snapshot at or before it. `n` is a check: a patch that does not make a text of that length was applied to the wrong text and is refused, never trusted.

Where the change was exact edits (`artifact_update`, a fix, an element edit's replacements), the patch **is** those edits at the places they were found; nothing is diffed. Where a whole text came (a rewrite, a revert), the patch is the one span between the longest common start and end; and a patch that would be more than 60% of the text is stored as a snapshot instead (no cheaper, simpler to rebuild).

A test (`tests/artifacts-versions.test.ts`) makes 25 versions, one of them a rewrite, rebuilds every one, checks that 1, 11 and 21 are snapshots, that the stored bytes are under a quarter of the texts', and reverts. A change moves the head only if the head is **still where the writer read it** (`head_moved` otherwise; in the database it is one function, `artifact_add_version`), so two edits at once never silently overwrite each other, and an edit whose model took a while to answer is refused rather than applied to a text that has changed. What the attempt cost is still added to the artifact.

`artifact_update`'s edits are exact and unique: each `old` occurs **once** in the artifact as it is now (every edit is matched against the artifact, not against the edits before it), edits must not overlap, and either all apply or none does. A miss names the edit ("Edit 2 did not apply: its old text "..." is not in the artifact...") and what to do, with a hint when the difference is only in the spacing.

## 3. What makes it cheaper than the usual way

The usual way to change a generated page is to send the model the whole page and have it write the whole page back. Here a change is made by the smallest thing that can make it.

| Change | What the model is sent | What it writes | Tier |
| --- | --- | --- | --- |
| `artifact_update` (the bot's own words) | nothing: no server-side model call | the edits, which are the patch | none |
| Person points at an element | that element's source, 3 lines before and 2 after, the kit | the element (or, if it is over 1,200 characters, a few exact replacements inside it) | **cheap** |
| Person says what to change | the artifact, once | exact replacements (a rewrite only if most of it changes) | cheap if both are small, else code |
| The viewer reports an error | the error and 13 lines around it, the kit | the replacement that fixes it | **cheap** |
| A new artifact from a request | the request, the kit, the surrounding section | the artifact | **code**, strong if the classifier says complex |

**Element-scoped edits.** Every element carries `data-tz-id="<line>:<col>"` of the `<` that opens it in the original source (the viewer sets it). `scan.ts` finds the element's span from it with a small scanner that understands JSX (nesting, self-closing tags, fragments, `"` and `'` strings, `{}` expressions with elements, strings, template literals, comments and regexes inside, TypeScript generics that are not elements) and HTML (void elements, raw text in `<script>`/`<style>`, comments, quoteless attributes, the end tags HTML lets you leave out), and says why when it cannot, never guessing. The answer is spliced back, must be exactly **one element** in the old one's place, and must pass the same check as any version.

**Tiers, and one climb.** Small edits and fixes start cheap. When a tier fails (every model on it is down, an answer is cut off, an element that does not parse, an edit that does not apply, a secret or a forbidden import in the result) the *same* request is made **once** on the next tier up (cheap, code, strong) with why the first answer was unusable. A second failure is reported, not retried: a loop of ever stronger models is how a small edit becomes a large bill. Every call is held to a cap in paise (the gateway refuses a call whose worst case would pass it) and to what is left of the person's day (`ARTIFACT_DAILY_PAISE`).

**Cache-friendly prompts.** Every prompt is laid out stable first: the system prompt (identical for every artifact), the project's kit (identical for every artifact of a project), the artifact or the span of it, and the instruction last. A provider that caches the start of a prompt (DeepSeek, OpenAI and Gemini do it by themselves) hits the system prompt and the kit on every edit of a project, and the whole prompt up to the instruction when the same element is edited again. A test checks the layout and the common prefix.

**Auto-fix.** `reportError(id, version, error)`: *deduped* by kind and message within a version (the same error twice is one call; a render loop that reports every frame costs nothing after the first), **at most two attempts per version**, and a chain of fixes of fixes stops at three. An error with no place (no line, nothing in the stack) is not fixed, because there is no small part to send: the person is told to ask the bot instead. A fix for a version that is no longer the head is `stale`.

**What it costs, measured.** On a real-sized React dashboard (5.7 KB, 1,630 tokens) and the same with three more panels (22.4 KB, 6,402 tokens). Tokens are counted as the brain counts them (3.5 characters a token), paise at the brain's tier price estimates, in a test (`tests/artifacts-edit.test.ts`) that fails if they drift:

| Change (heading text) | Tokens in | Tokens out | Tokens in all | Paise |
| --- | ---: | ---: | ---: | ---: |
| 5.7 KB artifact, full rewrite | 1,688 | 1,630 | 3,318 | 87 (code tier) / 260 (strong tier) |
| 5.7 KB artifact, **element edit** | 420 | 19 | **439 (13%)** | **5** |
| 22.4 KB artifact, full rewrite | 6,460 | 6,402 | 12,862 | 339 (code) / 1,016 (strong) |
| 22.4 KB artifact, **element edit** | 420 | 19 | **439 (3.4%)** | **5** |
| `artifact_update` with one edit (the bot's own call) | n/a | 30 | 30 (1.8% / 0.5% of a rewrite's output) | 0 |

An element edit that rewrites a bigger element (a button and its colours) is 589 tokens in all (18% / 4.6%). The cost of an element edit does not grow with the artifact: it is the same prompt on the 5.7 KB and the 22.4 KB artifact. The system prompt is most of the 420; with a full 2,000-character project kit the edit sends about 1,000 tokens, of which about 840 (system and kit) are the cacheable prefix. The stored version of a heading edit is 96 bytes.

Every change returns `{ artifact, version, content, paise, totalPaise, how }`, `how` saying the mode, tier, model, tokens, and how many characters of the artifact the model was sent against its size. The artifact keeps the running total (`spentPaise`), failed attempts included.

## 4. Validation (`validate.ts`)

Every text that becomes a version is checked first, and a refusal says what to change:

* **Size**: at most 512 KB (`LIMITS.contentBytes`), and no NUL character.
* **Secrets**: the same scan a commit gets (`code/policy.ts`). Refused, by *kind* ("looks like it holds a Stripe key"), never repeating the value. An artifact is read by whoever opens it and has no environment to read a key from, so a secret in one is always wrong.
* **React**: every bare import must be one of `ARTIFACT_LIBS` (react, react-dom, recharts, lucide-react, d3, three, mermaid; subpaths such as `react-dom/client` count as their package; `import type` is erased and ignored); a relative or web-address import is refused; there must be a default export.
* **Network**: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` are a **warning**, not a refusal: the viewer blocks them anyway, and some artifacts only reach for the network on a path that is never taken. `localStorage`, IndexedDB and cookies get a warning too (the sandbox has none).
* **HTML and SVG** must be self-contained: a script, stylesheet, image, frame or font from another address is refused (inline it, use `data:` URIs, import a library from the list in a `<script type="module">`). A link a person would click is only a warning.

## 5. The project kit (`kit.ts`, `kitparse.ts`)

"Make me a pricing card" is better when the card looks like the person's project. `designKit(project)` reads **at most 12 files** through the workspace (or the job's room), with no model, and makes:

* a **`DesignKitCss`** for the viewer (`protocol.ts`): the project's own CSS variables, `--tz-*` aliases for the tokens (colours, radius, spacing, fonts), base element styles, Google font addresses, and the Tailwind config (`theme.extend` colours, fontFamily, borderRadius, spacing, screens, as plain JSON, read from the config's text, never run), capped;
* a **prompt kit of at most 2,000 characters** for a model: the name and what the look is made with, colours (the usual semantic names first), the dark scheme, fonts, radius, spacing and screens, the icon library, the project's components with their props, and "use these names, colours and radius".

What is read, by priority: `components.json` (shadcn: it says which CSS file has the variables, and the icon library); the Tailwind config; the global CSS (`:root`, `.dark`, `[data-theme=dark]` and `prefers-color-scheme` blocks, also inside `@layer`/`@media`; Tailwind v4's `@theme`); theme files (MUI `createTheme`, Chakra `extendTheme`, a styled-components `theme` object, a `colors`/`tokens` file); the layout or `index.html` for fonts (`next/font/google` with its CSS variable, Google Fonts `<link>`); Flutter `ThemeData`/`ColorScheme` (`Color(0xFF...)`, `fromSeed`, `GoogleFonts`, `BorderRadius.circular`); Android `colors.xml`, `themes.xml` and the night theme, Compose's `Color.kt`/`Theme.kt`; iOS `*.colorset/Contents.json` with its dark appearance. Colours are read as hex, `rgb()`, `hsl()` (also shadcn's bare `222.2 84% 4.9%`) and `oklch()`, through `var(--x)`. The component catalog is the project brain's symbols (kind `component`, exported) in files under `components/` or `ui/`, most central first, with props read from the first few files the file budget allows.

What it never does: read an env file or a key (`isSecretPath`), use a file the secret scan flags, load a font or stylesheet from anywhere but **Google Fonts** (an `@font-face` from another host is dropped; only a family the project itself takes from Google is asked of Google, because one family Google does not know fails the whole stylesheet), or run any of the project's code. The kit is **kept per project and the head it was read at** (`artifact_kits`), and read again only when the brain's head moves; a project with no brain has no head, so its kit is made but not kept.

**`componentArtifact(project, request, {image?})`** makes the component in place. An image (a sketch or a screenshot) goes to the **vision tier first** for a layout description (250 words, from top to bottom), which goes in with the words. `locate()` (`code/work/locate.ts`) says where in the project the component would go; the surrounding section of that file (numbered, around the evidence, 3,500 characters at most) is read; and a **react** artifact (**html** for a project that is not React: Vue, Svelte, Flutter, Android, iOS) is made on the code tier (strong if the classifier says complex), with the kit first and the request last, that recreates just enough of the section around the new part that the person sees it in place. If locate is unsure the prompt says "probably", and if it finds nothing the component stands alone in the project's style.

## 6. "Build it" (`build.ts`)

`buildFromArtifact(userId, artifactId, version, projectId)` takes the version the person approved (not the head: they may have kept editing) and:

1. reads the project's kit (free if the brain has not moved) and runs `locate()` to find where it goes;
2. makes a work branch (`tailzu/build-<title>-<4 hex>`) and an agent job on it;
3. gives the job a **task** that says what to build, where, in what style, with the top of the design (it stays short: the planner and the classifier read it);
4. marks the design as the job's **spec** (`AgentState.spec`, `code/agent/types.ts`): the whole artifact at that version (cut at 40,000 characters, and says so), the kit, and where it goes.

The agent loop then shows the design to the model **every turn** as the thing to match (`code/agent/context.ts specBlock`): in a data fence its own text cannot close, beside the kit and the place found, with the instruction to use the project's **real** components, styles and conventions, not the artifact's stand-ins (inline styles, copies of components, hard-coded colours). When the context is tight the design is cut last (14,000 characters, then 8,000, 5,000, 3,000). The locate phase is **not run again** when the search at approval time was sure: that answer stands. If it was unsure and came with a question, the phase runs the usual way and the person is asked. `GET /v1/code/jobs/:id` shows which artifact and version a job builds (`agent.spec`).

**The screenshot compare is section 11.** `CompareHook` (`build.ts`, passed as `compareHook`) is the seam: when the job is made, `register(job, {artifactId, version, type, title})` tells the compare step which artifact version is this job's spec; later `compare({job, spec, builtUrl?, route?, location?, kit?, viewports?})` is given the address of the built page and answers `{ similarity?, notes, skipped?, viewports? }`, one `ViewportResult` (`match`, `issues`, `gate`, `shots`, `paise`, `error?`) for each viewport asked for. `compare.ts` is the real hook; without it (`ARTIFACTS` off, or no browser) the default (`noCompare`) does nothing and says so, and the job runs the same.

## 7. Routes

All authenticate like the rest of `/v1`, and are the owner's only (another person's artifact is a plain `404`, the same words as one that is not there), except where noted. The full list, with bodies, is at the top of `routes/artifacts.ts`.

| Route | |
| --- | --- |
| `POST /v1/artifacts` | make one from `content`, or from a `prompt` (code tier) |
| `GET /v1/artifacts?projectId=`, `GET /:id?version=`, `GET /:id/versions` | list, read the head or a version (with the project's `kit`), the history |
| `POST /:id/revert {version}`, `DELETE /:id` | go back (a new version), delete (with versions and data) |
| `POST /:id/edit {instruction, elementId?}` | a person's edit through the engine |
| `POST /:id/errors {version, kind, message, line?, col?, stack?}` | the viewer's error, for an automatic fix |
| `POST /:id/share {othersCanSave?}`, `DELETE /:id/share` | the share link on and off |
| `GET /v1/artifacts/shared/:token` | **public, read only**: id, type, title, version, content, `othersCanSave`, the look. Not the owner, the cost, or the project |
| `GET /:id/data`, `GET`/`PUT`/`DELETE /:id/data/:key` | saved data, `?scope=shared\|me` (default `me`) |
| `POST /:id/ask {prompt, tier?}` | the artifact asks the bot |
| `POST /v1/code/projects/:id/artifacts/component {request, image?}` | a component in place |
| `POST /:id/build {projectId, version?, budgetPaise?}` | build it |
| `GET /:id/shots/:shotId?exp=&sig=` | one screenshot of the design check (a PNG), **the owner's signed-in session only**, and only with a signature that has not run out (section 11) |

**Saved data.** Scope `shared` is everyone's; `me` is the caller's own. The owner may do all of it. Someone with the share token (header `x-artifact-share`, or `?share=`), signed in or not, may **read** shared data, and may **write** only if the owner turned "others can save" on (anonymous: shared scope only; signed in: their own scope too). A value is at most 64 KB, a scope holds 500 keys (in the database a function counts them under a lock), and a key is 1 to 128 letters, digits, spaces and `. _ : / @ # -`. Taking the link back takes the access and the switch with it. The owner never sees a viewer's own scope through the API, and the row-level security says the same: an owner reads the shared scope of their artifacts, a person reads their own scope anywhere, nobody reads another's.

**Ask.** The cheap tier by default (`tier: "code"` is the only other choice), one call, no climb, at most 8,000 characters (`LIMITS.askChars`), the caller must be signed in (the owner, or someone with the token), and **it is metered against the caller**: their id goes to the model, their own day is charged (`ARTIFACT_ASK_DAILY_PAISE`, 500 paise unless set), and the owner's artifact and the owner's day are untouched. Opening a link must not spend someone else's money.

## 8. Safety

* **The sandbox is the viewer's**: a site of its own, `sandbox="allow-scripts"`, no network. Nothing here relies on it alone, though: the text is checked before it is kept (no secret, no import that is not available, no external resource), so a page that would only show a blank frame is refused with a reason.
* **Secrets are refused**, in an artifact, in an instruction (the model is shown "withheld" instead), in a model's answer (it climbs, then fails) and in the kit (a file that holds one is not used and the CSS is dropped if it would).
* **No network, no code run**: the kit reads a project's files as text. Google Fonts is the only host the viewer is told to load from.
* **A share link is read through the API only**; the database's row-level security lets an owner read their own rows and nobody else's, and only the service role writes. The token is 24 random bytes; a revoked token and an invented one are the same `404`.
* **Rate limits** (per person, or per link when there is no person) on every door a stranger's artifact can reach, on top of the app's own per-route limit: saved data 120 a minute, ask 10, edit 20, errors 30. A refusal is `429` with `retry-after`.
* **Money is capped three ways**: per call (the gateway refuses a call whose worst case would pass `CAP_PAISE`: 150 cheap, 500 code, 2,500 strong, 100 vision, 200 ask), per person per day (`ARTIFACT_DAILY_PAISE` for edits, fixes and makings, `ARTIFACT_ASK_DAILY_PAISE` for asks), and per fix chain.
* **Nothing is logged that came from an artifact**: a log line has the mode, tier, paise and sizes. The model calls go through the brain's gateway (`data_collection: "deny"`, the person as a hash).
* **The account**: deleting an account deletes `artifacts` (with their versions and data, which cascade) and `artifact_kits`, and clears what the person saved in other people's artifacts (`deleteViewerData`, by scope). `exportOf(userId)` returns a person's artifacts with their text, version list and the data they could see; there is no account export route in the server yet, so it is there for it, with `ARTIFACT_TABLES` listing the four tables.

## 9. Setting up

1. Run `tulmi/supabase/migrations/0032_artifacts.sql` (or `full_schema.sql`). It needs nothing from the Code bot's migrations.
2. `ARTIFACTS=true`. Optionally `ARTIFACT_DAILY_PAISE` (2000) and `ARTIFACT_ASK_DAILY_PAISE` (500). Models are layer 1's (`CODE_MODEL_TIERS`: the cheap, code, strong and vision tiers).
3. For project-styled artifacts and "build it": `CODE_GITHUB`, `CODE_PROJECT_BRAIN`, and the agent loop (`docs/code-agent.md`).
4. Any bot adds `ARTIFACT_TOOLS` to its own tools and routes the three names to `runArtifactTool(service, {userId, projectId?}, call)`.

## 10. Known limits, and what to check live

* The fix book (which errors were seen, how many attempts) is in this process's memory, like the rate limits: a restart forgets it, and two servers each keep their own. A restart can cost one more fix attempt per version, never an unbounded loop (the daily cap holds).
* The tier slugs and prices are layer 1's unchecked estimates (`docs/code-brain.md`). Measure a real element edit's paise on the live cheap tier and tune the caps (`CAP_PAISE`) and `ARTIFACT_DAILY_PAISE` from that.
* **Prompt caching**: the layout is stable-first, which is all that DeepSeek, OpenAI and Gemini need. Anthropic (the last model on every ladder) caches only a prompt with explicit breakpoints, which the gateway does not send yet. Check the cached-token counts in the ledger on a repeat edit.
* The element scanner reads JSX and HTML the way a compiler and a browser do, with small deliberate gaps: a stray end tag inside an HTML element that is already well formed is taken for its parent's, and a regex literal after `)` is read as division. A source it cannot read gets a plain reason and the person edits without pointing. Run it over a few real artifacts from the viewer to see how often that is.
* An edit by instruction sends the artifact once, so it has a size at which it costs more than one edit may: about 100 KB on the code tier. Past that the edit is refused ("more than one edit may cost") and the person points at an element instead, which costs the same on any size.
* The kit's readers are tolerant, not complete: a Tailwind preset, a theme built by a function, or tokens in a package are not followed. They leave the kit smaller, never wrong.
* The viewer's `data-tz-id` must be the position in the *original* source (`ELEMENT_ID_ATTR`); an id from another version gets "the element id is from another version".

## 11. Looking at what was built: the preview, the shots and the compare

"Build it" (section 6) gives the job the approved design as its spec. Before the commit, the agent now does what a person does before saying "done": **runs the app, looks at it, and puts it next to the design.** Three pieces, none of which can stop a job from committing.

```
 the job's runner          jobs Worker (JobRoom)            Cloudflare Browser Rendering           the vision tier
 ┌──────────────┐  http    ┌──────────────────┐   url      ┌──────────────────────────┐  2 PNGs   ┌────────────┐
 │ project's dev│◀────────▶│ preview door     │◀───────────│ shootUrl(built page)     │──────────▶│ compare.ts │
 │ server       │  frames  │ <token>.preview… │            │ shootArtifact(design)    │           │ gate first │
 └──────────────┘          └──────────────────┘            └──────────────────────────┘           └────────────┘
```

### The preview

The project's own dev server runs on the job's runner, and the Worker shows it at an address on **a site of its own**. The runner connects out to the job's room, as it does for commands, so the dev server is reached through that socket: no inbound port, no tunnel. How the address, the token, the cookie, the idle rule and the minute cap work is in `docs/cloudflare-jobs.md` section 11; the runner's frames are in `docs/desktop-runner-session.md` section 5. For this section: the address exists only while the design check needs it (or while the app shows it to the person: the live view gets `preview-ready {url}`), it dies with the job's session, and it costs nothing when nobody asks for it.

### The shots (`shots.ts`, `shothost.ts`)

* **`shootUrl(url, {viewport})`** a page, as Cloudflare's `/screenshot` endpoint takes it (`url`, a viewport, a `waitForSelector` object, `allowRequestPattern`). With `WEB_BROWSER=local`, our own headless Chrome over the DevTools protocol does it (`web/browser`), so a developer can try all of this without a Cloudflare token.
* **`shootArtifact(artifact, version, kit, viewport)`** an artifact **as the viewer draws it**. The viewer is driven by `postMessage`, so a shot of an artifact is a shot of a parent page: `shothost.ts` makes one (an iframe of the viewer at exactly the viewport's size, `ready` answered by `load`, `#done` added when the viewer says `rendered` and fonts and images had 700 ms), and sends it to the browser as inline HTML (`html` instead of `url`). An artifact that never renders never gets `#done`, so the shot fails instead of drawing a blank. The viewer used for this is the one **kept for screenshots** (`ARTIFACT_SHOT_VIEWER_URL`, `viewer/docs/artifact-viewer.md` section 14): inline HTML has an opaque origin, which the normal viewer's `frame-ancestors` cannot allow.
* **Two viewports**: mobile 390 x 844 (touch, mobile) and desktop 1280 x 800. The project's main target decides: mobile only for an Expo or React Native app with no web framework in it, both otherwise.
* The browser may fetch only the shot viewer, Google Fonts and `data:`/`blob:` (`allowRequestPattern`), so a design with pictures from other sites shows them blank, in the design's shot and nowhere else; the compare is told to ignore that.
* **Where a shot is kept.** The jobs Worker has no R2 and `tulmi/` has none, so a shot goes in the **artifact's saved data** (`artifact_data`), in pieces of 40 KB (a value may be 64 KB), under keys that begin `_tz/shot/`. It is in a scope of its own, not the person's `me` scope or `shared`: `shotScope(userId)` is a UUID made from the owner's id (the table's check allows `shared` or a UUID), which is nobody's user id, so **no data route can name it**. The artifact itself, which a bot wrote and anyone with a link may run, can neither list nor read its screenshots, and they do not spend its 500 keys. The scope keeps at most 40 shots and 480 keys (the oldest go first; a picture that alone would not fit is refused). A shot is **kept for 7 days** and is dropped as the index is next written; its id is 128 random bits. They go with the artifact when it is deleted (the table cascades).
* **The link to a shot is signed and the owner's alone**: `GET /v1/artifacts/:id/shots/:shotId?exp=&sig=`, where `sig` is an HMAC (`ARTIFACT_SHOT_SECRET`, else `CODE_JOBS_SECRET`) over the owner, the artifact, the shot and the expiry, **and** the request must carry the owner's session. A link that leaks is a `404`. It runs out at 7 days, with the shot.

### The compare (`pixels.ts`, `compare.ts`)

For each viewport, the built page and the approved design are shot at the same size, and:

1. **The cheap gate, in pure TypeScript.** `pixels.ts` reads both PNGs (`node:zlib`, no dependency; every chunk's CRC is checked, so a picture cut short is refused, not compared), reduces each to a 64 x 128 grid of lightness and a 16 x 32 grid of colour, blurs the lightness over 3 x 3 cells, and compares them cell by cell. When the shapes and the colours agree, the answer is **a match of 0.95 to 1 and no model call**. The gate catches two shots of one page (the common case after a good build, and the second round of a fix); a thin line that moved a whole pixel is not the same to it, and the model is asked, which costs little.
2. **The vision tier** is sent both pictures with the component's name, where it lives and the project's kit, and answers `{match, issues: [{area, issue, severity, fixHint}]}` once per viewport (`severity` is `minor` or `major`; at most 10 issues, the worst first). Its call is metered in **the job's budget** (`budget: "job"`, the job's id); at most `COMPARE_CAP_PAISE` (120) a call, and a call the job cannot afford is refused by the gateway before it is made. An answer that is not that shape is one unusable viewport, not a failed job.

### The design round (`code/agent/design.ts`)

The `design` phase sits between `verify` and `commit`, and only for a job with a spec (`CODE_DESIGN_CHECK=false` skips it for all):

1. open the runner (a trivial command, so the staged edits are laid over the checkout), start the dev server from the brain's scripts (`dev`, `serve`, `start`, with the package manager's prefix), wait for it to answer (150 s at most);
2. find the route: where the design goes, from the brain (Next's `app/` and `pages/`, the files that import it, React Router's `<Route>`), else `/`;
3. shoot and compare, mobile and desktop (the second viewport in a later advance, so one advance is never long);
4. **major issues send the job back to work**, with the differences and the fix hints in front of the model, **at most twice**; the checks run again before each look. After the last round one more look is taken and what still differs is **reported**, not looped on.

**It never blocks the commit.** No live runner, a project that is not a web app, no `dev` script, a dev server that will not start, no browser for shots, no shot viewer, a budget too small for a compare (about 240 paise), a failed shot, a model with nothing usable: the round is skipped or stops, one sentence says why in the report, and the job commits what its checks passed. The stages are saved one by one in the checkpoint (`DesignState.stage`), so a restart or a wait picks up where it was and nothing is done twice.

**The report** (and the pull request) carries the match per viewport, side-by-side signed links to the built page and the design, the number of rounds, and the minor differences that remain. `GET /v1/code/jobs/:id` shows where it is in `agent.design` (`stage`, `round`, the latest `match`, and `skipped` with the reason).

### What it costs

| | Per design check |
| --- | --- |
| Preview | the runner is already open for the job; the minutes count against `CODE_SESSION_MAX_MIN`. Idle: `CODE_PREVIEW_IDLE_SEC` |
| Shots | 2 per viewport, so 4 for a web app, 2 for a mobile one, per look. Cloudflare Browser Run bills browser time: **Workers Paid** 10 hours a month included, then $0.09 an hour; a shot is a few seconds of it. **The Free plan will not do**: 10 minutes of browser a day, and one Quick Action request every 10 seconds (Paid: 30 a second), so most shots there are refused with 429 (`busy`) and the check is skipped with that sentence ([pricing](https://developers.cloudflare.com/browser-run/pricing/), [limits](https://developers.cloudflare.com/browser-run/limits/), checked 2026-10-27) |
| Gate | free: pure CPU, a few tens of milliseconds |
| Vision call | at most 120 paise a viewport, only when the gate says the shots differ; in the job's budget, and the design check stops when what is left is under about 240 paise |
| Rounds | at most 2 more times through `work` and `verify`, each metered like any work |

### Setting it up

1. `ARTIFACTS=true` (this whole document), `CODE_LIVE_SESSION` on, and a runner that can run a dev server (GitHub Actions or the person's computer).
2. Previews: `PREVIEW_DOMAIN` or `PREVIEW_HOST` and the route, on the Worker (`docs/cloudflare-jobs.md` section 11).
3. Shots: `WEB_BROWSER=cloudflare` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Browser Rendering - Edit) on the Worker, or `WEB_BROWSER=local` where there is a Chrome.
4. The shot viewer: a second deployment of `viewer/` with `VIEWER_PARENT_ORIGINS=null`, its address in `ARTIFACT_SHOT_VIEWER_URL` (`viewer/docs/artifact-viewer.md` section 14). **Not the app's viewer.**
5. `ARTIFACT_SHOT_SECRET` (optional) signs the links; `CODE_JOBS_SECRET` is used when it is not set. The Worker signs a link and the VPS serves it (`routes/artifacts.ts`), so the value must be the same on both; `CODE_JOBS_SECRET` already is. The link is made on the Worker's `PUBLIC_ORIGIN`, the VPS's address.
6. The Workers **Paid** plan (see What it costs).

### What to check live

* Browser Rendering's `html` host page with a real token: that the sandboxed iframe loads the shot viewer, `ready` and `load` cross, and `waitForSelector("#done")` fires. (The page and the viewer are tested together in a local Chrome, `viewer/e2e/shot.spec.ts`; Cloudflare's browser is not reachable from here.)
* That Browser Rendering can fetch a preview address (it must be public; the token in the address is the credential) and that a dev server's pages are drawn before the shot is taken.
* The vision tier's real answer: the prompt asks for JSON only; check that the real model keeps to it, and tune `COMPARE_SYSTEM` from a few real pairs.

Tests of this section: `tulmi/tests/artifacts-{pixels,shots,shots-route,compare}.test.ts`, `web-browser-shot.test.ts`, `code-agent-design.test.ts`; the preview's are `code-live-preview*.test.ts` and `jobs/test/preview.test.ts`, and the shot viewer's `viewer/e2e/shot.spec.ts`.

Tests: `tulmi/tests/artifacts-{versions,validate,scan,tools,edit,kit,build,store,routes}.test.ts`, on a scripted model (`artifacts-rig.ts`) and the memory twin.
