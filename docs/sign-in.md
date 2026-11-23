# Signing in, on a site nobody wrote code for

Ask can act on a screen, but it must never sign in as somebody. A password, a one-time code, a CAPTCHA and
card details are theirs, always: Ask stops and hands over. That is `HANDOVER`, and it has been there from the
start (`src/agent/lines.ts`).

What it used to hand over was a sentence. *"Sign in, then press Continue."* The person then looked at a page
and did the work, which is fine on a computer they are sitting in front of and poor everywhere else — on a
phone watching a page somewhere far away, it is almost nothing.

So the planner may now **describe the boxes**, and the person is given those boxes instead of a page.

```
SAY I'll need you for this bit.
FIELD e14 phone  | Phone number
FIELD e21 code   | The code they texted you
ALSO  e30        | Continue with Google
HANDOVER login | Sign in to Swiggy and I'll carry on.
```

Nothing above is written per site. The planner reads `<screen>` — the real fields, the real buttons, the real
labels, in whatever language the page is in — and names them. A shop in Tamil that nobody has ever heard of
goes through the same code as Swiggy, because there is no code for either.

## The rules it is given

In `SIGN_IN_NOTE` (`src/agent/prompt.ts`), the whole of what makes a card good:

| | |
|---|---|
| **S1** | Name only what is really on this screen. Never a box the page does not have. |
| **S2** | One card, one moment: what it asks for now, not the step after. |
| **S3** | Name every way in the page offers — phone, email, Google, Apple. They rarely remember which one they used. |
| **S4** | Label each box in their own language, as the page labels it. |
| **S5** | `secret` is a password, `code` is a one-time code. Hidden as typed, kept nowhere. |
| **S6** | Unsure? Write no `FIELD` lines. The plain handover shows them the page, which always works. |
| **S7** | Never a card for a payment or a CAPTCHA. Those belong on the real page, and only there. |

They are paid for only on a screen that looks like a sign-in (`looksLikeSignIn`), the way `JOB_NOTE` and
`CONTEXT_NOTE` are paid for only when they apply, so the stable block and every ordinary step cost nothing.
The two verbs themselves are in the contract (`src/principles/roles.ts`), which is two lines.

## The window draws the ways in now

**Built (17 Nov):** the `ALSO` lines reach the handover card as buttons. Each is a real control on that screen — the
server checked every id against the screen list and dropped the rest before it left — so the button simply presses it
(`TAILZU-DESKTOP/src/agent/run/agent.js` `handover`, `waysOf`).

Pressing one does **not** finish the handover: starting a way in is the beginning of their part, not the end, so the
card comes back and waits, and only Continue or Stop ends it. A press that fails is logged and the card still comes
back, because the page is theirs to finish either way. At most four, no repeat, and nothing without both an id and a
label — the window does not trust the cap, it keeps its own.

Why this half first: rule S3 exists because people rarely remember **which** way they signed up with, and a page's own
buttons are often below the fold or behind "more options". The card puts the real choices in front of them, and it
needed no decision about anything.

## The switch

`SIGN_IN_CARD`, **off**, staged by `SIGN_IN_CARD_USERS`. Off, the planner is not told the card's rules (so they are not
paid for either), any `FIELD` or `ALSO` it writes anyway is dropped and counted in `cardDropped`, and a handover carries
no card — the plain one, the page itself, which always works.

It exists for a specific reason: **everything the card draws lives in the window's own page** (`guide.html`), which only
a new build can change. Without a switch here, a card that came out wrong would need a release to undo. With it, the
card is turned off from the server and the next sign-in is the one people had yesterday.

## The boxes, and the one moment the window takes the keyboard

