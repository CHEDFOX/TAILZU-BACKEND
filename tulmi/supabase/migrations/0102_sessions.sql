-- Tailzu — sessions, and every word kept (src/botsBots/sessions.ts, chat.ts; docs/bots.md).
--
-- A SESSION is one conversation with one bot, and everything made in it. It never closes: coming back to it a month later carries on where
-- it stopped (the screen draws a dotted line where that happened). A bot's page is its sessions, newest first, each with a frame taken from
-- whatever it made.
--
-- bot_sessions     one row a session: whose, which bot, what it is about, the media key of the frame its row shows, when it began and when
--                  it was last touched
--
-- And the thing this migration is really for: BOT CHAT TURNS ARE NO LONGER THROWN AWAY. Until now the server kept the newest 200 turns a
-- person a bot and deleted the rest for good (chat.ts prune). They are all kept from here on; 200 is only how many the page and the model
-- read. Nothing is backfilled - what was deleted is gone - so the sooner this runs, the less is lost.
--
-- The aspect check on cinema_films widens at the same time: a film is FILMED at the nearest shape a video model can make and CUT to the
-- shape that was asked for (src/cinema/cut.ts), so the shapes a person may ask for are no longer only the three the models happen to offer.
--
-- Run after 0089. It can be run again. Written and read by the server with the service key only; rows go with the account.
-- Times are epoch milliseconds.

create table if not exists public.bot_sessions (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  bot        text not null check (char_length(bot) between 1 and 64),
  title      text not null default '' check (char_length(title) <= 200),
  -- The media key of the frame the session's row shows: a picture it made, or a frame from one of its films. Null until it makes something.
  frame      text check (char_length(frame) <= 400),
  started_ms bigint not null,
  touched_ms bigint not null
);

create index if not exists bot_sessions_idx on public.bot_sessions (user_id, bot, touched_ms desc);

alter table public.bot_sessions enable row level security;

-- Which session a turn belongs to. Null for every turn said before this ran: those are the bot's history with no session of their own, and
-- the screens show them as one first session.
alter table public.bot_chat_turns add column if not exists session_id uuid references public.bot_sessions (id) on delete set null;
create index if not exists bot_chat_turns_session on public.bot_chat_turns (session_id, at_ms);

-- What a session made.
alter table public.cinema_films    add column if not exists session_id uuid references public.bot_sessions (id) on delete set null;
alter table public.cinema_pictures add column if not exists session_id uuid references public.bot_sessions (id) on delete set null;
create index if not exists cinema_films_session    on public.cinema_films (session_id);
create index if not exists cinema_pictures_session on public.cinema_pictures (session_id);

-- Every shape a person may ask for. The router still only asks a model for a shape it makes; the cut crops to the rest.
alter table public.cinema_films drop constraint if exists cinema_films_aspect_check;
alter table public.cinema_films add constraint cinema_films_aspect_check
  check (aspect in ('16:9', '9:16', '1:1', '4:5', '5:4', '4:3', '3:4', '21:9'));
