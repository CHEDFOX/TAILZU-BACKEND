-- Tailzu — Lingo, the language bot (src/lingo; docs/lingo.md).
-- Two tables: the courses a person is taking, and every word and phrase they are learning in each, with where the
-- scheduler has got to with it. Nothing here is content: a course is seeded and drilled from the person's own items,
-- so adding a language adds rows, never a table. Written by the server with the service key only.

-- One row per person per language they are learning. A person may learn more than one at once; the app opens the one
-- they used last.
create table if not exists public.lingo_learners (
  user_id    uuid not null references auth.users (id) on delete cascade,
  target     text not null,                      -- the language being learned, BCP-47 ("es", "ta", "pt-BR")
  from_lang  text not null,                      -- the language it is taught in, BCP-47
  level      text not null default 'a1',         -- CEFR: their own answer at the start, ours once there is enough to judge
  goal_min   smallint not null default 10,       -- minutes a day they asked for
  calls      boolean not null default false,     -- may the bot ring them to talk (plan_calls' own consent still applies)
  voice      text,                               -- the TTS voice that speaks the target language; null until one is picked
  streak_days integer not null default 0,
  last_day   text,                               -- the last day they finished a session: "YYYY-MM-DD" in their own timezone
  used_ms    bigint not null,                    -- last opened: which course the app shows
  created_ms bigint not null,
  updated_ms bigint not null,                    -- every write after the insert is a compare-and-swap on it
  primary key (user_id, target)
);
do $$ begin
  alter table public.lingo_learners add constraint lingo_learners_level
    check (level in ('a1', 'a2', 'b1', 'b2', 'c1', 'c2'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_learners add constraint lingo_learners_goal check (goal_min between 1 and 240);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_learners add constraint lingo_learners_langs
    check (char_length(target) between 2 and 16 and char_length(from_lang) between 2 and 16 and target <> from_lang);
exception when duplicate_object then null; end $$;
create index if not exists lingo_learners_used_idx on public.lingo_learners (user_id, used_ms desc);

-- One row per word or phrase a person is learning, in one of their courses, with the scheduler's state for it.
-- `item` is the thing itself in the target language, trimmed; it is the key, so the same word is never learned twice.
create table if not exists public.lingo_items (
  user_id    uuid not null references auth.users (id) on delete cascade,
  target     text not null,                      -- which course it belongs to
  item       text not null,                      -- the word or phrase, as it is taught
  kind       text not null default 'word',       -- word | phrase
  gloss      text not null default '',           -- what it means, in from_lang
  source     text not null default 'seed',       -- seed (the course's list) | said (they used it) | asked (they asked about it) | heard (it came up in talk)
  spoken     smallint not null default 0,        -- times they got it right OUT LOUD; a word only ever read is not learned
  -- Where the scheduler has got to (FSRS: src/lingo/schedule.ts)
  stability  double precision not null default 0,
  difficulty double precision not null default 0,
  reps       integer not null default 0,
  lapses     integer not null default 0,
  steps      smallint not null default 0,      -- which learning step it is on: without it a learner never leaves the learning loop
  state      text not null default 'new',        -- new | learning | review | relearning
  due_ms     bigint not null,
  last_ms    bigint,                             -- when it was last answered; null while new
  created_ms bigint not null,
  updated_ms bigint not null,
  primary key (user_id, target, item)
);
do $$ begin
  alter table public.lingo_items add constraint lingo_items_kind check (kind in ('word', 'phrase'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_items add constraint lingo_items_state
    check (state in ('new', 'learning', 'review', 'relearning'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_items add constraint lingo_items_source
    check (source in ('seed', 'said', 'asked', 'heard'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_items add constraint lingo_items_size
    check (char_length(item) between 1 and 200 and char_length(gloss) <= 300);
exception when duplicate_object then null; end $$;
-- What a session asks for: this course's items, soonest due first.
create index if not exists lingo_items_due_idx on public.lingo_items (user_id, target, due_ms);
-- How many are still unseen, for the session's mix of new and due.
create index if not exists lingo_items_state_idx on public.lingo_items (user_id, target, state);

alter table public.lingo_learners enable row level security;
alter table public.lingo_items enable row level security;
-- A person may READ their own rows; the server writes with the service key.
do $$ begin
  create policy lingo_learners_own on public.lingo_learners for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy lingo_items_own on public.lingo_items for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- Run in your Supabase SQL editor. It needs nothing before it and can be run again.
