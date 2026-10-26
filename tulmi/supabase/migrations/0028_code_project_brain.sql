-- Tailzu — the Code bot's project brain, layer 4 (src/code/project, docs/code-project-brain.md).
--
-- Run in your Supabase SQL editor after 0027, before switching CODE_PROJECT_BRAIN
-- on. Needs 0020 (code_projects).
--
-- When a person adds a repo as a project, Tailzu reads it once and keeps what it
-- learned, so the bot can go straight to the file it needs and a push only costs
-- the files that changed. Four tables, all of them one project's:
--
-- code_brain          one row per project: the commit and root tree it was built
--                     from; status (building, ready, failed, or stale when the
--                     default branch has moved on); progress {pct, phase};
--                     structure (languages, frameworks, workspaces, entry points,
--                     commands, CI, env var NAMES, Docker, the README's title, the
--                     secret files that exist by path only, and what each manifest
--                     said keyed by its blob sha); conventions (formatter, linter,
--                     style, commit style, branch naming, and the repo's own agent
--                     docs, capped); features (the clusters of files, named);
--                     memory (the TAILZU.md text, which is NOT committed to the
--                     repo); welcome (the first message, 900 characters at most);
--                     summaries_state (none, partial or complete: whether the
--                     model's lines stand for every file picked, or the money ran
--                     out); baseline (the plan of checks, and what they said when
--                     last run); history (the commits looked at for hotspots, each
--                     with the files it touched, so a push costs the new commits
--                     only); spent_paise (what the models cost, in all); built_at;
--                     error (plain words, never a path or a line of code)
-- code_brain_files    one row per file that was read: its git blob sha (the Merkle
--                     leaf: an unchanged sha means an unchanged row), language,
--                     size, symbols (jsonb: name, kind, line, exported, and for a
--                     route its verb and path), the repo files it imports,
--                     centrality (rank 0 to 1), how often it changed lately (hot),
--                     TODO/FIXME/HACK markers (todo), the test files that cover it,
--                     and the model's line about it. tsv is generated: the words
--                     of its path (camelCase and snake_case split), of its symbol
--                     names and of its summary, 'simple' configuration, with a GIN
--                     index; imports has one too, to ask who imports a file
-- code_brain_dirs     one row per folder that has a line: its git tree sha, the
--                     other Merkle node, and the summary made from its children.
--                     The root ('') holds the overview of the whole repo
-- code_brain_texts    the strings a person sees, each with the file and line it is
--                     on: JSX text and attributes, HTML, translations (with their
--                     keys), Flutter, Android and iOS strings, flash messages and
--                     template names. A line the secret scanner flags is never in
--                     it. tsv is generated and indexed
--
-- No file contents are kept, in any table. What the model is sent is an excerpt of
-- a file, and OpenRouter is asked for providers that keep and train on nothing.
--
-- Written by the server with the service key only. A person's own token can READ
-- the rows of their own projects (the policies below, as in 0020) and nothing
-- else. All four go with their project (on delete cascade), so removing a project,
-- an install, or an account removes what was learned.

create table if not exists public.code_brain (
  project_id      uuid primary key references public.code_projects (id) on delete cascade,
  head_sha        text not null default '',
  tree_sha        text not null default '',
  status          text not null default 'building' check (status in ('building', 'ready', 'failed', 'stale')),
  progress        jsonb not null default '{}'::jsonb,
  structure       jsonb not null default '{}'::jsonb,
  conventions     jsonb not null default '{}'::jsonb,
  features        jsonb not null default '[]'::jsonb,
  memory          text not null default '',
  welcome         text not null default '',
  summaries_state text not null default 'none' check (summaries_state in ('none', 'partial', 'complete')),
  baseline        jsonb,
  history         jsonb not null default '{}'::jsonb,
  spent_paise     integer not null default 0 check (spent_paise >= 0),
  built_at        timestamptz,
  error           text not null default '',
  updated_at      timestamptz not null default now()
);

create table if not exists public.code_brain_files (
  project_id uuid not null references public.code_projects (id) on delete cascade,
  path       text not null check (char_length(path) between 1 and 1024),
  blob_sha   text not null,
  lang       text not null default '',
  bytes      integer not null default 0 check (bytes >= 0),
  symbols    jsonb not null default '[]'::jsonb,
  imports    text[] not null default '{}',
  rank       real not null default 0,
  hot        integer not null default 0 check (hot >= 0),
  todo       integer not null default 0 check (todo >= 0),
  tests      text[] not null default '{}',
  summary    text not null default '',
  tsv        tsvector generated always as (
    to_tsvector(
      'simple',
      regexp_replace(regexp_replace(path, '([a-z0-9])([A-Z])', '\1 \2', 'g'), '[^[:alnum:]]+', ' ', 'g')
      || ' ' ||
      regexp_replace(regexp_replace(coalesce(jsonb_path_query_array(symbols, '$[*].name')::text, ''), '([a-z0-9])([A-Z])', '\1 \2', 'g'), '[^[:alnum:]]+', ' ', 'g')
      || ' ' ||
      regexp_replace(summary, '[^[:alnum:]]+', ' ', 'g')
    )
  ) stored,
  primary key (project_id, path)
);

create index if not exists code_brain_files_tsv_idx on public.code_brain_files using gin (tsv);
-- Who imports a file: imports @> '{path}'.
create index if not exists code_brain_files_imports_idx on public.code_brain_files using gin (imports);
-- The hot files of a project.
create index if not exists code_brain_files_hot_idx on public.code_brain_files (project_id, hot desc);

create table if not exists public.code_brain_dirs (
  project_id uuid not null references public.code_projects (id) on delete cascade,
  path       text not null check (char_length(path) <= 1024),
  tree_sha   text not null,
  summary    text not null default '',
  primary key (project_id, path)
);

create table if not exists public.code_brain_texts (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.code_projects (id) on delete cascade,
  path       text not null check (char_length(path) between 1 and 1024),
  line       integer not null default 1 check (line >= 1),
  text       text not null check (char_length(text) between 1 and 1000),
  kind       text not null default 'string',
  tsv        tsvector generated always as (
    to_tsvector('simple', regexp_replace(text, '[^[:alnum:]]+', ' ', 'g'))
  ) stored
);

create index if not exists code_brain_texts_tsv_idx on public.code_brain_texts using gin (tsv);
-- Clearing and reading one file's strings.
create index if not exists code_brain_texts_path_idx on public.code_brain_texts (project_id, path);

alter table public.code_brain       enable row level security;
alter table public.code_brain_files enable row level security;
alter table public.code_brain_dirs  enable row level security;
alter table public.code_brain_texts enable row level security;

drop policy if exists "users read own code brain" on public.code_brain;
create policy "users read own code brain"
  on public.code_brain for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "users read own code brain files" on public.code_brain_files;
create policy "users read own code brain files"
  on public.code_brain_files for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain_files.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "users read own code brain dirs" on public.code_brain_dirs;
create policy "users read own code brain dirs"
  on public.code_brain_dirs for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain_dirs.project_id and p.user_id = auth.uid()
  ));

drop policy if exists "users read own code brain texts" on public.code_brain_texts;
create policy "users read own code brain texts"
  on public.code_brain_texts for select
  using (exists (
    select 1 from public.code_projects p
    where p.id = code_brain_texts.project_id and p.user_id = auth.uid()
  ));
