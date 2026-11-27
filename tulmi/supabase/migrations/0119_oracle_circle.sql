-- Tailzu — Chamen's people (src/oracle/store.ts, docs/oracle.md "People"): the people a person reads for besides themselves, which one Chamen
-- reads for now, the gender Chamen reads their own chart with, and the charts they share into a space.
--
-- oracle_people.others        [{ id, name, gender, sky, at }]: the people they added (20 at most)
-- oracle_people.active        "me", "p:<id>" (one they added) or "s:<owner>:<ref>" (one shared with them): who Chamen reads for
-- oracle_people.chamen_gender the gender Chamen reads THEIR OWN chart with, when they switched it in Chamen (the profile is left as it is)
-- oracle_shares               one row a chart shared into a space: its members can pick it and ask about it, and never see when or where
--                             the person was born (the server reads that for them)
--
-- Written by the server with the service key only. OWNER-ONLY: a person's own token can READ their own rows and nothing else. Rows go with the
-- account (on delete cascade) and with "delete my data" (you/data.ts). Run after 0118. It can be run again.

alter table public.oracle_people add column if not exists others jsonb not null default '[]'::jsonb
  check (jsonb_typeof(others) = 'array' and pg_column_size(others) <= 65536);
alter table public.oracle_people add column if not exists active text check (active is null or char_length(active) <= 120);
alter table public.oracle_people add column if not exists chamen_gender text check (chamen_gender is null or chamen_gender in ('male', 'female', 'other'));

create table if not exists public.oracle_shares (
  user_id    uuid not null references auth.users (id) on delete cascade,
  ref        text not null check (char_length(ref) between 1 and 60),
  space_id   uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, ref, space_id)
);
create index if not exists oracle_shares_space on public.oracle_shares (space_id);

alter table public.oracle_shares enable row level security;

drop policy if exists "users read own oracle shares" on public.oracle_shares;
create policy "users read own oracle shares"
  on public.oracle_shares for select
  using (auth.uid() = user_id);
