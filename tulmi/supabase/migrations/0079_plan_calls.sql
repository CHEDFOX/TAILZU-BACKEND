-- Tailzu — "X0 is calling" (src/botsBots/planCall.ts, planCallWords.ts; docs/plan-ease.md "Calls").
--
-- A leave-by or a bill due today rings a phone whose app takes calls, instead of the push: an ordinary notification with Answer and
-- Not now, our own ringtone, then "Missed call from X0" if nobody answered. One row per call, so the limits (one at a time, 3 a day,
-- 15 minutes apart) hold across servers and restarts, and the sweep can send ring 2 and the missed push after a restart.
--
-- plan_calls           one call
--   source             leave | due: the reminder it rang for
--   source_key         that reminder's push key ("leave:<eventId>:<start>", "due:<taskId>:<at>"), or "back:<parentId>:<ms>" for a
--                      Call back: unique per person, so the same reminder never calls twice
--   origin             server (it rang) | user (the person's own Call back)
--   parent_id          the missed call a Call back answers
--   state              ringing | answered | declined | missed | ended; every change is a compare-and-swap on it
--   why                not_sent (the ring never left: the reminder went as a push) | timeout (answered, never ended) | hung_up | done
--   name               the name it called as ("X0", or the person's own name for it), at most 24 characters as saved
--   item               the Plan Ease item ("pe:<eventRef>:<day>", "pt:<taskId>")
--   seed               what the server knew when it rang: the raw title, ids, place and times (server only: never in a push)
--   line, more         the lock-safe words of the ring and of the missed call's second half (planSafe.ts: no amounts, health as
--                      "Appointment")
--   opening            the line said when it was answered ('' until then)
--   turns              the spoken replies, for the voice route: [{ n, said, at }], 12 at most
--   tz_min             the offset the reminder's words were written in
--   ring_at_ms, ring_until_ms   when it rang, and when its 45 seconds are up
--   next_ms            when the sweep acts next (ring 2, the missed call, an answered call's idle end); null when nothing is due
--   rings              how many rings went (0 for a Call back, which never rang)
--   rang               the phones that took ring 1, as hashes of their push tokens (never the tokens): ring 2 and the missed call go
--                      only to them, since a phone whose ring failed was sent the reminder's own push instead
--   answered_ms, ended_ms
--
-- Calls older than 90 days are deleted by the sweep's clean-up, and every call goes with the account (on delete cascade). Written by
-- the server with the service key only.

create table if not exists public.plan_calls (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  source         text not null,
  source_key     text not null,
  origin         text not null default 'server',
  parent_id      uuid,
  state          text not null default 'ringing',
  why            text,
  name           text not null,
  item           text not null,
  seed           jsonb not null,
  line           text not null,
  more           text not null default '',
  opening        text not null default '',
  turns          jsonb not null default '[]'::jsonb,
  tz_min         smallint not null,
  ring_at_ms     bigint not null,
  ring_until_ms  bigint not null,
  next_ms        bigint,
  rings          smallint not null default 1,
  rang           jsonb not null default '[]'::jsonb,
  answered_ms    bigint,
  ended_ms       bigint
);
do $$ begin
  alter table public.plan_calls add constraint plan_calls_source_key unique (user_id, source_key);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_calls add constraint plan_calls_state check (state in ('ringing', 'answered', 'declined', 'missed', 'ended'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_calls add constraint plan_calls_source check (source in ('leave', 'due'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_calls add constraint plan_calls_origin check (origin in ('server', 'user'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_calls add constraint plan_calls_name check (char_length(name) between 1 and 40);
exception when duplicate_object then null; end $$;

-- The sweep: calls still ringing or answered whose next step is due, soonest first. The limits and Activity: one person's newest.
create index if not exists plan_calls_due_idx on public.plan_calls (next_ms) where state in ('ringing', 'answered') and next_ms is not null;
create index if not exists plan_calls_user_idx on public.plan_calls (user_id, ring_at_ms desc);

alter table public.plan_calls enable row level security;
-- No policies: only the server (the service key) reads or writes these.

-- Run in your Supabase SQL editor. It needs 0042 and can be run again.
