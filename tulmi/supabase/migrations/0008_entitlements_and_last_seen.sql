-- Tulmi — who is paying, and when we last saw them.
--
-- Run in your Supabase SQL editor after 0007.
--
-- ENTITLEMENTS ARE NOT ON `profiles`, DELIBERATELY.
--
-- The profiles policy is "users manage own profile" with `auth.uid() = user_id`
-- on both using and with check — so a signed-in user can write their own row
-- directly against Supabase with their own JWT. An `is_pro` column there would
-- be a subscription anyone could grant themselves in one request.
--
-- This table has a SELECT policy and nothing else. Users can read their own
-- entitlement; only the service-role key can write it, and only the RevenueCat
-- webhook does.

create table if not exists public.entitlements (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  -- The entitlement identifier from RevenueCat ("pro"). Kept as text rather
  -- than a boolean so a second tier never needs a migration.
  entitlement  text not null,
  -- Live right now. Stored rather than derived from expires_at alone, because
  -- a cancellation, a refund and a billing failure all end access at moments
  -- the expiry date does not describe.
  active       boolean not null default false,
  -- When access ends if nothing renews it. Null for a lifetime purchase.
  expires_at   timestamptz,
  -- "app_store" | "play_store" | "stripe" | "promotional" — useful when a
  -- refund arrives and you need to know where to look.
  store        text,
  -- The last event RevenueCat sent, for debugging a disputed state.
  last_event   text,
  updated_at   timestamptz not null default now()
);

alter table public.entitlements enable row level security;

-- Read your own. No insert or update policy exists on purpose: writes come
-- from the service-role key, which bypasses RLS, and from nowhere else.
drop policy if exists "users read own entitlement" on public.entitlements;
create policy "users read own entitlement"
  on public.entitlements
  for select
  using (auth.uid() = user_id);

create index if not exists entitlements_active_idx
  on public.entitlements (active, expires_at);


-- LAST SEEN.
--
-- On profiles rather than its own table: it is a property of the person, it is
-- written on every bootstrap, and a user forging their own last-visit time
-- costs nothing. Nullable, because every existing row predates it.
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- Cheap "who came back this week" without scanning the table.
create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen_at desc nulls last);
