-- Tailzu — Lingo: what a language is FOR (src/lingo; docs/lingo.md).
-- Asked once, as the language is added (bots.lingo.why), and never asked again. Two columns, both optional, because
-- skipping the question is a complete answer and a course started before this has neither.
--   why       one of the seven codes in src/lingo/types.ts WHY_CODES, or null
--   why_note  the same thing in their own words, which is worth more than the code
-- It is read by Lingo's chat (src/lingo/digest.ts), so the conversation is about the thing they came for.
alter table public.lingo_learners add column if not exists why      text;
alter table public.lingo_learners add column if not exists why_note text;
do $$ begin
  alter table public.lingo_learners add constraint lingo_learners_why
    check (why is null or why in ('someone', 'trip', 'living', 'work', 'family', 'study', 'curious'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_learners add constraint lingo_learners_why_note check (char_length(why_note) <= 400);
exception when duplicate_object then null; end $$;
