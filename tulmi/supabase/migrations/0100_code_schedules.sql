-- Scheduled code work (docs/code-schedule.md): a project's own standing job, started by Xode on a schedule
-- instead of by a person asking. A routine runs a BOT'S turn (migration 0062); this starts a JOB, which is
-- longer, costs money and ends in a pull request, so it is its own table with its own budget and its own guards.
--
-- Safe to run again: every create is `if not exists`, every policy dropped first.

create table if not exists public.code_schedules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  project_id    uuid not null references public.code_projects (id) on delete cascade,
  -- What to do, in the person's words, as a job's task.
  task          text not null,
  -- The schedule, as routines keep theirs (src/routines/words.ts Schedule): kind, time, day, and the person's offset.
  schedule      jsonb not null,
  tz            integer not null default 0,
  -- What one run of it may spend, in paise. Its own, because a standing job spends without anyone watching.
  budget_paise  integer not null default 3000,
  -- "on" | "paused": paused by the person, or by itself after three runs that failed.
  status        text not null default 'on',
  paused_why    text not null default '',
  next_at       timestamptz,
  last_at       timestamptz,
  -- The job the last run started, and how it ended, for the list.
  last_job_id   uuid references public.code_jobs (id) on delete set null,
  last_status   text,
  last_text     text not null default '',
  runs          integer not null default 0,
  fails         integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The tick reads what is due; a person reads their own, newest first.
create index if not exists code_schedules_due_idx on public.code_schedules (next_at) where status = 'on';
create index if not exists code_schedules_user_idx on public.code_schedules (user_id, created_at desc);
create index if not exists code_schedules_project_idx on public.code_schedules (project_id);

alter table public.code_schedules enable row level security;

-- A person's own rows are theirs to read; only the server writes (the service key), as the routines' table has it.
drop policy if exists "code_schedules_own_select" on public.code_schedules;
create policy "code_schedules_own_select" on public.code_schedules
  for select using (auth.uid() = user_id);
