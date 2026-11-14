# The phone's own things: what the server's half does

What the phone can do that the server cannot, each behind one tap, each off until its own switch is turned on. The whole
design, with the store forms and the native work, is in the perms SPEC (build 8.9's three) and the perms2 SPEC (build 8.9.1's
seven); this is the server's half, so the next person to touch one of these files can see at a glance what holds it together.

| | the person does | the permission | what reaches this server |
|---|---|---|---|
| **Use my location** | taps *Use my location* on Plan Ease's "Where does your day start?" card | location **while using**, approximate | the **area's name** ("HSR Layout, Bengaluru"), after they read it and tap Save. **Never a coordinate** |
| **Add from contacts** | taps *Add from contacts* on a space's Invite page, or on Spaces' start screen | **none** — the phone's own picker | the **one email** they tapped, when they tap *Send the invite*, exactly as a typed one |
| **Count my workouts** | turns on the row on a fitness bot they made | health: **read** daily steps and workouts | `{day, steps, workouts:[{kind,minutes}]}` for that one bot |
| **Add to my calendar** (8.9.1) | taps it on a plan item | **none** — the phone's own event editor | **nothing**: only the outcome's name ("saved", "cancelled", "opened") |
| **Plan around my calendar** (8.9.1) | turns on the row on Plan Ease | calendars, **full access** on iPhone (iOS offers no read-only grant); `READ_CALENDAR` on Android, which is read-only | **busy times only** for 14 days: `[{s, e, allDay}]`. Never a name, place, note, person or calendar name |
| **Sync with Reminders** (8.9.1, iPhone only) | turns on the row on Plan Ease | reminders, **full access** (no write-only grant) | the **one X0 Bot list**'s items: title, due date, done. No other list |
| **Hold calls during a Focus** (8.9.1) | adds X0 Bot's Focus Filter in Settings (iPhone), or turns the row on (Android) | **none** on either phone | `{on, hold, source}`. **Never which Focus** |
| **Count my steps** (8.9.1) | picks it instead of Apple Health / Health Connect on a fitness bot | Motion & Fitness (iPhone); `ACTIVITY_RECOGNITION` (Android) | the health payload, with `source: "motion"`. The bot keeps that reader (`skills.healthSource`), so the quiet re-read asks the same one and its row says so. **Android sends daily steps and no workouts at all** |
| **Wait while I'm driving** (8.9.1) | turns on the row under Calls | the same Motion grant on either phone | **one word** before a call: driving, or not (on Android, sometimes neither). Not kept past that call. The switch also sends `motion.watch`, which is what registers and unregisters Android's car detection |
| **Also count my sleep** (8.9.1) | turns on the sub-row, health already on | Apple Health sleep / Health Connect `READ_SLEEP` | `sleepMinutes` per night. No stages, no bed or wake times |
| **Remind me when I get there** (8.9.1) | turns on the switch on a plan item with a place | location **while using**, Precise (iPhone); precise **and** "Allow all the time" (Android, where a geofence wakes the app — Play's background-location declaration) | **nothing comes back**. The place goes OUT; the phone watches it and shows the reminder itself |

## The six rules this code keeps

1. **No dark declarations.** Every usage string and Android permission in the binary has a working screen in the same binary.
   `tests/perm-words.test.ts` fails if `app.config.ts` grows a key (Contacts, Always location, motion, Health write) that no
   screen here uses, and `tools/media/store/check-listing.mjs` (in the phone repo) fails if the store documents still say a
   thing is "not collected" while the build has it.
2. **One card before every system prompt, Continue and no second choice** (App Review 5.1.1(iv)). The cards use `permitStep`
   with a `cta` and no `quiet`; the way out is not tapping. The contact picker has **no** card: there is no prompt to
   introduce. Words: `src/experience/bots/screens/permitWords.ts`.
   **Exactly one card, though, which is the phone's half.** On a player that declares `primed` in its capabilities, a
   `requestPermission` without `primed: true` gets that player's OWN box first ("One permission first", one Continue)
   whatever tree we sent, so an ask fired by a rule, a switch or a screen appearing is explained even when we forgot to
   explain it; its words are `perm.<permission>.title` / `.body` from the bootstrap (`experience/appKnobs.ts`
   `PERM_CARD_LABELS`). `primed: true` says this screen has already explained THIS permission and its Continue is what
   fired the ask, so the phone goes straight to the system. Set it nowhere else: `shared/types/sdui.ts` has the rule,
   `tests/primed.test.ts` walks the built screens and refuses the rest both ways — an ask our own card fired must carry
   it, and nothing else may — and `scripts/bots-render/primed-shots.mts` draws every screen either side of the line.
   A player that declares nothing (the window, and any build older than the field) has no box at all, so an ask there has
   only what the screen said: read a permission before asking for it where the answer may already be on record
   (`checkPermission`), rather than asking and drawing a card over nothing.
3. **No raw value enters the screen's state.** The coordinate never reaches JavaScript at all (the native function returns
   address parts); health numbers go from the phone's action straight to the POST. State holds the area's **name**, the chosen
   **email**, and nothing about health.
