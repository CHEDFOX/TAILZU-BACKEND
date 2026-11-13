# Calls: our own video and audio calls

Video and audio calls of our own, with nothing to connect: no Zoom, Meet or Teams account, no app or sign-up for the people invited. The mail
bot starts them under a business's name. A call has a link (`x0bot.com/m/abc-defg-hij`). Anyone holding it asks to come in, and the host lets
them in. X0 Bot's apps will join from a call screen that is server data like every other (section 4), never a web page.

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
X0 Bot's call screen ──pass──> LiveKit <──pass── a guest (to come: our join page at x0bot.com/m/<code>)
        │                         │
        │ POST /v1/rooms/:id/join  │ signed webhook: who joins and leaves, a room closed
        v                         v
    the backend: rooms, links, the lobby, who may join, the minutes (src/rooms)
```

* **Hosting.** The calls themselves are on our server: the rooms, their links, the lobby, who may join, the minutes (`src/rooms`, the
  `rooms` table). **LiveKit** carries the video and the sound between the people in a call. It is open source, so it runs in one of two
  places, and the server doesn't mind which:
  * **LiveKit Cloud** (to start): their servers around the world, nothing to run, a free tier and then by the minute.
  * **A LiveKit server of our own** (later): the same software on a machine of ours. It needs bandwidth and open UDP ports, so it goes on its
    own machine, not on the shared VPS.

  Moving from one to the other is the three settings (section 8).
* **Passes.** Nobody joins a LiveKit room without a pass, a short JWT the server signs with the project's secret for one room
  (`rooms/livekit.ts`). A host's pass may send people away; a guest's may not. A pass names nobody: a host is `h_` and a hash of their
  account, a guest `g_` and random letters. It lasts minutes, only until the app or the page has connected; LiveKit keeps a connected one
  fresh.
* **No SDK.** The passes, the server's calls to LiveKit (make a room, close it, send someone away) and its webhook's signature are plain
  fetch and `node:crypto`.

## 2. A call, from Start to End

1. **Start a call** on the mail bot's page (Calls). The call is made under the business's own name, as the mail worker has it. The person
   can't type another name, so a call can't claim to be someone else's. It opens on its screen with its link.
2. **Share the link**: Copy, or Share. Later the mail bot puts it in its replies with a calendar invite (section 10).
3. **People join.** The host joins from the app's call screen (Join with video, or Audio only). Someone with the link asks to come in and
   waits (section 3).
4. **LiveKit tells us who is in.** Its webhook keeps who is in now, and each stretch of time people were in (a session), so the minutes are
   known. One event is kept once however often it comes.
5. **End the call for everyone** (on a second yes): everyone is sent away, the lobby empties, and the link stops working. A call nobody ends
   keeps its link: people can come back to it. It is ended after 30 days unused.

| Status | |
| --- | --- |
| `open` | the link works, nobody is in |
| `live` | someone is in |
| `ended` | its host ended it (or it went unused for 30 days); the link is dead |

## 3. The lobby

On by default ("Ask before letting people in").

* A guest gives their name and **knocks**. They get a key that only they hold, and ask with it, every few seconds, whether they are let in.
* The host sees who waits, by name, with **Let in** and **Not now**. When the host is not in the call, they get a push: "Ravi is waiting
  to join your call." (`room_waiting`, at most every 2 minutes a call, with the mail bot's other pushes in the person's switches).
* Let in, the guest's next ask gets their pass. Not let in, or **Removed** from the call later: their knock never gives another pass.
* A knock nobody answers is forgotten after 15 minutes. At most 20 people wait at one call's door. Knocks are kept in memory: one lost to a
  restart is a guest who knocks again.
* **Off**, people with the link come straight in, and whoever was waiting is let in at once (as many as there is room for).

## 4. In the apps

Every screen is the server's, drawn by both apps (`experience/bots/screens/bots/mailCalls.ts`):

* **Calls on the mail page**: Start a call, and the latest three calls (on now, someone waiting, when it was last on). Shown only while
  calls are switched on and the business is the person's to call from (their own, or a member's as their space's admin; never addresses
  given to them).
* **One call** (`bots.mail.call`, params `b`, `r`): who waits, with Let in and Not now; who is in, a guest with Remove; the link with Copy
  and Share; "Ask before letting people in"; End the call for everyone. A push that someone waits opens it. It is read again as people come
  and go (live topic `room:<id>`). Joining from the app says it comes with the app's next update.

**Joining from the apps comes as a block, not a call component** (`docs/renderer.md`: the apps are renderers, and a new kind of thing a
screen can say goes in the vocabulary as data every screen can use). The plan, built once the renderer wiring (V1), the server's screen
checker (S1) and the desktop copy (D1) have landed (`WORKING-ON.md`):

| Piece | What it is |
| --- | --- |
| A live-session block | actions to join, change (mic, camera, speaker, screen, flip) and leave a live session, from a pass the server gives (`POST /v1/rooms/:id/join`); the session written into the screen's state: where it stands, the person's own mic and camera, and the people in it (name, speaking, mic, camera) |
| `Video` playing a live track | the media block's `Video` given the person's own camera or someone's in the session |
| The call screen | server data: `Each` over the people, each a tile whose name, ring and marks are expressions on that state; the buttons read it too |

The same block serves every live thing to come (a call, a voice bot, a live room in a space), not only this one. A phone says it only where
its binary links WebRTC: the next store build does (Plan Ease's live call added it), so the block itself comes over the air. LiveKit's
JavaScript client runs on that library; LiveKit's own copy of WebRTC cannot come in, because changing a native package already linked would
change the phone's runtime, which stays as it is (`docs/renderer.md`, "The runtime rule"). That needs one check on a real phone first.

## 5. Limits and the money

LiveKit bills by the minute. Our limits:

| | |
| --- | --- |
| A person's call minutes, in any 24 hours | `ROOM_DAILY_MINUTES`, 600. Over it nobody new comes in, and the minute's tick closes calls going on |
| One call, at most | 4 hours; then it is closed (its link still works) |
| People in one call | `ROOM_MAX_PEOPLE`, 10, the host among them; LiveKit holds the same limit |
| Calls a person makes in a day | 100 |
| The link's routes, per address | 30 looks, 10 knocks and 60 asks for an answer a minute |

## 6. What the server answers

The host's (signed in, theirs alone: a call that is not theirs is `404`). The mail bot's two make and list a business's calls:

| Route | |
| --- | --- |
| `GET /v1/mail/businesses/:id/calls` | the business's calls, newest first |
| `POST /v1/mail/businesses/:id/calls` | `{ title? }`: a call under the business's name (`201 { call }`) |
| `GET /v1/rooms/:id` | one call: who is in, who waits |
| `PUT /v1/rooms/:id` | `{ lobby?, title? }` |
| `POST /v1/rooms/:id/join` | a host's pass: `{ url, pass, identity, name, room, host, expiresAt }` |
| `POST /v1/rooms/:id/admit`, `/deny` | `{ knock }` |
| `POST /v1/rooms/:id/remove` | `{ identity }`: a guest sent away (never the host) |
| `POST /v1/rooms/:id/end` | ended for everyone |

The link's (public; a code that cannot be one is the same `404` as a code of no call):

| Route | |
| --- | --- |
| `GET /v1/rooms/guest/:code` | `{ room: { title, host, status, lobby, full } }` |
| `POST /v1/rooms/guest/:code/knock` | `{ name }` -> `{ knock, state }`, with a pass when the lobby is off |
| `GET /v1/rooms/guest/:code/knock/:key` | `{ knock, state: waiting \| admitted \| denied \| gone, pass? }` |

LiveKit's: `POST /v1/rooms/livekit` (`application/webhook+json`, its `Authorization` a JWT signed with the API secret whose `sha256` is the
body's). Unsigned: `401`. An event that could not be kept: `500`, so LiveKit sends it again.

Without calls set up every route is `404 { code: "rooms_off" }`. Errors are `{ code, message }`, the message in words for a person ("The
call is full.", "Today's call minutes are used up…").

## 7. Privacy

* **Nothing said or shown in a call reaches our server.** The video and the sound go between the people and LiveKit, encrypted on the way,
  and nothing is recorded.
* **A link is not guessable** (ten letters, about 49 bits), and one found only lets its holder knock. The row keeps the code hashed, to find
  the call, and sealed (AES-256-GCM under a key made from `CONNECTOR_TOKEN_KEY` for this use only), so the host can share it again.
* **Identities name nobody.** Everyone in a call sees each other's identity: a host's is a hash, a guest's random. The names shown are the
  ones people give.
* **A push says the name typed and the call's title**, nothing more. Nothing a person typed is logged.
* **The rows are the server's alone** (row level security, no policy) and go with the account. An account deleted closes its calls going on.

## 8. Configuration and deploy

| Where | Key | |
| --- | --- | --- |
| `tulmi/.env` | `LIVEKIT_URL` | the project's address, `wss://<project>.livekit.cloud` (or our own server's) |
| `tulmi/.env` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | **secret**: the project's key pair. All three set: calls are on |
| `tulmi/.env` | `ROOM_LINK_ORIGIN` | optional: where links point, `https://x0bot.com` |
| `tulmi/.env` | `ROOM_DAILY_MINUTES`, `ROOM_MAX_PEOPLE` | optional: 600 and 10 |
| LiveKit's dashboard | Webhooks | `https://api.x0bot.com/v1/rooms/livekit`, set once |

