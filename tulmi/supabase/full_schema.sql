-- ============================================================================
-- TAILZU — the whole schema, in one script.
--
-- Paste this into the Supabase SQL editor and run it. Safe on a fresh project
-- and safe on a live one: every statement is guarded (create ... if not exists,
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

-- ############################################################################
-- 0009_entitlement_provenance.sql
-- ############################################################################

-- Tulmi — where an entitlement came from.
--
-- Run in your Supabase SQL editor after 0008.
--
-- Two columns, neither of which gates anything by itself. They exist because
-- the questions they answer arrive at the worst possible time: a customer says
-- they paid and the app disagrees, or a row grants access nobody can explain.
--
--   environment — SANDBOX or PRODUCTION. A TestFlight, Xcode or Play
--     internal-track purchase costs nothing and RevenueCat says so on every
--     event. Whether a sandbox purchase grants access is a config decision
--     (REVENUECAT_ALLOW_SANDBOX); recording which kind it was is not, because
--     without it a free test subscription and a paid one look identical here.
--
--   app_id — which RevenueCat app the event came from. One project can hold
--     the iOS app and the Android app, and a refund dispute starts with
--     knowing which store to open.

alter table public.entitlements
  add column if not exists environment text,
  add column if not exists app_id      text;

-- Find the free ones instantly at launch, when the question is "who is on this
-- because they paid, and who is on it because they were testing".
create index if not exists entitlements_environment_idx
  on public.entitlements (environment)
  where active;

-- ############################################################################
-- 0010_history_voice.sql
-- ############################################################################

-- Which voice wrote it.
--
-- cleanup_history recorded WHAT was written and in which language, but never
-- in whose voice — so "which of your voices do you actually use" had no answer
-- to give, and the Voices card could only ever show the one currently
-- selected, which is a setting rather than a habit.
--
-- Two columns, because they answer two different questions and one cannot be
-- derived from the other:
--
--   tone       the register asked for on this request — none/formal/casual/
--              very-casual/excited. "none" is Zu: the user's own voice.
--   preset_id  the voice that was active, built-in or one they made. A custom
--              voice keeps its id here after it is renamed, so a rename does
--              not split its history in two.
--
-- Both nullable and both written only from now on. Rows already in the table
-- keep NULL and are counted as unknown rather than guessed at — a chart that
-- invents a past is worse than one that starts today.
alter table public.cleanup_history
  add column if not exists tone      text,
  add column if not exists preset_id text;

-- The stats query filters by user and window and then groups on these, so the
-- existing (user_id, created_at desc) index already does the work. No new
-- index: two low-cardinality columns on a table read a few times a day do not
-- earn one, and every index is a cost on the write path that runs constantly.

-- ############################################################################
-- 0011_telemetry_insert_policy.sql
-- ############################################################################

-- Let the keyboard actually write its counters.
--
-- 0006 said: "The backend writes with the service-role key (bypasses RLS), so
-- no insert policy is needed." That was the intent and not the code.
-- recordKeyboardTelemetry writes with dataClientFor(user) — the user's own
-- JWT — which RLS very much applies to. With a read policy and no insert
-- policy, every write was refused.
--
-- It failed quietly, which is why it went unnoticed: the insert error is
-- logged and swallowed on purpose (a keyboard must never break because a
-- counter did not save), and the endpoint answers 200 either way. The only
-- symptom was this line, once per telemetry post, in the server log:
--
--   [telemetry] insert failed: new row violates row-level security policy
--
-- TWO WAYS TO FIX IT, and this is the smaller one. The other is to write with
-- the service-role key, matching what 0006 assumed. A policy is better here:
-- it does not hand a background counter more privilege than it needs, and it
-- keeps every row attributable to the user who produced it rather than to the
-- server. RLS then guarantees what the code already intended — a client can
-- only ever write its own rows, whatever it claims.
drop policy if exists "users write own telemetry" on public.keyboard_telemetry;
create policy "users write own telemetry"
  on public.keyboard_telemetry
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Insert only. There is deliberately no update or delete policy: this table is
-- an append-only log of counters, and a client that could rewrite its own
-- history could rewrite the answer to "is this experiment better?".

-- ############################################################################
-- 0012_history_merge.sql
-- ############################################################################

-- Let the server merge a dictation into the entry before it.
--
-- 0004 installed a guard that refuses any edit to a history row's payload, on
-- the principle that history is a record and records are not rewritten. That
-- is still right for everyone typing on a phone.
--
-- But the server later learned to MERGE: two dictations a few seconds apart
-- are one thought, not two entries, so the second one rewrites `output` and
-- `words_out` on the first rather than adding a row. The guard refuses that
-- update, the write falls back to an insert, and the merge produces exactly
-- the duplicate it exists to prevent — silently, because the fallback
-- succeeds. It shows up only as a line in the log:
--
--   [history] merge failed for <user>, inserting instead:
--     cleanup_history.output is immutable
--
-- Neither half was wrong. They were written at different times and never
-- introduced to each other.
--
-- So the guard learns who is asking. The service role — the backend, and
-- nothing else, because that key never leaves the server — may rewrite the
-- two columns a merge touches. Everything else stays immutable for everyone,
-- including the service role: what was SAID and when it was said are not ours
-- to edit, and a merge has no business changing them.
create or replace function public.cleanup_history_no_edit()
returns trigger
language plpgsql
as $$
declare
  -- PostgREST does SET ROLE from the key's JWT, so this is the honest
  -- question: is this the server, or is it somebody's phone?
  is_server boolean := current_user = 'service_role';
begin
  -- Never editable, whoever is asking.
  if new.user_id    is distinct from old.user_id    then raise exception 'cleanup_history.user_id is immutable'; end if;
  if new.created_at is distinct from old.created_at then raise exception 'cleanup_history.created_at is immutable'; end if;
  if new.kind       is distinct from old.kind       then raise exception 'cleanup_history.kind is immutable'; end if;
  if new.input      is distinct from old.input      then raise exception 'cleanup_history.input is immutable'; end if;

  -- What a merge rewrites. The server may; a user may not.
  if not is_server then
    if new.output    is distinct from old.output    then raise exception 'cleanup_history.output is immutable'; end if;
    if new.words_out is distinct from old.words_out then raise exception 'cleanup_history.words_out is immutable'; end if;
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged; 0004's definition still binds this
-- function. Re-created anyway so applying this file to a database that
-- somehow lost it leaves a working guard rather than none at all.
drop trigger if exists cleanup_history_no_edit_trg on public.cleanup_history;
create trigger cleanup_history_no_edit_trg
  before update on public.cleanup_history
  for each row execute function public.cleanup_history_no_edit();

-- ############################################################################
-- 0013_push_log.sql
-- ############################################################################

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

-- ############################################################################
-- 0014_notes.sql
-- ############################################################################

create table if not exists public.notes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  status            text not null default 'recording'
                    check (status in ('recording', 'organising', 'ready', 'failed')),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_seconds  numeric not null default 0,
  words             integer not null default 0,
  title             text not null default '',
  summary           text not null default '',
  -- { highlights: [{speaker, text}], people: [{label, name?}] }
  body              jsonb not null default '{}'::jsonb,
  -- [{ at: seconds from start, text }], in order
  transcript        jsonb not null default '[]'::jsonb,
  organised         boolean not null default false,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists notes_user_live_idx
  on public.notes (user_id, started_at desc)
  where deleted_at is null;

alter table public.notes enable row level security;

-- The server writes with the service key; these keep a user's own token to
-- their own rows if it is ever used directly.
drop policy if exists "users read own notes" on public.notes;
create policy "users read own notes"
  on public.notes for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "users insert own notes" on public.notes;
create policy "users insert own notes"
  on public.notes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own notes" on public.notes;
create policy "users update own notes"
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 0015: Razorpay subscriptions (web and desktop), kept apart from RevenueCat's rows.
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

-- ############################################################################
-- 0016_usage_agent_source.sql
-- ############################################################################

-- Ask's steps are metered with source 'agent'; 0001's check refused them.
alter table public.usage_events drop constraint if exists usage_events_source_check;
alter table public.usage_events
  add constraint usage_events_source_check check (source in ('rest', 'stream', 'agent'));


-- ############################################################################
-- 0017_connectors.sql
-- ############################################################################

-- Tailzu — connected apps (src/connectors): Ask acting in the person's own
-- apps through MCP servers.
--
-- Run in your Supabase SQL editor after 0016, before switching CONNECTORS on.
--
-- Three tables, all written by the server with the service key only. A person's
-- own token can READ their rows (policies below) and nothing else: their level,
-- their "auto" list and their tokens change nowhere but in the server's code.
--
--   connector_connections  one row per person per app: what they allowed it
--                          to do (level), which tools may run without asking
--                          (auto_ok), and the secrets, encrypted by the server
--                          with CONNECTOR_TOKEN_KEY before they get here.
--   assistant_tasks        one row per Ask run that used a connected app, and
--                          what it is waiting on. `approval` holds the call
--                          that needs a yes (its arguments, so the yes can run
--                          it) until it runs or is refused; then it is null.
--   assistant_audit        what ran: the tool, its risk, how it ended, a few
--                          words. NO message text, arguments or results.

create table if not exists public.connector_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  connector_id   text not null,
  -- look: reads only.  draft: may prepare changes, each one asked.
  -- send: may send, asked unless the tool is in auto_ok. Deletes and payments
  -- are always asked, whatever this says.
  level          text not null default 'look' check (level in ('look', 'draft', 'send')),
  -- AES-256-GCM, "v1.<base64url>": the OAuth tokens, or the pasted URL. Null until connected.
  tokens_enc     text,
  -- The PKCE verifier between starting a sign-in and finishing it; null otherwise.
  verifier_enc   text,
  -- The OAuth client the app registered for us (an id, not a secret).
  client_info    jsonb,
  auto_ok        text[] not null default '{}',
  last_used_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, connector_id)
);

