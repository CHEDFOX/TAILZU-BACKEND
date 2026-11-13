# Building the renderer way

Read this before you add a screen, a card, an animation, a widget look or anything else a client draws.

The short version: **the phone and the desktop are renderers.** They draw trees of nodes this server sends. Almost
everything you want to build is server data, so it ships with a deploy. Adding client code is the exception, and it
needs a reason.

Related docs, each the truth about its own catalog: `docs/bots-app.md` §3 (adding a screen), §5 (the kit), §7 (the
render check), §10 (live updates), `docs/native-looks.md` (widgets, Live Activity, Android notice, key faces),
`docs/bots-app.md` §13 (bot animation), `docs/launch.md` (the opening animation), `docs/perms.md` (location,
contacts, workouts).

---

## 1. The rule

The phone app and the desktop window ship a fixed renderer and nothing else. Every screen is JSON from
`/v1/app/screen`: the tabs, the words, the layout, what each node does (`archi.md`, "Server-driven UI"). There are
three layers and three speeds.

| Layer | What it holds | How a change reaches people |
|---|---|---|
| **Server data** | screens, words, pictures, fonts, colours, rules, animations, lists, flows, the launch motion, widget and key designs | a deploy or a `PUT`, minutes |
| **The player** | the renderer's building blocks, and the closed list of actions | phone: an over-the-air JS update on the same runtime, applied at the next cold launch. Desktop: a release |
| **The host** (the signed binary) | OS abilities, permissions, extensions, the icon, the splash picture, native libraries | a store build and review |

**What needs nothing but a deploy. Today:** any screen, flow, card or list built from the kit's node types and
today's actions, plus the catalogs below (bot looks, the launch, native designs).

**Once the renderer wiring (V1) and the server checker (S1) land:** any screen, flow, onboarding, settings page,
sheet, card, empty state or error state. Any interaction the blocks express. Any motion. Any list. New uses of an
ability the binary already has (camera, mic, voice, pickers, haptics, notifications, sharing, clipboard, the in-app
browser).

**What needs an over-the-air JS update.** Only a brand-new *kind* of block — a data shape no block anticipated. Not a
new feature built from blocks that exist. The list of blocks is closed in
`TAILZU-FRONTEND/app/src/sdui/kernel/blocks.ts` (being built, uncommitted).

**What needs a store build.** The app icon. The native splash picture. A new permission, background mode or
entitlement. A new extension kind (a new widget kind, an App Intent type). A new native library. An upgrade of a
native library already linked.

**The runtime rule.** The runtime label (`app/app.config.ts` `runtimeVersion`, today `tailzu-2026-11-x0-blip`) means
"the native code JS can rely on". A bump cuts installed phones off from updates until they update from the store, so
it changes **only** when native code that already exists changes (an SDK upgrade, an installed package version, a
local module function removed or renamed) — never for something merely added. `tools/ci/check-runtime.mjs` enforces
this against `app/native-inputs.lock`; run it with `--write` after an addition.

---

## 2. Use today

| I want to build | Do this | Where it lives |
|---|---|---|
| **A new screen or flow** | write `screen({ id, load, build })` and list it in `BOTS_SCREENS` | `screens/<area>.ts`; `experience/bots/index.ts`; see `docs/bots-app.md` §3 |
| **A new card or visual** | compose `col` / `row` / `text` / `picture` / `SVG` from the kit; `lintTree` must return `[]` | `experience/bots/kit.ts`, `lint.ts` |
| **Show/hide** | `visibleIf` with today's `Condition` shapes | `shared/types/sdui.ts` `Condition` |
| **Live updates** | `page(ctx, { live: ["space:<id>"] })`; the screen reloads when `live.publish` names the topic | `kit.ts` `page()`, `live/bus.ts`, `docs/bots-app.md` §10 |
| **A new bot look or animation** | edit the catalog; a scene is a `scenes` entry played by a moment's `scene` track | `shared/bots/looks.json`; `PUT /v1/admin/bots/looks` |
| **The opening animation** | edit the launch; every field is a formula in the bots' motion language | `shared/launch/launch.json`; `PUT /v1/admin/launch` |
| **Widgets, Live Activity, Android notice, key prints** | add a design to the catalog and a `targets` rule naming who sees it | `shared/native/looks.json`; `PUT /v1/admin/native/looks` |
| **Location, one contact, workouts** | the actions `location.area`, `contact.pick`, `health.sync` | `shared/types/sdui.ts`; `botsPlaces.ts`, `spaces/pickContact.ts`, `screens/bots/health.ts` |
| **Live reload of a screen** | `page(ctx, { live: [topic] })` plus `live.publish` on the write path | `live/bus.ts` |

