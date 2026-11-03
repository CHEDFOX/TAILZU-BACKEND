-- WHAT EACH PERSON SHARES FROM THEIR OWN BOTS INTO A GROUP (src/botsBots/spaceShares.ts).
--
-- space_bot_shares  one row a person, a space and one of their bots (plan, notes, travel, code): everything, picked items, or nothing.
--                   No row is nothing: nothing of anyone's is shared until they choose it, and only they can change it.
--
-- Written and read by the server with the service key only: row-level security is on with no policies, so no person reads these
-- directly (every permission is checked by the server). Times are epoch milliseconds. Safe to run again.

create table if not exists public.space_bot_shares (
  space_id   uuid not null references public.spaces (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  bot        text not null check (bot in ('plan', 'notes', 'travel', 'code')),
  mode       text not null default 'none' check (mode in ('all', 'some', 'none')),
  items      jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),
  updated_ms bigint not null,
  primary key (space_id, user_id, bot)
);

create index if not exists space_bot_shares_space on public.space_bot_shares (space_id, bot);

alter table public.space_bot_shares enable row level security;
