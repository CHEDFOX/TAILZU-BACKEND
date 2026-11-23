# Places worth keeping: the catalogue behind the Travel bot

The Travel bot opens on something to look at instead of an empty chat: a feed of places, each a card with a hook,
the months it is at its best, what there is to do there, and a picture. A person can search for one place, open a
card in full, and what they tap and linger on teaches the feed what they like. Nothing has to be filled in first.

Code: `tulmi/src/discover/`, the routes `tulmi/src/routes/bots/discover.ts`, the screen
`tulmi/src/experience/bots/screens/discoverFeed.ts` (the feed's blocks on `bots.travel`, and `bots.travel.place`),
the pictures in `tulmi/photos/` (credits in `tulmi/photos/CREDITS.md`), migrations 0099 and 0108. Tests:
`tulmi/tests/discover*.test.ts`.

## Two tiers, one bar

| Tier | Where | Whose |
| --- | --- | --- |
| **Ours** (`origin: "ours"`) | `catalog.ts` (the rows), `catalog-detail.ts` (how long it takes, how to get there, what can stop you), `photos-catalog.ts` (its picture) | everyone's; ships with the code and is reviewed like code |
| **Built** (`origin: "built"`) | `builder.ts`, `build.ts`, kept by `store.ts` | the one person who searched for it |

A built card stays its person's until enough **different** people have searched the same place (`store.ts asked`,
counted once a person). Then it is on the list of places to write by hand (`toWrite`), and once written it is
everyone's. The catalogue grows where it is wanted.

Both tiers clear the same bar (`bar.ts judge`): something to do at an hour that matters **or** a history with a date
on it, **and** not a repeat of a card we already have, **and** months it is best in, **and** a moment worth the
journey, **and** no standing Do Not Travel warning.

## Building a card for a place nobody has written

`builder.ts`, five steps in this order:

1. **Resolve.** The words become one point through `src/places`, so "hampi" and "Hampi, Karnataka" are one card.
2. **Read.** `src/web/research` reads several pages and answers with cited sources.
3. **Fill.** The model fills the same slots a hand-written card has (`build.ts BUILD_SLOTS`), from that answer only.
   Its tags come from the closed list in `taxonomy.ts`.
4. **Judge.** `parseBuilt` checks every slot and refuses a half-made card (fewer than two sources is a refusal);
   `bar.ts` decides whether it belongs in a feed.
5. **Look.** Photographs from Wikimedia Commons (`photos.ts`), only under a free licence, each with its credit.

The model never supplies the sources: they are the pages the researcher really fetched, with the day they were read.

## The feed

`query.ts pick`: country, month and budget are hard filters; then the tags asked for, how good the place is and how
little known; at most two from one country in a row; and one card that does **not** match, slotted third and marked
"Not your usual". The same ask gives the same feed.

## What a person likes

`signals.ts` weighs what they did (a keep, a skip, "not for me", how long a tile was on screen; being shown is worth
nothing but is counted, to correct for our own choices). `taste.ts` folds each signal into two numbers a tag, for and
against, with shrinkage so one tap swings nothing, and decay over time. `because()` says why a card was chosen in
the person's own terms. The app sends signals in capped batches; an unrecognised row is dropped, never refused.

## Over HTTP

| Route | What |
| --- | --- |
| `GET /v1/discover/feed` | `?tags=&month=&country=&budget=&limit=`: the cards, in order |
| `GET /v1/discover/place/:slug` | one card in full |
| `POST /v1/discover/build` | `{ place }`: a card read off the web |
| `POST /v1/discover/signals` | `{ signals }`: what they did |
| `GET /v1/discover/taste` | what we think they like, in words |

Every call resolves the token first; no route takes a user id.

## As a bot's tools

`tools.ts`: `places_discover`, `place_build` and `place_open`, given to the Travel bot and to any bot that searches
the web (`bots/tools.ts buildTools`). What the model reads back marks each card OURS or BUILT.

## The pictures

The pictures of our own places are illustrations made for the catalogue, in two sizes (1280px for an opened place,
520px for a tile), served at `/photos/`. None is a photograph of the place, and each card says so.

## The seam with the rest of the server

`src/discover` names no service. `server.ts` in the same folder is the one place the geocoder, the researcher and
the photographs are handed to it; `bots/wire.ts` passes the result to the bots as `ports.discover`.
