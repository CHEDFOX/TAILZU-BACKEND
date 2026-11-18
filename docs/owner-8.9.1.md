# Build 8.9.1: the owner's checklist, word for word

One file, both phones. It merges what SERVER_PERMS wrote for the iPhone and the store forms with what the ANDROID worker
wrote for Play (the old `OWNER-ANDROID.md`, now folded in here).

Everything below is **text to paste or a switch to flip**. **No key, token or password is in this file, and none ever should
be.** Every secret goes into `tulmi/.env` from an SSH session on the server — never through chat, a ticket, an email or the
repo. Section 1 says exactly how, for each one.

The design is `perms2/SPEC.md`; section numbers in brackets are its. **The version is 8.9.1 everywhere** — where the SPEC
still says 9.0, read 8.9.1.

**Every switch ships off by default, and you turn them on at submission, on BOTH phones. The three Android halves — calendar
busy times, steps and the driving check, and arrival reminders — are IN the Android build you upload for this release and go
on with it.** Before you press Submit, do sections 2, 3, 4, 5, 6 and 9, and then section 7 (iPhone) and 7A (Android),
including their switch steps: App Review and Play's reviewer must be able to reach every screen the new usage strings and the
review notes name. The one thing that can be slow is Play's background-location review (6.1), so start it first: **Play can
hold the whole Android update until that declaration is approved** (warning 3).

---

## 0. The whole list, at a glance

| # | what | where | blocks the release? |
|---|---|---|---|
| 1 | The keys, into the server `.env` only | SSH | no (without a key, that check is simply skipped) |
| 2 | App Privacy: Other Diagnostic Data gains App Functionality | App Store Connect | **yes, before 8.9.1 ships** |
| 2 | Data safety: Device or other IDs gains Fraud prevention | Play Console | **yes, before 8.9.1 ships** |
| 3 | App Privacy: the Device ID row | App Store Connect | **yes, before 8.9.1 ships** (the binary's privacy manifest declares it, and TRUST_ATTEST=shadow starts collecting) |
| 4 | Data safety: the 8.9.1 rows, the three Android halves' rows, and two already-filed Ephemeral answers to correct | Play Console | **yes, with this release** |
| 5 | Health Connect: the refile, with Sleep | Play Console | only before Android sleep goes on (not in this release) |
| 6 | The three Android halves, and Play's background-location declaration and video | Play Console | **yes, before the Android release is sent for review** |
| 7 | App Store Connect on submit day | App Store Connect | **yes** |
| 7A | Play Console on submit day, and the Android switches | Play Console + `deploy/set-env.sh` | **yes** |
| 8 | The `n0` proof build: what to run and what to measure | a phone | before any switch goes on |
| 9 | Re-seed the review account | SSH | **yes, before submission** |
| 10 | The switches, one at a time, after approval | `deploy/set-env.sh` | no |
| 11 | Three honest warnings | — | — |

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
do is the same mistake as a missing one. **This release's build has none** — `TULMI_ANDROID_HEALTH` is off in `production`
(`app/eas.json`), so Health Connect is not part of 8.9.1 on Android and this row is not filed now. The other three halves
are (4.2, 4.3, 4.4).

### 4.2 Calendar — with this release (`TULMI_ANDROID_CALENDAR` is in the build)

The Android build you are submitting **does** read the phone's calendars, so this row changes with this release. (*Add to my
calendar* on its own is an `ACTION_INSERT` intent and needs no permission; this row is about *Plan around my calendar*.)

Play's **Calendar → Calendar events** is the closest type there is. The honest answer is
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

### 4.3 Health and fitness — with this release (`TULMI_ANDROID_MOTION` is in the build)

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

### 4.4 Location — with this release (`TULMI_ANDROID_ARRIVAL` is in the build), and this is the important one

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

## 6. The three Android halves — ALL THREE IN THIS RELEASE

Android is not left out of 8.9.1. The production Android build carries all three build switches on
(`TULMI_ANDROID_CALENDAR`, `TULMI_ANDROID_MOTION`, `TULMI_ANDROID_ARRIVAL`), so every Play step below happens **now, with
this release**, and the server switches go on at submission (7A). Each is still its own switch, so any one of them can be
turned off again from the server in seconds, without a release.

