-- Tailzu — why somebody stopped learning a language (src/lingo/store.ts; docs/lingo.md).
-- When a course is removed from the territory, the course and its words go. This keeps ONE line: which language, and
-- the reason they typed, if they typed one. "Just clean up" leaves the reason empty, and that is a complete answer.
--
-- Why keep it at all: why people stop is the most useful thing a learning app can be told, and it is the one thing
-- it is never told, because stopping is silent. It is kept apart from the course so that removing the course really
-- does remove it. It still belongs to the person: their own row, theirs to read, gone with the account.
create table if not exists public.lingo_left (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  target     text not null,                    -- the language they stopped, BCP-47
  -- Their own words, in their own language, capped. Empty when they pressed "Just clean up": no reason is a reason.
  reason     text not null default '',
  -- What they had got to, so a reason can be read against it: a course given up in week one is not the same as one
  -- given up at two hundred words. Counts only; not one word of what they were learning is kept.
  words      integer not null default 0,
  learned    integer not null default 0,
  streak     integer not null default 0,
  days       integer not null default 0,       -- how many days they had it
  left_ms    bigint not null
);
do $$ begin
  alter table public.lingo_left add constraint lingo_left_reason check (char_length(reason) <= 1000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_left add constraint lingo_left_target check (char_length(target) between 2 and 16);
exception when duplicate_object then null; end $$;
create index if not exists lingo_left_user_idx on public.lingo_left (user_id, left_ms desc);

alter table public.lingo_left enable row level security;
do $$ begin
  create policy lingo_left_own on public.lingo_left for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Run in your Supabase SQL editor. It needs 0087 and can be run again.
