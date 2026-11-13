# The X0 widget: glance v2 — the contract

One universal widget, "X0", on iOS and Android, shows the whole app at a glance and picks what matters most right now.
This file is the contract between the server (tulmi), the app's TypeScript (app/src/widgets), the iOS widget extension
(app/targets/widgets) and the Android widgets (app/modules/tulmi-bridge/android). Change it here first.

## 1. Bot events (every bot, built-in or made by a person)

A bot reports only five kinds of event. Its words for the widget are its own; the server checks them.

| event   | the bot gives                                   | limits (cut at a word, never mid-word, "…" only if cut) |
|---------|-------------------------------------------------|----------------------------------------------------------|
| needs   | `question`, up to 3 `choices`, optional `private` | question ≤ 80 chars; choice ≤ 14 chars; ≤ 3 choices     |
| working | `doing` (what now), optional `stage`/`of`/`stageName` | doing ≤ 28 chars                                      |
| done    | `result` (what it finished), optional `link`, `pr` | result ≤ 40 chars                                     |
| failed  | `problem` (one line)                             | ≤ 40 chars                                                |
| idle    | nothing                                          |                                                          |

Missing words → the server's fill-in lines (knobs, en + Hinglish): "{bot} needs you", "{bot} is working",
"{bot} finished {task}", "{bot} hit a snag", "Ready". A `private` question never shows its words on a locked phone.

Server side (tulmi `src/widgets/botWords.ts` is the one checker: what fits is kept, what is long is cut at a word, what is wrong is
dropped; a bot's work is never refused over these words; a single word longer than the room is not cut in half: the fill-in is used):

| bot | needs | working | done | failed |
|-----|-------|---------|------|--------|
| Code bot | `ask_user { short, short_options }` (short_options[i] labels options[i]) | the task's first clause (`doingLine`), its stage | `done { short }` | the job's `reason` |
| a person's bot | `x0_widget { question, private }` on the change it calls (a connected app's yes) | the task's title | (fill-in) | (fill-in) |
| X0 itself | the yes's preview | the task's title | (fill-in) | (fill-in) |

The fill-in lines are knobs `x0.fill.{needs,working,done,failed,idle}` (`.hg` for Hinglish) of the "widgets" control surface.

## 2. GET /v1/shell/glance?v=2&tz=<minutes>[&lang=hinglish][&platform=ios|android][&steps=1]

