# What your orders say about you, and an order made from it

A person connects Swiggy once (docs/sites.md, "Signed in on the phone"). From then on X0 learns how they eat from the
site's own orders page, builds a portrait of it, and when they say "order my usual" or "khana mangwa do" in Talk, it
answers with the order ready to go. One tap opens Swiggy on their phone with the cart filled in; they check it and pay.

Code: `tulmi/src/sites/history/`, routes `tulmi/src/routes/bots/botsSiteHistory.ts`, screens
`tulmi/src/experience/bots/screens/sites/` (portrait, order card, order screen), the order branch in
`routes/bots/botsTalk.ts`, migration **0114**, tests `tulmi/tests/site-portrait.test.ts`, render sample
`scripts/bots-render/samples/sitePortrait.ts`. Behind `CLOUD_BROWSER`, like everything in sites: off, nothing runs.

## 1. Learning

```
the phone, signed in  →  an unseen SiteView reads the orders page (historyRead)  →  POST /sites/history/:site/read
  →  a tiny model (role site_orders) copies out the orders  →  merged into the history (site_orders)  →  the portrait
```

* **Only the site's own orders page, only on the phone, at most every 12 hours** (`HISTORY_EVERY_MS`). The reader is
  drawn by the Sites page, Your space and the portrait page when a read is due, so a portrait fills in after a sign-in
  with nothing else to tap.
* **The same page twice costs nothing**: its hash is kept, and an unchanged page is not sent to a model.
* **The page is data.** Fenced for the model, which is told to copy what it shows. The restaurant links the phone read
  are taken off the words before the model sees them and matched to places in code (`linkFor`): on the site's host, at
  its restaurant path (`placePath` in the catalog), never anywhere else.
