# Being built right now (read before you start)

Updated 14 Nov 2026, 00:40 UTC. One session is building the items below. Do not edit the files they hold until the item is
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

- Nothing held right now. Reviews of the pieces below may push small follow-up fixes to the same files.

## Landed 14 Nov 2026 (all switched off)

- Screen vocabulary 2 connected: phone renderer wiring (`app/src/sdui/blocks/**`, Renderer, actions, state), the server's
  checker (`tulmi/src/experience/sdui2/**`, switch `SDUI_V2` / `SDUI_V2_USERS`) and the window (`src/app/sdui/v2/**`).
  How to use it: `docs/renderer.md` section 3.
- Reply to a bot from its notification (`tulmi/src/bots/notifyReply.ts`, route `POST /v1/bots/:slug/notify-reply`,
  category `x0_bot_reply`, switch `NOTIFY_REPLY` / `NOTIFY_REPLY_USERS` / `NOTIFY_REPLY_PER_HOUR`). Server only.

## In progress (server: the bot drawings, started 13 Nov 2026)

- **What a bot draws under its words** (`docs/show.md`; behind `BOT_SHOW`, off, staged by `BOT_SHOW_USERS`; server only,
  today's kit only, per `docs/renderer.md` section 2): after a bot answers in its chat, the `bot_show` role picks building
  blocks or none, drawn as monochrome dot art (SVG circles) whose pieces spring in on `Rise` on the newest answer, with Blip
  (`BotBuddy`) beside a drawing now and then; every Rise and BotBuddy carries a `fallback`, and a chat screen holds a dot budget
  so it stays inside the screen limits. Built on `claude/keen-allen-podunv`, not on main yet. Holds `tulmi/src/show/**`,
  `tulmi/src/experience/bots/show.ts`, `tulmi/src/experience/bots/screens/bots/parts.ts` (`botTurn`, `chatTurns`),
  `tulmi/src/bots/run.ts` (step 7), `tulmi/src/botsBots/chat.ts` (picks), the chat POST in `tulmi/src/routes/bots/botsBots.ts`,
  the `bot_show` role in `tulmi/src/principles/roles.ts`, `docs/show.md`. It leaves `shared/types/sdui.ts` and
  `tulmi/src/experience/bots/lint.ts` exactly as main has them, and adds `BOT_SHOW` / `BOT_SHOW_USERS` to `config.ts` next to
  `LINGO`, away from where S1 adds `SDUI_V2`.

## Numbers in use

- Migrations: 0087 lingo, 0088 native looks, 0089 lingo sentences, 0090 bot health days. Take the next free number and
  check `git log origin/main -- tulmi/supabase/migrations` first: two sessions have collided twice today.
- Phone runtime: `tailzu-2026-11-x0-blip`. Do not change it.

## Notes from other sessions

- From the bot drawings (server), for S1 and V1: the drawings use `Rise` pieces for their motion today. Once `motion` (SPEC 2.5)
  can reach a screen, they move to it and stop sending Rise, inside the 64 animated nodes; nothing to do on your side but say
  here when it is on main.
