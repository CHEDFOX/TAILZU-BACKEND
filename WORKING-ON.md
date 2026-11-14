# Being built right now (read before you start)

Updated 14 Nov 2026, 03:10 UTC. One session is building the items below. Do not edit the files they hold until the item is
marked landed here; if you must, write a line under "Notes from other sessions" first. Remove an item when it lands.

**How to build things now:** read `TAILZU-BACKEND/docs/renderer.md` before adding any screen, visual, animation or widget
look. The apps are renderers: build server data with the existing blocks and catalogs, not new client components.

## Landed today (on main, every switch off by default)

- Native looks: the server draws the widgets, the Live Activity, the Android "Bots at work" notice and the keyboard's key
  faces (`docs/native-looks.md`). Every card shows its own bot.
- The bots' animation engine, format 2 (scenes), behind `BOTS_SCENES`.
- Location ("Use my location"), contacts (the phone's picker, no permission) and workouts (Apple Health / Health Connect),
  behind `PERM_LOCATION`, `PERM_CONTACT_PICK`, `PERM_HEALTH_IOS`, `PERM_HEALTH_ANDROID` (`docs/perms.md`).
- The runtime check: `tools/ci/check-runtime.mjs` and `app/native-inputs.lock` (phone). Native additions need no runtime
  bump; changing an existing native package does. Run `node tools/ci/check-runtime.mjs --write` after native changes.
- **Safety net** (one bad node cannot crash a screen; `sdui.safe` / `sdui.off` / `sdui.motion` switches; crash-loop safe
  mode), frontend `7ddcf31`. Not switched on until V1: the server sends no `sdui.*` knob yet.
- **Launch animation from the server**, frontend `7ddcf31`. It rides the bootstrap as `app.launch`.
- **Paint, device facts, phone-local values, shell and data blocks**, frontend `7ddcf31`. Not switched on until V1: no
  screen can reach them.

## In progress

- **The `live` block (L1): joining a call from the apps** (calls, `docs/rooms.md`; started 14 Nov). The 14th block: take a seat in a
  call, change the mic and camera, leave, the people in it written into state, and a `Live` node that draws one person's track. It is
  JavaScript on the `react-native-webrtc` the app already links, so no native package and no runtime bump.
  Holds: `TAILZU-BACKEND/shared/types/sdui.ts` (`SDUI_BLOCKS`, `LiveProps`, the three actions), `tulmi/src/experience/sdui2/{build,lint}.ts`,
  `tulmi/src/rooms/**`, `tulmi/src/experience/bots/screens/bots/mailCalls.ts` and a new `callRoom.ts`;
  `TAILZU-FRONTEND/app/src/sdui/blocks/live/**` (new), `components/index.ts`, `client/capabilities.ts`, `src/device/natives.ts`;
  `TAILZU-DESKTOP/src/app/sdui/v2/**`.
- **Lingo, the language bot** (`docs/lingo.md`; started 13 Nov, switch `LINGO`, off). Learning a language by talking rather
  than tapping. ON MAIN and tested, nothing user-visible: the scheduler (FSRS), marking done on the SERVER and never in the
  app, the store, a session's seven kinds and the psychological order they are asked in, the shared sentence bank poured in
  from a public corpus, the bot in the bots list, and six routes under `/v1/lingo/`.
  Holds: `tulmi/src/lingo/**`, `tulmi/src/routes/bots/lingo.ts`, `tulmi/scripts/lingo-seed.ts`, `tulmi/tests/lingo-*.test.ts`,
  migrations **0087** and **0089**; small edits made in `bots/builtin.ts`, `bots/run.ts`, `config.ts`, `server.ts`,
  `routes/account/account.ts`.
  Next: its screens. They will be **vocabulary 1**, for the reason in the note below about the drawings — a lesson must never
  answer "Open X0 again" — so no new block and no release.
  Also next, as DATA in `shared/bots/looks.json`: Lingo's `l.*` moments. The design is **one gesture per grader reason**, so the
  movement carries the information instead of sentiment — `l.accent` plucks the missing accent out of the air and sets it over
  the word, `l.swap` spits the wrong letter out and catches the right one, `l.shuffle` swaps two `card` props hand to hand for
  the right words in the wrong order, `l.mouthit` mouths the right word enormously slowly (no shake, no buzz: the bot's own
  rule is never to be sarcastic about a mistake), `l.earcup` cups a `palm` to its ear when nothing was heard. Idling:
  `l.hum` (the `note` parts), `l.mutter`, `l.tongue`. Two new parts wanted, an accent stroke and a letter tile, one `draw`
  path each. The figure itself is unchanged — Blip, like every bot; only the colour and the movements differ.
  **Two things I need from whoever owns the design:** (1) Lingo has no colour of its own. The palette's eight are all taken by
  built-ins and `stone`, which I gave it, is also `botLook`'s FALLBACK for every bot a person makes, so Lingo looks like a
  generic bot. It wants a ninth colour. (2) While checking that I found `bots/builtin.ts` and `experience/bots/palette.ts`
  DISAGREE about the four shipped bots' colours (builtin says Xode pine / Keylessbord ochre / Plan sea / Travel clay;
  palette.ts says moss / clay / ochre / sea), and `oracle`, `meet` and `lingo` have no `palette.ts` entry at all, so they fall
  through to the fallback colour and the `spark` icon. Not mine to pick; say which is right and I will fix it in one commit.
