-- Tailzu — Delete account with seven days to change your mind (src/you/deletion.ts, routes/accountDeletion.ts, docs/bots-app.md).
--
-- Run in your Supabase SQL editor before the Bots app's Delete account is used. It needs nothing from the other migrations and can be
-- run again. Without it nobody can be scheduled (the write fails and the app says "Couldn't delete the account. Try again."); DELETE
-- /v1/account, which deletes at once, works as before.
--
-- account_deletions  one row per person who asked to delete their account: when they asked, and the day it is deleted for good (seven
--                    days later). Pressing Keep my account deletes the row. On the day a sweep on the server claims the row
--                    (claimed_at, so two servers never work on one person), deletes everything the account holds and then the account,
--                    and the row goes with it (on delete cascade). A delete that did not finish keeps the row, notes why (last_error,
--                    never a person's words) and is tried again half an hour later.
--
-- Written by the server with the service key only. OWNER-ONLY: a person's own token can READ their own row and nothing else; there is
-- no policy that lets a token write.

create table if not exists public.account_deletions (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  delete_at    timestamptz not null,
  claimed_at   timestamptz,
  last_error   text check (last_error is null or char_length(last_error) <= 200)
);

create index if not exists account_deletions_due_idx on public.account_deletions (delete_at);

alter table public.account_deletions enable row level security;

drop policy if exists "users read own account deletion" on public.account_deletions;
create policy "users read own account deletion"
  on public.account_deletions for select
  using (auth.uid() = user_id);
