-- Tailzu — the bots platform: a person's own bots, their API keys, saved commands, and what each bot has learned of its owner (src/bots, docs/bots.md).
--
-- Run in your Supabase SQL editor before turning BOTS on. It needs nothing from the other migrations. It can be run again. Without it the bots feature keeps
-- its rows in memory and a restart forgets them (and every API key).
--
-- bots          one row for each bot a person made: whose, its slug (unique across everyone: it is the bot's address, /v1/bots/<slug>), name, colour (the natural
--               palette only), purpose (one line), the owner's own rules (at most 12, each a short line: they shape tone and topic and never override Tailzu's
--               principles), the skills (web, files, artifacts, code, research, and the connected apps by id), the files it answers from (media ids), its
--               tone and its budgets (paise for one request and for one day). public_card is off unless the owner turns it on: only then does GET /v1/bots/<slug>
--               answer without a session, and it shows the name, purpose, colour and skills, nothing else. The built-in bots (Code, Keybot, Plan, Travel)
--               are defined in code and have no row.
-- bot_keys      an API key for one bot, for the person's own apps: only the key's hash (sha256 of BOT_KEY_PEPPER and the key) is kept, never the key, and its
--               first characters so the owner can tell them apart. last_used_at is when it last asked; a revoked key keeps its row and stops working.
--               A token can read a key's id, prefix, label and times; the hash is for the server alone.
-- bot_commands  a saved command: a short instruction with {{input}} in it, run from chat as /name. bot_id is a bot's id, or a built-in's slug.
-- bot_facts     the stable facts a bot learned of its owner, one short line each, for the owner to read and forget.
-- bot_threads   the rolling summary of the talk between a bot and its owner, and the last few turns not yet folded into it.
--
-- Written by the server with the service key only. OWNER-ONLY: a person's own token can READ their own rows and nothing else; there is no policy that lets a
-- token write. Rows go with the account (on delete cascade).

create table if not exists public.bots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  name        text not null check (char_length(name) between 1 and 40),
  colour      text not null check (colour in ('moss', 'clay', 'ochre', 'sea', 'pine', 'plum', 'sand', 'stone')),
  purpose     text not null check (char_length(purpose) between 1 and 140),
  principles  jsonb not null default '[]'::jsonb check (jsonb_typeof(principles) = 'array' and jsonb_array_length(principles) <= 12),
  skills      jsonb not null default '{}'::jsonb check (jsonb_typeof(skills) = 'object'),
  knowledge   jsonb not null default '[]'::jsonb check (jsonb_typeof(knowledge) = 'array' and jsonb_array_length(knowledge) <= 10),
  tone        text not null default '' check (char_length(tone) <= 80),
  budgets     jsonb not null default '{}'::jsonb check (jsonb_typeof(budgets) = 'object'),
  public_card boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bots_user_idx on public.bots (user_id, created_at);

create table if not exists public.bot_keys (
  id           uuid primary key default gen_random_uuid(),
  bot_id       uuid not null references public.bots (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  prefix       text not null check (char_length(prefix) between 4 and 16),
  label        text not null default '' check (char_length(label) <= 60),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists bot_keys_bot_idx on public.bot_keys (bot_id, created_at);

create table if not exists public.bot_commands (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  bot_id     text not null check (char_length(bot_id) between 1 and 64),
  name       text not null check (name ~ '^[a-z][a-z0-9_-]*$' and char_length(name) <= 24),
  template   text not null check (char_length(template) between 1 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, bot_id, name)
);

create table if not exists public.bot_facts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  bot_id     text not null check (char_length(bot_id) between 1 and 64),
  fact       text not null check (char_length(fact) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (user_id, bot_id, fact)
);

create index if not exists bot_facts_bot_idx on public.bot_facts (user_id, bot_id, created_at);

create table if not exists public.bot_threads (
  user_id    uuid not null references auth.users (id) on delete cascade,
  bot_id     text not null check (char_length(bot_id) between 1 and 64),
  summary    text not null default '' check (char_length(summary) <= 1200),
  buffer     jsonb not null default '[]'::jsonb check (jsonb_typeof(buffer) = 'array'),
  turns      integer not null default 0 check (turns >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, bot_id)
);

alter table public.bots         enable row level security;
alter table public.bot_keys     enable row level security;
alter table public.bot_commands enable row level security;
alter table public.bot_facts    enable row level security;
alter table public.bot_threads  enable row level security;

drop policy if exists "users read own bots" on public.bots;
create policy "users read own bots"
  on public.bots for select
  using (auth.uid() = user_id);

drop policy if exists "users read own bot keys" on public.bot_keys;
create policy "users read own bot keys"
  on public.bot_keys for select
  using (auth.uid() = user_id);

drop policy if exists "users read own bot commands" on public.bot_commands;
create policy "users read own bot commands"
  on public.bot_commands for select
  using (auth.uid() = user_id);

drop policy if exists "users read own bot facts" on public.bot_facts;
create policy "users read own bot facts"
  on public.bot_facts for select
  using (auth.uid() = user_id);

drop policy if exists "users read own bot threads" on public.bot_threads;
create policy "users read own bot threads"
  on public.bot_threads for select
  using (auth.uid() = user_id);

-- A token may read a key's id, prefix, label and times; the hash is for the server alone.
revoke select on public.bot_keys from anon, authenticated;
grant select (id, bot_id, user_id, prefix, label, created_at, last_used_at, revoked_at) on public.bot_keys to authenticated;
