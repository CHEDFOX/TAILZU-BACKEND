-- Tailzu — the cinema bot's 3D (src/cinema/scene, docs/cinema-3d.md): a scene built as data, rendered by Blender, looked at and built again.
--
-- cinema_scenes  one row a CREATION, which is a thing a person made and can come back to, not a job. It holds what they asked for, which
--                version this is, where it stands, why it stopped, what the models spent, and the media keys of the four things a round can
--                keep: the script (the asset — kilobytes, and enough to make everything else again), the preview a person sees in a list,
--                and the full render and the .blend, which are only kept when someone asks for them.
--
-- A creation's files are blobs in R2 under c/<person>/<creation>/v<n>/ (scene/ports.ts creationKey): one person's key can never name
-- another's, and a version never writes over the one before it. These rows only name them. Written and read by the server with the service
-- key only: row level security is on and there is no policy, so no token reads or writes them. Rows go with the account (on delete
-- cascade), and the server deletes the blobs as the account goes.
--
-- Run after 0103. It can be run again. Without it the server keeps these in memory, and a restart forgets them.

create table if not exists public.cinema_scenes (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The creation this is a version of: the key its blobs are under, stable across versions.
  creation    text not null check (char_length(creation) between 1 and 60),
  version     integer not null default 1 check (version between 1 and 999),
  ask         text not null check (char_length(ask) <= 4000),
  status      text not null check (status in ('working', 'done', 'failed')),
  -- Made.why (scene/make.ts): why the loop stopped, once it has.
  why         text check (why in ('done', 'rounds', 'budget', 'render', 'model')),
  rounds      integer not null default 0 check (rounds >= 0),
  objects     integer not null default 0 check (objects >= 0),
  -- The media keys that were kept, by name: script, preview, final, blend. Only the ones a round actually kept.
  kept        jsonb not null default '{}'::jsonb,
  -- image/png for a still, video/mp4 for a clip, once a real render was made.
  mime        text,
  paise       integer not null default 0 check (paise >= 0),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A person's own list, newest first.
create index if not exists cinema_scenes_user_updated on public.cinema_scenes (user_id, updated_at desc);
-- One creation's versions, and the uniqueness that stops a version writing over the one before it.
create unique index if not exists cinema_scenes_creation_version on public.cinema_scenes (user_id, creation, version);
-- The ones still going, for a restart to find and fail honestly.
create index if not exists cinema_scenes_working on public.cinema_scenes (status, updated_at) where status = 'working';

alter table public.cinema_scenes enable row level security;
