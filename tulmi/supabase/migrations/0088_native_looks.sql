-- Tailzu — the native looks: what a phone HOLDS, so the server never names a design it cannot draw (src/experience/native/*,
-- src/widgets/glanceStore.ts; routes/bots/widgets.ts POST /v1/widgets/activity-token and /activity-start-token; docs/native-looks.md).
--
-- Run in your Supabase SQL editor before the native looks are switched on (NATIVE_LOOKS). It needs 0059 and nothing else, and it can be
-- run again.
--
-- WHAT HAPPENS WITHOUT IT. The token store notices the missing column once per process and reads and writes the rows without it
-- (glanceStore.ts `nlMissing`, the same shape as push/store.ts's `capsMissing`). Every push still goes out; `nl` simply reads as 0,
-- "this phone holds no catalog", so no design is ever named — the safe way round, because a push with no `look` draws the
-- hand-written regions the build already has. Nothing is lost but the looks themselves.
--
-- That fallback is the only reason the deploy order is free. It was NOT free before it existed: a backend deployed ahead of this
-- migration threw on every token read, which ActivityPusher caught as "no token", and the Live Activity stopped moving for every
-- build, new and old, with all the switches off. If the fallback is ever taken out, this migration goes back to being a thing to
-- run BEFORE the deploy, not before the switch.
--
--   widget_activity_tokens.nl   the nlook catalog version that phone held when it registered. A design is named in a push only when
--                               its `since` is at or below this number, which is how a push can never name a design the phone has
--                               not downloaded yet.
--   job_id '__start__'          the PUSH-TO-START token (iOS 17.2+, ActivityPushStart): one per person, not per job, because it
--                               starts an activity for a job that has none. It lives in this same table under a reserved job id
--                               rather than in a table of its own: it is the same kind of secret, with the same lifetime, the same
--                               environment and the same "forget it when Apple says it is gone" rule.
--
-- Written by the server with the service key only. No policy: a person's own token can neither read nor write this table.

alter table public.widget_activity_tokens
  add column if not exists nl integer not null default 0;

comment on column public.widget_activity_tokens.nl is
  'The nlook catalog version the phone held when it registered this token. 0: it holds none, so no design is ever named for it.';

comment on table public.widget_activity_tokens is
  'One row per person and Code bot job: the Live Activity''s APNs push token. The reserved job_id ''__start__'' holds that person''s push-to-start token instead, which starts an activity while the app is shut.';
