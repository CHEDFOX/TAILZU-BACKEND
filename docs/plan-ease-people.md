# Plan Ease: other people (steps 4 and 5)

The owner's rule: "it should be all easy and simply organised for a user - we do the complex tasks - the user sees the simplest things".

Two things other people owe the person, and Plan Ease does the chasing:

- **Waiting on someone** (step 4). "Rahul will send the numbers by Thursday" is checked back on by itself. At 6 pm on Thursday the
  person gets "Still waiting on Rahul" with the follow-up already written, and Send opens WhatsApp with it.
- **Family asks, repeats and turns** (step 5). "Who picks Kabir up Wednesday?" goes to the family, and the first "I'll do it" wins.
  Chores can take turns, each turn with one push the evening before.

Both use the foundation's seams (`plan-ease.md` section 4). Both run on rules alone: the words are read by rules, and the drafts and
pushes are templates.

## 1. The switches

| Switch | Step | On | Off |
| --- | --- | --- | --- |
| `PLAN_V2_WAITS` | 4 | The box reads a wait, a meeting's to-do that is someone else's becomes one, and the check-backs run. Needs migration 0073. | The box reads it as a plain to-do. There are no check-backs. Waits already kept stay on the list as to-dos. |
| `PLAN_V2_ASKS` | 5 | Family asks, repeats and turns. Also needs `SPACES_ENABLED`. Needs migration 0074. | The box sends the words to the chat, as before. Asks already made stay in the space, and nothing more is pushed for them. |

Both are on by default. With `SPACES_ENABLED` off, step 5 is hidden everywhere: no card, no box reading, no push (every `space_*`
kind), and its buttons answer 404. Step 4 works as before.

Run `0073_plan_waits.sql` and `0074_space_asks.sql` before deploying. Both are idempotent. Turn `PLAN_V2_ASKS` on only once every
server runs this code: an older server's space task list has no kind filter and would show an open ask to everyone as a task.

An ask never goes to someone with a block between them and the asker (either way round): no push, no card, not among who may take it,
not in named turns; and an ask from them sent before the block is not shown either (`planAsks.ts others`, `cardsFor`).

