# Spaces

A space is family or friends in X0 Bot: its people, one feed, the things they share from their bots, payment requests, tasks and
plans for each other, and what the group tells its bots. This file is the rules the server keeps. The screens are in
`tulmi/src/experience/bots/screens/spaces/` (docs/bots-app.md); the data and rules in `tulmi/src/botsBots/`; the routes in
`tulmi/src/routes/bots/botsSpaces.ts` and `routes/bots/work.ts`. Tables: migrations 0042, 0051, 0057, 0063, 0064, 0068 and 0069.

| File | What it is |
|---|---|
| `spaces.ts` | Spaces, members, invites by email, the space's code, drafts, consent, leaving; `access()` and `need()`, every other module's one question |
| `spacePerms.ts` | What a member may do (`MEMBER_PERMS`) and what only the admin may do (`ADMIN_ONLY`); the line about the admin (`ADMIN_LINE`, `CONSENT_VERSION`, `hasConsent`) |
| `spaceJoin.ts` | Invitations waiting for an address, codes, join requests and the admin's decision |
| `spaceFeed.ts` | The feed: a message to everyone or to one person, a thing shared with "/", the question asked about a name at the start |
| `threads.ts` | The chats underneath (the feed is the space's own chat), and the one visibility rule every reader applies |
| `grants.ts` | One thing shared from a bot, with one person or everyone, by its owner or by the space's admin |
| `work.ts` | Work in space on the four bots' pages: who may see and work on what |
| `spaceShares.ts` | The old per-bot sharing (everything or picked items), read only |
| `shared.ts`, `payments.ts`, `spaceTasks.ts`, `spaceMemory.ts` | Shared things, payment requests, tasks and plans, group memory |
| `safety.ts`, `blocks.ts`, `filter.ts` | Reports, blocks, and the screen on everything posted |
| `personLook.ts` | How a person looks: their own tiny bot (an avatar from the catalog and a group colour), never initials |
| `spacesSwitch.ts` | The switch (`SPACES_ENABLED`): whether Spaces shows at all ("Turning Spaces off") |
| `planAsks.ts` | Plan Ease's family asks, repeats and turns: tasks of kind "ask" (migration 0074). An open one is in nobody's list and on nobody's day; once taken it is that person's task like any other. See `plan-ease-people.md` |

## Turning Spaces off

Spaces is hidden until it is ready, with one server setting, `SPACES_ENABLED` (`config.ts`): off unless it is set to `true` (the tests
run with it on). Nothing is deleted or changed while it is off: turning it on brings back every space, message, share, task and invite
as it was.

On the server, from the repo (DEPLOY.md has the ssh line):

```bash
./deploy/set-env.sh SPACES_ENABLED=true && ./deploy/ship.sh    # on
./deploy/set-env.sh SPACES_ENABLED=false && ./deploy/ship.sh   # off again
./deploy/set-env.sh --show SPACES_ENABLED                      # which it is now
```

`set-env.sh` writes the line in `tulmi/.env`; `ship.sh` rebuilds so the server reads it. Every build, old or new, follows the server
the next time it reads a page: no app update is needed.

While it is off (`botsBots/spacesSwitch.ts`):

- **The routes.** Every Spaces route (`routes/bots/botsSpaces.ts`: spaces, invites, the invite page under `/v1`, sharing, shared
  things, payments, tasks, chats) and every Work in space route (`routes/bots/work.ts`) answers 404 `{ code: "spaces_off" }` before
  the session, as does sharing a line from Your space with a group. Reporting and blocking stay on. The browser's page for an invite
  link (`/s/bots.spaces?join=`) still answers, saying the invite doesn't work, and names no space.
- **The screens** (kit `hasSpaces`). A link, a widget row or a notification into any of Spaces' screens (`bots.spaces`, every
  `bots.space.*`, `bots.share`, `bots.work`, `bots.chats`, `bots.thread`, `bots.person`) opens Home. Home has no Space card and no
  group tiles. You, Settings and Blocked people have no "Spaces and chats". The bots' pages have no Work in space tab and no notes from
  a space. A thing's Share, a bot's answer's Share and "Share with a space or person" are gone. The bootstrap doesn't warm Spaces' pages
  and the Home Screen's long press has no Spaces.
- **What reaches people.** No push of Spaces goes (every `space_*` kind: `push/engine.ts`). Invite mails wait in the outbox, looked at
  again each hour, and go once it is on. The widgets have no From your people. The bots read nothing a space shared or told them, so
  Ask never brings a space into an answer. What a space gave someone is kept on their days but not shown or reminded of.