**Paint, today.** On the phone use `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset` and `elevation`.
`boxShadow`, `backgroundImage`, `filter` and `mixBlendMode` are dropped by the phone's style passthrough
(`theme/style.ts`, the `isPaintKey` check) until V1 turns `paint` on — `kit.ts:1353` and `screens/you/settingsCard.ts:176`
send them today and the phone loses them. The window still draws them as CSS.

---

## 3. Not usable yet (lands with V1 + S1, and D1 for the window)

None of the 13 blocks below is reachable from a screen yet: no client declares `blocks`, and `lintTree`'s `KIT_TYPES`
rejects `List`, `Each`, `Input`, `Video`, `Audio`, `Camera`, `Use` and `Slot`. **Do not send any of this syntax.**

| Block | What it will do | Gate |
|---|---|---|
| `expr` | `{ "$t": "…{{ expr }}…" }` for text, `{ "$": "expr" }` for one value | `expr` |
| `defs` | a screen-local template plus `Use` / `Slot` | `defs` |
| `rules` | `when` / `every` / `after`, timers and state machines | `rules` |
| `motion` | `enter`, `exit`, `loop`, `drive`, `layout`, `shared` on any node | `motion` |
| `gesture` | `tap doubleTap longPress drag pan pinch swipe hover` on any node | `gesture` |
| `list` | `List` with `data` / `item` / `page`; `Each` for a short array | `list` |
| `input` | one `Input` node with a `kind` | `input` |
| `media` | `Video`, `Audio`, `Camera` (`mode: photo \| scan`) | `media` |
| `paint` | `backgroundImage`, `boxShadow`, `filter`, `mixBlendMode`, `blur` | `paint` |
| `device` | `device.*` in an expression | `device` |
| `local` | `local.*`, and the `local.set` / `local.remove` actions | `local` |
| `shell` | `shell.tabBar` / `shell.header` / `shell.toast`; `navigate` presentation and detents | `shell` |
| `data` | `callEndpoint` gains `multipart`, `progressInto`, `retry`, `queue`, `cache`, `optimistic`; `subscribe` for a live topic | `data` |

The key names for each are spec objects in code, so they cannot drift from the doc: `components/v3Spec.ts` `SPEC`
(list, input, media), `motion/spec.ts` `MOTION_SPEC`, `gesture/spec.ts` `GESTURE_SPEC`, `theme/paintCore.ts`
`PAINT_SPEC`, `device/factsCore.ts` `DEVICE_SPEC`, `localCore.ts` `LOCAL_SPEC`, `shell/blocks/index.ts` `SPEC`,
`data/index.ts` `SPEC`, `kernel/limits.ts` `LIMITS`. The expression syntax is SPEC 2.2–2.10.

Two mistakes to avoid when the time comes, because SPEC itself has them wrong:

- `navigate` takes `screenId`, not `screen` (`shared/types/sdui.ts:1520`; `app/src/sdui/actions.ts` reads
  `action.screenId`).
- a List's `page.cursor` and `page.into` are plain store dot-paths (`feedCursor`), not `state.feedCursor`
  (`components/v3Host.ts`, `List.tsx`).
- a gesture's `min`, `max` and `snap` are numbers; `gestureCore` reads them through `fin()`, which takes numbers only,
  so an object collapses the run to `min`. V1 must resolve a `$` value before `compileGestures`.

`subscribe` also needs a server topic that carries content, which the bus does not do: `live/bus.ts` sends `data` as a
hint only, except `ask:<id>` and `notice`.

### The catalogs

