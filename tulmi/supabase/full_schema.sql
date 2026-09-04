-- ============================================================================
-- TAILZU — the whole schema, in one script.
--
-- Paste this into the Supabase SQL editor and run it. Safe on a fresh project
-- and safe on yours: every statement is guarded (create ... if not exists,
-- add column if not exists, drop policy if exists before create), so anything
-- already there is left exactly as it is and only what is missing gets made.
-- No table is dropped and no row is touched.
--
-- Re-runnable. If you are ever unsure whether a migration landed, run this.
-- ============================================================================


-- ############################################################################
-- 0001_usage_events.sql
-- ############################################################################

-- Tulmi — usage metering schema.
-- Run this in your Supabase project's SQL editor (or via the Supabase CLI).

create table if not exists public.usage_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  audio_seconds double precision not null default 0,
  word_count   integer not null default 0,
  model        text,
  source       text check (source in ('rest', 'stream')),
  created_at   timestamptz not null default now()
);

-- Fast lookups for "usage since <date>" per user.
create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

-- Row-level security: users may read ONLY their own usage. The backend writes
-- with the service-role key, which bypasses RLS, so no insert policy is needed.
alter table public.usage_events enable row level security;

drop policy if exists "users read own usage" on public.usage_events;
create policy "users read own usage"
  on public.usage_events
  for select
  using (auth.uid() = user_id);

-- Optional convenience view: per-user monthly rollup for free-tier checks.
create or replace view public.usage_monthly as
select
  user_id,
  date_trunc('month', created_at) as month,
  sum(audio_seconds)             as audio_seconds,
  sum(word_count)                as words,
  count(*)                       as requests
from public.usage_events
group by user_id, date_trunc('month', created_at);

-- ############################################################################
-- 0002_personalities.sql
-- ############################################################################

-- Tulmi — per-user personality / style profile.
-- Run in your Supabase project's SQL editor (after 0001_usage_events.sql).

create table if not exists public.personalities (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row-level security: a user may read and write ONLY their own profile.
-- (The backend uses the service-role key, which bypasses RLS; these policies
-- protect direct client access.)
alter table public.personalities enable row level security;

drop policy if exists "users manage own personality" on public.personalities;
create policy "users manage own personality"
  on public.personalities
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ############################################################################
-- 0003_profiles.sql
-- ############################################################################

-- Tulmi — per-user profile: language preference + onboarding state.
-- Run in your Supabase SQL editor after 0001 + 0002 (or use schema.sql for all).

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  language     text not null default 'auto',     -- 'auto' | 'en' | 'hi' | 'hinglish' | ...
  onboarded    boolean not null default false,
  onboarded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Row-level security: a user may read + write ONLY their own profile.
-- (The backend can use the user's JWT — RLS scopes it — or the service-role
-- key, which bypasses RLS. Both work.)
alter table public.profiles enable row level security;

drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile"
  on public.profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-create a profile row when a new auth user signs up, so the row always
-- exists (the backend also upserts defensively).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Allow users to insert their OWN usage rows (so metering works with the user's
-- JWT, not only the service-role key). The existing select policy still applies.
drop policy if exists "users insert own usage" on public.usage_events;
create policy "users insert own usage"
  on public.usage_events
  for insert
  with check (auth.uid() = user_id);

-- ############################################################################
-- 0004_history.sql
-- ############################################################################

-- Tulmi — cleanup history (opt-in per user via personality.learnFromSent or
-- personality.retainHistory). Rows are append-only from the client's POV; the
-- API exposes a soft-delete via a deleted_at column so a user can remove an
-- individual entry without breaking any downstream aggregates.
--
-- Retention: a periodic cleanup should hard-prune anything older than 90 days
-- per user. That job is intentionally out-of-tree here — document in ops.
--
-- Run in your Supabase SQL editor after 0001–0003 (or use schema.sql for all).

create table if not exists public.cleanup_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('voice', 'typing', 'draft')),
  target_app   text,
  language     text,
  input        text not null,   -- transcript or raw typed
  output       text not null,   -- cleaned / drafted
  duration_ms  integer,
  words_in     integer,
  words_out    integer,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists cleanup_history_user_created_idx
  on public.cleanup_history (user_id, created_at desc);

