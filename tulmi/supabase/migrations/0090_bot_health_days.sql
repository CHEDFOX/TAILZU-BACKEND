-- A fitness bot's daily steps and workouts (docs: perms §4.5), for a bot the person made and switched on themselves.
--
-- One row a person, a bot and a DAY: no timestamp finer than a day, no heart rate, sleep, weight, route or raw sample, and
-- nothing that says which device or app the numbers came from. The phone works the day out in its own time zone and sums the
-- totals before it sends them, so nothing finer ever reaches us.
--
-- Written only by POST /v1/bots/:slug/health/days, from the owner's own signed-in session, never from a bot API key. Read only
-- by that bot's page, the data download and Delete my data. A sweeper drops rows older than 31 days, and switching the bot's
-- health off deletes every row for it in the same request.
--
-- Deleting the bot or the account takes the rows with it (both cascade). Row level security is on with NO policy, so only the
-- service key reaches the table: no client, signed in or not, can read a row.

create table if not exists public.bot_health_days (
  user_id    uuid not null references auth.users (id) on delete cascade,
  bot_id     uuid not null references public.bots (id) on delete cascade,
  day        date not null,
  steps      integer not null default 0 check (steps between 0 and 200000),
  -- [{ "kind": "run" | "walk" | "cycle" | "strength" | "cardio" | "swim" | "yoga" | "sport" | "other", "minutes": 1-600 }]
  workouts   jsonb not null default '[]'::jsonb
             check (jsonb_typeof(workouts) = 'array' and jsonb_array_length(workouts) <= 8),
  updated_at timestamptz not null default now(),
  primary key (user_id, bot_id, day)
);

-- The sweeper's read: every row older than 31 days, across everyone.
create index if not exists bot_health_days_day_idx on public.bot_health_days (day);

alter table public.bot_health_days enable row level security;   -- no policy: service key only
