-- Tailzu — the Oracle (src/oracle, docs/oracle.md): when and where a person was born, for the Oracle to read their sky from.
--
-- oracle_people   one row a person: `sky` (the date, the local time, the place and its coordinates, whether the time is known) and `last_route`
--                 (what the oracle's router decided for their last question, sent back so a follow-up on the same subject is read the same way).
--
-- Written by the server with the service key only. OWNER-ONLY: a person's own token can READ their own row and nothing else; there is no policy that
-- lets a token write. The row goes with the account (on delete cascade) and with "delete my data" (you/data.ts).
--
-- Run in your Supabase SQL editor after 0077. It can be run again. Without it the server keeps these in memory, and a restart forgets them.

create table if not exists public.oracle_people (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  sky        jsonb check (sky is null or jsonb_typeof(sky) = 'object'),
  last_route jsonb check (last_route is null or (jsonb_typeof(last_route) = 'object' and pg_column_size(last_route) <= 32768)),
  updated_at timestamptz not null default now()
);

alter table public.oracle_people enable row level security;

drop policy if exists "users read own oracle row" on public.oracle_people;
create policy "users read own oracle row"
  on public.oracle_people for select
  using (auth.uid() = user_id);
