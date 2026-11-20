-- X0 Bot — what a person likes, and what they did (src/discover/taste.ts, docs/discover.md).
--
-- discover_taste    one row a person: the folded profile, a number per tag. Small, read on every feed, written on
--                   every signal. The vector is one jsonb column because its shape belongs to the module and no
--                   field is ever queried on its own — the whole thing is loaded, folded and written back.
-- discover_signals  what they did, kept so the profile can be rebuilt if the weights change. "shown" is NOT kept
--                   here: it only increments the shown count inside the vector, and keeping one row per tile per
--                   scroll would be the largest table in the product by an order of magnitude for no gain.
--
-- WHAT IS NOT IN HERE. No place, no coordinates, no device, no session. A row says that this person reacted to
-- this card, how, and when. The profile is a list of twenty-four numbers about taste, and it is the person's own:
-- the app shows it to them in plain words, which is only possible because it was never an opaque embedding.
--
-- Row-level security is on with no policy, as the neighbouring tables do: the service key reaches these and
-- nothing else does. Run in your Supabase SQL editor after 0107. It can be run again.

create table if not exists public.discover_taste (
  owner_id   uuid primary key references auth.users(id) on delete cascade,
  -- src/discover/taste.ts Taste: { dims, signals, at, version }.
  taste      jsonb not null,
  -- Mirrored out of the vector so the console can see who has a profile without parsing every row.
  signals    integer not null default 0,
  -- Bumped on every fold; a write with a stale version lost a race and is retried.
  version    integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discover_signals (
  id         bigserial primary key,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  -- open | keep | unkeep | share | to_trip | skip | not_for_me | more_like_this | dwell | ranked
  kind       text not null,
  -- The card it happened to; an onboarding image for 'ranked'.
  slug       text not null,
  -- Only for dwell: how long the tile was on screen.
  ms         integer,
  -- Only for ranked: where they put it, and how many there were.
  rank       smallint,
  of_n       smallint,
  at         timestamptz not null default now()
);

create index if not exists discover_signals_owner_idx on public.discover_signals (owner_id, at desc);
create index if not exists discover_signals_slug_idx  on public.discover_signals (slug, at desc);

alter table public.discover_taste   enable row level security;
alter table public.discover_signals enable row level security;
