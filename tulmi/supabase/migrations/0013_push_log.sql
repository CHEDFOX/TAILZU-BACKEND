-- Tulmi — the smart-notification engine's memory (src/push).
--
-- Run in your Supabase SQL editor after 0012.
--
-- One row per person per reason per period: "streak:2026-09-26",
-- "weekly:w2908", "refill:2026-10". The engine INSERTS the row before it sends,
-- and the unique key is the lock: a second engine, or one restarted in the
-- middle of a pass, fails the insert and sends nothing. Nothing is sent twice.
--
-- The row is also how the engine learns: sent_at for the caps and the gaps,
-- opened_at (set when the tap brings the app to the push's screen) for
-- fatigue — three pushes in a row nobody answered and it goes quiet.
--
-- Tokens are not stored here. `tickets` holds each phone's platform, a hash of
-- its token and Expo's ticket id, which is enough to find and drop a token
-- Apple or Google later disown, and nothing more.

create table if not exists public.push_log (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  kind             text not null,
  period_key       text not null,
  planned_at       timestamptz not null,
  -- claimed → sent | failed
  status           text not null default 'claimed',
  sent_at          timestamptz,
  opened_at        timestamptz,
  tickets          jsonb,
  receipts_checked boolean not null default false,
  error            text,
  created_at       timestamptz not null default now(),
  unique (user_id, period_key)
);

create index if not exists push_log_user_created_idx
  on public.push_log (user_id, created_at desc);

-- The receipts pass: sent, not yet checked.
create index if not exists push_log_receipts_idx
  on public.push_log (sent_at)
  where status = 'sent' and receipts_checked = false;

-- Service role only. No policy at all: a person's push history is not
-- something the app reads, and nothing but the server writes it.
alter table public.push_log enable row level security;
