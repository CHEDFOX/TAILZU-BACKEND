-- Tailzu — the Code bot's work log and the new-project intake, layers 5 and 7
-- (src/code/work, src/code/newproject, docs/code-work.md).
--
-- Run in your Supabase SQL editor after 0028, before switching CODE_PROJECT_BRAIN
-- on for people who will use the agent loop. Needs 0020 (code_projects) and 0023
-- (code_jobs). Without it both keep their rows in memory (gone when the server
-- restarts) and nothing else depends on it.
--
-- code_worklog   one row per thing the bot did or noticed on a job, in order: a
--                step it took, a file it read, an edit it made, a command it ran
--                and what that said, a finding (a bug or a smell it saw while
--                reading), a decision, a question it asked. kind is one of those
--                eight words; text is the plain-words line (2,000 characters at
--                most); files the paths it is about; data a small jsonb with the
--                detail (an exit code, a verdict, a severity and a line). The PR
--                body's "work log" section is rendered from these rows.
--                Everything is run through the secret scan before it is written:
--                a line that looked like a secret is replaced by a note, so
--                nothing here can leak one into a pull request. A job's rows go
--                with the job (on delete cascade).
--
-- code_intake    the questions a new project is asked before anything is planned
--                (what it is, who for, where it runs, the must-haves, the limits,
--                the examples), one row per project: the person's first message,
--                their answers by question id, which questions were asked,
--                whether it is still asking (asking), has what it needs (ready)
--                or the spec was made (done), and the spec and the chosen stack
--                once there are any, and the one-time tips already shown. The rows
--                go with the project.
--
-- Written by the server with the service key only. A person's own token can READ
-- the rows of their own jobs and projects (the policies below, as in 0023 and
-- 0028) and nothing else.

create table if not exists public.code_worklog (
  id     bigint generated always as identity primary key,
  job_id uuid not null references public.code_jobs (id) on delete cascade,
  at     timestamptz not null default now(),
  kind   text not null check (kind in ('step', 'read', 'edit', 'command', 'finding', 'decision', 'question', 'note')),
  text   text not null default '' check (char_length(text) <= 2000),
  files  text[] not null default '{}',
  data   jsonb
);

-- A job's log, in order.
create index if not exists code_worklog_job_idx on public.code_worklog (job_id, id);

create table if not exists public.code_intake (
  project_id uuid primary key references public.code_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  state      text not null default 'asking' check (state in ('asking', 'ready', 'done')),
  request    text not null default '' check (char_length(request) <= 4000),
  answers    jsonb not null default '{}'::jsonb,
  asked      jsonb not null default '[]'::jsonb,
  spec       jsonb,
  stack      jsonb,
  -- One-time tips already shown ('preview': connect your host so pull requests get a preview link).
  tips       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.code_worklog enable row level security;
alter table public.code_intake  enable row level security;

drop policy if exists "users read own code worklog" on public.code_worklog;
create policy "users read own code worklog"
  on public.code_worklog for select
  using (exists (
    select 1 from public.code_jobs j
    where j.id = code_worklog.job_id and j.user_id = auth.uid()
  ));

drop policy if exists "users read own code intake" on public.code_intake;
create policy "users read own code intake"
  on public.code_intake for select
  using (user_id = auth.uid());
