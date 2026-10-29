-- X0 Bot — reporting and blocking in Spaces (src/botsBots/{blocks,safety}.ts, routes/safety.ts, App Review guideline 1.2):
-- what people report (a message, a shared thing, a person) and whom each person has blocked.
--
-- Run in your Supabase SQL editor after 0056_entitlement_product.sql. It can be run again. Until it is run, messaging works as
-- before with nobody blocked (the server reads no blocks), and reporting and blocking answer "Couldn't do that just now."
--
-- user_blocks      one row per person someone blocked. Either way round, the two no longer see each other's messages, the one-to-one
--                  chat between them is closed and hidden, and neither appears in the other's lists of people (spaces' members,
--                  Message someone, Share to). Unblocking deletes the row. `name` is how the blocked person was shown when they
--                  were blocked, so the Blocked people list can name them even once they share nothing any more.
-- content_reports  a report and what became of it. `snapshot` is what was reported as it was then (a message's words and its files'
--                  names, a shared thing's title and text), so the report can be acted on even after the content changes or goes.
--                  `due_ms` is 24 hours after it came in: reports are acted on within a day (the admin console's Reports tab, and an
--                  email to support@x0bot.com through mail_outbox). The rows outlive the accounts on both sides (on delete set null)
--                  as the safety record.
--
-- Written and read by the server with the service key only: row-level security is on with no policies, so no person reads or writes
-- these directly. Times are epoch milliseconds.

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  name       text not null default '' check (char_length(name) <= 40),
  at_ms      bigint not null,
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

create table if not exists public.content_reports (
  id            uuid primary key,
  reporter_id   uuid references auth.users (id) on delete set null,
  reporter_name text not null default '' check (char_length(reporter_name) <= 40),
  reported_id   uuid references auth.users (id) on delete set null,
  reported_name text not null default '' check (char_length(reported_name) <= 40),
  kind          text not null check (kind in ('message', 'item', 'person')),
  ref           text not null default '' check (char_length(ref) <= 80),
  thread_id     uuid,
  space_id      uuid,
  reason        text not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'illegal', 'other')),
  note          text not null default '' check (char_length(note) <= 1000),
  snapshot      jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 32768),
  status        text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  action        text not null default '' check (char_length(action) <= 200),
  created_ms    bigint not null,
  due_ms        bigint not null,
  resolved_ms   bigint,
  resolved_by   text not null default '' check (char_length(resolved_by) <= 60)
);
create index if not exists content_reports_status_idx on public.content_reports (status, created_ms desc);
create index if not exists content_reports_reporter_idx on public.content_reports (reporter_id, created_ms desc);
create index if not exists content_reports_reported_idx on public.content_reports (reported_id);

alter table public.user_blocks     enable row level security;
alter table public.content_reports enable row level security;