| feature | Android permission | what Play asks of you | when it goes on |
|---|---|---|---|
| **Plan around my calendar** | `READ_CALENDAR` (read only) | **No declaration.** A calendar read needs none. One Data safety row (4.2), filed with this release | at submission: `PERM_CALENDAR_READ_ANDROID=true` (7A) |
| **Count my steps / in a car?** | `ACTIVITY_RECOGNITION`, and its API 24-28 Play-services twin | **No declaration.** Not a sensitive permission for Play's declaration flow. Two Data safety rows (4.3), filed with this release | at submission: `PERM_MOTION_ANDROID=true` and `PERM_MOTION_DRIVE_ANDROID=true` (7A) |
| **Remind me when I get there** | `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` | **a background-location declaration, a demo video, and a human review** (6.1, 6.2) — **BEFORE this release is sent for review** | at submission: `PERM_ARRIVAL_ANDROID=true` (7A) |

**Do the background-location declaration and the video FIRST.** The permission is in the uploaded binary, so Play reviews it
whether the server switch is on or not, and **Play can hold the whole Android update until that declaration is approved**
(warning 3). Expect days, sometimes a few weeks. If you need the rest of 8.9.1 on Android sooner than that, the one way is a
build without `TULMI_ANDROID_ARRIVAL` — a different binary, not a server switch.

**Why they are still three switches.** Each row disappears from Android phones the moment its server switch goes off, so a
half that misbehaves on real phones (warning 1, warning 2) costs nothing to withdraw, and nothing waits on a release.

### 6.1 The background-location declaration (arrival reminders only)

**Where:** Play Console → your app → **Policy** → **App content** → **Sensitive app permissions** → **Location permissions**
→ *Start declaration*. **Do this before you send this release for review:** the binary asks for the permission, so Play
reviews it either way, and an undeclared background location is a rejection.

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

### 6.2 The demo video (about 30 seconds, one take, no narration needed)

Play's reviewers want to see the **in-app disclosure, the permission request, and the feature working**, in that order, on a
real device. Record the screen with the system recorder; show the notification shade for the reminder. Captions as on-screen
text are safer than a voice-over. Play's own guidance is "aim for a video duration of 30 seconds or less" (help 9799150), so
the script below is one take of about that length: nothing is cut that the reviewer checks for.

| time | what is on screen | caption |
|---|---|---|
| 0:00 | X0 Bot on Plan Ease: tap the plan item that has a place — *Pick up dry cleaning · Koramangala* — and scroll to the switch **Remind me when I get there**, which is off | "A plan item with a place. The person chooses this, and it is off by default." |
| 0:05 | Tap the switch. **X0 Bot's own card appears** — read it on screen, slowly, all of it, **including the background sentence**: *"Your phone watches for this place and shows the reminder when you arrive. Nothing about where you are, or that you arrived, is sent to X0 Bot's servers. X0 Bot uses your location in the background, even when the app is closed or not in use, only to show the arrival reminders you turn on. Your location is never sent to X0 Bot or anyone else."* | "Prominent in-app disclosure: background use, in the app's own words, before anything is asked." |
| 0:13 | Tap **Continue** → **Android's own location prompt**. Make sure **Precise** is selected, then tap *While using the app* | "Android asks for location. Precise, because a reminder about arriving needs it." |
| 0:17 | **The second card**, word for word as the app says it: *"For that to work when X0 Bot is closed or not in use, Android needs location set to Allow all the time. Only you can allow that, so the next tap asks you, or opens your phone's own location page."* | "The app explains the background grant before the hand-off." |
| 0:22 | Tap **Open Settings** → Android's app location page → tap **Allow all the time** | "The person grants it themselves." |
| 0:25 | Back in X0 Bot: the item now reads *"Reminds you at Koramangala, until it's done."* Then **leave the app** — lock the phone — and walk or drive to the place | "Armed, one place. Then the app is closed." |
| 0:28 | The notification arrives: *"You're at Koramangala" / "Pick up dry cleaning"* | "The reminder the person asked for. Nothing is sent anywhere, and no location leaves the phone." |

**Three things the video must show,** because they are what the reviewer checks: the card **before** each prompt, the words
*"even when the app is closed or not in use"* in that first card, and the app **closed** when the reminder arrives. If the
recording never leaves the app, the declaration usually comes back rejected.