-- Fast lookup for the soft-deleted filter used by every list query.
create index if not exists cleanup_history_user_live_idx
  on public.cleanup_history (user_id, created_at desc)
  where deleted_at is null;

alter table public.cleanup_history enable row level security;

-- SELECT — only the user's own rows, and only ones they haven't soft-deleted.
drop policy if exists "users read own history" on public.cleanup_history;
create policy "users read own history"
  on public.cleanup_history
  for select
  using (auth.uid() = user_id and deleted_at is null);

-- INSERT — a user may only insert rows attributed to themselves.
drop policy if exists "users insert own history" on public.cleanup_history;
create policy "users insert own history"
  on public.cleanup_history
  for insert
  with check (auth.uid() = user_id);

-- UPDATE — narrowly scoped to soft-delete (setting deleted_at). We still gate
-- rows to the caller's own, and refuse rewrites of the input/output columns
-- via a trigger below. Update-based soft-delete is the simplest way to keep the
-- table append-only from the API surface while giving the user a "remove"
-- button.
drop policy if exists "users soft-delete own history" on public.cleanup_history;
create policy "users soft-delete own history"
  on public.cleanup_history
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Guard: refuse edits to the payload columns. Only deleted_at may change.
create or replace function public.cleanup_history_no_edit()
returns trigger
language plpgsql
as $$
begin
  if new.input       is distinct from old.input       then raise exception 'cleanup_history.input is immutable'; end if;
  if new.output      is distinct from old.output      then raise exception 'cleanup_history.output is immutable'; end if;
  if new.kind        is distinct from old.kind        then raise exception 'cleanup_history.kind is immutable'; end if;
  if new.user_id     is distinct from old.user_id     then raise exception 'cleanup_history.user_id is immutable'; end if;
  if new.created_at  is distinct from old.created_at  then raise exception 'cleanup_history.created_at is immutable'; end if;
  return new;
end;
$$;

drop trigger if exists cleanup_history_no_edit_trg on public.cleanup_history;
create trigger cleanup_history_no_edit_trg
  before update on public.cleanup_history
  for each row execute function public.cleanup_history_no_edit();

-- No DELETE policy on purpose — rows are removed via soft-delete only. The
-- service-role key bypasses RLS for the periodic 90-day retention purge.

-- ############################################################################
-- 0005_push_tokens.sql
-- ############################################################################

-- Push tokens the backend can target for notifications.
--
-- The client posts an Expo push token every launch. Each row is (user, platform)
-- so a device swap or reinstall naturally overwrites the same row. Old tokens
-- from previous devices go stale on Expo's side and their sends fail — we
-- clean them up lazily by only ever keeping the most recent per (user,
-- platform).

create table if not exists public.push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  token text not null,
  app_version text,
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);

-- Row-level security: users can only see and write their own tokens; server-side
-- code uses the service role and bypasses RLS to send pushes.
alter table public.push_tokens enable row level security;

drop policy if exists "own token select" on public.push_tokens;
create policy "own token select" on public.push_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "own token upsert" on public.push_tokens;
create policy "own token upsert" on public.push_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists "own token update" on public.push_tokens;
create policy "own token update" on public.push_tokens
  for update using (auth.uid() = user_id);

drop policy if exists "own token delete" on public.push_tokens;
create policy "own token delete" on public.push_tokens
  for delete using (auth.uid() = user_id);

create index if not exists push_tokens_user_idx on public.push_tokens(user_id);

-- ############################################################################
-- 0006_keyboard_telemetry.sql
-- ############################################################################

-- Tulmi — keyboard telemetry.
--
-- Diagnostic COUNTERS only. No typed text, no transcripts, no message
-- content ever reaches this table — the keyboard increments integers and
-- flushes them; there is deliberately no free-text column to put content in.
-- That's what makes this safe to collect from a keyboard extension, which can
-- see everything the user types.
--
-- Why it exists: 130+ keyboard behaviors are remotely tunable and can now be
-- rolled out to a slice of users, but without counters every experiment is
-- judged by feel. `buckets` records which rollout slices the user was in when
-- the counters were produced, so a change can be compared against the
-- baseline cohort instead of against a hunch.
--
-- Run in your Supabase SQL editor after 0001–0005.

