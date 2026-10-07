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

The `<img>` points at `https://api.tailzu.space/media/k/email.mark`, keyed by
NAME rather than by content hash. This HTML is pasted into Supabase by hand and
then sits there for months, so a hash in it would break the day anyone
re-uploads the icon.

The mark ships with the backend (`tulmi/brand/email-mark.png`: the app icon
cropped to its mark, rounded, 128 px for a 32 px slot), so the URL answers from
the first deploy with no upload. To change it, upload under the key, and that
copy wins from then on:

```bash
curl -X POST "https://api.tailzu.space/v1/media/upload?key=email.mark" \
  -H "x-admin-secret: $ADMIN_SECRET" -F "file=@new-mark.png"
```

The mark stands alone, with `alt="Tailzu"`: most clients block remote images
until the reader allows them, and those draw the alt text in the image's place,
so the mail still says who it is from at the moment it asks for trust.

## The look

The phone app's look (`PHONE_LOOK` in `src/experience/phoneLook.ts`), and as
little as a code needs: the mark, the code, one label under it,
and one line at the foot. Amber only on the code, which is what is still in
play for the next hour; everything else in cream stepped down. Two of the
app's faces: the label face (IBM Plex Mono) for the code and its label, the
UI face (Instrument Sans) for the foot.

| Role | App token | In the mail |
| --- | --- | --- |
| Ground | `ground` | `#0F0D0B` |
| Ink | `ink` | `#F3E2C6` |
| Labels, small print | `ink3`, cream at 50% | `#817869` |
| Hairline | `rule`, cream at 7% | `#1F1C18` |
| The code | `accent` | `#E8A23C` |

## Why the HTML looks like 2005

Email is not the web. There is no flexbox, no grid, no external stylesheet worth
relying on, and no webfont that loads everywhere. Layout is nested tables,
styling is inline attributes, and every colour is a flat hex: `rgba()` renders
as black or as nothing across enough clients to be unusable, so the app's
translucent inks are pre-flattened against the ground (the table above).

The fonts come from Google Fonts. Apple Mail, iOS Mail, Samsung Mail and
Outlook for Mac load them; Gmail and Outlook on Windows do not, and each stack
ends in a system face that keeps the same voice (Menlo or Consolas for the
mono, the system sans for the UI face).

## The ground covers the whole screen

A mail is drawn inside the client's own page, and each client honours a
different place for a background, so the ground is painted in all of them: the
`html` and `body` (Apple Mail and iOS Mail, including the overscroll), the
`bgcolor` attributes (Gmail drops the body's style), a wrapper table at full
width and at least a screen tall (`height="100%"`, `min-height:100vh`, and a
760 px floor for the clients that ignore viewport units), and VML for Outlook
on Windows, whose Word engine paints nothing else. Nothing white is left around
or under the mail.

## Dark by design

The design is dark in light mode and in dark mode, and says so
(`color-scheme: light dark`), which tells Apple Mail and Outlook that the
palette is handled and they leave it alone. Outlook.com's dark mode is held by
the `[data-ogsc]` / `[data-ogsb]` rules. Every colour is also restated on its
element, because inherited colour is the first thing a dark-mode pass throws
away.

One client cannot be held: the Gmail app on iPhone in dark mode inverts every
mail, dark ones included, so there it shows light with dark text. It stays
readable, which is the point; the tricks that fight it (background images, blend
modes) leave the text unreadable whenever they half-work.

## After editing

Test with an address that has **never** signed in, then with one that has.
Testing one proves nothing about the other: that is the whole bug the two
identical templates exist to prevent. `test.py` in CHEDFOX/xooteq-mail sends a
real code through Supabase and the mail server and reports Gmail's answer.
