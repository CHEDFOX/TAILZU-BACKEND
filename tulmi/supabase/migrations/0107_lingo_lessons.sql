-- Tailzu — what fills a unit of Lingo's course, for one pair of languages (src/lingo/lessons.ts; docs/lingo.md).
--
-- The PATH is written once in no language (src/lingo/course.ts). This is the other half: what unit 5 actually holds
-- when it is Spanish taught in Tamil. Writing that by hand is months of work per pair and there are more pairs than
-- anybody will ever write, so it is written when the FIRST person on a pair reaches the unit and kept here for
-- everybody after — the next learner on that pair pays nothing and waits for nothing.
--
-- NOBODY OWNS THESE ROWS. A unit is the same for everyone learning the pair: no user_id, nothing written against a
-- person, nothing here that is anybody's data. One row serves every learner there will ever be.
--
-- A unit that could not be made is NOT written: an empty or thin row kept now would be taught to everybody after it
-- (src/lingo/lessons.ts ENOUGH), so nothing is better, and the next person's attempt is a fresh one.
create table if not exists public.lingo_lessons (
  lang       text not null,                     -- the language being learned, BCP-47
  gloss_lang text not null,                     -- the language it is taught in, BCP-47
  unit       text not null,                     -- a key in src/lingo/course.ts UNITS
  -- [{ text, meaning, kind }] — the unit's items, in the order they should be met.
  items      jsonb not null,
  made_ms    bigint not null,
  primary key (lang, gloss_lang, unit)
);

-- Written by the server with the service key only; no policy grants anybody else a row.
alter table public.lingo_lessons enable row level security;

-- Which unit of the path an item came from, where it came from one. A word somebody reached for in a conversation
-- has none, and that is the difference the scheduler already cares about (src/lingo/schedule.ts unseen).
alter table public.lingo_items add column if not exists unit text;

-- What is known about one item in each of the three ways it can be known — picking it out, writing it, saying it —
-- and how it goes wrong, by the grader's own reason (src/lingo/types.ts ItemMarks). One memory per item could not
-- tell a word somebody recognises from one they can say, and the grader's reason was thrown away after being shown
-- once, so the same mistake five times looked like five unrelated mistakes.
alter table public.lingo_items add column if not exists marks jsonb;