create table if not exists public.assistant_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Ask's run id, so the steps of one run share a task.
  run_id      text,
  state       text not null default 'running'
              check (state in ('running', 'waiting', 'done', 'failed', 'cancelled')),
  title       text not null default '',
  -- [{ at: ms, text }], newest last, short.
  steps       jsonb not null default '[]'::jsonb,
  -- { id, connector, tool, risk, preview, args, at } while state = 'waiting'.
  approval    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists assistant_tasks_user_updated_idx
  on public.assistant_tasks (user_id, updated_at desc);
create index if not exists assistant_tasks_run_idx
  on public.assistant_tasks (user_id, run_id) where run_id is not null;

create table if not exists public.assistant_audit (
  id            bigint generated always as identity primary key,
  task_id       uuid not null references public.assistant_tasks (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  connector_id  text not null,
  tool          text not null,
  risk          text not null check (risk in ('read', 'write', 'send', 'destructive', 'pay')),
  outcome       text not null check (outcome in ('ok', 'failed', 'denied')),
  summary       text not null default '',
  at            timestamptz not null default now()
);

create index if not exists assistant_audit_task_idx on public.assistant_audit (task_id, at);
create index if not exists assistant_audit_user_idx on public.assistant_audit (user_id, at desc);

alter table public.connector_connections enable row level security;
alter table public.assistant_tasks       enable row level security;
alter table public.assistant_audit       enable row level security;

drop policy if exists "users read own connections" on public.connector_connections;
create policy "users read own connections"
  on public.connector_connections for select
  using (auth.uid() = user_id);

drop policy if exists "users read own tasks" on public.assistant_tasks;
create policy "users read own tasks"
  on public.assistant_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "users read own audit" on public.assistant_audit;
create policy "users read own audit"
  on public.assistant_audit for select
  using (auth.uid() = user_id);


-- ############################################################################
-- 0018_custom_connectors.sql
-- ############################################################################

-- Tailzu — apps a person adds themselves, by link (src/connectors, CUSTOM_CONNECTORS).
--
-- Run in your Supabase SQL editor after 0017, before switching CUSTOM_CONNECTORS on.
--
-- connector_custom  one row per app a person added: its name, its MCP server
--                   (https), whether that server asked for a sign-in, and the
--                   person's own OAuth client if they gave one (the secret
--                   encrypted by the server with CONNECTOR_TOKEN_KEY, like a
--                   token). Its id, "c_" and a UUID, is the connector id the
--                   app goes by in connector_connections, assistant_tasks and
--                   assistant_audit, so those tables need nothing new to hold it.
--
-- mcp_directory     More apps: the remote MCP servers in the official MCP
--                   Registry that an app added by link could connect to,
--                   synced by the server every 12 hours (src/connectors/registry.ts).
--                   Public data, nobody's own; read and written by the server only.
-- mcp_directory_sync  one row: when the last sync that finished had started,
--                   so the next one asks only for what changed since.
--
-- And three columns on connector_connections, used by those apps only:
--   tool_policy    {"tool name": "allow" | "ask" | "off"}: the person's choice
--                  per tool. A tool not named here starts where the server's
--                  code puts it (ask, unless plainly read-only).
--   tools_pin      {"list": sha256, "tools": {"tool name": sha256}}: the tools
--                  as the person approved them. Null until first listed.
--   tools_changed  tools new or changed since that pin: kept from the
--                  assistant until the person looks and accepts.
--
-- Written by the server with the service key only. A person's own token can
-- READ their rows (the policy below) and nothing else.