**Built (17 Nov).** The card draws the page's real boxes, named in the person's own language. A `secret` and a `code`
are hidden as typed (rule S5), nothing asks the browser for autofill (`autocomplete="off"`, because this is not the
site's own page and must never look to the browser as if it were), and nothing is remembered: the values live in the
inputs, go across once on Continue, and go with the card.

**The window is never focusable except for this.** That flag is load-bearing — the app being worked on keeps the
keyboard, and a dictation's paste must land in it — so `ask.js` turns it on while a card with boxes is up and off again
in a `finally`, where a thrown or cancelled card cannot leave the window able to steal the next keystroke.

**Then: the app first, the boxes after.** On Continue the agent gives the keyboard back to the app they were in
(`drive("open", run.app)`) before setting anything, because a field cannot be set in an app that is behind. Each box is
set by the id the CARD named, so a value for an id the card did not name is ignored. **What they typed is not logged
and does not enter the run's history** — the log says which box was filled and never what went into it, and a test
holds that their password and address appear nowhere in what is sent.

**And a way out of all of it:** a sign-in handover also offers **"Sign in in X0 Bot's browser"**, which opens the Sites
list in the app — the same flow the phone uses (`docs/sites.md`). The person picks the site there and signs in on a
real page in our own browser, which keeps the session; the card stays up here, and they press Continue when they are
in. It opens the LIST rather than a panel at a guessed address, because the window knows the site in front only by its
display name ("Swiggy") and never its domain.

**There is still no test for the card's own drawing** — `src/agent/guide/` has none, and `node --test` has no DOM. Look
at it with **`guide.html?demo=signIn`**, which draws the whole card still: two boxes, three ways in, the browser button,
Continue and Stop.

**Why it was left until last.** The guide's window is deliberately never focused — the app being worked on
keeps the keyboard, and a dictation's paste must still land in it (`src/agent/ask.js`, "THE PILL'S RECIPE") — so it
cannot take a keystroke, let alone a password. That is a decision, not an omission, and there are three ways out: make
the window focusable for that one moment and hand focus back; a separate window that may take the keyboard; or the
cloud browser's panel in a `LiveView`, which both clients already have and which never holds the secret itself (each
character goes to the real page and the box is emptied before the call goes out). Until one is chosen, every `FIELD`
line still ends in a correct plain handover.

`looksLikeSignIn` is a cheap guess and is meant to be: the focused field's kind says password, or there is a
box to type in on a screen that also says one of the things a sign-in page says. It is wrong in the safe
direction both ways. A page it misses gets the plain handover every sign-in page got before this existed. A
page it calls one in error costs seven lines the planner can ignore. It decides nothing by itself.

## What the reader will not let through

`LineReader` builds the card (`src/agent/lines.ts`), and a `FIELD` is dropped — silently, counted in
`cardDropped` for the step's log — unless it survives all of this:

- **An id on this screen.** Same rule as every other id. A box that types into a field the planner imagined is
  worse than no box, because the person would believe it worked.
- **Not an OCR line.** An `o` id is words read off the pixels with nothing behind them. An action already
  refuses one; so does a card.
- **Not a repeat.** The same id twice is the model saying it twice. A way in cannot also be a box.
- **Within the caps.** Six boxes, four ways in. A sign-in page asks for one or two things; six is already a
  form nobody should meet on a phone.

And two rules the card cannot talk its way past:

- **No boxes, no card.** The handover goes out with its sentence alone and the person sees the page. This is
  S6 enforced rather than requested, and it is why the card is always safe to ship: it is an improvement on
  showing the page, never a replacement for it.
- **`login` and `code` only** (`CARD_WHY`). Never `payment`, however many `FIELD` lines were written — Ask does
  not take card details, so it must not draw boxes that ask for them. A card-shaped thing asking for a card
  number is what a phishing page looks like, and a person should only ever meet that on the real page. Never
  `captcha` either: a squiggle has to be seen.

Neither a show run nor the picture path builds one. Neither of them signs anybody in.

## What the client does with it

`card` rides on the `handover` event beside `text`. A client that does not know the field ignores it and shows
the sentence, exactly as today — which is the other reason the card can never be the only way through.

A client that does know it draws the boxes, and then, on Continue:

1. types each answer into that field's own `id`, on this same screen;
2. presses the page's own button;
3. sends the step on as it always did.

The answers go to the page and nowhere else. A `secret` is never written to the history, the ledger, or a log;
the history turn stays `{ did: "HANDOVER", result: "ok" }` and holds nothing the person typed. Beside the card
there is always *show me the page*, because S6's fallback has to be reachable even when the card looked fine
and was not.

## Built, and not built

The whole of the above is the server's half, and it is done: the protocol, the rules, the reader, the event,
and `tests/agent-signin.test.ts`.

The desktop draws it (17 Nov). **The sign-in panel of a person's own browser does not, and deliberately.** One was
built there and taken out again the same day: a panel already shows the real page and the person can touch it, so
a card of named boxes under it was a second form over the first — and the whole reason a sign-in happens in that
browser is that it happens on the site's own page. A card earns its place in the desktop, where the agent is
driving an app the person is not looking at. It does not earn it where they are looking straight at the page.

What that leaves for a browser surface: the page, drawn large, on a card of its own. If this is ever revisited,
the thing to beat is not "no card" — it is "the page, legible".

## The session behind it

A card is only worth building because the sign-in happens **once**. What is kept afterwards is the slip the
site hands the browser, never the password and never the code. Sessions mostly die of inconsistency rather
than age, so the browser a person signs in on should stay theirs: the same profile, the same region, the same
user-agent, the whole profile folder and not only its cookies. A quiet visit about once a week keeps it warm;
an hourly one looks like a robot and loses the session faster than doing nothing.

None of which survives them changing their password or signing out everywhere, and nor should it. That is the
handover's other job, and it is why it stays.