From a meeting's notes (`planCapture.ts fromNote`), someone else's to-do with a real name and a day lands as a wait on one card with the
meeting's other named to-dos ("2 things from the meeting"), never for "Speaker 2". A wait's notification opens WhatsApp only for its
Send (or a visit's No); a tap just to look opens the Plan and counts as nothing. On the widget its card is open-only ("Still waiting on
Rahul"), since Send can't be pressed there.

## 2. Waiting on someone

**Made without a form** (`botsBots/planWaitWords.ts`, rules only):

| Typed or said | It is | It checks back |
| --- | --- | --- |
| "Rahul will send the numbers by Thursday" | waiting on Rahul for the numbers | Thu 6 pm |
| "Rahul will send it by 3 pm Thursday" | the same | Thu 4 pm (an hour after the time) |
| "Waiting on Rahul for the deck this week" | the same | Fri 6 pm |
| "Priya promised to call back" | no day said | in 3 days, 6 pm |
| "Plumber said Tuesday", "The courier is coming tomorrow" | a visit: "Did the plumber come?" | Tue 4 pm |
| "Add to my tasks" on a meeting's to-do whose "who" is a real name | the same, from the meeting | its day |

- A meeting's speaker label is written as the name the person gave that speaker. "You", "Speaker 2" and "Others" are never someone to
  chase, so those stay the person's own to-do.
- A phone number or an email is kept only when it was in the words themselves. Contacts are never read.

**On the list:** the row says "The numbers" with the grey line "Waiting on Rahul · by Thu". Its tick is Sorted.

**At the check-back** (`planWaits.ts`, a job every minute, claimed by moving `check_ms` on so two servers never send twice):

- **The push:** `plan_wait`, "Still waiting on Rahul" / "The numbers were due Thursday.", with [Send] [Sorted]. A visit is
  `plan_came`, "Did the plumber come?" / "They said Tuesday.", with [Yes] [No]. A check-back counts towards Plan Ease's six pushes a
  day.
- **The card:** "Still waiting on Rahul. Send this?" The draft sits under it as a message: "Hi Rahul, just checking on the numbers.
  Could you send them today?" The buttons are [Send] [Sorted].
- **Send** opens the hand-off screen (`bots.plan.send`). WhatsApp opens at once with the draft, to the number if one was given,
  otherwise WhatsApp's own chat picker. An email address opens the mail app. The person presses send there. It checks again in 2 days.
- **Sorted** closes it. The page's Undo opens it again.
- **Left alone,** it asks the next evening. After 3 check-backs it stays quietly on the list.

The draft is in the app's language, English or Hinglish. Outside the app nothing says a health word ("Dr. Mehta" is "a reply") or an
amount.

A notification's body tap and its Send both open WhatsApp, as a leave-by opens Maps. A visit's No opens the Plan page, whose card has
No ("Hi, are you coming today?"), so a tap on "Did the plumber come?" never messages anyone.

## 3. Family asks

**The asker types** "Who picks Kabir up Wednesday and Thursday at 1 pm?" (`planAskWords.ts`). They must be in a space with at least
one other person. With more than one space, the ask goes to the space named in the words ("ask Ghar: …"), otherwise to the one they ask
in most.

1. **A preview first.** It reads "Ask Ghar: who picks Kabir up Wed and Thu at 1 pm?" [Ask]. Nothing goes to anyone until they tap.
   Tapping the words puts them back in the box, to change the day, the time or the space. Leaving it sends nothing, and the preview is
   gone after a day.
2. **[Ask]** turns two days into two asks. Everyone else in the space gets one `space_ask` push and a Needs-you card. The card says
   "Who picks Kabir up Wednesday?", with the asker's tiny bot, "Priya asked · 1 pm", and [I'll do it].
3. **The first tap wins.** It is one conditional write, made only while nobody has it:
   - It lands on the taker's day as "Kabir pickup", with the asker's tiny bot. A timed ask lands as a plan, a day's chore as a to-do.
   - The asker gets a `space_ask_taken` push with no sound: "Mom's picking Kabir up Wednesday".
   - Everyone else's card goes.
   - A late tap gets "Mom's already got it", with no sound.
   - There is never a "Priya gave you a task" push and never a feed message for an ask. The ask's own push is the one ping.
