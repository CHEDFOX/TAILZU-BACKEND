# What X0 has ready for you on a site, and what it did for you

A person connects a site once (docs/sites.md, "Signed in on the phone"): Swiggy, Amazon, Flipkart. From then on X0
learns from that site's own orders page, works out what they like and why, and keeps something ready: their usual,
what is about to run out, something new it found for them with what people who had it say. "Order my usual", "khana
mangwa do", "reorder my detergent" in Talk is answered with that, and one tap opens the site on their phone with the
cart filled in. They check it and pay.

**What a person sees is what X0 has for them and what it did for them, never how it learned them.** The analysis is
real and deep (§2b), and all of it is used to choose; none of it is shown, because showing the workings reads as being
watched (§4).

**One pipeline for every site.** Reading, the history, the usual, the chooser, what is due again, taste, discovery and
filling a cart are the same code for a restaurant and a shop. What differs by kind is one entry in
`tulmi/src/sites/history/kinds.ts` (§1b).

Code: `tulmi/src/sites/history/` (and `taste/`), routes `tulmi/src/routes/bots/botsSiteHistory.ts`, screens
`tulmi/src/experience/bots/screens/sites/` (`forYou.ts`, `orderCard.ts`, `order.ts`, `data.ts`), the order branch in
`routes/bots/botsTalk.ts`, migrations **0114**, **0115**, **0116**, tests `tulmi/tests/site-portrait.test.ts`, render
sample `scripts/bots-render/samples/sitePortrait.ts`. Behind `CLOUD_BROWSER`, like everything in sites: off, nothing runs.

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
* Which sites: **any catalog entry with an `orders` page**, whatever its kind: Swiggy, Amazon and Flipkart today.
  Zomato's orders page has the person's id in its address and IRCTC has none, so neither is read yet; each is one line
  in `catalog.ts` away when it does.

## 1b. One pipeline, a few words per kind

`kinds.ts` holds everything that differs between a food site and a shop, one entry a kind (food, shopping, travel,
parcels), chosen by the site's catalog category:

| | food | shopping |
| --- | --- | --- |
| an order is | dishes from a restaurant | products from a brand |
| the lexicon reads | cuisine; heat, richness, sweetness, smoke, freshness, tang; protein | category; value packs, premium, natural, fitness-minded |
| an order starts at | the restaurant (its link, else the site's search for it) | the product (its link, else the site's search for it) |
| the cart is filled | menu: open the restaurant, Add by each dish, View cart | product: open the product, Add to cart, Go to cart |
| "about time for more" | no | yes: things run out |
| somewhere new is searched as | best {dish} restaurant {area} reviews | best {product} India reviews |

Everything else — the history, the usual, repeat or explore, what each moment wants, the rebuy rhythm, the taste
profile, discovery with verified quotes, the planner, the cards — is one code path. Adding a kind is an entry here and
a category in the catalog.

**The rebuy rhythm** (`features.ts rebuysOf`, universal): anything bought on three or more different days has a rhythm
(the median gap); it is due when today is nine tenths of the way to the next one, so the nudge comes a little before
it runs out. Two buys are a coincidence and make no rhythm.

## 2. What is counted

`portrait.ts`, by rules, no model: free, and the same every time. From the orders that went through (never a
cancelled one): the usual (one place and the same items, at least twice, and when), the parts of the day, the days, the
places and their items, the usual spend. None of it is shown as it is: it decides what is ready (§4) and what Talk
offers, and Talk's bot is told a few lines of it as data (`portraitLines`, through `BotSites.snapshot` `habits`).

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

None of the profile is shown. It decides what comes first and what is new in what is ready (§4), and Talk's bot is told
its insights in a few lines so "something I'd like" means something. What a person meets of it is the result: a new
place or product on their page and in Talk, with why it is for them and what someone who had it said.

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

## 4. The page: Ready for you, Done for you

`bots.site.portrait` (screens/sites/forYou.ts), one per site, the same for every kind:

