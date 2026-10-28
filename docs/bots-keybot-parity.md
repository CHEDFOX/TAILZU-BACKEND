# Keybot carries the old Stats and You tabs

The owner's ask: *"in the Keybot we will use all the things that the Stats and You page had earlier, just in the new
visual direction."* This is the inventory of the old screens (BOTS_APP off) on the phone and in the window, each item with
where its data came from, and where it lives now in the Bots app. Every line is ticked; a line that is not moved says why.

**Where things are now**

| | |
| --- | --- |
| `bots.keybot` (screens/keybot.ts) | Keybot's home: the numbers up top, then the You tab's lines in groups, then what the key does |
| `bots.keybot.month` · `.day` · `.apps` · `.speak` · `.days` (screens/keybotStats.ts) | the old Stats tab's detail cards, and the desk's Insights, Day and App pages |
| `bots.keybot.style` · `.haptics` · `.name` (screens/keybotYou.ts) | the old Voice list, Haptics picker and "What you call me" page |
| `bots.keybot.tone` · `.words` · `.voices` · `.train` · `.history` · `.settings` (screens/keybot.ts) | Keybot's pages that were already there (words gained spellings, shortcuts and how the words do; the window's keyboard page gained "Start with the computer") |
| `bots.language`, `bots.billing`, `bots.privacy`, `bots.notify`, `bots.apps`, `bots.tasks`, `bots.computer`, `bots.settings`, `bots.delete-account` | the You tab's own pages (Keybot is part of the app, so account items are not repeated in it) |
| `GET /v1/keybot/stats` (routes/botsKeybot.ts → src/keybot/stats.ts) | the old Stats screen's own reads, as one view: `statsForUser(user, "month", tz, saved words, languages)`, `usageSummary`, `allowanceFor`, the entitlement, `FREE_FOR_ALL` |
| `GET /v1/keybot` (src/keybot/views.ts homeView) | the week, and now the You tab's lines: the voice, languages, haptics, what it learned, its name, history kept, spellings, shortcuts |
| `GET /v1/personality` | read by Voice, Haptics and What you call it, as the old screens read `ctx.personality` |

Writes are the old screens' own routes: `PUT /v1/personality` (voice, retainHistory, assistantName), `POST /v1/personality/pin`,
`POST /v1/personality/tone`, `POST /v1/personality/haptics`, `PUT /v1/profile { dictionary }`, `POST /v1/words`, `POST /v1/snippets`.

Charts are the kit's look (screens/keybotParts.ts): bars and columns in clay (Keybot's own colour) with the one the chart is
about in clay and the rest grey, a calendar in three steps of clay, figures as tiles. Rings and pies became bars (close shares
read better as lengths); curves over days became columns (a day is one bucket). Each chart's numbers are also rows on its page.

