# Quick access from outside the app

Four ways to reach X0 Bot without opening it, all decided by the server, each with today's values kept in the apps as fallbacks:

1. **From your people**: a Home Screen widget (small, medium, large) and a Lock Screen rectangle on iOS, and a home widget on
   Android. Shows the latest few things from family and friends ("Riya shared Weekend plan", "Mom: Call Grandma · task", "Sam:
   running late"), each with a deep link.
2. **Needs you**: the same sizes, with buttons. A bot's question with its answers, a yes a connected app is waiting for, and a
   task someone gave you with Done.
3. **A notification's buttons**: Reply inline to a Spaces message, Done on a task, Yes or No on a waiting yes.
4. **Long-press the app icon**: Ask, Dictate, New note and Spaces (iOS Home Screen quick actions, Android app shortcuts).

The universal **X0** widget (it replaces Needs you and The Month) and the "Bots at work" Live Activity read
GET /v1/shell/glance?v=2 and answer through POST /v1/widgets/act below: their contract is [widget-glance-v2.md](widget-glance-v2.md).

The code is in `tulmi/src/widgets`, `tulmi/src/routes/widgets.ts` and `tulmi/src/push`. The apps' side is in
`TAILZU-FRONTEND/app/src/{widgets,notifications,quickActions}`, the widget extension `app/targets/widgets` (its README lists every
App Group key), and the bridge `app/modules/tulmi-bridge`.

* [1. The data flow](#1-the-data-flow)
* [2. GET /v1/widgets/now](#2-get-v1widgetsnow)
* [3. The widgets' own token](#3-the-widgets-own-token)
* [4. POST /v1/widgets/act](#4-post-v1widgetsact)
* [5. A notification's buttons](#5-a-notifications-buttons)
* [6. The app icon's long press](#6-the-app-icons-long-press)
* [7. Every knob](#7-every-knob)
* [8. Tests, and what needs a device](#8-tests-and-what-needs-a-device)

## 1. The data flow

```
server  GET /v1/widgets/now ──► app (launch, coming to the front, a push arriving, after an answer; at most every fetchSec)
                                 │  checks it (nowCore.cleanNow): its version, every link this app's own, every button known
                                 ▼
        App Group "tulmi.widget.now" (iOS) / SharedPreferences "tulmi.widget" (Android), then a widget redraw
                                 ▼
        the widgets draw it; their timeline asks again after refreshSec
        a Needs you button ──► POST /v1/widgets/act with X-Widget-Token ──► the row says how it went until the next write
```

The widgets never fetch rows themselves. There is no silent push to wake the app (the app has no `remote-notification` background
mode), so a widget is as fresh as the app's last write plus its own timeline. Every push that reaches a running app, and every
answer from a notification, refreshes it.

## 2. GET /v1/widgets/now

Signed in with the session. Query: `tz` (minutes east of UTC) and `platform` (`ios` or `android`, for the control plane's rules).
Answers `NowDoc` (`src/widgets/now.ts`; version `v: 1`, which only ever gains fields):

```jsonc
{
  "v": 1, "rev": "a1b2c3d4e5f6", "at": 1793269058091, "refreshSec": 900, "fetchSec": 60, "time": "relative",
  "look": { "colors": {…}, "alpha": {…}, "styles": {…}, "kinds": {…}, "people": {…}, "needs": {…} },
  "act": { "path": "/v1/widgets/act", "inPlace": true },
  "people": {
    "on": true, "title": "From your people", "url": "tulmi://screen/bots.spaces", "icon": "person.2.fill", "androidIcon": "tailzu_wi_spaces",
    "limits": { "small": 2, "medium": 3, "large": 6, "lock": 0, "android": 4 },
    "rows": [{ "id": "msg:<thread>:<message>", "kind": "message", "who": "Sam", "initial": "S", "text": "running late",
               "line": "Sam: running late", "tag": "", "detail": "Home", "at": 1793269000000, "when": "4m",
               "url": "tulmi://screen/bots.thread?id=<thread>", "private": true, "new": true,
               "icon": "bubble.left.fill", "androidIcon": "tailzu_wi_chat" }],
    "count": 1, "newCount": 1, "lock": { "line": "1 new from your people" },
    "empty": { "title": "Your people, here", "body": "Make a space…", "cta": "Make a space", "url": "tulmi://screen/bots.spaces" }
  },
  "needs": { …the same, rows with "actions": [{ "id": "a0", "label": "Per item", "style": "primary", "mode": "inPlace" }, …],
             "words": { "done": "Done", "sent": "Sent", "working": "Sending…", "failed": "Open X0 Bot to finish", "gone": "Already answered" } }
}
```

**Where the rows come from** (`routes/widgets.ts` `gather`):

* From your people:
  * the newest message from someone else in each of the person's newest chats (`Threads.recentFrom`, which reads without
    marking anything read, and leaves out the person's own messages, blocked people, and muted chats unless
    `widgets.people.includeMuted`);
  * what others shared in their spaces (`SharedItems.list`);
  * tasks and plans someone gave them that are still to do (`SpaceTasks.givenTo`, with `givenAt`).
* Needs you:
  * a Code bot job's question with its answers (`jobLite`);
  * a connected app's call waiting for a yes (`connectors.tasks.list`);
  * the tasks given to them.

These are the same records Home's "Needs you" card reads (`experience/bots/live.ts`).

**Private by design.** A row carries what the person's own app would show them, and no more. It has no amounts, and no ids except
its own opaque `id` and its link. A message's words appear only while `widgets.people.messageText` is on. The kinds listed in
`widgets.people.private` / `widgets.needs.private` are marked `private`: by default a message, and everything in Needs you. The Lock Screen draws only `lock.line`. On iOS, `private` text is `.privacySensitive()`, so StandBy and Always-On redact
it.

## 3. The widgets' own token

A widget's button runs outside the app (iOS: an App Intent in the widget extension; Android: a broadcast with no session at hand).
**The session's token is never put where a widget can read it.** Instead (`src/widgets/token.ts`, migration 0058 `widget_tokens`):

* `POST /v1/widgets/token { device }` (with the session) issues `xwt_` + 32 random bytes for this phone and answers
  `{ token, expiresAt, scopes, renewAt, path }`. A new token for the same phone revokes its last one. Past
  `widgets.token.maxPerUser` phones, the oldest is revoked. Only the SHA-256 of the token is kept.
* **Narrow.** Scopes are `needs.answer` and `task.done`. The token is read only from the `X-Widget-Token` header of
  POST /v1/widgets/act. It is not a JWT, so `resolveUser` refuses it on every other route.
* **Short-lived.** It runs out after `widgets.token.ttlMin` (a day). The app asks again once `widgets.token.renewAt` (half) of
  that has gone, on launch and on coming to the front.
* **Revocable.** `DELETE /v1/widgets/token { device? }` revokes this phone's token, or all of them. Signing out sends it before the
  session goes. Deleting the account deletes the rows.
* **Kept** in the shared Keychain on iOS (the bridge's `TulmiKeychain`, account `tulmi.widget.token`, this device only), and in the
  app's private SharedPreferences on Android.
* When `widgets.token.enabled` is off, the endpoint answers `{ token: null }`, the app deletes its copy, and every button opens the
  app.

We chose this over an App Intent that only opens the app (`openAppWhenRun`) because Yes and Done then take one tap with the app
shut. The server can still send any kind back to opening the app, per kind (`widgets.needs.modes`) or for all of them
(`widgets.token.enabled`).

## 4. POST /v1/widgets/act

Body `{ item, action, text?, key? }`. Auth is either `X-Widget-Token` or the session, never both read as one. The same door
serves a widget's button, a notification's button and a reply typed into a notification (`src/widgets/act.ts`):

| item (`src/widgets/items.ts`) | action | does | scope |
| --- | --- | --- | --- |
| `job:<id>:<q>` | `a0`, `a1`… | answers a Code bot question with its own first, second… answer. `<q>` fingerprints the question, so a stale button never answers the next question. | `needs.answer` |
| `task:<id>[:<approval>]` | `yes`, `no` | approves or denies a connected app's waiting call (`connectors/tasks.ts`) | `needs.answer` |
| `stask:<space>:<task>` | `done` | ticks the person's own part of a space's task (`SpaceTasks.answer`) | `task.done` |
| `thread:<id>` | `reply` + `text` + `key` | sends a message (`Threads.send`) | session only |

**Checks.** Every service checks the item again: is it the person's own, may they write there, is it still waiting? A widget
token may act only within its scopes, and only where `widgets.needs.modes` says `inPlace`. A connected app's yes is given from
outside the app only at the risks in `widgets.needs.inPlaceRisks` (`read`, `write` and `send` by default; never `pay` or
`destructive`). That rule holds for a widget and for a notification alike.

**Once.** Each answer is claimed under its key: the app's own per-tap key, or `item|action`. A reply must bring its own key. A
retry of an answer that went through gets the first result with `repeat: true`. A retry while the first is still running gets
`409 in_progress`. A failure is let go, so trying again really does try again. Results are kept for seven days (migration 0058
`quick_actions`).

**Answers.** `200 { ok, state }` on success. Otherwise one of:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | the request is malformed |
| 401 | `widget_token` | the widget token is gone |
| 403 | `not_allowed` / `open_app` | outside the token's scope, or the server wants it answered in the app |
| 404 | | the item isn't there |
| 409 | `not_waiting` / `changed` | already answered, or the question changed |
| 410 | | the request ran out |

The person's open screens are told (`livePublish`).

## 5. A notification's buttons

* **The server sets a category per push kind**: `push.<kind>.category` (push/defaults.ts). Today these are:

  | Push kind | Category |
  | --- | --- |
  | `space_message` | `x0_reply` |
  | `space_task`, `space_plan` | `x0_task` |
  | `approval` | `x0_yesno` |

  The engine sends `categoryId` to Expo and adds `data.item`, the item the buttons answer. A kind with no category gets no
  buttons. Any other kind can be given one, for example `push.plan_reminder.category`.
* **The categories' buttons are the app's bootstrap knob `push.categories`**, registered on launch whenever they change, so a new
  category or a renamed button needs no release. Each button has:
  * a title;
  * a text field (placeholder and send label);
  * `foreground`, `destructive` and `auth` (unlock first; on for Yes by default);
  * what it does: `act` (this endpoint, with the session), `open`, or `call` (any of the app's own `/v1/` endpoints, filled from
    the push's data).
* **Sending.** A press is written down first, then sent. If the phone is offline, or the app was put away first, it goes again
  on the next foreground with the same key, so the server does it once. A refusal is not retried: a quiet notification says to
  finish in the app.
* **iOS** asks for background time while it sends (the bridge's `beginBackgroundWork`).
* **Android** runs a press with the app closed in an expo-task-manager task (`src/notifications/backgroundTask.ts`), switched by
  `push.actions.backgroundTask`.

## 6. The app icon's long press

The bootstrap knobs `app.quickActions.ios` and `app.quickActions.android` are lists of `{ id, title, subtitle, icon, url, arm? }`
in order, capped by `app.quickActions.max` (four at most) and switched by `app.quickActions.enabled`. The app applies the list on
every launch, and only when it changed. Today's four are:

| Shortcut | Opens |
| --- | --- |
| Ask | `bots.ask` |
| Dictate | on iOS, the Flow arming screen, through the keyboard's App Group tombstone as the Dictate control does (a link may never open a microphone screen); on Android, `bots.keybot` |
| New note | `bots.plan.item?kind=task` |
| Spaces | `bots.spaces` |

The icons are SF Symbols on iOS and `tailzu_qa_*` drawables on Android.

## 7. Every knob

**The server's `widgets` surface** (`src/widgets/defaults.ts`; the control plane can edit it per person, platform, language, share
or date, and preview it in the console):

| Group | Knobs |
| --- | --- |
| Kill switches | `widgets.enabled`, `widgets.people.enabled`, `widgets.needs.enabled`, `widgets.token.enabled` |
| The token | `widgets.token.ttlMin`, `widgets.token.maxPerUser`, `widgets.token.renewAt` |
| Timing | `widgets.refreshSec`, `widgets.fetchSec`, `widgets.time` |
| Links | `widgets.link.base`, `widgets.links` (`message`, `shared`, `task`, `plan`, `question`, `approval`, `people`, `needs`, `peopleEmpty`, `needsEmpty`) |
| From your people | `widgets.people.kinds`, `.sort`, `.max`, `.limits`, `.windowDays`, `.newHours`, `.messageText`, `.private` (kinds whose words are redacted while locked), `.includeMuted`, `.chats` |
| Needs you | `widgets.needs.kinds`, `.sort`, `.max`, `.limits`, `.private`, `.optionsMax`, `.inPlaceRisks`, `.actions` (per kind), `.modes` (per kind) |
| Answering | `widgets.act.path` |
| The look | `widgets.look` (`colors`, `alpha`, `styles`, `kinds`, `people`, `needs`, optional `light`) |

Its labels:

| Labels | Covers |
| --- | --- |
| `widgets.people.*` | title, lock lines, empty state, `line.<kind>`, `tag.<kind>` |
| `widgets.needs.*` | title, lock lines, empty state, `from`, `done`, `sent`, `working`, `failed`, `gone` |
| `widgets.who.*` | who a bot's row is from |
| `widgets.action.*` | the buttons' words |
| `widgets.time.*` | how a time is written |

**The push engine**: `push.<kind>.category`.

**App knobs** (bootstrap; `tools/knobs/app-knobs.json`):

* `push.categories`
* `push.actions.enabled`, `.path`, `.keepHours`, `.maxTries`, `.backgroundTask`
* labels `push.actions.failedTitle`, `push.actions.failedBody`
* `app.quickActions.ios`, `.android`, `.max`, `.enabled`
* `widgets.now.enabled`, `.path`, `.fetchSec`
* `widgets.token.path`

## 8. Tests, and what needs a device

`npx vitest run tests/widgets.test.ts` covers:

* the endpoint's shape: rows, links, buttons, empty states, kill switches and modes;
* the token's narrow scope, expiry, revocation, the per-phone limit and hashing;
* answers that go through only once, the risk rule, and a stale question or approval;
* a reply's key;
* the item ids;
* categories per push kind.

The phone's pure parts have `node --test` tests: `src/widgets/nowCore.test.ts`, `src/notifications/categoriesCore.test.ts` and
`src/quickActions/quickActionsCore.test.ts`.

The native widgets, the notification categories on a real device, iOS quick actions and Android shortcuts all need a device check.
The frontend's widgets README and the release notes for this change list them.
