-- Tailzu — notes. The desktop's note-taker: a hotkey, the room's audio (the
-- microphone and the computer's own sound), and what was said kept here,
-- organised. Nothing is ever typed into another app from it.
--
-- One row per note. The transcript arrives a stretch at a time while it
-- records (transcript, appended); the organised body is written once when it
-- stops (title, summary, body). The audio itself is never stored.
--
-- Run in your Supabase SQL editor after 0001–0013 (or use full_schema.sql).

create table if not exists public.notes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  status            text not null default 'recording'
                    check (status in ('recording', 'organising', 'ready', 'failed')),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_seconds  numeric not null default 0,
  words             integer not null default 0,
  title             text not null default '',
  summary           text not null default '',
  -- { sections: [{heading, points[]}], decisions[], actions: [{text, owner?, due?}], questions[] }
  body              jsonb not null default '{}'::jsonb,
  tags              text[] not null default '{}',
  -- [{ at: seconds from start, text }], in order
  transcript        jsonb not null default '[]'::jsonb,
  organised         boolean not null default false,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists notes_user_live_idx
  on public.notes (user_id, started_at desc)
  where deleted_at is null;

alter table public.notes enable row level security;

-- The server writes with the service key; these keep a user's own token to
-- their own rows if it is ever used directly.
drop policy if exists "users read own notes" on public.notes;
create policy "users read own notes"
  on public.notes for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "users insert own notes" on public.notes;
create policy "users insert own notes"
  on public.notes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own notes" on public.notes;
create policy "users update own notes"
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
