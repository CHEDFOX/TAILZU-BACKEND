-- Which voice wrote it.
--
-- cleanup_history recorded WHAT was written and in which language, but never
-- in whose voice — so "which of your voices do you actually use" had no answer
-- to give, and the Voices card could only ever show the one currently
-- selected, which is a setting rather than a habit.
--
-- Two columns, because they answer two different questions and one cannot be
-- derived from the other:
--
--   tone       the register asked for on this request — none/formal/casual/
--              very-casual/excited. "none" is Zu: the user's own voice.
--   preset_id  the voice that was active, built-in or one they made. A custom
--              voice keeps its id here after it is renamed, so a rename does
--              not split its history in two.
--
-- Both nullable and both written only from now on. Rows already in the table
-- keep NULL and are counted as unknown rather than guessed at — a chart that
-- invents a past is worse than one that starts today.
alter table public.cleanup_history
  add column if not exists tone      text,
  add column if not exists preset_id text;

-- The stats query filters by user and window and then groups on these, so the
-- existing (user_id, created_at desc) index already does the work. No new
-- index: two low-cardinality columns on a table read a few times a day do not
-- earn one, and every index is a cost on the write path that runs constantly.
