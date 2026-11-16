-- Tailzu — the cinema bot (src/cinema, docs/cinema.md): films made shot by shot, and pictures.
--
-- cinema_films     one row a film: where it stands (writing, script, boarding, board, rendering, cutting, done, failed, stopped), why it waits
--                  (hold: budget or shot), what the person asked for, the frame, the quality tier, the length, the voice-over's voice, the money
--                  they agreed to and what has been spent (paise), and the film itself as one JSON body: the script (bible and shot list), each
--                  shot's progress, every take tried, the cut, and the notes for the person
-- cinema_pictures  one row a picture the bot made: the words asked, its kind, the model, the media key of the picture, what it cost
-- cinema_cast      the people a person keeps and uses again across films and pictures: their look, clothes and voice, and the media key of
--                  their reference sheet
--
-- The pictures, stills, takes and films are blobs in R2 under u/<person>/cinema/; these rows only name them. Written and read by the server
-- with the service key only: row level security is on and there is no policy, so no token reads or writes them. Rows go with the account
-- (on delete cascade), and the server deletes the blobs as the account goes.
--
-- Run after 0088. It can be run again. Without it the server keeps these in memory, and a restart forgets them.

create table if not exists public.cinema_films (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  status       text not null check (status in ('writing', 'script', 'boarding', 'board', 'rendering', 'cutting', 'done', 'failed', 'stopped')),
  hold         text check (hold in ('budget', 'shot')),
  idea         text not null check (char_length(idea) <= 4000),
  aspect       text not null check (aspect in ('16:9', '9:16', '1:1')),
  tier         text not null check (tier in ('draft', 'standard', 'premium')),
  length       integer not null check (length between 3 and 600),
  voice        text not null default 'nova',
  budget_paise integer not null default 0 check (budget_paise >= 0),
  spent_paise  integer not null default 0 check (spent_paise >= 0),
  body         jsonb not null default '{}'::jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists cinema_films_user_updated on public.cinema_films (user_id, updated_at desc);
create index if not exists cinema_films_working on public.cinema_films (status, updated_at) where status in ('boarding', 'rendering', 'cutting');

create table if not exists public.cinema_pictures (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  words      text not null check (char_length(words) <= 4000),
  kind       text not null,
  model      text not null,
  media_key  text not null,
  type       text not null,
  paise      integer not null default 0 check (paise >= 0),
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists cinema_pictures_user_created on public.cinema_pictures (user_id, created_at desc);

create table if not exists public.cinema_cast (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9-]{1,40}$'),
  name       text not null check (char_length(name) <= 40),
  look       text not null default '',
  wardrobe   text not null default '',
  voice      text not null default '',
  ref        text,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.cinema_films enable row level security;
alter table public.cinema_pictures enable row level security;
alter table public.cinema_cast enable row level security;
