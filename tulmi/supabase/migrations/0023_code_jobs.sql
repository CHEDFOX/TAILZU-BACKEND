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
