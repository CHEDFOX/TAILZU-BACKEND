-- Tailzu — wrong codes typed for x0bot.com/cal (src/botsBots/planLinks.ts claim; docs/plan-ease.md "The work calendar").
--
-- plan_link_tries   how many wrong 6-digit codes were typed in the current hour, kept per signed-in person ("u:<id>"), per
--                   address they came from (a keyed hash, never the address itself) and for everyone at once ("all"). A code is
--                   six numbers, so it can be guessed: these counts hold across restarts and across servers, which a count in one
--                   server's memory did not. A scope past its limit gets no answer about codes until its hour is up.
--
-- Run in your Supabase SQL editor. It needs nothing else and can be run again. Older server code doesn't read it.

create table if not exists public.plan_link_tries (
  scope     text primary key check (char_length(scope) between 3 and 80),
  n         integer not null default 0 check (n between 0 and 1000000),
  until_ms  bigint not null
);
create index if not exists plan_link_tries_until_idx on public.plan_link_tries (until_ms);

alter table public.plan_link_tries enable row level security;
-- No policies: only the server (the service key) reads or writes it.
