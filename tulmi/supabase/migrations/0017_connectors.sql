-- Tailzu — connected apps (src/connectors): Ask acting in the person's own
-- apps through MCP servers.
--
-- Run in your Supabase SQL editor after 0016, before switching CONNECTORS on.
--
-- Three tables, all written by the server with the service key only. A person's
-- own token can READ their rows (policies below) and nothing else: their level,
-- their "auto" list and their tokens change nowhere but in the server's code.
--
--   connector_connections  one row per person per app: what they allowed it
--                          to do (level), which tools may run without asking
--                          (auto_ok), and the secrets, encrypted by the server
--                          with CONNECTOR_TOKEN_KEY before they get here.
--   assistant_tasks        one row per Ask run that used a connected app, and
--                          what it is waiting on. `approval` holds the call
--                          that needs a yes (its arguments, so the yes can run
--                          it) until it runs or is refused; then it is null.
--   assistant_audit        what ran: the tool, its risk, how it ended, a few
--                          words. NO message text, arguments or results.

create table if not exists public.connector_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  connector_id   text not null,
  -- look: reads only.  draft: may prepare changes, each one asked.
  -- send: may send, asked unless the tool is in auto_ok. Deletes and payments
  -- are always asked, whatever this says.
  level          text not null default 'look' check (level in ('look', 'draft', 'send')),
  -- AES-256-GCM, "v1.<base64url>": the OAuth tokens, or the pasted URL. Null until connected.
  tokens_enc     text,
  -- The PKCE verifier between starting a sign-in and finishing it; null otherwise.
  verifier_enc   text,
  -- The OAuth client the app registered for us (an id, not a secret).
  client_info    jsonb,
  auto_ok        text[] not null default '{}',
  last_used_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, connector_id)
);

create table if not exists public.assistant_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Ask's run id, so the steps of one run share a task.
  run_id      text,
  state       text not null default 'running'
              check (state in ('running', 'waiting', 'done', 'failed', 'cancelled')),
  title       text not null default '',
  -- [{ at: ms, text }], newest last, short.
  steps       jsonb not null default '[]'::jsonb,
  -- { id, connector, tool, risk, preview, args, at } while state = 'waiting'.
  approval    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists assistant_tasks_user_updated_idx
  on public.assistant_tasks (user_id, updated_at desc);
create index if not exists assistant_tasks_run_idx
  on public.assistant_tasks (user_id, run_id) where run_id is not null;

create table if not exists public.assistant_audit (
  id            bigint generated always as identity primary key,
  task_id       uuid not null references public.assistant_tasks (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  connector_id  text not null,
  tool          text not null,
  risk          text not null check (risk in ('read', 'write', 'send', 'destructive', 'pay')),
  outcome       text not null check (outcome in ('ok', 'failed', 'denied')),
  summary       text not null default '',
  at            timestamptz not null default now()
);

create index if not exists assistant_audit_task_idx on public.assistant_audit (task_id, at);
create index if not exists assistant_audit_user_idx on public.assistant_audit (user_id, at desc);

alter table public.connector_connections enable row level security;
alter table public.assistant_tasks       enable row level security;
alter table public.assistant_audit       enable row level security;

drop policy if exists "users read own connections" on public.connector_connections;
create policy "users read own connections"
  on public.connector_connections for select
  using (auth.uid() = user_id);

drop policy if exists "users read own tasks" on public.assistant_tasks;
create policy "users read own tasks"
  on public.assistant_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "users read own audit" on public.assistant_audit;
create policy "users read own audit"
  on public.assistant_audit for select
  using (auth.uid() = user_id);
