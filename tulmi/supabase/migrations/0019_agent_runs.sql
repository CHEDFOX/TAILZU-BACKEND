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