create table if not exists public.connector_custom (
  id                 text primary key
                     default ('c_' || gen_random_uuid()::text)
                     check (id ~ '^c_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 40),
  url                text not null check (url ~ '^https://' and char_length(url) <= 2048),
  -- oauth: the server answered 401, so it is signed in to.  none: it answered without asking.
  auth               text not null default 'oauth' check (auth in ('oauth', 'none')),
  -- The person's own OAuth client, when they gave one. An id is not a secret.
  client_id          text check (client_id is null or char_length(client_id) <= 512),
  -- AES-256-GCM, "v1.<base64url>". Null when there is no secret.
  client_secret_enc  text,
  -- The auth server that client is tied to, from its first sign-in on; never shown to another.
  client_issuer      text,
  -- The MCP Registry entry it was added from, if any ("io.github.someone/server").
  registry_name      text,
  -- Where its last sign-in sent the person ("auth.example.com"): said before the
  -- browser opens, and a sign-in that would go anywhere else is stopped first.
  sign_in_host       text check (sign_in_host is null or char_length(sign_in_host) <= 255),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists connector_custom_user_idx on public.connector_custom (user_id, created_at);

alter table public.connector_connections
  add column if not exists tool_policy   jsonb  not null default '{}'::jsonb,
  add column if not exists tools_pin     jsonb,
  add column if not exists tools_changed text[] not null default '{}';

alter table public.connector_custom enable row level security;

drop policy if exists "users read own custom connectors" on public.connector_custom;
create policy "users read own custom connectors"
  on public.connector_custom for select
  using (auth.uid() = user_id);

create table if not exists public.mcp_directory (
  -- The registry's name ("com.example/mcp"): what an app added from it records.
  name             text primary key check (char_length(name) between 1 and 200),
  title            text not null,
  description      text not null default '',
  -- Its Streamable HTTP address. Checked again, DNS and all, when someone adds it.
  url              text not null check (url ~ '^https://' and char_length(url) <= 2048),
  host             text not null,
  website          text,
  -- As the registry gave it. Never fetched by the server.
  icon             text,
  -- The reverse-DNS name is the remote's own domain: shown first, trusted no more.
  verified_domain  boolean not null default false,
  -- When the registry last changed it.
  updated_at       timestamptz not null
);

-- Search reads title, name and description with ilike: a scan of some 30,000
-- short rows, fine at this size. The order of a page:
create index if not exists mcp_directory_rank_idx on public.mcp_directory (verified_domain desc, title, name);

create table if not exists public.mcp_directory_sync (
  id           smallint primary key default 1 check (id = 1),
  synced_from  timestamptz not null
);

-- No policies: only the server's service key reads or writes these.
alter table public.mcp_directory enable row level security;
alter table public.mcp_directory_sync enable row level security;


-- ############################################################################
-- 0019_agent_runs.sql
-- ############################################################################

-- Tailzu — the run ledger (src/runs): one row for every Ask run, on the phone
-- (POST /v1/assistant/ask) and the desktop (POST /v1/agent), and one for every
-- planner call in it, so that every run can be counted, costed and answered for.
--
-- Run in your Supabase SQL editor after 0018, BEFORE deploying a server with
-- AGENT_RUN_LEDGER=true. The ledger is off by default, and off it keeps it all
-- in the process's memory instead, as phone follow-ups were kept before: turn
-- it on only once the privacy policy that says what is kept here is live
-- (DEPLOY.md). With the tables missing the server logs each failed write and
-- carries on; a question back then goes unanswered (its answer is read as a
-- new request) until they are there.
--
--   agent_runs   one row per run: where it ran, how it ended and why, how many
--                steps, how long, how many changes it made. What the person
--                said is kept only from the phone, and only as long as it is
--                needed (a desktop run keeps none of it):
--                  title  their first words, cut to 80 characters, as
--                         assistant_tasks.title is; emptied after 30 days
--                  said   the words to try again with, only for a phone run that
--                         failed having changed nothing; emptied after a day
--                  turns  the phone's question back and the words before it,
--                         while it waits for an answer; emptied when answered
--                         or after 5 minutes. A question asked after an app's
--                         answer was read is kept without its words, which
--                         may carry what the app said: the server holds those
--                         in memory
--   agent_calls  one row per planner call: model, provider, time, tokens and
--                what OpenRouter charged. Never the prompt or the answer.
--
-- Written by the server with the service key only. No policies: nothing on a
-- device reads these tables; the app sees runs through the server's screens.

create table if not exists public.agent_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  run_id       text not null check (run_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  surface      text not null check (surface in ('phone', 'desktop')),
  platform     text not null check (platform in ('ios', 'android', 'mac', 'win')),
  -- running → done | partial | failed | needs_you | cancelled. A desktop run is
  -- 'running' between steps; a phone run is one request and never stays there.
  outcome      text not null default 'running'
               check (outcome in ('running', 'done', 'partial', 'failed', 'needs_you', 'cancelled')),
  -- Why, in a word, when it is not plainly done (src/runs/types.ts RunReason).
  reason       text,
  steps        integer not null default 0,
  -- Things done in the world: apps changed, hand-offs opened, presses and
  -- typing on the desktop. Reads and cards waiting for a yes are not changes.
  effects      integer not null default 0,
  ms           integer not null default 0,
  first_ms     integer,
  path         text,
  mode         text check (mode in ('show', 'do')),
  language     text,
  -- The task waiting for their yes, when the run ended on a card.
  task_id      uuid references public.assistant_tasks (id) on delete set null,
  -- A phone answer to a question back is a run of its own: these link the two.
  follows      text,
  followed_by  text,
  title        text not null default '',
  said         text,
  turns        jsonb,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  ended_at     timestamptz,
  unique (user_id, run_id)
);

create index if not exists agent_runs_user_updated_idx
  on public.agent_runs (user_id, updated_at desc);
-- The sweep: runs still open.
create index if not exists agent_runs_open_idx
  on public.agent_runs (updated_at) where outcome in ('running', 'needs_you');
-- The phone's question waiting for its answer.
create index if not exists agent_runs_waiting_idx
  on public.agent_runs (user_id, updated_at desc) where turns is not null;
-- The sweep: words kept to try again with, and titles, each emptied when its
-- time is up. Rows are never deleted, only emptied: without these, each pass
-- would read the whole table to find the few still holding words.
create index if not exists agent_runs_said_idx
  on public.agent_runs (updated_at) where said is not null;
create index if not exists agent_runs_titled_idx
  on public.agent_runs (started_at) where title <> '';

create table if not exists public.agent_calls (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  run_id             text not null,
  step               integer not null default 0,
  surface            text not null check (surface in ('phone', 'desktop')),
  at                 timestamptz not null default now(),
  model              text not null,
  provider           text,
  served             text,
  outcome            text not null check (outcome in ('ok', 'stopped', 'failed', 'timeout', 'empty')),
  ms                 integer not null default 0,
  first_ms           integer,
  prompt_tokens      integer,
  cached_tokens      integer,
  completion_tokens  integer,
  reasoning_tokens   integer,
  -- OpenRouter's usage.cost for the call, in US dollars.
  cost_usd           numeric(12, 8),
  status             integer,
  picture            boolean not null default false,
  deep               boolean not null default false
);

create index if not exists agent_calls_run_idx on public.agent_calls (user_id, run_id);
create index if not exists agent_calls_at_idx on public.agent_calls (at desc);

-- For the stuck-task sweeper (src/connectors/sweeper.ts): the few rows still running.
create index if not exists assistant_tasks_running_idx
  on public.assistant_tasks (updated_at) where state = 'running';

alter table public.agent_runs  enable row level security;
alter table public.agent_calls enable row level security;

-- One row per run with its totals and how it really ended: a run that stopped
-- on a card is done, failed or cancelled once the card is answered, and that
-- answer lives on the task (assistant_tasks.state), not here. For reports
-- only; security_invoker so it reads with the caller's rights, and no client
-- role may select it.
create or replace view public.agent_run_report with (security_invoker = true) as
select
  r.*,
  coalesce(c.calls, 0)        as calls,
  c.prompt_tokens, c.cached_tokens, c.completion_tokens, c.cost_usd,
  case
    when r.outcome = 'needs_you' and t.state = 'done'      then 'done'
    when r.outcome = 'needs_you' and t.state = 'failed'    then 'failed'
    when r.outcome = 'needs_you' and t.state = 'cancelled' then 'cancelled'
    else r.outcome
  end as final_outcome
from public.agent_runs r
left join public.assistant_tasks t on t.id = r.task_id
left join lateral (
  select count(*) as calls, sum(prompt_tokens) as prompt_tokens, sum(cached_tokens) as cached_tokens,
         sum(completion_tokens) as completion_tokens, sum(cost_usd) as cost_usd
  from public.agent_calls c where c.user_id = r.user_id and c.run_id = r.run_id
) c on true;

revoke all on public.agent_run_report from anon, authenticated;


-- ############################################################################
-- 0020_code_github.sql
-- ############################################################################

-- Tailzu — the Code bot's GitHub side (src/code, CODE_GITHUB).
--
-- Run in your Supabase SQL editor after 0019, before switching CODE_GITHUB on.
--
-- code_installations  one row per (person, GitHub App install) the person has
--                     connected: which account it is on, whether it sees all
--                     of that account's repos or only some, and when GitHub
--                     suspended it (null when it is not). The link is made
--                     only after GitHub itself has said the person can reach
--                     the install (src/code/link.ts), so a row is never a
--                     claim on someone else's. It also keeps who the person
--                     is on GitHub (id and login, read when they linked):
--                     GitHub lists an install for anyone who can reach any
--                     repo in it, an organisation member or a collaborator on
--                     someone's personal repo, so a link is not access to every
--                     repo in the install. The server asks GitHub what that
--                     login may do in each repo (src/code/projects.ts) and
--                     works only where it is write or admin; on an install of
--                     the person's own account, in all of it. A row from
--                     before these two columns has them null and has to be
--                     linked again.
-- code_projects       one row per repo a person picked to work on. Unique per
--                     person and repo, so picking it twice is the same project.
-- code_branches       the work branches Tailzu made in a project
--                     (tailzu/<slug>-<4 hex>): the first 200 characters of the
--                     task they were made for, the commit they started from,
--                     the draft PR once there is one, where the branch is in
--                     its life (state: active, pr_open, conflict, merged,
--                     closed, deleted; a deleted branch keeps its row), and
--                     when GitHub last told us about a review. They go with
--                     their project.
--
-- Nothing here is a GitHub token. The person's own token is used once, in the
-- install callback, and dropped; an installation token is minted when it is
-- needed and kept in the server's memory for under an hour.
--
-- Written by the server with the service key only. A person's own token can
-- READ their rows (the policies below) and nothing else. GitHub's webhook
-- (installation deleted or suspended, repos removed) acts across people: an
-- install is one thing for everyone who linked it.

create table if not exists public.code_installations (
  user_id              uuid not null references auth.users (id) on delete cascade,
  -- GitHub's id for the install.
  installation_id      bigint not null,
  -- The account it is on: the person's own login, or the organisation's.
  account_login        text not null check (char_length(account_login) between 1 and 100),
  -- As GitHub says it ("User", "Organization").
  account_type         text not null default 'User' check (char_length(account_type) between 1 and 40),
  repository_selection text not null default 'selected' check (repository_selection in ('all', 'selected')),
  suspended_at         timestamptz,
  github_user_id       bigint,
  github_login         text check (github_login is null or char_length(github_login) between 1 and 100),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, installation_id)
);

-- For a table made before the two columns above (this script is re-runnable).
alter table public.code_installations
  add column if not exists github_user_id bigint,
  add column if not exists github_login   text;

-- GitHub's webhook names an install, not a person.
create index if not exists code_installations_install_idx on public.code_installations (installation_id);

create table if not exists public.code_projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null,
  repo_id         bigint not null,
  -- "owner/name".
  full_name       text not null check (char_length(full_name) between 3 and 200),
  default_branch  text not null check (char_length(default_branch) between 1 and 255),
  private         boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (user_id, repo_id)
);