* **Ready for you**: the planner Talk answers with, asked for nothing in particular (`plan.ts readyFor`), so the page
  and the chat never disagree. The lead is the one dark card ("Your usual", "About time for more", "Again?", "Picked for
  you") with "Order it now" or "Buy it now"; then what is new, each with its reason and a reviewer's words; then the rest
  as quiet rows. Up to four.
* **Done for you**: what X0 actually did there, newest first. Carts it filled (noted when the order screen opens, once
  an order: `POST /sites/did`), new places or things it found (noted when discovery finds them, once a day), and orders
  the watcher saw through to the door (read from the watches). Table `site_did`, migration 0116.
* **Forget all of it**, and one line on what it is made from and what is never kept.

Not shown, on purpose: the taste profile, habits, moments, charts, counts, percentages, the list of orders read.

A section per site: on the Sites page ("For you") and in Your space ("From your sites"), a card per site says what is
ready there and the last thing done, and opens its page.

## 4c. Real pictures

Every card shows the real thing: the dish or the product, not an icon.

* **What they ordered** carries the picture the site itself shows for it. The phone's read of the orders page
  (`phone.ts historyRead`) also lists each picture with what it is of (its alt text, else the words beside it), and the
  server matches pictures to dishes, products and restaurants by name (`pictures.ts imageFor`). Kept with the order
  (`items[].image`, `site_orders.image`, migration 0117), and kept when a later read does not show it.
* **Something new** gets a freely licensed photo of the dish from Wikimedia Commons (`src/discover/photos.ts`, the travel
  catalogue's source), with its credit under it. Food only: a photo of "a hair oil" is not that hair oil, and a wrong
  product picture is worse than none.
* **Only from two places.** A picture loads by itself, so every address is checked against the site's own image servers
  (`images` in `catalog.ts`: Swiggy's, Amazon's, Flipkart's, Zomato's) and Commons, https only, on the way in and again
  in the card's token and the screen's cleaner (`pictures.ts safeImage`). A card with no picture shows its kind's mark on
  grey; it never borrows one.
* **Where they show:** the lead card's photo runs edge to edge above its dark panel; "New for you" and Talk's order card
  open with the photo; rows, the per-site cards and "Done for you" carry thumbnails.

The renders use stand-in photos (free Unsplash pictures swapped in at render time), because a render must not reach the
real sites; the addresses in the sample are on the real image hosts so they pass the same checks.

## 4b. Money and manners

* One tiny model call per changed orders page, capped at `SITE_ORDERS_PAISE` (60). The taste profile, once per change
  of orders (`SITE_TASTE_PAISE`, 90). New places, at most once a day and per live ask (`SITE_DISCOVER_PAISE`, 160). The
  portrait, the ask and the plan cost nothing.
* Nothing is spent: the cart is the site's, and paying is the person's own tap on the site.
* "Forget what I learned" deletes the orders and the read marks (`DELETE /sites/history/:site`).

## 5. Setting it up

The migrations:

```
ssh root@91.108.104.168 "cd ~/tulmi && git pull --ff-only && ./deploy/migrate.sh 0114 && ./deploy/migrate.sh 0115 && ./deploy/migrate.sh 0116 && ./deploy/migrate.sh 0117"
```

New places use the server's web search, which works with no setting (DuckDuckGo's page); `WEB_SEARXNG_URL` or
`BRAVE_SEARCH_KEY` make it better (`tulmi/src/config.ts`).

Then it is on wherever `CLOUD_BROWSER` is on (with `CONNECTOR_TOKEN_KEY`), for the people `CLOUD_BROWSER_USERS` names.

## 6. What needs a live check

The step has been run in a real Chromium against pages built like a restaurant menu and a shop's search and product
page (`tests/site-portrait.test.ts`), not yet on Swiggy or Amazon themselves with a signed-in account. The first live order should be watched: whether the restaurant is
found from the search, whether each "Add" is found, and how a "Customise" sheet or "Replace cart?" prompt is left for
the person.
