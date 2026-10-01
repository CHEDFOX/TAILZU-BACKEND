-- Tulmi — Razorpay subscriptions, in a table of their own.
--
-- Run in your Supabase SQL editor after 0014.
--
-- RevenueCat writes public.entitlements for the phones. Razorpay, which sells
-- on the web and the desktop, does not go through RevenueCat, and its rows
-- live here instead, so neither source can ever overwrite the other: an
-- account is entitled when EITHER says so (billing/entitlements.ts).
--
-- One row per Razorpay subscription, created by the server the moment it
-- creates the subscription, and kept current from Razorpay itself (the
-- webhook is only the signal to go and read it).
--
-- (An earlier draft of this file added entitlements.subscription_id. If that
-- line was already run, the column is unused and harmless.)

create table if not exists public.razorpay_subscriptions (
  subscription_id      text primary key,
  user_id              uuid not null references auth.users(id) on delete cascade,
  plan_id              text not null,
  -- "IN" or "world": which of the configured plans it was sold from.
  market               text,
  -- Razorpay's own status: created, authenticated, active, pending, halted,
  -- cancelled, completed, expired, paused.
  status               text not null,
  -- The end of the period paid for (Razorpay's current_end).
  period_end           timestamptz,
  -- Access runs to here: the period end plus slack while it renews, the
  -- period end once cancelled, nothing once halted. Computed from status.
  entitled_until       timestamptz,
  -- Set by Tailzu's own cancel, and never cleared by a later event: a
  -- subscription someone cancelled stays cancelled.
  cancel_at_period_end boolean not null default false,
  -- TEST (rzp_test_ keys) or LIVE.
  environment          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists razorpay_subscriptions_user_idx
  on public.razorpay_subscriptions (user_id, entitled_until desc);

alter table public.razorpay_subscriptions enable row level security;

-- Read your own. Writes come only from the service-role key.
drop policy if exists "read own razorpay subscriptions" on public.razorpay_subscriptions;
create policy "read own razorpay subscriptions" on public.razorpay_subscriptions
  for select using (auth.uid() = user_id);
