-- WHAT A GROUP'S BOTS KNOW ABOUT THE GROUP (src/botsBots/spaceMemory.ts).
--
-- space_facts  one short line a member told the group's bots ("We order groceries on Sundays", "Dadi is vegetarian"), written in the
--              group or shared from their own space by a tap (from_key: that line's key there). Only the member who wrote it, or the
--              group's admin, forgets it; leaving the group takes a member's lines with them. Nothing from a person's own space reaches a
--              group unless they share that line.
--
-- Written and read by the server with the service key only: row-level security is on with no policies, so no person reads these
-- directly (every permission is checked by the server). Times are epoch milliseconds. Safe to run again.

create table if not exists public.space_facts (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  text       text not null check (char_length(text) between 3 and 160),
  section    text not null check (section in ('about', 'day', 'people', 'places', 'likes', 'money', 'work')),
  from_key   text check (from_key is null or from_key ~ '^[0-9a-f]{12}$'),
  created_ms bigint not null
);

create index if not exists space_facts_space on public.space_facts (space_id, created_ms);
create unique index if not exists space_facts_once on public.space_facts (space_id, lower(text));

alter table public.space_facts enable row level security;
