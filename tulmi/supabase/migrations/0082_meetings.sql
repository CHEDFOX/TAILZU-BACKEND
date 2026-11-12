-- Tailzu — the meeting bot (src/meet, docs/meet.md): a person's bot in their video calls, sent there by Recall.ai.
--
-- meet_settings   one row a person: whether their bot joins the calendar's meetings by itself, whether it answers out loud, and the
--                 name it shows in a call ('' for the default, "X0 Bot")
-- meetings        one row a meeting the bot is sent to: the link and its platform, Recall's bot, the hash of the meeting's own token
--                 (the live webhook's and the stage page's address carry the token, never stored as it is), where it stands, the note
--                 its transcript goes into (src/notes), the notes so far, who is in the call, and why it failed. A calendar meeting
--                 has its event's key (event id and start), once a person
-- meeting_asks    what people asked the bot in a call, out loud or in the chat, and what it answered
--
-- The transcript itself is the note's (notes, 0014). Written and read by the server with the service key only: row level security is
-- on and there is no policy, so no token reads or writes them. Rows go with the account (on delete cascade).
--
-- Run in your Supabase SQL editor after 0081. It can be run again. Without it the server keeps these in memory, and a restart forgets
-- them (a meeting in progress keeps its note; the list of meetings starts empty).

create table if not exists public.meet_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  auto_join  boolean not null default false,
  voice      boolean not null default true,
  bot_name   text not null default '' check (char_length(bot_name) <= 60),
  updated_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  bot_id       text unique,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  url          text not null,
  platform     text not null check (platform in ('google_meet', 'zoom', 'teams', 'webex')),
  title        text not null default '',
  status       text not null check (status in ('scheduled', 'joining', 'waiting', 'in_call', 'ended', 'done', 'failed', 'cancelled')),
  voice        boolean not null default true,
  source       text not null default 'link' check (source in ('link', 'calendar')),
  event_key    text,
  join_at      timestamptz,
  started_at   timestamptz,
  ended_at     timestamptz,
  note_id      uuid,
  live_notes   jsonb,
  participants jsonb not null default '[]'::jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists meetings_user_created on public.meetings (user_id, created_at desc);

create table if not exists public.meeting_asks (
  id         bigserial primary key,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  asked_by   text not null default '',
  question   text not null,
  answer     text not null default '',
  how        text not null check (how in ('voice', 'chat')),
  created_at timestamptz not null default now()
);

create index if not exists meeting_asks_meeting on public.meeting_asks (meeting_id, id);

alter table public.meet_settings enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_asks enable row level security;
