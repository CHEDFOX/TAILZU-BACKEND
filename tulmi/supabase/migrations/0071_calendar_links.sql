-- Tailzu — Plan Ease step 2: the work calendar by its link (src/botsBots/planLinks.ts, planIcs.ts; docs/plan-ease.md "The work calendar").
--
-- calendar_links        a calendar the person linked by its secret address (Google's "Secret address in iCal format", Outlook's
--                       published ICS link, iCloud's public link), at most 3 a person
--   url_enc             the address, sealed (AES-256-GCM under the server's CONNECTOR_TOKEN_KEY, through a labelled key): it is a
--                       password to their calendar, so it is never kept in the clear, never logged and never sent to a model
--   url_hint            what the screen may show of it ("calendar.google.com/…a91f")
--   provider            google | outlook | icloud | other, from its host
--   state               ok | failing (it stopped answering; the person is told on the page and in the next evening note) |
--                       off (taken off: kept 0 rows, deleted by the sweep)
--   etag, last_modified the last answer's, so a read that changed nothing costs a 304
--   next_fetch_ms       when the fetch job reads it next (every 30 minutes, spread out); the job claims a row by moving this on
--   fetched_ms, ok_ms   the last read, the last good read; fails: bad reads in a row; failing_ms: since when it stopped
-- calendar_link_events  its meetings, one row per start (repeats expanded), from 7 days back to 60 days ahead, 3,000 at most a link.
--                       Only the title, place, times, whether it is busy and how many people: never attendees' emails, never the
--                       description (call links and passcodes live there)
--   ref                 the row's id on the person's days: the same meeting keeps it when it moves, so the morning note can say "moved"
--   sig                 what it was, hashed, so a read writes only what changed
-- plan_link_codes       a link pasted on x0bot.com/cal (on a computer, no sign-in), sealed, waiting at most 15 minutes for the signed-in
--                       phone to type its 6-digit code (kept only as a keyed hash). Read once, then deleted.
--
-- Everything is deleted with the account (on delete cascade), and a link's meetings with the link.
-- Run in your Supabase SQL editor after 0070_plan_ease_notes.sql. It can be run again. Written by the server with the service key only;
-- the person's own token can read nothing here (the sealed address is no use to an app, and the meetings reach it through the server).

create table if not exists public.calendar_links (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  provider       text not null default 'other' check (provider in ('google', 'outlook', 'icloud', 'other')),
  url_enc        text not null check (char_length(url_enc) between 16 and 6000),
  url_hint       text not null default '' check (char_length(url_hint) <= 80),
  url_hash       text not null check (char_length(url_hash) = 64),
  state          text not null default 'ok' check (state in ('ok', 'failing', 'off')),
  etag           text check (etag is null or char_length(etag) <= 300),
  last_modified  text check (last_modified is null or char_length(last_modified) <= 100),
  next_fetch_ms  bigint,
  fetched_ms     bigint,
  ok_ms          bigint,
  failing_ms     bigint,
  fails          smallint not null default 0 check (fails between 0 and 1000),
  events         integer not null default 0 check (events between 0 and 3000),
  created_ms     bigint not null,
  updated_ms     bigint not null
);
create index if not exists calendar_links_user_idx on public.calendar_links (user_id);
create unique index if not exists calendar_links_user_url_idx on public.calendar_links (user_id, url_hash);
create index if not exists calendar_links_due_idx on public.calendar_links (next_fetch_ms) where next_fetch_ms is not null;

create table if not exists public.calendar_link_events (
  link_id    uuid not null references public.calendar_links (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  ref        text not null check (char_length(ref) between 4 and 40),
  occurs_ms  bigint not null,
  end_ms     bigint not null check (end_ms >= occurs_ms),
  all_day    boolean not null default false,
  title      text not null default '' check (char_length(title) <= 120),
  place      text not null default '' check (char_length(place) <= 160),
  busy       boolean not null default true,
  people     smallint not null default 0 check (people between 0 and 1000),
  tz_min     integer not null default 0 check (tz_min between -720 and 840),
  sig        text not null default '' check (char_length(sig) <= 64),
  primary key (link_id, ref)
);
create index if not exists calendar_link_events_user_time_idx on public.calendar_link_events (user_id, occurs_ms);
create index if not exists calendar_link_events_user_ref_idx on public.calendar_link_events (user_id, ref);

create table if not exists public.plan_link_codes (
  code_hash   text primary key check (char_length(code_hash) = 64),
  url_enc     text not null check (char_length(url_enc) between 16 and 6000),
  tries       smallint not null default 0 check (tries between 0 and 100),
  expires_ms  bigint not null,
  created_ms  bigint not null
);
create index if not exists plan_link_codes_expires_idx on public.plan_link_codes (expires_ms);

alter table public.calendar_links enable row level security;
alter table public.calendar_link_events enable row level security;
alter table public.plan_link_codes enable row level security;
-- No policies: only the server (the service key) reads or writes these.
