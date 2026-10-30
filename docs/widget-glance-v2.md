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

## 2. GET /v1/shell/glance?v=2&tz=<minutes>

Signed-in person's own. `v` absent → today's v1 shape, unchanged (older builds). v2:

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
      "faceUrl": "https://api.x0bot.com/blip/bots/head-code.png?v=7",                  // or null (a person's bot without art)
      "state": "needs", "needs": 1, "working": true,                                   // state: needs|working|done|failed|idle
      "line": "fixing cart", "link": "tulmi://screen/bots.code" }
  ],
  "more": 3,                        // bots beyond the 8 sent
  "needs": {
    "count": 2,
    "items": [                      // ≤ 3, oldest first
      { "id": "q_…", "kind": "question",            // the SAME id and kind as /v1/widgets rows, so POST /v1/widgets/act answers it
        "bot": "code", "botName": "Code bot", "face": "code",
        "question": "Round the cart total per item, or once at the end?",
        "choices": [ { "id": "a", "label": "Per item", "primary": true }, { "id": "b", "label": "At the end" } ],
        "decideLink": "tulmi://screen/bots.thread?id=…",   // "You decide" / open it
        "private": false, "answerable": true, "link": "tulmi://screen/bots.code" }
    ]
  },
  "job": {                          // the Code bot job running now, or null
    "id": "j_…", "bot": "code", "task": "Fixing cart", "stage": 3, "of": 5, "stageName": "Build",
    "stages": ["Understand", "Plan", "Build", "Check", "Ship"], "startedAt": 1793346880000, "link": "tulmi://screen/bots.code.job?id=…"
  },
  "lastDone": {                     // the newest finished thing not yet seen (≤ 2 h old), or absent
    "id": "j_…", "bot": "code", "botName": "Code bot", "result": "Cart fix is ready", "endedAt": 1793349000000,
    "minutes": 58, "pr": { "number": 131, "url": "https://github.com/…/pull/131" }, "link": "tulmi://screen/bots.code.job?id=…"
  },
  "counts": { "working": 2, "needs": 2 },
  "lock": { "inline": "Code bot needs you", "title": "Code bot needs you", "line": "Round the cart total per item…" },  // lock-screen-safe (private → no question words)
  "links": { "ask": "tulmi://screen/bots.ask", "home": "tulmi://", "mic": "tulmi://screen/bots.ask?voice=1" },
  "words": { "needsYou": "Needs you", "ready": "Ready", "ask": "Ask any bot…", "brand": "X0", "youDecide": "You decide",
             "working": "{n} working", "step": "Step {stage} of {of}", "minIn": "{n} min in", "seePr": "See the PR", "done": "Done" }
}
```

`case` priority: needs (count > 0) → done (lastDone present) → working (a bot working or a job) → quiet.
Answers: the widget posts the existing `POST /v1/widgets/act` with the item id/kind and the choice id, on the existing widget token.

## 3. Situation lines (summary when no AI digest)

Chosen by the server from a small table: situation × part of day (morning/afternoon/evening/night), en + Hinglish, slots
{name} {bot} {task} {n}. Situations at least: first look of the day; things moved since last look ({n}); a bot just
finished ({bot}, {task}); several bots working ({n}); one long job running; nothing at all for a long time; weekend.
Server knobs (copy editable without a build).

## 4. AI digest (optional, flag `WIDGET_DIGEST`, default off)

When 3+ things changed since the last glance, one short line (≤ 60 chars) summarising them, from the cheapest model via the
model gateway, written once per change and cached per user; validated for length; never includes private questions; falls
back to §3.

## 5. Storage on the phone

- iOS: the app writes the v2 JSON to the App Group (same suite/pattern as today's widget docs) under key `x0.glance`, and the
  face images to the App Group container `faces/<face>.png` (downloaded from faceUrl; the extension never fetches the network).
  Then reloads timelines for kind `space.tailzu.x0`.
- Android: SharedPreferences (same file as today's widget docs) key `x0.glance`, faces in the app's files dir
  `widget-faces/<face>.png`; then updates the provider `TailzuX0Widget`.

## 6. "Bots at work" Live Activity (iOS 16.1+)

ActivityAttributes `BotsAtWorkAttributes { jobId }`, ContentState
`{ bot, botName, face, task, stage, of, stageName, stages[], startedAt, phase: "working"|"needs"|"done", question?, choices[]?, result?, pr?, link }`.
The app starts it when glance v2 has a `job` and none is running for that job, updates it on every glance, ends it on
`lastDone` (showing the done state for ≤ 15 min, then dismissal). Bridge (modules/tulmi-bridge): `startBotsActivity(json)`,
`updateBotsActivity(json)`, `endBotsActivity(json)` (no-ops on Android), `botsActivityPushToken(): string | null`.
Server push (optional, off until configured): APNs Live Activity pushes for the same ContentState, env
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8` (the key's contents), `APNS_TOPIC` (bundle id + ".push-type.liveactivity"),
`APNS_ENV` (production|sandbox); the app registers the activity's push token at `POST /v1/widgets/activity-token`.

## 7. Widgets kept and retired

Retired: The Month (words left) and Needs you — removed from the widget bundle / manifest. Kept: From your people
(restyled), the Dictate control, the Setup and mic-session Live Activities.
