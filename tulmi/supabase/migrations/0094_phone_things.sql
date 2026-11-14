-- BUILD 8.9.1: the things the phone itself can do, and the little this server keeps of them (docs: perms2).
--
-- Five pieces, all of them the person's own and all of them off until they turn one on:
--
--   plan_busy                     the BUSY TIMES read from the iPhone's calendars: start, end and all-day, and nothing else.
--                                 Never an event's name, place, notes, people or calendar name — those never leave the phone.
--   calendar_tasks.ext_src/_ref   a to-do linked to an item in the one Reminders list X0 Bot makes, called X0 Bot
--   reminders_gone                a linked to-do deleted HERE, so its item goes out of that list at the next sync. The item's
--                                 opaque identifier only, kept until the item has gone (a week at most)
--   bot_health_days.source        where a day's steps came from: Apple Health / Health Connect ("health") or, with Health
--                                 off, Motion & Fitness on iPhone and the phone's own step counter on Android ("motion").
--                                 A bot's own `skills.healthSource` says the same thing on the bot row, which is JSON, so
--                                 there is no column for it here
--   bot_health_days.sleep_minutes how long the person slept that night, in minutes. No stages, no bed or wake times
--   calendar_events.arrive        "Remind me when I get there" is on for this event. THE PHONE watches the place itself and
--                                 shows the reminder; this server is never told where the person is, or that they arrived, so
--                                 there is nothing here but the switch
--   plan_prefs.calendar_busy      the busy-times switch, written in the same transaction as the first blocks
--   plan_prefs.reminders_on       the Reminders switch
--   plan_prefs.focus              { on, hold, source, until }: whether a Focus or Do Not Disturb is on, and whether calls alone
--                                 or calls and pings wait. NEVER which Focus, and it reads as off past `until` (12 hours)
--
-- Row level security stays as each table has it: plan_busy is service-key only (on, with no policy), and the columns added to
-- existing tables inherit their table's rules.

-- ---------------------------------------------------------------- busy times from the phone's calendars
--
-- Replaced whole at each sync for the window it covers, and each block is deleted a day after it ends (so 15 days at most).
-- Switching the row off deletes every block and the flag in one request; Delete my data and deleting the account take them too.
create table if not exists public.plan_busy (
  user_id   uuid not null references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  all_day   boolean not null default false,
  synced_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '2 days')
);

-- The Plan's own read (one person, a range), and the sweeper's (every block whose end has gone, across everyone).
create index if not exists plan_busy_user_starts_idx on public.plan_busy (user_id, starts_at);
create index if not exists plan_busy_ends_idx on public.plan_busy (ends_at);

alter table public.plan_busy enable row level security;   -- no policy: service key only

-- ---------------------------------------------------------------- a to-do linked to the X0 Bot Reminders list
alter table public.calendar_tasks add column if not exists ext_src text check (ext_src in ('apple_reminders'));
alter table public.calendar_tasks add column if not exists ext_ref text;

-- One to-do a Reminders item, and one item a to-do: a second sync never adds the same item twice.
create unique index if not exists calendar_tasks_ext_idx
  on public.calendar_tasks (user_id, ext_src, ext_ref)
  where ext_src is not null and ext_ref is not null;

-- ---------------------------------------------------------------- a to-do deleted HERE whose item is still in the list
--
-- "A to-do deleted in X0 removes its item" needs a memory of the deletion: once the row has gone nothing is left to say the
-- item ever had one, and the merge would read the item as a new to-do and copy it straight back in. Written by
-- Calendar.removeTask for a row that had a link, dropped the moment the item has gone from the list, and swept after a week
-- for a person who switched the row off in between. The item's own opaque identifier and nothing else: no title, no due date.
create table if not exists public.reminders_gone (
  user_id uuid not null references auth.users (id) on delete cascade,
  ext_ref text not null,
  at      timestamptz not null default now(),
  primary key (user_id, ext_ref)
);

-- The sweeper's read (every mark older than a week, across everyone).
create index if not exists reminders_gone_at_idx on public.reminders_gone (at);

alter table public.reminders_gone enable row level security;   -- no policy: service key only

-- ---------------------------------------------------------------- an event the phone reminds them at
alter table public.calendar_events add column if not exists arrive boolean not null default false;

-- ---------------------------------------------------------------- where a day's steps came from, and the night's sleep
alter table public.bot_health_days add column if not exists source text not null default 'health'
  check (source in ('health', 'motion'));
alter table public.bot_health_days add column if not exists sleep_minutes smallint
  check (sleep_minutes between 0 and 1440);

-- 0090's own note said "no ... sleep" and "nothing that says which device or app the numbers came from". Both have changed, in
-- the one direction the cards, the policy and the store forms describe, so the note is written again here rather than left to
-- contradict the table.
comment on table public.bot_health_days is
  'A fitness bot''s day: steps, workouts, and (only when the person switched it on) how long they slept that night. Nothing '
  'finer than a day: no heart rate, weight, route, sleep stage, bed or wake time, or raw sample. `source` says which of the '
  'two readers the phone used — Apple Health / Health Connect, or Motion & Fitness — and nothing about the device itself.';

-- ---------------------------------------------------------------- the switches, on the person's one Plan Ease row
alter table public.plan_prefs add column if not exists calendar_busy boolean not null default false;
alter table public.plan_prefs add column if not exists reminders_on boolean not null default false;
-- { on: boolean, hold: "calls" | "callsAndPings", source: "filter" | "dnd", until: epoch ms }. Overwritten at each change.
alter table public.plan_prefs add column if not exists focus jsonb;
