# Auth email templates

Paste these into **Supabase → Authentication → Email Templates**. There are two,
and BOTH are required — GoTrue picks by account state, not by which call the app
made:

| The address is        | Template            | File                  |
| --------------------- | ------------------- | --------------------- |
| new to the project    | **Confirm signup**  | `confirm-signup.html` |
| already a user        | **Magic Link**      | `magic-link.html`     |

They are byte-identical apart from the comment at the top. That is deliberate:
the user asked for a code and does not care which of Supabase's internal paths
answered, so the two must be indistinguishable in the inbox. Fixing one and not
the other is what makes codes look random — a new tester gets a code, the same
person signing in again gets a link.

## The icon

The `<img>` points at `https://api.tailzu.space/media/k/email.icon`, keyed by
NAME rather than by content hash. This HTML is pasted into Supabase by hand and
then sits there for months, so a hash in it would break the day anyone
re-uploads the icon.

The art ships with the backend (`tulmi/brand/email-icon.png`: the app icon,
rounded at 22.37% as a launcher rounds it, 224 px for a 56 px slot — the
halftone needs that much to stay dots on a retina screen), so the URL answers
from the first deploy with no upload. To change it, upload under the key, and
that copy wins from then on:

```bash
curl -X POST "https://api.tailzu.space/v1/media/upload?key=email.icon" \
  -H "x-admin-secret: $ADMIN_SECRET" -F "file=@new-icon.png"
```

`email.mark` is the name the first templates used. It still answers, with the
same file, because an old copy of this HTML may be sitting in a Supabase
project somewhere — but it has an upload in front of it (the old X0 Bot mark,
three white squares on brown), so a template that names it shows that until
someone clears or replaces it. New templates name `email.icon`.

The icon stands alone, with `alt="X0 Bot"`: most clients block remote images
until the reader allows them, and those draw the alt text in the image's place,
so the mail still says who it is from at the moment it asks for trust.

## The look

The sign-in screen's look — the one the reader is holding while they read this
(`OB` in `src/experience/onboard/kit.ts`, and the `CodeEntry` props in
`src/experience/onboard/auth.ts`) — and as little as a code needs: the icon,
the screen's own heading, the code, one label under it, and one line at the
foot.

The code is drawn as its box is drawn on that screen: the neon ring, white
fill, ink edge, digits in the heading's face. Neon is the app's one live
colour, and for the next hour the code is what is live; nothing else in the
mail is coloured. One box around the whole code, never one per digit — a
copied code must paste as the code, and iOS only offers it from Mail when it
can read it as one run; the letter spacing separates the digits instead.

Two of the app's faces: Bricolage Grotesque (`PHONE_FONT.grotesk`, cut to 800)
for the heading and the digits, exactly as the screen sets them, and Instrument
Sans (`PHONE_FONT.ui`) for the small print.

| Role | App token | In the mail |
| --- | --- | --- |
| Ground | `OB.paper` | `#EFEDE8` |
| The code box | `OB.white` | `#FFFFFF` |
| Its edge, and all ink | `OB.ink` | `#1C1A17` |
| The foot | `OB.ink2`, ink at 70% | `#5B5956` |
| Labels, small print | `OB.muted`, ink at 56% | `#797773` |
| Hairline | `OB.hair`, ink at 13% | `#D4D2CD` |
| The ring around the code | `OB.neonSoft`, neon at 20% | `#CBF1BE` |

## Why the HTML looks like 2005

Email is not the web. There is no flexbox, no grid, no external stylesheet worth
relying on, and no webfont that loads everywhere. Layout is nested tables,
styling is inline attributes, and every colour is a flat hex: `rgba()` renders
as black or as nothing across enough clients to be unusable, so the app's
translucent inks and its neon are pre-flattened against the ground (the table
above).

The fonts come from Google Fonts. Apple Mail, iOS Mail, Samsung Mail and
Outlook for Mac load them; Gmail and Outlook on Windows do not, and both stacks
end in the system sans, which keeps the voice if not the cut.

## The ground covers the whole screen

A mail is drawn inside the client's own page, and each client honours a
different place for a background, so the ground is painted in all of them: the
`html` and `body` (Apple Mail and iOS Mail, including the overscroll), the
`bgcolor` attributes (Gmail drops the body's style), a block around the mail
that is at least a screen tall, and VML for Outlook on Windows, whose Word
engine paints nothing else.

Two holds keep it at least a screen tall, so losing one never shows white.
The block is a `div` at `min-height: 100vh` (a minimum height is ignored on
tables and their cells). Most clients know viewport units, and in a webmail
`100vh` is the browser's window, taller than the pane the mail sits in, so the
first screen is always covered. For the clients that do not know viewport
units, or resolve them to nothing, the table cell has a height that grows with
the screen's width: 960 px, 1240 px from tablet width, 1500 px from wide
desktops, since a taller screen is a wider one. Checked at ten sizes from a
375 x 667 phone to a 2560 x 1440 desktop, with and without viewport units.

## Light by design

The sign-in screen is light, so the mail is. Saying `color-scheme: light` and
nothing else tells Apple Mail and Outlook the palette is handled and they leave
it alone rather than repainting it for dark mode. Outlook.com's dark mode is
held by the `[data-ogsc]` / `[data-ogsb]` rules. Every colour is also restated
on its element, because inherited colour is the first thing a dark-mode pass
throws away.

One client cannot be held: the Gmail app on iPhone in dark mode inverts every
mail, so there it shows dark with pale text and the icon tile goes pale at its
corners. It stays readable, which is the point; the tricks that fight it
(background images, blend modes) leave the text unreadable whenever they
half-work.

## After editing

Test with an address that has **never** signed in, then with one that has.
Testing one proves nothing about the other: that is the whole bug the two
identical templates exist to prevent. `test.py` in CHEDFOX/xooteq-mail sends a
real code through Supabase and the mail server and reports Gmail's answer.