4. **Halfway to the take-by,** the family gets one `space_ask_nudge` with no sound.
5. **At the take-by,** nobody has taken it, so the asker gets "Nobody's taken Wednesday's pickup yet" [I'll do it], as a push and as a
   card. The take-by is 6 pm the day before. Asked after that, it is 2 hours on, but at least an hour before the thing. The ask stays
   open for the family until its time.
6. **Can't do it** from the taker's own day opens the ask again for everyone else.

**Repeats.** "Who picks Kabir up every Wednesday?" is asked again, one occurrence at a time, once the last one has passed.

**Turns:**

- **Named.** "Arjun and Rohan take turns watering the plants every Sunday" sets up the turns in the order named. It goes after the same
  preview and [Ask].
- **Not named.** "Plants every Sunday, taking turns" asks the family "Who's in?" [I'm in]. At the take-by, the turns start in the order
  people tapped.
- **Each turn** lands on that person's Sunday as "Plants · your turn", with the asker's tiny bot.
- **At 6 pm the day before,** the person whose turn it is gets one `space_turn` push: "Your turn: plants on Sunday" / "Arjun did it last
  time." [Can't do it].
- **Can't do it** passes the turn to the next person, who gets the push at once. When nobody can, the asker hears "Nobody can do the
  plants this Sunday" [I'll do it].
- **Doing nothing** means they're doing it. A Done, from the push's day, the space or the person's own list, moves the turn on.

**The evening note** says who's doing what tomorrow, in its second place: "Kabir pickup: Mom."

**What others see:** the asker's question, the time and the place, and nothing else of the asker's day. Outside the app the words are
made from the ask's parts: never "tomorrow" (a day's name stays true), no amounts, and a health visit is plain ("Who can help
Saturday?").

**In the space** an open ask is in nobody's list and on nobody's day. Once taken it is that person's task, like any other, so their Done
answers as it always has (`spaceTasks.ts` skips open asks and leaves landing asks to `planAsks.ts`).

## 4. The pieces

| File | What |
| --- | --- |
| `botsBots/planWaitWords.ts` | The wait's rules: reading the words, the check-back times, the drafts, the hand-off links |
| `botsBots/planWaits.ts` | The waits service and its job. Seams: `WAIT_NEEDS`, `WAIT_ROW`, `WAIT_SLOT`, `WAIT_ACTS`, `plugWaits()` (a source) |
| `botsBots/planAskWords.ts` | The ask's rules: reading the words, the take-by and nudge, every word the family and the asker get |
| `botsBots/planAsks.ts` | The asks service, its store (the take only while nobody has it) and its job. Seams: `ASK_NEEDS` (with the evening note's lines), `ASK_SLOT`, `ASK_ACTS`, `plugAsks()` |
| `experience/bots/screens/bots/planSend.ts` | `bots.plan.send`, the wait's hand-off |
| `routes/bots/botsPlanPeople.ts` | Wires both at boot (pushes, the day cap, the app's language, a space task's Done and Can't do it) and `GET /v1/botsapp/bots/plan/handoff` |
| `supabase/migrations/0073_plan_waits.sql` | The wait's columns on `calendar_tasks` |
| `supabase/migrations/0074_space_asks.sql` | The `ask` kind on `space_tasks` and its columns |

**Push kinds** (`planKinds.ts`):

| Kind | Group | Buttons |
| --- | --- | --- |
| `plan_wait` | Plan Ease's own | `x0_wait`: Send (opens the hand-off), Sorted |
| `plan_came` | Plan Ease's own | `x0_came`: Yes, No (opens the Plan) |
| `space_ask` | a person's word | `x0_claim`: I'll do it (`x0_in`: I'm in, for "Who's in?") |
| `space_ask_none` | a person's word | `x0_claim` |
| `space_turn` | a person's word | `x0_turn`: Can't do it |
| `space_ask_nudge` | quiet | `x0_claim` |
| `space_ask_taken` | quiet | none |

- A person's word is sent even when Plan Ease is off on "What pings you". It has no sound in quiet hours.
- "Quiet" (a new group in `verdict()`) is a person's word that never makes a sound.
- Each family kind uses the Android channel `family`, "Family asks".

**Buttons** at the act door (`POST /v1/widgets/act`):

| Item | Action | What it does | Who can press it |
| --- | --- | --- | --- |
| `pt:` | `sorted` | Closes a wait | a widget too |
| `pt:` | `came` | A visit's Yes | a widget too |
| `pt:` | `send`, `notcame` | Need the app, which opens WhatsApp | the app only |
| `pt:` | `unsort` | The page's Undo | the app only |
| `stask:` | `take`, `in` | I'll do it, I'm in | a widget too |
| `stask:` | `cant` | Can't do it | a notification too |
| `stask:` | `ask` | Sends the preview | the app only |
| `stask:` | `untake`, `unin` | The page's Undo | the app only |

- An `stask:` item's `done` stays Spaces' own.
- The widget shows only the buttons that answer in place, so a wait's card there has Sorted.

## 5. Not in this slice

- **A capture card from a meeting's notes.** When the notes landing is built, it can make its "Waiting on" items with
  `waitFromTodo(todo, note.people, now, tz)` and add them with `planWaits().add(...)`. Today, "Add to my tasks" on such a to-do makes
  the wait.
- **Chasing family members by WhatsApp** for a space task that has gone past its day. The design leaves this out (D1 #34).