-- A webhook that removes repos from an install, or the install itself.
create index if not exists code_projects_install_idx on public.code_projects (installation_id, repo_id);

create table if not exists public.code_branches (
  project_id uuid not null references public.code_projects (id) on delete cascade,
  branch     text not null check (branch ~ '^tailzu/[a-z0-9][a-z0-9-]{0,48}$'),
  -- What the person asked for, cut to 200 characters.
  task       text not null default '' check (char_length(task) <= 200),
  -- The default branch's head when this branch was made.
  base_sha   text not null,
  pr_number  integer,
  pr_url     text,
  state      text not null default 'active'
             check (state in ('active', 'pr_open', 'conflict', 'merged', 'closed', 'deleted')),
  last_review_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (project_id, branch)
);

-- For a table made before the two columns above (this script is re-runnable).
alter table public.code_branches
  add column if not exists state text not null default 'active'
    check (state in ('active', 'pr_open', 'conflict', 'merged', 'closed', 'deleted')),
  add column if not exists last_review_at timestamptz;

alter table public.code_installations enable row level security;
alter table public.code_projects      enable row level security;
alter table public.code_branches      enable row level security;

drop policy if exists "users read own code installations" on public.code_installations;
create policy "users read own code installations"
  on public.code_installations for select
  using (auth.uid() = user_id);

drop policy if exists "users read own code projects" on public.code_projects;
create policy "users read own code projects"
  on public.code_projects for select
  using (auth.uid() = user_id);

drop policy if exists "users read own code branches" on public.code_branches;
create policy "users read own code branches"
  on public.code_branches for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_branches.project_id and p.user_id = auth.uid()
  ));


-- ############################################################################
-- 0021_code_oauth.sql
-- ############################################################################

-- Tailzu — the Code bot's other way in: "Sign in with GitHub" (src/code/oauth.ts, CODE_GITHUB_OAUTH).
--
-- Run in your Supabase SQL editor after 0020, before switching CODE_GITHUB_OAUTH on.
--
-- code_oauth_links  one row per person who signed in with GitHub: who they are
--                   there (id and login), the scopes the token has, and THE
--                   TOKEN ITSELF, encrypted by the server with CONNECTOR_TOKEN_KEY
--                   (AES-256-GCM, like every other stored token). It is the only
--                   place a GitHub token is kept at all, and the most powerful
--                   thing in this schema: a classic OAuth token reaches all of
--                   a person's repos. So:
--                     - NO POLICY. Not even "a person reads their own row":
--                       a person's own token could then select token_enc.
--                       Only the server's service key reads or writes this table;
--                     - the server revokes the token at GitHub when the person
--                       disconnects, when their account is deleted, and when it
--                       has gone 30 days unused, and then drops it (token_enc is
--                       set to null; status 'needs_signin' says they must sign in
--                       again);
--                     - last_used_at is the last use, to the hour.
-- code_projects.link_kind
--                   which link a project goes through: 'app' (a GitHub App
--                   install, installation_id) or 'oauth' (the person's sign-in;
--                   installation_id is 0, there is no install).
--
-- Written by the server with the service key only.

