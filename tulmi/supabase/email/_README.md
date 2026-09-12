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

The `<img>` points at `/media/k/email.mark`, a redirect keyed by NAME rather
than by content hash. This HTML is pasted into Supabase by hand and then sits
there for months, so a hash in it would break the day anyone re-uploads the
icon — silently, in mail nobody on the team receives. Upload to the key and the
template follows:

```bash
curl -X POST "https://api.tailzu.space/v1/media/upload?key=email.mark" \
  -H "x-admin-secret: $ADMIN_SECRET" -F "file=@app/assets/icon.png"
```

The word "TAILZU" sits under it and is not decoration. Most clients block remote
images until the reader allows them, and a mail whose only identification is a
broken image tile looks like phishing at the exact moment it is asking for
trust. The word carries the identity; the icon makes it feel like the app.

## Why the HTML looks like 2005

Email is not the web. There is no flexbox, no grid, no external stylesheet worth
relying on, and no webfont that loads everywhere. Layout is nested tables,
styling is inline attributes, and every colour is a flat hex — `rgba()` renders
as black or as nothing across enough clients to be unusable, so the theme's
translucent inks are pre-flattened against their own backgrounds:

    inkDim   rgba(11,11,13,0.62) on amber  ->  #5F441F
    inkFaint rgba(11,11,13,0.42) on amber  ->  #8B6328

## Why it forces light mode

The design is amber and black by choice, not a light theme with a dark twin. Gmail
and Outlook will invert an email they think is light, which turns the brand ground
into a muddy blue-grey and the code into something unreadable. `color-scheme:
light` plus `supported-color-schemes` tells the ones that honour it to leave the
palette alone; the rest are why every colour is also stated explicitly on the
element rather than inherited.

## After editing

Test with an address that has **never** signed in, then with one that has.
Testing one proves nothing about the other — that is the whole bug this replaces.