**Record it on the `n0` proof build**, which carries the same three switches as `production` plus Health Connect, and is never
submitted to Play. The `preview` build would do as well; `development` has all three off, so there would be nothing to film.
To film the row at all, the server switches have to be on for your own account — set `PERM_ARRIVAL=true` and
`PERM_ARRIVAL_ANDROID=true` (and `PERM_ARRIVAL_ANDROID_USERS=<your id>` if you want it for you alone) before you record.
**If you use that list, empty it again before you submit** (7A step 3): left set, it hides the row from everyone else,
the Play reviewer included.
**Pick Precise at 0:28** — Approximate makes arming fail by design, and the app says so.

### 6.3 When the answer comes

The shipping binary now asks for the permission, so this is no longer a free bet — read warning 3.

- **Approved:** the release can go out, and `PERM_ARRIVAL_ANDROID=true` (7A) shows the row for everyone on Android, which is
  what the Play description, the release notes and the privacy policy all promise. Leave `PERM_ARRIVAL_ANDROID_USERS` empty:
  Play's approval covers the whole app at once, so there is no stage to hold back. **Both the build switch and the server
  switch are needed**, and the build switch is on in `preview`, `production` and `n0` (`app/eas.json`).
- **Rejected, or still waiting:** **do not upload the Android release.** Nothing in either repository can see Play's answer,
  so no check stands in for it. Read the reason, fix the declaration or the video, and refile. If you cannot wait, the only
  way out is a different binary, built with `TULMI_ANDROID_ARRIVAL=off`, which asks for no location permission and draws no
  arrival row — a new build and a new review, not a server switch.

### 6.4 The privacy policy — already done, nothing for you

The Android wording is live in `tulmi/src/routes/site/policies/privacy.ts` (section 1.5): the calendar half, steps with no
workouts, and the background-location paragraph that says the iPhone never reads location in the background and Android does,
for arrival reminders and nothing else. It must be **deployed before Play sees the build**, which it is as soon as the server
is deployed.

---

## 7. App Store Connect, on submit day

* **Turn the iPhone rows on before you press Submit** (App Review 2.1 / 2.3.1):
  `./deploy/set-env.sh PERM_LOCATION=true PERM_CONTACT_PICK=true PERM_HEALTH_IOS=true PERM_CALENDAR_ADD=true PERM_CALENDAR_READ=true PERM_REMINDERS=true PERM_FOCUS=true PERM_MOTION=true PERM_MOTION_DRIVE=true PERM_ARRIVAL=true PERM_HEALTH_SLEEP_IOS=true PERM_HEALTH_SLEEP_IOS_USERS= && ./deploy/ship.sh`.
  The first three are **easy to forget and each one hides a row the review notes send the reviewer to**: `PERM_LOCATION` is
  *Use my location*, `PERM_CONTACT_PICK` is *Add from contacts*, and `PERM_HEALTH_IOS` is *Count my workouts* (and the sleep
  row needs health on too). All three default to false. Only a binary that declares each capability (8.9.1) draws these rows,
  so nobody on 8.9 sees anything. **Tap every row named in the review notes on the TestFlight build of this exact release
  candidate first.** If you do not want a row live, cut its line from What's New and the review notes, and its key from
  `app.config.ts`, before upload.
* **`PERM_HEALTH_IOS_USERS`:** check it is **empty**, or holds the review account's id. A list with other ids in it and not
  the reviewer's leaves *Count my workouts* invisible to App Review while the switch reads as on.
* **`PERM_HEALTH_SLEEP_IOS_USERS`: empty, which the command above sets.** The switch alone then decides, and sleep is on
  for everyone — which is what the Description ("how you slept") and What's New ("your sleep from Apple Health") promise.
  A list here would leave those words untrue for every user but the one on it, and the iPhone has no propagation stage to
  cover. If you would rather start sleep with the reviewer alone, set it to their id now and add to section 10: "On
  approval day: `./deploy/set-env.sh PERM_HEALTH_SLEEP_IOS_USERS= && ./deploy/ship.sh`" — until you run it, the
  Description and What's New promise sleep to people who cannot see it.
* **The review sign-in — `REVIEW_CODE` MUST BE EXACTLY SIX DIGITS.** This is what build 85 was rejected for
  (2.1(a), "the app reverted to Enter the code page after entering demo code"). Nothing was broken: the code screen is
  the same number pad every user types an emailed code into, so it strips every letter and stops at six characters. A
  longer or alphanumeric code cannot be typed at all — the reviewer enters it, the app keeps nothing, and the screen
  sits there looking dead. `config.ts` now warns in the deploy log when the shape is wrong; read it before submitting.
