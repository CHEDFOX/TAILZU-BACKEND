-- Tailzu — Keybot's own choices (src/keybot/prefs.ts): what the Keybot pages of the Bots app let a person pick that has no field in their
-- personality: the tone for each kind of app and its little things, read-aloud speed and when to read, the phone keyboard's look and feel,
-- and the Teach-your-style round (what they said for each of the ten lines).
--
-- Run in your Supabase SQL editor. It needs nothing from the other migrations and can be run again. Without it the server keeps these in
-- memory and a restart forgets them.
--
-- keybot_prefs  one row per person: the document as JSON. Written by the server through the person's own token (or the service key), like
--               personalities; a person reads and writes only their own row. The row goes with the account.

create table if not exists public.keybot_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.keybot_prefs enable row level security;

drop policy if exists "users manage own keybot prefs" on public.keybot_prefs;
create policy "users manage own keybot prefs"
  on public.keybot_prefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
