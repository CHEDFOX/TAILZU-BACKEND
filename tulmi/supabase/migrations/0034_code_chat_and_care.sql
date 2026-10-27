-- Tailzu — talking about code, free-form jobs with rewind, and PR care (src/code/chat, src/code/agent, src/code/prcare;
-- docs/code-chat.md, docs/code-agent.md, docs/pr-care.md, docs/desktop-runner-session.md).
--
-- Run in your Supabase SQL editor after 0033, before turning the front door's code answers on for people who will have follow-up questions, or PR care on.
-- Needs 0020 (code_projects), 0023 (code_jobs, code_job_steps) and 0030. It can be run again. Without it every store below keeps its rows in memory and a
-- restart forgets them; nothing else depends on it.
--
-- code_chat_threads     one row per conversation about a project's code (the app makes the id): a SHORT rolling summary of the last turns, so a follow-up
--                       ("and where is the logout?") means something, and what the last answer found (the files and lines it rests on, and where a change
--                       would go), so "ok, change it" starts a job that does not look for the place again. The summary is cut to 2,000 characters and holds
--                       questions and the files they were about, not the code. The rows go with the account and with the project.
-- code_project_settings the person's choice for a project: how a job is worked (guided: locate, plan, work; or freeform: the model decides the order of
--                       explore, change and run), and "always show me the plan first" (every task's plan goes to them for a yes before any work).
-- code_job_checkpoints  the staged edits of a job after each step (a round of the model's work), so a person can rewind to a step. Kept while the job
--                       lives; the rows go with the job. They hold the person's code (the staged files): readable by the owner only, like the job's own
--                       checkpoint.
-- code_pr_care          one row for each pull request Tailzu looks after (one it opened, or one the person handed over): the one "Tailzu status" comment it
--                       edits in place, how many automatic CI fix rounds it made today, and what it has seen, so a webhook that arrives twice does the same
--                       thing once.
-- code_branches        handed: a pull request's branch the person handed over to Tailzu to look after (not one of Tailzu's "tailzu/..." branches). It is
--                       recorded like a work branch, so jobs run on it and the policy treats it as Tailzu's own: the hand-over is the person's yes to pushing.
-- code_job_steps       capture, captured, declined (protocol version 2 and the merge of a branch with its base): a step whose changes the agent reads instead
--                       of the server committing them; what such a step handed back (emptied when the agent has it, and when the job ends); and the
--                       computers that declined the step, which are never offered it again.
--
-- Written by the server with the service key only. A person's own token can READ their own rows and nothing else (owner-read RLS).

create table if not exists public.code_chat_threads (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null references public.code_projects (id) on delete cascade,
  summary       text not null default '' check (char_length(summary) <= 2000),
  turns         integer not null default 0 check (turns >= 0),
  last_question text not null default '' check (char_length(last_question) <= 1000),
  last_cites    text[] not null default '{}',
  -- The last answer's located files, as work/locate.ts Located: what a hand-off to a job carries.
  last_located  jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists code_chat_threads_user_idx on public.code_chat_threads (user_id, project_id, updated_at desc);

create table if not exists public.code_project_settings (
  project_id uuid primary key references public.code_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  mode       text not null default 'guided' check (mode in ('guided', 'freeform')),
  plan_first boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.code_job_checkpoints (
  job_id  uuid not null references public.code_jobs (id) on delete cascade,
  step    integer not null check (step >= 0),
  at      timestamptz not null default now(),
  -- [{path, content | null, action}]: the staged edits as they stood after this step.
  staged  jsonb not null default '[]'::jsonb,
  -- A line about what the step did, for the person choosing where to rewind to.
  note    text not null default '' check (char_length(note) <= 300),
  -- The notes the model is given back after a rewind: the running summary and the digests.
  summary text not null default '' check (char_length(summary) <= 4000),
  digests jsonb not null default '[]'::jsonb,
  primary key (job_id, step)
);

create table if not exists public.code_pr_care (
  project_id        uuid not null references public.code_projects (id) on delete cascade,
  pr_number         integer not null check (pr_number > 0),
  user_id           uuid not null references auth.users (id) on delete cascade,
  branch            text not null check (char_length(branch) between 1 and 255),
  origin            text not null default 'tailzu' check (origin in ('tailzu', 'handed')),
  -- The one comment Tailzu keeps edited, by GitHub's id.
  status_comment_id bigint,
  -- {"2026-10-27": 2}: automatic CI fix rounds made on each UTC day.
  ci_rounds         jsonb not null default '{}'::jsonb,
  -- What has been seen and done: the last head checked, the threads and comments already handled, the notes shown in the status.
  state             jsonb not null default '{}'::jsonb,
  handed_at         timestamptz,
  -- Set when the pull request is merged or closed: nothing more is done for it, and the sweep skips it.
  ended_at          timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (project_id, pr_number)
);

create index if not exists code_pr_care_branch_idx on public.code_pr_care (project_id, branch);
create index if not exists code_pr_care_open_idx on public.code_pr_care (updated_at) where ended_at is null;

alter table public.code_branches add column if not exists handed boolean not null default false;
alter table public.code_branches drop constraint if exists code_branches_branch_check;
alter table public.code_branches add constraint code_branches_branch_check check (handed or branch ~ '^tailzu/[a-z0-9][a-z0-9-]{0,48}$');

alter table public.code_job_steps
  add column if not exists capture  boolean not null default false,
  add column if not exists captured jsonb   not null default '[]'::jsonb,
  add column if not exists declined jsonb   not null default '[]'::jsonb;

alter table public.code_chat_threads    enable row level security;
alter table public.code_project_settings enable row level security;
alter table public.code_job_checkpoints enable row level security;
alter table public.code_pr_care         enable row level security;

drop policy if exists "users read own code chat threads" on public.code_chat_threads;
create policy "users read own code chat threads"
  on public.code_chat_threads for select
  using (user_id = auth.uid());

drop policy if exists "users read own code project settings" on public.code_project_settings;
create policy "users read own code project settings"
  on public.code_project_settings for select
  using (user_id = auth.uid());

drop policy if exists "users read own code job checkpoints" on public.code_job_checkpoints;
create policy "users read own code job checkpoints"
  on public.code_job_checkpoints for select
  using (exists (
    select 1 from public.code_jobs j
    where j.id = code_job_checkpoints.job_id and j.user_id = auth.uid()
  ));

drop policy if exists "users read own code pr care" on public.code_pr_care;
create policy "users read own code pr care"
  on public.code_pr_care for select
  using (user_id = auth.uid());
