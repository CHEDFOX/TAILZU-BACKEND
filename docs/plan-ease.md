# Plan Ease, the simpler one

The owner's rule: "it should be all easy and simply organised for a user - we do the complex tasks - the user sees the simplest things".

The person sees three things: the one thing that matters next, at most one question for them, and a calm list of today and tomorrow.
It comes to them: a note the evening before, a morning note only when the day changed, reminders with at most 2 buttons, and a line on
the widget. Everything else is worked out on the server, by rules that cost nothing on any path that runs every day.

This file covers steps 0 and 1 of the design (`plan-design.md` in the planning notes) and the seams the later steps plug into. Waiting on
someone and family asks (steps 4 and 5) are in `plan-ease-people.md`.

## 1. The switches

Each step has its own switch in `tulmi/src/config.ts`, read in one place (`botsBots/planSwitch.ts`). All are on by default. Turning one
off puts that step back as it was, and nothing it kept is deleted.

| Switch | Step | On | Off |
| --- | --- | --- | --- |
| `PLAN_V2_REMINDERS` | 0 | Reminders say what they are, with Done and Later on a to-do and Open map on a leave-by. A to-do with a day is reminded at 10 am. Close ones go as one push. Each kind has its own channel, priority and expiry. The item form has no Remind and no How long. | The old `plan_reminder` push with no buttons, and the form as it was. |
| `PLAN_V2_PAGE` | 1 | The new data path: the Plan page for a build that draws a person as their tiny bot (`PersonBot`), its line on Home and the widget, and Today's "Plan Ease suggests" from the same card. An older build keeps the week page. It keeps this meaning: off turns off everything new, whatever the three switches below say. | The week page everywhere (and the old add form), and its routes answer 404 `plan_v2_off`. |
| `PLAN_V2_HOME` | home | The Plan page is the threaded day again (section 2): the header's walking bot and +, the week strip, one day as a thread, one Needs-you card, no box. | The simple page as it was (the one next thing, Today and Tomorrow, one box). |
| `PLAN_V2_MAKE` | plan something | "Plan something" (section 10): the card, Check (rules, free), Change, Done, and a box that fills the card. No migration. | + and the top area still open `bots.plan.make`, which draws the old add form, and `/plan/make*` answer 404 `make_off`. |
| `PLAN_V2_MAKE_AI` | plan something | "Plan something" may ask an AI model to read messy words, only with the person's yes to AI and inside Plan Ease's day budget. | Rules only, never a model call. |
| `PLAN_V2_NOTES` | 1 | The evening "tomorrow" note, the morning note when it adds something, and the Daily summary folded into the evening one. | No notes. The Daily summary goes on its own as before. |
| `PLAN_V2_LINKS` | 2 | The work calendar by its link: the link page, the read every 30 minutes, its meetings on the days, the offer card once and the "stopped" card. Needs migration 0071 and `CONNECTOR_TOKEN_KEY`. | No link page, no card, nothing read. Links already kept stay as they are. |
| `PLAN_V2_CAPTURE` | 3 | What's shared, dropped or pasted becomes one card. Bills due with Paid, and Pay only with a safe link. Needs migration 0072. | The share screen's bot picker as before, and a bill in the box is a plain to-do. |
| `PLAN_V2_APP` | app release | Only for a binary that says it can (section 7): Time Sensitive leave-bys and bills due today, widget steps, desktop notices and "add this". Needs migration 0075 for Time Sensitive. | Every build gets what an older one does. |
| `BOT_CALLS` | calls | "X0 is calling" (section 8): a leave-by or a bill due today rings a phone whose JS takes calls, instead of the push. Needs migration 0079 and `PLAN_V2_APP`. | Every push goes as before; calls already placed still finish. |
| `PLAN_V2_FOLLOW` | follow-through | Must-not-miss items, and items with someone else on them, are followed until someone says done (section 9). Only people the person is connected with in X0 can be on an item. Needs migration 0081. | Every reminder goes exactly as before; follows already open stop where they are. |
| `CHANNEL_PHONE_CALLS` (off) | follow-through | A real phone call as a must-not-miss item's loud step, only to someone who turned it on for their own proved number (section 9). Stays off unless every Plivo key and `CONNECTOR_TOKEN_KEY` are set and the TRAI declaration is filed. | The phone step passes quietly; the switch in What pings you is hidden. |

```bash
./deploy/set-env.sh PLAN_V2_NOTES=false && ./deploy/ship.sh   # notes off
./deploy/set-env.sh --show PLAN_V2_NOTES                      # which it is now
```

Leave-by times need the places switches (`PLACES_GEOCODER`, `PLACES_ROUTER`, off by default) and the person's home. Without them no
leave-by is worked out, and the page's one thing falls to the next rung, so nothing looks broken. Check production with
`./deploy/set-env.sh --show PLACES_GEOCODER PLACES_ROUTER`.

## 2. What the person sees

**The home** (`PLAN_V2_HOME`, the default for a build that draws `PersonBot`; `experience/bots/screens/bots/planHome.ts`, data from
`GET /v1/botsapp/bots/plan/day?tz&day&week&made&n`, worked out in `botsBots/planThread.ts` from the new rows, `planRows.ts rowOf`). The
owner asked for the Plan page "like before, with all the plans and all threaded": the old phone page, fed by the new data.

- **The header.** Back, then the top area: Plan Ease's avatar, its name, its ochre line ("Leave by 5:30 pm for the dentist", "Dentist at
  6 pm · 2 more today", "Nothing planned yet", with " · 40 min saved" when travel says so) and its walking tiny bot (BotBuddy). The top
  area is one pressable row: a tap opens "Plan something" with the box ready. The **+** beside it opens "Plan something" too (the
  window: a "Plan something" button). A build without BotBuddy has the still avatar in the same row. After Done the bot plays
  "celebrate" once (BotMoments).
- **"Added: Dentist, Fri 13 Nov, 5 pm" · Undo** after "Plan something"'s Done, for 10 minutes (the clock's "5 pm" never splits over two
  lines); the new rows have their own mark for those 10 minutes: Plan Ease's ochre edge on a light ochre ground and "Just added" over
  their words, never the ink edge Must not miss has. Done lands on the new item's day however far: a day past the strip's 8 weeks is
  taken when Done just made a row on it (its strip then has no arrows).