create table if not exists public.code_oauth_links (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  github_user_id bigint not null,
  github_login   text not null check (char_length(github_login) between 1 and 100),
  -- AES-256-GCM, "v1.<base64url>". Null once revoked or found dead.
  token_enc      text,
  -- As GitHub said them: "repo, read:user".
  scope          text not null default '',
  status         text not null default 'active' check (status in ('active', 'needs_signin')),
  last_used_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The expiry sweep and the kill switch read the links that still hold a token.
create index if not exists code_oauth_links_token_idx on public.code_oauth_links (user_id) where token_enc is not null;

alter table public.code_oauth_links enable row level security;
-- (no policies: see above)

alter table public.code_projects
  add column if not exists link_kind text not null default 'app' check (link_kind in ('app', 'oauth'));


-- ############################################################################
-- 0022_code_policy.sql
-- ############################################################################

-- Tailzu — the Code bot's permissions: standing grants (src/code/policy.ts).
--
-- Run in your Supabase SQL editor after 0021, before using the permission routes
-- (GET/POST/DELETE /v1/code/projects/:id/permissions).
--
-- The bot is not fenced in. It works like Claude Code with git: some things it
-- just does (read, make a branch, commit to a branch it made, open a draft pull
-- request), some it asks the person about first (commit to any other branch,
-- merge, mark ready, close, delete a branch, change a workflow file, start an
-- empty repo), a few it asks about with Face ID every single time (force-push,
-- deleting the default branch, committing something that looks like a secret),
-- and a few it never does. A person can answer "ask" once for good:
--
-- code_grants  one row per standing permission for one project: "always let
--              the bot do <action> on branches matching <pattern>" (effect
--              'allow'), or "never let it" ('deny', which beats every allow).
--              branch_pattern is a glob over branch names ("main",
--              "release/*"); the empty string means every branch. expires_at
--              is optional. The same (project, action, pattern, effect) twice
--              is one row. The server refuses to store a grant for an action
--              that always asks or never happens, and the policy ignores one
--              that got here some other way.
--
-- Written by the server with the service key only. A person's own token can READ
-- the grants of their own projects (the policy below) and nothing else. They go
-- with their project.

create table if not exists public.code_grants (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.code_projects (id) on delete cascade,
  -- One of the policy's action ids ("commit.other_branch", "pr.merge", ...).
  action         text not null check (char_length(action) between 1 and 60),
  -- A glob; '' is "every branch".
  branch_pattern text not null default '' check (char_length(branch_pattern) <= 200),
  effect         text not null check (effect in ('allow', 'deny')),
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (project_id, action, branch_pattern, effect)
);

alter table public.code_grants enable row level security;

drop policy if exists "users read own code grants" on public.code_grants;
create policy "users read own code grants"
  on public.code_grants for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_grants.project_id and p.user_id = auth.uid()
  ));


-- ############################################################################
-- 0023_code_jobs.sql
-- ############################################################################

-- Tailzu — the Code bot's jobs and the environment router (src/code/jobs, docs/code-router.md).
--
-- Run in your Supabase SQL editor after 0022, before using the job routes
-- (POST /v1/code/jobs, the runner routes, GET/PUT /v1/code/settings/compute).
--
-- A JOB is one coding task on one work branch. It runs as STEPS: an "edit" is
-- done through GitHub's API and needs no computer; an "exec" runs commands
-- (install, build, test) and is placed by the router on the cheapest place
-- there is: the person's own PC, then GitHub's free computers, then paid compute
-- under the person's own rule, and otherwise it waits.
--
-- code_jobs              one row per job: whose, which project and branch, the
--                        task (the first 500 characters), where it is in its
--                        life (state) and which kind of computer holds its
--                        step now (placement). A step that is out has a LEASE:
--                        who holds it, an epoch that goes up on every dispatch
--                        (a result carrying an older one is refused, so a
--                        machine that went quiet and was replaced can never
--                        count) and when it runs out (90 seconds, renewed by
--                        heartbeats and progress). The CHECKPOINT is
--                        {stepIndex, headSha, notes} after every finished
--                        step, so a job moved to another place starts from
--                        there. budget_paise is what the person has said this
--                        job may spend on paid compute; spent_paise what it
--                        has. reassignments counts the leases lost (at 5 the
--                        job is failed); reason says in plain words why it
--                        waits or why it stopped; waiting_on says what a
--                        waiting_for_you job is waiting for ('paid': a yes to
--                        paid compute, 'commit': a yes to committing what a
--                        step made). 'paused' is reserved for the person
--                        pausing a job by hand; the server never sets it.
-- code_job_steps         one row per step, numbered from 0: what ran (the
--                        commands of an exec step, the paths of an edit),
--                        where, under which lease epoch, how it ended, the last
--                        8 KB it printed (nothing that looked like a secret is
--                        kept: the server scans it first) and the whole minutes
--                        it ran. They go with their job.
-- code_compute_settings  one row per person: their rule for paid compute
--                        ('never', the default; 'ask'; 'auto' up to
--                        auto_cap_paise a calendar month) and whether GitHub's
--                        free computers may be used.
-- code_compute_usage     one row per person and month ('YYYY-MM', UTC): the
--                        GitHub minutes Tailzu used and the paise it spent.
--                        Added up by code_add_usage so two results arriving at
--                        once can't lose one.
--
-- Which PCs are online is NOT kept here: the desktop app's heartbeat holds it in
-- the server's memory for 60 seconds, and nothing about a device is written.
--
-- Written by the server with the service key only. A person's own token can
-- READ their own rows (the policies below) and nothing else. Jobs and their
-- steps go with their project, usage and settings with the account.

