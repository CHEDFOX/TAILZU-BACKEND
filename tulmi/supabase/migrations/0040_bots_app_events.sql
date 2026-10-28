-- Tailzu — the Bots app's own rows for Activity (src/shell/events.ts, docs/bots-app.md).
--
-- Run in your Supabase SQL editor before turning BOTS_APP on. It needs nothing from the other migrations. It can be run again. Without it the rows
-- are kept in memory and a restart forgets them (Activity then shows the Code bot's jobs, connected-app tasks and Keybot's words, which are kept
-- by their own tables, and not these).
--
-- bots_app_events  kind 'ask': a bot answered through the Bots app's Ask: which bot (its slug, or 'tailzu'), what was asked (200 characters at
--                  most), and what the answer cost in paise.
--                  kind 'paid': the person said they pressed pay in their own UPI app for a payment a bot filled in (bots.approve): which bot,
--                  what it was for, the payee's name, the amount in paise. Tailzu never pays: this is the person's receipt of what they did.
--                  Rows older than 90 days are deleted the next time the person writes one.
--
-- Written by the server with the service key only. OWNER-ONLY: a person's own token can READ their own rows and nothing else; there is no policy
-- that lets a token write. Rows go with the account (on delete cascade).

create table if not exists public.bots_app_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('ask', 'paid')),
  bot          text not null check (char_length(bot) between 1 and 64),
  title        text not null check (char_length(title) between 1 and 200),
  paise        integer not null default 0 check (paise >= 0),
  amount_paise bigint not null default 0 check (amount_paise >= 0),
  payee        text not null default '' check (char_length(payee) <= 120),
  created_at   timestamptz not null default now()
);

create index if not exists bots_app_events_user_idx on public.bots_app_events (user_id, created_at desc);

alter table public.bots_app_events enable row level security;

drop policy if exists "users read own bots app events" on public.bots_app_events;
create policy "users read own bots app events"
  on public.bots_app_events for select
  using (auth.uid() = user_id);
