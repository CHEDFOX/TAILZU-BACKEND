-- Tailzu — artifacts: live things a bot makes and the person sees and clicks in the app (src/artifacts, docs/artifacts.md).
--
-- Run in your Supabase SQL editor before turning ARTIFACTS on. It needs nothing from the Code bot's migrations, so artifacts work
-- for every bot; a Code project's id is kept in project_id as a plain uuid (no foreign key) so they can be run in either order.
-- It can be run again.
--
-- artifacts          one row per artifact: whose, what kind (the viewer's types), the title, which version is the head, the share
--                    token (null while it is private), whether people who open the share link may save data too, and what models have
--                    cost for it in paise
-- artifact_versions  a row per version. Version 1 is a SNAPSHOT (the whole text); after it a version is a PATCH against the one before
--                    (the JSON of the spans that changed), and every tenth version is a snapshot again (11, 21, ...), so storage stays
--                    tiny however often a bot edits and any version can be rebuilt from the nearest snapshot (src/artifacts/versions.ts).
--                    `bytes` is how big the stored body is
-- artifact_data      what an artifact saves while it runs: a key and a JSON value, in a scope: 'shared' (seen by everyone who opens the
--                    artifact) or one person's user id (theirs alone). The protocol's limits apply (64 KB a value, 500 keys a scope)
--                    and are kept by the server; the key count is also kept here, under a lock, by artifact_data_put
-- artifact_kits      a project's look (src/artifacts/kit.ts), one row per project, for the head of its brain it was read at: read again
--                    only when the head moves
--
-- Written by the server with the service key only. A person's own token can READ their own artifacts, their versions, the data of the
-- shared scope in artifacts they own, and the data in their own scope anywhere; nothing else. A share link is read through the API
-- (GET /v1/artifacts/shared/:token), never straight from the database.
--
-- artifact_add_version   makes the next version only if the head is still where the writer read it, and writes it in the same step, so
--                        two edits at once never overwrite each other (the second gets null and is told to look again)
-- artifact_add_spend     adds to what the artifact has cost, in one statement
-- artifact_data_put      saves a key, refusing a NEW key once the scope holds p_max_keys, under a lock on (artifact, scope)

create table if not exists public.artifacts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  project_id      uuid,
  type            text not null check (type in ('html', 'react', 'svg', 'mermaid', 'markdown')),
  title           text not null check (char_length(title) between 1 and 120),
  head_version    integer not null default 1 check (head_version >= 1),
  share_token     text unique,
  others_can_save boolean not null default false,
  spent_paise     integer not null default 0 check (spent_paise >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists artifacts_user_updated_idx on public.artifacts (user_id, updated_at desc);
create index if not exists artifacts_user_project_idx on public.artifacts (user_id, project_id) where project_id is not null;

create table if not exists public.artifact_versions (
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  version     integer not null check (version >= 1),
  kind        text not null check (kind in ('snapshot', 'patch')),
  body        text not null,
  made_by     text not null check (made_by in ('bot', 'person')),
  note        text not null default '' check (char_length(note) <= 300),
  bytes       integer generated always as (octet_length(body)) stored,
  created_at  timestamptz not null default now(),
  primary key (artifact_id, version)
);

-- The nearest snapshot at or before a version: the first read of rebuilding it.
create index if not exists artifact_versions_snapshot_idx on public.artifact_versions (artifact_id, version desc) where kind = 'snapshot';

create table if not exists public.artifact_data (
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  scope       text not null check (scope = 'shared' or scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  key         text not null check (char_length(key) between 1 and 128),
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (artifact_id, scope, key)
);

-- A person's own scope, across artifacts: for their account delete, and for reading their own data.
create index if not exists artifact_data_scope_idx on public.artifact_data (scope) where scope <> 'shared';

create table if not exists public.artifact_kits (
  project_id uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  head_sha   text not null,
  kit        jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists artifact_kits_user_idx on public.artifact_kits (user_id);

create or replace function public.artifact_add_version(
  p_artifact uuid, p_expected integer, p_kind text, p_body text, p_made_by text, p_note text, p_title text, p_paise integer
)
returns integer
language plpgsql
as $$
declare
  new_head integer;
begin
  update public.artifacts a
     set head_version = a.head_version + 1,
         title        = coalesce(p_title, a.title),
         spent_paise  = a.spent_paise + greatest(coalesce(p_paise, 0), 0),
         updated_at   = now()
   where a.id = p_artifact
     and a.head_version = p_expected
  returning a.head_version into new_head;

  -- The head moved (or the artifact is gone): nothing is written.
  if new_head is null then
    return null;
  end if;

  insert into public.artifact_versions (artifact_id, version, kind, body, made_by, note)
  values (p_artifact, new_head, p_kind, p_body, p_made_by, left(coalesce(p_note, ''), 300));
  return new_head;
end;
$$;

create or replace function public.artifact_add_spend(p_artifact uuid, p_paise integer)
returns void
language sql
as $$
  update public.artifacts
     set spent_paise = spent_paise + greatest(coalesce(p_paise, 0), 0)
   where id = p_artifact;
$$;

create or replace function public.artifact_data_put(p_artifact uuid, p_scope text, p_key text, p_value jsonb, p_max_keys integer)
returns text
language plpgsql
as $$
declare
  n integer;
begin
  -- Two writers in one scope count its keys one after the other.
  perform pg_advisory_xact_lock(hashtextextended(p_artifact::text || ':' || p_scope, 0));

  if exists (select 1 from public.artifact_data where artifact_id = p_artifact and scope = p_scope and key = p_key) then
    update public.artifact_data set value = p_value, updated_at = now()
     where artifact_id = p_artifact and scope = p_scope and key = p_key;
    return 'ok';
  end if;

  select count(*) into n from public.artifact_data where artifact_id = p_artifact and scope = p_scope;
  if n >= p_max_keys then
    return 'too_many';
  end if;

  insert into public.artifact_data (artifact_id, scope, key, value) values (p_artifact, p_scope, p_key, p_value);
  return 'ok';
end;
$$;

-- Only the server (the service key) may call them.
revoke all on function public.artifact_add_version(uuid, integer, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.artifact_add_version(uuid, integer, text, text, text, text, text, integer) to service_role;
revoke all on function public.artifact_add_spend(uuid, integer) from public, anon, authenticated;
grant execute on function public.artifact_add_spend(uuid, integer) to service_role;
revoke all on function public.artifact_data_put(uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.artifact_data_put(uuid, text, text, jsonb, integer) to service_role;

alter table public.artifacts          enable row level security;
alter table public.artifact_versions  enable row level security;
alter table public.artifact_data      enable row level security;
alter table public.artifact_kits      enable row level security;

drop policy if exists "users read own artifacts" on public.artifacts;
create policy "users read own artifacts"
  on public.artifacts for select
  using (auth.uid() = user_id);

drop policy if exists "users read own artifact versions" on public.artifact_versions;
create policy "users read own artifact versions"
  on public.artifact_versions for select
  using (exists (
    select 1 from public.artifacts a
    where a.id = artifact_versions.artifact_id and a.user_id = auth.uid()
  ));

-- The shared scope of an artifact they own, and their own scope wherever they saved. Never another person's scope.
drop policy if exists "users read own artifact data" on public.artifact_data;
create policy "users read own artifact data"
  on public.artifact_data for select
  using (
    scope = auth.uid()::text
    or (scope = 'shared' and exists (
      select 1 from public.artifacts a
      where a.id = artifact_data.artifact_id and a.user_id = auth.uid()
    ))
  );

drop policy if exists "users read own artifact kits" on public.artifact_kits;
create policy "users read own artifact kits"
  on public.artifact_kits for select
  using (auth.uid() = user_id);
