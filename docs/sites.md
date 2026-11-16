# A browser that belongs to the person

`CLOUD_BROWSER`, off. Nothing here runs, and nothing is kept, until it is on.

Most of what people want checked lives behind a login on a site with no API, and never will have one: where the
parcel is, whether the passport moved, what the bill is. Nobody is going to write a connector for a state
electricity board. So instead of an integration per site, there is a browser per person, signed in once, read
when there is a reason.

## Read only, on purpose

Acting on a strange site works perhaps two times in three. **Reading one works nearly always**, and that is the
whole bet of this first half: there is no button to misclick, no order to place, nothing to spend. The worst a
strange page can do is be misread, and a misread card is wrong rather than expensive.

Nothing in `src/sites/` can press, type or pay. The verbs do not exist here.

## The loop

```
their phone  →  the browser opens the page AS THEM  →  the page becomes words and elements
             →  a small model turns it into a card  →  Activity draws it  →  the session is saved back
```

`engine.visit()` (`src/web/browser/engine.ts`) is the new part of the browser, and it is deliberately small: a
fresh context, filled from the saved session, navigated, read, thrown away. **The browser keeps nothing between
visits.** There is no live session to leak, nothing to expire on a timer, and a crash costs a visit rather than a
login. The state lives in the database; the browser is scenery.

Carrying the session back out is not optional. A site refreshes its own cookies as it is used, so writing back
only what you sent in makes the slip go stale and signs them out within days.

## What is kept, and what is never kept

**Never:** a password, a one-time code, a card number. Those go from the person to the site and are held by
nobody. The page reader does not even read the value of a password box.

**Kept:** the cookies and local storage of one site, encrypted with `CONNECTOR_TOKEN_KEY` exactly as a
connector's token is (`src/connectors/crypto.ts`). With no key nothing is written at all — `encrypt` throws and
the sign-in fails loudly rather than quietly keeping a secret in a table.

**One profile per site, not per person.** Somebody signed in to four shops has four rows and four separate
cookie jars, so one shop's session being read tells you nothing about the other three.

## The manners, which are the real design

A shop that shuts a real person's account has cost them more than this feature is worth. So:

1. **Only while something is open.** A delivery arrives and the looking stops the same minute. A site that sees
   one look while a parcel is out reads as a person; the same site seeing a heartbeat all day reads as a scraper.
2. **Never sooner than `CLOUD_BROWSER_EVERY_MIN`** (20), whoever asks.
3. **At most `CLOUD_BROWSER_WATCHES`** (6) things open per person.
4. **`CLOUD_BROWSER_SITES` is empty by default and empty means NONE.** Every other list in the config is "empty
   means everyone"; this one is inverted on purpose. Nobody should be able to point a signed-in browser at an
   arbitrary host because a setting was left blank.

## Being signed out

Judged on what came back, not on a status code, because a site that has signed you out usually answers 200 with
its sign-in page on it (`looksSignedOut`: the address, the title, or a password box on the page).

When it happens, **nothing is saved**. This matters more than it looks, and the test
`three refusals in a row and it stops` exists because the first version got it wrong: saving the session before
checking wrote a *signed-out* session over the good slip — logging them out for real — and reset the refusal
count, so three strikes could never add up and nobody was ever asked to sign in again.

Three refusals in a row and the watch stops and the screen asks them to sign in again.

## A failed read is not a blank card

Whatever goes wrong — the site is down, the page will not open, the model gives nothing usable — the watch keeps
the card it had and tries later. An empty card reads as "nothing is happening", which is a lie about a parcel
that is merely on a page we could not open.

## The page as the model sees it

`READ_PAGE` (in `engine.ts`) walks the DOM into the same element list the planner reads everywhere else, so a web
page and a Mac window arrive at the model looking the same. Judged on **computed** style, so a node hidden by a
stylesheet is gone — which an HTML scrape cannot tell.

Four things it was got wrong on first and now gets right, each found by running it against a real page rather
than by reading it:

* A parent's `opacity` and `visibility` do not appear in a child's computed style, so a whole faded-out subtree
  came through. `checkVisibility()` walks the ancestors.
* A password box was `field`, indistinguishable from any other box. It is `secret`, and never carries a value.
* A tickbox's value is the string `"on"`, which is noise; `checked` already says it.
* A hidden input is not an element.

**The page's text is untrusted.** It is fenced before the model sees it, like every other outside text here,
because a page can carry words meant for the reader rather than the person — including words nobody can see,
since text faded to nothing is still text in `innerText`. The model is told to report what the page shows, and
is given nothing it could act on even if it were talked into wanting to.

## The panel

The one place a person touches their cloud browser, and it exists for a reason that cannot be designed around:
**the cookie lands where the handshake finishes.** Sign in on your phone's own browser and the shop sets its cookie
*there*; this server is still signed out, and no browser hands another site's cookies to an app. So the sign-in has
to happen in the browser that will keep it — which means seeing that browser, once, for half a minute.