Tests: tests/bots-keybot-parity.test.ts (every item below that is on Keybot's home is asserted there, on both clients).

## 1. The old phone Stats tab (screen `stats`)

`catalog.ts statsScreen` + `phoneLook.ts phoneStatsBody`. Data: server.ts read for `stats` usageSummary (the calendar month,
all time, today), statsForUser "month" (the last 30 days), allowanceFor, getEntitlement, the personality; `freeForAll()`.
Now: `GET /v1/keybot/stats`.

### The page

- [x] **The month's name, large** ("October") → Keybot, "October so far" on the month card.
- [x] **Words this month, paid or free for everyone**: "N. No limit on your plan." → Keybot month card, "Words this month · N" and
  "No limit on your plan.". *The thin bar under it was drawn against a fixed 120,000-word span that is no limit at all; it
  is not drawn, since it showed a number that does not exist.*
- [x] **Words left, free plan**: "X of Y, back on the 1st.", its bar, "N of these you earned by turning up" (or "the most there
  is") → Keybot month card: a clay meter "Words left · X of Y" and the same line.
- [x] **Nothing yet**: "Nothing here yet." and its line; "Nothing yet this month." → Keybot month card, same words.
- [x] **"N words this month."** (when there is no allowance) → Keybot month card, the big number.
- [x] **"Typed, they would have taken X. Said, Y."** → Keybot month card (and "About Z saved").
- [x] **Said and Typed lanes**, opening the "This month" card → Keybot month card lanes; the card opens `bots.keybot.month`.
- [x] **Today**: "Today", the week as seven dots, "N words, said in X.", the day so far as a curve, opening today's card →
  Keybot "Today" card (the day so far as hour columns, the hour now in clay, hours to come flat), opening `bots.keybot.day`.
  The week's seven days are the "This week" card's columns.
- [x] **Where the words went**: the top four apps, a bar and a share each, opening the apps card → Keybot "Where the words
  went" (each app its bar, share and its kind's tone line, each opening `bots.keybot.apps?app=…`; "Every app" opens the list).
- [x] **How you speak**: a ring of the languages with their count, and said / typed / drafted bars, opening the languages card
  → Keybot "How you speak · N languages": each language a bar with its share; "How the words came" bars; opens `bots.keybot.speak`.
- [x] **How you speak, before any language** ("…languages in the last 30 days" note) → the card's empty line.
- [x] **Days you talked**: thirty days as a calendar, Monday first, today ringed, today amber while the streak runs, each day
  opening its card → Keybot "Days you talked": the calendar in three steps of clay, today ringed in ink, each day opening
  `bots.keybot.day?day=i`, and a legend. The live streak is the clay dot on the Day streak figure. *The dates of the weeks
  either side of the window (drawn faint) are blank cells now: they are not days with data, and the blank keeps the shape.*
- [x] **"N of the last 30 days. The longest run was M."**, opening the active-days card → the line under the calendar, opening
  `bots.keybot.days`.
- [x] **The last 30 days, six figures**: Sessions, Day streak (live), Per session, Spoken, Voices (the top voice's share),
  Dictionary (share in use), each opening its card → Keybot "The last 30 days": the same six (Dictionary is "Your words · N%
  in use"), opening `bots.keybot.days` (sessions, streak, per session), `.month` (spoken), `.speak` (voices), `.words` (words).
- [x] **"Full history"** → Keybot "What you said" row → `bots.keybot.history`.
- [x] **"Personalise your experience · Les go"** (to the You tab) → *not a card any more: the You tab's lines are on the same
  page, under the numbers ("Make it yours").*
- [x] **The settings gear** → "Settings and sign out" (`bots.settings`); Keybot's own settings are "Keyboard" (phone) and
  "Settings" / "Keys and the pill" (window).
- [x] **The notification ask the first time Stats shows** (the old bootstrap's `pushAsk`, screen `stats`) → *not a screen
  element: it belongs to the bootstrap, which the Bots app's owns (index.ts, not changed here). What pings you is
  `bots.notify`, reached from the You tab.*

### The cards behind it (one overlay, `openCard`)

- [x] **This month** — tiles Typed it takes / Said it took / Saved; words a day (30-day curve); by week (4 columns, values);
  where it went (app bars); against typing (words written, at 40 a minute typed, said, minutes saved) → `bots.keybot.month`:
  the three tiles, "Words a day" columns (today clay, the biggest day named), "By week", "Where it went", "Against typing".
- [x] **Today** — tiles Sessions / Said in / Typing time; through the day (curve); how it was written (pie); where it went
  (pie); written in (each language); time (said for, typed it would take, time saved, first and last words); every session
  (time, app, words, how); "Nothing yet today…" → `bots.keybot.day` (no params): tiles (and Per session), "Through the day"
  (busiest hour named), "Said against typing", "Time", "Every session", "How it was written", "Where it went", "Written in".
- [x] **Any day** (a calendar square) — the same, or "Nothing was said or written on this day. Days off count too." →
  `bots.keybot.day?day=i`, with Earlier and Later to step through the days.
- [x] **Where the words went** — share (pie); each app: words, sessions, per session; used for (dictation / typed / replies
  %); mostly (part of the day); written as (voices); last used → `bots.keybot.apps` (share bars, each opening its app) and
  `bots.keybot.apps?app=…` (tiles, "Used for", "Mostly", "Written as", "Last used", and its tone).
- [x] **How you speak** — what you write in (pie); each language with words and share; how the words came (pie); pace (words
  a minute said, spoken in 30 days); "Add languages" → `bots.keybot.speak` (bars with words and share, "Pace", "Add languages"
  → `bots.language`).
- [x] **Sessions** — tiles In 30 days / A writing day / Words each; sessions a day (curve); time of day (pie); how long in
  words (columns); shape (average per session, best day, said / typed / drafted words) → `bots.keybot.days`.
- [x] **Day streak** — tiles Running now (live) / Best run / Days written; now against best (bars); the month as a dot grid;
  written and quiet (pie) → `bots.keybot.days`: tiles, "Now, against your best", "Days you talked", "Written and quiet".
- [x] **Active days** — words a day (columns, axis); time of day; hour by hour; pattern (active days, average per active day,
  biggest day) → `bots.keybot.month` ("Words a day") and `bots.keybot.days` ("Time of day", "Hour by hour", "Shape").
- [x] **Per session** — sessions by length; words a session by week; by app (average words); shape; **all time** (words,
  sessions, spoken) → `bots.keybot.days` ("How long, in words", "Words a session, by week", "By app") and `bots.keybot.month`
  ("All time"); `bots.keybot.apps` also lists words a session by app.
- [x] **Dictionary** — share in use (ring); most used (×); saved / used / never used / cleanups scanned; never turned up (named);
  "Add words" → `bots.keybot.words`, "Your words at work · this month" (the share, a meter, most used, the counts, the ones never
  heard), and its own "Add a word".
- [x] **Voices** — who writes for you (ring, top share); by words; in which register → `bots.keybot.speak` ("Who writes for
  you · Zu 71%", "In which register"; "Voice" opens `bots.keybot.style`).
- [x] **Spoken** — tiles Said / Typed it takes / Words a minute; minutes said a day (curve); said against typing (bars); when
  you write (pie); rate (spoken in 30 days, words out, words a minute, all time) → `bots.keybot.month` ("Spoken" tiles,
  "Minutes said, a day", rows; "Said against typing") and `bots.keybot.days` ("Time of day").
- [x] **Words this month / Words left** — paid: Plan (no limit), Used, Day streak; free: Plan's words, Earned by turning up,
  Used, Left, Day streak, earned each visit (bars, the last eight), "You have earned the most you can this month." →
  `bots.keybot.month`, "Words this month" or "Words left".
- [x] **History** (opened from "Full history", screen `history`) → `bots.keybot.history` (copy, forget, clear, search). *Its
  "Why should it go? It doesn't sound like me / Just a clean-up" question is not asked there: that page was built before
  this change and keeps its one-tap Forget; the reason only labelled the delete.*

## 2. The old phone You tab (screen `personality`)

`catalog.ts personalityScreen`. Data: the personality (presets, dictionary, languages, haptics, the style portrait), the
assistant's tasks (`youCard`, while CONNECTORS is on), `ctx.stats` for the waveform. Now: `GET /v1/keybot`, `GET /v1/personality`.

- [x] **The greeting**: "Hello" turning through languages, and the name → *not on Keybot: the Bots app greets the person by
  name on Home (`bots.home`), and You carries the name. Keybot keeps Blip's line (next).*
- [x] **Blip waving, and the line for the part of the day** ("Good evening. Anything to write up before the day ends?",
  settingsWords `g.*`) → under Keybot's head (Keybot's own Blip is its avatar).
- [x] **Hand it to me** (while connected apps are on: the task card, coming up, needs your OK, activity) → "Hand it to me" row
  → `bots.tasks`. Asking is Home's ask bar; what needs an OK is in Activity.
- [x] **Voice card**: the voice writing now, "Change" → "Voice" row (its name and what it does) → `bots.keybot.style`.
- [x] **Training card**: what it learned ("N things, from S sittings"), "Teach me" → "Teach your style" row (lines done, "Knows N
  things about how you write, from S sittings") → `bots.keybot.train`. *The faint network drawn behind the card is not
  carried (a texture, not information). The realtime spoken training (`training_live`) is not the new page's: Teach your
  style takes each line typed or said with the Keybot key.*
- [x] **Book (Dictionary) card**: three proof marks (heard as → written as), "N words" → "Your words" row (the count, the first
  spelling "“Sarvari” is written “Sharvari”", the shortcuts) → `bots.keybot.words`, which lists every spelling and adds new ones
  ("Spellings": when I say → write it as, written back with every pair through `PUT /v1/profile`, as the old Dictionary editor did).
- [x] **Language card**: every language chosen → "Languages" row (all of them) → `bots.language`.
- [x] **Buzz (Haptics) card**: the every-key switch on the card, asking first ("Turn every key off?") when keys were picked by
  hand → "Haptics" row (Every key / N keys / Off) → `bots.keybot.haptics`, whose first row is that switch with the same
  question (Turn them all off / Leave it), and the keys to pick one by one (letters, 123, #+=, Keybot's keys; each key once).
- [x] **Stats card** (the month as a waveform, to the Stats tab) → *not a card: the numbers are on the same page, up top.*
- [x] **The settings gear** → "Settings and sign out".
- [x] **endFlow** (an action with no control, kept for App Review) → *not carried: it had no button on the old tab either; iOS's
  indicator, the keyboard's mic and the five-minute idle stop end a session.*

## 3. Settings (the gear on both tabs, screen `settings`)

`catalog.ts settingsScreen`, words in `settingsWords.ts`.

- [x] **You · Upgrade** (paywall) → "Plan and billing" → `bots.billing` ("See plans" → `bots.plans`).
- [x] **You · Change or cancel** (App Store, Google Play, the web) and **Cancel subscription** (Razorpay) → `bots.billing`.
- [x] **You · Sign out** → "Settings and sign out" → `bots.settings`.
- [x] **Writing · Languages** → "Languages".
- [x] **Writing · Voice and tone** → "Voice" (`bots.keybot.style`) and "Tone per app" (`bots.keybot.tone`).
- [x] **Writing · Keyboard haptics** → "Haptics" (`bots.keybot.haptics`).
- [x] **Writing · The voice I read in** → "Read aloud" (`bots.keybot.voices`).
- [x] **Writing · What you call me** → "What you call it" (`bots.keybot.name`): a name of its own, or Tailzu only.
- [x] **Connected apps · Ask me, Your apps, Tasks** → "Connected apps" (`bots.apps`, which has what bots may do alone) and
  "Hand it to me" (`bots.tasks`).
- [x] **Privacy and data · Privacy policy** → You tab, Help: "Privacy policy"; **Delete my account** → You tab, "Delete account".
- [x] **Help and about · Write to us, Terms of use** → You tab, Help: "Write to us", "Terms of use".

## 4. The window (the desk's pages)

`desk.ts`. The same reads in server.ts (`desk_insights`, `desk_day`, `desk_app`, `desk_settings`, `desk_train`).

- [x] **Insights · eyebrow and Full history** → the month card's label; "What you said".
- [x] **Insights · the statement** ("You said N words this month. Typed… Said…") and **the race** (said against typed, its
  line) → the month card; `bots.keybot.month` "Said against typing".
- [x] **Insights · tiles**: Words this month (dictations), Time back, Days you talked, Day streak (longest run), Per dictation,
  Best day → Keybot's six figures, `bots.keybot.days` tiles and "Shape" (biggest day), `bots.keybot.month` (minutes saved).
- [x] **Insights · Day by day** (a line, the amber point today) → `bots.keybot.month` "Words a day" (today in clay).
- [x] **Insights · Running total** (and "at this pace, about N by the end of it") → `bots.keybot.month` "Running total".
- [x] **Insights · Where the words went** (donut, each app opening its page) → Keybot "Where the words went", `bots.keybot.apps`.
- [x] **Insights · How the words came** (donut) → "How the words came" bars (Keybot, `.speak`).
- [x] **Insights · How you speak** (each language set at its share) → `bots.keybot.speak` bars.
- [x] **Insights · Days you talked** (heatmap, each day opening its page) → the calendar, `bots.keybot.day?day=i`.
- [x] **Insights · Hour by hour** (busiest hour, the part of the day) → `bots.keybot.days`.
- [x] **Insights · Day of the week** → `bots.keybot.days`.
- [x] **Insights · Who writes for you**, **In which register** → `bots.keybot.speak`.
- [x] **Insights · How long, in words** → `bots.keybot.days`.
- [x] **Insights · What earns its place** (used and not yet, most used, never turned up) → `bots.keybot.words`.
- [x] **Insights · This month's words** (the allowance meter) → the month card; `bots.keybot.month`.
- [x] **Day** (desk_day): tiles (words and dictations, time back, per dictation, first to last), said against typed, hour by
  hour, where the words went, how and in what → `bots.keybot.day`.
- [x] **App** (desk_app): tiles (words and share, dictations and rank, per dictation against your usual, days used), day by day
  (the biggest in amber), when in the day, how it was written and in which voice, last used → `bots.keybot.apps?app=…`.
- [x] **Words** (desk_words): add a word, the words and spellings with Remove; **Said short, written long** (snippets: add,
  remove) → `bots.keybot.words`: Add a word, Forget, "Spellings", "Shortcuts" (`POST /v1/snippets`).
- [x] **Voices** (desk_voices): each voice writing the same line for Chats / Work / Email / Other, In use, write as it, Edit,
  Add voice → `bots.keybot.style` (also on or off the keyboard, Reset or Delete).
- [x] **Teach me** (desk_train) → `bots.keybot.train`. *Its faint network is not carried (see the training card).*
- [x] **Settings · You**: the plan line (free, N of M words, See plans / Manage), Signed in as and Sign out → the month card's
  words, "Plan and billing", "Settings and sign out".
- [x] **Settings · Writing**: You speak, Voice and tone, The voice I read in, What you call me → "Languages", "Voice", "Read
  aloud", "What you call it".
- [x] **Settings · Connected apps** → "Connected apps" (`bots.apps`).
- [x] **Settings · This computer**: Shortcut, Tap to talk, The pill, Write on a pause, Live words, Start with the computer →
  Keybot's "Shortcut keys" card and `bots.keybot.settings` (Tap twice to keep listening, Show the pill, Show the words as I
  speak, Write while I pause, and now Start with the computer). Ask's permissions → Keybot's permission card (`keybotCard`,
  unchanged) while one is missing; all of them in `desk_settings` (from `bots.settings`, "Open computer settings").
- [x] **Settings · Privacy and data**: Your audio (deleted as soon as written), History (keep it), Privacy policy → "Keep what I
  say" (the switch, "Only the text, never the audio"), `bots.privacy` (what is kept), "Privacy policy".
- [x] **Settings · Help and about**: Questions (write to us), Terms → You tab, Help.

## 5. Kept as it was

- [x] Keybot's permission card in the page (`keybotCard`, screens/firstRun.ts): unchanged, under Keybot's head (and Blip's
  line), above the numbers, on both clients, with `DEVICE_STATE` in the page's state.
- [x] Keybot's existing pages (tone, words, voices, train, history, settings): unchanged except as listed above.
- [x] What the key does (Speak, Rewrite, Translate, Reply), the phone keyboard drawing, the window's shortcut keys: still on Keybot.


**Owner's call (28 Oct):** Keybot is part of the app, not an app of its own, so it carries no "Your account" or "Help" groups. Account items stay in the You tab, and Help (write to us, privacy policy, terms) moved there.