* **The review sign-in:** check `REVIEW_EMAIL` and `REVIEW_CODE` are **both** set
  (`./deploy/set-env.sh --show REVIEW_EMAIL REVIEW_CODE` prints both values — neither name looks like a secret to the
  script, and `--show` with no names after it prints nothing at all), that they **match App Review Information's User Name and Password exactly**, and that they **stay set until
  the app is approved**. Unset in production is the normal state, and with either one unset the reviewer cannot sign in at
  all. The notes say to type the Password where the app asks for the code. Sign in on TestFlight with those details yourself.
* **App Privacy — match the privacy manifest, answer for answer.** `app/assets/PrivacyInfo.xcprivacy` is in the binary, so
  the answers have to agree with it (backend `docs/store-privacy.md` §3 is the list):
  * **Data Used to Track You: none.** There is no Meta SDK and no tracking prompt in the iPhone build (store-privacy §1.1).
  * **Crash Data:** App Functionality **and** Analytics. **Performance Data:** App Functionality **and** Analytics (it used
    to say Analytics alone). Both **Linked to you: Yes**.
  * **Other User Content:** App Functionality **and Product Personalization**.
  * **Other Diagnostic Data:** App Functionality + Analytics (section 2). **Device ID:** the row in section 3.
  * **Data Not Linked to You: none** — every type is linked.
  * Health and Fitness stay as types; sleep is Health, Motion's steps are Fitness, and Apple's Fitness type names the Motion
    and Fitness API itself, so Motion needs no new type.
* **Other Data › Other Data Types:** add "whether a Focus is on (never which one), and whether the phone is in a car just
  before a call". Linked: Yes. Tracking: **No**. Purpose: App Functionality.
* **Age rating** (the form is required on any update from 16 November 2026, and two questions are new):
  * **Shared Location: No.** Nobody is shown anyone's location, ever.
  * **Dating and Relationships: YES.** This is the owner's decision, taken knowingly: romantic and companion bots **stay
    allowed**, so the honest answer is yes and **the app is rated 18+**. Do not answer No while they are allowed.
  * **Messaging and Chat: Yes. User-Generated Content: Yes. Health or Wellness Topics: Yes.**
  * Medical device status: only if the app's primary or secondary category is Health & Fitness or Medical. It is not.
* **Accept any pending agreement.** The Account Holder signs in to App Store Connect and accepts every pending licence or
  Paid Apps agreement. A pending agreement blocks submission on its own, and nothing else warns you.
* **Xcode 26 or later:** apps uploaded to App Store Connect must be built with Xcode 26+ and an iOS 26 SDK. Check the EAS
  build log for the Xcode version before you submit the binary.
* **x0bot.com answers 200** on `/privacy`, `/privacy/providers`, `/terms`, `/support` and `/delete-account`. `/privacy/providers`
  was a **404** on the live site while the rewrite sat in `TAILZU-WEB/vercel.json` on `main`: **redeploy TAILZU-WEB to Vercel
  production and check all five**. The privacy policy names the AI services inline now as well, so a slow redeploy is no
  longer a dead end — but a 404 on a page the policy links to is still a rejection.
* **What's New:** already written in `TAILZU-FRONTEND/docs/store-listing.md`, and it says **8.9.1**.
* **App Review notes:** in the same file, with the route to every new switch, the AI permission step, and the AI services
  named. **Fill in "Tested on: [device, iOS version]"** with the device and iOS version you actually tested on, then run
  `node tools/media/store/check-listing.mjs --write`. The notes are near the 4,000 limit, so anything added means something
  else goes.
* **Description:** the Apple Health sentence now says "your steps, your workouts and how you slept", and the description
  names Motion & Fitness, the calendar, Reminders, Focus and arrival reminders, because the licence (3.3.3(H)) and 2.5.1
  require each to be evident in the marketing text.

---

## 7A. Play Console, on submit day — ANDROID GOES ON WITH THIS RELEASE

Android is not left out of 8.9.1: the production Android build carries all three halves (section 6). Everything here happens
with this release.

**Before you send the release for review:**

