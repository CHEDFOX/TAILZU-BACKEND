-- Tailzu — what X0 did for a person on a site they connected (src/sites/history, docs/site-portrait.md §4b): the carts
-- it filled and the new places it found, shown on that site's page as "Done for you". Deliveries come from site_watches.
--
-- `ref` makes one thing one row however often it is reported: an order filled twice in a day is one row.
-- Forgetting a site's history deletes these too. Run after 0115. It can be run again.

create table if not exists public.site_did (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  site       text not null,
  ref        text not null,
  -- cart | found
  kind       text not null,
  title      text not null,
  line       text,
  at         timestamptz not null default now(),
  primary key (owner_id, site, ref)
);

create index if not exists site_did_owner_idx on public.site_did (owner_id, site, at desc);

alter table public.site_did enable row level security;
