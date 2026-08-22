-- Push tokens the backend can target for notifications.
--
-- The client posts an Expo push token every launch. Each row is (user, platform)
-- so a device swap or reinstall naturally overwrites the same row. Old tokens
-- from previous devices go stale on Expo's side and their sends fail — we
-- clean them up lazily by only ever keeping the most recent per (user,
-- platform).

create table if not exists public.push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  token text not null,
  app_version text,
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);

-- Row-level security: users can only see and write their own tokens; server-side
-- code uses the service role and bypasses RLS to send pushes.
alter table public.push_tokens enable row level security;

create policy "own token select" on public.push_tokens
  for select using (auth.uid() = user_id);

create policy "own token upsert" on public.push_tokens
  for insert with check (auth.uid() = user_id);

create policy "own token update" on public.push_tokens
  for update using (auth.uid() = user_id);

create policy "own token delete" on public.push_tokens
  for delete using (auth.uid() = user_id);

create index if not exists push_tokens_user_idx on public.push_tokens(user_id);