4. **Health never reaches an AI service.** Held up by the import graph, not by care: `src/bots/healthDays.ts` may be imported
   by a short list of files and `tests/health-never.test.ts` names them all. `bots/run.ts`, `bots/memory.ts`, `bots/shared.ts`,
   the prompts, the tools and the push builders are on the other side of that line, so no model, notification, widget or
   advertising event can reach a step count. **`bots/service.ts` and `routes/bots/bots.ts` are on that side too**, although
   they are where a bot is written and asked: the first runs the models and the second hosts `POST .../ask`, so the health
   work lives in `bots/healthService.ts` and `routes/bots/botHealth.ts` instead, and the test names both files on its NEVER
   list. `Bots` is lent two closures by `attachHealth()` (`bots/index.ts`) so it can DELETE days it may not read.
5. **The binary says what it can do.** `Location1`, `ContactPick1`, `Health1` are declared by the phone's own check that the
   native module is there. An over-the-air update on an older binary declares none, so `canLocate` / `canPickContact` /
   `canHealth` draw nothing there. The window never gets any of the three.
6. **Launch dark.** `PERM_LOCATION`, `PERM_CONTACT_PICK`, `PERM_HEALTH_IOS`, `PERM_HEALTH_ANDROID` and the two `_USERS` lists
   all ship off (`src/config.ts`), and so do build 8.9.1's: `PERM_CALENDAR_ADD`, `PERM_CALENDAR_READ`, `PERM_REMINDERS`,
   `PERM_FOCUS`, `PERM_MOTION`, `PERM_MOTION_DRIVE`, `PERM_HEALTH_SLEEP_IOS`, `PERM_HEALTH_SLEEP_ANDROID` (+ `_USERS`) and
   `PERM_ARRIVAL` — and so do the four ANDROID HALVES, which are a second switch each and not a replacement:
   `PERM_CALENDAR_READ_ANDROID`, `PERM_MOTION_ANDROID`, `PERM_MOTION_DRIVE_ANDROID` and `PERM_ARRIVAL_ANDROID` (+ `_USERS`).
   `experience/bots/kit.ts bothOn()` weighs the shared switch AND, on an Android client, the platform's own, so turning a row
   on for iPhone people never turns it on for Android people whose binary cannot do it. A server deployed before the store
   build draws nothing and stores nothing.

## Where each piece lives

**The contract** — `shared/types/sdui.ts`: the actions `location.area`, `contact.pick`, `health.sync`, and the three
capability names. `health.sync`'s `path` is pinned on the phone to `/v1/bots/<slug>/health/days`, so a screen bug can never
send health data to a route that reaches a model.

**Location** — `experience/bots/screens/botsPlaces.ts` `locatePart()`: the button, the card, the *Is this right?* step and the
denied/blocked lines. No new route: Save is the `PUT /v1/botsapp/bots/plan/home` a typed area has always used, which calls
`planTravel.setHome` (and clears on an empty value, which is Forget).

**Contacts** — `screens/spaces/pickContact.ts` (the button), `screens/spaces/parts.ts` `mailPreview()` (the preview), and
`botsBots/inviteMail.ts`, the one pure function that writes both the preview and the mail, so App Review 5.1.2(v)'s "how the
message will appear to the recipient" cannot drift from what is sent. A space's preview comes from its own draft or space
row; on Spaces' start screen **before the first Invite there is no draft at all**, and the very first invite a person sends
is exactly the one the rule is about, so `GET .../spaces?full=1` also carries `mailPreview` from `Spaces.blankPreview()`,
the same function with the words standing in for the space, the code and the address. Retention:
`botsBots/inviteSweeper.ts` deletes an invite seven days after it expires and an outbox row seven days after it was queued
once it is sent, failed, cancelled — or still `sending`, which is a send that crashed mid-way and would otherwise hold an
address for ever. Only `queued` is left alone, however old. `forgetInvitesOf()` takes both with the account (neither went
with it before: an invite cascades from its space, an outbox row from nothing).

