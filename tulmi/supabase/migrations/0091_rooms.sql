-- Tailzu — calls (src/rooms, docs/rooms.md): our own video and audio rooms, carried by LiveKit. The mail bot's calls are made here, under
-- the business they are for.
--
-- rooms   one row a call: its host (the person who made it), its link's code (hashed, to find the call by its link, and sealed, so the host can
--         share the link again: the code itself is never stored as it is), the business it is for (the mail worker's id, when it is one), the
--         name a guest sees as whose call it is, its title, whether people with the link wait for the host to let them in, where it stands
--         (open: nobody is in; live: someone is; ended: its host ended it, the link is dead), who is in it now, the times people were in it
--         (its last 50; the minutes of older ones in past_minutes), and when it ended
--
-- Who waits at a call's door is not kept here: a knock lasts minutes, in the server's memory. Nothing said or shown in a call reaches the
-- server or this table.
--
-- Written and read by the server with the service key only: row level security is on and there is no policy, so no token reads or writes
-- it. Rows go with the account (on delete cascade).
--
-- Run in your Supabase SQL editor after 0090. It can be run again. Without it the server keeps calls in memory, and a restart forgets them
-- (a link made before it no longer works).

create table if not exists public.rooms (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  code_hash    text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  code_enc     text not null,
  business_id  text,
  host         text not null default '' check (char_length(host) <= 60),
  title        text not null default '' check (char_length(title) <= 120),
  lobby        boolean not null default true,
  status       text not null default 'open' check (status in ('open', 'live', 'ended')),
  people       jsonb not null default '[]'::jsonb,
  sessions     jsonb not null default '[]'::jsonb,
  past_minutes integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create index if not exists rooms_user_created on public.rooms (user_id, created_at desc);
create index if not exists rooms_user_business on public.rooms (user_id, business_id, created_at desc);
create index if not exists rooms_live on public.rooms (status) where status = 'live';
create index if not exists rooms_open_updated on public.rooms (updated_at) where status <> 'ended';

alter table public.rooms enable row level security;
