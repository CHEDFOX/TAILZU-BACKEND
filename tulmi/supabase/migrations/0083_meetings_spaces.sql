-- Tailzu — the meeting bot in Spaces (src/meet, docs/spaces.md): a space's admin may send the bot to a member's meeting, for them.
--
-- meetings.by_id      the admin who sent the bot, when it was not the meeting's owner (user_id stays the member's: their note, their
--                     minutes, their push). Null for a meeting its owner sent the bot to, and once the admin's account is gone
-- meetings.space_id   the space that admin sent it through (no foreign key: a space deleted later leaves the member's meeting as it was)
--
-- Old rows read as null: their owner sent the bot. Written and read by the server with the service key only, as 0082's are. The server
-- writes these columns only for a meeting an admin sent, so without this migration every other meeting is kept as before; an admin's
-- send fails until it is run.
--
-- Run in your Supabase SQL editor after 0082. It can be run again.

alter table public.meetings add column if not exists space_id uuid;
alter table public.meetings add column if not exists by_id uuid references auth.users (id) on delete set null;
