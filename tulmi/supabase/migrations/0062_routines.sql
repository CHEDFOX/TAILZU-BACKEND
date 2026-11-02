-- Tailzu — routines: a bot does something on a schedule, without being asked each time (src/routines, routes/bots/routines.ts, docs/routines.md).
--
-- Run in your Supabase SQL editor before turning ROUTINES on (it is on with BOTS by default). It needs nothing from the other migrations.
-- It can be run again. Without it routines are kept in memory and a restart forgets them.
--
-- routines  one row per routine: the bot that does it, what to do, when (schedule: { every: day | weekdays | week | month, minute,
--           days?, monthDay? } in the person's own time, tz_min minutes east of UTC), whether it is on, when it runs next, and how the
--           last run went (its answer, at most 4,000 characters). A run claims its due time by moving next_at on only if it is unchanged,
--           so two servers never run the same routine twice for one time.
--
-- Written by the server with the service key only. No policy: a person's own token can neither read nor write it. Rows go with the account.

create table if not exists public.routines (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  bot          text not null check (bot ~ '^[a-z0-9-]{2,40}$'),
  bot_name     text not null default '',
  task         text not null check (char_length(task) between 1 and 300),
  schedule     jsonb not null,
  tz_min       integer not null check (tz_min between -720 and 840),
  status       text not null check (status in ('on', 'paused')),
  paused_why   text not null default '',
  next_at      timestamptz,
  last_at      timestamptz,
  last_status  text check (last_status in ('done', 'needs', 'failed')),
  last_text    text not null default '' check (char_length(last_text) <= 4000),
  last_paise   integer not null default 0,
  runs         integer not null default 0,
  fails        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists routines_due_idx on public.routines (status, next_at);
create index if not exists routines_user_idx on public.routines (user_id, created_at);

alter table public.routines enable row level security;
