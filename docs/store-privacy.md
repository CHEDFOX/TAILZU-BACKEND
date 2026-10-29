# Store privacy answers: App Store "App Privacy" and Google Play "Data safety"

The answers for the X0 Bot phone app (bundle `com.tulmi.app`, both stores) as the code is now (29 Oct 2026), ready to paste into
App Store Connect (App Privacy) and Play Console (App content, Data safety). Every answer says where in the code the data comes from,
so it can be checked again when the code changes. Paths are from the repo roots: `tulmi/` is this repo's server, `app/` is
TAILZU-FRONTEND's phone app.

The account deletion link for Play is **https://x0bot.com/delete-account** (`tulmi/src/routes/accountDeletion.ts`,
`tulmi/src/routes/policies/deleteAccount.ts`, proxied by TAILZU-WEB `vercel.json`).

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
| Name | The name the person gives (first run, About you), or the sign-in provider's; shown to people in their Spaces | `PUT /v1/profile` (`tulmi/src/server.ts`), `profiles` (migrations 0003, 0007); `space_members.name` | Until deleted |
| Gender | Female, male or other, to address the person correctly | `PUT /v1/profile { gender }` | Until deleted |
| User ID | The account's ID (Supabase), also RevenueCat's app user ID | `tulmi/src/auth/supabase.ts`; `app/src/billing/purchases.ts` | Until deleted |
| Voice | Audio of dictation and of speaking to bots, sent to be turned into text, then discarded (never stored) | `/v1/transcribe-clean`, `/v1/stream` (`tulmi/src/server.ts`, `routes/transcribe-stream.ts`); OpenAI / Groq | Not stored (processed ephemerally) |
| Dictated text and history | What was dictated and the cleaned text, its language and voice | `cleanup_history` (`tulmi/src/history/store.ts`, migrations 0004, 0010) | On by default (section 1.3); 90-day purge of deleted rows; until the account is deleted |
| Messages | Words, photos and files people send each other in Spaces' chats | `tulmi/src/botsBots/threads.ts`, `thread_messages` (migration 0051) | Until taken out, the space or the account is deleted (a sender's messages stay in others' chats) |
| Shared things | Lists, plans, notes, links, files, answers shared to a space or a person | `tulmi/src/botsBots/shared.ts`, `space_items` | Until taken out or deleted |
| Photos, videos and files | What the person picks or takes to give to a bot or send in a chat (and, with the image and video bots, what they make) | `app/src/sdui/media.ts` uploadFile → `POST /v1/files` (`tulmi/src/routes/files.ts`, `src/media`, `media_items`, a storage bucket) | `MEDIA_KEEP_DAYS` (30 days) unless sent or shared; until deleted |
| Other user content | Bots' chats and what they remember, asks to bots (200 characters in Activity), meeting notes, the calendar and to-dos, trips and places typed in, Code bot projects | `bot_chat_turns`, `bot_facts` (0038, 0042), `bots_app_events` (0040, 90 days), `notes` (0014), `calendar_events`/`calendar_tasks` (0054), `trips`, `plan_prefs` (0042, 0052), `code_projects` (0020+) | Until deleted |
| Contacts (people you invite) | Email addresses typed to invite someone to a space; who is in your spaces. The phone's contacts are never read | `tulmi/src/botsBots/spaces.ts` invite, `space_invites.email`, `space_members`; `mail_outbox` | Invites: 7 days; members: until they leave or are removed |
| Reports and blocks | A report: reason, note, a copy of what was reported; whom a person blocked | `tulmi/src/botsBots/safety.ts`, `blocks.ts`, `content_reports`, `user_blocks` (0057) | Reports: kept as a safety record; blocks: until unblocked or deleted |
| Purchase history | Which plan, its store, period end (no card numbers) | RevenueCat (`app/src/billing/purchases.ts`), `entitlements` (0008, 0009, 0056); Razorpay on the web and desktop (`razorpay_subscriptions`, 0015) | Until deleted (stores keep their own) |
| Other financial info | In a space's payment request: the payee's name and UPI ID, a note (and an amount only from older apps) | `tulmi/src/botsBots/payments.ts`, `space_payments` (0051, 0055) | Until the space is deleted |
| Product interaction | Usage counts (words, seconds of audio, which model), how asks went | `usage_events` (0001, 0016), `front_decisions` (0033), `you_spend` (0041) | Until deleted |
| Diagnostics | Keyboard counters (keystrokes, autocorrect reverts; never what was typed), app and build version | `keyboard_telemetry` (0006) | Until deleted |
| Crash and performance data | Crashes, errors, 5% of performance traces | Sentry (`app/src/telemetry/sentry.ts`), if `SENTRY_DSN` is set | 90 days (Sentry) |
| Push token | To deliver notifications the person allowed | `app/src/notifications/push.ts`, `push_tokens` (0005) | Until sign-out or deletion |
| Advertising ID (Android) | Read by Meta's SDK, for ad measurement | `app/src/telemetry/meta.ts`, `advertiserIDCollectionEnabled` in `app.config.ts` | Meta's policy |

