-- Tailzu — the Code bot's GitHub side (src/code, CODE_GITHUB).
--
-- Run in your Supabase SQL editor after 0019, before switching CODE_GITHUB on.
--
-- code_installations  one row per (person, GitHub App install) the person has
--                     connected: which account it is on, whether it sees all
--                     of that account's repos or only some, and when GitHub
--                     suspended it (null when it is not). The link is made
--                     only after GitHub itself has said the person can reach
--                     the install (src/code/link.ts), so a row is never a
--                     claim on someone else's. It also keeps who the person
--                     is on GitHub (id and login, read when they linked):
--                     GitHub lists an install for anyone who can reach any
--                     repo in it, an organisation member or a collaborator on
--                     someone's personal repo, so a link is not access to every
--                     repo in the install. The server asks GitHub what that
--                     login may do in each repo (src/code/projects.ts) and
--                     works only where it is write or admin; on an install of
--                     the person's own account, in all of it. A row from
--                     before these two columns has them null and has to be
--                     linked again.
-- code_projects       one row per repo a person picked to work on. Unique per
--                     person and repo, so picking it twice is the same project.
-- code_branches       the work branches Tailzu made in a project
--                     (tailzu/<slug>-<4 hex>): the first 200 characters of the
--                     task they were made for, the commit they started from,
--                     and the draft PR once there is one. They go with their
--                     project.
--
-- Nothing here is a GitHub token. The person's own token is used once, in the
-- install callback, and dropped; an installation token is minted when it is
-- needed and kept in the server's memory for under an hour.
--
-- Written by the server with the service key only. A person's own token can
-- READ their rows (the policies below) and nothing else. GitHub's webhook
-- (installation deleted or suspended, repos removed) acts across people: an
-- install is one thing for everyone who linked it.

create table if not exists public.code_installations (
  user_id              uuid not null references auth.users (id) on delete cascade,
  -- GitHub's id for the install.
  installation_id      bigint not null,
  -- The account it is on: the person's own login, or the organisation's.
  account_login        text not null check (char_length(account_login) between 1 and 100),
  -- As GitHub says it ("User", "Organization").
  account_type         text not null default 'User' check (char_length(account_type) between 1 and 40),
  repository_selection text not null default 'selected' check (repository_selection in ('all', 'selected')),
  suspended_at         timestamptz,
  github_user_id       bigint,
  github_login         text check (github_login is null or char_length(github_login) between 1 and 100),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, installation_id)
);

-- For a table made before the two columns above (this script is re-runnable).
alter table public.code_installations
  add column if not exists github_user_id bigint,
  add column if not exists github_login   text;

-- GitHub's webhook names an install, not a person.
create index if not exists code_installations_install_idx on public.code_installations (installation_id);

create table if not exists public.code_projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null,
  repo_id         bigint not null,
  -- "owner/name".
  full_name       text not null check (char_length(full_name) between 3 and 200),
  default_branch  text not null check (char_length(default_branch) between 1 and 255),
  private         boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (user_id, repo_id)
);

-- A webhook that removes repos from an install, or the install itself.
create index if not exists code_projects_install_idx on public.code_projects (installation_id, repo_id);

create table if not exists public.code_branches (
  project_id uuid not null references public.code_projects (id) on delete cascade,
  branch     text not null check (branch ~ '^tailzu/[a-z0-9][a-z0-9-]{0,48}$'),
  -- What the person asked for, cut to 200 characters.
  task       text not null default '' check (char_length(task) <= 200),
  -- The default branch's head when this branch was made.
  base_sha   text not null,
  pr_number  integer,
  pr_url     text,
  created_at timestamptz not null default now(),
  primary key (project_id, branch)
);

alter table public.code_installations enable row level security;
alter table public.code_projects      enable row level security;
alter table public.code_branches      enable row level security;

drop policy if exists "users read own code installations" on public.code_installations;
create policy "users read own code installations"
  on public.code_installations for select
  using (auth.uid() = user_id);

drop policy if exists "users read own code projects" on public.code_projects;
create policy "users read own code projects"
  on public.code_projects for select
  using (auth.uid() = user_id);

drop policy if exists "users read own code branches" on public.code_branches;
create policy "users read own code branches"
  on public.code_branches for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_branches.project_id and p.user_id = auth.uid()
  ));
