-- Tailzu — the Bots app's "bots" area (src/botsBots, routes/botsBots.ts): a bot's chat as the app shows it, the draft of a bot being made,
-- the bot store, what each bot API key used, spaces, the Plan bot's kept-as-is suggestions and the Travel bot's trip.
--
-- Run in your Supabase SQL editor after 0038_bots.sql. It can be run again. Without it these rows live in memory and a restart forgets them.
--
-- bot_chat_turns    what the person said to a bot and what it answered, turn by turn (the bot's memory is bot_facts / bot_threads; this is the words),
--                   at most 200 a bot a person; a bot turn's extra holds the links it opened, the changes waiting for a yes and what it cost
-- bot_drafts        the one bot a person is making: their sentence, the draft the bots platform made of it (POST /v1/bots/draft), their edits,
--                   and the trial chat. Nothing here is a bot until they approve it.
-- bot_listings      a bot its owner listed in "Find a bot" (its public card is on too); by_name is how the owner is shown ("Meera R.")
-- bot_listing_adds  who added a copy of which listing (or of a Tailzu ready-made bot, by its id), and the copy's id
-- bot_key_usage     requests and paise per bot API key (by its masked prefix, never the key) per day
-- spaces, space_members, space_bots, space_invites
--                   a space shared with family or a team: who is in it and who may approve payments, the bots shared into it, invite codes
-- plan_skips        a Plan bot suggestion the person answered "keep it" to, so it is not made again
-- trips             the Travel bot's trip: where, when, who, the packing list
--
-- Written by the server with the service key only. A person's own token can READ their own personal rows; the space tables are the server's alone.
-- Times are epoch milliseconds.

create table if not exists public.bot_chat_turns (
  id      uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bot     text not null check (char_length(bot) between 1 and 64),
  role    text not null check (role in ('me', 'bot')),
  text    text not null check (char_length(text) <= 20000),
  extra   jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  at_ms   bigint not null
);
create index if not exists bot_chat_turns_idx on public.bot_chat_turns (user_id, bot, at_ms desc);

create table if not exists public.bot_drafts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  sentence   text not null check (char_length(sentence) <= 600),
  draft      jsonb not null check (jsonb_typeof(draft) = 'object'),
  trial      jsonb not null default '[]'::jsonb check (jsonb_typeof(trial) = 'array'),
  updated_ms bigint not null
);

create table if not exists public.bot_listings (
  id        text primary key,
  bot_id    uuid not null unique references public.bots (id) on delete cascade,
  owner_id  uuid not null references auth.users (id) on delete cascade,
  by_name   text not null default '' check (char_length(by_name) <= 40),
  listed_ms bigint not null
);
create index if not exists bot_listings_listed_idx on public.bot_listings (listed_ms desc);

create table if not exists public.bot_listing_adds (
  listing_id text not null check (char_length(listing_id) between 1 and 64),
  user_id    uuid not null references auth.users (id) on delete cascade,
  bot_id     uuid not null,
  added_ms   bigint not null,
  primary key (listing_id, user_id, bot_id)
);
create index if not exists bot_listing_adds_listing_idx on public.bot_listing_adds (listing_id);

create table if not exists public.bot_key_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  slug     text not null check (char_length(slug) between 1 and 64),
  masked   text not null check (char_length(masked) between 1 and 40),
  day      text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  requests integer not null default 0 check (requests >= 0),
  paise    integer not null default 0 check (paise >= 0),
  last_ms  bigint not null,
  primary key (user_id, slug, masked, day)
);

create table if not exists public.spaces (
  id         uuid primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  created_ms bigint not null
);

create table if not exists public.space_members (
  space_id    uuid not null references public.spaces (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 40),
  can_approve boolean not null default false,
  joined_ms   bigint not null,
  primary key (space_id, user_id)
);
create index if not exists space_members_user_idx on public.space_members (user_id);

create table if not exists public.space_bots (
  space_id uuid not null references public.spaces (id) on delete cascade,
  slug     text not null check (char_length(slug) between 1 and 64),
  name     text not null check (char_length(name) between 1 and 40),
  colour   text not null,
  added_by uuid not null references auth.users (id) on delete cascade,
  added_ms bigint not null,
  primary key (space_id, slug)
);

create table if not exists public.space_invites (
  code       text primary key check (code ~ '^[A-Z0-9]{6,16}$'),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_ms bigint not null,
  expires_ms bigint not null
);
create index if not exists space_invites_space_idx on public.space_invites (space_id, created_ms desc);

create table if not exists public.plan_skips (
  user_id uuid not null references auth.users (id) on delete cascade,
  key     text not null check (char_length(key) between 1 and 300),
  at_ms   bigint not null,
  primary key (user_id, key)
);

create table if not exists public.trips (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  place      text not null check (char_length(place) between 1 and 60),
  when_text  text not null default '' check (char_length(when_text) <= 40),
  who        text not null default '' check (char_length(who) <= 60),
  packing    jsonb not null default '[]'::jsonb check (jsonb_typeof(packing) = 'array' and jsonb_array_length(packing) <= 30),
  created_ms bigint not null,
  updated_ms bigint not null
);
create index if not exists trips_user_idx on public.trips (user_id, created_ms desc);

alter table public.bot_chat_turns   enable row level security;
alter table public.bot_drafts       enable row level security;
alter table public.bot_listings     enable row level security;
alter table public.bot_listing_adds enable row level security;
alter table public.bot_key_usage    enable row level security;
alter table public.spaces           enable row level security;
alter table public.space_members    enable row level security;
alter table public.space_bots       enable row level security;
alter table public.space_invites    enable row level security;
alter table public.plan_skips       enable row level security;
alter table public.trips            enable row level security;

drop policy if exists "users read own bot chat" on public.bot_chat_turns;
create policy "users read own bot chat" on public.bot_chat_turns for select using (auth.uid() = user_id);
drop policy if exists "users read own bot draft" on public.bot_drafts;
create policy "users read own bot draft" on public.bot_drafts for select using (auth.uid() = user_id);
drop policy if exists "users read own listings" on public.bot_listings;
create policy "users read own listings" on public.bot_listings for select using (auth.uid() = owner_id);
drop policy if exists "users read own adds" on public.bot_listing_adds;
create policy "users read own adds" on public.bot_listing_adds for select using (auth.uid() = user_id);
drop policy if exists "users read own key usage" on public.bot_key_usage;
create policy "users read own key usage" on public.bot_key_usage for select using (auth.uid() = user_id);
drop policy if exists "users read own plan skips" on public.plan_skips;
create policy "users read own plan skips" on public.plan_skips for select using (auth.uid() = user_id);
drop policy if exists "users read own trips" on public.trips;
create policy "users read own trips" on public.trips for select using (auth.uid() = user_id);
