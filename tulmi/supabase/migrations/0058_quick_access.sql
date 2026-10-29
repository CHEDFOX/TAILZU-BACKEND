-- Tailzu — quick access from outside the app: the widgets' own narrow token, and answering once (src/widgets/token.ts, act.ts;
-- routes/widgets.ts; docs/widgets.md).
--
-- Run in your Supabase SQL editor before turning the widgets on. It needs nothing from the other migrations. It can be run again.
-- Without it both are kept in memory: a restart forgets every widget token (the widgets say "Open X0 Bot to finish" until the app
-- next opens and asks for a new one) and the answers already given (a retry just after a restart could then run twice; every
-- answer is safe to run twice except a reply, which the app's key then guards only in memory).
--
-- widget_tokens   one row per token the app asked for (POST /v1/widgets/token): whose, which phone (its install id), what it may do
--                 (needs.answer, task.done), when it runs out and when it was revoked. Only the SHA-256 of the token is kept; the token
--                 itself is in the answer to the phone and nowhere else. A new token for the same phone revokes its last; past
--                 widgets.token.maxPerUser the oldest is revoked; DELETE /v1/widgets/token (sign-out) revokes the phone's or all.
--                 Rows a month past running out are deleted the next time the person revokes one.
-- quick_actions   one row per answer given from a widget or a notification (POST /v1/widgets/act), by its key (the app's own, or the
--                 item and the button): 'sending' while it runs, 'sent' with what was answered, so a retry gets that answer instead of
--                 doing it again. A failed answer's row is deleted, so trying again does try again. Kept seven days.
--
-- Written by the server with the service key only. No policy: a person's own token can neither read nor write either table.
-- Rows go with the account.

create table if not exists public.widget_tokens (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  device        text not null check (device ~ '^[A-Za-z0-9_-]{8,64}$'),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_used_at  timestamptz
);

create index if not exists widget_tokens_user_idx on public.widget_tokens (user_id, created_at desc);

alter table public.widget_tokens enable row level security;

create table if not exists public.quick_actions (
  user_id     uuid not null references auth.users (id) on delete cascade,
  key         text not null check (key ~ '^[A-Za-z0-9_.:|-]{1,320}$'),
  state       text not null check (state in ('sending', 'sent')),
  claimed_at  timestamptz not null default now(),
  reply       jsonb,
  primary key (user_id, key)
);

create index if not exists quick_actions_age_idx on public.quick_actions (user_id, claimed_at);

alter table public.quick_actions enable row level security;