| Catalog | File | Route | Switch |
|---|---|---|---|
| Widgets, Live Activity, Android notice, key faces (`docs/native-looks.md`) | `shared/native/looks.json` | `PUT /v1/admin/native/looks?dry=1` then without `dry`; `GET /v1/native/looks` | `NATIVE_LOOKS`, `NATIVE_ACTIVITY`, `KEYBOARD_SKINS`, `ACTIVITY_PUSH_START`, `ANDROID_BOTS_NOTICE` |
| Bot animation (`docs/bots-app.md` §13) | `shared/bots/looks.json` | `PUT /v1/admin/bots/looks[?dry=1]`; `PUT /v1/admin/bots/looks/off { off: [moment ids] }` to pull one moment; `GET /v1/bots/looks?v=N&f=F` | `BOTS_SCENES` |
| The launch (`docs/launch.md`) | `shared/launch/launch.json` | `PUT /v1/admin/launch[?dry=1]`; `GET /v1/launch` is the public read | none |

A native design is gated twice: the switch, and a `targets` rule naming the person's surface. `targets` ships empty,
so turning the switch on shows a design to nobody. A bot scene is gated by `BOTS_SCENES` and by the build declaring
`BotMoments2` (`looksCan()` in `experience/bots/looks.ts`); every format-2 recipe needs a `fallback` act and an idle
surprise a `still` frame. The launch rides the bootstrap as `app.launch` (`launch/launchMotion.ts`); a pushed launch
plays from the next open after the one that received it (`docs/launch.md`, step 2).

### The three phone actions

| Action | What reaches this server | Capability | Switch |
|---|---|---|---|
| `location.area` | the area's name, after the person reads it and taps Save. Never a coordinate | `Location1` | `PERM_LOCATION` |
| `contact.pick` | the one email they tapped. The address book is never read | `ContactPick1` | `PERM_CONTACT_PICK` |
| `health.sync` | `{day, steps, workouts}` POSTed straight to `/v1/bots/<slug>/health/days` | `Health1` | `PERM_HEALTH_IOS`, `PERM_HEALTH_ANDROID` |

Each capability is declared by the phone's own check that the native module is there, so an over-the-air update on an
older binary declares none and the buttons draw nothing. The window never gets any of the three. All three need the
next store build.

---

## 4. What a screen says it needs, and what clients get

The client tells the server what it can draw on every bootstrap and screen request
(`TAILZU-FRONTEND/app/src/sdui/client/capabilities.ts`).

| Field | What it carries |
|---|---|
| `components` | the node types and the "not a component" declarations this build really has, less what this binary cannot back |
| `actions`, `templates` | the action kinds and named layouts it honours |
| `looks` | the bot catalog as this phone really has it: `{ v, f, ok, why?, bad?, slow? }` |
| `sdui` | `safe: 1` (this build has the safety floor) plus what went wrong on this launch |
| `off` | what the **device** switched off for itself after two crashed launches. Never "not built yet" |
| `vocab`, `blocks`, `runtime` | **not sent yet.** They land with V1 (section 7) |

The capability list is a promise, so it only names what actually works. Capabilities derived from the binary
(`VoiceRealtime`, `NativeLook1`, `Location1`, `ContactPick1`, `Health1`, `KeySkin1`, `GlanceSteps`,
`PushTimeSensitive` …) are said only when the native module or function is there, so one JS bundle running on an
older binary says fewer of them. `BotMoments2` is not one of these: it is a JS constant in `registry.ts`.

**A fallback on every new node.** An unknown node draws its `fallback` and nothing if it has none; an unknown prop is
ignored. Give every node a client might not have a `fallback` that still makes sense.

**When V1/S1 land.** No lowering: a client that lacks a block will get the frozen earlier version of that screen, or a
short "Open X0 again" / "Update X0" screen (S1, not built). An unknown action kind will run `onError` (V1) — today the
phone's `runAction` switch has no default case, so an unknown kind silently does nothing.

---

## 5. Safety and limits

- **Per-node boundary.** A node that throws draws its own `fallback`, or nothing, and the rest of the screen keeps
  drawing. The type and screen ride back on the next handshake as `bad: <type>:<screen>`. A node that throws with no
  `fallback` also tells the screen (`onNodeError`).
- **Kill switches**, in `bootstrap.flags`, read through `knobs.ts`, cached on disk so they hold offline:

