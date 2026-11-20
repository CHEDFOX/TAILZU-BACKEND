# The username

Every account has one, from the moment it is made. It is the one name a person is reached by: how someone is added as a friend
and how they are put in a space, in place of knowing their email or passing a code around. It is not the name anyone *sees* —
that is theirs to give, person by person, the way a phone's contacts work.

The rules the server keeps are in `tulmi/src/profile/username.ts`; the routes in `routes/account/profile.ts`; the card that shows
it in `experience/bots/screens/firstRun/aboutCard.ts`. Table and trigger: migration 0110.

| Piece | What it is |
|---|---|
| `profiles.username` | Theirs, lower case. `username_ms` is when it last changed, which paces changes |
| `usernames` | The ledger, and the one place uniqueness is decided: `held` is in use, `reserved` is ours, `freed` is given up |
| `make_username()` | The name a new account is given: a word pair and a number |
| `claim_username(who, want)` | Taking one. The only way a name changes hands |
| `handle_new_user()` | 0003's trigger, now giving a username along with the profile row |

## Given, not asked for

A username is assigned by the database trigger the moment the account row appears, so **no account is ever without one**. That is
what lets adding by username rely on it: there is no "they haven't picked one yet" case to design around, and someone who never
opens the card is still reachable.

The name is a word pair and a three-digit number — `jolly-heron-646`. Never a running number: a count in order would say how many
accounts there are and let anyone walk them. If forty tries all land on taken names it falls back to `x0-` and twelve hex
characters, which cannot loop.

## The card

The About You card (from the 3rd visit, never the first run) shows the username they were given, **editable**, with the gender
chips and Save. A line above it says what it is for.

**Save is always tappable, with or without a gender.** The username is already filled and already valid, so Save is always a
one-tap way past the card. That is what keeps the old promise in `aboutCard.ts` — *the card can never lock the app* — now that
there is no "Not now": there are not two ways out, but there is always one, and nothing is required to take it (App Review
5.1.1(v): an app may not require personal information to work). A Save greyed out until a gender is picked would be a hard gate
on personal information with no way past, and that is the version that gets rejected.

Everyone who tapped "Not now" on the old card set `personality.botsAboutSkipped`, which suppresses it for good. The username card
has its own dueness, so those people see it once; the old flag is left alone.

## A name is never given twice

Changing a username tombstones the old one (`kind = 'freed'`) and it is **never handed to anyone else**. A connection survives a
change, because what is stored is a user id — but a name typed into a message a year ago does not, so a freed name must never come
to mean a different person.

Changes are paced: the first, off the name they were given, is free; after that, one a month (`CHANGE_EVERY_MS`).

## What a look-up gives away

Asking about a username is how a list of everyone would be made, so it is braked the way codes are
(`botsBots/spaceJoin.ts guessing()`): 60 an hour per person, 429 `check_limit` after that.

- `GET /v1/profile/username?u=` answers `{ free }` and nothing else. **Never whose a taken one is.**
- A name that is held, reserved or given up all read the same: taken. Asking never says which, so the ledger cannot be mapped.
- `idFor()` gives an id and nothing else — no name, no picture, no spaces. What the person adding then sees is a decision for the
  screen that asks, not for this module.
- A bad shape is answered from the shape alone and never reaches the database, so a typo costs nothing.

## The routes

```
GET /v1/profile                        -> { ..., username }
GET /v1/profile/username?u=aanya       -> { free, name } | { free: false, why }   (429 check_limit)
PUT /v1/profile/username { username }  -> { username } | 409 taken | 429 too_soon | 422 blocked_content
```

`taken` covers held, ours and given up alike. `blocked_content` is the screen every name a person writes goes through
(`botsBots/filter.ts screenPost`), the same one space names and join-request names pass.

## Before the migration has run

A deploy and a migration are two separate acts, and the code reaches the server FIRST here: pushing to main deploys it, and
`migrate.sh 110` can only run once the file is on main. So that window is real, not theoretical.

Until 0110 has run there is no column and no ledger: reading answers "no username" rather than taking the bootstrap down with
it. Claiming still throws, because a claim that quietly did nothing would be worse than an error.

**And the card does not come at all while there is no username to show** (`due` requires one). Without that it would draw an
empty field, Save would refuse it, and there is no "Not now" behind it any more — the one thing the card must never do. Run the
migration and it appears by itself on the next read; no release, no second deploy.

## Rolling back

The column and the ledger can stay: older server code does not read them, and the trigger only ever adds a row. To go back to
0003's trigger, run its `create or replace function public.handle_new_user()` again — new accounts then get a profile and no
username, which only the username card and adding by username would notice.