0. **Paste the Full description** from `TAILZU-FRONTEND/docs/store-listing.md` into Play Console › Main store listing: it
   now carries the background-location sentence Google requires **in the description** as well as in the app ("must be
   within the app itself as well as in the app description and website", help 9799150). `node
   tools/media/store/check-listing.mjs` fails if it is missing while `androidArrival` is on.
1. **The background-location declaration and the demo video** (6.1, 6.2), filed and **approved**. Start this first.
   Play can hold the whole update until it is answered (warning 3).
2. **Data safety**, all of it: the 8.9.1 rows and the two already-filed Ephemeral answers to correct (4.1), **Calendar →
   Calendar events** (4.2), **Health and fitness → Fitness info** and the driving sentence on the existing *App activity →
   Other actions* row (4.3), and **Location** (4.4). The exact answers and notes are drafted there, word for word.
   Do **not** add the Health info row: this build has no `READ_SLEEP` (`TULMI_ANDROID_HEALTH` is off in `production`).
3. **App access** (App content → App access): add the route to each of the three rows. The lines are already in
   `TAILZU-FRONTEND/docs/store-listing.md`'s **App access instructions**, because all three halves are on (the section
   "The three Android halves of 8.9.1 are ON" says which words belong to which switch), and
   `node tools/media/store/check-listing.mjs` fails both ways round, so it will tell you if a line or a switch is missing. Leave `PERM_ARRIVAL_ANDROID_USERS` **empty**: Play approves background location for the whole
   app before upload ("Approval will be granted for your entire app", help 9799150), so there is nothing to stage — and a
   list hides the row from everyone not on it (`kit.ts` canArrival), reviewer included. If you set it to your own id to
   film the video (6.2), clear it now: `./deploy/set-env.sh PERM_ARRIVAL_ANDROID_USERS= && ./deploy/ship.sh` (an empty
   value is fine).
4. **Re-seed the Play review account** (section 9), so every route in those lines exists.

**The switch step, at submission** (the Play twin of section 7's command):

```
./deploy/set-env.sh PERM_CALENDAR_READ_ANDROID=true PERM_MOTION_ANDROID=true PERM_MOTION_DRIVE_ANDROID=true PERM_ARRIVAL_ANDROID=true PERM_ARRIVAL_ANDROID_USERS= && ./deploy/ship.sh
```

Each of these is the **second** switch: a row shows on an Android phone only when the shared switch from section 7 is on
**and** the one above is on **and** the binary carries the build switch. So run section 7's command too, even if you are
submitting Android alone. `PERM_HEALTH_ANDROID` and `PERM_HEALTH_SLEEP_ANDROID` stay **off**: Health Connect is not part of
this release, and the binary has no `READ_SLEEP`.

**If Play comes back asking about background location,** answer from 6.1 and leave the switches as they are: the rows go
dark the moment you set `PERM_ARRIVAL_ANDROID=false`, which takes seconds and no release.

---

## 8. The `n0` proof build: what to run and what to measure

`n0` is the proof build (the production profile carries the same three Android halves, without Health Connect), and it never
goes to a store. Measure these on `n0` or a production candidate before submission:

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
accounts. Leave `PERM_ARRIVAL_ANDROID_USERS` empty (7A step 3); `PERM_HEALTH_*_ANDROID_USERS` only matters if Health
Connect is ever turned on, and it is not in this release.

**The seed also clears the review account's AI permission answer**, so the reviewer meets the AI permission card on Home
("Terms and privacy"), even if this account agreed in an earlier review (App Review 5.1.2(i)). Nobody else is asked again: `AI_CONSENT_VERSION` is unchanged, so no one who already agreed loses what they agreed to. **The reviewer has to tap
Agree before the bots answer anything**, which is why the review notes have an AI PERMISSION step; a reviewer who taps *Not
now* finds the bots idle, exactly as a user would.

---

## 10. The switches, one at a time (none of this is a secret either)

Each is a plain setting, so `./deploy/set-env.sh PERM_CALENDAR_ADD=true` is the way. **Both phones' rows go on at submission
(sections 7 and 7A), so App Review and Play's reviewer can reach them.** Tap each row on a real store build before you turn
it on for everyone. This section is the reference; the two submit-day commands are the thing to run.

**Both phones (the shared switch):**

```
PERM_CALENDAR_ADD        Add to my calendar (no permission at all: safe first)
PERM_CALENDAR_READ       Plan around my calendar
PERM_REMINDERS           Sync with Reminders            (iPhone only; there is no Android half)
PERM_FOCUS               Hold calls during a Focus / Do Not Disturb
PERM_MOTION              Count my steps
PERM_MOTION_DRIVE        Wait while I'm driving   (on at submission, section 7: the notes send the reviewer to it)
PERM_HEALTH_SLEEP_IOS    Also count my sleep, iPhone
PERM_HEALTH_SLEEP_ANDROID  the same on Android, ONLY after Play has approved sleep (and its _USERS list first)
PERM_ARRIVAL             Remind me when I get there
PERM_LOCATION            Use my location (the area your day starts from)
PERM_CONTACT_PICK        Add from contacts, in a space's invite
PERM_HEALTH_IOS          Count my workouts, iPhone (and what the sleep row needs under it)
```

**Android's own half, which is a SECOND switch and not a replacement.** A row appears on an Android phone only when the
shared switch above AND the one below are both on, and the binary carries the build switch. All three build switches are on
in `production` (`app/eas.json`), so **all four go on at submission** (7A):

```
PERM_CALENDAR_READ_ANDROID   build: TULMI_ANDROID_CALENDAR (on). No Play declaration at all
PERM_MOTION_ANDROID          build: TULMI_ANDROID_MOTION (on). No Play declaration
PERM_MOTION_DRIVE_ANDROID    the driving check on Android, separately from the steps (warning 1)
PERM_ARRIVAL_ANDROID         build: TULMI_ANDROID_ARRIVAL (on) AND Play's approved declaration (6.1, warning 3)
PERM_ARRIVAL_ANDROID_USERS   leave empty (for a private test of your own only)
PERM_HEALTH_ANDROID          Health Connect. NOT in this release: the build has no READ_SLEEP and this stays off
PERM_HEALTH_SLEEP_ANDROID    the same, and only after Play has approved sleep (section 5)
```

Turn one on and the row appears on Android phones whose binary declared it; turn it off and the row is gone at the next
screen load. Neither needs a release.

**The order that costs least:** the background-location declaration and its video first (6.1, 6.2) → Data safety and App
access (4, 7A) → the `n0` measurements (section 8), and turn `PERM_MOTION_DRIVE_ANDROID` off if warning 1 turns out to be
true on real phones → submit both stores with both switch commands. The one thing that can be slow is Play's human review, and it is now
in front of the Android release, not beside it.

---

## 11. Three honest warnings

1. **The driving check may not be worth its permission on Android.** On the iPhone, CoreMotion can be asked "what was
   happening in the last three minutes?" and answers from a history. Android has no such query: the app is told when the
   person gets into or out of a car, as it happens, and keeps nothing. So the answer is often "unknown" — which the server
   already handles (the call rings as it does today), but which means the feature may do little for a permission people see
   in Settings. It goes **on** at submission (7A), because the row is in the build and a reviewer should be able to reach it.
   **Measure it on real phones (section 8, item 6).** If "unknown" is the usual answer, set
   **`PERM_MOTION_DRIVE_ANDROID=false`** and keep only the steps half; the row is gone at the next screen load. Do **not**
   use `PERM_MOTION_DRIVE` for this: that one is shared with the iPhone, where CoreMotion answers properly, and turning it
   off would take the feature from iPhone people to spare Android.
2. **Android step counts start the day X0 Bot first looks.** The phone's step counter is a running total since the last
   restart with no history in it, so there is nothing to back-fill. The first day shows a partial count and days before the
   switch went on show none. The app says so, on the card and on You › Privacy, rather than filling in zeros that would look
   like days the person did not walk.
3. **Play can hold the whole Android update until the background-location declaration is approved.** The binary you upload
   asks for `ACCESS_BACKGROUND_LOCATION`, so Play reviews that permission whether `PERM_ARRIVAL_ANDROID` is on or off — the
   server switch is invisible to Play. An undeclared or unapproved background location is a rejection of the release, not of
   one feature. So: **file the declaration and the video (6.1, 6.2) and have them approved before you send this release for
   review.** If the rest of 8.9.1 has to reach Android sooner than Play answers, the only way is a second build with
   `TULMI_ANDROID_ARRIVAL=off`, which asks for no location permission and draws no arrival row — and that is a new binary and
   a new review, not a switch.