create table if not exists public.code_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  project_id       uuid not null references public.code_projects (id) on delete cascade,
  branch           text not null check (char_length(branch) between 1 and 255),
  -- What was asked, cut to 500 characters.
  task             text not null default '' check (char_length(task) <= 500),
  state            text not null default 'queued'
                   check (state in ('queued', 'running', 'waiting_for_compute', 'waiting_for_you', 'paused', 'done', 'failed', 'cancelled')),
  placement        text not null default 'none' check (placement in ('none', 'desktop', 'github', 'paid')),
  -- A device id for a PC, a run id for the others; null when nobody holds the lease.
  lease_holder     text check (lease_holder is null or char_length(lease_holder) <= 200),
  lease_epoch      integer not null default 0 check (lease_epoch >= 0),
  lease_expires_at timestamptz,
  -- {"stepIndex": -1, "headSha": "", "notes": ""} until a step finishes.
  checkpoint       jsonb not null default '{"stepIndex": -1, "headSha": "", "notes": ""}'::jsonb,
  budget_paise     integer not null default 0 check (budget_paise >= 0),
  spent_paise      integer not null default 0 check (spent_paise >= 0),
  reassignments    integer not null default 0 check (reassignments >= 0),
  reason           text not null default '' check (char_length(reason) <= 500),
  waiting_on       text check (waiting_on is null or waiting_on in ('paid', 'commit')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- A person's jobs, newest first.
create index if not exists code_jobs_user_idx on public.code_jobs (user_id, created_at desc);
-- The ticker: running steps whose lease has run out.
create index if not exists code_jobs_lease_idx on public.code_jobs (lease_expires_at)
  where state = 'running' and placement <> 'none';
-- The ticker and a heartbeat: jobs waiting for a place or for a yes.
create index if not exists code_jobs_waiting_idx on public.code_jobs (updated_at)
  where state in ('waiting_for_compute', 'waiting_for_you');

create table if not exists public.code_job_steps (
  job_id           uuid not null references public.code_jobs (id) on delete cascade,
  idx              integer not null check (idx >= 0),
  kind             text not null check (kind in ('edit', 'exec')),
  -- A JSON list of text: the commands of an exec step, the paths an edit changed.
  commands         jsonb not null default '[]'::jsonb,
  timeout_sec      integer not null default 0 check (timeout_sec >= 0),
  estimate_minutes integer not null default 0 check (estimate_minutes >= 0),
  status           text not null default 'pending'
                   check (status in ('pending', 'dispatched', 'running', 'blocked', 'done', 'failed', 'cancelled')),
  placement        text not null default 'none' check (placement in ('none', 'desktop', 'github', 'paid')),
  -- The lease epoch it was dispatched under; 0 before that.
  epoch            integer not null default 0 check (epoch >= 0),
  started_at       timestamptz,
  finished_at      timestamptz,
  exit_code        integer,
  -- The end of what it printed: 8 KB at most.
  output_tail      text not null default '' check (octet_length(output_tail) <= 8192),
  -- Whole minutes it ran, rounded up.
  minutes          integer not null default 0 check (minutes >= 0),
  primary key (job_id, idx)
);

create table if not exists public.code_compute_settings (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  paid_rule       text not null default 'never' check (paid_rule in ('never', 'ask', 'auto')),
  -- For 'auto': the most paid compute used without asking in a calendar month, in paise.
  auto_cap_paise  integer not null default 0 check (auto_cap_paise >= 0),
  github_enabled  boolean not null default true,
  updated_at      timestamptz not null default now()
);

create table if not exists public.code_compute_usage (
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- "YYYY-MM", UTC.
  month          text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  github_minutes integer not null default 0 check (github_minutes >= 0),
  paid_paise     integer not null default 0 check (paid_paise >= 0),
  primary key (user_id, month)
);

-- Adds to a month's use in one statement, so two results arriving together both count.
create or replace function public.code_add_usage(p_user uuid, p_month text, p_minutes integer, p_paise integer)
returns public.code_compute_usage
language sql
as $$
  insert into public.code_compute_usage as u (user_id, month, github_minutes, paid_paise)
  values (p_user, p_month, greatest(p_minutes, 0), greatest(p_paise, 0))
  on conflict (user_id, month) do update
    set github_minutes = u.github_minutes + excluded.github_minutes,
        paid_paise     = u.paid_paise     + excluded.paid_paise
  returning *;
$$;

-- Only the server (the service key) may add to anyone's use: a person's own token must not be
-- able to call this for themselves or for someone else.
revoke all on function public.code_add_usage(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.code_add_usage(uuid, text, integer, integer) to service_role;

alter table public.code_jobs             enable row level security;
alter table public.code_job_steps        enable row level security;
alter table public.code_compute_settings enable row level security;
alter table public.code_compute_usage    enable row level security;

drop policy if exists "users read own code jobs" on public.code_jobs;
create policy "users read own code jobs"
  on public.code_jobs for select
  using (auth.uid() = user_id);

drop policy if exists "users read own code job steps" on public.code_job_steps;
create policy "users read own code job steps"
  on public.code_job_steps for select
  using (exists (
    select 1 from public.code_jobs j
    where j.id = code_job_steps.job_id and j.user_id = auth.uid()
  ));

drop policy if exists "users read own code compute settings" on public.code_compute_settings;
create policy "users read own code compute settings"
  on public.code_compute_settings for select
  using (auth.uid() = user_id);

drop policy if exists "users read own code compute usage" on public.code_compute_usage;
create policy "users read own code compute usage"
  on public.code_compute_usage for select
  using (auth.uid() = user_id);


-- ############################################################################
-- 0024_code_github_actions.sql
-- ############################################################################

-- Tailzu — GitHub's free computers for the Code bot's jobs (src/code/jobs/githubActions.ts).
--
-- Run in your Supabase SQL editor after 0023, before turning on GitHub's free
-- computers (the App needs Workflows: write and Actions: read: docs/github-app.md,
-- section 9). Without it the router cannot read or write the one flag below, so
-- it keeps choosing GitHub for a person whose free minutes are used up (a step
-- that never ran is still moved after three minutes, but the next one tries
-- GitHub again).
--
-- A step that runs on GitHub's free computers is a push of a throwaway
-- `tailzu-run/` branch in the person's own repo. When that push never starts a
-- run (three minutes), or a run ends without reporting back, the free minutes
-- are most likely used up (or Actions is off), and the router must stop sending
-- that person's steps to GitHub for the rest of the month:
--
-- code_compute_usage.github_exhausted  true for a person and month (UTC) once
--                        that has happened. Read and written on its own by the
--                        server (it is not part of the usage figures). The month
--                        turning over gives GitHub back: the flag belongs to a
--                        month, so there is nothing to reset.
--
-- Written by the server with the service key only; a person's own token can
-- read their own rows, as before (the policy from 0023 covers the new column).

alter table public.code_compute_usage
  add column if not exists github_exhausted boolean not null default false;


-- ############################################################################
-- 0025_code_route_stats.sql
-- ############################################################################

-- Tailzu — what the Code bot's router learns about its models (src/code/brain/stats.ts, docs/code-brain.md).
--
-- Run in your Supabase SQL editor after 0024. Optional: without it the router
-- keeps its default order and logs that an outcome was not recorded; nothing else
-- depends on it.
--
-- After each step the brain says how it went, and one row per (task type, step,
-- model) keeps the running totals. Once a model has been tried at least 20 times
-- at a kind of step and worked at least 85 times in 100, the router puts the
-- CHEAPEST such model first on that step's ladder.
--
-- code_route_stats  task_type    what the classifier called the request
--                                (question, bug_fix, feature, ...)
--                   step         what the brain was doing (plan, write_code, review, ...)
--                   model        the OpenRouter slug that did it
--                   successes    steps that worked, failures those that did not
--                   paise_total  what those steps cost, added up, in paise
--                   ms_total     how long they took, added up, in milliseconds
--                   updated_at   the last time a step was added
--
-- Nothing about who asked or what was asked is kept here: only these counts, the
-- same for everyone. Written by the server with the service key only. Row-level
-- security is on and there are NO policies, so no person's own token can read
-- or write any of it.

create table if not exists public.code_route_stats (
  task_type   text not null check (char_length(task_type) between 1 and 40),
  step        text not null check (char_length(step) between 1 and 40),
  model       text not null check (char_length(model) between 1 and 200),
  successes   integer not null default 0 check (successes >= 0),
  failures    integer not null default 0 check (failures >= 0),
  paise_total bigint not null default 0 check (paise_total >= 0),
  ms_total    bigint not null default 0 check (ms_total >= 0),
  updated_at  timestamptz not null default now(),
  primary key (task_type, step, model)
);

alter table public.code_route_stats enable row level security;

-- Adds one outcome to its row in one statement, so two steps ending together both count.
create or replace function public.code_record_route_outcome(
  p_task_type text, p_step text, p_model text, p_success boolean, p_paise integer, p_ms integer
)
returns void
language sql
as $$
  insert into public.code_route_stats as s (task_type, step, model, successes, failures, paise_total, ms_total, updated_at)
  values (
    p_task_type, p_step, p_model,
    case when p_success then 1 else 0 end,
    case when p_success then 0 else 1 end,
    greatest(p_paise, 0), greatest(p_ms, 0), now()
  )
  on conflict (task_type, step, model) do update
    set successes   = s.successes   + excluded.successes,
        failures    = s.failures    + excluded.failures,
        paise_total = s.paise_total + excluded.paise_total,
        ms_total    = s.ms_total    + excluded.ms_total,
        updated_at  = now();
$$;

-- Only the server (the service key) may add to the record: a person's own token must not be able to call this.
revoke all on function public.code_record_route_outcome(text, text, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.code_record_route_outcome(text, text, text, boolean, integer, integer) to service_role;


-- ############################################################################
-- 0026_web_cache.sql
-- ############################################################################

-- Tailzu — the page reader's cache (src/web/cache.ts, docs/web-reader.md).
--
-- Run in your Supabase SQL editor after 0025. Optional: without it the reader
-- keeps read pages in memory (500 of them, gone when the server restarts) and
-- nothing else depends on it.
--
-- When Tailzu reads a web page for the Code bot's search tools, or for a person,
-- what comes out of it (the page as markdown, its headings and its links; never
-- the raw HTML) is kept here so the next read of the same address costs nothing.
-- One row per address:
--
-- web_pages  url_hash    sha256 of the address, normalised (lower-case host, no
--                        #fragment, sorted query), as hex. The key
--            url         that normalised address
--            final_url   where the page really was, after redirects
--            title       the page's title ('' when it has none)
--            lang        the language it says it is in ('' when it does not)
--            body        jsonb: text, headings, links, codeBlocks, contentType,
--                        bytes, truncated
--            via         how it was read: 'fetch' or 'browser'
--            fetched_at  when it was read
--            expires_at  when it stops being served: WEB_CACHE_TTL_MIN after it
--                        was read (6 hours unless set), a day or more for
--                        documentation hosts. The server deletes expired rows
--                        as it writes new ones
--
-- Nothing in a row belongs to a person: the reader sends no cookie and no login,
-- so everyone gets the same page, and an address whose query holds a token, key
-- or signature is never kept at all. Written by the server with the service key
-- only. Row-level security is on and there are NO policies, so no person's own
-- token can read or write any of it.

create table if not exists public.web_pages (
  url_hash   text primary key check (char_length(url_hash) = 64),
  url        text not null check (char_length(url) between 1 and 2048),
  final_url  text not null check (char_length(final_url) between 1 and 2048),
  title      text not null default '',
  lang       text not null default '',
  body       jsonb not null,
  via        text not null check (via in ('fetch', 'browser')),
  fetched_at timestamptz not null,
  expires_at timestamptz not null
);

-- The sweep of expired rows, and the read that skips them.
create index if not exists web_pages_expires_at_idx on public.web_pages (expires_at);

alter table public.web_pages enable row level security;


-- ############################################################################
-- 0027_web_search.sql
-- ############################################################################

-- Tailzu — web search: the cache of finished searches and our own coding index
-- (src/web/search/index.ts, docs/web-search.md).
--
-- Run in your Supabase SQL editor after 0026. Optional: without it search keeps
-- its cache and its index in memory (300 searches, 2,000 pages, gone when the
-- server restarts) and nothing else depends on it.
--
-- Two tables. Neither holds anything about a person: a search is cached by what
-- was asked, not by who asked, and the index holds documentation pages that are
-- public by design.
--
-- web_search_cache  key_hash    sha256 of the normalised plan: its intent, queries
--                               (lower case, sorted), sources, site and freshness,
--                               as hex. The key
--                   plan        jsonb: the plan that was searched
--                   results     jsonb: the ranked results, each with its score and
--                               the reasons for it
--                   expires_at  when it stops being served: 6 hours after the
--                               search, 24 for a package lookup. The server deletes
--                               expired rows as it writes new ones
--
-- web_index         id          one row per chunk of a page
--                   url_hash    sha256 of the page's normalised address (the same
--                               hash the page cache, 0026, uses)
--                   url         that address
--                   title       the page's title
--                   heading     the heading the chunk is under ('' before the first)
--                   chunk_no    0, 1, 2 ... in page order
--                   body        the chunk's text, about 1,500 characters of markdown
--                   lang        the page's language ('' when it does not say)
--                   source      what put it here: 'read' (a page the bot read) or
--                               'seed:<site>' (scripts/seed-web-index.ts)
--                   fetched_at  when the page was read. Rows older than 120 days
--                               are deleted by the server
--                   tsv         generated: the full text search document
--                               (title, heading and body, the 'simple' configuration:
--                               no stemming, no stop words, so code identifiers stay
--                               as written), with a GIN index. Never written to
--
-- A page's chunks are replaced together: the server writes the new ones over the
-- old by (url_hash, chunk_no) and then deletes any beyond them. Only pages from
-- documentation and public reference sites are ever indexed (the host list is in
-- src/web/search/catalog.ts), never an address whose query looks like a secret.
--
-- Written by the server with the service key only. Row-level security is on and
-- there are NO policies, so no person's own token can read or write any of it.

create table if not exists public.web_search_cache (
  key_hash   text primary key check (char_length(key_hash) = 64),
  plan       jsonb not null,
  results    jsonb not null,
  expires_at timestamptz not null
);

-- The sweep of expired rows, and the read that skips them.
create index if not exists web_search_cache_expires_at_idx on public.web_search_cache (expires_at);

alter table public.web_search_cache enable row level security;

create table if not exists public.web_index (
  id         bigint generated always as identity primary key,
  url_hash   text not null check (char_length(url_hash) = 64),
  url        text not null check (char_length(url) between 1 and 2048),
  title      text not null default '',
  heading    text not null default '',
  chunk_no   integer not null check (chunk_no >= 0),
  body       text not null check (char_length(body) between 1 and 4000),
  lang       text not null default '',
  source     text not null default 'read',
  fetched_at timestamptz not null default now(),
  tsv        tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(heading, '') || ' ' || body)
  ) stored,
  unique (url_hash, chunk_no)
);

create index if not exists web_index_tsv_idx on public.web_index using gin (tsv);
-- The sweep of old pages.
create index if not exists web_index_fetched_at_idx on public.web_index (fetched_at);

alter table public.web_index enable row level security;


-- ############################################################################
-- 0028_code_project_brain.sql
-- ############################################################################

-- Tailzu — the Code bot's project brain, layer 4 (src/code/project, docs/code-project-brain.md).
--
-- Run in your Supabase SQL editor after 0027, before switching CODE_PROJECT_BRAIN
-- on. Needs 0020 (code_projects).
--
-- When a person adds a repo as a project, Tailzu reads it once and keeps what it
-- learned, so the bot can go straight to the file it needs and a push only costs
-- the files that changed. Four tables, all of them one project's:
--
-- code_brain          one row per project: the commit and root tree it was built
--                     from; status (building, ready, failed, or stale when the
--                     default branch has moved on); progress {pct, phase};
--                     structure (languages, frameworks, workspaces, entry points,
--                     commands, CI, env var NAMES, Docker, the README's title, the
--                     secret files that exist by path only, and what each manifest
--                     said keyed by its blob sha); conventions (formatter, linter,
--                     style, commit style, branch naming, and the repo's own agent
--                     docs, capped); features (the clusters of files, named);
--                     memory (the TAILZU.md text, which is NOT committed to the
--                     repo); welcome (the first message, 900 characters at most);
--                     summaries_state (none, partial or complete: whether the
--                     model's lines stand for every file picked, or the money ran
--                     out); baseline (the plan of checks, and what they said when
--                     last run); history (the commits looked at for hotspots, each
--                     with the files it touched, so a push costs the new commits
--                     only); spent_paise (what the models cost, in all); built_at;
--                     error (plain words, never a path or a line of code)
-- code_brain_files    one row per file that was read: its git blob sha (the Merkle
--                     leaf: an unchanged sha means an unchanged row), language,
--                     size, symbols (jsonb: name, kind, line, exported, and for a
--                     route its verb and path), the repo files it imports,
--                     centrality (rank 0 to 1), how often it changed lately (hot),
--                     TODO/FIXME/HACK markers (todo), the test files that cover it,
--                     and the model's line about it. tsv is generated: the words
--                     of its path (camelCase and snake_case split), of its symbol
--                     names and of its summary, 'simple' configuration, with a GIN
--                     index; imports has one too, to ask who imports a file
-- code_brain_dirs     one row per folder that has a line: its git tree sha, the
--                     other Merkle node, and the summary made from its children.
--                     The root ('') holds the overview of the whole repo
-- code_brain_texts    the strings a person sees, each with the file and line it is
--                     on: JSX text and attributes, HTML, translations (with their
--                     keys), Flutter, Android and iOS strings, flash messages and
--                     template names. A line the secret scanner flags is never in
--                     it. tsv is generated and indexed
--
-- No file contents are kept, in any table. What the model is sent is an excerpt of
-- a file, and OpenRouter is asked for providers that keep and train on nothing.
--
-- Written by the server with the service key only. A person's own token can READ
-- the rows of their own projects (the policies below, as in 0020) and nothing
-- else. All four go with their project (on delete cascade), so removing a project,
-- an install, or an account removes what was learned.

create table if not exists public.code_brain (
  project_id      uuid primary key references public.code_projects (id) on delete cascade,
  head_sha        text not null default '',
  tree_sha        text not null default '',
  status          text not null default 'building' check (status in ('building', 'ready', 'failed', 'stale')),
  progress        jsonb not null default '{}'::jsonb,
  structure       jsonb not null default '{}'::jsonb,
  conventions     jsonb not null default '{}'::jsonb,
  features        jsonb not null default '[]'::jsonb,
  memory          text not null default '',
  welcome         text not null default '',
  summaries_state text not null default 'none' check (summaries_state in ('none', 'partial', 'complete')),
  baseline        jsonb,
  history         jsonb not null default '{}'::jsonb,
  spent_paise     integer not null default 0 check (spent_paise >= 0),
  built_at        timestamptz,
  error           text not null default '',
  updated_at      timestamptz not null default now()
);

create table if not exists public.code_brain_files (
  project_id uuid not null references public.code_projects (id) on delete cascade,
  path       text not null check (char_length(path) between 1 and 1024),
  blob_sha   text not null,
  lang       text not null default '',
  bytes      integer not null default 0 check (bytes >= 0),
  symbols    jsonb not null default '[]'::jsonb,
  imports    text[] not null default '{}',
  rank       real not null default 0,
  hot        integer not null default 0 check (hot >= 0),
  todo       integer not null default 0 check (todo >= 0),
  tests      text[] not null default '{}',
  summary    text not null default '',
  tsv        tsvector generated always as (
    to_tsvector(
      'simple',
      regexp_replace(regexp_replace(path, '([a-z0-9])([A-Z])', '\1 \2', 'g'), '[^[:alnum:]]+', ' ', 'g')
      || ' ' ||
      regexp_replace(regexp_replace(coalesce(jsonb_path_query_array(symbols, '$[*].name')::text, ''), '([a-z0-9])([A-Z])', '\1 \2', 'g'), '[^[:alnum:]]+', ' ', 'g')
      || ' ' ||
      regexp_replace(summary, '[^[:alnum:]]+', ' ', 'g')
    )
  ) stored,
  primary key (project_id, path)
);

create index if not exists code_brain_files_tsv_idx on public.code_brain_files using gin (tsv);
-- Who imports a file: imports @> '{path}'.
create index if not exists code_brain_files_imports_idx on public.code_brain_files using gin (imports);
-- The hot files of a project.
create index if not exists code_brain_files_hot_idx on public.code_brain_files (project_id, hot desc);

create table if not exists public.code_brain_dirs (
  project_id uuid not null references public.code_projects (id) on delete cascade,
  path       text not null check (char_length(path) <= 1024),
  tree_sha   text not null,
  summary    text not null default '',
  primary key (project_id, path)
);

create table if not exists public.code_brain_texts (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.code_projects (id) on delete cascade,
  path       text not null check (char_length(path) between 1 and 1024),
  line       integer not null default 1 check (line >= 1),
  text       text not null check (char_length(text) between 1 and 1000),
  kind       text not null default 'string',
  tsv        tsvector generated always as (
    to_tsvector('simple', regexp_replace(text, '[^[:alnum:]]+', ' ', 'g'))
  ) stored
);

create index if not exists code_brain_texts_tsv_idx on public.code_brain_texts using gin (tsv);
-- Clearing and reading one file's strings.
create index if not exists code_brain_texts_path_idx on public.code_brain_texts (project_id, path);

alter table public.code_brain       enable row level security;
alter table public.code_brain_files enable row level security;
alter table public.code_brain_dirs  enable row level security;
alter table public.code_brain_texts enable row level security;

drop policy if exists "users read own code brain" on public.code_brain;
create policy "users read own code brain"
  on public.code_brain for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "users read own code brain files" on public.code_brain_files;
create policy "users read own code brain files"
  on public.code_brain_files for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain_files.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "users read own code brain dirs" on public.code_brain_dirs;
create policy "users read own code brain dirs"
  on public.code_brain_dirs for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain_dirs.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "users read own code brain texts" on public.code_brain_texts;
create policy "users read own code brain texts"
  on public.code_brain_texts for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain_texts.project_id and p.user_id = auth.uid()
  ));
