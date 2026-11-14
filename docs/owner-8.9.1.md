# Build 8.9.1: the owner's checklist, word for word

One file, both phones. It merges what SERVER_PERMS wrote for the iPhone and the store forms with what the ANDROID worker
wrote for Play (the old `OWNER-ANDROID.md`, now folded in here).

Everything below is **text to paste or a switch to flip**. **No key, token or password is in this file, and none ever should
be.** Every secret goes into `tulmi/.env` from an SSH session on the server — never through chat, a ticket, an email or the
repo. Section 1 says exactly how, for each one.

The design is `perms2/SPEC.md`; section numbers in brackets are its. **The version is 8.9.1 everywhere** — where the SPEC
still says 9.0, read 8.9.1.

**Every switch ships off, on both phones, and the three Android halves are not in the binary you upload. Before you press
Submit, do sections 2, 7 and 9, including 7's switch step: App Review must be able to reach every screen the new usage
strings and the review notes name.** Everything else here is what you do when you want one of the rest turned on, in the
order that costs you least.

---

## 0. The whole list, at a glance

| # | what | where | blocks the release? |
|---|---|---|---|
| 1 | The keys, into the server `.env` only | SSH | no (without a key, that check is simply skipped) |
| 2 | App Privacy: Other Diagnostic Data gains App Functionality | App Store Connect | **yes, before 8.9.1 ships** |
| 2 | Data safety: Device or other IDs gains Fraud prevention | Play Console | **yes, before 8.9.1 ships** |
| 3 | App Privacy: the Device ID row | App Store Connect | **yes, before 8.9.1 ships** (the binary's privacy manifest declares it, and TRUST_ATTEST=shadow starts collecting) |
| 4 | Data safety: the 8.9.1 rows, and two already-filed Ephemeral answers to correct | Play Console | with the release that carries each |
| 5 | Health Connect: the refile, with Sleep | Play Console | only before Android sleep goes on |
| 6 | The three Android halves, and Play's background-location review | Play Console | **no.** Each waits on its own build |
| 7 | App Store Connect on submit day | App Store Connect | **yes** |
| 8 | The `n0` proof build: what to run and what to measure | a phone | before any switch goes on |
| 9 | Re-seed the review account | SSH | **yes, before submission** |
| 10 | The switches, one at a time, after approval | `deploy/set-env.sh` | no |
| 11 | Two honest warnings | — | — |

---

## 1. The keys: into the server `.env`, and nowhere else

Each of these is a **secret**. None of them goes in this file, in a ticket, in chat, in Supabase, in a backup or in the repo.
Each goes into `~/tulmi/tulmi/.env` in an SSH session, written straight into the file so it is never printed or typed, and
then checked with `./deploy/set-env.sh --show <NAME>`, which prints only the word "set".

| key | what it is | how to put it in |
|---|---|---|
| `TRUST_HASH_KEY` | the key the network, email and install hashes are keyed with (32+ characters). Changing it forgets every count | `printf 'TRUST_HASH_KEY=%s\n' "$(openssl rand -hex 32)" >> ~/tulmi/tulmi/.env` |
| `APPLE_DEVICECHECK_PRIVATE_KEY` + `APPLE_DEVICECHECK_KEY_ID` | the **DeviceCheck key**: Apple Developer → Keys → + → DeviceCheck. `scp` the `.p8` to the server, then shred it. The team id is `APPLE_SIWA_TEAM_ID`'s | `printf 'APPLE_DEVICECHECK_PRIVATE_KEY=%s\n' "$(base64 -w0 AuthKey_XXXX.p8)" >> ~/tulmi/tulmi/.env && shred -u AuthKey_XXXX.p8`, then add the key id with `nano` |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT` | the **Play Integrity service account**: Play Console → App integrity → link a Cloud project → make a service account → download its JSON key. `scp` it, then shred it | `printf 'PLAY_INTEGRITY_SERVICE_ACCOUNT=%s\n' "$(base64 -w0 key.json)" >> ~/tulmi/tulmi/.env && shred -u key.json` |
| `PLAY_INTEGRITY_CLOUD_PROJECT` | the Cloud **project number**. **Not a secret** — it is in the app's own request | `./deploy/set-env.sh PLAY_INTEGRITY_CLOUD_PROJECT=<number>` |

Without a key, that one check is simply skipped, which is "no signal" and never a penalty against anyone. `TRUST_ATTEST`
stays `off` until you move it, and `TRUST` stays `off` until you move that.

**One deploy note that is not a key:** `tulmi/Dockerfile` now pre-creates `/data/trust`, where the daily network lists are
downloaded. That needs an **image rebuild**, not just a restart — without it the named volume is root-owned, the download
fails and every network reads "unknown".

---

## 2. Now, before 8.9.1 ships (the server half is already live)

### App Store Connect › App Privacy › Diagnostics › Other Diagnostic Data

Add the purpose **App Functionality** beside the Analytics it already has. Nothing else about that row changes.

> Why: the server half of abuse and fraud prevention looks at the **type** of network a request comes from (home, mobile,
> data centre, VPN, Tor) and how many accounts are made on it. Apple's App Functionality purpose covers "prevent fraud,
> implement security measures". Linked to the account: Yes. Used for tracking: **No**.

### Play Console › Data safety › Device or other IDs

Tick the purpose **Fraud prevention, security, and compliance** beside the ones already there (App functionality, Advertising
or marketing, Analytics). Leave "Shared" as it is: the advertising ID still goes to Meta; **the integrity answers and the
install number never go to anyone**. That purpose covers the attestation answers, the install number **and the network type
and keyed address hash the server half reads** — `docs/store-privacy.md` §2 lists all three and the Play row names them.

---

## 3. Before 8.9.1 ships: the Device ID row

### App Store Connect › App Privacy › Identifiers › Device ID

Add the row, answering:

| Question | Answer |
| --- | --- |
| Is this data collected? | Yes |
| Linked to the user's identity? | Yes |
| Used for tracking? | **No** |
| Purposes | **App Functionality** |

> What it is: the answers from Apple's App Attest and DeviceCheck and Google's Play Integrity ("our real app on a real
> device"), and a random number the app makes on first launch, which resets if the app is reinstalled. Both are used only to
> stop fake accounts and free-plan abuse. Never for ads, never shared with Meta or any advertiser, never joined to anyone
> else's account.

`docs/store-privacy.md` has already been changed to match (the Device ID row is in the App Privacy table, and it is no longer
in the "not collected" line). The listing checker fails if the two ever disagree again.

---

## 4. Play Console › Data safety, for build 8.9.1

### 4.1 The rows that change with this release

| Category | Data type | What to change |
| --- | --- | --- |
| Device or other IDs | Device or other IDs | add the purpose **Fraud prevention, security, and compliance** (as in section 2) |
| Health and fitness | **Health info** | **add this row, and ONLY if the uploaded Android build has `READ_SLEEP`** (both `TULMI_ANDROID_HEALTH` and `TULMI_ANDROID_HEALTH_SLEEP` on, which needs Play's approval of the refiled form first). Collected: Yes. Shared: No. Ephemeral: **No** (the nightly minutes are kept 31 days). Optional. Purpose: App functionality |
| App activity | Other actions | the existing row gains **App functionality**, for whether Do Not Disturb is on at the moment of a call (only for a person who turned *Hold calls during Do Not Disturb* on). Shared stays **Meta, for the milestones only**: the Do Not Disturb answer goes to nobody |

**Also fix two rows that are already filed with the wrong Ephemeral answer.** Play's "ephemeral" means held only in memory
for the length of the request. **Approximate location** (the area's name is kept until you change it) and **Fitness info**
(31 days) are both filed as Ephemeral: **Yes** and should be **No**. Nothing about what is collected changes; only that one
answer on each of the two rows.

If the uploaded build has no `READ_SLEEP`, **do not add the Health info row**: a declaration for something the binary cannot
do is the same mistake as a missing one.

### 4.2 Calendar — only once `TULMI_ANDROID_CALENDAR` ships

Until then the **Calendar row does not change**: the Android build you are submitting reads no phone calendar. *Add to my
calendar* is an `ACTION_INSERT` intent, which needs no permission.

Once a build carries the switch, Play's **Calendar → Calendar events** is the closest type there is. The honest answer is
that X0 Bot collects no calendar *events*: it reads when the person is busy and keeps only those times. So declare the type
and describe it exactly:

| field | answer |
|---|---|
| Data type | **Calendar → Calendar events** |
| Collected? | **Yes** (busy times are sent to our server) |
| Shared? | **No** |
| Processed ephemerally? | **No** (kept until the event is a day past, or the switch goes off) |
| Required or optional? | **Optional** — the person turns the switch on |
| Purposes | **App functionality** only |
| Encrypted in transit? | **Yes** |
| Can the user request deletion? | **Yes** |

**The "data usage and handling" note:**

> Only when the person turns on "Plan around my calendar". X0 Bot reads when the person is busy for the next 14 days — the
> start time, the end time and whether it is an all-day event — and nothing else. No event name, place, notes, invitees or
> calendar name is ever read; the app's query does not ask for those columns. The times are used to keep the person's plan
> and the app's calls clear of their events. Each busy time is deleted one day after it ends, and all of them when the
> switch is turned off or the account is deleted. They are never sent to AI services, never used for advertising, and never
> shared.

### 4.3 Health and fitness — only once `TULMI_ANDROID_MOTION` ships

| field | answer |
|---|---|
| Data type | **Health and fitness → Fitness info** |
| Collected? | **Yes** |
| Shared? | **No** |
| Processed ephemerally? | **No** (daily totals kept 31 days) |
| Required or optional? | **Optional** |
| Purposes | **App functionality** only |

**The note:**

> Only for a fitness bot the person made themselves, and only when they choose the phone's own step counter instead of
> Health Connect. X0 Bot keeps one number per day — steps — for 31 days, to count active days and keep a streak. No workouts
> are read on Android at all, and no place, route or time finer than a day. Deleted when the person switches it off or
> deletes the bot. Never sent to AI services, never used for advertising, never shared.

**And the driving check, which is NOT a new row.** Play has one *App activity → Other actions* row and it is already
filed — Collected Yes, Shared **Yes, Meta** (the install and milestone events only), Ephemeral No, Required, App
functionality from 4.1. Adding a second one with Shared **No** would overwrite Meta's answer. So: **no new row: add the
driving answer to the existing App activity → Other actions row description, and change none of its answers.**

**The note:**

> With "Wait while I'm driving" on, the phone answers one question just before the app would call the person: "driving",
> "not driving" or "unknown". That one word is sent to our server, used at that moment to decide whether the call waits,
> and never written down, not even with the call's own record. Nothing about where the person is, how
> fast they are going, what route they took or what vehicle they are in is read or sent — the app asks Android only whether
> the person is in a vehicle, and nothing else.

### 4.4 Location — only once `TULMI_ANDROID_ARRIVAL` ships, and this is the important one

| field | answer |
|---|---|
| **Location → Approximate location** | Collected: **Yes** (unchanged: one coarse fix when the person taps *Use my location*). Shared: No. Ephemeral: **No** |
| **Location → Precise location** | Collected: **No**. Shared: No |

**The note on Precise location, which is where the whole promise lives:**

> X0 Bot asks for precise and background location for one feature only: arrival reminders, which the person turns on, one
> place at a time. The app does not collect the person's location for it. It gives Android the place — which our server
> geocoded from the address the person typed — and Android watches for it. When the person arrives, the only thing the app
> receives is the identifier of that place, which the app itself chose; the app then shows one local notification on the
> phone. Nothing about the person's position, or the fact that they arrived, is sent to our servers, logged, or stored. The
> geofences are removed when the item is done, deleted, or the switch is turned off.
>
> Separately, and unchanged, the person can tap "Use my location" to fill in the area their day starts from. That takes one
> approximate fix and keeps only the area's name ("HSR Layout, Bengaluru") — never a coordinate, street, house number or
> postcode.

**App access** (Play Console → App content → App access): add the route, so a reviewer can find it.

> *Plan Ease → a plan item that has a place (the review account has "Pick up dry cleaning") → Remind me when I get there.*
> The account on `PERM_ARRIVAL_ANDROID_USERS` is the review account.

---

## 5. Play Console › App content › Health apps and Health Connect permissions (the refile, SPEC 11.3)

Only once the steps-and-exercise form has an answer, and only if the Android build will carry sleep. Amending a declaration
that is still under review may restart that review.

**Add one permission: Sleep (`android.permission.health.READ_SLEEP`), under Sleep management.** Its reason, word for word:

> A person who makes a fitness bot in X0 Bot can let it count how long they slept each night, shown on the bot's page with a
> weekly average. Read only when they open that bot, kept 31 days, deleted when they switch it off. Never sent to AI
> services, never used for ads, never sold or shared.

Also on that form:

* **Which data types are read:** Steps, Exercise, **Sleep**. Written: none. X0 Bot never writes to Health Connect.
* **Background reads:** No. We never ask for `READ_HEALTH_DATA_IN_BACKGROUND`.
* **History:** No. We never ask for `READ_HEALTH_DATA_HISTORY`.
* **Privacy policy link:** `https://x0bot.com/privacy#health` — the policy's own health heading, which now names sleep in its
  own sentence ("Sleep, only if you turn it on"). The Android rationale screen opens the same link, so both land on it.
* **Screenshots:** from the `n0` build — the bot's edit page with *Count my workouts from Health Connect* and, under it,
  *Also count my sleep*; the card that stands before the prompt; and Health Connect's own sheet with Sleep on it.

Google's review, then 5-7 working days for Health Connect's own list to propagate. Until it has, the row shows only for the
accounts in `PERM_HEALTH_SLEEP_ANDROID_USERS` — put the review account's id there, as you did for `PERM_HEALTH_ANDROID_USERS`.

---

## 6. The three Android halves

Each is its own build switch, its own permission and its own server switch, and **all three ship off**. One can go on without
the others, and none of them can hold up the release.

| feature | Android permission | what Play asks of you | when it can go on |
|---|---|---|---|
| **Plan around my calendar** | `READ_CALENDAR` (read only) | **Nothing.** A calendar read needs no Play declaration. One Data safety row (4.2) | as soon as a build carries `TULMI_ANDROID_CALENDAR=on` and you set `PERM_CALENDAR_READ_ANDROID` |
| **Count my steps / in a car?** | `ACTIVITY_RECOGNITION`, and its API 24-28 Play-services twin | **Nothing.** Not a sensitive permission for Play's declaration flow. Two Data safety rows (4.3) | as soon as a build carries `TULMI_ANDROID_MOTION=on` and you set `PERM_MOTION_ANDROID` |
| **Remind me when I get there** | `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` | **a background-location declaration, a demo video, and a human review** (6.1). Expect days, sometimes a few weeks | only after Play approves, **and** a build carries `TULMI_ANDROID_ARRIVAL=on`, **and** you set `PERM_ARRIVAL_ANDROID` |

**One more switch, Android's alone:** `PERM_MOTION_DRIVE_ANDROID` decides whether *Wait while I'm driving* is offered on
Android, separately from the steps. See warning 1 in section 11.

**Why it is split like that.** The one slow thing is arrival reminders: Android has no equivalent of the iPhone's trick,
where the system itself watches the place and shows the reminder with only *While Using*. On Android the app has to receive
the geofence, so it needs background location, and Play reviews that by hand. Its own switch means that review can take as
long as it likes without holding up the calendar half, the motion half, or the release.

### 6.1 The background-location declaration (arrival reminders only)

**Where:** Play Console → your app → **Policy** → **App content** → **Sensitive app permissions** → **Location permissions**
→ *Start declaration*. Do this only when you want arrival reminders on Android; until then the shipping build does not ask
for the permission at all, so there is nothing to declare.

**"Does your app access location in the background?"** → **Yes**.

**"Which of your app's features require access to location in the background?"** (name only this one):

> **Arrival reminders.** On a plan item that has a place, a person can turn on "Remind me when I get there". X0 Bot then
> asks Android to watch for that one place, and when the person arrives the app shows them a reminder on their phone.
> Because a person is usually not looking at X0 Bot when they arrive somewhere, Android only delivers that to the app with
> background location access. Nothing else in the app uses location in the background.

**"Why does your app need to access location in the background?"** (the box the reviewer reads most carefully):

> X0 Bot is a personal assistant. A person planning their day can add a place to a plan item — "pick up the dry cleaning",
> with the shop's address — and turn on a switch that says "Remind me when I get there". The reminder is only useful at the
> moment they actually arrive, which is almost never a moment they are looking at their phone, let alone at X0 Bot. With
> only foreground location, the reminder would arrive the next time the person happened to open the app, which is usually
> hours later and often after they have driven home. So the feature needs Android to tell the app when the person enters
> that one place, while the app is closed.
>
> The app registers a geofence for each place the person chose, at most ten at a time, enter only. It never tracks, never
> records a route, and never reads the person's position: the only thing the app's code receives is the identifier of the
> place that was entered, which is a string the app itself chose. When that arrives, the app shows one local notification —
> the reminder the person asked for — and does nothing else. Nothing is sent to our servers, nothing is logged, and nothing
> is stored about where the person is or that they arrived. The geofences are removed as soon as the plan item is done,
> deleted, or the switch is turned off.

**"How does your app's use of location data comply with the Location Permissions policy?"** (if your console shows it):

> Background location is used only for the feature described, which the person turns on themselves, one place at a time,
> after a card that explains it. It is prominently disclosed in the app before any permission is requested, in the privacy
> policy at https://x0bot.com/privacy, and in the Data safety form. It is never used for advertising, analytics, profiling
> or sale, never shared with a third party, and never retained — the app sends no location data anywhere at all.

**"Is this feature available without background location?"** → **No** (it is the only way Android can deliver an arrival),
and if a box follows:

> The person can still set a time-based reminder on the same item, which needs no location at all, and that is the default.
> The arrival switch is the only part that needs background location, and it is off unless they turn it on.

**Video link:** a YouTube link (unlisted is fine). Script below.

### 6.2 The demo video (60-90 seconds, one take, no narration needed)

Play's reviewers want to see the **in-app disclosure, the permission request, and the feature working**, in that order, on a
real device. Record the screen with the system recorder; show the notification shade for the reminder. Captions as on-screen
text are safer than a voice-over.

| time | what is on screen | caption |
|---|---|---|
| 0:00 | X0 Bot open on Plan Ease, the day's plan listed | "X0 Bot: a personal assistant that plans your day." |
| 0:05 | Tap a plan item that has a place — e.g. *Pick up dry cleaning · Koramangala* | "A plan item with a place." |
| 0:10 | The item page, scroll to the switch **Remind me when I get there**, switch off | "The person chooses this. It is off by default." |
| 0:14 | Tap the switch. **X0 Bot's own card appears** — read it on screen, slowly | "Before any permission: the app explains it in its own words." |
| 0:20 | The card, full, **including the background sentence**: *"Your phone watches for this place and shows the reminder when you arrive. Nothing about where you are, or that you arrived, is sent to X0 Bot's servers. X0 Bot uses your location in the background, even when the app is closed or not in use, only to show the arrival reminders you turn on. Your location is never sent to X0 Bot or anyone else."* | "Prominent in-app disclosure: background use, in the app's own words, before anything is asked." |
| 0:28 | Tap **Continue** → **Android's own location prompt**. Make sure **Precise** is selected, then tap *While using the app* | "Android asks for location. Precise, because a reminder about arriving needs it." |
| 0:34 | **The second card**: *"For that to work when X0 Bot is closed or not in use, Android needs location set to Allow all the time. Only you can set that, on your phone's own location page, so the next tap takes you there."* | "The app explains the background grant before the hand-off." |
| 0:42 | Tap **Open Settings** → Android's app location page → tap **Allow all the time** | "The person grants it themselves." |
| 0:50 | Back in X0 Bot: the item now reads *"Reminds you at Koramangala, until it's done."* | "Armed. One place." |
| 0:55 | **Leave the app.** Lock the phone, or show the home screen. Walk or drive to the place | "The app is closed." |
| 1:05 | The notification arrives: *"You're at Koramangala" / "Pick up dry cleaning"* | "The reminder the person asked for. This is the only thing that happens on arrival." |
| 1:12 | Tap it → X0 Bot opens on Plan Ease | "Nothing is sent anywhere. No location leaves the phone." |
| 1:18 | Mark the item done → the switch is gone | "Done, deleted, or switched off: the geofence is removed." |

**Three things the video must show,** because they are what the reviewer checks: the card **before** each prompt, the words
*"even when the app is closed or not in use"* in that first card, and the app **closed** when the reminder arrives. If the
recording never leaves the app, the declaration usually comes back rejected.

**Record it on the `n0` proof build.** It is the only profile allowed to carry `TULMI_ANDROID_ARRIVAL=on`, and `n0` is never
submitted to Play. A build with the switch off has no geofencing in it, asks for no permission and draws no switch, so there
would be nothing to film. **Pick Precise at 0:28** — Approximate makes arming fail by design, and the app says so.

### 6.3 When the answer comes

- **Approved:** set `PERM_ARRIVAL_ANDROID=true` (optionally `PERM_ARRIVAL_ANDROID_USERS` first, for a few accounts). A build
  carrying `TULMI_ANDROID_ARRIVAL=on` then shows the row. **Both are needed.**
- **Rejected:** nothing to undo. The shipping build never asked for the permission, so there is no release to pull and no row
  to hide. Read the reason, fix the declaration or the video, and refile. `tools/ci/check-runtime.mjs` refuses
  `TULMI_ANDROID_ARRIVAL=on` in any profile but `n0`, so a rejected declaration cannot leak into a release by accident.

### 6.4 The privacy policy — already done, nothing for you

The Android wording is live in `tulmi/src/routes/site/policies/privacy.ts` (section 1.5): the calendar half, steps with no
workouts, and the background-location paragraph that says the iPhone never reads location in the background and Android does,
for arrival reminders and nothing else. It must be **deployed before Play sees the build**, which it is as soon as the server
is deployed.

---

## 7. App Store Connect, on submit day

* **Turn the iPhone rows on before you press Submit** (App Review 2.1 / 2.3.1):
  `./deploy/set-env.sh PERM_CALENDAR_ADD=true PERM_CALENDAR_READ=true PERM_REMINDERS=true PERM_FOCUS=true PERM_MOTION=true PERM_MOTION_DRIVE=true PERM_ARRIVAL=true PERM_HEALTH_SLEEP_IOS=true PERM_HEALTH_SLEEP_IOS_USERS=<review account id> && ./deploy/ship.sh`.
  Leave every `_ANDROID` switch off. Only a binary that declares each capability (8.9.1) draws these rows, so nobody on 8.9
  sees anything. Tap each row on the TestFlight build of this exact release candidate first. `PERM_CALENDAR_ADD` and
  `PERM_FOCUS` also draw their no-permission rows on Android 8.9.1. If you do not want a row live, cut its line from What's
  New and the review notes, and its key from `app.config.ts`, before upload.
* **App Privacy:** sections 2 and 3 above (Other Diagnostic Data + App Functionality; the Device ID row). Health and Fitness
  stay as types; sleep is Health, Motion's steps are Fitness, and Apple's Fitness type names the Motion and Fitness API
  itself, so no new type is needed for Motion.
* **Other Data › Other Data Types:** add "whether a Focus is on (never which one), and whether the phone is in a car just
  before a call". Linked: Yes. Tracking: **No**. Purpose: App Functionality.
* **What's New:** already written in `TAILZU-FRONTEND/docs/store-listing.md`, and it says **8.9.1**.
* **App Review notes:** already written in the same file, with the route to every new switch. It is at the 4,000 limit, so if
  anything is added there, something has to go.
* **Description:** the Apple Health sentence now says "your steps, your workouts and how you slept".
* **Play's listing:** the App access instructions in the same file are the **OFF** variant for all three Android halves. The
  lines to add for each are in that file's "Add only when an Android half of 8.9.1 is on", and
  `node tools/media/store/check-listing.mjs` fails both ways round — a line without the switch, or a switch without the line.

---

## 8. The `n0` proof build: what to run and what to measure

`n0` is the only profile that carries the Android halves (and the iPhone's Focus Filter work), and it never goes to a store.
Before any switch goes on:

1. **The Focus Filter's end call.** With the filter added to a Focus, end the Focus and record the call's shape: the App
   Group should end up `{on: false}`, with no hold value. If iOS sends nothing at all on end, the 12-hour expiry is the only
   thing lifting the hold, and that is worth knowing before `PERM_FOCUS` goes on.
2. **An all-day plan item created in IST**, opened through *Add to my calendar* on Google Calendar and on Samsung Calendar:
   which day does it land on? The JavaScript sends the server's own instant unchanged, and whether Android reads an all-day
   `EXTRA_EVENT_BEGIN_TIME` as local or as UTC is still an open question.
3. **The iOS 17 out-of-process editor**, swiped down rather than cancelled, and **granting calendar in Settings after
   refusing in the same launch**.
4. **App Attest with the network off** on a TestFlight build: it should answer "unavailable", generate **one** key, and reuse
   that same key id when the network comes back. More than 3 keys in 30 days costs +20.
5. **How often a geofence arrival and an activity transition actually arrive** on an Android phone that has been idle. If
   arrivals are missed often, the switch stays off and nothing is lost, because it was never on.
6. **How often the driving check answers "unknown" on Android.** See warning 1.
7. **The merged manifest of the `n0` build**: confirm `com.google.android.gms.permission.ACTIVITY_RECOGNITION` is in it (it
   is added by hand, because Play services' own manifest does not declare it), and check the driving check on a real
   Android 8 or 9 phone, which is the only place that permission does anything.

---

## 9. Re-seed the review account, before submission

The seed changed shape: the plan item now **repeats daily at 9:30 pm** and sits at **"Bengaluru"**, a name this server can
resolve with no geocoder configured. The old one-off at 6 pm IST on the seed day meant the *Remind me when I get there*
route was gone by that evening, and a reviewer looking the next day would have found nothing.

```
npx tsx scripts/seed-review-account.ts <account id>
```

`docs/store-listing.md`'s review notes name that day and time, so the two must match. Do this for **both** stores' review
accounts, and put the Play one's id in `PERM_ARRIVAL_ANDROID_USERS` and `PERM_HEALTH_*_ANDROID_USERS` when those go on.

---

## 10. The switches, one at a time (none of this is a secret either)

Each is a plain setting, so `./deploy/set-env.sh PERM_CALENDAR_ADD=true` is the way. **The iPhone rows go on at submission
(section 7), so App Review can reach them**; only the Android switches below wait, each for its own build and, for arrival,
for Play. Tap each row on a real store build before you turn it on for everyone.

**Both phones (the shared switch):**

```
PERM_CALENDAR_ADD        Add to my calendar (no permission at all: safe first)
PERM_CALENDAR_READ       Plan around my calendar
PERM_REMINDERS           Sync with Reminders            (iPhone only; there is no Android half)
PERM_FOCUS               Hold calls during a Focus / Do Not Disturb
PERM_MOTION              Count my steps
PERM_MOTION_DRIVE        Wait while I'm driving   (only if n0 measured 80%+ answers; else leave off and cut its words)
PERM_HEALTH_SLEEP_IOS    Also count my sleep, iPhone
PERM_HEALTH_SLEEP_ANDROID  the same on Android, ONLY after Play has approved sleep (and its _USERS list first)
PERM_ARRIVAL             Remind me when I get there
```

**Android's own half, which is a SECOND switch and not a replacement.** A row appears on an Android phone only when the
shared switch above AND the one below are both on, and the binary carries the build switch:

```
PERM_CALENDAR_READ_ANDROID   needs a build with TULMI_ANDROID_CALENDAR. No Play review at all: the cheapest of the three
PERM_MOTION_ANDROID          needs a build with TULMI_ANDROID_MOTION. No Play review
PERM_MOTION_DRIVE_ANDROID    the driving check on Android, separately from the steps (warning 1)
PERM_ARRIVAL_ANDROID         needs TULMI_ANDROID_ARRIVAL **and** Play's approval (6.1)
PERM_ARRIVAL_ANDROID_USERS   optional: only these account ids, while the approval propagates
```

Turn one on and the row appears on Android phones whose binary declared it; turn it off and the row is gone at the next
screen load. Neither needs a release.

**The order that costs least:** submit 8.9.1 → the calendar half → the motion half → (the `n0` measurements) → the arrival
declaration, its video, Play's review, then arrival. Nothing waits on the one with a human review.

---

## 11. Two honest warnings

1. **The driving check may not be worth its permission on Android.** On the iPhone, CoreMotion can be asked "what was
   happening in the last three minutes?" and answers from a history. Android has no such query: the app is told when the
   person gets into or out of a car, as it happens, and keeps nothing. So the answer is often "unknown" — which the server
   already handles (the call rings as it does today), but which means the feature may do little for a permission people see
   in Settings. **Measure it on the proof build.** If "unknown" is the usual answer, leave **`PERM_MOTION_DRIVE_ANDROID`**
   off and keep only the steps half. Do **not** use `PERM_MOTION_DRIVE` for this: that one is shared with the iPhone, where
   CoreMotion answers properly, and turning it off would take the feature from iPhone people to spare Android.
2. **Android step counts start the day X0 Bot first looks.** The phone's step counter is a running total since the last
   restart with no history in it, so there is nothing to back-fill. The first day shows a partial count and days before the
   switch went on show none. The app says so, on the card and on You › Privacy, rather than filling in zeros that would look
   like days the person did not walk.