- Reviews of the pieces below may push small follow-up fixes to the same files.

## Landed 14 Nov 2026 (all switched off)

- Screen vocabulary 2 connected: phone renderer wiring (`app/src/sdui/blocks/**`, Renderer, actions, state), the server's
  checker (`tulmi/src/experience/sdui2/**`, switch `SDUI_V2` / `SDUI_V2_USERS`) and the window (`src/app/sdui/v2/**`).
  How to use it: `docs/renderer.md` section 3.
- Reply to a bot from its notification (`tulmi/src/bots/notifyReply.ts`, route `POST /v1/bots/:slug/notify-reply`,
  category `x0_bot_reply`, switch `NOTIFY_REPLY` / `NOTIFY_REPLY_USERS` / `NOTIFY_REPLY_PER_HOUR`). Server only.
- **What a bot draws under its words** (`docs/show.md`, switch `BOT_SHOW` / `BOT_SHOW_USERS`). Server only, vocabulary 1, so
  every build draws it with no release. After a bot answers in its chat, the `bot_show` role picks building blocks or none (a
  choice to tap, a callout, steps, a table, a chart, next questions, a form, a drawing), drawn as monochrome dot art whose
  pieces spring in on `Rise` on the newest answer, with Blip beside a drawing now and then. Why it is not vocabulary 2: the
  note below.
- The render check draws the phone again: `local.ts` requires `react-native-mmkv` and trusts what `createMMKV` returns, and
  `scripts/bots-render`'s catch-all stub answers null, so the first `local.*` read threw and the screen came out blank. The
  tool now stands in for a phone without MMKV (`phone/no-mmkv.js`), so the app takes its own AsyncStorage fallback. The phone
  itself would do the same on any binary where that require resolves but the native side is missing: `mmkvKV()` catches a
  failed require, not a `createMMKV` that answers nothing (`docs/renderer.md` section 7.2 asks for the `typeof` check). One
  line in the phone's court; not touched here.

## Numbers in use

- Migrations: 0087 lingo, 0088 native looks, 0089 lingo sentences, 0090 bot health days, 0091 rooms. Next free: **0092**. Take the next free number and
  check `git log origin/main -- tulmi/supabase/migrations` first: two sessions have collided twice today.
- Phone runtime: `tailzu-2026-11-x0-blip`. Do not change it.

## Notes from other sessions

- **The bot drawings stay vocabulary 1, and that is now a decision, not a wait.** Yesterday's note said they would move to the
  `motion` block as soon as it could reach a screen. Reading `sdui2/gate.ts`: `needs` is worked out per SCREEN and a client
  missing a block is sent "Open X0 again" instead of the screen, never a lowered one. A chat must never do that for decoration,
  so the drawings keep `Rise`, which every build already draws, and the chat stays vocabulary 1 for everyone.
  Moving them to `motion` is still worth doing, but only emitted FOR CLIENTS THAT HAVE THE BLOCK (the screen is then
  vocabulary 2 for them alone and the gate passes), and only once `SDUI_V2` is on and the store build with the blocks is out.
  It would want `blocks` on `BotsCtx` (`experience/bots/kit.ts`, `registry.ts`, `screens.ts`), which the drawings do not touch
  today. What it buys: the window gets real springs (its v2 `motion` simulates one; a Rise there is a CSS ease), and fewer
  nodes. Say here when `SDUI_V2` goes on and I will do it.
- Calls, server side, are **on main** (`docs/rooms.md`, migration **0091**, settings `SFU_APP_ID` / `SFU_APP_SECRET` / `ROOM_*`, all
  off). Cloudflare's Realtime SFU carries the media: $0.05/GB out with the first 1,000 GB free, no per-minute charge, no webhook, and the
  App Secret never leaves the server. Joining from the apps is L1 above.