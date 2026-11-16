-- Tailzu — a browser that belongs to the person, and the things it watches for them (src/sites, docs/sites.md).
--
-- site_profiles  one row per person per site: the "already signed in" slip that site's browser handed us, encrypted
--                with CONNECTOR_TOKEN_KEY (src/connectors/crypto.ts) exactly as a connector's token is. Never the
--                password, never a one-time code: those go to the site and are kept nowhere. One profile per SITE and
--                not one per person, so a session stolen from one shop says nothing about the others.
-- site_watches   a thing worth checking while it is happening: an order on its way, an application going through.
--                Checked only while `state` is 'open', and stopped the moment it arrives — a site that sees one look
--                when a delivery is live reads as a person; the same site seeing a heartbeat all day reads as a robot.
--
-- Row-level security is on with no policy, as the neighbouring tables do: the service key reaches these and nothing
-- else does. Run in your Supabase SQL editor after 0097. It can be run again.

create table if not exists public.site_profiles (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  site       text not null,
  -- "v1.…" from connectors/crypto.ts: the cookies and storage of that site, and nothing else.
  blob       text not null,
  -- What the person is called there, when the page says so: for the card, never for matching.
  who        text,
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  -- The last time the site turned us away: three in a row and the person is asked to sign in again.
  failed_at  timestamptz,
  fails      integer not null default 0,
  primary key (owner_id, site)
);

create table if not exists public.site_watches (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  site       text not null,
  url        text not null,
  -- "Behrouz Biryani", "Sony WH-1000XM6": what the person would call it.
  label      text,
  -- open | done | stopped | lost ('lost' is the site no longer showing it)
  state      text not null default 'open',
  -- The card as it was last read (shared/types/api.ts SiteCard). Data the page said, never instructions.
  card       jsonb,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  next_at    timestamptz,
  done_at    timestamptz
);

create index if not exists site_watches_due_idx on public.site_watches (next_at) where state = 'open';
create index if not exists site_watches_owner_idx on public.site_watches (owner_id, state);

alter table public.site_profiles enable row level security;
alter table public.site_watches  enable row level security;
