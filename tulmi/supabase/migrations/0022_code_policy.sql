-- Tailzu — the Code bot's permissions: standing grants (src/code/policy.ts).
--
-- Run in your Supabase SQL editor after 0021, before using the permission routes
-- (GET/POST/DELETE /v1/code/projects/:id/permissions).
--
-- The bot is not fenced in. It works like Claude Code with git: some things it
-- just does (read, make a branch, commit to a branch it made, open a draft pull
-- request), some it asks the person about first (commit to any other branch,
-- merge, mark ready, close, delete a branch, change a workflow file, start an
-- empty repo), a few it asks about with Face ID every single time (force-push,
-- deleting the default branch, committing something that looks like a secret),
-- and a few it never does. A person can answer "ask" once for good:
--
-- code_grants  one row per standing permission for one project: "always let
--              the bot do <action> on branches matching <pattern>" (effect
--              'allow'), or "never let it" ('deny', which beats every allow).
--              branch_pattern is a glob over branch names ("main",
--              "release/*"); the empty string means every branch. expires_at
--              is optional. The same (project, action, pattern, effect) twice
--              is one row. The server refuses to store a grant for an action
--              that always asks or never happens, and the policy ignores one
--              that got here some other way.
--
-- Written by the server with the service key only. A person's own token can READ
-- the grants of their own projects (the policy below) and nothing else. They go
-- with their project.

create table if not exists public.code_grants (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.code_projects (id) on delete cascade,
  -- One of the policy's action ids ("commit.other_branch", "pr.merge", ...).
  action         text not null check (char_length(action) between 1 and 60),
  -- A glob; '' is "every branch".
  branch_pattern text not null default '' check (char_length(branch_pattern) <= 200),
  effect         text not null check (effect in ('allow', 'deny')),
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (project_id, action, branch_pattern, effect)
);

alter table public.code_grants enable row level security;

drop policy if exists "users read own code grants" on public.code_grants;
create policy "users read own code grants"
  on public.code_grants for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_grants.project_id and p.user_id = auth.uid()
  ));