- **For new work.** Anything new that is Spaces' asks `spacesOn()` first, or a screen asks `hasSpaces(ctx)`: a new route takes
  `onRequest: spacesGate`, a new push kind starts with `space_`, and a family ask from Home's Ask or Plan Ease's box is never offered
  while it is off.

## The admin, and no roles

- The admin is the space's maker (`spaces.owner_id`), for good. It can't be handed over, and the admin leaving deletes the space.
- There are no roles. Every member may do the same things (`MEMBER_PERMS`): message, share, use the group's bots, give tasks and
  plans, ask for money, approve someone else's request, start groups, see the activity, use group memory.
- Only the admin (`ADMIN_ONLY`): invite by email, see the space's code and make a new one, let people in, remove people, rename,
  delete, take back invites, forget anyone's group memory line, take out anyone's task. And, outside the perms: share any member's
  thing with someone there, and stop any share ("Sharing one thing").
- The old perms columns and `space_roles` stay in the database for a rollback; nothing reads them. New member rows still write
  `perms: MEMBER_PERMS`, `role: null`, `can_approve: true`.
- Old builds' role routes (`PUT /spaces/:id/members/:member`, `/spaces/:id/roles...`) answer 410 `gone`.

## Coming in

- **One code per space** (`spaces.join_code`, 6 letters and digits, shown `7KQ-29D`), made the first time it is asked for: by the
  space's detail (the admin only), by an invite mail, or by an old build's link invite. Never by a list. The admin can make a new one
  (`POST /spaces/:id/code`); the old one stops working at once.