Migration 0091 (`rooms`), run by the deploy with the others. Steps: DEPLOY.md, "Calls".

## 9. Tests

All in `tulmi/tests/`.

* `rooms-livekit.test.ts`: a pass for one room, a host's with the room's admin and a guest's without; a JWT refused tampered, unsigned,
  expired or of another secret; the webhook only when signed over the exact body; the server's calls to LiveKit, each signed for just what it
  does, a room already gone taken as gone, a refusal or a failure in words without the secret; a link's code made, read back from what a
  person pastes, and sealed.
* `rooms-service.test.ts`: a call made with its link, sealed; the lobby (waiting, the host told once and not while in the call, let in with a
  guest's pass, not let in, forgotten); the lobby off; the host's pass naming no account; another person's call none of theirs; the webhook's
  people and minutes, once per event; the day's minutes; a full call; a guest sent away; a call ended; the tick; an account deleted.
* `rooms-routes.test.ts`: off without calls; the host's routes with the person's own id and only the checked fields; the link's routes; the
  webhook signed over the exact bytes; the mail bot's calls under the business's own name, for its owner and their space's admin, never for a
  member who only answers addresses.
* `rooms-page.test.ts`: Calls on the mail page, only when on; one call's screen: the link, the lobby, who is in, End on a second yes,
  joining said to come with the next update and never a web page, an ended call, one that isn't there; every tree through the app's linter.

**Needs a live check**: a LiveKit project set up, a call made from the mail page, its webhook reaching the server signed.

## 10. Still to come

1. **Joining from the apps**: the live-session block and `Video` playing a live track (section 4), after V1, S1 and D1 land; then the call
   screen as server data. First, one check on a real phone: LiveKit's JavaScript client on the WebRTC the next store build links.
2. **The mail bot puts calls in emails**: the AI sees when a customer wants to talk and its reply carries the link and a calendar invite
   from the business's address; Add a call when writing. And **our join page** at `x0bot.com/m/<code>` for people without X0 Bot (the
   website sends `/m/*` to this server), using the link's routes above.
3. **AI notes from a call** (a silent participant, the transcript into Notes) and the follow-up email.
4. Later: joining by phone number, recordings, and a space's admin seeing their people's calls.
