# People: the whole social side

How one person reaches another in X0 Bot, and what they can then do together. This is the design the pieces below are built
against, written down because it was decided across one conversation and the next session cannot read that conversation. Each
part says whether it is **built** or **planned**.

Read `docs/spaces.md` for the space rules as they stand today, and `docs/username.md` for the username itself.

## The shape of it

Three things, kept apart on purpose:

| | What it is | Direction | What it grants |
|---|---|---|---|
| **The username** | the one name a person is reached by | — | nothing; it is how you find someone |
| **A friend** | two people who said yes to each other | both ways | sharing, one to one |
| **A follow** (planned) | you read what someone publishes | one way | the feed, nothing else |

**A friend and a follow are different edges, and they must not be collapsed into one.** Make the feed run on friendship and you
can never follow a bot and can never have a public post. Make friendship fall out of a mutual follow and following someone back
quietly hands them the right to share private things with you — which this codebase gates carefully everywhere else. A mutual
follow may *offer* friendship. It never implies it.

## 1. The username — BUILT

`docs/username.md`, migration 0110, `tulmi/src/profile/username.ts`.

Given by the database trigger the moment the account row appears, so **no account is ever without one** and adding by username
has no "they have not picked one yet" case. The `usernames` ledger is the only place uniqueness is decided. A name given up is
tombstoned and **never handed to anyone else**: a connection survives a change because it stores a user id, but a name typed
into a message a year ago does not.

A look-up says only that a name is taken, never which of held, ours or given up, and is braked at 60 an hour, because asking
repeatedly is how a list of everyone would be made.

## 2. The name you give someone — BUILT

**A username is for reaching someone. It is never what you see.** What you see is the name *you* gave them, the way a phone's
contacts work: you add `@aanya-r` and you call her Mom.

So a name is per reader: `person_names(owner_id, subject_id, name)`, resolved at read time. Migration 0111,
`tulmi/src/botsBots/personNames.ts`.

```
PUT /v1/botsapp/bots/people/:id/name { name }   -> { name }   an empty name takes it off again
GET /v1/botsapp/bots/people/names               -> { names: [{ userId, name, at }] }
```

`known(viewer)` reads every name a person gave **in one go**, and `shownName(known, id, fallback)` applies it per row — the same
shape as `looksKnown` / `shownLook`, so a list of twenty people costs one read, not twenty.

Where it reaches: a space's members, the people you can message and the groups you can start one in (`contacts`), a one-to-one
chat's own name (that name **is** the other person), every member of a thread, the name over every message, "To Mom" under one,
and the chats list's own last line.

**That last one needed a column.** `threads.last_text` is stored as `"Mom: Dinner at 8?"` — the sender's name baked in when it
was written — so without `threads.last_by` (0111) a chats list would show a row titled "Amma" over a line still reading "Mom:".
The stored text is never rewritten, so an older build reads it exactly as before; the server swaps the part before the first
`": "` for the reader's own name, and only when it has one.

A name is screened like every other name a person writes (`filter.ts`), bounded to 40 as the rows' own names are, nobody can
name themselves (the table refuses it too), and one person may name 2,000 people — a bound, so this cannot become somewhere to
keep notes on everybody.

**The trap.** Names are denormalised onto rows today — `space_members.name`, `thread_members.name`,
`thread_messages.sender_name` — because there is one name per person. `sender_name` is load-bearing for a **deleted account**:
`docs/spaces.md` says a deleted account takes its `thread_members` row with it, so `viewOf` reads the name back off that
person's own messages. So:

- `sender_name` is still written exactly as before, and is the fallback
- the reader's own name resolves on top, never instead
- `subject_id` cascades, so a deleted account takes these names with it and the fallback takes over by itself — which is why
  `gone` handling needed no change at all, and `spaces-gone.test.ts` passes untouched

`personLook.ts` is unaffected: a look is hashed from the user id, never the name.

## 3. Adding someone — BUILT

