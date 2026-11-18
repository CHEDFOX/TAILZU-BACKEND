-- Tailzu — Lingo: what is known about somebody on one language (src/lingo/portrait.ts; docs/lingo.md).
-- The path they are on, and the numbers the portrait is built from. All optional: a course from before this has
-- none of it, and the portrait says it does not know rather than guessing.
--   unit            where they are on the path (src/lingo/course.ts UNITS); empty means the first
--   last_answer_ms  when they last answered anything here: what the NEXT answer's thinking time is measured from
--   tally           per kind of exercise { asked, right, ms } — what the portrait's shrunk rates are built from
--   think_ms        per item, the running middle of how long they take on it, in ms
alter table public.lingo_learners add column if not exists unit           text;
alter table public.lingo_learners add column if not exists last_answer_ms bigint;
alter table public.lingo_learners add column if not exists tally          jsonb;
alter table public.lingo_items    add column if not exists think_ms       integer;
do $$ begin
  alter table public.lingo_items add constraint lingo_items_think check (think_ms is null or think_ms between 0 and 600000);
exception when duplicate_object then null; end $$;