**Not collected:** precise or coarse location (no location permission or API; places for Travel and Plan are typed text, and the
time zone offset is a setting), the phone's contacts, calendars or reminders (the app keeps its own calendar on the server),
health or fitness, browsing history, search history, the music library, Bluetooth, motion data, payment card numbers, the IDFA on
iPhone. Typing in the keyboard is never sent except when the person uses the mic or a refine action, and never from secure fields.

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
| Contacts | Contacts | App Functionality | Email addresses you type to invite people to a space, and your spaces' members. The phone's contacts are never read |
| User Content | Emails or Text Messages | App Functionality | Messages in Spaces' chats |
| User Content | Photos or Videos | App Functionality | Photos and videos you give to a bot, send in a chat, or make with the image and video bots |
| User Content | Audio Data | App Functionality | Dictation and voice asks (turned into text, then discarded) |
| User Content | Other User Content | App Functionality, Product Personalization | Dictated text and history, bots' chats and memory, notes, calendar and to-dos, shared things, files, reports you make |
| Identifiers | User ID | App Functionality | The account ID (and RevenueCat's app user ID) |
| Purchases | Purchase History | App Functionality | Subscriptions through Apple (RevenueCat) |
| Financial Info | Other Financial Info | App Functionality | UPI IDs and notes in a space's payment requests |
| Usage Data | Product Interaction | App Functionality, Analytics | Usage counts that run the usage meter and limits |
| Diagnostics | Crash Data | App Functionality, Analytics | Sentry |
| Diagnostics | Performance Data | Analytics | Sentry traces; keyboard counters |
| Diagnostics | Other Diagnostic Data | Analytics | Keyboard counters (never text) |
| Other Data | Other Data Types | App Functionality | Gender, to address you correctly |

**Data Not Linked to You:** none.

**Not collected:** Health and Fitness, Financial Info's payment info and credit info, Location (precise and coarse), Sensitive
Info, Browsing History, Search History, Identifiers' Device ID (no IDFA; with Meta off on iPhone), Usage Data's Advertising Data.

Notes for the questions App Store Connect asks along the way:

* Audio: it is sent to OpenAI or Groq to be turned into text and not stored by X0 Bot. Apple counts data kept only long enough to
  answer the request as not collected, but the providers may hold it briefly under their own terms, so it is declared.
* Photos or Videos and Emails or Text Messages are only what the person chooses to send; nothing reads the photo library or the
  phone's messages.
* Privacy policy URL: https://x0bot.com/privacy . Account deletion is in the app (You, Delete account) and on the web.

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
providers acting for X0 Bot are not "shared". "Optional" = the app works without it.)

