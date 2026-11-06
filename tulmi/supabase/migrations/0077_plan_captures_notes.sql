-- Tailzu — a meeting's notes as a capture card (src/botsBots/planCapture.ts fromNote; docs/plan-ease.md "Getting things in").
--
-- plan_captures + source 'notes'   when a meeting's notes are ready, its to-dos with a real name and a day become one card: someone
--                                  else's a wait ("Waiting on Rahul · by Thu"), the person's own a to-do. Nothing is read again: the
--                                  notes already were. The check widens from ('share', 'photo', 'pdf', 'text') to take 'notes' too.
--
-- Run in your Supabase SQL editor after 0072. It can be run again. Older server code never writes 'notes' and reads the column as text.

alter table public.plan_captures drop constraint if exists plan_captures_source_check;
alter table public.plan_captures add constraint plan_captures_source_check check (source in ('share', 'photo', 'pdf', 'text', 'notes'));