**Health** — the switch is `BotSkills.health`, and **only** `POST /v1/bots/:slug/health/days { enable: true }` ever sets it:
`create`, `approve`, `draft`, `test`, a Find-a-bot copy and a store listing force it false, `update` (PUT, PATCH, link,
unlink) refuses false-to-true with a 409 and allows true-to-false, which deletes the days in the same request — and a patch
that is exactly `{ skills: { health: false } }` takes a straight path that skips the usual parse and check, because the row
promises the deletion and a bot whose connected app has since gone away must still be stoppable. The store is
`bots/healthDays.ts` over `bot_health_days` (migration 0090), swept at 31 days, in the data download, removed by Delete my
data and by account deletion. Which switch a POST is weighed against — `PERM_HEALTH_IOS` or `PERM_HEALTH_ANDROID` — comes from
the body's `platform` when it has one and from the request's agent when it does not (as `routes/ask/assistant.ts` reads it), so
an Android phone can never come in through the iPhone's switch while Health Connect is still off for everyone. Which bots get the row: `bots/door.ts` `isFitnessBot()`, a word test through the same stemmer
on both sides, so "Profit tracker" and "Outfit picker" do not match. The screen half is
`screens/bots/health.ts`: the row, its card, and the Moves line on the bot's page. Two things there are deliberately NOT
behind `canHealth`:

- **the off-only row.** A bot that is already counting keeps a way to stop on every client and whatever the switches say
  (the policy promises "from the bot's edit page"), because the switch can go off under a person's feet — Google refuses
  the form, their account leaves the list, or they are reading on the window. It names no source and does nothing but the
  off PUT. Only the off-to-on path needs the capability, the switch and a fitness name.
- the quiet re-read **is** behind it, and must stay so: with the switch off the phone would read Apple Health or Health
  Connect on every visit and POST days the route answers 403. Its `onDenied` sets `healthNotHere`, which draws a line
  under Moves rather than letting the page count nothing while the row still says on.

The Moves counts come from `GET /v1/bots/:slug/health/moves`, their own route, and `Moves.lastDay` is the phone's own day
KEY, not a timestamp: a timestamp is read back through the reader's offset and lands a day out everywhere but Greenwich.

**Why `page({ keep: false })`** — the phone writes every page with a cache time to AsyncStorage, which goes into the device
backup and so into iCloud. A page that draws a health number passes `keep: false` and is sent `cacheTtlSeconds: 0`. Per page,
not per screen id: another bot's page is kept as before.

**The words** — `screens/permitWords.ts`, `routes/site/policies/privacy.ts` (sections 1.5 and 1.5.1), `docs/store-privacy.md`
and, in the phone repo, `app.config.ts`'s usage strings and `docs/store-listing.md`. `tests/perm-words.test.ts` pairs them.

## Build 8.9.1's own files (docs: perms2)

**The contract** — `shared/types/sdui.ts`: the actions `calendar.editor`, `calendar.sync`, `reminders.sync`, `focus.sync` and
`arrival.sync`, `motion.watch`, `health.sync`'s `source` and `sleep`, `requestPermission "motion"` and
`"backgroundLocation"`, `arrival.sync`'s `onBackground`, the ten capability names, and `TrustAsk`.
Each `path` is pinned on the phone to one route, as `health.sync`'s is, so a screen bug can never send busy times, reminders
or a focus state to a route that reaches a model.

**Busy times** — `botsBots/planBusy.ts` (the store, the bounds reader, the overlap test and the sweeper) and
`routes/bots/planBusy.ts` (`POST`/`DELETE /v1/botsapp/plan/busy`). The blocks are read by `botsBots/planEase.ts` alone, which
turns an overlap into one grey line ("This overlaps something in your calendar") and lets `planCall.ts` answer a ring with a
notice instead. Table `plan_busy` (0094), RLS on with no policy, swept a day after each block ends.