- **An email invite** (the admin's) is a row in `space_invites` with that address, seven days, good once. Its mail carries the space's
  code and the line "The space's admin can see and share your work and messages there." Up to 30 invite mails a day per admin, counted in
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

- The line is `ADMIN_LINE` (`spacePerms.ts`): "The space's admin can see and share your work and messages here." ("there" on an
  invitation, in the bot's thought, and in the invite mail). It says up front that the admin may share their things, because the owner
  is not told of each share.
- `space_members.consent_ms` and `consent_v` (0069) are set when someone joins through a screen that showed it (the body says
  `consent: true, consentV: 2`), or when they tap OK on the card in the feed (`PUT /spaces/:id/consent { consentV: 2 }`). The
  version is the one the screen showed (`spacePerms.ts lineShown`): a yes without it came from a screen drawn before the line
  changed (still open, or kept by the app), so it counts as version 1 and they are asked once more. A join request keeps the version
  its screen showed (`space_join_requests.consent_v`), and the admin's Accept carries it over.
- It counts only at `CONSENT_VERSION` (2, "can see and share"; `hasConsent`). Someone who agreed to version 1 ("can see"; no
  `consent_v`) is asked once more with the new line, in the feed, before they can write.
- Until they agree: the feed answers 403 `consent_needed` to anything they post or share, the admin sees only what they share (not
  "All their plans" in Work in space, nothing of theirs in "/"), and nothing of theirs can be shared by the admin. Members from before,
  and anyone who joined from an old build, see the card once.

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
  everyone: a grant (`space_grants`) and a card in the feed (`item.kind = "grant"`), seen as any message is. The same thing to the
  same person by the same sharer twice is one grant.
- **The admin shares any member's thing** the same way. The admin's "/" asks `GET /work/:bot/mine?space=&tz=`: the admin's own things,
  then each member's who agreed to the line as it is now (oldest member first, nobody with a block with the admin), at most 50 each.
  Each id is `of:<owner>:<item>` (`work.ts ofMember`) and each line says whose ("Mom's · Sat 14 Nov · 7:40 pm"), so the apps' list
  and box send it back unchanged and needed no update. Anyone else asking with a space gets their own, as without it.
  - The owner must be in the space now and have agreed to the new line (else 403 `not_allowed`, "Mom hasn't agreed yet that Home's
    admin can share their things."); a block between the owner and the admin is the same 404 as a thing that isn't there; one between
    the owner and the person it is for is 403 `blocked`; the owner as the one it is for is 400. A member naming someone else's thing,
    by either id, is told it isn't there (404).
  - The grant gives exactly what the owner's own share would, and keeps whose it is (`owner_id`) and who shared it (`by_id`, 0069).
    The admin's share and the owner's own of the same thing are two grants, each stopped by whoever may stop it. A block made later,
    between the admin and the owner, ends what the admin shared of theirs; and a share the admin made never reaches someone with a
    block between them and the admin (they don't see its card either), as an owner's share never reaches someone with a block with
    the owner.
  - The card says whose it is: `thing.ownerName` ("Aanya shared Mom's Doctor, knee check-up from Plan Ease", Open in Plan Ease).
  - **The owner is not told.** The card is never theirs to see (`Threads.sees`): no card in their feed, no push, no unread, no live
    event; nor for anyone with a block with them. It is never a chat's last line, so no list, widget or Home card says it. It is not
    on their page for the thing ("Shared with" lists only what they shared themselves). The line they agreed to says the admin may.
- It reaches the person (or everyone) while both are in the space with no block between them. Leaving takes away what you gave and
  what you were given; the space going takes all of it. Moderation taking the card out (a report upheld) takes the grant with it.
- A share to everyone reaches whoever is in the space, later joiners too (they read the same feed), so it is a look and a note: only
  a share to one person by name lets them change a plan's time.
- **Stop sharing** (`DELETE /spaces/:id/grants/:gid`): the admin stops any share; a member only one they made of their own thing.
  So a share the admin made is the admin's alone to stop: its owner is refused (403, "Only the space's admin can stop sharing this.")
  like anyone else. The access goes at once and the card leaves the feed for everyone. It is on the card in the feed (for its sharer
  and the admin), and on the owner's own page for what they shared themselves ("Shared with").

## Work in space

On each of the four bots' pages, "Work in space" lists the people whose things you may open there. Who may, for anyone but the
owner, needs a space both are in now (not a draft), with no block between them; anything else is the same 404 as a thing that
isn't there.

| Who | What | Change time (plan events) | Add a note |
|---|---|---|---|
| The owner | everything of theirs | yes | yes |
| The admin, for a member who agreed to the line about the admin as it is now | all their things in that bot | yes | yes |
| Someone a grant reaches (the owner's, or the admin's of the owner's thing) | that one thing | yes, when it was shared with them by name; no for a share to everyone | yes |
| Someone the owner shares the bot with the old way | everything shared, or what was picked: title, line and time only | no | yes |

- A thing the admin shared of a member's is found under its owner ("Mom"), its line "1 plan · Shared by Aanya" (or "3 plans shared
  with you · 1 by Aanya"), each such thing "Shared by Aanya" (`sharedBy` on the person's items and on the thing), and its foot says
  the admin shared it. Where the owner shared it too, it is the owner's.
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

## How people look

No initials anywhere: not in a space's people, the "@" list, an invitation, a request to join, the spaces list, Work in space on the
bots' pages, the share page or someone's page. A person is their own tiny bot (sdui 3j `PersonBot`): a full bot standing in a square
box, drawn by the bots' engine, idling (a blink, a small sway, now and then a small gesture, staggered by `seed`); Reduce Motion, a
still pose. A build without `PersonBot` gets a plain circle in the person's colour, with no letter.

- **The server picks the look** (`personLook.ts`): an avatar from `pip dot bolt sage scout dapper nova` (only those the looks catalog
  has; one it drops is skipped, so nobody else's changes) and a colour from the group palette `#5B7DB1 #B5654A #6B8E4E #8A6BB1
  #B18A3D`, both from a hash of the person's id (FNV-1a), so the same id looks the same everywhere.
- **Unique in a space where it can be.** The members, oldest first, each keep their own look unless someone before them has it; a
  clash goes to the one who joined later, who takes the next avatar and the next colour nobody there has yet. Avatar and colour are
  picked apart: up to five people all have their own colour, up to seven their own avatar. Looks are worked out from every member,
  before anyone is hidden from the viewer, so Mom is the same bot to everyone in the space.
- **The viewer is their own X0 bot**: ink `#0a0a0a`, the `blip` look.
- Where it is carried: each member (`bot`) in `GET /spaces` and `GET /spaces/:id`, the feed's `people`, Work in space's people and
  notes (`bot`, `byBot`), an invitation (`byBot`: the admin who sent it, as that space has them), a request (`bot`: the one asking, as
  they would be once let in), `threads/contacts` and `share/targets` (`bot`: as the first space you share has them), someone's page
  (`bot`), a one to one chat's two people (`threads` and a thread's `thread.people[].bot`). An address called in by email has no
  account yet: its bot is by the address. The screens fall back to the id's own look when an answer has none.
- **Outside a space** (a one to one chat, the contacts, the share page's people, someone's page) a person is the bot they are in the
  first space you share with them (`Threads.looksKnown`: your spaces oldest first, whatever each lets you do), so Mom in your chats is
  the Mom of your Home.
- The "@" list's people carry `bot: { seed, avatar, color }` (only to a build that declares `PersonBot`), and both apps draw the bot
  in the person's row.
- A spaces-list row shows up to three of its people's bots side by side, a little over each other (the others first, then you), and
  "+N" for the rest. A bot fills well under half his box, so the boxes overlap by 0.55 of their side (circles, without `PersonBot`,
  by 0.22) and the bots just touch; the list sets them in a column as wide as three and "+N" (`facesWidth`), so the names line up.

## How the feed looks

- **No faces.** Each of someone else's messages has their name over it (Geist SemiBold 12/16, `#8a8a8a`; every one, not only the
  first of a run: with no faces, the name is what says who), set in 12 to sit over the words; your own have none. "To Mom" over a
  message to one person stays, in the same small grey.
- **No box at all** (`feed.ts` `lined`). Someone else's message sits on the left with a 2 px solid line down its left side in that
  person's own colour (their tiny bot's, `personLook.ts`; the answer's `people[].bot`, else their id's own), 10 between the line and
  the words; yours on the right, with a 2 px ink (`#0a0a0a`) line down its right side, 10 from the words. No ground, no edge round
  it, no radius. 12 between messages. The time (and Report, under theirs) is set in under it the same way.
- **A shared thing has no box either**: by the same line as its message, in the sharer's colour, it is words ("Aanya shared Mom's",
  its title 15/600, "from Plan Ease · its line"), with "Open in Plan Ease" (and Stop sharing, for its sharer and the admin) as plain
  link buttons. A file and a shared item sit by the line with no ground too.
- The lines are `borderLeftWidth`/`borderLeftColor` and `borderRightWidth`/`borderRightColor` on a column, which the phone (its style
  passes each side) and the window (a side with a width is solid) already draw: no build needed an update.
- **The words in Bricolage Grotesque** (OFL), 400 at 16/23, ink, tracking -0.1 (kit `messageText`). A build declares `FontBricolage`
  when it has the three faces registered ("Tailzu Bricolage", "Tailzu Bricolage Medium", "Tailzu Bricolage SemiBold": the weight is
  the family, as with Geist); the phone gets them in the bootstrap's `fonts` (`tulmi/fonts/bricolage*.ttf`, named only to a build
  that declares it), the window bundles them. Without it the same nodes are set in Geist.
- A build with the new Spaces reads its chats (`bots.thread`) the same way, a group's names over every message too, each line in its
  sender's colour: a group's and a space chat's people carry their `bot` when one chat is read (`Threads.read`, as their space has
  them; never in the list). An older build keeps today's chat, bubbles and cards as they were.

