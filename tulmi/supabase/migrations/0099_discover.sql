-- X0 Bot — places worth keeping (src/discover, docs/discover.md).
--
-- discover_cards  a card the Travel bot BUILT for one person, for a place nobody has written by hand yet. It is
--                 theirs: owner_id is on every read. What we wrote ourselves is not in here at all — those live in
--                 src/discover/catalog.ts, in the code, because they are reviewed like code is and ship with it.
-- discover_asks   who searched for what. One row a person a place, not one a search, so a person asking twenty
--                 times counts once and a place cannot be pushed up the queue by one enthusiast. When enough
--                 different people have asked for the same place, it is worth our own words: that is the whole
--                 plan for growing the catalogue, and the people using it decide the order.
--
-- No row here holds anything about the person beyond their id and the place they asked for. A built card's sources
-- are the pages that were really read, with the day they were read, so a claim on a card can always be checked.
--
-- Row-level security is on with no policy, as the neighbouring tables do: the service key reaches these and nothing
-- else does. Run in your Supabase SQL editor after 0098. It can be run again.

create table if not exists public.discover_cards (
  id         text primary key,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  -- The geocoder's answer, lower case: one place is one slug, so "hampi" and "Hampi, Karnataka" never become two.
  slug       text not null,
  -- The whole card (src/discover/types.ts Card): title, hook, moment, story, tags, season, photos, sources.
  -- One column because the shape is the module's and changes with it; nothing here is queried by field.
  card       jsonb not null,
  created_at timestamptz not null default now(),
  -- The person opened it, which is a stronger signal than searching for it.
  opened_at  timestamptz,
  unique (owner_id, slug)
);

create index if not exists discover_cards_owner_idx on public.discover_cards (owner_id, created_at desc);
create index if not exists discover_cards_slug_idx  on public.discover_cards (slug);

create table if not exists public.discover_asks (
  slug       text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  -- What they typed, kept only to see what people call a place when we come to write it.
  said       text,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  -- Set when the place has been written by hand and the card became everyone's.
  written_at timestamptz,
  primary key (slug, owner_id)
);

-- "Which places have enough people asked for?" — the one query the review queue runs.
create index if not exists discover_asks_slug_idx on public.discover_asks (slug) where written_at is null;

alter table public.discover_cards enable row level security;
alter table public.discover_asks  enable row level security;