**Reminders** — `calendar/remindersSync.ts` is the whole merge, PURE: two lists in, `{ops, writes}` out. The route
(`routes/bots/planReminders.ts`) applies the writes through the ordinary calendar service and answers the ops. A to-do's link
is `calendar_tasks.ext_src/ext_ref` (0094): `ext_src` set means the to-do CAME from Reminders, which — with the to-do still
being OPEN — is what decides whether deleting the item deletes the to-do or only unlinks it (a to-do already ticked is only
out of the phone's 7-day read, which is not a deletion). The other way round needs a memory of its own: once a to-do is
deleted here nothing is left to say its item ever had one, so `Calendar.removeTask` writes the item's identifier to
`reminders_gone` (0094, `calendar/remindersGone.ts`) and the next merge takes that item out of the list and forgets the mark.
ONE SYNC IS TWO REQUESTS TO ONE PATH: the contract pins one path for `reminders.sync`, so `{applied}` with no `items` is
taken on `.../reminders/sync` as well as on `/applied`.

**Focus** — `widgets/focus.ts` holds the reader and the writer, and two doors send the same two words to it: the iPhone's own
Focus Filter through `POST /v1/widgets/focus` with the widgets' token and its new `focus.set` scope, and the app through
`POST /v1/botsapp/plan/focus` with the session. `plan_prefs.focus` keeps `{on, hold, source, until}` for 12 hours at most.

**Motion, sleep and the pre-ring check** — `bots/healthDays.ts` gains `source` and `sleepMinutes`; `bots/healthGate.ts` gains
`sleepAllowed`, the sleep row's own pair of switches; `bots/healthService.ts` keeps the same lock on `skills.healthSleep` that
`skills.health` has (only the POST with `sleep: true` sets it, every other write path forces it false, and turning it off nulls
the nights in the same request). `botsBots/planCallCheck.ts` is the check itself: one silent push to a binary that said
`CallCheck1`, a wait of 20 seconds, the pure `holdOf()` decision, and the hold list that turns a held call into a notice.
**No answer always means ring**, exactly as today — and, for the same reason, a hold with no way to ask again STANDS until the
hour is up rather than being freed by a silence. Which reader a bot's days come from is `skills.healthSource` (0094), written
only by the enable POST: the quiet re-read asks for that one, carries `sleep: true` for a bot that counts nights, and a Motion
bot is offered no sleep row at all. A follow-through ring counts as must-not-miss, so a Focus or a busy block never holds it.

**Arrival** — `botsBots/planEase.ts` `armedArrivals()`: at most 10, nearest in time, each an event of the person's own with
`arrive` on (0094) and a place this server can point at. A place not looked up YET is not a place we cannot find: the lookups
missing are made in the background (`botsBots/look.ts`) and `arrivalsPending` stops the sync replacing the phone's set that
round, because `arrival.sync` REPLACES what the phone watches. The set goes out on every page appear
(`screens/bots/planHome.ts` `arrivalSync`) and with the item's own card, each item pointing at `bots.plan` (the home takes no
params; the phone hands `userInfo` straight in as the screen's). **No route ever receives a coordinate**, and the item's own
PUT carries `arrive` alone, never `tz`, so turning the switch on cannot move the event.

## Turning them on

Every switch ships off. The order, and the account lists, are in the owner's checklist (the perms OWNER file). An account list
exists for one reason: between the first build that carries a thing and the store's own approved list reaching it (5-7 working
days after approval, for Health Connect and for Play's background-location review), the reviewer must still be able to reach
the row the declaration is for, and nobody else should. Seed that account's space and bot with
`npx tsx scripts/seed-review-account.ts <account id>`.

**The Android halves are a second switch, not a replacement.** `PERM_CALENDAR_READ_ANDROID` can go on as soon as an Android
build carries `TULMI_ANDROID_CALENDAR` (no store declaration at all). `PERM_MOTION_ANDROID` needs `TULMI_ANDROID_MOTION`, and
`PERM_MOTION_DRIVE_ANDROID` is separate from it on purpose: Android's "in a car?" answer is often neither word, so shipping the
steps and leaving the driving check off is an honest move — and `PERM_MOTION_DRIVE` must not be the thing turned off instead,
because it is shared with the iPhone, where the answer is good. `PERM_ARRIVAL_ANDROID` waits for Play to approve the
background-location declaration AND for a build carrying `TULMI_ANDROID_ARRIVAL`; `PERM_ARRIVAL_ANDROID_USERS` covers the stage
in between.
