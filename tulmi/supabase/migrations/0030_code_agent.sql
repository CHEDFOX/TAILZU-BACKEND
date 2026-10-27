-- Tailzu — the Code bot's agent loop, layer 8 (src/code/agent, docs/code-agent.md).
--
-- Run in your Supabase SQL editor after 0029, before POST /v1/code/jobs is used on
-- a server that has the agent loop (it always has, once this release is
-- deployed). Needs 0023 (code_jobs, code_job_steps). It can be run again.
--
-- code_jobs.agent             the job is the agent loop's to drive: it was made
--                             through POST /v1/code/jobs, and a server picks it up
--                             and works it from the person's words to a pull
--                             request. A job made any other way (the router's own
--                             tests, a brain calling the router directly) is not.
-- code_jobs.agent_holder      which server drives it now (an instance id), or null.
-- code_jobs.agent_epoch       goes up by one every time a server claims the job.
--                             Every write the agent makes carries the epoch it was
--                             given, so a server that went quiet and was replaced
--                             can never write again: two servers never run one job.
-- code_jobs.agent_expires_at  when the claim runs out (two minutes ahead, renewed
--                             a third of the way through). The ticker gives a claim
--                             that ran out back, and any server may take it up from
--                             the job's checkpoint (the staged edits and the phase
--                             are in code_jobs.checkpoint -> agent).
-- code_jobs.waiting_on        three more waits, the agent's: 'answer' (a question it
--                             asked), 'approval' (a plan, or an action the policy asks
--                             about) and 'budget' (it ran out of money and offers to go
--                             on with more).
--
-- code_job_steps.overlay      the files a trial run lays over the checkout before its
--                             commands (the agent's staged edits, not yet committed),
--                             as [{path, content | null}]. Emptied when the step ends:
--                             the code is not kept here.
-- code_job_steps.discard      nothing the step changes is committed (a trial's checks).
--
-- Written by the server with the service key only; a person's own token can read
-- their own rows, as before (the policies from 0023 cover the new columns).

alter table public.code_jobs
  add column if not exists agent            boolean not null default false,
  add column if not exists agent_holder     text check (agent_holder is null or char_length(agent_holder) <= 200),
  add column if not exists agent_epoch      integer not null default 0 check (agent_epoch >= 0),
  add column if not exists agent_expires_at timestamptz;

alter table public.code_jobs drop constraint if exists code_jobs_waiting_on_check;
alter table public.code_jobs add constraint code_jobs_waiting_on_check
  check (waiting_on is null or waiting_on in ('paid', 'commit', 'answer', 'approval', 'budget'));

-- The orchestrator and the ticker: agent jobs that someone may need to pick up.
create index if not exists code_jobs_agent_idx on public.code_jobs (updated_at)
  where agent and state in ('queued', 'running', 'waiting_for_compute', 'waiting_for_you');

alter table public.code_job_steps
  add column if not exists overlay jsonb   not null default '[]'::jsonb,
  add column if not exists discard boolean not null default false;