create table if not exists public.keyboard_telemetry (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- Keyboard build stamp (K11 / K12 / …) so a regression can be pinned to a
  -- binary, and the app version alongside it.
  build         text,
  app_version   text,
  platform      text check (platform in ('ios', 'android')),
  -- Rollout slices this user was in: { "kb.touch.holdMultiplier": 3, ... }
  -- Bucket numbers, not values — enough to group by cohort.
  buckets       jsonb not null default '{}'::jsonb,
  -- The counters themselves: { "keystrokes": 812, "autocorrectReverted": 4, … }
  -- Kept as jsonb rather than columns so a new counter needs no migration.
  counters      jsonb not null default '{}'::jsonb,
  -- Wall-clock span the counters cover, so rates can be computed.
  window_ms     bigint not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists keyboard_telemetry_user_created_idx
  on public.keyboard_telemetry (user_id, created_at desc);

-- Cohort comparison reads scan by time + build, not by user.
create index if not exists keyboard_telemetry_created_build_idx
  on public.keyboard_telemetry (created_at desc, build);

alter table public.keyboard_telemetry enable row level security;

-- Users may read only their own rows. The backend writes with the service-role
-- key (bypasses RLS), so no insert policy is needed.
drop policy if exists "users read own telemetry" on public.keyboard_telemetry;
create policy "users read own telemetry"
  on public.keyboard_telemetry
  for select
  using (auth.uid() = user_id);

-- Rollup for "is this experiment better?": per build + bucket, the rates that
-- actually indicate keyboard quality. autocorrect_revert_rate is the sharpest
-- one — the user backspacing a correction is them telling you it was wrong.
create or replace view public.keyboard_quality as
select
  build,
  buckets,
  count(*)                                                as sessions,
  sum((counters->>'keystrokes')::bigint)                  as keystrokes,
  sum((counters->>'autocorrectApplied')::bigint)          as autocorrect_applied,
  sum((counters->>'autocorrectReverted')::bigint)         as autocorrect_reverted,
  -- Guard the divide: a cohort with no corrections yet must read NULL, not
  -- crash the view or report a fake 0%.
  case when sum((counters->>'autocorrectApplied')::bigint) > 0
    then round(
      sum((counters->>'autocorrectReverted')::bigint)::numeric
      / sum((counters->>'autocorrectApplied')::bigint), 4)
  end                                                     as autocorrect_revert_rate,
  sum((counters->>'touchesCancelledRescued')::bigint)     as taps_rescued,
  sum((counters->>'swipeCommitted')::bigint)              as swipes_committed,
  sum((counters->>'swipeAbandoned')::bigint)              as swipes_abandoned,
  sum((counters->>'refineFailed')::bigint)                as refine_failed,
  sum((counters->>'memoryWarnings')::bigint)              as memory_warnings
from public.keyboard_telemetry
group by build, buckets;

-- ############################################################################
-- 0007_profile_identity.sql
-- ############################################################################

-- Tulmi — persist what the name + gender card collects.
--
-- The card has always PUT full_name + gender to /v1/profile, and the route has
-- always dropped them: there was nowhere to put them. The only record that the
-- card had been filled in was a flag in the phone's own storage, so a reinstall
-- or a second device asked the same user for their name again — and the name
-- they typed the first time was never saved anywhere at all.
--
-- Run in your Supabase SQL editor after 0003.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists gender    text;

-- Keep the values sane without hard-coding a taxonomy the app might extend:
-- a bounded string, and a gender the app actually offers.
alter table public.profiles
  drop constraint if exists profiles_full_name_len;
alter table public.profiles
  add constraint profiles_full_name_len
  check (full_name is null or char_length(full_name) <= 120);

alter table public.profiles
  drop constraint if exists profiles_gender_known;
alter table public.profiles
  add constraint profiles_gender_known
  check (gender is null or gender in ('female', 'male', 'other'));

-- ############################################################################
-- 0008_entitlements_and_last_seen.sql
-- ############################################################################

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