* **History grows by reading.** The orders page shows the recent orders; each read adds the new ones (keyed by the
  site's order number), up to 120 a site.
* Which sites: a catalog entry in the Food category with an `orders` page (Swiggy today; Zomato's orders page has the
  person's id in its address, so it has none).

## 2. The portrait

`portrait.ts`, by rules, no model: free, and the same every time. From the orders that went through (never a
cancelled one): the usual (one place and the same dishes, at least twice, and when), the parts of the day, the days,
the places and their dishes, the usual spend, and a few plain sentences.

**Conclusions, not calculations.** What a person sees is what X0 worked out: "Biryani from Behrouz is your go-to",
"You mostly order dinner, around 8 pm", "Saturday is your food day". Never the counting behind it: no order counts, no
percentages, no charts, no list of what was read. The counts stay inside, where they decide things.

Where it shows:

* **The portrait page** (`bots.site.portrait`): the usual as the one dark card with "Order it now", what X0 noticed,
  your places (a tap orders what you like there), dishes you love, and "Forget what I learned".
* **A section per site**: a card per site on the Sites page ("What I know about you") and in Your space ("From your
  sites"), each opening its portrait.
* **What bots know**: Talk's bot is told a few lines of it (`portraitLines`, through `BotSites.snapshot` `habits`), as
  data, so "something I like" means something.

## 2b. Taste: why they choose, not only what

The portrait counts what someone did. Taste is why, and it is three layers (`src/sites/history/taste/`):

1. **Signals, by rules** (`features.ts`, free). What each dish says: heat, richness, sweetness, smoke, freshness,
   tang; its cuisine; the protein; veg or not. And how they choose: the share of orders that were a first time at a
   place (explore), exact repeats, how wide their cuisines run (an entropy), and what each moment of the week wants
   (weekday lunch, weekend dinner, late night) and costs. From these, one word for the chooser: creature of habit,
   explorer or balanced.
2. **The profile, by a reasoning model** (`profile.ts`, role `site_taste`, the cheap tier, not the tiny one). It reads
   the signals and the orders and writes: their palate (the liking behind dishes that look different), their motives
   (reliability over novelty, a treat at the end of the week), what each moment wants, and 3 to 5 dishes they would
   probably love and have not had. The psychology is in the role: a stable preference shows across moments, a
   situational one belongs to one; comfort when tired and late, reward at the end of a week, speed in the middle of one;
   someone who repeats will try one new thing only if it shares a defining trait with a favourite and differs in one
   way, so hunches are mostly near and one is a stretch at most, only for an explorer.
   **Grounded or dropped:** every trait, mood and hunch names the orders it rests on, and anything naming none, or
   orders that do not exist, is thrown away; a hunch that is something they already ordered is not a discovery and is
   thrown away too. **Nothing sensitive:** no guessing religion, caste, health, weight or money; veg is a preference.
   Worked out again only when the orders change (`hash`).
3. **Discovery, from the web** (`discover.ts`, role `site_discover`). For the best near hunches, the web is searched
   near where they order (`best mutton haleem restaurant Koramangala Bengaluru reviews`), a few pages are read, and the
   model picks a restaurant and a dish for this person. **Every pick carries a reviewer's own words**, and a pick whose
   quote, or whose place, is not on the page it names is dropped: the rule `src/discover/experiences.ts` keeps. Pages
   are untrusted data. Looked for at most once a day; and live, held to 12 seconds, when someone asks for a dish they
   have never ordered.

What a person sees is conclusions, never the counting: **Your taste** (the profile's sentences), **What you go for**
(palate and motives), **Your moments** (what each part of the week wants), and **You might love** (the places found,
each with its reviewer's quote, and the hunches nothing was found for yet, which open the site's search). Talk's bot is
told the same in a few lines.

## 3. Ordering

1. **Talk hears an ask** (`ask.ts readOrderAsk`, no model): a verb of getting and food, a food site or "the usual";
   Hinglish too ("biryani order karo", "kuch khane ko mangao"), and "I'm hungry". Never a question about an order that
   exists ("where is my order", "cancel my order") or a how-to.
2. **The planner picks** (`plan.ts planOrder`, no model): a dish or place they named narrows it; "the usual" weighs how
   often; "same as last time" is the newest; otherwise this part of the day and this day of the week, how often and how
   lately. Up to three, at different places. **What goes first is a judgement about the person:** a creature of habit
   gets their usual first and one new place beside it; an explorer, asked for nothing in particular, gets the new place
   first; "the usual" is the usual for anyone. A dish they have never ordered is a live find on the web, said through
   their taste, else the site's search. No history: no plan, and the door answers as before.
3. **Talk answers with the card** (`orderCard.ts`): the place, the dishes, about what it costs, why ("Your usual
   Saturday dinner"), one "Order this", and the line "I fill the cart on Swiggy while you watch. You check it and pay
   there." The options ride on the turn (`did.order`, `token.ts`) and are checked again whenever they are read back:
   every address https, on a site this server allows, the site the option names.
4. **The order screen** (`bots.site.order`): the plan in a card, and under it Swiggy's own page, signed in as them. The
   step (`phone.ts orderStep`) opens the restaurant from the search, presses "Add" by each dish once (the nearest block
   round the dish's name that holds exactly one "Add"), then "View cart". **It never presses pay**, never types, never
   leaves the site. What it pressed is kept in the tab's sessionStorage under the order's id (one a day), so a reload
   adds nothing twice. A dish it cannot find is left to the person.

**Why it needs no new app build.** Installed phones draw a SiteView in "signin" mode, which runs `shape` every two
seconds and `findLogin` once on each new page, both scripts from this server. An order is that mode with a `shape`
that always says "not a sign-in" and the step in `findLogin`. The window, or a phone without SiteView, gets the card and
a button that opens the site at the restaurant.

## 4. Money and manners

* One tiny model call per changed orders page, capped at `SITE_ORDERS_PAISE` (60). The taste profile, once per change
  of orders (`SITE_TASTE_PAISE`, 90). New places, at most once a day and per live ask (`SITE_DISCOVER_PAISE`, 160). The
  portrait, the ask and the plan cost nothing.
* Nothing is spent: the cart is the site's, and paying is the person's own tap on the site.
* "Forget what I learned" deletes the orders and the read marks (`DELETE /sites/history/:site`).

## 5. Setting it up

The migrations:

```
ssh root@91.108.104.168 "cd ~/tulmi && git pull --ff-only && ./deploy/migrate.sh 0114 && ./deploy/migrate.sh 0115"
```

New places use the server's web search, which works with no setting (DuckDuckGo's page); `WEB_SEARXNG_URL` or
`BRAVE_SEARCH_KEY` make it better (`tulmi/src/config.ts`).

Then it is on wherever `CLOUD_BROWSER` is on (with `CONNECTOR_TOKEN_KEY`), for the people `CLOUD_BROWSER_USERS` names.

## 6. What needs a live check

The step has been run in a real Chromium against a page built like a restaurant menu (`tests/site-portrait.test.ts`),
not yet on Swiggy itself with a signed-in account. The first live order should be watched: whether the restaurant is
found from the search, whether each "Add" is found, and how a "Customise" sheet or "Replace cart?" prompt is left for
the person.