Migration 0113; `botsBots/spaceJoin.ts` (inviteByName, addPerson, people), `botsBots/spaces.ts` (inviteAccount, makePair, pairs),
`routes/bots/botsSpaces.ts` (`POST .../spaces/people`; the invite routes take a username in `email`), Spaces' start screen
(`screens/spaces/start.ts`: the + at the top right, "Add a person" in his thought, Your people). Tests: `tests/spaces-username.test.ts`.

**Found as they type** (`GET .../people/search?q=`, `botsBots/spaceJoin.ts` search, `profile/username.ts` namesStarting): the usernames
that start with what was typed, from three letters, five at most, each as its username and its tiny bot only (no name, no picture, no
email, no id). Never the person asking, never anyone with a block either way. Braked on its own, 240 an hour a person, since a
keystroke is a search; the 60-an-hour brake on look-ups by a whole name is untouched. This trades a little of "a look-up says only yes
or no" for finding someone without knowing their exact name: a prefix walk is possible, but only at the brake's pace.


**By username**, which is the point of having one. The existing paths keep their own jobs:

| Way in | For |
|---|---|
| **Username** | anyone already on the app. The common case |
| **Email invite** | someone not on the app yet. The only cold-start path there is, so it stays |
| **A space's code** | a link in a group chat that gets eight people in at once. Adding by username is one at a time |

