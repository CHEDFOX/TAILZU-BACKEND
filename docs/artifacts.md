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

**The screenshot compare is built next, in another step, and is not here.** `CompareHook` (`build.ts`, passed as `compareHook`) is the seam: when the job is made, `register(job, {artifactId, version, type, title})` tells the compare step which artifact version is this job's spec; later `compare({job, spec, builtUrl?})` is given what the built page looks like and answers `{ similarity?, notes, skipped? }`. Until the step exists the default hook (`noCompare`) does nothing and says so, and the job runs the same.

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

Tests: `tulmi/tests/artifacts-{versions,validate,scan,tools,edit,kit,build,store,routes}.test.ts`, on a scripted model (`artifacts-rig.ts`) and the memory twin.
