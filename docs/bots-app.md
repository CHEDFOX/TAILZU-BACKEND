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
* [10. Live updates](#10-live-updates)
* [11. The calendar and to-dos](#11-the-calendar-and-to-dos)
* [12. Usage, not money](#12-usage-not-money)
* [13. Looks and moments](#13-looks-and-moments)

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
  After it, the first time they land on Bots, **one card** comes up over a blurred Home (`arrivalCard`, firstRun.ts): the
  microphone (asked for real), then on the same card the keyboard (straight to its settings); allowed or refused, the mic moves it
  on; with both on, the bot's small happy moment and it closes. "Not now" closes it for good. It is due until answered
  (`GET`/`PUT /v1/bots/first-run/arrival`, personality `botsArrivalAt`) and decides only once the app's readings arrive (Home's
  state starts them as `null`: `keyboardEnabled`, `keyboardReady`, `micGranted`). Keybot carries the same card in the page for
  whatever is still missing (`keybotCard`), and none when all is on. A window asks for its microphone (`DeskMicAsk`) and shows
  Accessibility (`DeskAskSetup`) only where it declares them; one that declares `DeskAxState` also writes `axGranted` (the
  Mac's answer, true elsewhere), so the Accessibility step goes and the card closes on its own once it is on.
* **Signing in on a computer with the phone** (src/auth/deviceLink.ts, routes/deviceLink.ts, migration 0049): the window's
  sign-in draws a QR and a typed code (`DeskLinkSignIn`, desktop linkSignIn.js); the phone opens `bots.link` (its camera,
  or You › Link a computer) and approves; the window redeems a one-time sign-in, once.
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
| `…/bots/screens/planItem.ts` | Plan's add / change an event or a to-do (`bots.plan.item`), registered with bots.ts's list (section 11) |
| `…/bots/screens/safety.ts` | Reporting and blocking in Spaces (App Review 1.2): someone's page (`bots.person`), the report screen (`bots.report`), Blocked people (`bots.blocked`). Rules: `src/botsBots/{blocks,safety}.ts`; routes: `routes/safety.ts` (with the admin's `/v1/admin/reports`, the console's Reports tab); migration 0057 |
| `…/bots/screens/keybot{Stats,You,Parts}.ts` | Keybot's other pages: the old Stats tab's cards (month, day, apps, speak, days), the old You tab's Voice, Haptics and name pages, and Keybot's small parts and charts ([bots-keybot-parity.md](bots-keybot-parity.md)) |
| `…/bots/index.ts` | joins the screen files, bootstrap nav, the switch, `buildBotsScreen` |
| `…/bots/fixtures.ts` | fake deps and the boards' sample day (Aanya), for tests and the render check |
| `…/bots/lint.ts` | `lintTree(root)`: the kit's rules as a check |
| `tulmi/scripts/bots-render/render.ts` | the render check (section 7) |
| `tulmi/scripts/bots-render/preview.ts` | the live preview: every screen, clickable, in both renderers, as static files (section 7) |

## 3. Adding a screen

1. Find its id in `ids.ts` (`SCREENS.usage` is `bots.usage`, Budget's place, file `screens/you.ts`). Link to screens only
   through `SCREENS` and `botRoute()`. An id with no screen yet answers an "on its way" page, never a 404.
2. Add it to your area's list (that file is yours; nothing else changes):

```ts
// screens/you.ts
import { meta, page, title, usageMeter, whenWords, SCREENS, type BotsCtx } from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

/** GET /v1/you/usage, as much of it as this screen reads: shares used and when they reset, never an amount. */
interface Usage { usage: { stretch: { used: number; resetsAt: number }; month: { used: number } }; how: string }

function usage(ctx: BotsCtx, d: Usage | undefined) {
  const at = (t: number) => `Resets ${whenWords(t, ctx.live.now, ctx.tzOffsetMinutes)}`;
  return page(ctx, {
    back: true, nav: "you", title: "Usage",
    body: [
      title("Usage"),
      usageMeter("This stretch", d?.usage.stretch.used ?? ctx.live.usage.used, d ? { resets: at(d.usage.stretch.resetsAt) } : {}),
      ...(d ? [usageMeter("This month", d.usage.month.used), meta(d.how)] : []),
    ],
  });
}

export const youScreens: BotsScreen[] = [
  screen<Usage>({ id: SCREENS.usage, load: (_ctx, deps) => deps.api<Usage>("GET", "/v1/you/usage"), build: usage }),
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
action), `working`, `week` (`done`, `minutesSaved`), `usage` (the usage meter: `used` this stretch and `month` as fractions, `state`
ok / near / out, `resetsAt`, `windows`; section 12), `spend` (ours, never drawn), `tab` (what the tab icons show: the You ring is
`usage.used`), `greeting`. It comes from GET /v1/bots's list (the four built-ins when BOTS is off), the Code bot's jobs (with the agent's waiting
question), connected-app tasks, history stats; see live.ts's header.

**Your own reads go in `load`**, through `deps.api(method, path, body?)`: the app's own routes, in-process, as the signed-in person
(GET /v1/bots/:slug, /v1/bots/:slug/memory, /v1/code/jobs/:id, /v1/code/projects, /v1/tasks, /v1/connectors…, see docs/bots.md,
docs/code-*.md). `load` failing draws the screen with `data === undefined`: draw the honest empty state, never a fake number.
Builders stay pure: no clock (use `ctx.live.now`), no I/O.

**Actions** are plain SDUI actions; the kit has `open(id, params)`, `back()`, `toTab(tab)`, `call(method, path, body, { ok, fail,
assignTo })`, `seq(...)`, `botRoute(slug)`. Conventions: a write is `call(...)` then `{ kind: "refresh" }` (the window also refetches on
its own after a write) and a short ink toast; errors are a toast in plain words ("Couldn't send that. Try again."). State lives in
`page({ state })` and is read with `"$state.x"` in bodies, paths and navigate params on both clients. Money: "you press pay", never
an automatic charge, and **no amount on any screen** (section 12): not what Tailzu costs, not a price, not a payment's amount.

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
| `meter(value, max, { label, valueText, segments })` · `stages(names, current, color)` | progress |
| `usageMeter(label, used, { resets })` · `percent(used)` · `whenWords(at, now, tz)` | the usage meter: "This stretch · 64% used · Resets Thu 9 am" (section 12) |
| `timeline(items)` | bead timeline: each row's bead is its status mark |
| `table(columns, rows)` | the window's tables |
| `needsCard(item, { layout })` · `needsLabel` · `choiceRow` | a decision, one tap |
| `askBar(client)` · `askAction(client)` · `keptOffline(client, o, send)` | "Ask any bot…": sends to POST /v1/ask, opens bots.ask with the answer; offline, keeps the ask in the outbox instead |
| `emptyState({ pose, title, body, action })` · `blip(pose, height)` · `notice(text, { ink, mark })` · `infoChip(text)` | moments and states |
| `icon(name, { size, color, weight })` · `shapes(list)` · `tailzuMark(size)` · `tabGlyph(tab, active, live.tab)` | glyphs (ICONS lists the names) |
| `tabBar(active, live)` · `sidebar(ctx, active)` | the frames' chrome (page() adds them) |
| `duration(minutes)` | "2 h". There is no money helper: no screen shows an amount (section 12) |
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

const s = await buildBotsScreen({ screenId: "bots.usage", client: "phone", tzOffsetMinutes: IST, user: { id: "u" },
  can: new Set(["BotsKit"]), desk: { pages: false, notes: false } }, fakeDeps({ api: { "GET /v1/you/usage?tz=330": { usage, near: null, out: null, how: "" } } }));
expect(lintTree(s.root!)).toEqual([]);
expect(walk(s.root!).some((n) => n.props?.content === "Usage")).toBe(true);
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

**The living tiles** (a build that declares **`BotsMotion`**; `canMove(ctx)`): `botTiles(specs, { columns, height, padding, gap })`
draws Home's grid with a tiny Blip per tile playing on a faint ink fabric (Code juggles 0s and 1s, Keybot hops keycaps, Plan
stacks day tiles that topple, Travel chases a paper plane, Make a bot puts himself together from dots; anyone's own bot plays
ball); a tap makes the other bots look at it and fades their words before it opens. `botCard(steps, props)` is a card with one
such bot on top and its steps below (the permission cards). Both are physics, one core: the phone's
`src/botTiles/core.ts`, from which the window's `botTiles.js` is generated (`node src/botTiles/genDesktop.mjs`; tests on both
sides fail if they drift). Builds without it get `botTile` / `makeBotTile` and a plain card.

A tap's look never outlives its moment: leaving Home, coming back to it (`gridWorld` starts a grid released) and the
app or window coming back to the front all let it go. **`botBuddy` / `headerBuddy(ctx, slug, { lookTo, thinkWhen })`**
(component `BotBuddy`, `canBuddy`): a bot's own tiny bot on its pages, on a small stage of its own in the header (Code
bot, Keybot, Plan, Travel, a person's bot page and chat), busy when the bot works, facing you when it needs you,
glancing at the ask field (`lookTo`) and thinking while an answer comes (`thinkWhen`); kept by `life`, so the Code bot's
setup steps (bots.code.start meet, pick, read, home) are one bot in one place, waving, looking over the list, reading,
settling. **Home's header** (`writeOn`, `liveMark`, `headBar`, page `pinned`; components `WriteOn`, `LiveMark`, `HeadBar`,
`canHead`): the greeting, the old app's time-aware line written in by Keybot's caret, the living Tailzu mark (a dot lit
per working bot, a tap opens Ask) and a compact bar once the header has scrolled away. Older builds get them still.

**The moment an ask is out** (`askMoment.ts`: `askMoment`, `start`, `streamed`, `failed`; `canCarry` = BotBuddy + `BotBuddyCarry`,
`canStream` = `AskStream`), in the Code bot's project chat and task bar, every bot's chat, Ask and Home's ask bar: the words go up at
once as the person's bubble (state `sent`) and the box clears; under it a full-width lane (BotBuddy, no `width`, 68 tall) where the
chat's bot (its colour and look; Tailzu's ink in Ask) carries the ask as a bag (act `carry`): in from the right a moment later,
slowly across, out at the left, again with a heavier one (bigger, fuller, leaning, slower, a deeper bob; sweat from the fourth
trip; the heaviest from the sixth on), every trip on the act's own clock (core.ts `CARRY`). Under him what he is really doing, from
the server's own steps (`reply.step`: "Reading the project…", "Looking at cart.ts…", "Writing it up…"), and Stop. The answer is
written in as it comes (`reply.text`, callEndpoint `stream`): the first words are `doneWhen`, so he sets the bag down and walks off and
the lane folds away. What happens once the answer is whole is the chat's own, as before. Stop (POST /v1/ask/stop) keeps what was
written, marked Stopped; a failure puts the words back in the box. Reduce Motion: he stands still with the bag, "Working on it…"
beside him. A build without BotBuddyCarry gets today's "Asking…" line; without AskStream, no step line, no Stop, the answer whole.
**An answer as it is written** (shared/types/sdui.ts 3f, `src/live/askStream.ts`): with a `streamId` in the body, POST /v1/ask and
POST /v1/botsapp/bots/chat/:slug stream the model's words (the gateway's `onText`) to the asker over the live channel, topic
`ask:<id>`, whole words at a time (never half a Devanagari word or an emoji), numbered; nothing more once they look like a secret.
The answer is still kept and returned exactly as before; a stopped stream is charged for what it used.


No new node types: the design is expressed with core types plus four extensions, promised by the `BotsKit` capability
(shared/types/sdui.ts, "The Bots app's kit"; phone types.ts mirror; desktop sdui.js):

* **`SVG.shapes`** (`SvgShape[]`): circles and paths with their own paint, `rotate`, and motions `breathe` (loops), `pop`, `draw`
  (once, with `delayMs`). Phone: `src/sdui/SvgShapes.tsx`; window: `.tz-work/.tz-pop/.tz-draw` in app.html. Reduce Motion stops all.
* **`SafeArea.edges` / `inset: "add" | "max"` / `barStyle`**: safe-area insets and the status bar's colour (phone; the window ignores).
* **`TextField on.onSubmit`**: return / Enter.
* **`Text bind.content`** in the window, and `numberOfLines`; **`navigate` params** resolve `$state.x` in the window.
* `ScreenResponse.look: "bots"`: the window treats a border width as a solid border on these pages (as the phone does).

**Media** (shared/types/sdui.ts section 3d; parts in `bots/media.ts`): three actions, each declared by name in
`capabilities.components`, none a node, so `lintTree` is unchanged. **FileUpload** `uploadFile` (pick a photo, a screenshot,
a video or any file, send it to POST /v1/files with progress in `up`, the answer in `sent`): Ask's Photo / File / Screen and
Add to chat's pickers. **VoiceRecord** `recordVoice` (the phone: the mic into a field through /v1/transcribe-clean, `voice`
and `level` in state): Ask's mic. **AudioPlay** `playAudio` / `stopAudio` (one sound at a time, `playing` in state, stopped
when the screen goes): the voices' samples (GET /v1/keybot/voices/:id/sample). A build without one keeps the screen as before.
A bar that follows state is plain boxes (`stateBar`): each segment's colour is `{ gte: [path, n], then, else }`.

**Live views** (shared/types/sdui.ts section 3e; kit `liveView`, `canLive`): **LiveView** is a node (in `KIT_TYPES`), a running
web page or artifact in a sandbox of its own: the phone's `LiveView.tsx` (a WebView, `incognito`), the window's `liveView.js`
(a `<webview>` in the in-memory session `tz-live`, locked down by `liveViewMain.js`; never the app's origin). From `url` (http,
https, data:, about: only) or `html` the server wrote, run as `origin`; it stays on its page, has no popups, downloads or
permissions, and offers a link that leaves only with `allowPopups` and the person's yes. Loading and error states ("Try again")
are the app's own; `{ t: "ready" }` ends the wait when `waitForReady`. What the page posts goes to `messagePath` and
`on.onResult` (untrusted data); `send`, bound to state, reaches the page's `window.tzLive`. The Code bot's Design and Live
preview (`bots.code.design`, `bots.code.preview`) run the artifact this way: GET /v1/artifacts/:id/live answers the host page
(src/artifacts/livehost.ts: the app's viewer framed, `ARTIFACT_VIEWER_URL`, run as `ARTIFACT_APP_ORIGIN`, which must be in that
viewer's VIEWER_PARENT_ORIGINS). A tap in "Point to change" picks the part into `sel` / `selName` (as the drawn parts do), "Use
it" switches that off without a reload (`liveSend.pick`), and an error the viewer reports goes to POST /v1/artifacts/:id/errors.
No viewer set, or a build without LiveView: the artifact's parts, as before.

**Offline** (section 3e; `bots/screens/outbox.ts`): a build that declares **Outbox** keeps an outbox (the phone's
`offline.tsx` + `outboxCore.ts`, the window's `outbox.js`) and puts `online`, `outbox` (each ask's `id`, `label`, `sub`, `state`,
`typedAt`) and `outboxWaiting` in every screen's state. The `outbox` action (kit `keepAsk`) keeps an ask with its own client id
and when it was typed; once online the asks go in order to POST /v1/shell/ask with `clientId` and `typedAt`, which answers an id
ONCE (src/shell/sentAsks.ts, migration 0047): a retry gets the first answer, one still out is 409. The bootstrap's flags
(`BOTS_OFFLINE_FLAGS`) say what happens when the connection drops: Home (`offline.roots`) is shown as `bots.offline` (kept for a
day, `cacheTtlSeconds`, so it can be drawn without a connection) and comes back when it returns; any other screen gets the line
`offline.bar`; `offline.sentToast` once kept asks went. The Offline screen lists the asks with their state (Waiting to send,
Sending…, Sent, Couldn't send · Try again; the window's Edit and Cancel), and Home shows them going out once it is back. Every ask
bar keeps an ask the same way while `online` is false (kit `keptOffline`: the ask bar, Ask's own send, the Code bot's "Tell Code bot
what to do"), clears the field and says "Kept. It will send when you're back."; online, it sends as before.

## 9. Rules, and what not to touch

* **Ids** `bots.<area>[.<thing>]`, lower case, hyphens: take them from `ids.ts`. **Files**: only your `screens/<area>.ts` (and tests).
* **Design**: STYLE.md is the law. White and ink; colour only for bots; status marks by shape; one primary per screen; real numbers
  from real records; short plain words, India-first (Hinglish, Aanya); no money (section 12). Phone boards are 390 x 844, desktop 1280 x 800 fluid.
* **Both clients**: build with the kit, keep `lintTree` clean: no pressable inside a pressable (the window runs both), images as
  `{ url }` in a sized box, text through `text()`. Never `Button`, `Card`, `Row`… (they look different on each client).
* **Do not edit** without the kit owner: `kit.ts` (additive only, see section 5), `live.ts`, `deps.ts`, `registry.ts`, `index.ts`,
  `ids.ts`, `glyphs.ts`, `palette.ts`, `server.ts`, `catalog.ts`, `shared/types/sdui.ts`, the phone and window renderers.
  **Never touch `tulmi/e2e`.**
* Known gaps: a job's spend counts on the day it was last worked on, whole (a job that runs across two stretches counts in the later);
  the name-and-gender card is asked in the first run (About you), so `profileGate.screenIds` is empty in the Bots app; someone onboarded
  before that, with no gender, is asked by `bots.name-it` itself (the bootstrap's `promptScreenId`, over Home after a pause), which for an
  onboarded account is About you alone and closes once saved.

## 10. Live updates

A change made on one device shows on the other's open screen within about a second.

* **The channel**: `WS /v1/live` (`tulmi/src/routes/live.ts`). Signed in by the first message `{ type: "auth", token }` (or the
  upgrade's `Authorization`), never a token in the URL; then `{ type: "event", topic, at }` for every change of that person's,
  pings both ways every 25 s, at most 8 sockets a person (the oldest goes, 4008), renewed every 30 min (4000). One process holds
  every socket; for several, give `live.setRelay` (`src/live/bus.ts`) a Postgres LISTEN/NOTIFY or Redis fan-out to `bus.deliver`.
* **An answer's words** (`ask:<id>`, `src/live/askStream.ts`): the one topic whose `data` is content, not a hint: the words of an
  answer as they are written, to the person who asked, under the id their asking screen made. The apps hand it to the call that is
  listening (the phone's `askStream.ts`, the window's `askStreamTake`) and never reload for it.
* **Topics** (`src/live/topics.ts`, both tables in one place): `home`, `bots`, `bot:<slug>`, `activity`, `tasks`, `calendar`, `code`,
  `job:<id>`, `notes`, `note:<id>`, `keybot`, `you`; Spaces and messaging name their own (`space:<id>`, `thread:<id>`, `threads`), and
  the calendar publishes its own (`calendar`, `tasks`, `bot:plan`) from wherever it changes (section 11).
* **Publishing**: a 2xx write over HTTP publishes its route's topics after the response (`installLiveWrites`, an onResponse hook,
  `topicsForWrite`); writes away from a request publish where they happen: the Code bot's job store (`liveJobStore`), meeting notes
  (`notes/store.ts`), dictation history. `livePublish(userId, topics)` from anywhere else; bursts are folded into one event.
  A new write route: add it to `topicsForWrite`.
* **Screens**: every Bots app screen gets its default topics from `topicsForScreen` (added in `buildBotsScreen`); `page(ctx, { live })`
  adds more. A live session, a training run and the first run have none.
* **The apps**: the phone (`app/src/sdui/live.ts`, rules in `liveCore.ts`) and the window (`live.js`) keep one socket while signed in
  and in front, reconnect with backoff, and reload the screen on show quietly when it hears the topic: no spinner, scroll and focus
  kept, the new state written over the old except what was typed on that screen since it loaded, never while the person is typing,
  one reload per burst (300 ms). Back in front, the screen on show reloads once. Knobs: `live.enabled`, `live.path`,
  `live.debounceMs`, `live.typingQuietMs`.

## 11. The calendar and to-dos

Tailzu keeps each person's own calendar and to-do list (`tulmi/src/calendar`, migration `0054_own_calendar.sql`). Nothing is connected:
the Bots app no longer reads or offers Google Calendar or Google Tasks.

* **The store** (`calendar/store.ts`, `service.ts`): events (what, start and end or all day, place, notes, repeat daily / weekdays /
  weekly / monthly / yearly with an until and days taken out, a reminder in minutes before) and to-dos (what, notes, a list, a due day
  and time, done). Each has a `source`: the person, a bot (`"Plan bot"`), someone in a space (theirs to change: the person ticks it or
  says they can't), or a meeting's to-do. Times are on the person's clock (`tz_min`); `words.ts` reads a line ("Dentist Fri 5 pm at
  Indiranagar", "remind me to call Nani at 6", "kal subah 7 baje gym"). Memory when there is no Supabase.
* **Routes** (`routes/botsCalendar.ts`, registered by botsBots.ts): `GET /v1/botsapp/calendar?from=&to=&tz=`, `…/events[/:id]` and
  `…/tasks[/:id]` (POST, PUT, DELETE; a task's `PUT { done }` ticks it), `POST …/quick { words }`, `POST …/cant/:id` (a space's), and
  `…/notes/:noteId[/:todoId]` (a meeting's to-dos on the list). `GET /v1/botsapp/bots/plan` reads the same store (`calendarPlanReader`).
* **Screens**: Plan (`bots.plan`, bots.ts) shows the person's days with nothing to connect: the phone has a week strip (`week`, `day`
  params; a reminder's tap opens its day) and the day's timeline; the window the week. Each event and to-do opens `bots.plan.item`
  (screens/planItem.ts: add, change, take out, a series' one day; someone else's shows Done and Can't do it), a to-do's ring ticks it.
  Today's calendar and Tasks' Upcoming (routes/botsShell.ts) read it too; a meeting's to-do has "Add to my tasks" (screens/notes.ts).
* **Bots** (`calendar/bots.ts`): "calendar" and "tasks" are two apps every bot can be given, always on (`withOwnDays`, wired in
  bots/wire.ts over the connected apps). The Plan bot has both, so "add dentist Friday 5 pm" in Ask or its chat adds it (Ask picks the
  Plan bot by the calendar job, bots/door.ts). A bot made with the old ids (`google-calendar`, `google-tasks`) gets these.
* **Spaces** (`botsBots/spaceTasks.ts`): a task or a plan given to someone lands on their own days, "From <name>", for everyone; their
  tick there is Done in the space, "Can't do it" (there or here) takes it off, taken out of the space it goes.
* **Reminders**: every minute the due ones go through the push engine as `plan_reminder` (push/defaults.ts; You's "What pings you":
  sent, quietly in quiet hours, not with Plan bot off), claimed by moving the next one on, so two servers never send one twice.
* **Not offered any more**: Google Calendar and Google Tasks in You › Connected apps (shown only to switch one off if it was
  connected), the Plan, Today and Tasks prompts, Make a bot's and a bot's Edit list. Their connectors (`src/connectors/google/calendar.ts`,
  `tasks.ts`) and the old app's routes are left as they were; other Google apps (Docs for meeting notes, Sheets, Forms, Classroom) are unchanged.

## 12. Usage, not money

**No screen shows money**: not what Tailzu costs to run, not a hotel's price, not a payment request's amount, not a subscription's price.
The one exception is the **purchase screen** (the Bots app's Plans, `bots.plans` in screens/firstRun.ts; the old app's paywall; the
window's `desk_plan`; the web checkout), where Apple (App Review 3.1.2) and Google Play require the price and its period before someone
buys: there the store's (or Razorpay's) price, the renewal ("Renews automatically until you cancel") and Terms and Privacy are shown.
Everything else leads there, by what a plan gives.

Instead the person sees a **usage meter**, the way Claude shows it. What is counted is what always was (src/you/spend.ts, the brain's
gateway, you_spend, usage_events): the Code bot's jobs, every bot's answers (and so Ask's), Keybot's words at
`USAGE_KEYBOT_PAISE_PER_1000_WORDS`. It stays ours, in paise, for the logs and the admin.

* **The limits** are ours, per plan, in config.ts: `USAGE_FREE_MONTH_PAISE` (5,000), `USAGE_PAID_MONTH_PAISE` (50,000), `USAGE_TIERS`
  (`{"<entitlement id>": paise}` for a paid tier of its own), `USAGE_FREE_WINDOWS` (false), `USAGE_CARRY_OVER` (false), `USAGE_NEAR`
  (0.8), `USAGE_LIMITS` (true; false shows the meter and refuses nothing). While `FREE_FOR_ALL` is on everyone has the paid month and
  nothing is offered to buy.
* **The stretches** (src/you/usage.ts): a paid month is used in five, days 1–4, 5–9, 10–15, 16–22 and 23 to the end (8 days in a 30-day
  month, fewer in February). Each may use the month's limit × its days / the month's days; what it did not use is gone when it ends
  unless `USAGE_CARRY_OVER`. The month is the billing cycle when billing has one (the entitlement's period end: its day and time, month
  after month), else the calendar month on the person's clock. A free plan is one stretch, the month.
* **The one answer**: `Spending.usage(userId)` (src/you/limits.ts) gives the stretch and the month as fractions used, when each resets,
  near (from 80%) or out. `GET /v1/you/usage` serves it to the Usage page with the lines to show (`near`, `out`, `how`); `GET /v1/you/live`
  to every screen (`ctx.live.usage`, the You tab's ring).
* **Where it is kept**: a new Code bot job's budget, and "Keep going" (`/budget`, a part's `/rerun`), are held to what is left of the
  stretch (`holdJobsToUsage`); a bot's answer (`wrapBots`: Bots.ask / test / askWithKey, so Ask's too); Keybot, the old Ask and the
  front door through `metering.enforceQuota` (`setUsageGate`). Out of allowance is 429 `{ code: "quota_exceeded", reason: "usage_limit",
  message: "You've reached this stretch's limit. It resets Thu 9 am.", resetsAt, upgrade }`; the apps open the bootstrap's
  `quota.screenId`, which in the Bots app is `bots.usage`. The keyboard's stop screen (`words_out`) says the same when it was the meter.
* **The screens**: Usage (`bots.usage`, and `bots.budget` for older links): "This stretch · 64% used · Resets Thu 9 am", "This month ·
  40% used", which stretch of five, how they work; near the limit a calm line ("You've used most of this stretch. It resets Thu."), at it
  the sentence and, when a plan is for sale, "Get more with a plan" (opens Plans, whose buttons open the store's own sheet). You, Billing
  and Settings show the meter's share; the Code bot's home the near / at line; a job asks "This job has used a lot of this stretch. Keep
  going?" and shows how much of what it was given it used, as a share. Project rules' "Checks with you" (Often, Sometimes, Rarely) sets
  how much of the stretch a job may use before it asks.
* **Payments** (a space's requests; Approve, where a bot's UPI hand-off lands): what it is for, who asks, approve or decline. The UPI link
  opens without an amount (`am` is optional, shell/parse.ts `upiOf` drops it): the person types it in their UPI app (migration 0055 lets
  a request carry none). The hand-off tool itself (connectors/handoffs) still takes the amount the person said, for the old app.
* **Travel**: stays are compared by area, distance and rating (no "Cheaper"), with a link to see prices on the booking site.

## 13. Looks and moments

What the bots look like (**avatars**) and what they do (**moments**) are data on the server, drawn and played by the apps' one
physics core (`TAILZU-FRONTEND/app/src/botTiles/core.ts`; the window's `botTiles.js` is generated from it). A new look or a new
moment needs no app update: change the catalog, and every app with the `BotMoments` capability takes it at its next start.

| | |
| --- | --- |
| `shared/bots/looks.json` | **the catalog**: `parts`, `avatars`, `moments`, `kinds` (which avatar each kind wears), `idle` (Home's surprises), `v` |
| `tulmi/src/experience/bots/looks.ts` | `checkLooks` (the apps' rules), `activeLooks`, `pushLooks`, `looksFlags`, `momentProps`, `idleSurprises` |
| `tulmi/src/routes/botLooks.ts` | `GET /v1/bots/looks`; `PUT` / `DELETE /v1/admin/bots/looks` (ADMIN_SECRET) |
| kit | `canMoments(ctx)`, `botMoment(ctx, id, mode?)`, `homeSurprises(ctx)`; `botTiles(…, { surprises })` |
| apps | phone `src/botTiles/looks.ts` (+ `looksStore.ts`, `starter.ts`), window `sdui.js` `btLooks()` (+ `botLooks.js`) |

**Avatars.** A look from parts, sizes in his head's radius (head, eyes, mouth, ears, antennae's places) or in bot heights (the rest):
`head` { shape round / oval / square, size, w, h, round }, `eyes` { style one / two / dots / visor / none, size, gap, pupil, y },
`mouth` { style none / line / smile / o / open, size, y }, `antennae` (up to 2: at, up, lean, len, tipLen, bend, tip ball / light /
star / none, tipSize), `ears` { style none / round / bolt / point, size }, `dots` { pattern hex / grid / none, spacing, size, alpha },
`body` { top, bottom, round }, `limbs` { arm, leg, neck, hand, antenna }, `paint` { body, dots, eye, pupil, mouth, light, ears } and
`wear` (up to 6: a part `on` an anchor, x, y, scale, rot, paint, back). `extends` another avatar; its own fields win, lists are whole.
Every kind wears its own copy of `blip`, whose values are exactly what the core drew before: the phone's tests check today's frames and
drawing are unchanged, call for call. A node takes `avatar` as an id or a spec of its own (over Blip); none: its kind's.

**Moments.** A recipe: `dur` (seconds), `mode` once / loop, `loopFrom` (what is before plays once: a yawn before the sleep), `bpm`
(`beat`), `still` (Reduce Motion's pose), `fallback` (the plain act for a build that cannot play it), `react` (only others play it),
`tracks`, and `end` { dur, tracks } (played on deliver, or a screen's `momentEndWhen`). A track has `do`, `at`, `to` (none: to the end;
an instant fires once at `at`), `after` (its times count from an event), `if` alone / paired, `chance` (per play), and its own fields.
Numbers may be expressions in the mic program's language (motionLang.ts; names `t u T D beat k side rnd rnd2 W x px`, its built-ins
and `sign tri hash`). Every track sets a goal or a force for the physics, never a pose:

* body: `walk` (x of the stage, dx from where he began, or toward peer / away / center / left / right / start), `hop` (h, dx),
  `crouch`, `sit`, `lean`, `tilt`, `spin` (rate), `shake` (amp, freq, part), `kick` (an impulse on head / body / all / hands / feet);
* hands: `arm` (front / back / l / r / both to x, y from neck / head / hip / crown / face / body; at the face it is drawn over his head);
* eyes and looks: `look` (screen, peer, away, point, around, down, up, ahead, drop, last, hand), `face`, `eyes` (rest, open, closed,
  half, squint, wide, x, happy, spiral), `mouth` (rest, none, line, smile, open, o, wide, wavy), `lid`, `blink`, `glow`;
* things: `prop` (a part on an anchor while the track lasts; it pops), `emit` (particles: part or parts, from, n, every, vx, vy,
  spread, g, drag, life, size, grow, spin, paint `$any`, floor; thrown to a hand with `aim`, `flight`, `alt`, `miss` → `onMiss` event,
  `pause`; circling with `orbit`), `fabric` (a ripple);
* others: `others` (the nearest `n` bots within `near` play a moment, with him as their partner: lean away, look, laugh, cheer, a high
  five's other hand), `event` (fires a name), `sound` (a name; the app plays it if it has it), `act` (one of today's acts inside a recipe).

**Parts.** `draw`: up to 12 shapes, each a path `d` (M, L, Q, Z and O cx cy r; bot heights, x forward, y down) with `fill` / `stroke`
(`$color` the bot's, `$paint` the wearer's or emitter's, ink, paper, #rrggbb), `width`, `alpha`.

**How it reaches the apps.** The Bots app's bootstrap carries `"bots.looks": { v, url }`; an app whose catalog is another `v` fetches
`GET /v1/bots/looks`, compiles it (one with an error is refused) and keeps it (AsyncStorage / localStorage). Both apps ship a starter
copy (phone `src/botTiles/starter.ts`, window `botLooks.js`) for the first launch and offline; the core never parses in a frame.
A node: `BotBuddy` `avatar`, `moment`, `momentMode`, `momentEndWhen`; a tile `avatar`, `moment`, `momentMode`; `BotTiles` `surprises`
{ every, chance, moments }; `BotCard` `avatar`, `moment`. Build them with `botMoment(ctx, id, mode)`: a build without `BotMoments`
gets the recipe's `fallback` act instead (and an app that cannot play a recipe, a newer `format`, plays its fallback too).

**Pushing a new avatar or moment.**

1. Edit `shared/bots/looks.json` (add a part, an avatar under `avatars`, a recipe under `moments`; point a kind at a new avatar in
   `kinds`) and raise `v` by one.
2. `npx vitest run tests/bots-looks.test.ts` (it runs `checkLooks`: every field, path, expression, reference). Look at it in the
   showcase page (the frontend's `genDesktop.mjs` builds `botTiles.js`; any page that loads it and the catalog can play it).
3. Deploy the server. Apps take it on their next start (the bootstrap's flag moved).
4. Without a deploy: `PUT /v1/admin/bots/looks` with the whole catalog (header `x-admin-secret`; `?dry=1` only checks). It must pass
   the check and have a higher `v`; it is kept on the control volume (`bot-looks.json`) until a deploy brings a higher `v`, or
   `DELETE /v1/admin/bots/looks` takes it back (the apps follow the version down).
5. At the next app release: `node src/botTiles/genStarter.mjs` in `TAILZU-FRONTEND/app` refreshes both starters (the phone's and the
   window's tests fail while they differ from the server's file).

A new **kind of track or field** is an app update: add it to `core.ts` (and `TRACK_FIELDS` in looks.ts), raise `LOOKS_FORMAT` on both
sides, have the new build declare `BotMoments2` as well, and give recipes that use it `format: 2`: the kit sends them only to builds that
declare it (`playsFormat`), and older builds get their fallback act.


## 14. Pull-a-bot

Pull to refresh with a bot in it (shared/types/sdui.ts 3g; the phone's `app/src/sdui/PullBot.tsx`, physics in `pullBotCore.ts`).
Pull the list down at the top and a small bot stands on its top edge, feet first in the gap; pull up at the end and he holds it up,
head first. Past the line he gets excited and the phone ticks; let go and the list springs back, he rides it and is thrown off as it
passes its rest (off the top of the screen, or down behind the bar under the list), then the screen is fetched again quietly (the
live updates' reload: no spinner, its state kept) and a pill says "Checking", then "2 new" / "You're up to date" (from the other
end: "2 new at the top", which a tap goes to). Let go early: nothing refreshes. Reduce Motion: he is never thrown.

* **On a screen**: `page(ctx, { pullBot: { top: true, bottom: true, items, newAt?, avatar? } })`. It goes out (`ScreenResponse.pullBot`)
  only to a phone whose build declares **`PullBot`** (`canPullBot`); the window and older builds get the page as before. On now:
  Home and the first-day Home (decisions, work, bots), Activity (the feed and decisions), a bot's chat (its turns, `newAt: "bottom"`),
  Spaces and one space (spaces, tasks given to you; what is shared, asked for, given out, its activity).
* **What is new** is counted on the phone: `items` are the ids of the screen's list (ids the server already has), and after the
  refresh every id that was not there before is new. A list that could not be read names no `items`, so the next one is not all
  "new"; no `items` counts none. Ids once each, at most `PULL_BOT_MAX_ITEMS`.
* **Which bot**: the approved prototype's ("x0") by default; `avatar` (an id, or colours over the default: `shellTop`, `shellBottom`,
  `body`, `limb`, `visor`, `glow`, `shine`, `accent`), knob `pullBot.avatar` (the default id), knob `pullBot.looks` (looks by id). The
  looks catalog's avatars (section 13) are Blip's body, a different drawing, so they do not dress this bot.
* **Knobs** (app-knobs.json, the prototype's values): `pullBot.threshold` 60, `pullBot.rubber` 300, `pullBot.springRate` 17,
  `pullBot.springDamping` 0.58, `pullBot.throwSpeed` 1750, `pullBot.throwBoost` 2.6, `pullBot.gravity` 2600, `pullBot.scale` 0.5,
  `pullBot.checkMinMs` 900, `pullBot.pillMs` 2200, `pullBot.giveUpMs` 15000, `pullBot.pill.*` (colours, size, inset),
  `app.haptics.pullBot` "light"; labels
  `pullBot.checking`, `pullBot.fresh` ("{n} new"), `pullBot.freshTop`, `pullBot.freshBottom`, `pullBot.upToDate`, `pullBot.failed`.

## 15. Sounds

Short sounds made for the bots (shared/types/sdui.ts 3h): Pull-a-bot throws its bot with one (a different one each time), ticks
at the line, chimes when a refresh found something new and says a small "hmm" when it did not; the bots' moments play the sound
their recipe names (`sound` tracks: sneeze, fart.small, party, hic, clap). Quiet (about -20 LUFS), mixed with other apps' audio
(ducking nothing), and never when the phone is on silent.

* **Made here**, from maths only (no samples): `python3 tulmi/scripts/make-bot-sounds.py` (numpy and ffmpeg) writes
  `shared/bots/sounds/masters/<id>.wav`, `shared/bots/sounds/<id>.m4a` (AAC, 44.1 kHz mono) and `shared/bots/sounds.json` (each
  sound's id, file, hash, kind `throw | tick | new | uptodate | moment`, weight, `rare`, ms, label), normalised by kind and
  checked (length <= 450 ms, no clipping, silent ends, no DC). `--check` only checks; `--bump` raises `v`. Same input, same files.
* **Served**: the files at `/bots/sounds/<id>.m4a?h=<hash>` (routes/botSounds.ts; immutable, a year; never the masters), the
  catalog at `GET /v1/bots/sounds` (each sound's address), and the Bots app's bootstrap flag `"bots.sounds": { v, url }`.
* **A new pack** (a seasonal one): make or add the files, raise `v`, deploy; or without a deploy, put the files in the media
  store and `PUT /v1/admin/bots/sounds` a catalog whose new sounds name their `url` (https), with a higher `v`
  (`DELETE` takes it back). The phones fetch the catalog and the files they lack when `v` moves, and keep them.
* **The phone** (a build that declares **`BotSounds`**; `app/src/sdui/sounds.ts`, rules in `soundsCore.ts`): one small player
  per sound, readied when a finger comes down; the throw picked by weight, never the one before, the `rare` one about 1 in 20.
  Not while the app's own sound or microphone is on. The **Sounds** switch on the You tab (only for such a build) is kept on the
  device: action `devicePref` "sounds", and `soundsOn` in the screen's state.
* **Knobs**: `pullBot.sounds.enabled` (true), `pullBot.sounds.volume` (0.7), `pullBot.sounds.rareChance` (0.05),
  `pullBot.sounds.noRepeat` (true), `bots.sounds.moments` (true), `bots.sounds.momentVolume` (0.5), `bots.sounds.players` (8),
  `bots.sounds.sessionIdleMs` (4000).
