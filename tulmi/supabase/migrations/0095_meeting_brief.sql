-- Tailzu — the brief (src/brief, docs/brief.md): the document the bot makes while a meeting runs.
--
-- meetings.brief   the document as it stands: {"v":n,"at":ms,"parts":[{"id","kind","title","blocks":[…],"at","v"}]}, where the
--                  blocks are the ones a bot already draws under its words (src/show, docs/show.md). Written every pass while
--                  the meeting goes on and once more when it ends; read back through the same checker the blocks came in by, so
--                  a row is never trusted further than a model's answer was.
--
-- Null for a meeting with nothing written yet, and for every meeting from before this. Written and read by the server with the
-- service key only, as the rest of the row is: row level security is on and there is no policy.
--
-- Run in your Supabase SQL editor after 0094. It can be run again. Without it a brief lives only as long as the server's memory:
-- the meeting still gets its document while it runs, and a restart forgets it (the note and its transcript are kept either way).

alter table public.meetings add column if not exists brief jsonb;