## Home's Space card

A build with the new Spaces has one card on Home for all of them, titled **Space**, however many spaces there are. Its line is the
newest thing across them: a payment waiting for your yes first ("1 payment needs your yes"), else the newest line ("Mom: Dinner at
8?"), else who is in it (one space) or their names. A tap opens Your spaces. In no space, no card. An older build keeps a tile per
group, as before.

## Group memory and the group's bots

Plan Ease, Notes, Travel bot and Xode are every group's bots: they read what is shared in each of the person's spaces and what
the group told its bots, with no adding step. Any other bot reads a space only once it is added to it.

The meeting bot follows the line about the admin too (docs/meet.md, "In a space"): a space's admin sees the meetings of each member who
agreed to it, is told when one takes the bot to a meeting (`space_meet`), and may send the bot to a member's meeting for them
(`space_meet_sent`). The mail bot too (docs/mail.md, "In a space"): a business's owner gives addresses to members to answer
(`space_mail_handle`; they see and send only that address's mail), and a space's admin has a member's own business in full, read and
write, and is told when one is set up (`space_mail`). A meeting's notes and a mail conversation can be shared to a space or a person
like anything else. The Oracle stays private: no admin ever sees a member's chart or readings.

## Lists stay cheap

`GET /spaces` is read at every Home load and at both apps' launch, so it only reads, as it always did. The new Spaces screen asks
`GET /spaces?full=1` for each space's last line, unread count and open invites, and the person's invitations, requests, asks and
draft. Home's Space card asks `GET /spaces?last=1`: each space's last line and unread count, and nothing else (it only reads too). Drafts are in no list anyone sees (`Spaces.mine` and `list` skip them).

## Rolling back

The new columns stay, so older server code still runs, but it knows nothing of `to_id` or `draft_ms`. Before running older server
code on this database:

- hide the messages to one person, or it shows each to the whole space: `delete from public.thread_messages where to_id is not null;`
- delete the drafts, or each shows to its maker as a real space named "New space" (its invites go with it):
  `delete from public.spaces where draft_ms is not null;`

- take out what the admin shared of members' things, or older code shows its card to the owner and lets them stop it:
  `delete from public.thread_messages where id in (select message_id from public.space_grants where by_id is not null);` then
  `delete from public.space_grants where by_id is not null;`

Grants, requests, work notes, `consent_v` and `mail_outbox.sent_by` are ignored by older code (which counts any `consent_ms`, so a
member who agreed to the old line is counted again, for what that line said).
