-- Tailzu — the realtime call (src/botsBots/planCallLive.ts, planCallLiveWords.ts; docs/plan-ease.md "Calls").
--
-- An answered call can now be one live voice conversation instead of turn by turn: the phone talks straight to OpenAI's realtime
-- service over WebRTC, and the server holds its own socket on the same call, where every tool runs, the AI permission is re-checked,
-- and the record is written. These columns are what the server keeps of that part of a call.
--
--   rt_call    the OpenAI id of the current or last live part (rtc_…)
--   rt_state   null (never live) | starting | live | stopped | ended | fell_back
--   rt_sec     live seconds used over every part of this call: the hard length against a stuck session reads it
--   cost_usd   what this call cost: its live responses, its transcription, its tool work, and a turn call's chat turns.
--              A RECORD FOR THE OWNER, NEVER A CAP. No call is refused, shortened or stopped for cost, nothing is charged to the
--              person's day budget, spend gate or plan quota, and no usage row is written for a call.
--   acted      the call's own actions already done out loud: "paid", "done", "later", "cant" (the screen ticks its buttons from it)
--   judged     it rang because the call judge said call (docs/plan-call-judge.md): neither counted toward the 3 calls a day nor
--              held to them
--
-- source also gains 'item': a call the judge asked for about one thing on the Plan.
--
-- why gains three endings of its own (the column stays unconstrained, as 0079 left it), so the record in 0079's header reads in
-- full: not_sent | timeout | hung_up | done | max_len (the hard length against a stuck session) | idle (nobody spoke) |
-- consent (the person took their AI permission back mid-call).
--
-- Run it in your Supabase SQL editor. It needs 0079 and 0081, and can be run again.

alter table public.plan_calls
  add column if not exists rt_call  text,
  add column if not exists rt_state text,
  add column if not exists rt_sec   integer not null default 0,
  add column if not exists cost_usd numeric(12,6) not null default 0,
  add column if not exists acted    jsonb   not null default '[]'::jsonb,
  add column if not exists judged   boolean not null default false;

alter table public.plan_calls drop constraint if exists plan_calls_source;
alter table public.plan_calls add constraint plan_calls_source check (source in ('leave', 'due', 'follow', 'item'));

-- What a call cost, by day, for the owner's own reading (docs/plan-ease.md "Calls"):
--   select date_trunc('day', to_timestamp(ring_at_ms/1000)) d, count(*), sum(cost_usd), sum(rt_sec)
--   from plan_calls group by 1 order by 1 desc;
