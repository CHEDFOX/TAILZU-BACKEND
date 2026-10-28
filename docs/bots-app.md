# The Bots app: building its screens

The new design of the phone and desktop apps ("everything is a bot": tabs **Bots / Activity / You**, Home is your bots) is
server-driven like the rest of Tailzu. The backend builds node trees from a **kit**; the phone (`TAILZU-FRONTEND/app/src/sdui`) and
the window (`TAILZU-DESKTOP/sdui.js`) draw them. Design source: `bots-design/` (STYLE.md, Kit1-3, every board, `check.cjs`).

* [1. The switch](#1-the-switch)
* [2. Where things are](#2-where-things-are)
* [3. Adding a screen](#3-adding-a-screen)
* [4. Data and actions](#4-data-and-actions)
* [5. The kit](#5-the-kit)
* [6. Tests](#6-tests)
* [7. The render check](#7-the-render-check)
* [8. The node types the kit adds](#8-the-node-types-the-kit-adds)
* [9. Rules, and what not to touch](#9-rules-and-what-not-to-touch)

## 1. The switch

`BOTS_APP=true` (config.ts) turns it on, for a build that declares **`BotsKit`** in `capabilities.components` (today's phone and
desktop builds from this change on). `BOTS_APP_TESTERS=a@x.in,b@y.in` narrows it to those sign-ins while set.

* **Off, or an older build: today's app, byte for byte** (tests/bots-app-boot.test.ts checks the bootstrap is identical).
* **On:** the bootstrap sends the tabs `bots` / `activity` / `you` (screens `bots.home`, `bots.activity`, `bots.you`), lands on
  `bots.home` (after the Bots app's own first run, below), adds the Geist fonts, flag `bots.app: true`, and warms the three tabs. The
  screen route answers every `bots.*` id, and `home` (where every "go to the app" in today's flows points) becomes `bots.home`.
* **The first run** (screens/firstRun.ts): Welcome → Sign in → Code in the sign-in gate (`auth.screen` = `botsAuthTree()`), then
  `bots.name-it` (About you: the name and gender card's own question and write, `PUT /v1/profile { full_name, gender }`, started from
  the sign-in's name; then Name your Tailzu, which marks the account onboarded) → Bots. Both are OnboardStages with a `BlipSpot` per
  step, so the apps draw **one Blip** walking across all of them, through the gate's swap (the phone's BlipHost, the window's
  blip.js walker), as the old onboarding does. Language, Turn on Keybot, First words and Plans are pages reached from the app.
  After it, Bots and Keybot carry two cards while something is missing: "Turn on full access" (the keyboard; one button to its
  settings) and "Let Keybot hear you" (the microphone; asks, then opens First words), drawn from what the app writes into the
  screen's state (`keyboardEnabled`, `keyboardReady`, `micGranted`). A window shows its Accessibility card (`DeskAskSetup`) and the
  microphone card (`DeskMicAsk`) only where it declares them.
* **Existing screens stay reachable** by their ids: `settings`, `keyboard`/keyboard settings, `history`, `paywall`, `personality`…
  and in a window the desk's `desk_today`, `desk_notes`, `desk_settings` (the sidebar links Today, Meeting notes and Settings to them).
  They draw as today, with the app's own chrome.

## 2. Where things are

| | |
| --- | --- |
| `tulmi/src/experience/bots/kit.ts` | theme + one helper per design primitive (section 5). Builders import only this. |
| `…/bots/glyphs.ts` | line icons, status marks, the Tailzu mark, the living tab icons |
| `…/bots/palette.ts` | greys (`C`), bot colours, each bot's look (colour, icon, head) |
| `…/bots/art.ts` | Blip heads (PNGs in `tulmi/blip/bots`, served at `/blip/bots/`) and which animated loop plays each pose (`blipLoopFor`; the loops are the onboarding's, `experience/blipLoops.ts`) |
| `…/bots/ids.ts` | **every screen id** (`SCREENS`), mapped to its boards and its file; `botRoute(slug)` |
| `…/bots/live.ts` | the live state every screen gets (`ctx.live`), `BotsDeps` |
| `…/bots/deps.ts` | the real `BotsDeps` (server.ts builds one per request) |
| `…/bots/registry.ts` | `screen({ id, load?, build })` |
| `…/bots/screens/{shell,you,bots,keybot,code,firstRun}.ts` | **the screens, one file per area: yours** |
| `…/bots/index.ts` | joins the screen files, bootstrap nav, the switch, `buildBotsScreen` |
| `…/bots/fixtures.ts` | fake deps and the boards' sample day (Aanya), for tests and the render check |
| `…/bots/lint.ts` | `lintTree(root)`: the kit's rules as a check |
| `tulmi/scripts/bots-render/render.ts` | the render check (section 7) |
| `tulmi/scripts/bots-render/preview.ts` | the live preview: every screen, clickable, in both renderers, as static files (section 7) |

## 3. Adding a screen

1. Find its id in `ids.ts` (`SCREENS.budget` is `bots.budget`, boards Budget / DBudget, file `screens/you.ts`). Link to screens only
   through `SCREENS` and `botRoute()`. An id with no screen yet answers an "on its way" page, never a 404.
2. Add it to your area's list (that file is yours; nothing else changes):

```ts
// screens/you.ts
import { listCard, listRow, meter, page, rupees, SCREENS, title, type BotsCtx } from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

/** GET /v1/code/jobs, as much of it as this screen reads. */
interface Jobs { jobs: Array<{ id: string; task: string; spentPaise: number }> }

function budget(ctx: BotsCtx, data: Jobs | undefined) {
  const { monthPaise, budgetPaise } = ctx.live.spend;
  const biggest = (data?.jobs ?? []).filter((j) => j.spentPaise > 0).sort((a, b) => b.spentPaise - a.spentPaise).slice(0, 3);
  return page(ctx, {
    back: true, nav: "you", title: "Budget",
    body: [
      title("Budget"),
      meter(monthPaise, budgetPaise, { label: "This month", valueText: `${rupees(monthPaise)} of ${rupees(budgetPaise)}` }),
      listCard(biggest.map((j) => listRow({ label: j.task, value: rupees(j.spentPaise) })), { title: "Biggest jobs" }),
    ],
  });
}

export const youScreens: BotsScreen[] = [
  screen<Jobs>({ id: SCREENS.budget, load: (_ctx, deps) => deps.api<Jobs>("GET", "/v1/code/jobs"), build: budget }),
];
```

3. **One id serves both clients.** `page(ctx, …)` draws the phone frame (safe area, scrolling body, footer, tab bar when `tab` is
   set) or the window's (sidebar, a main column at most 880 wide, footer at its foot). Branch on `ctx.client` only where the boards
   differ (bots.home does: `homePhone` / `homeDesk` in screens/shell.ts, **the reference screen: copy its shape**).
4. A **top-level** page sets `tab: "bots" | "activity" | "you"`; a pushed page sets `back: true` (and `nav:` to light a sidebar item:
   a bot's slug, `make`, `today`, `notes`, `computer`, `settings`).
5. Test it (section 6) and look at it (section 7).

## 4. Data and actions

**`ctx.live`** (no read of yours needed): `bots` (needs-you first, then working, then the built-ins, then the person's own; each with
`color`, `icon`, `head`, `state`, `working`, `needs`, `doing`), `needs` (each with its question and ready `choices`: label, kind,
action), `working`, `week` (`done`, `minutesSaved`), `spend` (`monthPaise`, `budgetPaise`), `tab` (what the tab icons show),
`greeting`. It comes from GET /v1/bots's list (the four built-ins when BOTS is off), the Code bot's jobs (with the agent's waiting
question), connected-app tasks, history stats; see live.ts's header.

**Your own reads go in `load`**, through `deps.api(method, path, body?)`: the app's own routes, in-process, as the signed-in person
(GET /v1/bots/:slug, /v1/bots/:slug/memory, /v1/code/jobs/:id, /v1/code/projects, /v1/tasks, /v1/connectors…, see docs/bots.md,
docs/code-*.md). `load` failing draws the screen with `data === undefined`: draw the honest empty state, never a fake number.
Builders stay pure: no clock (use `ctx.live.now`), no I/O.

**Actions** are plain SDUI actions; the kit has `open(id, params)`, `back()`, `toTab(tab)`, `call(method, path, body, { ok, fail,
assignTo })`, `seq(...)`, `botRoute(slug)`. Conventions: a write is `call(...)` then `{ kind: "refresh" }` (the window also refetches on
its own after a write) and a short ink toast; errors are a toast in plain words ("Couldn't send that. Try again."). State lives in
`page({ state })` and is read with `"$state.x"` in bodies, paths and navigate params on both clients. Money: "you press pay", never
an automatic charge.

## 5. The kit

`import { … } from "../kit.js"`. Every helper returns nodes; nothing reads data.

| Helper | What |
| --- | --- |
| `page(ctx, opts)` / `phonePage` / `deskPage` | the screen: frame, tab bar or sidebar, `back`, `body`, `footer`, `state`, `actions`, `gap`, `maxWidth` |
| `comingSoon(ctx)` | the "on its way" page |
| `text(s, { size, weight, color, mono, lineHeight, tracking, upper, align, lines, bind, onPress })` | any text (Geist face per weight) |
| `title` · `heading` · `sectionLabel` · `body` · `meta` · `bigNumber` · `mono` | type roles: 26/700 · 20/600 · 11/600 caps · 15 · 12 grey · 34/700 · Geist Mono 12 on grey |
| `row` · `col` · `box` · `grow` · `gap(h)` · `divider()` · `grid(children, columns)` | layout |
| `when(cond, node)` · `whenEq(path, value, then, else)` | show by state; a style value that follows state |
| `card(children, { padding, gap, onPress, dashed, selected, direction })` | 1px #e6e6e6, radius 20 |
| `listCard(rows, { title })` · `listRow({ label, value, sub, left, right, chevron, onPress, strong })` | settings-style lists |
| `button(label, onPress, { kind, size, icon, wide })` · `primaryButton` · `secondaryButton` · `quietButton` · `roundButton(icon, onPress)` | pills: 54 (lg) or 44 (md); one primary per screen |
| `chip(label, { selected, onPress, dashed })` · `chips(options, path)` · `segmented(options, path)` | choices into state |
| `switchRow(label, path, { sub, onChange })` · `switchMark(path)` · `stepper(value, onMinus, onPlus)` | settings controls |
| `backBar({ title, onBack, right })` | 44 x 44 chevron |
| `statusMark("working" \| "needs" \| "done" \| "waiting" \| "failed", { color, size })` | the five marks |
| `botAvatar(look, size)` · `botChip(bot)` · `botTile(bot, { idle, onPress })` · `makeBotTile()` · `botLine(bot, idle)` | bot identity |
| `meter(value, max, { label, valueText, segments })` · `stages(names, current, color)` | spend, progress |
| `timeline(items)` | bead timeline: each row's bead is its status mark |
| `table(columns, rows)` | the window's tables |
| `needsCard(item, { layout })` · `needsLabel` · `choiceRow` | a decision, one tap |
| `askBar(client)` · `askAction(client)` | "Ask any bot…": sends to POST /v1/ask, opens bots.ask with the answer |
| `emptyState({ pose, title, body, action })` · `blip(pose, height)` · `notice(text, { ink, mark })` · `infoChip(text)` | moments and states |
| `icon(name, { size, color, weight })` · `shapes(list)` · `tailzuMark(size)` · `tabGlyph(tab, active, live.tab)` | glyphs (ICONS lists the names) |
| `tabBar(active, live)` · `sidebar(ctx, active)` | the frames' chrome (page() adds them) |
| `rupees(paise)` · `duration(minutes)` | "₹6.40", "2 h" |
| `C` · `PALETTE_HEX` · `botLook(slug, colour)` · `FACE` · `SPACE` · `RADIUS` · `BOTS_THEME` | tokens |

Bot colours are by slug for the built-ins (Code moss, Keybot clay, Plan ochre, Travel sea, per the design) and by palette name for a
person's own. Note `src/bots/builtin.ts` gives the built-ins other palette names; the app follows the design.

Missing a primitive? Write it in your screen file first. If two areas need it, add it to kit.ts **additively** (a new export; never
change what an existing helper draws) and run the kit tests.

## 6. Tests

`tulmi/tests/bots-app-kit.test.ts`, `bots-app-home.test.ts`, `bots-app-boot.test.ts` are the pattern. For a screen:

```ts
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { fakeDeps, IST } from "../src/experience/bots/fixtures.js";
import { lintTree, walk } from "../src/experience/bots/lint.js";

const s = await buildBotsScreen({ screenId: "bots.budget", client: "phone", tzOffsetMinutes: IST, user: { id: "u" },
  can: new Set(["BotsKit"]), desk: { pages: false, notes: false } }, fakeDeps({ api: { "GET /v1/code/jobs": { jobs: [] } } }));
expect(lintTree(s.root!)).toEqual([]);
expect(walk(s.root!).some((n) => n.props?.content === "Budget")).toBe(true);
```

`fakeDeps({ bots, jobs, tasks, minutesSaved, budgetPaise, now, api, calls })` answers from memory (`calls` records every api call);
`sampleLive()` and `ctxFor(id, client)` hand a builder its ctx directly. bots-app-home.test.ts already builds **every registered
screen for both clients** and lints it, so a new screen is covered the moment it is registered.

Run: `cd tulmi && npx vitest run tests/bots-app-*.test.ts && npx tsc --noEmit`. Phone: `cd TAILZU-FRONTEND/app && npx tsc --noEmit`.
Window: `cd TAILZU-DESKTOP && node --test bots.test.js sdui.test.js`. Not tulmi/e2e.

## 7. The render check

```
cd tulmi && npx tsx scripts/bots-render/render.ts bots.home --board Main --desk-board DeskHome
```

Builds the screen with the fixtures, draws it with **the apps' own renderers** (the window: app.html + sdui.js in Chromium at
1280 x 800; the phone: its sdui renderer through react-native-web at 390 x 844 with a 12 pt status bar inset) and the boards beside
them. Look at `scripts/bots-render/out/<id>.<client>.compare.png`. Options: `--client phone|desktop`, `--params '{"slug":"plan"}'`,
`--quiet` (nothing working or waiting), `--api '{"GET /v1/…": {…}}'` (answers for your `load`), `--json served.json` (draw a screen a
running server sent), `--motion` (default is Reduce Motion, so shots are stable), `--design <bots-design dir>` (or `$BOTS_DESIGN`).
First run installs react-native-web, react-dom and esbuild into `scripts/bots-render/.deps` (gitignored). The phone's native-only
modules are stubbed; text is set by the browser, so a line may break a word apart from a device. Boards: `bots-design/project`.
Blip (`blip(pose)`) is an animated WebP, which Reduce Motion does not stop, so two shots of a screen with him can differ.

**The live preview**, to click through the whole app as it will look and move:

```
cd tulmi && npx tsx scripts/bots-render/preview.ts         # writes scripts/bots-render/out/preview/ (about 60 files, 12 MB)
npx tsx scripts/bots-render/preview/serve.ts               # try it: http://localhost:8787, under an Artifact's content policy
```

It builds the bootstrap and every sample screen on both clients, then every screen they link to (at most `--max`, 300, a client),
and writes them with the real renderers (the phone's through react-native-web with a navigator, `phone/preview.jsx`; the window's
app.html + sdui.js) and a stand-in API (`preview/shim.js`) that answers from those files. Motions run. `index.html` has no
doctype or head: it is made to be published as a claude.ai Artifact with the rest of the folder.

## 8. The node types the kit adds

No new node types: the design is expressed with core types plus four extensions, promised by the `BotsKit` capability
(shared/types/sdui.ts, "The Bots app's kit"; phone types.ts mirror; desktop sdui.js):

* **`SVG.shapes`** (`SvgShape[]`): circles and paths with their own paint, `rotate`, and motions `breathe` (loops), `pop`, `draw`
  (once, with `delayMs`). Phone: `src/sdui/SvgShapes.tsx`; window: `.tz-work/.tz-pop/.tz-draw` in app.html. Reduce Motion stops all.
* **`SafeArea.edges` / `inset: "add" | "max"` / `barStyle`**: safe-area insets and the status bar's colour (phone; the window ignores).
* **`TextField on.onSubmit`**: return / Enter.
* **`Text bind.content`** in the window, and `numberOfLines`; **`navigate` params** resolve `$state.x` in the window.
* `ScreenResponse.look: "bots"`: the window treats a border width as a solid border on these pages (as the phone does).

## 9. Rules, and what not to touch

* **Ids** `bots.<area>[.<thing>]`, lower case, hyphens: take them from `ids.ts`. **Files**: only your `screens/<area>.ts` (and tests).
* **Design**: STYLE.md is the law. White and ink; colour only for bots; status marks by shape; one primary per screen; real numbers
  from real records; short plain words, India-first (₹, Hinglish, Aanya). Phone boards are 390 x 844, desktop 1280 x 800 fluid.
* **Both clients**: build with the kit, keep `lintTree` clean: no pressable inside a pressable (the window runs both), images as
  `{ url }` in a sized box, text through `text()`. Never `Button`, `Card`, `Row`… (they look different on each client).
* **Do not edit** without the kit owner: `kit.ts` (additive only, see section 5), `live.ts`, `deps.ts`, `registry.ts`, `index.ts`,
  `ids.ts`, `glyphs.ts`, `palette.ts`, `server.ts`, `catalog.ts`, `shared/types/sdui.ts`, the phone and window renderers.
  **Never touch `tulmi/e2e`.**
* Known gaps: `bots.activity`, `bots.you` and the rest of `SCREENS` are not built yet; the monthly limit is `DEFAULT_MONTH_BUDGET_PAISE`
  (₹500) until the Budget screen stores one (`BotsDeps.budgetPaise`); spend counts Code bot jobs' `spentPaise` only; the name-and-gender
  card is asked in the first run (About you), so `profileGate.screenIds` is empty while someone is still in it; someone onboarded
  before that keeps the card on `personality` / `home`.