| Category | Data type | Collected | Shared | Ephemeral | Required or optional | Purposes |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info | Name | Yes | No | No | Required (the first run asks it) | App functionality, Account management |
| Personal info | Email address | Yes | No | No | Required for email sign-in (Optional with phone sign-in) | App functionality, Account management |
| Personal info | Phone number | Yes | No | No | Optional (phone sign-in only) | Account management |
| Personal info | User IDs | Yes | No | No | Required | App functionality, Account management |
| Personal info | Other info | Yes (gender) | No | No | Optional | App functionality, Personalization |
| Financial info | Purchase history | Yes | No | No | Optional | App functionality, Account management |
| Financial info | Other financial info | Yes (UPI IDs in payment requests) | No | No | Optional | App functionality |
| Messages | Other in-app messages | Yes (Spaces' chats) | No | No | Optional | App functionality |
| Photos and videos | Photos | Yes | No | No | Optional | App functionality |
| Photos and videos | Videos | Yes | No | No | Optional | App functionality |
| Audio | Voice or sound recordings | Yes | No | Yes | Optional (needed for dictation) | App functionality |
| Files and docs | Files and docs | Yes (files given to a bot or sent in a chat) | No | No | Optional | App functionality |
| Calendar | Calendar events | Yes (the app's own calendar, events the person adds; not the phone's) | No | No | Optional | App functionality |
| Contacts | Contacts | Yes (emails typed to invite people, and spaces' members; not the phone's contacts) | No | No | Optional | App functionality |
| App activity | App interactions | Yes (usage counts) | No | No | Required | App functionality, Analytics |
| App activity | Other user-generated content | Yes (dictated text and history, bots' chats, notes, shared things, reports) | No | No | Optional | App functionality, Personalization |
| App activity | Other actions | Yes (install, opens and three milestones, to Meta) | **Yes, Meta** | No | Required | Advertising or marketing, Analytics |
| App info and performance | Crash logs | Yes (Sentry) | No | No | Required | App functionality, Analytics |
| App info and performance | Diagnostics | Yes (keyboard counters, performance traces) | No | No | Required | Analytics |
| Device or other IDs | Device or other IDs | Yes (push token; the advertising ID, read by Meta's SDK) | **Yes, Meta** (advertising ID) | No | Required | App functionality (push), Advertising or marketing, Analytics (advertising ID) |

**Not collected:** Location (approximate and precise), Web browsing, Health and fitness, Payment info (cards are handled by Google
Play), Credit score, Race and ethnicity, Political or religious beliefs, Sexual orientation, Address, SMS or MMS, Emails, Music files,
Other audio files, Installed apps, In-app search history, Contacts from the phone.

If Meta is switched off on Android too (`ads.meta.enabled` false for `android`, or no `META_APP_ID` in the build), change "Other
actions" and the advertising ID to not collected and not shared, and answer "No" to sharing overall.

**Android permissions the build asks for** (`app/app.config.ts`, after this change): microphone (`RECORD_AUDIO`, dictation and the
keyboard), notifications (`POST_NOTIFICATIONS`), camera (`CAMERA`, from expo-image-picker and expo-camera: taking a photo to use),
biometrics (`USE_BIOMETRIC`, approvals), billing, network state, vibrate, and storage up to Android 12 only (`READ/WRITE_EXTERNAL_STORAGE`
with `maxSdkVersion` 32). `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` and `READ_MEDIA_VISUAL_USER_SELECTED` are
blocked: the system photo picker needs no permission. No contacts, calendar or location permission is in the build.

## 5. Keep it true

* A new SDK, a new kind of upload, location, contacts from the phone, or anything sent to a new third party changes these answers:
  update this file, the privacy policy (`tulmi/src/routes/policies/privacy.ts`) and the privacy manifest in the same change, and
  re-answer both stores' forms.
* iOS purpose strings live in `app/app.config.ts` (`ios.infoPlist`); each kept key says why it is there. Add a key only in the
  release that asks for it.
