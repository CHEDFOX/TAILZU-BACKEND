# The Oracle: a bot that reads your sky

The Oracle is a built-in bot that answers what a person asks about their life (love, work, money, health, timing, a choice in front of them) by
reading their birth chart and the world's divination traditions. Its engine is **Plutto's oracle**, copied into this repository and run as a service
of its own (`oracle-worker/`). The Bots app shows it as a chat and nothing in its way.

* [1. How a question is answered](#1-how-a-question-is-answered)
* [2. Birth details](#2-birth-details)
* [3. The page and the looks](#3-the-page-and-the-looks)
* [4. The models, and when one is down](#4-the-models-and-when-one-is-down)
* [5. Money](#5-money)
* [6. Privacy](#6-privacy)
* [7. Configuration and deploy](#7-configuration-and-deploy)
* [8. Keeping the engine in step with Plutto](#8-keeping-the-engine-in-step-with-plutto)
* [9. Tests](#9-tests)

## 1. How a question is answered

```
the person ──> Bots app chat ──> runBot (bots/run.ts) ──> runOracle (oracle/run.ts) ──signed──> oracle-worker /v1/answer
                                                                                                   │
                         words stream back as they are written <───────────────────────────────────┘
```

1. **The X0 Bot server** (`tulmi/src/oracle/run.ts`) takes the Oracle's turns; every other bot runs the usual tool loop. It sends the message, the
   last turns (from the bot's thread, as for any bot), the person's sky (when and where they were born) and the route their last question took.
2. **The worker** (`oracle-worker/server/answer.py`) runs Plutto's pipeline once:
   * **the router** finds the subsystems that answer the question (about 300: Vedic's marriage chart, KP's event promise, a Western solar return,
     the Mayan day-sign...) by meaning, then one small model call picks the exact ones. No list of topics anywhere: a question nobody foresaw still
     lands near what can answer it;
   * **the engines** compute them from the birth details; **the council** weighs how sure to sound;
   * **the reply** is written in the Oracle's voice: plain words, no technical terms unless asked, dates only where the data gives them, every hard
     thing with what eases it, and sometimes a follow-up hook when it is psychologically alive.
3. **The words stream back** to the chat as they are written; then the route is kept (`oracle_people.last_route`) so a follow-up on the same subject
   ("and next March?") is read the same way.

In the model test (nine deep questions), the engine's part took 3.5 to 8.6 seconds, the first words came 6 to 21 seconds after the question (about
14 typically), and whole answers took 13 to 27 seconds.

A draw asked for in the chat ("pull a tarot card") is laid by the worker, seeded, and read as the heart of the answer; the cards come back in the
answer's notes.

**"Ask any bot"** (`bots/door.ts`) sends a question to the Oracle when it asks for a reading in so many words, with no model asked: a kundli, a
horoscope, tarot, "when will I get married?", "meri shaadi kab hogi", "मेरी कुंडली" (the `oracle` line in `HINTS`), or names it ("ask the oracle").
Its purpose is in everyday words (life, love, work, a chart), so those are not counted for it (`NAME_ONLY`): a love letter stays Keybot's and a chart
of expenses is not a reading. Words that are also names or amounts (Rashi, Dasha, राशि as a sum) never count alone. Between two bots, the tiny tier
decides, as for any bot.

## 2. Birth details, and the cards that ask for them

The Oracle needs the date, the time (when known) and the place of birth, and reads better with the person's name and gender. They come two ways:

* **The cards** (`experience/bots/screens/bots/oracleCards.ts`), the first time someone opens the Oracle: one card over its page, the way the
  microphone and keyboard card and the About you card ask (a BotCard overlay, the page blurred behind it), with the day's character on its stage.
  One step after another, each kept as soon as it is answered, so leaving halfway loses nothing:
  1. **When**: the date, and the time if they know it (`PUT /v1/oracle/sky { date, time }`). The cards cannot be put off: there is no reading
     without a chart. Only Change's cards, with a sky already kept, have a Cancel.
  2. **Where**: the town or city, with suggestions as they type (`GET /v1/oracle/places`); a tap keeps one (`PUT { placeId, place, session }`),
     Keep finds what they typed (`PUT { place }`). With `GOOGLE_PLACES_API_KEY` the suggestions are Google's (`oracle/places.ts`: the Places API
     Plutto uses, autocomplete then details, towns and cities only, one session per card so a search and its pick are billed together). Without
     it, or when Google refuses, the server's own: the cities table, then `PLACES_GEOCODER`. The app shows no list from state, so the
     suggestions are five rows, each shown while the search's answer has one.
  3. **You**: their name and gender, only when the app does not have them (the About you card's read, `GET /v1/bots/first-run/about`, and its
     write, `PUT /v1/profile`, so every bot has them; a name guessed from the email does not count as theirs). Signed in with Apple, the name is
     never required (App Review 4).
  Then "Ask away", the character's happy moment, and the page with the sky's line. **Change** on that line opens the cards again, filled in.
  A build without the living card gets the same steps in a plain card at the top of the page.
* **The chat**: "13 July 1994, 9:30 am, Mumbai" or "13/07/1994 subah 9 baje Delhi" in a message is read, kept, and said back in the notes.

Both are read by the same rules (`oracle/birth.ts`, no model). A date is day before month (05/07/1994 is the 5th of July) unless the first number
cannot be a month. A time not given is noon, marked as not known, and the reading is gentler about the hour. A sky is read only once it is whole
(the cards keep the when first). The name and gender go to the engine with the birth details: several of its systems read a woman's chart as a
man's without the gender ("Other" is not sent: the engine reads only male and female).

**No reading without a chart.** Until the sky is whole the Oracle's page has no ask bar, and wherever else a question reaches it ("Ask any bot",
@oracle, Ask's list of bots) the turn refuses before anything is asked (`oracle/run.ts`): the engine is not called, nothing is charged, and the
answer says what is missing (the birth details, the town, or a place not found) and sends them to the cards. Ask's answer from the Oracle has
"Open the Oracle".

## 3. The page and the looks

`experience/bots/screens/bots/oraclePage.ts`: the Oracle's bot page and its chat are one page.

* **The head**: back, the Oracle, its line, and (once there are turns) the day's character, small.
* **The sky**: the birth-details card until they are kept; then one quiet line ("13 July 1994, 9:30 am, Mumbai") with Change.
* **The chat**: the turns. Before the first, the day's character big on a stage of his own, and four first questions once the sky is kept. One
  character is on the page, never two: the stage and the head share his life (`page.oracle`), so the first answer moves him up into the head. A build
  that cannot draw him gets the plain empty state. The bots' own ask bar.

**The characters** are data in `shared/bots/looks.json` (catalog v2): **the Wanderer** (undyed camel wool, a soft-peaked hood, a staff with a
lantern) and **the Seer** (midnight cloth, a cowl and a cape, a crystal and cards), with no symbols on either, and their small stories as moments
(`w.lookup`, `w.wave`, `w.rain`, `w.walk`, `w.light`, `w.spyglass`, `w.campfire`; `s.wrap`, `s.bow`, `s.sweep`, `s.crystal`, `s.tarot`,
`s.book`). One wears the day (the Wanderer on one day, the Seer on the next), on the page, for builds that play looks (`BotMoments`). The Oracle is
the `custom` kind with an avatar of its own, so no app update is needed: phones fetch the catalog (v2) when the bootstrap names it; the starter copy
inside each app is refreshed at its next release.

**Home.** Home's grid draws the first three bots (Xode, Keylessbord, Plan Ease), so the Oracle has no tile there: it is reached from Ask's list of
bots, from "Ask any bot" and by its name. Its tile already wears the day's character wherever one is drawn (`oracleTileLook`), so giving it a place
on Home is a change to Home's grid only. Handing the tile from one character to the other on the same visit (one walks off, the other peeks in and
enters) needs a tile that holds two avatars: an app update, for later.

## 4. The models, and when one is down

The worker runs with `ORACLE_PROFILE=bot` (Plutto's `app/core/config.py` PROFILES):

| Role | Chain, best first |
| --- | --- |
| the reply | `anthropic/claude-sonnet-5.5@low`, `google/gemini-3.8-flash@low`, `openai:gpt-6.1-sol@low` |
| the router, the planner, the council | `google/gemini-2.5-flash`, `anthropic/claude-haiku-5.5`, `openai:gpt-6-luna` |

They were chosen by a live test (Plutto's `scripts/compare_reply_models.py`): nine deep questions through the real pipeline, graded blind by two
judges from other labs. A Sonnet setup came first in 16 of 18 gradings; at low thinking it kept its quality, its first word came sooner, and no reply
was cut off by its own thinking.

A model that fails hands the same request to the next one; a model that then fails a one-word check is skipped for ten minutes, and the conversation
it failed in keeps the model that took over (`app/core/llm.py`). `openai:` calls OpenAI directly with `OPENAI_API_KEY`: the spare that still answers
when OpenRouter itself is down or out of credit. When every model fails, the chat says the Oracle can't be reached and nothing is made up. Any chain
can be changed with `LLM_CHAIN_CHAT`, `LLM_CHAIN_DEEP` and `LLM_CHAIN_FAST` in the worker's environment.

## 5. Money

One answer is 2 to 4.5 US cents (about 3 typically, in the model test): the reply's own cost, which OpenRouter reports, and a fixed allowance for
the small calls before it. The worker
reports it in dollars and the server turns it into paise at the server's rate (`code/brain/money.ts`). The Oracle's budgets: 600 paise a request, 5,000
a day. A request whose cap cannot cover one answer (250 paise) is refused before anything is asked (402), with a sentence a person can read.

## 6. Privacy

* The worker is told who is asking only as a hash (`oracle:<sha256 of the id>`), enough to keep one model for one person's conversation.
* The birth details and the last route are in `oracle_people` (migration 0078): the person's own row, owner-only, deleted with the account and with
  "delete my data". The memory twin is used when there is no Supabase.
* Nothing a person asks is logged by the server or the worker (no access log, errors by their kind only). The worker writes nothing that outlives
  it: its scratch is in `/tmp`, gone with the container.
* What a person asks goes to the model providers, as any bot's message does.

## 7. Configuration and deploy

| Where | Key | |
| --- | --- | --- |
| `tulmi/.env` | `ORACLE_WORKER_URL` | `http://oracle-worker:8000`; with the secret, the Oracle is among the bots (`deploy/oracle-up.sh` sets it) |
| `tulmi/.env` | `ORACLE_WORKER_SECRET` | **secret**, signs every call (`deploy/oracle-up.sh` makes it) |
| `tulmi/.env` | `OPENROUTER_API_KEY`, `OPENAI_API_KEY` | **secrets** the server already has: the models; OpenAI for the search by meaning (without it, each question shows the model the whole list) |
| `tulmi/.env` | `GOOGLE_PLACES_API_KEY` | **secret**, optional: the birthplace card's suggestions from Google (the Places API Plutto uses; Plutto's key works). Read by the server, not the worker |
| compose | `ORACLE_WORKER_CONCURRENCY`, `ORACLE_WORKER_MEMORY`, `ORACLE_WORKER_CPUS` | answers at once (8), memory (1g), CPUs (1) |

One env file, `tulmi/.env`: the worker reads it as the backend does (the engine is the owner's own Plutto). It drops the database, Supabase,
payment and push names before the engine is loaded (`server/config.py`), so Plutto's memory store keeps its files in `/tmp` and never creates its
tables in the server's database; the only other names the two share are `HOST` and `PORT`, which the worker never uses (it starts on its own
port). `deploy/oracle-up.sh` switches it on once; after that `./deploy/ship.sh` rebuilds and restarts it with the backend and checks that it
answers, so a change to it, or a key changed in `tulmi/.env`, reaches it at the next deploy. `GET /healthz` says whether the model keys arrived
(`"models"`, `"meaning"`), never what they are.

Deploy steps are in DEPLOY.md ("The Oracle"): `./deploy/oracle-up.sh && ./deploy/ship.sh` (migration 0078 runs on deploy). `BOTS` must be on. Without `ORACLE_WORKER_URL` and `ORACLE_WORKER_SECRET` the Oracle is not listed and
`/v1/oracle/*` answers 404 `oracle_off`.

**Licence.** The engine computes the planets with the Swiss Ephemeris (`pyswisseph`), which is AGPL-3.0 unless the Swiss Ephemeris Professional
Licence is bought from Astrodienst. Under AGPL-3.0 the worker's source must be offered to the people who use the Oracle. Plutto runs on the same terms.
THIRD_PARTY_NOTICES.md has the line.

## 8. Keeping the engine in step with Plutto

`oracle-worker/app/` is Plutto's own code, byte for byte, under the same package name, so no import is rewritten: every module the pipeline and its
reply can reach (about 340, 4 MB), and the ephemeris. To bring in Plutto's newer oracle:

```
python3 oracle-worker/sync_plutto.py <path to Plutto-Backend>
cd oracle-worker && python -m pytest -q
```

The reply's layout and language rule live in `oracle-worker/server/reply.py`, copied from Plutto's chat (which is the app's HTTP layer, not part of
the engine): a change to how Plutto's chat replies belongs there too.

## 9. Tests

* `tulmi/tests/oracle-birth.test.ts`: the ways people write a date, a time and a place; Hinglish times; nothing made up.
* `tulmi/tests/oracle-worker.test.ts`: signed the media worker's way, streamed, failures said in words.
* `tulmi/tests/oracle-run.test.ts`: listed only where set up; birth details kept from the chat; nothing read, asked or charged without a whole sky;
  name and gender sent with it; the route sent back; the person never named to the worker; the money; down and not configured; "Ask any bot" sends a reading there, and a name, an amount or a plain plan elsewhere.
* `tulmi/tests/oracle-routes.test.ts`: the cards over HTTP: whole or in parts (the when, then the place), suggestions, what is missing in words.
* `tulmi/tests/oracle-page.test.ts`: the cards (when, where with five suggestion rows, name and gender only when owed; what is kept is passed;
  no putting them off, Cancel only in Change's; the plain card) and the page (no ask bar until the sky is kept; one character, big on his stage,
  then small in the head; the Wanderer one day and the Seer the next; "Open the Oracle" on Ask's answer).
* `tulmi/tests/oracle-places.test.ts`: Google's suggestions and the picked place in one session, the server's own when Google refuses or there is
  no key, and neither the key nor anything typed in a log line.
* `oracle-worker/tests/`: the signature (the media worker's vector), the answer streamed with the pipeline and the model stood in for, a failure,
  and the server's database and payment keys never reaching the engine.

**Needs a live check**: the worker built and running on the VPS with the real keys; an answer from the real models; the card and the chat on a
phone; the characters drawn by a build that plays looks.
