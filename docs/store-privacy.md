# Store privacy answers: App Store "App Privacy" and Google Play "Data safety"

The answers for the X0 Bot phone app (bundle `com.tulmi.app`, both stores) as the code is now (29 Oct 2026), ready to paste into
App Store Connect (App Privacy) and Play Console (App content, Data safety). Every answer says where in the code the data comes from,
so it can be checked again when the code changes. Paths are from the repo roots: `tulmi/` is this repo's server, `app/` is
TAILZU-FRONTEND's phone app.

The account deletion link for Play is **https://x0bot.com/delete-account** (`tulmi/src/routes/account/accountDeletion.ts`,
`tulmi/src/routes/site/policies/deleteAccount.ts`, proxied by TAILZU-WEB `vercel.json`).

* [1. Decided](#1-decided-29-oct-2026)
* [2. What the app collects, and where](#2-what-the-app-collects-and-where)
* [3. App Store: App Privacy](#3-app-store-app-privacy)
* [4. Google Play: Data safety](#4-google-play-data-safety)
* [5. Keep it true](#5-keep-it-true)

## 1. Decided (29 Oct 2026)

1. **Meta on iPhone: off, switchable from the server.** The SDK stays in the build but does not start on iPhone until the
   server's knob `ads.meta.ios.enabled` is turned on (default false; `app/src/telemetry/meta.ts`). Turned on, Apple's tracking
   prompt (expo-tracking-transparency) comes first and the advertising id goes to Meta only from people who allow it. So today the
   App Store answer is "No, we don't use data to track", as in section 3. **The day it is turned on**, update App Privacy (no new
   build): "Yes" to tracking for Product Interaction and Device ID, purpose Third-Party Advertising. On Android, Meta's SDK reads
   the advertising ID (`advertiserIDCollectionEnabled: true`): section 4 declares it as shared.
2. **Sentry and PostHog: declared either way.** Whether their keys are in the EAS build is not known, so the answers declare crash
   and performance data (Sentry) and product interaction for analytics (PostHog). Declaring a type that is not collected is
   allowed; leaving out one that is, is not.
3. **History is kept by default** (`HISTORY_DEFAULT_ON`, default true), and the privacy policy now says so: kept by default, can be
   turned off in Settings, deleted any time.
4. **The privacy manifest** (`app/assets/PrivacyInfo.xcprivacy`) now lists the same types as section 3 (name, email, phone number,
   contacts, emails or text messages, photos or videos, audio, other user content, user ID, purchase history, other financial info,
   product interaction, crash and performance data), with `NSPrivacyTracking` false. If Meta is turned on for iPhone, set it true
   and add the tracking domains in the next build.

## 2. What the app collects, and where

"Linked" means it is kept with the person's account. Nothing is sold. AI providers, Supabase, RevenueCat, Sentry and the stores
process data on X0 Bot's behalf (service providers); Meta is the only party that receives data for its own use (ads), and only as
section 1 says.

| Data | What exactly | Where in the code | Kept |
| --- | --- | --- | --- |
| Email address | The sign-in address (email code, Sign in with Apple, Google) | `app/src/auth/supabaseClient.ts`; Supabase Auth | Until the account is deleted |
| Phone number | Only for phone sign-in | `supabaseClient.ts` sendPhoneCode; Supabase Auth | Until deleted |
| Name | The name the person gives (the About you card on Home), or the sign-in provider's; shown to people in their Spaces | `PUT /v1/profile` (`tulmi/src/routes/account/profile.ts`), `profiles` (migrations 0003, 0007); `space_members.name` | Until deleted |
| Gender | Female, male or other, to address the person correctly | `PUT /v1/profile { gender }` | Until deleted |
| User ID | The account's ID (Supabase), also RevenueCat's app user ID | `tulmi/src/auth/supabase.ts`; `app/src/billing/purchases.ts` | Until deleted |
| Voice | Audio of dictation and of speaking to bots, sent to be turned into text, then discarded (never stored); and, on a call from Plan Ease, the live voice conversation streamed to OpenAI's realtime service (no audio stored by X0 Bot; its words are kept in the Plan Ease chat) | `/v1/transcribe-clean`, `/v1/stream` (`tulmi/src/routes/writing/transcribe.ts`, `routes/writing/transcribe-stream.ts`); `POST /v1/botsapp/bots/plan/calls/:id/live` (`tulmi/src/botsBots/planCallLive.ts`); OpenAI / Groq | Not stored (processed ephemerally) |
| Dictated text and history | What was dictated and the cleaned text, its language and voice | `cleanup_history` (`tulmi/src/history/store.ts`, migrations 0004, 0010) | On by default (section 1.3); 90-day purge of deleted rows; until the account is deleted |
| Messages | Words, photos and files people send each other in Spaces' chats and a space's feed. A message to one person there is seen by them, its sender and the space's admin (who made the space) | `tulmi/src/botsBots/threads.ts`, `spaceFeed.ts`, `thread_messages` (migrations 0051, 0068 to_id) | Until taken out, the space or the account is deleted (a sender's messages stay in others' chats) |
| Shared things | Lists, plans, notes, links, files, answers shared to a space or a person; one thing shared from Plan Ease, Notes, Travel bot or Xode (its title and a line, whose it is and who shared it: its owner, or the space's admin), and the notes people add to it | `tulmi/src/botsBots/shared.ts`, `space_items`; `grants.ts`, `work.ts`, `space_grants` (`by_id`: 0069), `space_work_notes` (0068) | Until taken out or deleted, or its owner leaves the space |
| What a space's admin sees and shares | Once a member agreed to "The space's admin can see and share your work and messages here.": their messages to one person in the space, and their own plans, notes, trips and Xode projects (to read, move a plan's time, add notes, and share one with someone in the space or everyone there; the member is not told of each share, and only the admin stops it) | `tulmi/src/botsBots/work.ts`, `grants.ts`, `spaceFeed.ts`, `space_members.consent_ms` (0068) and `consent_v` (0069) | While they are both in the space |
| Photos, videos and files | What the person picks or takes to give to a bot or send in a chat (and, with the image and video bots, what they make) | `app/src/sdui/media.ts` uploadFile → `POST /v1/files` (`tulmi/src/routes/files.ts`, `src/media`, `media_items`, a storage bucket) | `MEDIA_KEEP_DAYS` (30 days) unless sent or shared; until deleted |
| Other user content | Bots' chats and what they remember, asks to bots (200 characters in Activity), meeting notes, the calendar and to-dos, trips and places typed in, Code bot projects | `bot_chat_turns`, `bot_facts` (0038, 0042), `bots_app_events` (0040, 90 days), `notes` (0014), `calendar_events`/`calendar_tasks` (0054), `trips`, `plan_prefs` (0042, 0052), `code_projects` (0020+) | Until deleted |
| Contacts (people you invite) | Email addresses **typed, or picked from the phone's own contact picker**, to invite someone to a space; who is in your spaces; who asked to join a space with its code (their name, for its admin). The picker runs outside the app, needs no permission, and hands back only the one address tapped: **the address book itself is never read, uploaded, hashed, counted or matched** | `tulmi/src/botsBots/spaces.ts` inviteEmail, `inviteMail.ts`, `spaceJoin.ts`, `space_invites.email`, `space_join_requests` (0068), `space_members`; `mail_outbox`; the picker: `app/modules/tulmi-perms` `pickEmail`, SDUI action `contact.pick` | Invites: open 7 days, the row deleted 7 days after it expires; the invite mail deleted 7 days after it was queued once sent, failed or cancelled (`botsBots/inviteSweeper.ts`); requests: until the space is deleted; members: until they leave or are removed. Both go with the account |
| Where your day starts (coarse location) | The NAME of an area ("HSR Layout, Bengaluru"), typed, or filled in by one tap on *Use my location* on Plan Ease's day-starts card. On that tap the phone takes one foreground fix and **the phone's own geocoder** (Apple's on iPhone, Google's on Android) turns it into the area's parts; only those words reach JavaScript and only they are sent, after the person reads them and taps Save. **No coordinate ever reaches X0 Bot's servers**, and no street, house number or postcode is kept. Location while the app is closed is never asked for | `app/modules/tulmi-perms` `locationArea` (iOS `CLLocationManager` + `CLGeocoder`, accuracy 1 km; Android `LocationManager` network provider + `Geocoder`, `ACCESS_COARSE_LOCATION` only), SDUI action `location.area`, `PUT /v1/botsapp/bots/plan/home` → `planTravel.setHome`, `plan_prefs.home` | Until the person changes it, forgets it (You › Privacy › What this phone shares), or deletes the account |
| Health and fitness | Only for a bot the person made about fitness, and only after they switch on *Count my workouts* on its edit page: their **daily step total**, and each **workout's kind and minutes**. Nothing else — no heart rate, sleep, weight, routes, raw samples, times finer than a day, or which device or app it came from. Read only while that bot's page is open, at most once an hour, never in the background, and never written back to Apple Health or Health Connect. **Never sent to any AI service, never used for ads or marketing, never sold, never in a notification, widget or the phone's page cache** | `@kingstinct/react-native-healthkit` (iOS) / `react-native-health-connect` (Android) through `app/src/device/natives.ts`, SDUI action `health.sync`, `POST /v1/bots/:slug/health/days` (`routes/bots/botHealth.ts`), `bots/healthDays.ts`, `bot_health_days` (0090) | 31 days, swept by the clock; deleted the moment the switch goes off, with the bot, with Delete my data and with the account; gone from the encrypted backups within 30 days |
| People on a reminder | Who does one of the person's own items, in order: only people already in their X0 people (a space they share), as their account id and the name the person knows them by; whether an item is must not miss; every step X0 took for it (pushed, called, skipped and why) and every answer (Done, Later, Can't, and how). Optionally a number the person types for someone on their items, sealed, only to open their own phone's dialler (X0 never calls or messages it). Nothing is ever sent to anyone without X0 | `tulmi/src/botsBots/planFollow.ts`, `planFollowPeople.ts`, `calendar_tasks.people`/`calendar_events.people`, `plan_follows`, `plan_follow_steps`, `plan_numbers` (0081) | Follows: 90 days after they close; numbers: until removed, or until either account is deleted. A person's own account deletion also removes every number others saved for them (`plan_numbers.member_id` cascades, and `PlanFollows.forget` runs in the delete) and clears their name from other people's follows (shown as "Someone") |
| Phone number for real calls | Only if the person turns on "X0 may call my phone if I miss something important" (off by default, and only once real calls are set up): their own number, proved theirs by a call from it typing the code their screen shows, sealed, and when they agreed. A number whose owner pressed 9 on a call is kept only as a keyed hash, so X0 never calls it again (a do-not-call list: no number, no account). The calling provider (Plivo) gets the number and the reminder's lock-safe words for each call | `tulmi/src/botsBots/planFollowChannels.ts`, `plan_phones`, `plan_phone_stops` (0081), Backend B's `followPhone.ts` | The number: until they remove it or the account is deleted; the do-not-call hash: until a fresh proving call from that phone lifts it |
| Reports and blocks | A report: reason, note, a copy of what was reported; whom a person blocked | `tulmi/src/botsBots/safety.ts`, `blocks.ts`, `content_reports`, `user_blocks` (0057) | Reports: kept as a safety record; blocks: until unblocked or deleted |
| Purchase history | Which plan, its store, period end (no card numbers) | RevenueCat (`app/src/billing/purchases.ts`), `entitlements` (0008, 0009, 0056); Razorpay on the web and desktop (`razorpay_subscriptions`, 0015) | Until deleted (stores keep their own) |
| Other financial info | In a space's payment request: the payee's name and UPI ID, a note (and an amount only from older apps) | `tulmi/src/botsBots/payments.ts`, `space_payments` (0051, 0055) | Until the space is deleted |
| Product interaction | Usage counts (words, seconds of audio, which model), how asks went | `usage_events` (0001, 0016), `front_decisions` (0033), `you_spend` (0041) | Until deleted |
| Diagnostics | Keyboard counters (keystrokes, autocorrect reverts; never what was typed), app and build version | `keyboard_telemetry` (0006) | Until deleted |
| Crash and performance data | Crashes, errors, 5% of performance traces | Sentry (`app/src/telemetry/sentry.ts`), if `SENTRY_DSN` is set | 90 days (Sentry) |
| Push token | To deliver notifications the person allowed | `app/src/notifications/push.ts`, `push_tokens` (0005) | Until sign-out or deletion |
| Advertising ID (Android) | Read by Meta's SDK, for ad measurement | `app/src/telemetry/meta.ts`, `advertiserIDCollectionEnabled` in `app.config.ts` | Meta's policy |

**From build 8.9.1** (docs: perms2), more things the phone can hand over, each behind its own switch and its own card:

| Category | What | Where it comes from | Kept |
| --- | --- | --- | --- |
| Other user content | **Busy times** from the phone's calendars: each event's start, end and all-day, and nothing else. iPhone, and Android in a build with `TULMI_ANDROID_CALENDAR` | `plan_busy` (0094), `tulmi/src/botsBots/planBusy.ts` | each one a day after it ends (15 days at most); all of them when the row goes off |
| Other user content | The **X0 Bot Reminders list**'s items, as to-dos (title, due date, done) | `calendar_tasks.ext_src/ext_ref` (0094) | as the person's to-dos are; the link goes when the row goes off |
| Other data | Whether a **Focus** (or Do Not Disturb) is on, and whether calls or calls and pings wait. Never which Focus | `plan_prefs.focus` (0094) | 12 hours at most, overwritten at each change |
| Fitness info | **Steps** read from the iPhone's Motion & Fitness instead of Apple Health, and walks, runs and rides of 10 minutes or more. On Android (`TULMI_ANDROID_MOTION`) the phone's own step counter, and **daily steps only — no workouts at all** | `bot_health_days.source` (0094), with the bot's own `skills.healthSource` saying which reader it uses | 31 days |
| Health | **Sleep**: minutes slept per night. No stages, no bed or wake times | `bot_health_days.sleep_minutes` (0094) | 31 days |
| Other data | Whether the phone is **in a car**, asked once just before a Plan Ease call and answered yes or no | not stored | not kept past that call |
| Device or other IDs | The answers from **App Attest, DeviceCheck and Play Integrity** ("our real app on a real device"), and a random **install number** the app made (behind its own flag), both only to prevent fraud | `trust_*` (0093), `tulmi/src/trust/**` | 30 days |
| Other diagnostic data (abuse and fraud prevention signals) | A **keyed hash of the IP address** (keyed with TRUST_HASH_KEY, never the address itself), the **type of network** (home, mobile, data centre, VPN, Tor, from public lists on our server) and how many accounts use it. **Never turned into a place**: no country, city or area is derived or kept. **Only counted, never used to link one account to another** | `trust_*` (0093), `tulmi/src/trust/netKey.ts`, `netClass.ts` | 30 days; after deletion a keyed hash of the email and install number, 30 days |

**Arrival reminders collect nothing.** With *Remind me when I get there* on, the server sends the phone a place it already
knows and **the phone's own system** watches for it and shows the reminder. Nothing comes back: the server is never told where
the person is, or that they arrived.

On **iPhone** it is iOS's own location notification, which needs only *While Using* — no Always permission and no background
location mode, and the app is never woken. On **Android** (`TULMI_ANDROID_ARRIVAL`) the system watches a geofence and then
**wakes the app** to show the reminder, which IS background location use under Play's Location Permissions policy: the build
asks for `ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION`, Play needs the background-location declaration and a demo
video, and the app's own card says that it uses location "even when the app is closed or not in use" **before** anything is
asked. Still nothing is collected: the position never leaves the phone and no server hears of an arrival.

**Not collected:** precise location (nothing finer than an area's name is ever kept; from 8.9.1 the iPhone prompt starts on
Precise, and an Android build with arrival reminders asks for precise location too, because a phone watches an arrival place
no more exactly than the person allows — and still only the area's name is stored), location while the app is closed (on
iPhone: no Always permission, no background location, and no geofence of our own, the system's notification trigger being the
phone's; on Android: a geofence the phone's own system holds, which wakes the app to show the reminder and tells no server
anything), the phone's **address book** (the system picker hands back one
address and the book is never read), event names, places, notes, attendees and calendar names (only busy times leave the
phone), any Reminders list but the one X0 Bot makes, which Focus is on, a raw motion sample or any activity other than a walk,
a run or a ride of ten minutes or more, any health type but daily steps, workouts and sleep minutes, browsing history, search
history, the music library, Bluetooth, payment card numbers, the IDFA on iPhone. Typing in the keyboard is never sent except when the person uses the mic or a refine action, and never from secure
fields.

## 3. App Store: App Privacy

App Store Connect, the app, App Privacy. Answer "Yes, we collect data from this app". Assumes section 1: Meta off on iPhone,
Sentry on, PostHog off.

**Data Used to Track You:** none. (If Meta stays on on iPhone, see section 1.1.)

**Data Linked to You** (each: linked to the user's identity: Yes; used for tracking: No):

| Category | Type | Purposes | Where |
| --- | --- | --- | --- |
| Contact Info | Name | App Functionality | Profile; shown to people in your spaces |
| Contact Info | Email Address | App Functionality | Sign-in; space invites by email |
| Contact Info | Phone Number | App Functionality | Phone sign-in only |
| Contacts | Contacts | App Functionality | Email addresses you type **or pick from your contacts** to invite people to a space, and your spaces' members. The address book itself is never read |
| Location | Coarse Location | App Functionality | The area your day starts from, when you tap *Use my location* (the name only, never a coordinate) |
| Health and Fitness | Health | App Functionality | Daily steps and workouts, and nightly sleep minutes, for a fitness bot you switched on |
| Health and Fitness | Fitness | App Functionality | The same daily steps and workouts, from Apple Health or (8.9.1) Motion & Fitness. Apple's Fitness type names the Motion and Fitness API itself |
| User Content | Emails or Text Messages | App Functionality | Messages in Spaces' chats and feeds (a message to one person is also seen by the space's admin) |
| User Content | Photos or Videos | App Functionality | Photos and videos you give to a bot, send in a chat, or make with the image and video bots |
| User Content | Audio Data | App Functionality | Dictation and voice asks (turned into text, then discarded) and the live voice of a call from Plan Ease (not stored by X0 Bot; its words are kept in the Plan Ease chat) |
| User Content | Other User Content | App Functionality, Product Personalization | Dictated text and history, bots' chats and memory, notes, calendar and to-dos, shared things, files, reports you make |
| Identifiers | User ID | App Functionality | The account ID (and RevenueCat's app user ID) |
| Identifiers | Device ID | App Functionality | **From 8.9.1, fraud prevention only:** the answers from App Attest, DeviceCheck and Play Integrity, and the random install number the app makes (behind its own flag). **Not used for tracking** |
| Purchases | Purchase History | App Functionality | Subscriptions through Apple (RevenueCat) |
| Financial Info | Other Financial Info | App Functionality | UPI IDs and notes in a space's payment requests |
| Usage Data | Product Interaction | App Functionality, Analytics | Usage counts that run the usage meter and limits |
| Diagnostics | Crash Data | App Functionality, Analytics | Sentry |
| Diagnostics | Performance Data | Analytics | Sentry traces; keyboard counters |
| Diagnostics | Other Diagnostic Data | **App Functionality**, Analytics | Keyboard counters (never text); **App Functionality from the server half of fraud prevention** (the type of network a request comes from, and the counts per network) |
| Other Data | Other Data Types | App Functionality | Gender, to address you correctly; **from 8.9.1** whether a Focus is on (never which) and whether the phone is in a car just before a call |

**Data Not Linked to You:** none.

**Not collected:** Financial Info's payment info and credit info, **Precise Location** (nothing precise is collected or kept;
from 8.9.1 the prompt starts on Precise so the phone can watch an arrival place itself, and only an area's name is ever stored),
Sensitive Info, Browsing History, Search History, Usage Data's Advertising Data. **Device ID is collected from 8.9.1** (the row
above: attestation answers and the install number, App Functionality, not tracking) — it was in this line before 8.9.1 and must
not be in both. Every type above is **linked** to the account, used for **App Functionality**, and **not used for tracking**.

Notes for the questions App Store Connect asks along the way:

* Audio: it is sent to OpenAI or Groq to be turned into text, or, on a call from Plan Ease, streamed live to OpenAI's realtime voice
  service, and not stored by X0 Bot. Apple counts data kept only long enough to answer the request as not collected, but the
  providers may hold it briefly under their own terms, so it is declared.
* Photos or Videos and Emails or Text Messages are only what the person chooses to send; nothing reads the photo library or the
  phone's messages.
* Privacy policy URL: https://x0bot.com/privacy . Account deletion is in the app (You, Delete account) and on the web.

### 3.1 AI processing, posting and reports (App Review 5.1.1, 5.1.2(i), 1.2, 4.7.1; Nov 2026)

* **Permission before anything goes to an AI service.** Home asks first (screens/firstRun/aiConsentCard.ts): what is sent (words,
  voice, the photos, files or screen they share), to whom (OpenAI, Anthropic, Google, Groq, Deepgram, Sarvam AI, OpenRouter and the
  model makers behind it), why, Agree and Not now. Asked once: Agree, Not now and the switch off are each kept as the answer
  (personality.aiConsentAskedVersion; Not now only records it and never takes back a yes, which only the switch does), and the card
  comes back only when what is sent changes (AI_CONSENT_VERSION goes up). No other screen asks: without a yes, Plan Ease's capture
  takes the rules road and its call plays in the phone's voice, saying nothing about AI. The server enforces it (src/privacy/aiGate.ts): every call to those hosts asks whether the request's person agreed; dictation's
  socket, routines and Xode's PR care ask by name, and a refusal says to turn it on in You › Privacy. On or off anytime there, "Send to
  AI services". Kept as personality.aiConsentAt / aiConsentVersion; raise AI_CONSENT_VERSION to ask everyone again.
  AI_CONSENT_GATE=false switches the enforcement off (emergency only).
* **A call from Plan Ease** ("X0 is calling", docs/plan-ease.md section 8): what the person says on the call and the bot's replies go
  to AI services only with that permission, through the Plan Ease chat and the voice service that reads the replies aloud. Without it,
  the opening line is spoken by the phone's own voice and nothing of the call leaves the phone. On a store build that can hold a live
  call, and with that permission, the person's voice streams live to OpenAI's realtime voice service, which hears them and answers in a
  voice: X0 Bot stores no audio, OpenAI keeps it only in abuse-monitoring logs for up to 30 days and does not train on it, and the
  words of the call are kept as messages in the person's Plan Ease chat. The permission taken back hangs up a live call at once.
  A call is never held to any money limit; what it cost is recorded on its own row for the owner (plan_calls.cost_usd).
* **Which things Plan Ease calls about** (docs/plan-call-judge.md): with that permission and the person's Calls setting on, when they add
  or change something on their Plan, Plan Ease's AI reads that item (its title, time, place, who is on it, and for a bill its amount and
  payee) with the rest of that day, and decides whether it is important enough to call about, and when. Only the decision and a one-line
  reason are kept; they go when the permission is taken back, with the account, and 30 days after the item. Without the permission,
  Plan Ease calls only when it is time to leave or a bill is due today.
* **"Plan something"** (docs/plan-ease.md section 10) may send the words a person types in its box (300 characters at most), and for a
  change the card's own fields, to the AI providers already listed. This happens only with their AI permission, only when the rules
  could not read the words, and only on Plan Ease's own budget. No contact list and no picked person's name is sent; another person's
  name goes only when the person typed it. Nothing is kept by X0 from the read: the draft lives on the screen until Done.
* **Usage statistics** (PostHog) are off until the person turns on "Share usage statistics" in You › Privacy (the bootstrap's
  `analytics.enabled`, per person; the app's default is off).
* **Posting in Spaces is screened** before it is posted (src/botsBots/filter.ts): a word list always, OpenAI's moderation model too
  where OPENAI_API_KEY is set and the sender agreed to AI processing. Refused: 422 blocked_content, with the reason.
* **A bot's answer can be reported** ("Report" beside "Share", and under Xode's answers): kind "answer" in the same 24-hour queue
  (migration 0067).

## 4. Google Play: Data safety

Play Console, App content, Data safety.

**Overview questions**

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS only: `app/src/security.ts` checkBaseUrl) |
| Do you provide a way for users to request that their data is deleted? | Yes. In the app (You, Delete account) and at https://x0bot.com/delete-account |
| Account creation | Yes: email code, phone code, Google, Apple. Delete account URL: https://x0bot.com/delete-account |
| Committed to Play Families Policy | No (not for children; 13+, Terms section 1) |
| Independent security review | No |

**Data types** ("Collected" = sent off the phone and kept or processed; "Shared" = given to a third party for its own use. Service
providers acting for X0 Bot are not "shared". "Optional" = the app works without it. **"Ephemeral" is Play's own word for data
held only in memory for the length of the request and never written down** — so anything we keep, even for a day, answers **No**.
Three rows were marked Yes and are now No: Approximate location (the area's name is kept until the person changes it), Fitness
info and Health info (31 days each). Approximate location and Fitness info were **already filed** with Yes, so the owner changes
those two answers in Play Console as well, not only here. Calendar events is No for the same reason from 8.9.1: a busy time is
written down and kept for up to fifteen days.)

| Category | Data type | Collected | Shared | Ephemeral | Required or optional | Purposes |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info | Name | Yes | No | No | Required (the first run asks it) | App functionality, Account management |
| Personal info | Email address | Yes | No | No | Required for email sign-in (Optional with phone sign-in) | App functionality, Account management |
| Personal info | Phone number | Yes | No | No | Optional (phone sign-in only) | Account management |
| Personal info | User IDs | Yes | No | No | Required | App functionality, Account management |
| Personal info | Other info | Yes (gender) | No | No | Optional | App functionality, Personalization |
| Financial info | Purchase history | Yes | No | No | Optional | App functionality, Account management |
| Financial info | Other financial info | Yes (UPI IDs in payment requests) | No | No | Optional | App functionality |
| Messages | Other in-app messages | Yes (Spaces' chats and feeds) | No | No | Optional | App functionality |
| Photos and videos | Photos | Yes | No | No | Optional | App functionality |
| Photos and videos | Videos | Yes | No | No | Optional | App functionality |
| Audio | Voice or sound recordings | Yes (dictation, and the live voice of a call from Plan Ease) | No | Yes | Optional (needed for dictation) | App functionality |
| Files and docs | Files and docs | Yes (files given to a bot or sent in a chat) | No | No | Optional | App functionality |
| Calendar | Calendar events | Yes (the app's own calendar, the events the person adds; and, **only in a release whose Android build has `TULMI_ANDROID_CALENDAR`**, the **busy times** read from the phone's calendars: each event's start, end and all-day flag, and nothing else — no title, place, note, person or calendar name ever leaves the phone) | No | **No** (a busy time is kept until a day after it ends, fifteen days at most) | Optional | App functionality |
| Contacts | Contacts | Yes (emails typed **or picked from the phone's contact picker** to invite people, and spaces' members; the address book itself is never read) | No | No | Optional | App functionality |
| Location | Approximate location | Yes (the name of the area your day starts from, when you tap *Use my location*) | No | **No** | Optional | App functionality |
| Location | Precise location | **No** — the permission is in the build **only with `TULMI_ANDROID_ARRIVAL`**, and only so the PHONE can watch a place for an arrival reminder. The position never reaches JavaScript, this app's servers or anyone else, so there is nothing collected to answer Yes about. Play's **background location** access is declared separately (see below) | No | n/a | Optional | App functionality |
| Health and fitness | Fitness info | Yes (daily steps and workouts, for a fitness bot you switched on) — **only in a release whose Android build has Health Connect**, or, for **daily steps alone and no workouts at all**, whose build has `TULMI_ANDROID_MOTION` (the phone's own step counter) | No | **No** | Optional | App functionality |
| Health and fitness | Health info | Yes (minutes slept per night, for a fitness bot you switched sleep on for) — **only in a release whose Android build has `READ_SLEEP`** (`TULMI_ANDROID_HEALTH_SLEEP` on, which needs Play's approval of the refiled Health Connect form first) | No | **No** | Optional | App functionality |
| App activity | App interactions | Yes (usage counts) | No | No | Required | App functionality, Analytics |
| App activity | Other user-generated content | Yes (dictated text and history, bots' chats, notes, shared things, reports) | No | No | Optional | App functionality, Personalization |
| App activity | Other actions | Yes (install, opens and three milestones, to Meta; **from 8.9.1** whether Do Not Disturb is on at the moment of a call, if the person turned that row on; and, in a build with `TULMI_ANDROID_MOTION`, the one-word "in a car?" answer just before a call, used in memory for that call and never written down) | **Yes, Meta** (the Meta milestones only; never the Do Not Disturb or driving answer) | No | Required | Advertising or marketing, Analytics, App functionality |
| App info and performance | Crash logs | Yes (Sentry) | No | No | Required | App functionality, Analytics |
| App info and performance | Diagnostics | Yes (keyboard counters, performance traces) | No | No | Required | Analytics |
| Device or other IDs | Device or other IDs | Yes (push token; the advertising ID, read by Meta's SDK; **from 8.9.1** Play Integrity's answer and the app's own random install number; **from 8.9.1**, server side, a keyed hash of the network address a request came from and its network type, for fraud prevention only, 30 days) | **Yes, Meta** (advertising ID only; never the integrity answer or the install number) | No | Required | App functionality (push), Advertising or marketing, Analytics (advertising ID), **Fraud prevention, security, and compliance** |

**Not collected:** Web browsing, Payment info (cards are handled by Google Play), Credit score, Race and ethnicity, Political or religious beliefs,
Sexual orientation, Address, SMS or MMS, Emails, Music files, Other audio files, Installed apps, In-app search history,
**the phone's address book** (the system picker returns one address and needs no permission).

**Deletion answers:** everything above is deleted on request (You › Privacy › Delete my data, or Delete account, or
x0bot.com/delete-account). Steps and workouts are also deleted the moment the person switches the bot's row off, and after 31
days whether or not they do. Our database backups are encrypted and kept 30 days, so anything deleted is gone from them within
30 days.

If Meta is switched off on Android too (`ads.meta.enabled` false for `android`, or no `META_APP_ID` in the build), change "Other
actions" and the advertising ID to not collected and not shared, and answer "No" to sharing overall.

**Android permissions the build asks for** (`app/app.config.ts`, after this change): microphone (`RECORD_AUDIO`, dictation and the
keyboard), notifications (`POST_NOTIFICATIONS`), camera (`CAMERA`, from expo-image-picker and expo-camera: taking a photo to use),
biometrics (`USE_BIOMETRIC`, approvals), billing, network state, vibrate, and storage up to Android 12 only (`READ/WRITE_EXTERNAL_STORAGE`
with `maxSdkVersion` 32), **`ACCESS_COARSE_LOCATION`** (one foreground fix on *Use my location*), and, only in a build with the
Android health switch on, **`android.permission.health.READ_STEPS`** and **`android.permission.health.READ_EXERCISE`** — plus,
only with the SECOND switch on too (`TULMI_ANDROID_HEALTH_SLEEP`, which waits for Play's approval of the refiled Health Connect
form), **`android.permission.health.READ_SLEEP`**. Never `READ_HEALTH_DATA_IN_BACKGROUND` or `READ_HEALTH_DATA_HISTORY`.
`READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` and `READ_MEDIA_VISUAL_USER_SELECTED` are blocked: the system photo
picker needs no permission. So are `FOREGROUND_SERVICE_LOCATION`, `READ_CONTACTS` and `WRITE_CONTACTS`, so no library can merge
one in. **No contacts permission is in the build**: the contact picker is an `ACTION_PICK` intent and needs none.
`ACCESS_NOTIFICATION_POLICY` stays blocked too: reading Do Not Disturb needs no permission, and X0 Bot never changes it.
`WRITE_CALENDAR` stays blocked: *Add to my calendar* on Android is an `ACTION_INSERT` intent, which needs none, and X0 Bot never
writes to a calendar.

**THE THREE ANDROID HALVES OF 8.9.1, each behind its own build switch and each blocked (`tools:node="remove"`) when its switch
is off**, so a build without the switch cannot have the permission merged in by any library:

| Build switch | Permissions | Play declaration | Server switch that draws the row |
| --- | --- | --- | --- |
| `TULMI_ANDROID_CALENDAR` | `android.permission.READ_CALENDAR` (read only) | none | `PERM_CALENDAR_READ` **and** `PERM_CALENDAR_READ_ANDROID` |
| `TULMI_ANDROID_MOTION` | `android.permission.ACTIVITY_RECOGNITION` (API 29+) and `com.google.android.gms.permission.ACTIVITY_RECOGNITION` (the install-time twin Play services checks on API 24-28) | none | `PERM_MOTION` **and** `PERM_MOTION_ANDROID`; the driving check also wants `PERM_MOTION_DRIVE` and `PERM_MOTION_DRIVE_ANDROID` |
| `TULMI_ANDROID_ARRIVAL` | `android.permission.ACCESS_FINE_LOCATION` and `android.permission.ACCESS_BACKGROUND_LOCATION` | **YES: the background-location declaration, a demo video and a human review** (see `docs/owner-8.9.1.md`) | `PERM_ARRIVAL` **and** `PERM_ARRIVAL_ANDROID` (+ its account list) |

`RECEIVE_BOOT_COMPLETED` is NOT one of these and must not be added to the list or blocked: expo-notifications already declares
it in every build, and blocking it would strip it out of the merged manifest and silently lose every scheduled local
notification after a reboot.

**The background-location declaration says, in the app and in Play Console, the same thing**: X0 Bot uses location in the
background **only** to show the arrival reminders the person turns on, and **only** when they turn one on — "even when the app
is closed or not in use", in Play's own words, said on a card BEFORE anything is asked (the prominent disclosure). The position
itself never leaves the phone: the phone's own system watches the place and wakes the app to show the reminder, and no server
is ever told where the person is or that they arrived. No tracking, no route, no history, no third party.

## 5. Keep it true

* A new SDK, a new kind of upload, location, contacts from the phone, or anything sent to a new third party changes these answers:
  update this file, the privacy policy (`tulmi/src/routes/site/policies/privacy.ts`) and the privacy manifest in the same change, and
  re-answer both stores' forms.
* iOS purpose strings live in `app/app.config.ts` (`ios.infoPlist`); each kept key says why it is there. Add a key only in the
  release that asks for it.
