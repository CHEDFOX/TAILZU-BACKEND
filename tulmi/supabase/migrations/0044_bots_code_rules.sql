-- Tailzu — the Code bot's project rules the Bots app keeps (src/botsCode/store.ts; docs/bots-app.md, screen bots.code.rules).
--
-- Run in your Supabase SQL editor after 0020 (code_projects). It can be run again. Without it the cap is kept in memory and a restart
-- forgets it (jobs then get the server's default budget, CODE_JOB_DEFAULT_BUDGET_PAISE); nothing else depends on it.
--
-- bots_code_rules   one row per person and project: the spend cap per job they set on the project's rules screen ("Spend cap per job ₹40").
--                   Every job the app starts in that project carries it as its budget, so the job stops and asks before going over. The
--                   rest of a project's rules (open pull requests, merge, push to main) are the policy's own standing permissions
--                   (code_grants), not kept here. The row goes with the account and with the project.
--
-- Written by the server with the service key only. A person's own token can READ their own rows and nothing else (owner-read RLS).

create table if not exists public.bots_code_rules (
  user_id        uuid not null references auth.users (id) on delete cascade,
  project_id     uuid not null references public.code_projects (id) on delete cascade,
  job_cap_paise  integer not null check (job_cap_paise between 1000 and 50000),
  updated_at     timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.bots_code_rules enable row level security;

drop policy if exists "users read own bots code rules" on public.bots_code_rules;
create policy "users read own bots code rules"
  on public.bots_code_rules for select
  using (user_id = auth.uid());