A friendship is **a two-person space**, hidden from the spaces list. That is what makes it cheap: grants, the feed, the chat,
blocks, moderation and looks all keep working with no new rule set and no schema churn (`space_grants.space_id` is `not null`,
and so is `space_work_notes`'s). "Make a group with them" stays an ordinary space.

Every way in ends at the same request-and-accept, exactly as a code and an email invite both end at `addMember()` today.

## 4. Groups: no automatic access — BUILT

**The admin has no automatic sight of anyone's things.** This deletes, rather than adds:

- `ADMIN_LINE`, `CONSENT_VERSION`, `consent_ms`, `consent_v`, `hasConsent` — stop being read (columns stay, as
  `space_roles` and the old perms columns did)
- the feed's **403 `consent_needed`** gate: a member can simply write
- the admin's "all their things" in Work in space
- the admin sharing a member's thing — and with it the part that was hardest to defend, that **the owner was never told**
- `to_id`'s "and the space's admin" clause. Narrowing visibility is safe; the admin just stops seeing old private messages

**Three things ride on the same line and must change with it**, or the product claims something false:

- the **meeting bot** (`docs/meet.md`, "In a space"): the admin sees members' meetings and can send the bot into one for them
- the **mail bot** (`docs/mail.md`, "In a space"): the admin has a member's business mail in full, read and write
- **existing grants** the admin made of members' things (`space_grants.by_id is not null`): revoked by migration 0112, with
  their cards and with the work notes nothing else reached, since nothing in the app would explain that access any more

The Oracle was already the model for where all of these land: *"no admin ever sees a member's chart or readings."*

This also makes the two-person space clean. A pair would have needed special-casing to stop one friend being the other's admin;
with no space having automatic access, a pair is just a space with two people in it.

## 5. What "@" means — PLANNED

It depends where you are, and that is the whole rule:

- **In a group conversation**, `@aanya` **mentions and pings** her. The message still goes to everyone.
- **Anywhere else** — sharing a thing, a share sheet, a general place — `@` sends it **to that person alone**.

Matching takes **either the username or the name you gave them**, scoped to that group's members, so a username can never pull a
stranger into a thread.

The composer already exists: `MentionField` (TAILZU-FRONTEND `app/src/sdui/components/MentionField.tsx`) turns `@name` into a
chip and opens a list when two people match.

**What this displaces.** `@` is today the *private routing* mechanism in a space feed: a picked person becomes `to_id`, seen
only by the sender, that person and the admin. Under this rule nothing writes `to_id` any more, and one to one goes where it
belongs — the direct chat (`threads.kind = "direct"`), which already exists.

> **The rule that must not be broken:** nothing new writes `to_id`, but **every reader keeps applying its visibility rule**
> (`Threads.sees`). Those messages were sent privately. Stop applying it and every private message ever sent in a space becomes
> visible to its whole group, retroactively.

What gets simpler: the `confirm` flow ("Send this to Mom only?") goes. It exists only because a voice note or `@`-prefixed text
could *accidentally* go to one person; once `@` cannot route privately there is nothing to guard.

On the wire, **`mentions: string[]`**, not a reused `to`: a field whose meaning changes with where you are is where this kind of
bug lives, and an array lets `@aanya @rohan` work, which `to_id` never could. The push is `space_mention` (the `space_*` prefix
the switch gates on), and unlike `space_feed` it may carry the words, because the message is public to the group anyway.

## 6. Sharing: one action, on every little thing — PLANNED

There are **two share mechanisms today**, with different taxonomies, and a Share button on everything has to route between them:

| | `grants.ts` → `space_grants` | `shared.ts` → `space_items` |
|---|---|---|
| Shares | live access to the owner's real thing | a **copy**: title, text, url, items |
| Keyed by | `(bot, item_id)` | its own `kind` |
| Kinds | `plan`, `notes`, `travel`, `code` | `list trip plan note file link answer preview text` |
| Revocable | yes, access ends at once | it is a copy; nothing to revoke |

Both keep a job. The front door routes by what the thing is:

- **belongs to a bot and has an id** → a grant. It stays the owner's, it is live, it can be taken back
- **loose** (a link, a file, a bot's answer, a bit of text) → a copy

**The blocker to fix first.** `space_grants.bot` is a database CHECK (`check (bot in ('plan','notes','travel','code'))`) and
`SHARE_BOTS` is a closed tuple, so **every new shareable bot needs a migration**. For Share to be on every little thing that
becomes an open text column with a length bound plus a server-side registry: a bot gets Share by registering a `ShareSource`
(that interface already exists — `list(userId) → OwnItem[]`), not by anyone editing the share code.

Targets become `{ space } | { person } | { username }`, with people first-class rather than derived from a shared space.

**Access keeps today's rule**, which is already right: shared with one person **by name** → they can change it; shared with
everyone → open it and add a note, nothing more.

### Where a shared thing shows up

In the chat, as it does now, and in the bot's own list under its owner — not in a separate tab:

```
Xode
  My projects
  @aanya
    her project
```

With no automatic admin access, the only things in someone else's section are what they **explicitly shared with you**, so
`docs/spaces.md`'s four-row permission table collapses to two: mine, and what each person gave me. "Work in space" stops being
a tab and `work.ts` mostly shrinks.

## 7. The feed — PLANNED, and not designed yet

A place for people **and bots** to publish. Three decisions are cheap now and expensive later, so they are settled here even
though nothing is built:

1. **The author is a principal, not a user**: `author_kind ('user' | 'bot')` + `author_id`. Never
   `author_id uuid references auth.users`. Bots already have names and looks in `shared/bots/looks.json`.
2. **Audience is a field on the post**, not a separate system: `public | followers | friends | space:<id>`. One publish path
   then serves all of them, and a friends-only post costs nothing extra.
3. **A follow may point at a bot.** That is most of why it cannot be the same edge as friendship.

**Naming:** "feed" already means two things in this repo — a space's own feed (`spaceFeed.ts`) and Discover. Pick a third word
before building, or every doc after this is ambiguous.

**Discover is not this.** `discover_cards` are per-person cards the Travel bot builds for a place (`owner_id` on every read),
plus a hand-reviewed catalogue in `catalog.ts` that ships like code. No authors, no graph, no publishing.

## The order to build in

1. ~~`person_names`~~ — **done** (migration 0111)
2. ~~no automatic admin access~~ — **done** (migration 0112; the meeting bot, the mail bot and `to_id`'s admin clause with it)
3. `@` mentions
4. the share registry, and shared things in each bot's list
5. ~~adding by username, and the two-person space~~ — **done** (migration 0113)
6. the feed, once it is designed

## Things that must stay true

- A **username is never given twice**, even once it is freed.
- **`to_id`'s visibility rule keeps being applied**, forever, however `@` behaves.
- A **look-up never says who** — only whether a name is free.
- **Nothing is required of anyone to use the app**: the username card has no "Not now" and still cannot lock Home, because Save
  is always tappable (App Review 5.1.1(v); `docs/username.md`).
- **The owner is told**, always. Nothing is shared out of someone's account without it being theirs to see and to stop.
