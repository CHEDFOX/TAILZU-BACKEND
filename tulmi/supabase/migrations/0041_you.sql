-- Tailzu — the Bots app's You tab (src/you, docs/bots-app.md): the person's monthly limit and what pings them, what their bots spent outside the Code bot's
-- jobs, and the computers that have helped.
--
-- Run in your Supabase SQL editor after 0038 (it needs nothing from the others). It can be run again. Until it is run the server keeps these in memory: the
-- screens still work, a restart forgets a limit that was set (the default, ₹500 and "keep going", comes back) and the spend of bot answers before it.
--
-- you_settings      one row per person: the monthly limit in paise and whether the bots stop at it (they pause and ask before going past it: a Code bot job's
--                   budget is held to what is left of the month, and a bot's answer is refused once the month is used up), what pings them (notify: needs you
--                   is always on; done "quiet" or "ping"; a daily summary at an hour; quiet hours; a bot turned off), and the screen-picture choice.
-- you_spend         what a bot's answer cost, one row per answer: whose, which bot (its slug), when, and the paise. The Code bot's jobs keep their own spend
--                   (code_jobs.spent_paise) and are not copied here. Nothing of what was asked or answered is kept.
-- you_computers     the computers that sent a runner heartbeat, so an offline one can still be listed ("last seen 2 days ago") and removed. Presence itself
--                   stays in the server's memory (code/jobs/devices.ts); this is only the list.
--
-- Written by the server with the service key only. OWNER-ONLY: a person's own token can READ their own rows and nothing else. Rows go with the account.

create table if not exists public.you_settings (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  month_limit_paise integer not null default 50000 check (month_limit_paise between 0 and 100000000),
  stop_at_limit     boolean not null default false,
  notify            jsonb not null default '{}'::jsonb check (jsonb_typeof(notify) = 'object'),
  privacy           jsonb not null default '{}'::jsonb check (jsonb_typeof(privacy) = 'object'),
  updated_at        timestamptz not null default now()
);

create table if not exists public.you_spend (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bot     text not null check (char_length(bot) between 1 and 64),
  at      timestamptz not null default now(),
  paise   integer not null check (paise >= 0)
);

create index if not exists you_spend_user_at_idx on public.you_spend (user_id, at desc);

create table if not exists public.you_computers (
  user_id    uuid not null references auth.users (id) on delete cascade,
  device_id  text not null check (char_length(device_id) between 1 and 128),
  name       text not null default '' check (char_length(name) <= 80),
  os         text not null default '' check (char_length(os) <= 40),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.you_settings  enable row level security;
alter table public.you_spend     enable row level security;
alter table public.you_computers enable row level security;

drop policy if exists "users read own you settings" on public.you_settings;
create policy "users read own you settings"
  on public.you_settings for select
  using (auth.uid() = user_id);

drop policy if exists "users read own you spend" on public.you_spend;
create policy "users read own you spend"
  on public.you_spend for select
  using (auth.uid() = user_id);

drop policy if exists "users read own you computers" on public.you_computers;
create policy "users read own you computers"
  on public.you_computers for select
  using (auth.uid() = user_id);
