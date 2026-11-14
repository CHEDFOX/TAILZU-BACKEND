# Location, contacts and health: what the server's half does

Three things the phone can do that the server cannot, each behind one tap, each off until its own switch is turned on. The
whole design, with the store forms and the native work, is in the perms SPEC; this is the server's half, so the next person to
touch one of these files can see at a glance what holds it together.

| | the person does | the permission | what reaches this server |
|---|---|---|---|
| **Use my location** | taps *Use my location* on Plan Ease's "Where does your day start?" card | location **while using**, approximate | the **area's name** ("HSR Layout, Bengaluru"), after they read it and tap Save. **Never a coordinate** |
| **Add from contacts** | taps *Add from contacts* on a space's Invite page, or on Spaces' start screen | **none** — the phone's own picker | the **one email** they tapped, when they tap *Send the invite*, exactly as a typed one |
| **Count my workouts** | turns on the row on a fitness bot they made | health: **read** daily steps and workouts | `{day, steps, workouts:[{kind,minutes}]}` for that one bot |

## The six rules this code keeps

1. **No dark declarations.** Every usage string and Android permission in the binary has a working screen in the same binary.
   `tests/perm-words.test.ts` fails if `app.config.ts` grows a key (Contacts, Always location, motion, Health write) that no
   screen here uses, and `tools/media/store/check-listing.mjs` (in the phone repo) fails if the store documents still say a
   thing is "not collected" while the build has it.
2. **One card before every system prompt, Continue and no second choice** (App Review 5.1.1(iv)). The cards use `permitStep`
   with a `cta` and no `quiet`; the way out is not tapping. The contact picker has **no** card: there is no prompt to
   introduce. Words: `src/experience/bots/screens/permitWords.ts`.
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
   all ship off (`src/config.ts`). A server deployed before the store build draws nothing and stores nothing.

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

## Turning them on

All five switches ship off. The order, and the account lists, are in the owner's checklist (the perms OWNER file). The Android
list exists for one reason: between the first Health Connect build and Google's own approved list reaching Health Connect
(5-7 working days after approval), Play's reviewer must still be able to reach the row the declaration is for, and nobody else
should. Seed that account's space and bot with `npx tsx scripts/seed-review-account.ts <account id>`.
