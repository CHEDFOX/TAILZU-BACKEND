# Calls: our own video and audio calls

Video and audio calls of our own, with nothing to connect: no Zoom, Meet or Teams account, no app or sign-up for the people invited. The mail
bot starts them under a business's name. A call has a link (`x0bot.com/m/abc-defg-hij`). Anyone holding it asks to come in, and the host lets
them in. X0 Bot's apps join from a call screen that is server data like every other (section 4), never a web page.

* [1. How it fits](#1-how-it-fits)
* [2. A call, from Start to End](#2-a-call-from-start-to-end)
* [3. The lobby](#3-the-lobby)
* [4. In the apps](#4-in-the-apps)
* [5. Limits and the money](#5-limits-and-the-money)
* [6. What the server answers](#6-what-the-server-answers)
* [7. Privacy](#7-privacy)
* [8. Configuration and deploy](#8-configuration-and-deploy)
* [9. Tests](#9-tests)
* [10. Still to come](#10-still-to-come)

## 1. How it fits

```
   an app, or the link's page                          the app's own WebRTC
        │  its offer                                            │
        ▼                                                       ▼
   the backend (src/rooms): the rooms, the links, the lobby, who may join, the minutes
        │  the App Secret, which never leaves here
        ▼
   Cloudflare Realtime SFU: one session a person, their tracks pulled into each other's
```

* **Hosting.** The calls themselves are on our server: the rooms and their links, the lobby, who may join, the minutes (`src/rooms`, the
  `rooms` table). **Cloudflare's Realtime SFU** moves the video and the sound between the people in a call. It is the same Cloudflare the
  Xode jobs Worker already runs on (`docs/cloudflare-jobs.md`).
* **No client ever talks to the SFU.** The App Secret is the SFU's only credential and it has no scopes, so it stays here: an app sends us
  its offer, we make the session and hand back the answer (`rooms/sfu.ts`, `routes/bots/rooms.ts`). That is also what keeps the lobby and
  the day's minutes ours to enforce — there is no way round us.
* **The SFU knows nothing of rooms.** It moves *tracks* between *sessions*: one session per person, their microphone and camera published
  as "local" tracks named `<identity>-audio` and `<identity>-video`, and everyone else's pulled in as "remote" tracks by name. Which
  sessions belong together is ours. That is why there is no webhook to miss, and why presence is something we hold rather than are told
  (section 3).
* **No SDK.** The SFU's API is plain HTTPS and `node:crypto` is not even needed: `rooms/sfu.ts` is `fetch` with a bearer header.

## 2. A call, from Start to End

1. **Start a call** on the mail bot's page (Calls). The call is made under the business's own name, as the mail worker has it. The person
   can't type another name, so a call can't claim to be someone else's. It opens on its screen with its link.
2. **Share the link**: Copy, or Share. Later the mail bot puts it in its replies with a calendar invite (section 10).
3. **Someone takes a seat.** Their app opens its microphone and camera, makes an offer, and sends it with the mids its own tracks are on.
   We make their SFU session, publish those tracks, and hand back the answer and a **seat**.
4. **They pull each other in.** The seat's heartbeat says who else is in the call and what each is sending; the app asks for the tracks it
   does not have yet, answers the SFU's offer, and draws them.
5. **End the call for everyone** (on a second yes): the seats go, the lobby empties, and the link stops working. A call nobody ends keeps
   its link: people can come back to it. It is ended after 30 days unused.

| Status | |
| --- | --- |
| `open` | the link works, nobody is in |
| `live` | someone is in |
| `ended` | its host ended it (or it went unused for 30 days); the link is dead |

**A seat** is one person in one call: their SFU session, the tracks they send, and a bearer their app holds. Everything after joining is the
seat's and needs nothing else — no sign-in, no room id. It is handed out only by a join that was allowed (the host signed in, or a guest the
host let in), it is never drawn on a screen, and only its hash is stored.

## 3. The lobby, and how we know who is in

On by default ("Ask before letting people in").

* A guest gives their name and **knocks**. They get a key only they hold, and ask with it every few seconds whether they are let in.
* The host sees who waits, by name, with **Let in** and **Not now**. When the host is not in the call, they get a push: "Ravi is waiting
  to join your call." (`room_waiting`, at most every 2 minutes a call, with the mail bot's other pushes in the person's switches).
* Let in, the guest may take a seat — one knock, one seat. Not let in, or **Removed** later: no seat, and their app is told it is out.
* A knock nobody answers is forgotten after 15 minutes. At most 20 people wait at one call's door. Knocks are kept in memory: one lost to a
  restart is a guest who knocks again.
* **Off**, people with the link are let straight in, and whoever was waiting is let in at once.

**Presence is held, not received.** There is no webhook from the SFU, so a seat says it is still there every couple of seconds
(`POST /v1/rooms/seat/live`, which is also how the app learns who else is in and what they are sending). A seat that has said nothing for
**20 seconds** is not in the call any more: the next heartbeat or the minute's tick drops it. That is how someone closing their phone, losing
the network or force-quitting leaves a call, without anything having to tell us. Whoever is calling `live` is in the call by the fact of
calling, so a quiet network drops only the person who went quiet.

**Sending someone away** takes their seat: nobody pulls their tracks any more, and their own app is told it is out. The SFU has no way to
shut a session someone else opened, so a client that ignored that would still be publishing into the void — nobody in the call subscribes to
it.

## 4. In the apps

Every screen is the server's, drawn by both apps (`experience/bots/screens/bots/mailCalls.ts`):

* **Calls on the mail page**: Start a call, and the latest three calls (on now, someone waiting, when it was last on). Shown only while
  calls are switched on and the business is the person's to call from (their own, or a member's as their space's admin; never addresses
  given to them).
* **One call** (`bots.mail.call`, params `b`, `r`): who waits, with Let in and Not now; who is in, a guest with Remove; the link with Copy
  and Share; "Ask before letting people in"; End the call for everyone. A push that someone waits opens it. It is read again as people come
  and go (live topic `room:<id>`). Joining from the app says it comes with the app's next update.

**Joining from the apps is a block of its own, `call`** (`docs/renderer.md`: the apps are renderers, and a new kind of thing a screen can
say goes into the vocabulary as data every screen can use, never a component for one feature). It is the 14th block. The `media` block's
`Video` could not stand in: it is expo-video playing an https clip, and a call's track is not a URL.

| Piece of `call` | What it is |
| --- | --- |
| `call.join` | take a seat: the app opens its microphone (and camera), makes an offer, POSTs it to the join path, sets the answer, and from then on runs the call itself against the four seat routes |
| `call.set`, `call.leave` | the mic, the camera, the speaker and the facing; hang up |
| What it writes into `statePath` | `phase`, `mic`, `cam`, `speaker`, `front`, `me`, `people` (each with `speaking`, `mic`, `cam`) and `waiting`. Every word, tile and button on the call screen is an expression over that |
| `Caller`, a node | one person's picture, or the first letter of their name while their camera is off. `who` is "me", "speaker" or an identity, so a grid is `Each` over `state.c.people` with a `Caller` inside and the layout stays the server's |

The seat is a bearer and never reaches the screen's state. One block serves every live thing to come (a call, a voice bot, a live room in
a space), not only this one.

Where it lives:

| | |
| --- | --- |
| The phone | `TAILZU-FRONTEND/app/src/sdui/call/`: `callCore.ts` the arithmetic, `session.ts` the one file that names the live client, `Caller.tsx`, `holder.ts` (one call at a time), `index.ts` (the block and the three actions) |
| The window | `TAILZU-DESKTOP/src/app/sdui/v2/call.js`, the same loop in the window's own style |
| The screen | `tulmi/src/experience/bots/screens/bots/callRoom.ts` (`bots.mail.room`), a vocabulary-2 screen that states `needs` |

**Why this needs no second copy of WebRTC.** The SFU asks for nothing a browser has that React Native does not: `addTransceiver` with a
direction, offer and answer, `ontrack` carrying its transceiver, `mid`, `getStats`, data channels with `negotiated` and an `id`, and ICE
gathering (it is not trickle: the whole offer is sent at once). All of it is in the `react-native-webrtc` the app already links for Plan
Ease's live call, so the block is JavaScript on a library that is already there — no new native package, no runtime change
(`docs/renderer.md`, "The runtime rule"), and it arrives over the air after the next store build. The window has WebRTC of its own and
always declares the block.

**A build without it is never sent the screen.** The phone declares `call` only where the live client really loads
(`blocks/registry.ts`), so the gate would answer anyone else with "Open X0 again" rather than a page. That is why the call's own page
offers Join only to a client that has the block, and tells everyone else that joining comes with the app's next update.

## 5. Limits and the money

Cloudflare bills **$0.05 a gigabyte of what leaves the SFU**, with the first 1,000 GB each month free; what is published *into* it is free,
and there is no charge per person or per minute. A two-person video call is roughly 0.9 GB an hour, so the free allowance is about a thousand
hours of calls a month. Our limits:

| | |
| --- | --- |
| A person's call minutes, in any 24 hours | `ROOM_DAILY_MINUTES`, 600. Over it nobody new comes in, and the minute's tick closes calls going on |
| One call, at most | 4 hours; then it is closed (its link still works) |
| People in one call | `ROOM_MAX_PEOPLE`, 10, the host among them |
| Calls a person makes in a day | 100 |
| A seat gone quiet | 20 seconds |
| The link's routes, per address | 30 looks, 10 knocks, 60 answers and 20 joins a minute; a seat's own routes 90 a minute |

## 6. What the server answers

The host's (signed in, theirs alone: a call that is not theirs is `404`). The mail bot's two make and list a business's calls:

| Route | |
| --- | --- |
| `GET /v1/mail/businesses/:id/calls` | the business's calls, newest first |
| `POST /v1/mail/businesses/:id/calls` | `{ title? }`: a call under the business's name (`201 { call }`) |
| `GET /v1/rooms/:id` | one call: who is in, who waits |
| `PUT /v1/rooms/:id` | `{ lobby?, title? }` |
| `POST /v1/rooms/:id/join` | `{ sdp, audioMid, videoMid? }` -> `201 { seat, identity, name, host, room, answer, people }` |
| `POST /v1/rooms/:id/admit`, `/deny` | `{ knock }` |
| `POST /v1/rooms/:id/remove` | `{ identity }`: a guest sent away (never the host) |
| `POST /v1/rooms/:id/end` | ended for everyone |

The link's (public; a code that cannot be one is the same `404` as a code of no call):

| Route | |
| --- | --- |
| `GET /v1/rooms/guest/:code` | `{ room: { title, host, status, lobby, full } }` |
| `POST /v1/rooms/guest/:code/knock` | `{ name }` -> `{ knock, state }` |
| `GET /v1/rooms/guest/:code/knock/:key` | `{ knock, state: waiting \| admitted \| denied \| gone }` |
| `POST /v1/rooms/guest/:code/join` | `{ knock, sdp, audioMid, videoMid? }` -> the same seat as above |

The seat's (the seat is the whole credential):

| Route | |
| --- | --- |
| `POST /v1/rooms/seat/pull` | `{ seat, want: [{ identity, kind }] }` -> `{ offer, mustAnswer, tracks }` |
| `POST /v1/rooms/seat/answer` | `{ seat, sdp }` |
| `POST /v1/rooms/seat/live` | `{ seat, audio?, video? }` -> `{ status, people, waiting?, gone? }`. The heartbeat |
| `POST /v1/rooms/seat/leave` | `{ seat }` |

Without calls set up every route is `404 { code: "rooms_off" }`. Errors are `{ code, message }`, the message in words for a person ("The
call is full.", "Today's call minutes are used up…"). One change at a time per seat: the SFU answers 406 to a second offer while the first is
unanswered, so the service holds a lock per seat and a lost race is `409 room_busy`.

## 7. Privacy

* **Nothing said or shown in a call reaches our server.** The video and the sound go between the people and the SFU, encrypted on the way,
  and nothing is recorded. What passes through us is the SDP of the connection, which is never logged.
* **A link is not guessable** (ten letters, about 49 bits), and one found only lets its holder knock. The row keeps the code hashed, to find
  the call, and sealed (AES-256-GCM under a key made from `CONNECTOR_TOKEN_KEY` for this use only), so the host can share it again.
* **A seat is a bearer**, so only its hash is stored, it never appears on a screen, and the SFU session behind it is never sent to anyone.
* **Identities name nobody.** Everyone in a call sees each other's identity: a host's is a hash of their account, a guest's random. The names
  shown are the ones people give.
* **A push says the name typed and the call's title**, nothing more. Nothing a person typed is logged.
* **The rows are the server's alone** (row level security, no policy) and go with the account. An account deleted ends its calls.

## 8. Configuration and deploy

| Where | Key | |
| --- | --- | --- |
| `tulmi/.env` | `SFU_APP_ID` | the Realtime app's id, from Cloudflare's dashboard |
| `tulmi/.env` | `SFU_APP_SECRET` | **secret**: its App Secret. Both set: calls are on |
| `tulmi/.env` | `ROOM_LINK_ORIGIN` | optional: where links point, `https://x0bot.com` |
| `tulmi/.env` | `ROOM_DAILY_MINUTES`, `ROOM_MAX_PEOPLE` | optional: 600 and 10 |

There is no webhook to register. Migration 0091 (`rooms`), run by the deploy with the others. Steps: DEPLOY.md, "Calls".

## 9. Tests

All in `tulmi/tests/`.

* `rooms-sfu.test.ts`: a session made, tracks published by the mids of an offer, someone else's pulled in, the answer sent, tracks closed;
  the App Secret in every header and in no error; a refusal, a busy session (406) and a network failure each in words for a person; an
  answer that is not one refused; a link's code made, read back from what a person pastes, and sealed.
* `rooms-service.test.ts`: a call made with its link sealed; a seat taken (the answer out, the bearer kept only as a hash, the SFU session
  never on a screen), audio-only, and an app that joins again replacing its own seat; the lobby (waiting, the host told once and not while
  in the call, a seat only once let in, one knock one seat, the lobby off); pulling someone else's tracks and never one's own; the heartbeat
  carrying who is in and what each sends, a camera turned off, and a seat gone quiet leaving by itself; the day's minutes; a full call;
  someone sent away; a call ended; the tick; an account deleted.
* `rooms-routes.test.ts`: off without calls; the host's routes with the person's own id and only the checked fields (the name is their
  profile's, never the body's); a bad offer refused before the service hears of it; the link's routes; the seat routes taking the seat as
  their one credential and refusing anything that is not one; the mail bot's calls under the business's own name, for its owner and their
  space's admin, never for a member who only answers addresses.
* `rooms-page.test.ts`: Calls on the mail page, only when on; one call's screen (the link, the lobby, who is in, End on a second yes, an
  ended call, one that isn't there), Join offered only to a client with the `call` block and everyone else told it is coming, never a web
  page; and in a call: the seat taken as the screen opens, `needs` stating the block, a `Caller` per person inside an `Each` over the
  call's own people, the controls as `call.set`, where the call stands read from its state, who waits let in without leaving, the
  microphone asked for, and nothing to join for a call that ended. Every tree through the app's linter.
* `TAILZU-FRONTEND/app/src/sdui/call/callCore.test.ts`: what to pull and what to let go as people come, go and turn a camera off; the hold
  that stops a tile flickering between words; what the screen reads, and that the seat is never in it; who a tile means by "me",
  "speaker" and a name; the wait before trying a dropped call again.
* `TAILZU-DESKTOP/src/app/sdui/v2/blocks.test.js`: the window declares `call`; a `Caller` draws its ground before anyone is in the call
  and a letter once someone is; the screen reads the call and never its seat.

**Needs a live check**: a Cloudflare Realtime app set up, and a real call between two devices. Everything up to the media itself is
covered here, but no test in this repo opens a microphone.

## 10. Still to come

1. **The mail bot puts calls in emails**: the AI sees when a customer wants to talk and its reply carries the link and a calendar invite
   from the business's address; Add a call when writing. And **our join page** at `x0bot.com/m/<code>` for people without X0 Bot (the
   website sends `/m/*` to this server), using the link's routes above.
2. **AI notes from a call**: a WebSocket adapter on the SFU sends the call's audio to us as PCM, which is what the Notes pipeline needs. The
   meeting bot pays Recall.ai $0.65–0.75 an hour for the same thing (`docs/meet.md`).
3. Later: joining by phone number, recordings, and a space's admin seeing their people's calls.
