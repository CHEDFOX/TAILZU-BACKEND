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
4. **An arbitrary host is never reachable.** What a signed-in browser may be pointed at is the vetted catalog in
   `src/sites/catalog.ts` plus whatever an operator added in `CLOUD_BROWSER_SITES` — and that env list keeps its
   inverted meaning: it *adds* hosts, and empty adds none. Every other list in the config is "empty means
   everyone"; this one is the other way round on purpose, so a blank setting can never widen anything. The
   catalog is code rather than configuration for the same reason `web/search/catalog.ts` is: a list that decides
   where somebody types a password is a reviewed change with a test beside it, not a line on a server.

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

## Finding a site

A person types a name, not an address. The name is what picks the host: searching answers entries from
`src/sites/catalog.ts` and nothing else, and Sign in opens the page that entry names, so there is no query that
reaches the open web and no result whose domain the person has to read and judge. That judgement is the one
phishing relies on them making badly, and the whole value of typing "Swiggy" is that they never have to make it.

An entry's `signIn` is the site's own sign-in page, read from the site. The host is shown under the name — not to
be approved, but so that what they are about to sign in to is never a surprise. A site that moves its sign-in is
an edit to that file, which is a pull request somebody reads.

The catalog is short on purpose and grows one reviewed site at a time. A host an operator wants that is not worth
a catalog entry goes in `CLOUD_BROWSER_SITES` instead.

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

**It ends on a signal**, never a countdown: the page stopped looking like a sign-in page, or they left. The idle cut (90s) and the ceiling (5 min) are backstops for somebody who walked away. A quick
sign-in is over in seconds; a slow one gets as long as it needs.

**Nobody says they are in; the panel notices.** There was a button whose whole job was to make the server look at
the page, and the server can look by itself — every few seconds, not every poll, because a DOM read is not free.
Two things keep it honest. It will not close a panel that has never looked like a sign-in page: a page part way
through opening looks like nothing either, and shutting on that would write a signed-out session over a good slip
and call it success — the exact mistake the watcher made once. And the idle and total cuts stay as they were, for
somebody who walked away.

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

**And nothing else is on the screen.** No box to type in, no buttons: the page fills the card, a tap on it raises
the keyboard, and the way out is the screen's own back. What is left is the site, which is the point.

**There is no card of our own.** A panel once drew the page's boxes again underneath it, named and typed
(docs/sign-in.md). It went: the person is already looking at the real form and can touch it, so our copy was a
second form over the first, and the reason the whole sign-in happens in this browser is that it happens on the
site's own page. What is left is the page, a keyboard, and the two buttons.

**The card is the page itself**, on a card: the sign-in sits on one elongated sheet with the page behind it
blurred, to the app's own numbers (`app/src/sdui/components/blur.tsx`, `kit.ts` `sheetPage`).

**A tap is sent in the page's own pixels.** The frame is drawn at whatever size fits the phone; the browser is
412 x 915. Send the drawn numbers and every tap lands short and up-left, which on a sign-in page is the wrong field
or the wrong button. One handler does both jobs: a finger that moved under 10px is a tap, a dragged one is a scroll.

**The screen is never kept on the device.** A page with a cache time is written to AsyncStorage, and this one
carries the ticket. `keep: false` makes its `cacheTtlSeconds` 0, so the ticket exists in memory while the screen is
up and nowhere else. The list behind it is cached as it always was; this is about the one page with the secret in it.

**Opening the screen opens the browser.** `POST /panel` is the screen's own load, so a build with no LiveView is
never sent a panel and never opens one either — a real Chrome page held in the cloud for a phone that would show a
blank box is worse than a line saying so. The page's "Not now" closes it, ahead of the idle clock.

## Signed in on the phone

The panel streamed a desktop browser in the cloud to the phone. On real sites it lost twice over: the pages drew at
a desktop size nobody could touch, and a datacenter address is what shops' bot checks are built to stop. So for a
build that declares **`SiteView`**, the sign-in and the reading both happen **on the phone**, in a real WebView, and
the panel is only what an older build gets.

**The sign-in is the site's own page, on their phone.** `bots.site.signin` draws a `SiteView` (shared/types/sdui.ts
3e) at the catalog's `signIn` address: full size, their own keyboard, the SMS code filling itself in. Unlike
LiveView this WebView *keeps* what the site sets, so they stay signed in there the way any browser does. It may go
only to the site and the sign-ins it hands off to (`SIGN_IN_HANDOFFS`: Google, Apple), and the host is always shown.

**It always lands on the sign-in.** The catalog's address is only a start. The phone looks at the page every two
seconds (`phone.ts` `PAGE_SHAPE`); if it is not a sign-in, it presses the site's own "Sign in" (`FIND_LOGIN`), and
failing that tries the site's home once. Checked on real sites in a phone-sized Chromium (21 Nov 2026): Swiggy and
Flipkart open straight to the form; Blue Dart's home, then its own "Sign in", opens its drawer.

**Nobody says they are in; the phone notices** — with the panel's guard: never "signed in" until a sign-in has been
on screen, then two quiet looks in a row with no "Sign in" left on the page (`siteViewCore.ts` `signInStep`). Then
it calls `POST /sites/connected { site }`: **a host name, never a session.** The server keeps the fact
(`{ cookies: [], onPhone: true }`), under the site's one name (`gate.ts` `siteOf`: www.swiggy.com is swiggy.com).

**Reading is the phone's too.** Once connected, the sites screen offers "Watch orders" where the catalog knows the
site's orders page (`orders`). A watch whose turn it is gets an unseen `SiteView` in read mode on the sites screen:
it opens the page with the session already on the phone, reads it by the server's own walk (`READ_PAGE`, the same
code), and posts the words to `POST /sites/watch/:id/read`. From there it is the server's read exactly: signed out
or not, three strikes, the model's card. **The manners stay here:** a read before the watch is due is answered from
what the server already has, with no model call, and the screen only draws readers for watches that are due.

**The scripts live on the server**, passed in the node's props, so how a page is looked at and read changes when
this server deploys. Every message back from the page is untrusted, parsed and capped on the phone and capped again
by the route; the most a lying page can do is fake a read of itself for the one person looking at it.

**Forget** removes the fact here; the site's own sign-in stays in the phone's WebView until they sign out on the
site, as in any browser.

## What is built, and what is not

**Built:** the switch and its gates (`gate.ts`), the store (`store.ts`, migration **0098**), `engine.visit()`,
the page reader, the `site_read` role, the service and its manners (`service.ts`), and `tests/sites.test.ts`.

**Not built yet:**

* ~~**The routes and the screens.**~~ Built: `routes/bots/botsSites.ts`, `bots.sites` and the panel screen, and a
  way to add a site — a search over the catalog (`GET .../sites/search?q=`) that answers vetted entries only,
  each carrying that site's own sign-in page, reached from Connected apps. The Activity cards from the mock are
  still to come.
* **The clock.** `dueNow()` answers which things are due; nothing calls it on a schedule yet.
* **The phone's half of the panel.** The server side is done (`sites/panel.ts`, `sites/frames.ts`, `engine.hold()`,
  the routes); what is missing is the component that draws the frames and sends the taps. It lives in `app/**`, so
  shipping it publishes an OTA — a decision for the owner, not for a build.
* **Acting.** The other half, and a much bigger one.