Signed-in person's own. `v` absent → today's v1 shape, unchanged (older builds). Words are Hinglish when the `x-app-language`
header (or `lang`, or the profile's language) is Hinglish. v2 (built by tulmi `src/widgets/glance.ts`):

```jsonc
{
  "v": 2,
  "at": 1793350000000,              // ms
  "refreshAfterSec": 900,           // hint: the next useful refresh (sooner while a job runs: 300)
  "case": "needs",                  // "needs" | "working" | "done" | "quiet" — what the widget leads with
  "greeting": { "hello": "Good evening, Aanya", "line": "Anything to write up before the day ends?", "part": "evening" },
  "summary": "3 things moved since this morning",   // optional, ≤ 60 chars: a situation line (or the AI digest, §4)
  "week": { "done": 4, "minutesSaved": 120, "dots": 4, "line": "4 things done this week · 2 h saved" },   // dots 0–5
  "bots": [                         // Home's order: needs first, then working, then done-unseen, then the rest; ≤ 8
    { "slug": "code", "name": "Code bot", "color": "#3F7D3A", "face": "code",          // face = a head key the app ships, or null
      "faceUrl": "https://api.x0bot.com/blip/bots/head-code.png?v=1",                  // or null (a person's bot without art)
      "state": "needs", "needs": 1, "working": true,                                   // state: needs|working|done|failed|idle
      "line": "fixing cart", "link": "tulmi://screen/bots.code" }
  ],
  "more": 3,                        // bots beyond the 8 sent
  "needs": {
    "count": 2,
    "items": [                      // ≤ 3, oldest first
      { "id": "job:<jobId>:<q>", "kind": "question",   // the SAME id and kind as /v1/widgets rows ("task:<id>:<approval>", "approval"
                                                       // for a connected app's yes), so POST /v1/widgets/act answers it
        "bot": "code", "botName": "Code bot", "face": "code",
        "question": "Round the cart total per item, or once at the end?",
        "choices": [ { "id": "a0", "label": "Per item", "primary": true }, { "id": "a1", "label": "At the end" } ],
                                                       // choice id = the act `action`: a0, a1, a2 (a question's answers in order) or yes / no
        "decideLink": "tulmi://screen/bots.code.job?id=…",  // "You decide" / open it (an approval: tulmi://screen/bots.approve?task=…)
        "private": false, "answerable": true, "link": "tulmi://screen/bots.code",
        "at": 1793349880000 }                          // when it started waiting (ms)
    ]
  },
  "job": {                          // the Code bot job running now (else one waiting for the person), or null
    "id": "j_…", "bot": "code", "task": "Fixing cart", "stage": 3, "of": 5, "stageName": "Build",
    "stages": ["Understand", "Plan", "Build", "Check", "Ship"], "startedAt": 1793346880000, "link": "tulmi://screen/bots.code.job?id=…",
    "phase": "working"              // "working" | "needs" (its question is in needs.items, id "job:<this id>:…")
  },
  "lastDone": {                     // the newest Code bot job that ended, not yet seen (≤ 2 h old), or absent
    "id": "j_…", "bot": "code", "botName": "Code bot", "face": "code", "result": "Cart fix is ready", "endedAt": 1793349000000,
    "minutes": 58, "pr": { "number": 131, "url": "https://github.com/…/pull/131" }, "link": "tulmi://screen/bots.code.job?id=…",
    "failed": true                  // only when it stopped with a problem: `result` is then the problem's line
  },
  "counts": { "working": 2, "needs": 2 },
  "lock": { "inline": "Code bot needs you", "title": "Code bot needs you", "line": "Round the cart total per item…" },  // lock-screen-safe (private → no question words)
  "links": { "ask": "tulmi://screen/bots.ask", "home": "tulmi://", "mic": "tulmi://screen/bots.ask?voice=1" },
  "words": { "needsYou": "Needs you", "ready": "Ready", "ask": "Ask any bot…", "brand": "X0", "youDecide": "You decide",
             "working": "{n} working", "step": "Step {stage} of {of}", "minIn": "{n} min in", "seePr": "See the PR", "done": "Done",
             "answered": "Answered", "finish": "Open X0 to finish", "doneSeePr": "Done · See the PR",
             "min": "{n} min", "pr": "PR #{n}", "sending": "Sending…", "gone": "Already answered", "failed": "Open X0 to finish" }
                                    // knobs x0.word.*, en + Hinglish; working/step/minIn/min/pr keep their slots for the widget
}
```

`case` priority: needs (count > 0) → done (lastDone present) → working (a bot working or a job) → quiet.
Answers: the widget posts the existing `POST /v1/widgets/act` with `{ item: <item id>, action: <choice id>, key? }`, on the existing
widget token (`X-Widget-Token`). Choice ids are exactly the actions act accepts: `a0`/`a1`/`a2` (a question's answers, in order),
`yes`/`no` (a connected app's yes) and `done` (a space's task: not a glance item today; the Needs you rows keep it).

What the server guarantees (knobs of the "widgets" surface, `x0.*`, in tulmi `src/widgets/defaults.ts`):

- `needs.items`: a Code bot job's question (or a yes to its plan: no choices, open only) and a connected app's yes, oldest first, 3
  at most (`x0.needs.max`); `count` is all of them. `answerable` (and `choices` non-empty) only when 1–3 answers whose labels fit
  (`x0.needs.choicesMax`), a risk the server answers in place (`widgets.needs.inPlaceRisks`), the kind's mode is inPlace and widget
  tokens are on; else the widget opens `decideLink`. `private`: the bot said so, or the kind is in `x0.needs.private`
  (`["approval"]` by default: a connected app's yes says personal things).
- `bots`: Home's live state; `face` a head the app ships (`code`, `keybot`, `plan`, `travel`, `tailzu`); `line` is the bot's event
  line (working: what it does; needs: its question, or the fill-in when private; done/failed: its result/problem; idle: "Ready").
- `lastDone` "seen": the person opened that job's page or Activity in the app, or answered it from a widget or notification after it
  ended (tulmi `src/widgets/glanceStore.ts`, migration 0059).
- `lock`: never a private question's words (`line` is then "Open X0 to answer"); working: `title` "Code bot is working", `line`
  "Step 3 of 5 · Build"; done: `title` the result, `line` "PR #131 is ready".
- `words.working`, `words.step` and `words.minIn` keep their `{n}` / `{stage}` / `{of}` slots for the widget to fill.
- `refreshAfterSec`: 300 while a bot works (`x0.refreshSec.working`), else 900 (`x0.refreshSec`).
- `steps` (only with `steps=1`, from a binary that declares `GlanceSteps`, and while `PLAN_V2_APP` is on): lines that take over at their
  own minute with no new glance, so the widget's words stay true while the app isn't opened. Oldest first, 16 at most, within the next
  36 hours (the app keeps 16 within 48):

  ```jsonc
  "steps": [
    { "at": 1762936200000, "bot": "plan", "line": "Appointment 6:00, leave 5:30",        // from 3:30 pm: the leave-by's last 2 hours
      "lock": { "inline": "Leave by 5:30 · Appointme…", "title": "Leave by 5:30 pm", "line": "Appointment, 6 pm" } },
    { "at": 1762943400000, "bot": "plan", "line": "Next: Appointment 6 pm",             // the leave-by has passed
      "lock": { "inline": "Ready", "title": "X0", "line": "All quiet" } },
    { "at": 1762972200000, "bot": "plan", "line": "Fri · PTM 9:30 am", "lock": { … } }  // midnight: tomorrow is today
  ]
  ```

  From `at`, `line` is that bot's row line (only while the row is idle: asking, working or done keeps its own) and `lock` the lock
  screen's words (unless the widget leads with a question), each until the next step that sets them. Today they are Plan Ease's
  (tulmi `src/botsBots/planDay.ts` widgetSteps): its line at each moment it changes (a leave-by's last 2 hours, the leave-by, each
  start, midnight), and the lock words for that moment by the same rule as `lock` (the plan's own while a leave-by is within 2 hours or
  the lock screen is quiet, else the glance's own). Every word is lock-safe (`planSafe.ts`: no amount, a health visit is
  "Appointment"). A build that doesn't ask gets no `steps`, and lines worded to stay true until their time passes.

## 3. Situation lines (summary when no AI digest)

Chosen by the server from a small table: situation × part of day (morning/afternoon/evening/night), en + Hinglish, slots
{name} {bot} {task} {n}. Situations at least: first look of the day; things moved since last look ({n}); a bot just
finished ({bot}, {task}); several bots working ({n}); one long job running; nothing at all for a long time; weekend.
Server knobs (copy editable without a build).

Server side: tulmi `src/widgets/situation.ts` (pure, tested). The first that holds, in this order: `justFinished` (lastDone, not
failed; {task} is its own result, else its task) → `moved` (≥ `x0.situation.movedMin` changes since the last look) →
`severalWorking` (≥ 2) → `longJob` (≥ `x0.situation.longJobMin` minutes) → `firstLook` (first look today) → `quietLong` (nothing for
`x0.situation.quietDays` days) → `weekend`; none holds → no `summary`. Lines are labels `x0.sit.<situation>.<part>` (part `any` is
the fallback; `.hg` Hinglish). "The last look": fetches closer than `x0.lookGapMin` (10) minutes are one look.

## 4. AI digest (optional, flag `WIDGET_DIGEST`, default off)

When 3+ things changed since the last glance, one short line (≤ 60 chars) summarising them, from the cheapest model via the
model gateway, written once per change and cached per user; validated for length; never includes private questions; falls
back to §3.

Server side: tulmi `src/widgets/digest.ts`, role `widget_digest` (tiny tier, ≤ `x0.digest.maxPaise` a line). The model is given
each change as its bot and kind, with words only for what is not private (a connected app's words never). A line longer than 60,
or with a secret, is dropped; a model that is down or slower than `x0.digest.waitMs` leaves §3's line in place (the line, once
written, is read from the cache on the next fetch). "Changed" = a needs item, a job that ended or started since the last look.

## 5. Storage on the phone

- Both: the app hands the v2 JSON to the bridge's `setWidgetGlance(json)` (modules/tulmi-bridge), which writes it as below.
- iOS: the app writes the v2 JSON to the App Group (same suite/pattern as today's widget docs) under key `x0.glance`, and the
  face images to the App Group container `faces/<face>.png` (downloaded from faceUrl; the extension never fetches the network).
  Then reloads timelines for kind `space.tailzu.x0`.
- Android: SharedPreferences (same file as today's widget docs) key `x0.glance`, faces in the app's files dir
  `widget-faces/<face>.png`; then updates the provider `TailzuX0Widget`.

## 6. "Bots at work" Live Activity (iOS 17+: the widget extension's minimum is 17.0)

ActivityAttributes `BotsAtWorkAttributes { jobId }`, ContentState
`{ bot, botName, face, task, stage, of, stageName, stages[], startedAt, phase: "working"|"needs"|"done", question?, choices[]?, itemId?, itemKind?, decideLink?, result?, pr?, minutes?, link }`.
`startedAt` is ms. `itemId` / `itemKind` / `decideLink` (phase needs) are the needs item the activity answers: the same as its
`needs.items[]` entry (`choices[].id` the act action). `minutes` (phase done) is how long it took; absent, the app computes it from
`startedAt`. Two more optional fields the server may send (decode as optional): `private?: true` (`question` is then only
"{bot} needs you" and there are no `choices`), `failed?: true` (phase done, `result` is the problem).
The app starts it when glance v2 has a `job` and none is running for that job, updates it on every glance, ends it on
`lastDone` (showing the done state for ≤ 15 min, then dismissal). Bridge (modules/tulmi-bridge): `startBotsActivity(json)`,
`updateBotsActivity(json)`, `endBotsActivity(json)` (no-ops on Android), `botsActivityPushToken(): string | null`.
Server push (optional, off until configured): APNs Live Activity pushes for the same ContentState, env
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8` (the key's contents), `APNS_TOPIC` (bundle id + ".push-type.liveactivity":
`com.tulmi.app.push-type.liveactivity`),
`APNS_ENV` (production|sandbox); the app registers the activity's push token at `POST /v1/widgets/activity-token`.

- `POST /v1/widgets/activity-token { jobId, token, platform: "ios", env? }` with the session (the app's, not the widget token);
  `token` is the activity's push token in hex, or null / absent when the activity ended (its token is forgotten:
  `{ ok: true, push, removed: true }`); `env` defaults to `APNS_ENV`; the `x-app-language` header picks the fill-in lines'
  language. `200 { ok: true, push: true }` kept; `{ ok: true, push: false }` server pushes are off, or `platform` is not "ios"
  (nothing kept: keep updating from the app); `400` bad body; `404` not the person's job. Register again when iOS gives the
  activity a new token. The app's knobs `widgets.glance.*` / `widgets.activity.*` (path, tokenPath, enabled, doneSec 900,
  floorSec, faceTimeoutMs) are sent with the app's other knobs (tulmi `src/experience/appKnobsData.ts`).
- Pushes (tulmi `src/widgets/{activity,apns}.ts`): on every change of the job, only when what it shows changed (phase, stage, the
  question, the result): a step is `event: update`, priority 5; a question is `update`, priority 10, with an `alert`
  (`{bot} needs you` / the question, or "Open X0 to answer" when private); the end is `event: end`, priority 10, `dismissal-date` 15
  minutes on. The token is deleted at the end, or when Apple says it is gone. Migration 0059 keeps the tokens.

## 6a. The server-drawn look (docs/native-looks.md)

Everything above is the DATA. What draws it became data too: a build that says `NativeLook1` can be told which design to draw,
and the design itself waits on the phone. Off by default (`NATIVE_LOOKS`), and then every widget draws the view compiled into
its own build — exactly as it does today.

- **The glance request** gains `&nl=<the nlook catalog version this phone holds>` and `&can=NativeLook1,…`. Only a build that
  can draw one sends `nl`, so the number says the capability as well as the version.
- **The glance answer** gains `"look"`, `"palette": "dusk"`, `"boards"` and `"vars"`.
  - `look` is a design id per SURFACE: `x0` (the X0 widget), `board` (the spare "X0 Board" kind, WidgetBoard1 only) and
    `bots` — "Bots at work" on THIS phone, which is the Live Activity's design on iOS (needs `NATIVE_ACTIVITY`) and the
    ongoing notice's on Android (needs `ANDROID_BOTS_NOTICE` and a `LiveUpdate1` build). One surface per platform, so one
    key. **The glance is the only place `bots` is named.** On iOS the app's own in-process updates can set it from nowhere
    else, so without it every local update would clear what the last APNs push named and the views would flap; on Android
    the binary reads it from the stored glance and ignores anything a push says.
  - `vars` is a free map of things a design may bind that the glance has no field for (today: `moved` and `since`, both
    numbers the server counted, so both are safe on a Lock Screen).
  - `boards` is `[{ id, name }]`, at most 12: what the "X0 Board" widget's own settings offer, already in this person's
    language and already filtered to what this phone can draw. `board.base` is not in it — the widget lists "Overview"
    itself — and a board with no name is left out. Neither phone may make a name out of a design id.
- **A design is named only when all four are true**: the build says it can draw the format, the design's `since` is at or below
  that phone's `nl`, the design is for this surface and platform, and this person has not reported it bad. Otherwise the
  `fallback` chain is walked, and otherwise no `look` is sent at all.
- **`POST /v1/widgets/activity-token`** gains `nl` too, so a Live Activity push can name a design that phone holds. The push
  then carries `look` and `vars` in the content state (both optional and leniently decoded), and the whole body is measured
  and trimmed to 3.5 KB — `vars` first, then the stage names (`src/experience/native/size.ts`). A push has no request to ask
  on, so it asks `target.ts` itself, with the same `bad` list the glance uses; a test asserts the two agree.
- **There is no `?preview=`.** An internal account is named in a targeting rule's `when.users`, which reaches the widgets,
  the Live Activity and the Android notice alike, because all four surfaces ask through `pickDesign` with a `userId`. A query
  parameter reached only the glance, and the server honoured it for any signed-in account.
- **The bootstrap's `native.looks` flag goes only to someone a rule could name**, because that flag is what starts the whole
  sync (fetch the catalog, fetch the art, draw the bot stills, write a version folder). With `targets` empty, turning
  `NATIVE_LOOKS` on starts that on nobody.
- **`POST /v1/widgets/activity-start-token`** keeps the person's push-to-start token (iOS 17.2+, `ACTIVITY_PUSH_START`), so
  "Bots at work" can begin on the Lock Screen while the app is shut. One per person, never a second banner.
- **`POST /v1/widgets/looks/bad`** is how a phone says a design killed a widget. The server stops naming it for that person.
- **Android** has no Live Activity and now has an ongoing notice instead (`ANDROID_BOTS_NOTICE`): the same content state, sent
  as a data-only push with no title and no body, drawn by the phone (`src/widgets/notice.ts`). The push carries the state and
  NOTHING ELSE — its design is `look.bots` on the glance, and its language is the profile's, as for every other push. Nothing
  about a phone is remembered in `widget_glance` for it: an `nl` kept per PERSON would let an iPhone's glance set the number
  an Android notice is judged by, and it could only ever go up, which after a reinstall is the one direction that breaks the
  promise that a phone is never named a design it does not hold.

## 7. Widgets kept and retired

Retired: The Month (words left) and Needs you — removed from the widget bundle / manifest. Kept: From your people
(restyled), the Dictate control, the Setup and mic-session Live Activities.
