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
