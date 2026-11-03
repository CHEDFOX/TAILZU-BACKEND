-- Tailzu — the person's context: who they message and their last asks, for the one key's brain and Ask (src/context,
-- routes/ask/context.ts, docs/context.md).
--
-- Run in your Supabase SQL editor. It needs nothing from the other migrations, and can be run again. Without it the context is kept in
-- memory and a restart forgets it.
--
-- person_context  one row per person: people (jsonb array of { name, via?, count, lastAt }, at most 30, learned from the asks that sent
--                 a message), turns (jsonb array of the last asks in full: { id, said, did, goal?, to?, via?, result?, at }, at most 6),
--                 and summary (the older asks folded into one short line). What is read live (their facts, routines, what waits for
--                 them) is not kept here. Nothing from a private field, X0 Bot's own window or a sensitive app is ever written.
--
-- Written by the server with the service key only. No policy: a person's own token can neither read nor write it. The row goes with
-- the account.

create table if not exists public.person_context (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  people      jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array'),
  turns       jsonb not null default '[]'::jsonb check (jsonb_typeof(turns) = 'array'),
  summary     text not null default '' check (char_length(summary) <= 1000),
  updated_at  timestamptz not null default now()
);

alter table public.person_context enable row level security;
