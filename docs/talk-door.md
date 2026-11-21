# Talk: the one screen

The app used to open on a grid of bots. On a phone that grid is a list you scroll — eight living tiles one to a row,
then chips for the rest, then the routines and the notes strip — and every job began with a decision nobody should have
to make: *whose* job is this? Keylessbord's, Plan Ease's, the Travel bot's, Xode's? Pick wrong and you are back out,
scrolling.

So the app opens on **Talk**: one thread, you say what you need, and whichever bot it belongs to answers **in it**.
Nothing is picked first. The bots are all still there, each with its own page for its own work; what has gone is having
to go and find one.

**Nothing here is a second brain.** Every message goes through the door that already exists — `POST /v1/shell/ask` →
`POST /v1/ask` → the front door's rules, its picking of a bot, its guards, its budgets, its routine drafts, its Activity
row ([front-door.md](front-door.md), [bots.md](bots.md) section 7). This is a *thread* over that door, and two marks.

* [1. The screen](#1-the-screen)
* [2. The two marks: "/" and "@"](#2-the-two-marks--and-)
* [3. What draws in the chat](#3-what-draws-in-the-chat)
* [4. Xode is a pill, not a turn](#4-xode-is-a-pill-not-a-turn)
* [5. The thread](#5-the-thread)
* [6. The door](#6-the-door)
* [7. The asks that moved with the landing](#7-the-asks-that-moved-with-the-landing)
* [8. Older builds](#8-older-builds)
* [9. What is left before the Bots tab could go](#9-what-is-left-before-the-bots-tab-could-go)
* [10. Where everything is](#10-where-everything-is)
* [11. Tests, and what needs a live check](#11-tests-and-what-needs-a-live-check)

## 1. The screen

```
┌──────────────────────────────────────────┐
│  ◉   [ Talk ][ Xode ]            ⌕   ◯   │   the mark, the two pills, search, you
├──────────────────────────────────────────┤
│                      what's on tomorrow? │   your words
│  ● Plan Ease  2:32 pm                    │   WHO answered — one thread, every bot
│  Three things, and one needs leaving     │
│  early.                                  │
│  ●─── Riya's mehendi, 11 am              │   what the bot drew from its own answer
│  ○─── Salon, 1 pm                        │
│  Share  Report                           │
│                                          │
│          the cart rounds 99.5 down, fix  │
│  ● Xode  2:42 pm                         │
│  ┌────────────────────────────────────┐  │   no words at all: the job IS the answer
│  │ ● Xode is on it         Watch  ›   │  │
│  └────────────────────────────────────┘  │
├──────────────────────────────────────────┤
│  (+)  [ Say what you need…          ↑ ]  │   / a bot, @ someone, or just say it
└──────────────────────────────────────────┘
│   Talk        Bots        Activity       │
```

`bots.talk` is the first tab and `initialTabId`, so it is what the app opens on. The **Bots** tab keeps the grid,
because a bot's own page — a trip, a day's plan, a mailbox, a film — is a place and not a message.

## 2. The two marks: "/" and "@"

Both are read **for nothing** (`botsBots/talkWords.ts`, pure, no model), and neither is taken on the client's word.

| Mark | Means | Rule |
|---|---|---|
| `/` | **a bot** | `/plan what's on tomorrow` goes to Plan Ease, with the `/plan` off the words. The slug has to be one of **this person's own** bots. |
| `@` | **a person** | `@Mom ask about the advance` is still answered by whichever bot fits, and that bot is **told it is for Mom**. |

**Why "/" is the bot and not the command.** A bot's own saved commands are already `/name` *inside* that bot
([bots.md](bots.md) section 6). At the door, before any bot is chosen, there is no bot whose commands those could be —
so "/" there is the choice of bot. The first `/word` that is one of the person's bots is read as one; **a `/word` that
is not is left in the words exactly as typed**, so the bot that does answer expands it as its own command, as it always
has. One mark, two heights, no ambiguity.

**"@" is a person, and the name is ours.** The chip sends an **id**; the server checks it is someone they still share a
space with and reads the **name off that list** — never off the body. The name is then cut down to what a name can hold
(letters, digits, spaces, `.'-`, 40 characters) and said to the bot as one plain line at the **end** of the words:
`(This is for Mom.)`. Last, so the person's own first words are what the door scores. This matches
[social.md](social.md) section 5: outside a group conversation, "@" means that person. Nothing writes `to_id`.

With Spaces switched off nobody is connected to anybody, so the "@" list is empty and the mark offers nothing
([spaces.md](spaces.md)).

**Talk's own names.** `/new` starts a fresh thread. It is answered here, never sent to a model, and no bot can take the
name. That is the whole list (`TALK_COMMANDS`).

## 3. What draws in the chat

**The screen draws nothing new, and that is the design.** Every part of a turn is something the app already draws:

| In a turn | Drawn by | Where it comes from |
|---|---|---|
| the words | `answerBlocks` (`screens/bots/parts.ts`) | as every bot's chat draws them |
| **what the bot drew** | `showNodes` (`experience/bots/show.ts`) | the blocks **the bot itself chose from its own answer** — a choice, the steps, a table, a chart, a drawing ([show.md](show.md)) |
| what it found | `findsCards` (`screens/finds.ts`) | flights, stays, money, weather (`src/everyday`) |
| a routine to save | `routineCard` (`screens/routines.ts`) | the door's draft, sealed on the turn |
| a job, a payment, a yes waiting | `jobCard` / `payCard` / `waitsCard` (`screens/shell/doorCards.ts`) | shared with the Ask screen — one implementation, two screens |
| Share and Report | `answerShare` (`parts.ts`) | App Review 1.2 and 4.7.1 |

So a "bot interface" appears in the chat only where the answer needs one, and only as big as it needs, because the
model picks the blocks and the renderer gives them all one look. **A card is small on purpose**: a job's whole progress,
a trip, a day's plan belong on their own pages, and the card is the way there.

Two things are new, and only these: each answer says **which bot gave it** (a turn's `by`), because one thread holds
every bot now; and a **drawing's taps go back through the door** (`ShowOpts.path`), because the bot that drew a choice
is not the thread's bot and need not be the one that should answer what was picked. The picks become the person's words
and are routed on their own merits.

**The front door's answers are drawn now.** `show` was asked for only where an answer is drawn, and the front door was
not such a place ([show.md](show.md) section 2). Talk is: `POST /v1/ask` takes `draw: true`, which reaches a **bot's**
answer only. The front door's own roads keep their visual ladder ([front-door.md](front-door.md) section 4), and an API
caller, a routine and a voice call still pay for no drawing.

## 4. Xode is a pill, not a turn

Everything else answers with words and a card. Xode answers with a project, a branch, a plan, a job and a pull request,
and it has to know **which project** before it can do anything. That is a place, not a message — so it sits beside Talk
on a pill and keeps its own page.

The pills are not a `segmented` control. A segmented control picks a value on the page you are on; these cross between
two **screens**, each with its own load, its own cache and its own state. Drawing both trees into one screen behind a
`visibleIf` would make every open of Talk fetch Xode's projects too. So the pill you are on is filled and does nothing,
and the other navigates (`kit.ts pillSwitch`).

Asking Xode in plain language still works from Talk: the door routes a code task to it, and the answer is the job card,
which opens the job.

## 5. The thread

One thread, kept under the slug of the built-in generalist (`talk`), **whoever answered** — that is what makes it one
conversation rather than one per bot, and it is why the next message has a subject. The specialist bots keep their own
threads for their own pages, untouched.

A turn carries, beyond what every chat turn carries:

* **`by`** `{ slug, name, color }` — the bot that answered. Only Talk's thread has it.
* **`did`** `{ job?, upi?, finds?, needs?, routine? }` — what the answer left to do: ids and counts, never words a model
  wrote. The cards are drawn from it.
* **`forName`** — who the message was for, as it was shown when it was sent. A name, never an id.

All three are read back through a checker, because a kept row is data like anything else (`botsBots/chat.ts byOf`,
`didOf`). **A turn with no words is still kept** when it has a card: a job started or a payment filled in *is* the
answer. A turn with neither words nor anything done is the one case there is nothing to keep.

Sessions work as they do everywhere (`botsBots/sessions.ts`): a message joins the one last touched, `/new` opens
another, and nothing is deleted. Clearing is the person's own to do.

**Talk shows one conversation, not everything ever said.** The read is `chat.ofSession` — the session asked for, else
the one last touched. It was `chat.recent`, which selects on `{ user_id, bot }` and knows nothing of sessions, so
every turn came back whatever conversation it belonged to and `/new` only *looked* fresh: its own answer carries no
turns, and the very next read put the old ones back. A new thread you cannot see is not a new thread.

### Your conversations (`bots.talk.threads`, `screens/bots/talkThreads.ts`)

The balloons in Talk's head. Every Talk conversation, newest first, each openable where it stopped — because one
conversation at a time only works if there is a way to put one down and pick it up again, and `/new` was the only way
to start another with nothing anywhere saying so.

Nothing new is drawn: the rows are `botSessions.ts`, the same ones a bot's page uses, with the same picture, the same
"today / yesterday / Tue", and the same round `+`. Sessions were already served at `GET AREA/sessions/:slug`; what was
missing was only ever the way in.

**Carrying one on does not push a screen.** Talk is a TAB ROOT and a tab root is reached by switching to it, which
carries no params (`ids.ts`). So a row makes its session the one last touched (`POST AREA/session/:id/here`) and
switches to Talk, which reads whatever is current — the same rule that decides where new words land.

## 6. The door

```
POST /v1/botsapp/talk { message | picks, bot?, to?, session?, streamId?, attachments?, tz?, clientId?, typedAt? }
   │  readTalk: "/" → a bot of theirs, "@" → an id checked against their own people, "/new" → answered here
   ▼
POST /v1/shell/ask  (unchanged: the routine draft, the Activity row, the outbox's answer-once)  + draw: true
   ▼
POST /v1/ask        (unchanged: the front door's rules, its pick of a bot, its guards and budgets)
   ▼
chat.keepDoor       both turns on the thread, with `by`, `did` and the drawing
   ▼
{ turns, shell, session }
```

| Route | |
|---|---|
| `GET /v1/botsapp/talk?limit=&session=` | one conversation oldest first — the one named, else the one last touched — who "@" offers, and Talk's own commands |
| `POST /v1/botsapp/talk` | one message, done, and kept |
| `POST /v1/botsapp/talk/new` | a fresh thread; nothing is deleted |
| `DELETE /v1/botsapp/talk` | start it over |
| `GET /v1/botsapp/bots/sessions/talk` | the conversations, newest first (the shared sessions route) |
| `POST /v1/botsapp/bots/session/:id/here` | carry that one on: it becomes the one last touched. Nothing made, nothing closed |

**A refusal keeps nothing.** When the door says no — the day's allowance spent, overloaded, stopped — its own answer
goes back as it is and the thread is untouched. A thread holding the person's words with no answer under them reads as
an answer that was lost.

`BOTS` off: every route here is 404 `bots_off`, as the rest of the bots area is.

## 7. The asks that moved with the landing

Home carried the app's asks because Home was where everyone landed. Moving the landing without moving them would have
been the real bug in this change, so Talk draws the same ones, with Home's own code (`shell/home.ts homeNotices`):

* **the AI permission** — the one that matters most. Nothing may be sent to a model before it is answered
  (`privacy/aiGate.ts` refuses the call), so a Talk that landed people and never asked would have met them with a
  refusal and no way to clear it. It is still asked **once**: the answer is the server's, so answering on either screen
  clears it on both (`tests/ai-asks-once.test.ts` holds that down).
* the microphone and keyboard card, the first time anyone lands in the app
* the username card, the notifications ask, and the account-deletion notice

## 8. Older builds

Talk's bar wants `MentionField` with `pick: "bot"` and `commands`, which is the capability **`MentionCommands`**. The
default is the opposite — "/" then a bot opens that bot's **things** to share, which is what a space's composer is for —
so a build that does not declare it and were sent Talk's field would answer `/plan` by fetching things nobody asked for.

A build that does not declare it is sent **the plain message box** instead, which sends through the same door.
**Plain language is the whole way in there, and everywhere**: the marks are a faster way of saying something, never the
only way, and nothing is out of reach without them.

**Pasting into the bar used to do nothing**, and this change fixes it. The field owns its own words and only ever read
its draft when that draft went **empty**, so the insert card's Paste — which writes the clipboard into the box — never
showed up. Both clients now adopt a draft that changed from outside the field (what the field last wrote is the test,
so its own writes are never re-adopted), and the window puts the caret at the end of what arrived, because you paste
in order to carry on typing after it.

**A literal "@" used to draw as nothing**, and this change fixes it. Both renderers read a prop beginning with "@" as a
key into the bootstrap's copy, and a key they do not have blanks the prop — so `@Mom`, an email address and Talk's own
"@" mark all came out empty. They now read a leading `\@` as the character itself, exactly as `$` is escaped in an
action's text; the kit writes the backslash (`kit.ts atText`). Phone: `Renderer.tsx`, `fill.ts`. Window:
`sdui/theme.js`.

## 9. What is left before the Bots tab could go

The aim is a Talk good enough that the grid is not needed at all. It is not there yet, and these are the things the
grid still does that a thread does not. Each is small on its own; the order is what matters, because the last one is
the only one that is a judgement rather than a build.

1. **A bot's own page is still a page.** Plan Ease's day, a trip, a mailbox, a film, Keylessbord's settings: these are
   places you return to and change, not answers to a message. Talk reaches them through a card, which is the right
   shape for "open the thing"; what it has no way to express is "take me to the thing I was in yesterday". A short
   **recents** row above the box would cover it — the last two or three pages, not a list of every bot.
2. **Making a bot.** `bots.make` is only reachable from the grid's last tile. It wants a "/" row of its own
   (`/new-bot`, beside `/new`), which is a few lines once the commands list is a real list.
3. **A bot that needs you.** Home's `needsCard` and the working state are read off `ctx.live`; Talk shows neither. A
   needs card belongs at the top of the thread, above the turns, and should go there before the grid does — it is the
   one thing the grid says that nothing else says.
4. **Then the judgement.** Watch, for real accounts: how often anyone opens the Bots tab once Talk is first, and
   whether the door's pick is good enough that the people who do open it are not opening it to work around a bad
   route. `pickedBy` and the tab's own use say both. If the grid is still being opened daily, the answer is not to
   delete it but to find out what it is being opened *for* — that thing is what Talk is missing.

Nothing here is blocked. The grid staying costs one tab, and it is the honest place for a bot's own work until the
four above say otherwise.

## 10. Where everything is

| | |
|---|---|
| the two marks, read for nothing | `tulmi/src/botsBots/talkWords.ts` |
| the thread's turns (`by`, `did`, `forName`, `keepDoor`, `wordsOfPicks`) | `tulmi/src/botsBots/chat.ts` |
| the door | `tulmi/src/routes/bots/botsTalk.ts` (registered from `routes/bots/botsBots.ts`) |
| `draw` through the front door to a bot | `tulmi/src/routes/ask/front.ts`, `routes/bots/botsShell.ts` |
| the screen | `tulmi/src/experience/bots/screens/bots/talkDoor.ts` |
| the pills | `tulmi/src/experience/bots/kit.ts` `pillSwitch` |
| the job / pay / waits cards, shared with Ask | `tulmi/src/experience/bots/screens/shell/doorCards.ts` |
| the tabs, Talk first | `tulmi/src/experience/bots/index.ts` `botsNav`, `kit.ts` `TABS` |
| the field | `TAILZU-FRONTEND app/src/sdui/components/{MentionField.tsx,mentionCore.ts}`, `TAILZU-DESKTOP src/app/sdui/mention.js` |
| the capability | `shared/types/sdui.ts` `MENTION_COMMANDS_CAPABILITY`; declared in the clients' `registry.ts` / `sdui/core.js` |
| the sample the render check draws | `tulmi/scripts/bots-render/samples/talk.ts` |

## 11. Tests, and what needs a live check

`tests/talk-door.test.ts`: the two marks (a `/slug` of theirs, a `/word` that is not left alone, the chip winning, the
"@" line last, a name cut down, `/new`); the door (both turns kept with `by` and the drawing, `/plan` routing for
nothing while the thread keeps what was typed, "@Mom" with the name read off their own people and a stranger's id
simply not found, a job-only turn, a refusal keeping nothing, picks going back through the door); the screen (who
answered, the cards in the chat, the pills, the empty thread, an older build's box, the thread that would not read).
`tests/bots-app-boot.test.ts` holds the tab order and the landing; `tests/ai-asks-once.test.ts` the two landing screens
and the one answer. The field: `mentionCore.test.ts` (phone) and `mention.test.js` (window), plus `fill.test.ts` for the
`\@` escape. The render check: `npx tsx scripts/bots-render/render.ts bots.talk --api "$(…samples…)"`.

**Needs a live check** (nothing here can know):

* **Whether the door picks the right bot often enough to carry the whole app.** Talk makes the front door's pick the
  main way anything gets done, and it was previously one way among several. `pickedBy` is written down on every
  decision ([front-door.md](front-door.md) section 9) — read real ones before widening the rollout.
* **What a bot chooses to draw, on real answers in a thread.** `bot_show` now runs on every Talk answer, which is far
  more often than it ran before. Watch the cost (`SHOW_CAP_PAISE` is 40 a turn) and how often it draws nothing.
* **Whether people find "/" and "@" at all**, or only ever type plain language. The empty thread says what they do; if
  nobody uses them, the marks are decoration and the starters are what matter.
* **The thread's length over weeks.** Forty turns are drawn and everything is kept; a year of one conversation has
  never been looked at here.
