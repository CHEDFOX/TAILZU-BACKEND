-- Tailzu — Xode in the terminal: its own sign-in (src/auth/deviceTokens.ts, src/routes/account/devices.ts, docs/xode-cli.md).
--
-- `xode login` starts a sign-in request like the window's (device_links, migration 0049), with kind 'cli'; the person approves
-- it in the app; the terminal's poll takes a token of its own, once. One row per terminal.
--
-- Run in your Supabase SQL editor. It needs 0049 (device_links) and can be run again. Without it the window's sign-in works
-- as before, but a terminal's request cannot be kept and no terminal can sign in.
--
-- device_tokens  token_hash is the SHA-256 of the terminal's token ("xdt_" and 32 random bytes): the table alone signs nobody
--                in. name and platform are what the terminal said it was. last_used_at is written at most every ten minutes.
--                Removing one (by the person in Settings, or `xode logout`) sets revoked_at; the row stays as the record of
--                that terminal. Written and read only by the server with the service key: row-level security is on with no
--                policies. A person's rows go with their account.
--
-- device_links.kind  'app' (the desktop app's window, as before) or 'cli' (a terminal).

create table if not exists public.device_tokens (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  token_hash    text not null unique,
  name          text not null default '' check (char_length(name) <= 64),
  platform      text not null default '' check (platform in ('', 'mac', 'windows', 'linux')),
  kind          text not null default 'cli' check (kind in ('cli')),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- A person's terminals, newest first.
create index if not exists device_tokens_user_idx on public.device_tokens (user_id, created_at desc) where revoked_at is null;

alter table public.device_tokens enable row level security;

alter table public.device_links add column if not exists kind text not null default 'app' check (kind in ('app', 'cli'));
