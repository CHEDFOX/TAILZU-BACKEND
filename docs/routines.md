# Routines: bots that work without being asked

A **routine** is something a bot does on a schedule, by itself: "Every Friday at 5, sum up my week", "Weekdays at 9, send me the top tech news", "Every morning at 8, check the weather in Lisbon". The person says it once, in Ask, the way they ask anything; a card shows what will happen; they tap **Save**. From then on the bot does it at that time, even with the app closed, and the answer arrives as a notification.

Code: `tulmi/src/routines/` (the feature), `tulmi/src/routes/routines.ts` (the routes), `tulmi/src/experience/bots/screens/routines.ts` (the card, the list, Home's row). Migration: `tulmi/supabase/migrations/0061_routines.sql`.

It is **on whenever the bots platform is** (`BOTS=true`); `ROUTINES=false` turns it off (the routes answer `404 routines_off`, Ask answers schedule words as an ordinary ask, nothing runs). `ROUTINES_MAX` (default 20) is how many one person may have.

## 1. Saying it

`POST /v1/shell/ask` reads the words first with **rules only** (`routines/words.ts readRoutine`, free, no model). Words that ask for something done again and again are not answered: the reply's `shell.routine` is a **draft** and Ask's answer page shows the routine's card instead of an answer. Nothing is kept yet.

What it reads:

| Said | Schedule |
| --- | --- |
| every day, daily, each day, every morning / evening / night | every day (a part of the day sets the time: morning 9 am, afternoon 2 pm, evening 6 pm, night 9 pm) |
| weekdays, every weekday, Monday to Friday | Monday to Friday |
| every Friday, on Mondays and Thursdays, every Mon, Wed and Fri, every weekend | those days of the week |
| every week, weekly | the day it was set up on |
| every month, monthly, on the 1st of every month | that day of the month (1 to 28) |

A time is "at 8", "8am", "at 7:30 pm" ("every evening at 7" is 7 pm). With no time said it runs at 9 am, and the card shows the time so they can change it.

What is **not** a routine, on purpose: "remind me every day at 8 to ..." (a reminder: Plan Ease's calendar keeps it), a question ("how do I back up every day?"), and "every time ..." (an event, not a time: see section 6).

The card says when ("Every Friday at 5 pm"), what ("Sum up my week"), the first run ("Fri 6 Nov at 5 pm"), and **who does it**: chips of the person's bots with the one "Ask any bot" picked already chosen (`Bots.target`). Xode is never offered (section 5). **Save** sends the draft's token and the chosen bot to `POST /v1/routines`; **Change** goes back to Ask with the words.

## 2. Running it

Every minute (`startRoutines`) the server finds the routines that are on and due, and for each:

1. **Claims** its due time by moving `next_at` on to the next run, only if it is unchanged. Two servers, or two ticks, never run the same routine twice for one time.
2. **Skips** it if it is more than 3 hours late (the server was down): a morning briefing at 3 pm helps nobody. The next run is worked out from now.
3. **Runs** it as its owner through the bot's own road (`Bots.ask`): the bot's rules, skills, connected apps, memory and **budget**. Anything that sends, deletes or pays becomes the same confirm card as always, and the push for it goes out as always.
4. **Keeps** the answer on the routine (4,000 characters), writes it down for Activity, and pushes `routine_done`: "Plan Ease: Sum up my week" with the answer's first line, or "It needs your OK." first when something waits for a yes.

At most 50 routines a tick, 3 at a time.

**When it goes wrong.** A failed run is kept with why (the bot's own words, such as "Plan Ease has used its budget for today."). **Three failed runs in a row pause it**, with why, and push `routine_failed`. A routine whose bot was deleted pauses at once ("Gym coach was deleted. Pick another bot to turn it back on."). Turning it back on forgets the failures and works out the next run from now.

Pushes follow "What pings you" (`you/push.ts`): sent; in quiet hours without a sound.

## 3. The routes

```
GET    /v1/routines                         { routines, max, choices }
POST   /v1/routines/draft { message, tz, bot? }   { draft } | 422 not_a_routine (nothing kept)
POST   /v1/routines { token, bot?, tz? }    201 { routine }   (or { task, schedule, tz, bot })
PATCH  /v1/routines/:id { status?, task?, schedule?, tz?, bot? }
POST   /v1/routines/:id/status { status }   pause ("paused") or turn on ("on"): the screens' way (the kit sends no PATCH)
DELETE /v1/routines/:id                     204
POST   /v1/routines/:id/run                 once now, the schedule unchanged (429 too_soon within a minute of the last run)
```

Every route is the signed-in person's own; another person's routine is `404`. Saving checks everything again: the bot exists and is not Xode, the task is 3 to 300 characters, the schedule is valid, the person is under the cap, and the same routine does not exist already.

A schedule is `{ every: "day" | "weekdays" | "week" | "month", minute, days?, monthDay? }` in the person's own time; `tz` is their offset in minutes east of UTC when they set it up (the apps send it with every ask).

## 4. On the screen

* **Ask's card** (above).
* **`bots.routines`**: each routine's bot, task, when, next run and last answer, with Run now, Pause / Turn on and Delete (asked twice). New routines are made in Ask. It reloads on the `routines` live topic.
* **Home**: a Routines row under the bots once there is one ("2 on · next tomorrow at 8 am").
* A routine's push opens `bots.routines`.

## 5. Not yet

* **Xode.** A routine for Xode would be a code job on a timer (dependency updates, a nightly check). It needs the job's own approvals and money rules, so it is refused for now ("Xode can't take routines yet").
* **Events.** "When an invoice email arrives, file it" needs the connected apps to tell us when something new happens (webhooks or polling per app). Xode's PR care already works this way for GitHub (`docs/pr-care.md`).
* **Daylight saving.** The offset is the one they had when they set it up; a routine moves by an hour when their clocks change, until they edit it.
* **Editing on the list.** Change the time or bot by saying it again in Ask and deleting the old one.

## 6. Tests

`tests/routines-words.test.ts` (reading the words, the next run) and `tests/routines.test.ts` (drafts, saving, the tick, failures, pausing, the routes, Ask's card, the screens on both clients).
