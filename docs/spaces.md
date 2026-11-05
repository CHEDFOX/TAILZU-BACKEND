# Spaces

A space is family or friends in X0 Bot: its people, one feed, the things they share from their bots, payment requests, tasks and
plans for each other, and what the group tells its bots. This file is the rules the server keeps. The screens are in
`tulmi/src/experience/bots/screens/spaces/` (docs/bots-app.md); the data and rules in `tulmi/src/botsBots/`; the routes in
`tulmi/src/routes/bots/botsSpaces.ts` and `routes/bots/work.ts`. Tables: migrations 0042, 0051, 0057, 0063, 0064 and 0068.

| File | What it is |
|---|---|
| `spaces.ts` | Spaces, members, invites by email, the space's code, drafts, consent, leaving; `access()` and `need()`, every other module's one question |
| `spacePerms.ts` | What a member may do (`MEMBER_PERMS`) and what only the admin may do (`ADMIN_ONLY`) |
| `spaceJoin.ts` | Invitations waiting for an address, codes, join requests and the admin's decision |
| `spaceFeed.ts` | The feed: a message to everyone or to one person, a thing shared with "/", the question asked about a name at the start |
| `threads.ts` | The chats underneath (the feed is the space's own chat), and the one visibility rule every reader applies |
| `grants.ts` | One thing shared from a bot, with one person or everyone |
| `work.ts` | Work in space on the four bots' pages: who may see and work on what |
| `spaceShares.ts` | The old per-bot sharing (everything or picked items), read only |
| `shared.ts`, `payments.ts`, `spaceTasks.ts`, `spaceMemory.ts` | Shared things, payment requests, tasks and plans, group memory |
| `safety.ts`, `blocks.ts`, `filter.ts` | Reports, blocks, and the screen on everything posted |

## The admin, and no roles

- The admin is the space's maker (`spaces.owner_id`), for good. It can't be handed over, and the admin leaving deletes the space.
- There are no roles. Every member may do the same things (`MEMBER_PERMS`): message, share, use the group's bots, give tasks and
  plans, ask for money, approve someone else's request, start groups, see the activity, use group memory.
- Only the admin (`ADMIN_ONLY`): invite by email, see the space's code and make a new one, let people in, remove people, rename,
  delete, take back invites, forget anyone's group memory line, take out anyone's task.
- The old perms columns and `space_roles` stay in the database for a rollback; nothing reads them. New member rows still write
  `perms: MEMBER_PERMS`, `role: null`, `can_approve: true`.
- Old builds' role routes (`PUT /spaces/:id/members/:member`, `/spaces/:id/roles...`) answer 410 `gone`.

## Coming in

- **One code per space** (`spaces.join_code`, 6 letters and digits, shown `7KQ-29D`), made the first time it is asked for: by the
  space's detail (the admin only), by an invite mail, or by an old build's link invite. Never by a list. The admin can make a new one
  (`POST /spaces/:id/code`); the old one stops working at once.
- **An email invite** (the admin's) is a row in `space_invites` with that address, seven days, good once. Its mail carries the space's
  code and the line "The space's admin can see your work and messages there." Up to 30 invite mails a day per admin, counted in
  `mail_outbox` by `sent_by`: those rows stay when a draft or a space is deleted, so deleting one never starts the count again.
- **An invitation** is an email invite waiting for the person who signs in with that address: only once the address is confirmed
  (`AuthedUser.emailConfirmed`), only when the space's admin made it (an invite a member made under the old roles is not one), only
  for a named space they aren't in, and not when they have a block with the admin. Accept joins at once; Dismiss hides it.
- **A code** typed or linked: the invited address joins at once, as if it tapped Accept. Anyone else only asks to join: the admin
  sees their name and accepts or dismisses (pushed as `space_request`; the person let in hears `space_accepted`). Both sides update
  live. After a dismissal the same person waits 7 days to ask that space again (409 `asked_recently`); nobody asks more than 10
  times a day (429 `request_limit`). A block with the admin answers like a bad code, and a block made after asking means the admin's
  Accept answers 404. A space that is full keeps the request open. The name the admin reads comes from the account; one the screen
  flags is shown as "Someone" rather than refused.
- **Guessing codes.** A space's own code is 6 characters and never expires, so a code alone never says whose space it is: asking
  answers `{ status: "requested" }` with no name, the person's waiting line shows the code they typed (`space_join_requests.code`),
  and `GET /spaces/join/:code` names only an email invite's own code (8 characters, seven days). After 20 codes that didn't work in a
  day, every code answers 429 `code_limit` until the day is over, a good one too (kept in the server's memory, as its other brakes
  are).
- **Drafts.** Create on the new Spaces screen makes a draft (`draft_ms`, `named = false`) at the first invite, so the invites go at
  once; their mails say "their space" until it is named. Nobody else sees a draft: no list has it, its invitations wait until it is
  named, its code answers 409 `not_ready`. Done names it; Back deletes it, takes its invites back and stops their mail. A draft left
  a day is deleted the next time its maker opens Spaces or starts another (never by a list).
- **The browser page** for a code (no session) never looks a space's code up: every code of that shape gets the same page (and a
  phone the same store), so the page can't tell a guess that works from one that doesn't. An email invite's own code still names
  its space.

## The line about the admin

- `space_members.consent_ms` is set when someone joins through a screen that showed "The space's admin can see your work and
  messages there." (the body says `consent: true`), or when they tap OK on the card in the feed.
- Until then: the feed answers 403 `consent_needed` to anything they post or share, and the admin sees only what they share.
  Members from before, and anyone who joined from an old build, see the card once.

## The feed

- The feed is the space's own chat (`threads`, kind `space`), so old builds read the same thread.
- **A message to one person** (`thread_messages.to_id`, no foreign key on purpose: "on delete set null" would make it everyone's)
  is seen by its sender, that person and the space's admin. Every reader applies that one rule (`Threads.sees`): a page, old builds'
  chat, the widget's words, a report, a file, unread counts, live events and pushes.
  - The person it is to is pinged (`space_feed`, never with the words); the admin sees it unannounced, and it counts as unread for
    them too (it is their feed as well).
  - A space's feed pushes `space_feed` (it opens the space), never `space_message` (the old chat, with a Reply button): a reply from
    a notification would go to everyone, even when it answers a message to one person. A push can't tell an old build from a new
    one, so an old build's tap opens its old space page too, with no Reply button.
  - A chat's last line (`last_text`) is only ever a message to everyone, and lists show its time (`last_public_ms`), so a message to
    one person never moves anyone else's chat.
  - Old builds show "To Rohan" under it (`MessageView.to`).
  - A block either way refuses it (403 `blocked`); someone not in the space is 404.
- **A name at the start** is never trusted blind. A voice message, or typed text starting with "@", whose first word is the first
  name of someone there and that has no person picked, is not posted: the answer is `confirm`, "Send this to Mom only?" (or, when two
  people share the name, a line saying so, with Everyone and Cancel). Punctuation around the word doesn't count ("Mom," is mom). A
  word that is nobody's name is just text, for everyone. Everyone sends again with `everyone: true`, and the question isn't asked
  again.
- Empty means none: `to: ""` is everyone, a thing with an empty bot or id is no thing. Nothing at all is 400.

## Sharing one thing ("/")

- One of the sender's own items from Plan Ease, Notes, Travel bot or Xode (its bot must list it), given to one person or to
  everyone: a grant (`space_grants`) and a card in the feed (`item.kind = "grant"`), seen as any message is.
- It reaches the person (or everyone) while both are in the space with no block between them. Leaving takes away what you gave and
  what you were given; the space going takes all of it. Moderation taking the card out (a report upheld) takes the grant with it.
- A share to everyone reaches whoever is in the space, later joiners too (they read the same feed), so it is a look and a note: only
  a share to one person by name lets them change a plan's time.
- **Stop sharing** (`DELETE /spaces/:id/grants/:gid`): the one who shared it, or the space's admin. The access goes at once and the
  card leaves the feed for everyone. It is on the card in the feed, and on the owner's own page for the thing ("Shared with").

## Work in space

On each of the four bots' pages, "Work in space" lists the people whose things you may open there. Who may, for anyone but the
owner, needs a space both are in now (not a draft), with no block between them; anything else is the same 404 as a thing that
isn't there.

| Who | What | Change time (plan events) | Add a note |
|---|---|---|---|
| The owner | everything of theirs | yes | yes |
| The admin, for a member who saw the line about the admin | all their things in that bot | yes | yes |
| Someone a grant reaches | that one thing | yes, when it was shared with them by name; no for a share to everyone | yes |
| Someone the owner shares the bot with the old way | everything shared, or what was picked: title, line and time only | no | yes |

- Someone else's plan event moves on the owner's own calendar, with their id; a plan someone else set (`fixed`) never moves.
  Xode's projects are read only for everyone but their owner.
- What someone did on another person's thing is a note on that thing (`space_work_notes`): its owner sees every space's; anyone
  else sees the notes added through the space they came by, except a note added through a share to one person (`only_owner`),
  which only the owner, its writer and the space's admin read. So two people the owner shared the same thing with separately never
  read each other's notes, or learn the other has it. Never the space's activity, which every member reads.
- Opening your own thing with a space you aren't in says no space's name.
- The bot page shows both tabs to anyone in a space, with a line where nobody has shared anything yet.
- The bot page's list (`GET /work/:bot`) never reads anyone's bot: people and counts come from grants, shares and member rows. Only
  `GET /work/:bot/person` lists another person's things.

## Group memory and the group's bots

Plan Ease, Notes, Travel bot and Xode are every group's bots: they read what is shared in each of the person's spaces and what
the group told its bots, with no adding step. Any other bot reads a space only once it is added to it.

## Lists stay cheap

`GET /spaces` is read at every Home load and at both apps' launch, so it only reads, as it always did. The new Spaces screen asks
`GET /spaces?full=1` for each space's last line, unread count and open invites, and the person's invitations, requests, asks and
draft. Drafts are in no list anyone sees (`Spaces.mine` and `list` skip them).

## Rolling back

The new columns stay, so older server code still runs, but it knows nothing of `to_id` or `draft_ms`. Before running older server
code on this database:

- hide the messages to one person, or it shows each to the whole space: `delete from public.thread_messages where to_id is not null;`
- delete the drafts, or each shows to its maker as a real space named "New space" (its invites go with it):
  `delete from public.spaces where draft_ms is not null;`

Grants, requests, work notes and `mail_outbox.sent_by` are ignored by older code.