- **The week strip**: Monday to Sunday, a dot on a day with anything open, today ringed; the arrows go a week back or on, up to 8 weeks.
- **One Needs-you card** above the day, when there is a question (follow-through's "Mom hasn't said done" is urgent, so it comes first).
- **The day as a thread**: times on the left, a line joining the items; the leave-by before an event (Open map within 15 minutes of
  leaving), a tight leg ("Only 15 min to get there"), the weather after it, and free time of 90 minutes or more between items (it ends
  at the next busy event or open to-do with a time: Dad's 10 pm medicine is never inside a "Free · …" line). The time labels read as
  the old page's ("6:00 pm", "9:30 am"); the free and leave lines keep "6 pm". Each row's grey line says Must not miss first, how long,
  and where (beside Pay it has two lines, so a bill's "Due today" is never cut); a followed row shows its follow line ("Mom · not done
  yet"); someone else's item says "For Dad" with Dad's tiny bot, the same tiny bot their space and "Plan something"'s For who show
  (follow-through's `looksOf`, from the person's X0 people). To-dos and bills keep their tick (the act door) and Pay. Done items and
  events already over fade. It opens on today; after 5 pm, with nothing left open today and no item of today still being followed
  ("Mom · not done yet" on the 9 pm medicine keeps it on today at 9:20 pm), on tomorrow (follow lines exist for today's items only).
- **To-dos with no day**, ticked off here (no Add: the + does it), **Share**, and **where the day starts**.
- **No box and no chips.** The box is on "Plan something" (section 10), so there is one place that reads words.

The window has the same day, with "Coming up" (the six days after the one shown, tomorrow too when today is shown, only days with
something on) and the to-dos with no day on the right. Work in space's tabs sit under the header, as on the week page.

**The simple page** is the fallback (`PLAN_V2_HOME=false`), as below.

**The page** (`experience/bots/screens/bots/planPage.ts`, data from `GET /v1/botsapp/bots/plan/today`, worked out in
`botsBots/planDay.ts`):

- **The one thing.** The first rung that matches is shown, and its item is not repeated in the list below:
  1. a leave-by within 60 minutes: "Leave by 5:30 pm for dentist" / "30 min drive to Indiranagar" (Open map within 15 minutes)
  2. step 3: a bill due today
  3. a timed thing still to come today: "Dentist at 6 pm" / "Indiranagar · 2 more today"
  4. only to-dos left today: "Today: buy the fruit costume" / "2 more to do"
  5. nothing left today: "Tomorrow starts at 9:30 am" / "Parent-teacher meeting"
  6. nothing at all: "Nothing planned yet"
- **One Needs-you card**, never more, with at most 2 buttons and no "Not now" (leaving it alone is an answer). Answered, a grey line
  takes its place with Undo for 10 seconds.
- **Today** shows up to 6 rows and **Tomorrow** up to 3, then "2 more". After 5 pm Tomorrow comes first and Today keeps only what is
  open. Done items fade and go to the end. The source of an item is only in its details. The one exception is the tiny bot of the person
  who set it.
- **See the week** (`bots.plan.week`) is a plain list, one line a day ("Sat 14 · PTM 9:30 · 2 more"); an empty day is just its date,
  and a tap opens that day's rows. The window has the rest of the week on the right.
- **One box**: "Tell me anything, or add a photo". The server decides what it was (section 4). The + opens Photo, Camera and File, and
  the share-in screen reads the file. A question for the chat ("Can I fit a haircut in this week?") is answered right under the box:
  what was asked, "Thinking…", then the answer in a faint message container, and "Open chat". A line is a question only when it ends in
  "?", starts with a question word, or asks with a subject ("do I", "is it"): "Do laundry tomorrow" and "Find passport Fri" are added.
- **A row's grey line** is one of: a clash, when to leave, a family member's note on it ("Mom: I'll come with you", in her words and
  with her tiny bot: Work in space's notes on the person's own items, the "notes" source), or where.
- **Its details** (`bots.plan.item`, for a build that draws the new page): up to 6 lines (When, Where with the leave-by, Before with
  ticks, From, Notes, a family member's note) and 3 buttons. Own event: [Move] (3 times we picked, then "Another time") [Take it out];
  a booked one has no Move. To-do: [Done] [Later] [Take it out]. Wait: "Waiting on Rahul", [Send] [Sorted] [Take it out]. Tapping a
  line opens the form to change it. `GET .../plan/details?kind=&id=&tz=` (planEase.ts `details`) gives the before steps, the leave-by,
  the note and Move's times. A wait's new day moves its check-back with it (`calendar/service.ts changeTask`).

**Home** shows the one thing on Plan Ease's tile. **Today**'s "Plan Ease suggests" shows the same card as the page (`plan/line`'s
`card`), with its draft and its buttons that open a page. Both only for a build that draws the new page (`PersonBot`): an older one keeps
today's page and hears nothing of the new.

**Outside the app** every word goes through `botsBots/planSafe.ts`. That means no ₹ amount (₹, Rs, INR, "rupees", "/-", "25k",
"1.5 lakh", and in a line about money its bare numbers: "Maid salary 8,000", "Electricity bill 2,140"; days, times and counts stay), a
health-looking title becomes "Appointment" (the list errs on the side of too much: joined words like "psychotherapy", "-ologist",
"-scopy", HIV/STD tests, shots, Hindi "मरीज" and "डॉ"), a health place is never named, and a family member's own words are never used.
The amounts and full titles are one tap away in the app. A bill read from a share keeps its amount only in its own field, never in its
title, and only when the words hold exactly that number.

| What | When | Words | Buttons |
| --- | --- | --- | --- |
| Event | 15 min before | "Design review at 6 pm" / "Indiranagar" | none |
| Leave-by (travel on) | 10 min before the leave-by | "Leave by 5:30 pm for dentist" / "30 min drive to Indiranagar" | Open map |
| To-do with a time | at the time | "Call the bank" / "Now" | Done, Later |
| To-do with a day | 10 am that day | "Buy the fruit costume" / "Today" | Done, Later |
| Two or more within 10 min | at the first | "2 things at 6 pm" / "dentist, call Mom" | none |
| Evening note | 8:30 pm, then 15 min before they usually look (7 to 10 pm) | "Tomorrow: leave by 8:10 am" / "Tonight: pack the fruit costume. First: school drop 8:30 am. 2 more." | Move it, Keep when it asks the card's question |
| Morning note | 7:30 am, or 45 min before an early leave-by, not before 6 am | "Today: leave by 8:10 am" / "New: standup moved to 10:30. School drop 8:30." | none, and no sound |

- **Later** means an hour from now, or 9 am tomorrow after 8 pm. It can be pressed 3 times, after which the reminder has Done only and
  then stays quietly in the app.
- **The day's six**: Plan Ease sends at most 6 pushes of its own a day (the 10 am reminders and Laters), besides the day note and the
  person's own timed reminders.
- **The morning note** goes only when the evening note wasn't opened or the day changed. It is skipped when today is empty or they
  opened Plan Ease after 6 am.
- **The quiet rule**: after 5 evening notes in a row that are never opened or acted on, the evening note stops and the morning note
  takes its place every day, saying so once. After 5 unopened morning notes those stop too. Saying "evening notes" in the box brings them
  back.
- **The Daily summary** (What pings you) rides at the end of the evening note, so there is one evening push. On an evening with no note
  it goes on its own.
- **The widget**: Plan Ease's line on its bot row ("Fri · PTM 9:30, leave 9:00"), its card in the needs spot with its buttons, and
  within 2 hours of a leave-by its lock words lead the lock screen. Lines name a day and a time, so they stay true until the app next
  fetches. A card whose answer needs the app ("Still waiting on Rahul", "Did the plumber come?") is open-only there: no buttons, a tap
  opens X0 Bot.
- **A notification's tap and its buttons are two things.** Pay, Send, No and Open map open the hand-off screen, which opens UPI,
  WhatsApp or Maps only for that button (the phone says which with the `button` param, capability `PushButton`); a tap just to look
  opens the Plan, and is never counted as sent. A build without `PushButton` shows one button there instead.
- **Quiet hours** ("silent" in What pings you) never break through Focus: a time-sensitive kind goes as an ordinary one.
- **A question rides one evening note**, not every evening (`plan_prefs.note.rode`); a capture asked there is not also said as a line.
  An evening with no note leaves the count of unopened notes as it was.

## 3. The pieces

| File | What |
| --- | --- |
| `botsBots/planEase.ts` | The service: the page, the week, the box, the buttons (`PLAN_ACTS`), Home's and the widget's line, the reminder policy, the notes and leave-by jobs |
| `botsBots/planDay.ts` | Pure: the one-thing ladder, Today and Tomorrow, the week lines, the widget line |
| `botsBots/planNeeds.ts` | Pure: the Needs-you card types (`NEEDS_TYPES`) and the queue |
| `botsBots/planRows.ts` | Pure: the row kinds (`ROW_KINDS`), and what counts as booked |
| `botsBots/planBox.ts` | The one box's slots (`BOX_SLOTS`) |
| `botsBots/planNotes.ts` | Pure: the evening and morning notes, and when they go |
| `botsBots/planKinds.ts` | The push kinds, their buttons and Android channels (`PLAN_PUSH_KINDS`, `PLAN_CATEGORIES`, `PLAN_CHANNELS`) |
| `botsBots/planSafe.ts` | The one lock-safe word function |
| `botsBots/planPrefs.ts` | The person's row (`plan_prefs`): offset, note times and memory, the move last shown, leave-bys, the day's count |
| `calendar/service.ts` | The reminder sweep (`remindPlan`), Later (`later`), the offset kept beside the person (`tzOf`, `keepTz`) |

**Routes** (`routes/bots/botsBots.ts`): `GET .../plan/today`, `GET .../plan/week`, `GET .../plan/line`, `GET .../plan/details`,
`POST .../plan/box`. Every
button, from the page, the widget or a notification, goes through `POST /v1/widgets/act` with a Plan Ease item: `pt:<taskId>` (a to-do),
`pe:<eventRef>:<day>` (an event on a day), `pm:<eventRef>:<start>` (a Move card) and `pc:<captureId>` (step 3).

**Migration** `0070_plan_ease_notes.sql`: `calendar_tasks.kind` (todo, due or wait) and `snoozes`, the new `plan_prefs` columns, and a
row for everyone with calendar rows, with their next 8:30 pm. It can be run again.

**Fixed on the way (step 0)**:
- The dead "fewer people move" rule is gone, since `people` was always 0.
- Two video calls back to back are no longer flagged, because a gap counts only between two real places.
- The person's offset and the Move card last shown are kept in `plan_prefs` instead of one server's memory.
- Today's "Plan Ease suggests" is fed by the real queue.
- The item form lost its Remind and How long fields.

## 4. Where the next steps plug in

Each later step adds entries to lists. No existing line changes:

- **A push kind**: add it to its step's list in `planKinds.ts` and to `PLAN_KIND_IDS`. Its category and channel go there too.
  `verdict()`, the engine's kinds, the bootstrap's buttons and the channels follow by themselves.
- **A Needs-you card**: add a `NeedsType` to `NEEDS_TYPES` in `planNeeds.ts`. Its buttons are actions in `PLAN_ACTS` (`planEase.ts`). The
  page, the widget and the evening note show it with no change.
- **A row kind** (bill, waiting-on, ask, turn): add a `RowKind` to its step's list in `planRows.ts`. The screen draws any row the same
  way.
- **A box reading** (family ask, capture, wait, due): add a `BoxSlot` to its place in `BOX_SLOTS` in `planBox.ts`.
- **A rung of the ladder** (step 3's due today): its comment is in `nextThing` (`planDay.ts`).
- **A line in a note** (family, money, a stopped calendar link, a capture left alone): `eveningNote`'s parts and its `extra` lines
  (`planNotes.ts`).

## 5. Not in this slice

- The "This week I saved you 40 min" note was cut by the design (D1 #21). The minutes saved are still kept as our own measure in
  `plan_prefs.saves`, credited from the persisted Move card.
- Leave-by reminders only exist where the places switches are on in production.
- Hinglish covers the notes' fixed words only.

## 6. Steps 2 and 3: what comes in

### The work calendar (step 2, `botsBots/planLinks.ts`, `planIcs.ts`)

- **Linking.** The link page (`bots.plan.link`, `screens/bots/planIn.ts`) has three rows: Google Calendar, Outlook and iPhone (iCloud).
  Each shows its three steps. There is one field and one button. Google and Outlook only give the link on a computer, so on the phone
  those two rows end with "On your computer, go to x0bot.com/cal". That page (`routes/site/calPage.ts`, `GET`/`POST /cal`) takes the
  link with no sign-in and shows a 6-number code. The code goes in the same field on the phone. It works once, for 15 minutes, and
  nothing is read until a signed-in phone claims it. Saying "link my work calendar" in the box opens the page too.
- **The address is a password.** It is sealed with AES-256-GCM, under a key made from `CONNECTOR_TOKEN_KEY` for this use only. It is
  never logged, never put in an error and never sent to a model, and the screen shows only a hint. Every read goes through
  `connectors/egress.ts`: https only, never an address inside our network (checked as the connection dials), 3 redirects, 10 seconds,
  25 MB.
- **Reading.** Links are read every 30 minutes, spread out (the 5-minute job claims each one by moving `next_fetch_ms`). A link is also
  read when the Plan is opened and it is 10 minutes old (within the page's 1.2 s wait), and before each evening note. A 304 writes
  nothing. A 200 is read with ical.js (repeats, days taken out, moved starts, time zones), and only what changed is written. A meeting
  that doesn't repeat and is outside 7 days back to 60 days on is dropped before the full read. We keep the title, place, times, whether
  it is busy and a head count. We never keep attendees' addresses or the description.
- **On the days.** Meetings come in through `planSources.ts` (the one place for anything outside the own calendar). They are rows like
  any other: someone else's (`fixed`), never moved, never offered as free time, and "From your work calendar" in their details. A clash
  with the person's own movable thing is a Move card for theirs. A clash with a booked thing is the grey "Clashes with …" line. A meeting
  marked free is no clash. The chat's list tool reads them too (`calendar/bots.ts`), as read-only lines.
- **A clash the read finds** gets one push (`plan_decide`), from 7 am to 9 pm, once per clash, within the day's six. Outside those hours
  the next note carries it.
- **When it breaks.** A 401, 403, 404 or 410 stops a link at once, and any other failure does after three in a row. After 6 hours
  stopped, the "Your work calendar stopped updating" card appears, with one button, [Link again], and one line goes in the next evening
  note. It never gets a push. After 7 days stopped, the link is taken off and its meetings go.
- **The offer** ("Show your work calendar here too?" [Link it] [No thanks]) comes once, on the third day Plan Ease is opened with no
  link. Left alone it never comes back. No thanks is kept for ever. Both link cards stay on the page, never on the widget or in a note.

### Getting things in (step 3, `botsBots/planCapture.ts`, `planInBox.ts`)

- **In.** A share, a desktop drop, the box's + or pasted lines. The share-in screen asks `POST /v1/botsapp/bots/plan/capture/look`
  first. Words, and a PDF with text, are Plan Ease's by the rules (a date with something to do, or an amount with a bill word). A photo
  gets one tiny look (about ₹0.01, with the person's yes to AI only). From the Plan's own +, it always is. When it is Plan Ease's, the
  screen shows the card, with no bot picker. Otherwise the picker is there as before.
- **Read.** Words and PDFs with text go to the cheap text tier (`CLEANUP_MODEL`, then `AGENT_FALLBACK_MODELS`). Photos go to the picture
  tier (`AGENT_VISION_MODEL`, thinking off, 1,200 tokens out, then its fallbacks), given the rules themselves. Each is one call with a
  fixed JSON shape. Then the code checks: dates read again (`calendar/words.ts`), past ones dropped, what's already on the plan marked,
  an amount kept only as the words show it, a link only when it is in the source word for word, 8 things at most. A thing under 0.7 sure
  or with no day is unticked and shows "Date?".
- **The card** (`bots.plan.capture`): "4 things from the school circular", up to 5 rows then "2 more", one button ("Add all", or "Add 3").
  It becomes "Added 3 things · Undo" for 10 seconds. Add all makes events (all day when there is no time), to-dos, bills with their amount,
  and "before" steps as to-dos. A row given to a family member (its sheet: title, day, time, who) goes to them as a space task.
  Everything carries `capture_id`, so Undo and "Take out all from the circular" take out the lot.
- **Left alone.** A card read after the person left the share screen gets one push, "Read the school circular: 4 things" [Add all]
  [Look]. It becomes a Needs-you card, comes once in the evening note, and goes after 7 days.
- **Consent and money.** Nothing is sent before the person's yes. Every call goes through the gate and runs as them. Without the yes,
  nothing here asks for it (Home's card is asked once, `firstRun/aiConsentCard.ts`): words with dates become the card's things to tick
  by the rules at once (Add all adds them, as after an AI read), and a photo, or words with nothing found, one to-do with its file. A
  card left from before, still waiting for a yes, is read as soon as it is opened (by AI with the yes, else by the rules); one never
  opened goes with the nightly sweep after its 7 days, as it did before. Reading is charged to the person (`chargedTo(user, "plan")`) and added to Plan
  Ease's own day meter (`Bots.spendToday`). Before a read, what is left is the smaller of reading's ₹5 a day (`plan_prefs.capture_paise`,
  the true total) and what the day meter still has (`Bots.leftToday`), and a read starts only with its estimate left (2 paise for the
  tiny look, 20 for words, 40 for a photo). It holds back up to one share's ₹1.50 first, in one change that only lands while the row is
  as it was read (so two servers never both pass), and settles at the real price after. One paid read at a time a person on a server.
  Past that, words take the rules road and a photo waits for after midnight, and its card comes in the morning note.
- **Privacy.** A capture writes only calendar rows. Shared words go as soon as they are read (only the things found are kept), else when
  the card is answered; every shared file goes with its card's week at most, the one a "Look at the photo" to-do points at too (it was
  never read, so it may be health). What a desktop's "add this" saw is never stored: read from memory with a yes to AI, else by the
  rules at once. With Spaces off nothing is given to a family member: a row's "who" is ignored and it is added as the person's own.
- **A meeting's notes** (`notes/ready.ts`, `planCapture.ts fromNote`): when a note is ready, its to-dos with a real name and a day become
  one card, "2 things from the meeting": someone else's a wait ("Waiting on Rahul · by Thu"), the person's own a to-do. "Speaker 2" or
  "Others" never. No AI: the notes were already read. Needs migration 0077 (`plan_captures.source` takes `notes`).

### Bills due (step 3, `botsBots/planDue.ts`)

- A bill is a to-do of kind `due`, with its amount, payee and a pay link when that is safe. It comes from a capture or the box
  ("Electricity 2140 due 14th", "Pay rent by the 5th every month").
- **On the list**: "Electricity ₹2,140", "Due today", Pay on the right with a safe link, and the round tick is Paid. The one thing's rung
  2 is "Pay ₹2,140 for electricity today".
- **Outside the app, never the amount**: the widget says "Electricity due today", the evening note "Electricity due.", and the push on
  the day at 10 am (and once more at 6 pm if not paid) "Electricity due today" / "BESCOM" [Pay] [Paid]. Without a safe link it is
  [Paid] only (`x0_paid`). Pay opens the hand-off screen (`bots.plan.go?go=pay`), which reads the link from the server: a push never
  carries it.
- **A safe link** is a `upi://pay` link with a payee, or an https page of a biller on `KNOWN_BILLERS`, found word for word in the
  source. Words that push ("disconnected tonight", "KYC", "within 2 hours") never get a Pay button. The details then say "Pay it from
  your bank or UPI app."
- **Each month**: said so, or the same payee captured last month too. When one is paid, next month's is made, with no amount until its
  own bill comes. Undo takes it back out.

### Migrations

- `0071_calendar_links.sql`: `calendar_links` (sealed address, hint, state, etag, when next), `calendar_link_events` (one row per
  start), `plan_link_codes` (x0bot.com/cal's codes, as a keyed hash).
- `0076_plan_link_tries.sql`: wrong 6-digit codes this hour, per person, per address (a keyed hash) and for everyone (5, 10 and 100):
  kept in the database, so a restart or a second server resets nothing.
- `0077_plan_captures_notes.sql`: a capture's source may be `notes` (a meeting's to-dos as one card).
- `0072_plan_captures.sql`: `plan_captures`; `calendar_tasks` gains `amount_paise`, `payee`, `pay_link`, `repeat`, `prep_for` and
  `capture_id`; `calendar_events` gains `capture_id`; `plan_prefs` gains `capture_day` and `capture_paise`.

All can be run again. A server ahead of them keeps working for everything but these steps.

A work meeting's place never keeps its call link or passcode (`planIcs.ts placeOf`): a call is "Online", a real room stays.

### Not done here

- x0bot.com/cal needs the website's proxy to send `/cal` to the backend, as it does `/device`.
- The forwarding address for mail is later (design B5). Desktop "add this" is section 7.

## 7. The app release (`PLAN_V2_APP`)

Each piece is sent only to a binary that says it has it, because an over-the-air update also reaches older binaries.

| Piece | The binary says | The server |
| --- | --- | --- |
| Time Sensitive (iOS) | `caps: ["PushTimeSensitive"]` with its token (`POST /v1/push/register`; the app's `device/binaryCore.ts`) | `push/tokens.ts` keeps it (`push_tokens.caps`, migration 0075). `plan_leave` and `plan_due` are `"time-sensitive"` (`planKinds.ts`), and `push/engine.ts` sends that level only to a token with the cap; the rest get Apple's own level. |
| "Bots at work" on Android | `caps: ["LiveUpdate1"]` with its token (the binary says `liveUpdate`) | The ongoing notice (`ANDROID_BOTS_NOTICE`): `push/engine.ts` `devicesWith(user, "android", "LiveUpdate1")` finds those phones and `widgets/notice.ts` sends each a data-only push with no title and no body, which the phone draws itself (`TailzuBotsUpdate.kt`). Without the name no phone is found, so Android has exactly what it has today: no notice. |
| A new looks catalog | `caps: ["NativeLook1"]` with its token (the binary says `nativeLook`) | One silent push per catalog publish (`experience/native/catalog.ts` `nudgeLooks`): data-only on Android at NORMAL priority, content-available on iOS, `{ kind: "native.looks", v }` and nothing else, in batches of 100 over about ten minutes. It only makes a phone fetch sooner than its next bootstrap would; without the name it simply finds out on its own. |
| Widget steps | `steps=1` on `GET /v1/shell/glance?v=2` (and `GlanceSteps` in its bootstrap) | `glance.steps`: Plan Ease's line from each moment it changes over 36 hours, 16 at most (`planDay.ts` widgetSteps), with the lock words for that moment by the glance's own rule (`widgets/glance.ts` glanceSteps). Lock-safe. Contract: `docs/widget-glance-v2.md`. |
| Desktop notices | `DeskNotices` in its bootstrap's components | `desktop.notices.enabled: true`. Its main process's live socket says `notices`, then `here` every minute (`live/notices.ts`: in memory, per socket, never stored or logged). While a computer was used in the last 10 minutes and isn't locked or asleep, every Plan Ease push is also a `notice` on that socket, and the phone's copy has no sound. It goes even with no phone. "What pings you" decides once for both; an answer at the act door publishes `{ id, gone: true }`, and a family ask taken takes it off everyone else's. |
| "Add this" | `DeskAddThis` | `desktop.plan.addThis: true` (only with `PLAN_V2_PAGE` and `PLAN_V2_CAPTURE` on too), and the "add this" words in its router lists (`appLists.ts` DESKTOP_ADD_THIS, the same as the desktop's router.js). `POST /plan/box` takes `seen: { from, text, app?, title?, where? }` (12k characters): one clear line is added as if typed, with Undo; a notice with several things becomes the capture card, with capture's consent gate and budget. Nothing seen is kept: with a yes to AI it is read from memory; without one its dated lines become the card by the rules at once. A file dropped on the Plan page is Plan Ease's (no bot picker: the desktop sends `from=plan`). |

The notices' presence is this process's, like the live bus: with several processes, share it where the bus gets its relay.

## 8. Calls (`BOT_CALLS`)

"X0 is calling": at the moments Plan Ease must not let slip, it rings the phone instead of pushing. The service is
`botsBots/planCall.ts` (words and limits: `planCallWords.ts`), its doors `routes/bots/planCalls.ts`, its screen
`experience/bots/screens/bots/planCall.ts`, its table `plan_calls` (migration 0079). The contract both apps code against is the calls
spec's section 1 (names, payloads, categories, channels, endpoints, states, timings); this section is how the server does it.

**It is an ordinary notification.** No CallKit, PushKit or VoIP, nothing that looks like the phone's own call screen. The title is
"<Name> is calling", where the name is the person's own name for it (Keylessbord's "What you call it", `nicknameOf`), else X0. The body is
the reminder's own lock-safe line. Buttons: **Answer** (opens the call screen; a tap on the notification is Answer too) and **Not now**
(a background call to `.../decline`, which answers 200 whatever happens, so the button never says it failed).

**What rings.** Only a single `plan_leave` (leave-by) or a single `plan_due` for a bill due today: the two kinds already sent
time-sensitive. `leavesTick` and `dueReminder` hand the engine a server-only seed (`call`: the raw title, ids, place, times) beside the
push message; it never goes into a push. The engine asks the call (`setCallHook`) before it builds the push, and the phones that took the
ring get no push. It never rings, and the push goes the existing way, when:

- the person's quiet hours are on (the reminder itself would go silent), Calls is off in What pings you, or Plan Ease is off;
- a computer is in use (the desk notice and the phone's silent copy, as before);
- no phone has the `BotCall` cap (older JS, or an Android phone whose Reminders or Calls channel is blocked or missing);
- `push.plan_call.needTimeSensitive` is true and the iPhone lacks the entitlement (false by default: phones without Time Sensitive are
  rung at Apple's default level, as today's leave-by is; the owner to confirm);
- a call is ringing or on; 3 server calls today already; under 15 minutes since the last call (a Call back counts for the 15 minutes, not
  the 3);
- the reminder already placed a call (`source_key` is unique; looked up before the limits, which that very call would trip, so the
  same reminder again sends nothing to the phones it rang); the ring's ticket failed on every phone (the call is marked `not_sent`);
  the table is missing (deploy before the migration);
- a merged `plan_many`, or anything without a seed.

A phone whose ring ticket failed gets the push, and nothing more of the call: ring 2 and the missed call go only to the phones that took
ring 1 (the row's `rang`, hashes of their tokens, never the tokens). A phone with the ringtone (`BotRingtone`) is sent `sound: "x0_ring_1.wav"`, any other
`"default"`. Lock-screen words only ever come from `planSafe.ts` (no amounts, health as "Appointment"); push data is only
`{ call, state, day, screenId, pushId, kind }`.

**States and timings.** `ringing` → `answered` | `declined` | `missed`; `answered` → `ended`. Every change is a compare-and-swap. Ring 1
at 0 s (ttl 40), ring 2 at +23 s (same `collapseId`/`tag`, so it replaces ring 1; ttl 20, and never later than 5 s before the window
ends), the missed call at +45 s ("Missed call from <Name>", no sound, `passive` on iOS, the reminder's own expiry), unless answered or
declined. A late Answer (Face ID) still connects for 120 s after the window. An answered call with no turn for 5 minutes is ended
(`timeout`). Timers run in the process; a sweep every 10 s over `next_ms` catches what a restart lost, sends no ring after the window and
no missed push after its expiry. Calls older than 90 days are deleted by the sweep.

**A live call opens with a mild "Hello."**, in English, whatever language follows. There is no app-language logic anywhere in a call:
the realtime call follows whatever language the person speaks from their first words. A turn call — every build without the realtime
switch — opens on the moment itself, with no greeting, exactly as it always has.

**The screen** (`bots.plan.call`, never kept). Talk mode, on a phone with `BotCall`: it answers as it opens, Plan Ease speaks first
("It's time to leave for the parent-teacher meeting at Green Valley School. Want me to do anything?"), then turn by turn the person talks
(`voiceLive` once, `duplex`) and `.../say` hands the words to the Plan Ease chat with the call's facts attached; the reply is said aloud
(two sentences at most). "No", "that's all", "bas" close the call with no chat call; after 8 turns it closes too. The item card carries
its own buttons (Open map and Move; Pay and Paid), and one that leaves the screen ends the call first. Missed mode: "Missed call ·
8:12 am", Call back (a new call of the person's own, answered at once, which ignores the ring limits — its own limit is 10 Call backs
in a day, `BACK_MAX`, past which `.../back` answers 429 `back_day_max`); Call back pressed on the missed-call
notification calls back as the screen opens, even for a call that ended since (answered late, then hung up). Ended mode. A record on the window and
on any build without `BotCall`. The look is Plan Ease's: ochre on the bot and the status dot, Geist, the bot on his stage; no green or
red, no round phone buttons.

**Consent and microphone.** With the AI permission the voice is the server's (`GET .../voice/:n`, the person's TTS voice and read speed,
made ahead at answer and say time, under their quota unless the realtime switch is on for them: see "No money limit"). Without it the opening is spoken by the phone (`speak`, nothing leaves it), only
the item's buttons are offered, the screen says nothing about AI (Home's card is the one ask), and `say` and `voice` answer 403. The microphone is checked, never asked for by a tap: without it the
Continue card asks (and offers Open Settings when blocked).

**Activity.** A missed call is a row of its own ("Missed call from Zara", the line and the time; it opens the missed call). It is read
straight from `plan_calls` in `feedFor`, and Home's tasks and the Today page never list or count it.

**Caps.** Token caps (`POST /v1/push/register`): `BotCall` (this JS takes calls), `BotRingtone` (the iPhone has `x0_ring_1.wav` in its app
group's Library/Sounds; a new tone gets a new file name and a new cap). SDUI capability `BotCall` (`speak.loud`/`onDone`,
`voiceLive.duplex`, Text `format: "elapsed"`). The phone makes the Android channels `calls` and `calls_missed` itself; the server never
lists them. `calls_ring` is reserved for a later store build that packs the ringtone as a raw resource (a channel's sound is fixed once
made).

**Known leftovers (v1).** With two call-capable phones, answering on one leaves the other's ringing notification until its app opens. A
missed push already sent can't be recalled when a late Answer arrives (the phone clears it on tap if it is shown). An Answer or Not now in
the milliseconds after ring 2 is claimed can still be followed by ring 2 (the phone clears a stale ring later). Not now pressed offline is
sent when the app next comes to the front. The voice made ahead lives in one server's memory; a GET that reaches another synthesises again.

### Realtime voice (`PLAN_CALL_REALTIME`, `PLAN_CALL_RT_ALLOW`)

An answered call can be held as **one live voice conversation** instead of turn by turn. The session manager is
`botsBots/planCallLive.ts` (its words, numbers and prompt: `planCallLiveWords.ts`), the OpenAI link `realtime/openaiCalls.ts`, the voice
map `realtime/voices.ts`, the columns migration 0085. It ships dark: with the switch off, and for every build that does not declare the
SDUI capability `VoiceRealtime` (a store build only), the call is today's turn call, byte for byte.

> **Run migration 0085 BEFORE this server is deployed**, not before the switch is turned on. Every new call row carries the live part's
> own columns, so on a database without 0085 PostgREST would refuse the insert and every leave-by, bill-due and follow-through ring
> would stop, with the switch off as well. `rowForInsert` (`botsBots/planCall.ts`) leaves those columns out while they hold their
> defaults, so a ring still gets through if the order slips; a judged ring and the live part itself still need the migration. 0086 is
> the judge's own and is only needed before `PLAN_CALL_JUDGE` goes on.

- **How it runs.** The phone's audio goes straight to OpenAI over WebRTC; our server does the SDP exchange with its own key
  (`POST .../calls/:id/live`) and holds its own socket on the same call. The phone never holds an OpenAI credential of any kind. Through
  that socket the server runs every tool, re-checks the AI permission on every turn, records each response's cost, runs the idle end and
  the hard length, and writes the transcript. `POST .../live/ready` makes the bot speak the opening; `POST .../live/stop` parks the live
  part when the app goes to the background or a cellular call comes in.
- **The tools** are Plan Ease's own kit, held to `VOICE_TOOLS`: the calendar and to-dos may be listed, added and changed, never removed,
  and there are no artifact tools. The call's own actions (Paid, Done, Later, Can't) run through Plan Ease's buttons after a read-back.
- **No money limit, where this switch is on for the person** (`realtimeFor`, which `.../say` and `.../voice/:n` ask as well, so the
  turn call a fallback lands on is free of money too). A call of theirs is never refused, shortened or stopped for cost: not the
  plan quota, not the spend gate, not Plan Ease's ₹8 day budget, and no `usage_events` row is written for it. Its voice goes through
  `speakFor(..., { call: true })`, which asks no quota and writes no usage row, so a person whose usage meter is used up still hears the
  call. **With the switch off — every build today — the turn call is held to all three exactly as it always has been**, and nothing
  about money changes for anybody until the switch goes on. What each call cost is RECORDED, for the owner only: `plan_calls.cost_usd` — the live responses and transcription from the
  manager's own running total, and a turn's answer and a turn's voice through `planCall.bumpCost` — and `usd`/`paise` in the one
  `[calls] live` log line at the end. The manager writes its total as an absolute value, so a turn or a read that arrives while this
  process still holds the session closes the live part first (`live.fellBack`, the row marked `fell_back`) and only then adds to the
  row: the two cannot lose each other's dollars, and a closed session's idle or length timer can no longer end the call. A day's
  reading:
  `select date_trunc('day', to_timestamp(ring_at_ms/1000)) d, count(*), sum(cost_usd), sum(rt_sec) from plan_calls group by 1 order by 1 desc;`
- **What can end a call by itself** is technical only: the idle end (OpenAI's own nudge on silence, then a short goodbye twelve seconds
  later; speech arms it again, so a later silence is nudged again instead of running to the length), a hard maximum length of 15 minutes
  (`PLAN_CALL_RT_MAX_SEC`) against a stuck session — the goodbye at 14:45, the hangup at 15:00 — and the AI permission: taken back, the
  call is hung up at once. A session the client changed under us is tampering and ends the call: wiped instructions (an empty string
  included) are caught, and so is turn taking the server never sent — the one change worth making from a modified app, since it is what
  switches the idle end off. An echo of the server's own settings beyond the updates it asked for does not end the call: ending a real
  call because the service echoed one of its own accord would be worse than the change, which the hard length bounds in any case. Each
  one is a warn line and one on the call's own count, which the `[calls] live` line always carries as `unasked` (0 when there were none).
  Two `live` requests at once cannot make two sessions: the slot is claimed before the first await, and the second gets 409 `rt_live`.
- **Anything that breaks falls back** to the turn call with no tap from the person: a non-200, a dropped socket, no `ready` in 15 seconds,
  a restart (the boot sweep hangs up every orphan). A call that fell back stays a turn call and never goes live again.
- **S0, server only.** `OPENAI_TTS_MODEL` now defaults to `gpt-realtime-2.1-mini`, and `pipeline/tts.ts` reads text aloud over the
  realtime socket whenever the model name starts with `gpt-realtime`. That covers `POST /v1/speak`, the read-aloud bubble and a turn
  call's voice, so every phone gets it at once — OpenAI removes `gpt-4o-mini-tts`, `tts-1` and `tts-1-hd` on 2027-01-06.
  **One fallback, while there is still one:** a realtime read that fails (any error, or no audio) is read once more through the speech
  endpoint on `gpt-4o-mini-tts`, so nothing a person asked to be read aloud goes silent. From 2027-01-06 there is nothing to fall back
  to, so the error stands. The fallback is logged by its reason only (`[tts] realtime read failed…`), never with the words.

### Which items get a call (`PLAN_CALL_JUDGE`)

Today's two rules — a leave-by, and a bill due today — are the floor: they ring for everyone, and nothing ever turns them off. On top of
them, with the person's AI permission and their Calls setting on, an AI reads every item added to or changed on their Plan and decides
whether it is important enough to phone them about, and when. Everything it judges necessary gets the call: a judged ring skips the three
calls a day and does not count toward them, and a floor ring for an item the judge wants is placed the same way. The person's own Calls
setting, their quiet hours, one call at a time and the 15-minute gap still hold, and one guard of its own: no second call about the same
item within an hour. There is **no cap on judged rings in a day** — everything the AI judges necessary gets the call. The seam between
the call and the judge is one file, `botsBots/planCallSeam.ts`. The judge itself is **docs/plan-call-judge.md**.

## 9. Follow-through (`PLAN_V2_FOLLOW`)

"Every item becomes a job that is not finished until someone says it's done." The ladder is `botsBots/planFollow.ts` (words and rules:
`planFollowWords.ts`; who can be on an item: `planFollowPeople.ts`; tables: `planFollowStore.ts`, migration 0081; numbers and caps:
`planReach.ts`; the phone seam: `planFollowChannels.ts`), its routes `routes/bots/planFollows.ts`, its screens
`experience/bots/screens/bots/planFollow.ts`. The build spec, with the owner's changes at its top, is the follow-through SPEC.md.

**The owner's example, minute by minute** (Mom's medicine at 9 pm, Mom then Dad on it, Spaces on, Mom said Allow once):

- 9:00 Mom's phone: "A reminder from Rahul · 9 pm" (her lock screen never says "medicine"), [Done] [Later] [Can't].
- 9:05 no Done: the same, louder ("Not done yet · 9 pm", time-sensitive where the iPhone allows).
- 9:10 still nothing: "X0 is calling" on Mom's phone (planCall's own rules: never in quiet hours, 3 a day, 15 minutes apart).
- 9:15 a real phone call to Mom's own number, only if she turned that on herself and the phone channel is set up (press 1, 2 or 3).
- 9:20 Rahul: "Mom hasn't said done" · "The 9 pm reminder", with [Call] (when he keeps Mom's number for his Call button) or [Look], and
  [Done]. On the follow page: Call Mom, Message Mom (their chat in X0), I'll do it.

**Who gets a follow.** An occurrence that is must not miss (the person said so, or the rules: medicine at a time, a pickup at a time, a bill
due today, a flight or train), or that has someone other than the asker on it. A normal item that is only the person's own keeps today's
reminder exactly. Keep at it off (What pings you) makes the person's own must items behave as today too. A wait never has one.

**Who can be on an item (the owner's change).** The asker, and only people the asker is connected with in X0, by exactly the rules
messaging uses: `threads.ts contacts` (a space they share in which the asker may message, no block either way, Spaces on). Friends and
family are spaces; a two-person space counts. There is no other people list and no other invite path: a name or someone not among
them is not saved, X0 says "Mom isn't in your X0 people yet. Invite them to a space, then add them here." and offers the space invite the
Spaces screens use (the asker's own space's invite, else Spaces); the item is saved with the people who count. With Spaces off, only the
asker. Everyone on an item has X0: nothing is ever sent to a number or an address of someone without it.

**Checked again before every reach.** Before each push, louder push, X0 call, real call and tell to someone else, the same rules are read
again. Someone who left the shared space, has a block either way, or whom the asker may no longer message, or with Spaces off, is
skipped (no push, no call), the job goes to the next person on it, and the asker is told once: in their own push when it comes back to
them ("Dad isn't in your X0 people · 9 pm"), else "Dad isn't in your X0 people · Mom has it now", or with nobody left, [I'll do it].
Answers from someone no longer connected count for nothing, and their cards and the follow page are gone for them. A ringing "X0 is
calling" ends for someone who said Can't, was skipped or was taken off the item. **A read of those rules that fails is not a no**: nobody
is skipped, passed on or told about for it; the step waits a minute and tries again, an answer still counts, and saving who does it says
"Couldn't check your X0 people just now. Try again." (nothing is dropped from the item).

**What the other person gets respects their own settings.** Their quiet hours (the push engine's verdict: a push in quiet hours goes
without a sound, X0 is calling never rings); their daily limit for louder pings and calls (What pings you: 3, 6 or 10); a muted chat
with the asker (nothing from that asker's items reaches them, not a push and not a card on their Plan or widget, and the asker hears "X0
couldn't reach Mom"); their own yes before anything
louder than a push from someone else's item (Allow on the follow page, kept in `notify.followFrom`, removable in What pings you); and
never 10 pm to 7 am for someone else's item when they set no quiet hours.

**The ladder and its timings** (push-surface flags `push.follow.*`, read once per sweep): normal = the push, then nothing (missed after 6
hours, quietly). Must = push at the time, louder +5, X0 is calling +10, a real call +15 (only for someone who turned it on), tell +20. A
bill climbs from its 6 pm: its 10 am push and its 6 pm push are the bill's own (Pay, Paid), then X0 is calling at 6:10 pm and the tell at
6:20 pm. The push always goes first (after downtime it goes late and the climb starts again from then); a late sweep takes only the latest
due step. Later: must +15 minutes, normal +1 hour (9 am tomorrow after 8 pm), or In 15 min / In 1 hour / This evening / Tomorrow morning;
three Laters, then Done or Can't. Can't hands it to the next person at once (the asker hears quietly); from the last person, the asker
hears "Nobody can do it" with I'll do it. A must item that is only the asker's has nobody to tell at +20: that step reads "skipped:
nobody else to tell" and the Plan line stays "Must not miss · not done yet" (never "told the family"). The asker's own leave-by counts as
an event's push only when the asker holds it; someone else on it still gets theirs.

**Changing who does it while a follow is open** rebuilds the order from the new list: someone taken off never gets the job or the tell,
someone added joins the order, the holder taken off passes it to the first who can (with nobody left, the asker), and "just me" makes it
the asker's. **A Done after the follow closed** (missed at 3 am, or dropped) still counts while the item itself is open: the item is
ticked or the bill marked paid. **Un-ticking on purpose** on the Plan after someone said done is kept as the asker's answer, so the
hourly repair of a close cut short never ticks it again (or makes next month's bill again).

**Rules that always hold.**

| Rule | Where |
| --- | --- |
| No calls in quiet hours | X0 is calling asks the push gate (`plan_call`); the real call's `canCall` says "quiet"; someone else's item also never 10 pm to 7 am for a person with no quiet hours |
| A daily limit on rings | `plan_reach_caps`: louder pings, X0 calls and real calls per person under their ringMax; real calls also under `push.follow.phoneDayMax`, `FOLLOW_CALL_ASKER_DAY_MAX` and `FOLLOW_CALL_DAY_MAX`; a cap is given back when nothing went |
| Never the same reminder twice | one step row per (follow, climb, rung, person), claimed before anything is sent; push_log keys; `pf:<id>:<n>` items and the 60-second same-answer guard |
| Nothing paid or sent without your OK | Done on a bill records it paid (no payment anywhere); nobody gets anything without being in your X0 people; louder steps on someone else's item need their Allow; a real call needs their own switch |
| A bill paid by anyone stops it for everyone | one bill row and one follow per due day; Done from anyone on it closes it, ticks the bill once, and next month's bill carries the same people |
| Rules decide, not AI | importance, the ladder, every word: fixed rules and templates. Messy input still goes through the box and capture as before |

**Replies, from anywhere, to one door** (`PlanFollows.reply`): the app's buttons (push, Plan card, follow page, call screen) through the
act door on `pf:<followId>:<n>`, and the real call's keypad (1 done, 2 later, 3 can't). Every answer is kept on the follow with how it came.

**Who sees what.** The asker: the item page's Must not miss, Who and the open follow's line; the follow page with every step (sent,
opened, skipped and why) and every answer; a Needs-you card once told or when nobody can; Activity rows (someone else said done, can't,
a must item missed). The holder: their pushes, a Needs-you card, the follow page (what, when, who asked, when the asker hears). The next
person: the tell when the asker holds it, and the follow page. Lock screens and pushes to someone else never carry an amount, a place, or
a health or medicine title (`followTitle`, `forOthers`, `lockSafe`). The Needs-you card keeps its words in the app; on the widget, the
Lock Screen and a Live Activity it says only what the push says (its `outside` words: "A reminder from Rahul", or "Appointment" for the
person's own medicine). A follow's pushes share one collapse id (one line in the tray) only on phones whose app says `PushTapSeen` (the
JS that tells same-id pushes apart); older phones get each push on its own line.

**The real phone call.** Off by default (`CHANNEL_PHONE_CALLS`), for X0 users only, never someone without the app. The person turns it on
in What pings you ("X0 may call my phone if I miss something important") for their own number, proved theirs by a call from it that types
the code their own setup screen shows (one call proves one account; one account per number; 9 is kept by the number: `plan_phones`,
`plan_phone_stops`, Backend B's `followPhone.ts` and `docs/follow-channels.md`). At most 3 real calls a day to one number, whichever
accounts it is on. The switch shows only while the channel is set up.

**Push kinds and buttons.** plan_follow, plan_follow_loud, plan_follow_tell, plan_follow_none, plan_follow_passed, plan_follow_done,
space_follow, space_follow_loud, space_follow_tell, space_follow_done; buttons x0_follow (Done, Later, Can't), x0_follow_last (Done,
Can't), x0_follow_tell (Call, Done), x0_follow_check (Look, Done), x0_follow_none (I'll do it), registered only while the switch is on.

**Migration 0081** adds `importance` and `people` to `calendar_tasks` and `calendar_events` (written only when set, so a server ahead of
its migration still writes rows), and `plan_follows`, `plan_follow_steps`, `plan_reach_caps`, `plan_numbers` (gone with either account),
`plan_phones` (with `pending_code`, one account per proved number), `plan_phone_stops`; 'follow' as a `plan_calls` source. It can be run
again. Deleting an account also takes the numbers others kept for that person and their name from other people's follows
(`PlanFollows.forget`, from `routes/account/account.ts`).

**Not in v1.** Waits keep their own check-backs. The box reading "remind Mom to ..." (Who is set on the item page). Messages written by
AI (fixed templates only). Two people who each captured the same bill are not matched. Nobody without X0, by any channel (the owner's
change: no reply page, no WhatsApp).

**Known limits.** planCall's 3 calls a day are shared with leave-bys and bills; a call quietly not placed (busy, too soon) is a skipped
step and the ladder goes on. Quiet hours are off by default for app users, so a person's own must items can ring at night unless they set
them (someone else's never 10 pm to 7 am). iOS can't prove a push arrived: no answer is taken as maybe not seen and the next step comes on
time. A phone registers the new buttons at its next start; until then a press opens the follow page, where the same buttons are. A
followed bill rings at 6:10 pm instead of 10 am. Someone's louder steps wait for their own Allow. A restart can lose the one rung that was
being sent (never sent twice, by design). "Told once" is once per occurrence: a daily item tells the asker again the next day.

## 10. Plan something (`PLAN_V2_MAKE`, `PLAN_V2_MAKE_AI`)

The owner's words: "add sign and tapping the top area will open the plan creation screen. The screen will have a card to create the plan
custom manually: what, for who and time and all; ai checks, done, change, done. Type box at the bottom: tell ai what to do, it will
create and show; user change or done."

`bots.plan.make` (`experience/bots/screens/bots/planMake.ts`; rules `botsBots/planMake.ts`, service `planMakeService.ts`, routes
`routes/bots/planMake.ts`). Params: `from` ("plan" from the home), `day`, `kind` ("task" from "Add a to-do"), `focus` ("box" from the top
area). Every other "Add" (the week page, Today, Tasks: `planItem.ts addAction`) opens it too. A `day` before today (a past day the home's
strip was on) opens the card on today, so a plain Check is never "That time has passed".

**The card.** What; When (Today, Tomorrow and the next 3 days, No day, Other day; a day further on is written back as Other day and its
words); Time, under its own label (Any time, 9 am, 12 pm, 4 pm, 6 pm, 8 pm, Other time), so What, When, Time, For who, Must not miss and
Check fit one 390 × 844 phone screen above the box; For who
(each of the person's X0 people as their tiny bot, You first, only with follow-through on and someone to pick: "They get the reminder on
their phone."); one Must not miss switch ("X0 keeps reminding until it's done."; off means X0 decides); "+ Repeat" and "+ Place", closed
until tapped or filled by the box. Then **Check**. There is no "if not done, pass to": who comes next is set on the item page's "Who does
it", which already orders people. Check reads the What words by rules into what the person left as it was ("Dentist Fri 5 pm" with
nothing picked is Dentist, Fri, 5 pm), and only the words it uses leave the title: "Friday prayer 1 pm" on a picked Saturday stays
"Friday prayer" at 1 pm, "Morning walk 7 am" stays "Morning walk" at 7 am.

**Check (rules, free, always).** The check face is titled "X0 checked": up to 3 drafts, each with its head ("Medicine (Mom)" while an
unmatched name stays), when ("Fri 13 Nov · 5 pm", "Every Tue and Thu · 5 pm", "To do · no day"), for who ("For Dad · reminded at 8:45 pm":
what Done will really do, with Dad's tiny bot; a repeat made after today's reminder minute says "reminded tomorrow at 4:45 pm", the
first one that really comes, since a repeat's reminder is never shortened), Must not miss, where, and up to 3 notes, stops first, each
with at most 2 fixes, then "Looks good" when there are none. With a stop the face drops its tick and Done is a plain outline (it only
says the stop): the fixes are the next step. A draft with no name still shows "Say what it is." with [Fill it in]. With 2 or 3 drafts each has Change and Take out, and there is one Done for all ("Adds 2 things to your
Plan."). The checks:

| Check | Stop? | Words | Fixes |
| --- | --- | --- | --- |
| `no_title` | stop | "Say what it is." | Fill it in |
| `bad_day` | stop | "X0 couldn't read that day. Pick one." | Pick |
| `bad_time` | stop | "X0 couldn't read that time. Try one like 5:30 pm." | Pick |
| `too_far` | stop | "That's more than a year away. Pick a closer day." | Pick |
| `past` | stop | "That time has passed." | Tomorrow, same time; Today, 9 pm |
| `day_for_follow` | stop | "Pick a day so X0 can remind Dad." | Today, Tomorrow |
| `time_for_follow` | stop | "Pick a time so X0 can remind Dad." | 9 am, 8 pm |
| `late_for_follow` | stop | "It's past 10 am, so pick a time for X0 to remind Dad." | the next two whole hours (to 9 pm), else Tomorrow |
| `not_connected` | note | "Mom isn't in your X0 people yet, so it's for you." | Invite |
| `not_contact` | note | "That person isn't in your X0 people now, so it's for you." | Pick |
| `who_is` | note | "Who is Mom? Pick them." | Pick |
| `for_name` | note | "Remind Dad instead of you?" | Remind Dad |
| `ampm` | note | "9 am or 9 pm?" (before the clash: a clash is worked out on the guessed half of the day) | 9 am, 9 pm |
| `clash` | note | "Clashes with Parent-teacher meeting at 6:15 pm." | Move to the next free half hour |
| `already` | note | "Dentist is already on your Plan for Fri 13 Nov." | none |
| `must_auto` | note | "X0 marked it must not miss: it's medicine." | Keep normal |
| `follow_off` | note | "You turned off follow-ups in What pings you. X0 reminds you once." | none |
| `no_time_repeat` | note | "No time, so X0 won't remind you." | 9 am, 8 pm |

With follow-through off, who-words and must-words are not read at all (they stay in the title), and none of the who, must or follow
checks is made. No check reads anything of the other person's: only their name, from the person's own X0 people.

**The box** at the bottom: "Tell X0, like Dentist Fri 5 pm" (the example teaches the shape the rules read best). It does everything the
old box did, and makes drafts:
- plan words ("Dentist Fri 5 pm and remind Mom about medicine at 9 every night") become up to 3 drafts, shown checked; a 4th or more:
  "X0 took the first 3. Tell it the rest after.";
- "make it 8 pm", "add Dad", "every day" change the card on screen and nothing else;
- a bill or a wait shows a preview first ("Looks like a bill. Add it?" [Done] [Change]); a bill's says what Done would add, read by the
  box's own due reader ("Electricity ₹2,140 · due Sat 14 Nov"); the words leave the box while the preview shows, and Change puts them
  back; Done runs the box's own bill or wait path, with its own Undo;
- a family ask keeps its preview with [Ask]; nothing is sent until [Ask];
- a pasted notice opens its own capture card with its own Add all; notes on or off change the person's own setting; a day's question is
  answered under the box (with "Open chat" as a small pill); anything else goes to the Plan Ease chat (its own gate and budget), with
  the answer under the box: a polite ask with nothing to plan in it ("Can you remind me tomorrow at 5?") too, as the old box did;
- the + adds a photo, a camera shot or a file (the window: a file), read by the share-in screen.

Its answers that are not drafts (a bill's or a wait's preview, a day's answer, the chat's) show under the header, above the card, so
they are on screen when they come; drafts show on the card's check face. The box stays at the bottom: the phone's footer over the
keyboard, the window's foot outside the scrolling column (`page({ dock })`), never under a long card.

**The AI read** (`PLAN_V2_MAKE_AI`). AI only reads messy words; the rules decide times, people, must not miss, clashes and caps. A read
is asked only when all of these hold: the switch and Plan Ease's reader are on; the words are a plan item of 300 characters or fewer; the
rules found them unsure (a bare number left in the title, a name that matched nobody, two weekdays, "after lunch", Devanagari, and the
like: "Dentist Fri 5 pm" and "Buy 2 kg rice" never cost anything); the person said yes to AI (`privacy/aiGate.ts`); no other read is
running for them; and at least ₹1 of today's reading is left. It comes out of capture's reading share of Plan Ease's day budget, at most
₹4 of draft reading a day per person. The budget's day is the person's own (their saved offset), never the offset a request sends, and
an earlier or the same day never starts the count again (`planCapture.ts budgetDay`): flipping the offset on every send makes no new day. What is sent: the words, inside `<message>…</message>`, and, only for a change, the card's own
fields (title, day, time, repeat, an unmatched name, place). Never the contact list, and never a picked person's name. Every answer is
checked again: a who or a place is kept only when the person wrote it, importance never comes from the model, and anything odd falls
back to the rules' draft. When the rules were unsure and no read was used, the check face says why: "X0 filled in what it could. Check
who it's for." (a name that matched nobody), "… Check the day and the time." (a number, two weekdays, "after lunch"), or "… Check it
before Done." (anything else, or more than one reason). "Plan something" never asks for AI itself: the permission is asked once, after
onboarding (`firstRun/aiConsentCard.ts`). Without that yes, setup says `ai: "off"`, the rules read everything, and the screen says
nothing about AI (no "Turn on AI", no AI card). Check itself never calls a model: with the yes, when the card's own What words still look
messy it offers "Some words were hard to read." [Read it with AI], and only a tap sends them, through the same read and bounds (`keep: "1"`: it fills
only what the card left empty and keeps who, must not miss, place and repeat as picked).

**Done.** The server first looks up the rows this key already made: when there are any (a retry after a lost answer), it answers those
rows and checks nothing again, so a Done that worked at 4:56 is never refused at 4:59 with "That time has passed". Otherwise it checks
every draft again (a stop answers 400 `fix_first`, and the screen checks again to show it), then makes each
row through the calendar (`Calendar.addEvent` / `addTask`, with `parsed: true` so the checked title is saved exactly as shown) and,
only when an importance or someone was picked, follow-through's own `setItem`. Nobody is told at Done: the follow starts when the item's
reminder comes due ("X0 reminds Dad at 8:45 pm"); an event made inside its reminder window gets a shortened reminder so it still comes.
Done is idempotent: its key comes from the server in every draft and check answer (never made by the screen), the rows are
`make:<key>:<n>` under the calendar's unique `(user_id, source_key)`, a retry answers the same rows, and one Done per key runs at a time.
From the home, Done lands on the home on the new item's day with "Added: …" and **Undo** (`POST .../plan/make/undo`, which takes out
exactly those rows); from anywhere else it goes back with a toast. A failure half way takes out what that Done made, and only that: a row
another request made first (the unique key, another server) is used but never taken out by this one.

**The screen's state.** Drafts live only in the screen's state; the server keeps none and there is no table. Every action is behind a
busy guard (Check, Done and the preview's Done are hidden while anything is on its way), and the screen is never kept
(`kit.ts NEVER_KEPT`), so a kept copy never wipes what was typed. It is drawn only for a build whose state survives an answer: PersonBot,
and a window with KitExtras or a phone with ActionParams. Any other build, or `PLAN_V2_MAKE` or `PLAN_V2_PAGE` off, gets the old add form
(`planItem.ts planAddForm`) with its `day` and `kind`. Known limit: the phone fetches the screen again when the connection comes back or
after a deploy, and that drops the drafts; nothing is ever made twice, because the key goes with them.

**Routes** (`routes/bots/planMake.ts`; all resolve the user, `cache-control: no-store`; no words, titles, names or places in any log):

| Route | Body / query | Answer | Rate limit |
| --- | --- | --- | --- |
| `GET /v1/botsapp/bots/plan/day` | `?tz&day&week&made&n` | the home (`PlanDayData`) | `RL` |
| `GET /v1/botsapp/bots/plan/make` | `?tz` | `MakeSetup`: today, the people (You first, at most 20), follow, ai on/ask/off, the invite | `RL` |
| `POST .../plan/make/draft` | `{ words, tz, d?, list?, at?, day?, keep? }` | drafts, a preview, or the box's answer | 20 a minute |
| `POST .../plan/make/check` | `{ list, d?, at?, tz, day0?, fix?, drop? }` | the drafts checked again, with a fresh key | 60 a minute |
| `POST .../plan/make` | `{ key, list, tz }` | what Done made (`MadeView`) | 20 a minute |
| `POST .../plan/make/undo` | `{ key, n }` | `{ ok, removed }` | 20 a minute |

Words are 1 to 2000 characters (413 over); the AI read only ever sees 300 or fewer. With `PLAN_V2_MAKE` off the make routes answer 404
`make_off`; with `PLAN_V2_PAGE` off `plan/day` answers 404 `plan_v2_off`.

**The phone and the desktop need nothing.** Every part is one both shipped builds already draw (Stack, Text, TextField, BotBuddy,
PersonBot; setState, toggleInArray, condition, callEndpoint with `assignTo` and `stay`, navigate with `$state` params, navigateBack,
toast). Desktop 0.4.7, with no KitExtras and no PersonBot, keeps the week page and the old form. No migration (if one is ever needed, it
takes the next free number).

**Render samples**: `scripts/bots-render/samples/planMake.ts` (the home today, tomorrow, an empty day, after Done, an older build and no
walking bot; the card empty and filled, the check face looking good, with notes, with a stop, with two drafts, who is Nani,
the What words still messy ("Read it with AI"), a bill's preview, a day's answer, follow-through off, an older build). Every answer in them is the real service's, worked out when the file
loads over one calendar in memory: the home's from `PlanEase.day`, the card's from `PlanMake.setup`, `.draft` and `.check` (each check
face is the state the screen's own ON_FILL or ON_CHECK leaves after that answer). A sample may start in a state (`Sample.state`,
`render.ts --state`).

**Tests**: `plan-make-words`, `plan-make`, `plan-make-service`, `plan-make-routes`, `plan-thread` (the rules, the service, the routes);
`plan-home-screens`, `plan-make-screens` (the trees); and `plan-make-join`, which builds both screens as the server serves them and
drives them the way the apps run them (the phone's rules and the window's: strict and `String()` compares, an empty list false), every
call going to the real routes (`registerBotsBotsRoutes`: `plan/day`, `plan/box`, the act door, the make routes) over one calendar: the
box, the card, a fix, Take out, Change at a slot, Done and its retry, `fix_first` and the check again, no AI without the yes, Read it with AI with it, a
bill's preview and its Undo, the home's query, its Undo and a tick.

**Not in v1.**
- Voice in the box (the phone's keyboard mic types into it; `media.ts listenAction` is the later path).
- Remembering "Mom is Sunita": X0 asks "Who is Mom? Pick them." every time.
- Telling the other person at Done: follow-through tells them at the reminder time.
- Bills and waits as drafts with amount and payee fields: they keep their own box path, with a preview first.
- "If not done, pass to" on the card: one person per item at creation; the next one is added on the item page's "Who does it".
- The thread's leave-by, weather and credit lines for days other than today and tomorrow, as before.
