-- Tailzu — what a person has ordered on a site they signed in to, and when it was last read (src/sites/history,
-- docs/site-portrait.md).
--
-- site_orders   one row per order, as the site's own orders page showed it: the place, the dishes, what was paid and when.
--               What their portrait of that site is made from (src/sites/history/portrait.ts). Never a card number, an
--               address or a phone number: an orders page shows those and nothing here keeps them.
-- site_history  one row per person per site: when its orders page was last read, and a hash of what it said, so the
--               same page read twice costs no model call.
--
-- Forgetting a site's history deletes both. Row-level security is on with no policy, as the neighbouring tables do: the
-- service key reaches these and nothing else does. Run after 0113. It can be run again.

create table if not exists public.site_orders (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  site       text not null,
  -- The site's own order number where the page shows one ("no:…"), else a hash of the place, the time and the dishes.
  key        text not null,
  place      text not null,
  area       text,
  -- [{ "name": "Chicken Dum Biryani", "qty": 1 }]: the dishes as the site names them.
  items      jsonb not null default '[]'::jsonb,
  total      numeric,
  -- When it was placed, on the page's own clock: "2026-11-21T20:40".
  local      text,
  -- The restaurant's page on the site, when the orders page linked to it.
  link       text,
  cancelled  boolean not null default false,
  seen_at    timestamptz not null default now(),
  primary key (owner_id, site, key)
);

create table if not exists public.site_history (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  site       text not null,
  read_at    timestamptz,
  hash       text,
  primary key (owner_id, site)
);

create index if not exists site_orders_owner_idx on public.site_orders (owner_id, site, local desc);

alter table public.site_orders  enable row level security;
alter table public.site_history enable row level security;
