# Supabase setup

Tulmi uses Supabase for **auth** (who the user is) and **data** (their
personality profile, language/onboarding state, and usage metering). This guide
takes a fresh project to fully working.

The design goal: **everything works with just the public anon key.** The backend
reads/writes user data through the signed-in user's JWT, so Row-Level Security
(RLS) scopes every query to that user. The secret service-role key is *optional*
(only needed if you want metering writes to bypass RLS).

---

## 1. Create the project

Already done for Tulmi: project ref `merzyohecmyfvlyahxaz`. For a new one:
**supabase.com → New project**, pick a region close to your users.

## 2. Run the schema

Supabase dashboard → **SQL Editor → New query** → paste the whole of
[`tulmi/supabase/schema.sql`](../tulmi/supabase/schema.sql) → **Run**.

It is idempotent (safe to re-run) and creates:

| Table | Purpose | RLS |
| --- | --- | --- |
| `usage_events` | per-request metering | user reads + inserts own rows |
| `personalities` | one style profile per user (JSON) | user manages own row |
| `profiles` | language + onboarding state | user manages own row |

It also installs a trigger that auto-creates a `profiles` row when a user signs
up, and a `usage_monthly` rollup view for free-tier checks later.

## 3. Configure email auth

Dashboard → **Authentication → Providers → Email**:

- **Confirm email = ON** → new users must click a link before they can sign in.
  The app handles this ("check your email to confirm").
- **Confirm email = OFF** → sign-up logs the user straight in. Easiest for
  testing; turn it back on before real users.

(Google / Apple are deferred — they need per-app OAuth credentials. The app
shows them as "coming soon" until then.)

### 3a. Send a CODE, not a magic link — both templates

The app signs in with `signInWithOtp` and shows six code boxes. Whether the
user actually receives six digits is decided entirely by an email template, and
**GoTrue picks which template by account state**:

| The address is | Template used |
| --- | --- |
| new to the project | **Confirm signup** |
| already a user | **Magic Link** |

Both ship with `{{ .ConfirmationURL }}` in them, which mails a *link*. Fixing
only one is why codes look random — a new tester gets a code, and the same
person signing in again gets a link.

Dashboard → **Authentication → Email Templates**. Paste
[`tulmi/supabase/email/confirm-signup.html`](../tulmi/supabase/email/confirm-signup.html)
and [`magic-link.html`](../tulmi/supabase/email/magic-link.html) into the two
templates of those names. Their bodies are identical — the reader asked for a
code and should not be able to tell which of GoTrue's paths answered — and both
carry `{{ .Token }}` instead of `{{ .ConfirmationURL }}`.

They are in the app's Stats palette: amber ground, black ink, the code as the
hero figure, one black card. See
[`tulmi/supabase/email/_README.md`](../tulmi/supabase/email/_README.md) for why
the markup is table-based and why every colour is a flat hex.

Check it end to end with an address that has **never** signed in (Confirm
signup) and then again with one that has (Magic Link). Testing only one proves
nothing about the other.

While you are there, **Authentication → Providers → Email → Email OTP Expiration**
should be an hour or less; the default of 24 hours is a long time for a code
sitting in an inbox.

If a link goes out anyway, the app redeems it instead of dead-ending — but only
on the phone that asked for it (next section). That is a safety net, not the
fix — a user who has to leave the app and come back has still had a worse time
than one who read six digits off a notification.

### 3b. Links that sign in: the redirect URL must accept a `state`

Anything that signs in by coming back through a link — Google on Android by way
of Supabase's page (`AUTH_GOOGLE_WEB`), or a mailed link when a template sends
one — returns to the backend's `/auth/callback`, which hands it to the app on
`tulmi://`. Any web page can open `tulmi://`, so a link carrying a session
minted for someone else's account would sign the phone into THAT account
(login CSRF). Three things stop it:

- the app runs Supabase's PKCE flow (`flowType: "pkce"`): a code is exchanged
  with a verifier that never leaves the phone that started the flow;
- the app sends a random `state` in the redirect (`…/auth/callback?state=…`)
  and redeems a link only if it brings back the state it is waiting for,
  within 15 minutes, once (`app/src/auth/linkState.ts`);
- `/auth/callback` refuses a return without a state
  (`AUTH_CALLBACK_REQUIRE_STATE`, on by default).

**Dashboard → Authentication → URL Configuration → Redirect URLs** must
therefore match the callback WITH a query. Add:

```
https://api.tailzu.space/auth/callback**
```

(the host is `PUBLIC_ORIGIN`'s). An exact `…/auth/callback` entry no longer
matches, and Supabase then silently sends the user to the Site URL instead —
Google on Android would land on the wrong page. Add the entry **before** the
app update and the server that send the state go out.

Rollout order: (1) the Redirect URL above; (2) the app update (it works against
the old server too — the old page forwards the query); (3) this server. If the
server has to ship before the update has reached people, deploy it with
`AUTH_CALLBACK_REQUIRE_STATE=false` and flip it back once it has: a bundle from
before the state sends none, and its Google sign-in would be refused.

## 4. Keys

Dashboard → **Project Settings → API**:

- **Project URL** and **anon/public key** — already wired into the app at
  `app/src/auth/supabaseConfig.ts` (the anon key is meant to ship in the client).
- **service_role key** — SECRET. Optional. Only add it to the backend if you
  want metering to write via an admin client. Never ship it to the app.

## 5. Turn on real auth in the backend

The backend defaults to `DEV_SKIP_AUTH=true` (a stub user, in-memory data) so
the pipeline can be tested with no database. To verify real users:

In `tulmi/.env`:

```bash
DEV_SKIP_AUTH=false
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>          # enough for auth + RLS-scoped data
# SUPABASE_SERVICE_KEY=<service key>  # optional: metering bypasses RLS
```

Now the backend verifies each request's JWT (`/auth/v1/user`) and reads/writes
that user's data under RLS. No service-role secret required.

## How the data path works

```
App  ──sign in──▶  Supabase Auth ──JWT──▶  App stores session
App  ──request + JWT──▶  Backend  ──verify──▶  user id
Backend ──query as user's JWT──▶  Supabase  (RLS: auth.uid() = user_id)
```

- `tulmi/src/auth/supabase.ts` — `resolveUser` (verify JWT) + `dataClientFor`
  (service-role client if configured, else a JWT-scoped client).
- `tulmi/src/profile/store.ts`, `personality/store.ts`, `usage/metering.ts` —
  all go through `dataClientFor`, with an in-memory fallback under
  `DEV_SKIP_AUTH`.
