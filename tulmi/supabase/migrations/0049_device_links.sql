-- Tailzu — signing in on a computer with the phone (src/auth/deviceLink.ts, src/routes/deviceLink.ts).
--
-- The window's sign-in shows a QR code and a short code; the signed-in phone approves; the window then takes a session
-- of its own, once. One row per request.
--
-- Run in your Supabase SQL editor. It needs nothing from the other migrations and can be run again. Without it a
-- request cannot be kept, so the window's QR panel says it couldn't make a code; the routes are off (link_off) on a
-- server with no service key.
--
-- device_links  token_hash, secret_hash and code_hash are SHA-256 of the three random values (the QR's token, the
--               window's own secret, the typed code): nothing in the table signs anyone in. status moves
--               pending -> approved | denied, and approved -> used exactly once (a conditional update). A used row stays
--               as the record of the computer (who, which computer, when, from which address); requests that ran out
--               unused are deleted a day later by the server. Written and read only by the server with the service key:
--               rows exist before there is an account, so row-level security is on with no policies (no person reads
--               them directly). A person's rows go with their account.

create table if not exists public.device_links (
  id           text primary key,
  token_hash   text not null unique,
  secret_hash  text not null,
  code_hash    text not null,
  device_name  text not null default '' check (char_length(device_name) <= 64),
  platform     text not null default '' check (platform in ('', 'mac', 'windows', 'linux')),
  ip           text,
  user_agent   text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used')),
  user_id      uuid references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  decided_at   timestamptz,
  used_at      timestamptz
);

-- The typed code finds a pending request.
create index if not exists device_links_code_idx on public.device_links (code_hash) where status = 'pending';
-- The sweep of requests that ran out.
create index if not exists device_links_expires_idx on public.device_links (expires_at) where status <> 'used';
-- A person's computers, newest first.
create index if not exists device_links_user_idx on public.device_links (user_id, used_at desc) where status = 'used';

alter table public.device_links enable row level security;