| Switch | Effect |
|---|---|
| `sdui.safe: true` | no rules, no motion, no gestures (also no edge-swipe back and no pull). In **this** build every node type still draws: `VOCAB1_TYPES` (`safetyCore.ts`) is every type there is |
| `sdui.off: ["List", "motion", "bots.home"]` | those node types, blocks or screen ids are treated as unknown |
| `sdui.motion: "off" \| "reduced"` | motion off, or treated as Reduce Motion |

  A screen id in `sdui.off` draws the root's `fallback` or nothing — a blank page (`shell/ScreenHost.tsx`). A node type
  draws its `fallback` or nothing. **The kit sets no fallbacks today**, so `sdui.off: ["bots.home"]` gives a blank Home
  and `"BotTiles"` removes the tiles with nothing in their place.

  To flip one: `PUT /v1/admin/control/rules/sdui-off` with `x-admin-secret` and
  `{"id":"sdui-off","surface":"bootstrap","ops":[{"op":"set","path":"/flags/sdui.off","value":["List"]}]}`.
  `tulmi/src/experience/appKnobsData.ts` has no `sdui.*` knobs yet (it was not re-synced after `7ddcf31`). Only phones
  whose handshake carries `sdui: { safe: 1 }` honour these.
- **Crash-loop guard.** The screen being drawn is written synchronously. Two launches killed on the same screen start
  the next one in safe mode with that screen switched off, and say so in `off`. Leaving the foreground closes the
  record, so a force-quit is not counted as a crash.
- **Limits** (the device enforces them; S1 will lint the same numbers from `shared/sdui/kernel.cjs`, so there is one
  set and not two that drift):

| What | Limit |
|---|---|
| screen JSON | ≤ 512 KB; ≤ 2,500 nodes after expansion; depth ≤ 48 |
| one string prop | ≤ 8 KB |
| expressions | ≤ 400 source characters; ≤ 256 compiled ops each; ≤ 600 per screen; ≤ 20,000 ops per store change; ≤ 64 holes in one `$t` |
| templates | ≤ 32 per screen; no recursion; depth ≤ 6; ≤ 200 nodes per item template |
| rules and timers | ≤ 32 rules; ≤ 4 timers; `every` ≥ 1000 ms (250 ms while visible and in front); an `after` or `every` ≤ 24 h; ≤ 10 fires/s; action nesting ≤ 16 |
| lists | page ≤ 100; ≤ 2,000 rows held; `Each` ≤ 200 copies; a List that is not the scroller draws ≤ 100 rows unwindowed |
| gestures | ≤ 12 live per screen; ≤ 6 on one node; the store is written on end only |
| motion | ≤ 64 animated nodes; ≤ 64 keyframes per value; ≤ 2 shared moves at once |
| images | https only; ≤ 4096 px on the longest side; ≤ 8 MB |
| state | paths ≤ 12 segments and ≤ 128 characters, never `__proto__` / `constructor` / `prototype`; ≤ 2 MB per screen store |
| `local` | ≤ 256 KB in all; ≤ 8 KB per value; ≤ 256 keys; a name holding `session`, `pin`, `refresh`, `auth`, `token`, `otp` or `cookie` is refused |
| `subscribe` | ≤ 4 topics per screen; ≤ 64 KB per message; ≤ 20 merges/s |

- **User text is never a template.** Note titles, calendar invites, anything a person or a connected service wrote
  goes into a plain string prop and is shown as written. A stranger's invite named `{{ state.x }}` must stay those
  characters. The kit's `text()` keeps data literal and never wraps it in `$t`. (An S1 lint warning on `{{` in a bare
  string is planned, not built.)
- **Network paths.** `callEndpoint` and a List's `page` reach our API origin only, by relative path under `/v1/`, with
  each filled value URL-encoded. A filled path is refused if it holds `..`, `//` or a scheme. `subscribe` uses topics
  on the existing socket, not paths. `openUrl` goes through the existing allow-list.
- **Device facts.** `device.*` is read-only and holds no identifiers; a read never requests a permission. On Android
  only `canOpen.upi` is real — the other five schemes read null, because `<queries>` lists only `upi`
  (`device/factsCore.ts`). An S1 lint refusing `canOpen.*` in a request body is planned, not built.
- **A List inside a same-axis scroller.** S1's lint will refuse it; today the device draws at most 100 rows unwindowed.
- **No downloaded code.** Nothing from the server reaches `eval`, `Function` or a WebView outside `LiveView`.

---

## 6. Launch dark