It is not a browser. No address to type, pinned to the hosts it opened for, closed the moment the sign-in is done.

**Nothing runs on a clock.** Chrome's screencast fires only when the page changes, so a still page costs nothing.
On top of that `FrameGate`: 4 frames a second while a page merely fidgets (a spinner firing 62 times a second is
held to 4), 12 for the second after a touch because that is when a person is watching, and when frames outrun the
cap the newest is kept and the rest dropped — an old frame is not worth sending late.

**It ends on a signal**, never a countdown: the page stopped looking like a sign-in page, or they said they were in,
or they left. The idle cut (90s) and the ceiling (5 min) are backstops for somebody who walked away. A quick
sign-in is over in seconds; a slow one gets as long as it needs.

**"I'm signed in" is checked, not believed.** If the page is still a sign-in page the panel stays open — closing
there would save a signed-out session over a good one, which is the exact mistake the watcher made once.

### On the phone, and why it is not an app component

**The panel is a PAGE this server writes** (`src/sites/panelHost.ts`), shown in the `LiveView` node the apps already
have. It was going to be a component of their own; it is not, and the reason is worth keeping: a component ships in
a store build, and a store build is weeks. As a page, the frame clock, the tap arithmetic and the keyboard all ship
when this server deploys — so how signing in works can change the same afternoon, and **a phone that has never
heard of sites can draw one today**, with no update at all.

What the page may do, and nothing else: talk to this API (`connect-src`), draw frames as `data:` images, and run its
own one script, named by its hash. No other script, no font, no stylesheet, no frame, no form, no base to be moved
to. LiveView runs it in a WebView whose storage is its own and empty, and a page the server wrote never navigates.

**It has a ticket, not a token.** A LiveView cannot see the app's bearer token — that is in SecureStore, behind the
Keystore, in a process the page is not in — and it must not be handed one. So the panel mints a secret of its own,
and it is deliberately the smallest one that can exist: it is THIS panel, there is no other call it opens and
nothing it can read; it dies with the panel, which is five minutes at the outside; it is written into the HTML and
nowhere else — no state path, no cache, no log. The four ticket routes answer `Access-Control-Allow-Origin: *` and
take no cookie, which is safe precisely BECAUSE the ticket is the whole of the authority: there is no ambient
credential for another origin to ride on. (It is needed because Android gives a page loaded from HTML-with-a-base-URL
an origin that is sometimes opaque, and without it the panel would work on one phone and not the other.)

**Nothing typed is kept.** The box is a keyboard, not a field: each character is sent as it is typed and the box is
emptied *before the call goes out*, so a password is in the page for one keystroke and never in anything that
outlives the keypress. The characters appear where the real page draws them — as dots, because the site masks its
own password box. Which is also why nothing here has to know which box on the page is a secret: it never holds the
secret. Autocorrect, autofill, capitals and spellcheck are all off, because a suggestion would type something into
a field nothing on this side can see the name of.

**A tap is sent in the page's own pixels.** The frame is drawn at whatever size fits the phone; the browser is
412 x 915. Send the drawn numbers and every tap lands short and up-left, which on a sign-in page is the wrong field
or the wrong button. One handler does both jobs: a finger that moved under 10px is a tap, a dragged one is a scroll.

**The screen is never kept on the device.** A page with a cache time is written to AsyncStorage, and this one
carries the ticket. `keep: false` makes its `cacheTtlSeconds` 0, so the ticket exists in memory while the screen is
up and nowhere else. The list behind it is cached as it always was; this is about the one page with the secret in it.

**Opening the screen opens the browser.** `POST /panel` is the screen's own load, so a build with no LiveView is
never sent a panel and never opens one either — a real Chrome page held in the cloud for a phone that would show a
blank box is worse than a line saying so. The page's "Not now" closes it, ahead of the idle clock.

## What is built, and what is not

**Built:** the switch and its gates (`gate.ts`), the store (`store.ts`, migration **0098**), `engine.visit()`,
the page reader, the `site_read` role, the service and its manners (`service.ts`), and `tests/sites.test.ts`.

**Not built yet:**

* **The routes and the screens.** Nothing in the app can reach this. It needs `GET/POST /v1/sites`, the Activity
  cards from the mock, and a way to add a site.
* **The clock.** `dueNow()` answers which things are due; nothing calls it on a schedule yet.
* **The phone's half of the panel.** The server side is done (`sites/panel.ts`, `sites/frames.ts`, `engine.hold()`,
  the routes); what is missing is the component that draws the frames and sends the taps. It lives in `app/**`, so
  shipping it publishes an OTA — a decision for the owner, not for a build.
* **Acting.** The other half, and a much bigger one.
