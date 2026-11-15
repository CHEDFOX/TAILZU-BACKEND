-- Tailzu — our own calls get the brief too (src/rooms, docs/brief.md, docs/rooms.md).
--
-- rooms.note_id   the note this call's words are written into (src/notes, as the desktop's note-taker and the meeting bot use).
--                 One a call; null until somebody says something.
-- rooms.brief     the document the bot is making of the call, the same shape as meetings.brief (0095): parts of blocks, read
--                 back through the drawing checker.
--
-- Null for every call from before this. Written and read by the server with the service key only, as the rest of the row is.
--
-- Run in your Supabase SQL editor after 0095. It can be run again. Without it a call still gets its note and its document while
-- it runs; a restart forgets which note it was (the note itself is kept, in notes).

alter table public.rooms add column if not exists note_id uuid;
alter table public.rooms add column if not exists brief jsonb;