**Every new thing ships behind a switch that defaults off.** A server deployed before the store build must draw
exactly what it draws today, and turning a switch off again must put every phone back with nothing to uninstall.

Stage by account list. A `*_USERS` switch is a comma-separated list of account ids: while it has any name in it, only
those accounts get the feature, even with the master switch on. Empty means the switch alone decides. For native
designs the staging is a `targets` rule's `when.users` instead, because it reaches all four surfaces at once.

The switches that exist today (`tulmi/src/config.ts`):

| Switch | Default | What it turns on |
|---|---|---|
| `NATIVE_LOOKS` | off | the `native.looks` bootstrap flag, `GET /v1/native/looks`, and `look` on any glance |
| `NATIVE_ACTIVITY` | off | Live Activity designs (needs `NATIVE_LOOKS`) |
| `KEYBOARD_SKINS` | off | the keyboard's skin expansion and the Keybot skin picker |
| `KEYBOARD_SKINS_USERS` | empty | the keyboard's testers' stage, since a key tree has no `targets` |
| `ACTIVITY_PUSH_START` | off | "Bots at work" may be started by a push while the app is shut (iOS 17.2+) |
| `ANDROID_BOTS_NOTICE` | off | the Android ongoing "Bots at work" notice (needs `NATIVE_LOOKS`) |
| `BOTS_SCENES` | off | bot animation format 2 for builds that declare `BotMoments2` |
| `BOTS_SCENES_USERS` | empty | the first accounts to get format 2 |
| `PERM_LOCATION` | off | "Use my location" on Plan Ease's start-of-day card |
| `PERM_CONTACT_PICK` | off | "Add from contacts" on a space's Invite page and Spaces' start screen |
| `PERM_HEALTH_IOS` | off | the fitness bot's "Count my workouts" row on iPhone |
| `PERM_HEALTH_IOS_USERS` | empty | the iPhone account list |
| `PERM_HEALTH_ANDROID` | off | the same row on Android (Health Connect); stays off until Google has approved the form |
| `PERM_HEALTH_ANDROID_USERS` | empty | the account list for the stage before Google's own list arrives |
| `BOT_SHOW` | off | what a bot draws under its words in its chat: monochrome dot art from today's kit, springing in on `Rise` (`docs/show.md`) |
| `BOT_SHOW_USERS` | empty | the first accounts to get bot drawings |

`ACTIVITY_PUSH_START`, `ANDROID_BOTS_NOTICE`, `PERM_LOCATION` and `PERM_CONTACT_PICK` are global: they have no
per-account stage, so their device checks come before they go on in production.

---

## 7. When you really do need new client code

In this order:

1. **Add a block, not a one-off component.** If the thing you want is a new *kind* of thing a screen can say, it
   belongs in the vocabulary, as data every future screen can use. `SwipePill`, `HeadBar`, `Rise`, `MorphOut`,
   `BlipWalkOut` and the rest are the mistake we are undoing: most of today's 35 node types are single features.
2. **Anything optional goes through `src/device/natives.ts`.** A native package or local module added after the
   baseline is reached only by an optional require there; a function added to an existing local module only through a
   `typeof mod.fn === "function"` check. That is what lets the runtime label stay put.
3. **Declare it in the handshake.** A new node type goes in `src/sdui/components/index.ts` and `src/sdui/registry.ts`,
   plus `shared/types/sdui.ts`, `KIT_TYPES` in `tulmi/src/experience/bots/lint.ts` (or every screen test fails) and a
   kit `can*()` gate on `ctx.can`. Never add it to `VOCAB1_TYPES` in `src/sdui/safetyCore.ts`: safe mode must keep
   drawing only what the oldest player could. Block node types are added by `registerListsInputsMedia`, never by
   `REGISTRY`. The list is a promise: never name something that does not work.
4. **Server lint.** `lintTree` must return `[]` for every screen (`tulmi/src/experience/bots/lint.ts`).
5. **Desktop copy.** The window draws from the same JSON (`TAILZU-DESKTOP/src/app/sdui/core.js`, `nodes.js`). It draws
   more node types than the phone does today, so the phone registry is the narrow contract.

Checks to run before you commit:

