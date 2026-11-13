-- Tailzu — the mail bot (src/mail, mail-worker/, docs/mail.md): whose mail it is, for the push when mail needs a person.
--
-- mail_owners   one row a person with a business on the mail bot: their id, and the hash the mail worker knows their account by
--               ("mail:" and 32 hex characters, src/mail/worker.ts ownerOf). The worker never learns the id: when it says mail needs a
--               person it names the hash, and this row is how the push finds that person's phone.
--
-- Written and read by the server with the service key only: row level security is on and there is no policy, so no token reads or writes
-- it. The row goes with the account (on delete cascade, and routes/account/account.ts).
--
-- Run in your Supabase SQL editor after 0079. It can be run again. Without it the server keeps these in memory, and a restart forgets
-- them (the mail still arrives and waits on the page; only the push is missed).

create table if not exists public.mail_owners (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  owner      text not null unique check (owner ~ '^mail:[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);

alter table public.mail_owners enable row level security;
