-- Tailzu — an ask typed offline goes out once (src/shell/sentAsks.ts, routes/botsShell.ts POST /v1/shell/ask, docs/bots-app.md "Offline").
--
-- Run in your Supabase SQL editor before turning BOTS_APP on. It needs nothing from the other migrations. It can be run again. Without it the
-- ids are kept in memory and a restart forgets them (a retry of an ask that was answered just before a restart could then be answered twice).
--
-- bots_app_sent_asks  one row per ask the apps sent with a client id (made on the device when the ask was typed, kept in its outbox):
--                     state 'sending' while the ask runs, 'sent' with the answer (32 KB at most) once it was answered, so a retry of the
--                     same id gets that answer instead of asking again. A failed ask's row is deleted, so trying again does try again.
--                     Rows older than 30 days are deleted the next time the person sends one.
--
-- Written by the server with the service key only. No policy: a person's own token can neither read nor write it. Rows go with the account.

create table if not exists public.bots_app_sent_asks (
  user_id     uuid not null references auth.users (id) on delete cascade,
  client_id   text not null check (client_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  state       text not null check (state in ('sending', 'sent')),
  typed_at    timestamptz,
  claimed_at  timestamptz not null default now(),
  reply       jsonb,
  primary key (user_id, client_id)
);

create index if not exists bots_app_sent_asks_age_idx on public.bots_app_sent_asks (user_id, claimed_at);

alter table public.bots_app_sent_asks enable row level security;