| Check | Command | Where |
|---|---|---|
| Runtime label honest | `node tools/ci/check-runtime.mjs` (`--write` after native additions) | TAILZU-FRONTEND |
| Twice-written regions match | `node tools/ci/marked-regions.mjs` | TAILZU-FRONTEND |
| Knobs manifest current | `node tools/knobs/extract.mjs` (`--check` in CI) | TAILZU-FRONTEND |
| Server knobs current | `node scripts/sync-knobs.mjs ../../TAILZU-FRONTEND/tools/knobs/app-knobs.json` | TAILZU-BACKEND/tulmi |
| Phone tests | `npm test` (`node --test`) | TAILZU-FRONTEND/app |
| Server typecheck and tests | `npm run typecheck`, `npm test` | TAILZU-BACKEND/tulmi |
| Desktop tests | `npm test` | TAILZU-DESKTOP |
| Renders, and look at them | `npx tsx scripts/bots-render/render.ts <screen id>` | TAILZU-BACKEND/tulmi |

---

## 8. Status: what you can use today

Nothing in this table is a promise about dates. **Never present unbuilt syntax as available.**

| Piece | Status | What it means for you |
|---|---|---|
| Safety net: per-node boundary, `sdui.safe` / `sdui.off` / `sdui.motion`, crash-loop safe mode | **landed on main** (frontend `7ddcf31`) | the switches work on phones running that bundle, and the server sends no `sdui.*` knob yet; give every node a `fallback` |
| The launch animation from the server | **landed on main** | push a new launch; it rides the bootstrap as `app.launch` and falls back to the bundled copy |
| `paint`, `device`, `local`, `shell`, `data` blocks | **landed on main, not switched on** | the code is there; no screen can reach it until V1 lands. Do not use in production screens |
| Kernel: expressions, formats, templates, rules, limits, paths | **being built** (`src/sdui/kernel/**`, uncommitted) | syntax per SPEC 2.2–2.4; do not use in production screens |
| Motion and gestures on any node | **being built** (`src/sdui/motion/**`, `src/sdui/gesture/**`, uncommitted) | syntax per SPEC 2.5; do not use in production screens |
| Lists, inputs, media (`List`, `Each`, `Input`, `Video`, `Audio`, `Camera`) | **being built** (`src/sdui/components/**`, uncommitted) | syntax per SPEC 2.6, 2.8, 2.10; do not use in production screens |
| **V1, the renderer wiring** (`Renderer.tsx`, `actions.ts`, `state.ts`): `$` / `$t`, `Use` / `Slot`, the rules host, `device.*`, `local.*`, `vocab` / `blocks` / `runtime` in the handshake | **not started** | until this lands, no block above is reachable from a screen |
| **S1, the server screen checker** (`shared/types/sdui.ts` vocab 2, `tulmi/src/experience/sdui2/{build,lint,gate}.ts`, the frozen-screen and "open again / update" fallback) | **not started** (`sdui2/` does not exist; `SDUI_SCHEMA_VERSION` is still 1) | there is no builder or lint for the new syntax yet |
| **D1, the desktop copy** (`TAILZU-DESKTOP/src/app/sdui/v2/**`) | **not started**; the generated kernels (`TAILZU-DESKTOP/src/app/sdui/kernel.js`, `TAILZU-BACKEND/shared/sdui/kernel.cjs` and its test) exist but are uncommitted | the window has none of the new blocks |
| Native looks, bot scenes, the three phone actions | **landed, every switch off** | native designs stage by a `targets` rule's `when.users`; `BOTS_SCENES` and `PERM_HEALTH_*` stage by their `_USERS` list; `PERM_LOCATION`, `PERM_CONTACT_PICK`, `ACTIVITY_PUSH_START` and `ANDROID_BOTS_NOTICE` are global, with no stage. The three phone actions and native designs need the next store build first |

Also in flight and uncommitted: `TAILZU-BACKEND/shared/sdui/kernel.cjs`, `tulmi/tests/sdui-kernel.test.ts` and this
doc; `archi.md` is modified; in the frontend `tools/ci/marked-regions.mjs` (the `CoreExprGrammar` pair) is modified.

The generated kernel copies are written by `node src/sdui/kernel/genKernel.mjs` in `TAILZU-FRONTEND/app`. Never edit
them by hand.

Before you start anything in this area, read `TAILZU-BACKEND/WORKING-ON.md`: it says which files another session is
holding right now.
