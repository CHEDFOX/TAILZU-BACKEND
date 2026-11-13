# Being built right now (read before you start)

Updated 13 Nov 2026, 23:00 UTC. One session is building the items below. Do not edit the files they hold until the item is
marked landed here; if you must, write a line under "Notes from other sessions" first. Remove an item when it lands.

## Landed today (on main, every switch off by default)

- Native looks: the server draws the widgets, the Live Activity, the Android "Bots at work" notice and the keyboard's key
  faces (`docs/native-looks.md`). Every card shows its own bot.
- The bots' animation engine, format 2 (scenes), behind `BOTS_SCENES`.
- Location ("Use my location"), contacts (the phone's picker, no permission) and workouts (Apple Health / Health Connect),
  behind `PERM_LOCATION`, `PERM_CONTACT_PICK`, `PERM_HEALTH_IOS`, `PERM_HEALTH_ANDROID` (`docs/perms.md`).
- The runtime check: `tools/ci/check-runtime.mjs` and `app/native-inputs.lock` (phone). Native additions need no runtime
  bump; changing an existing native package does. Run `node tools/ci/check-runtime.mjs --write` after native changes.

## In progress (phone: TAILZU-FRONTEND/app)

Needed in the next store build:
- **Safety net** (one bad node cannot crash a screen; `sdui.safe` / `sdui.off` / `sdui.motion` switches; crash-loop safe
  mode). Holds `src/sdui/Renderer.tsx`, `src/sdui/knobs.ts`, `src/sdui/safety*`, `src/sdui/client/capabilities.ts`.
- **Launch animation from the server** (`GET /v1/launch`). Holds `src/launch/**`, `src/storage.ts`.

The new building blocks (over the air, no store build; `pure` spec):
- Kernel: `src/sdui/kernel/**` (new), generated into `TAILZU-DESKTOP/src/app/sdui/kernel.js` and
  `TAILZU-BACKEND/shared/sdui/kernel.cjs` (never edit those two by hand).
- Motion and gestures on any node: `src/sdui/motion/**`, `src/sdui/gesture/**`, `src/sdui/components/Screen.tsx`, `Scroll.tsx`.
- Lists, inputs, media: `src/sdui/components/{List,Each,Video,Audio,Camera}.tsx`, `src/sdui/components/input/**`,
  `src/sdui/components/index.ts`.
- Paint, device facts, phone-local values: `src/sdui/theme/style.ts`, `src/sdui/components/blur.tsx`,
  `src/sdui/device/facts.ts`, `src/sdui/local.ts`.
- Shell and data: `src/sdui/shell/**`, `src/sdui/client/endpoint.ts`, `src/sdui/live/subscribe.ts`, `src/sdui/offline/**`.
- Shared: `tools/knobs/app-knobs.json`, `tools/ci/marked-regions.mjs`.

Next, after those land: the renderer wiring (`src/sdui/Renderer.tsx`, `actions.ts`, `state.ts`), the server's screen checker
(`TAILZU-BACKEND/shared/types/sdui.ts`, `tulmi/src/experience/sdui2/**`, `tulmi/src/routes/app/**`) and the desktop copy
(`TAILZU-DESKTOP/src/app/sdui/v2/**`, `nodes.js`, `core.js`).

## In progress (server: TAILZU-BACKEND)

- **What a bot draws under its words** (`docs/show.md`, behind `BOT_SHOW`, off by default; server only, nothing new in the apps):
  after a bot answers in its chat, the `bot_show` role picks building blocks or none (a choice to tap, a callout, steps, a table,
  a chart, next questions, a form, a drawing), drawn as monochrome dot art whose pieces spring in on `Rise`, with Blip beside a
  drawing now and then. Built on `claude/keen-allen-podunv`, not on main yet. Holds `tulmi/src/show/**`,
  `tulmi/src/experience/bots/show.ts`, `tulmi/src/experience/bots/screens/bots/parts.ts` (`botTurn`, `chatTurns`),
  `tulmi/src/bots/run.ts` (step 7), `tulmi/src/botsBots/chat.ts` (picks), the chat POST in `tulmi/src/routes/bots/botsBots.ts`, the
  `bot_show` role in `tulmi/src/principles/roles.ts`, `docs/show.md`. It touches none of the files the phone items hold, and
  leaves `shared/types/sdui.ts` exactly as main has it.

## Numbers in use

- Migrations: 0087 lingo, 0088 native looks, 0089 lingo sentences, 0090 bot health days. Take the next free number and
  check `git log origin/main -- tulmi/supabase/migrations` first: two sessions have collided twice today.
- Phone runtime: `tailzu-2026-11-x0-blip`. Do not change it.

## Notes from other sessions

- From the bot drawings (server): once "motion and gestures on any node" lands, the drawings in
  `tulmi/src/experience/bots/show.ts` (`SPRING`, `piecesOf`) can move to it, for real physics on the window too (today a Rise is a
  real spring on the phone and a CSS ease on the window) and a touch that pushes the dots. Nothing to do on the phone's side for
  it; just say here when it is on main.
