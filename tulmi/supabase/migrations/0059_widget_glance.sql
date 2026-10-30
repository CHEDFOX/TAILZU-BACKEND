-- Tailzu — the X0 widget: what it remembers per person, and the "Bots at work" Live Activity's push tokens (src/widgets/glanceStore.ts;
-- routes/botsShell.ts GET /v1/shell/glance?v=2, routes/widgets.ts POST /v1/widgets/activity-token; docs/widget-glance-v2.md).
--
-- Run in your Supabase SQL editor before the X0 widget ships. It needs nothing from the other migrations. It can be run again.
-- Without it both are kept in memory: a restart forgets what the person has seen (the widget then shows the last finished job until it is
-- opened) and the Live Activity tokens (the activity is then updated by the app alone until it registers its token again).
--
-- widget_glance            one row per person: what they have seen of what finished (one time per thing, and "everything before"), when
--                          they last glanced and where their look before ended (the summary's "since you last looked"), and the AI
--                          digest's line for one set of changes (WIDGET_DIGEST). No words of a private question are ever kept here.
-- widget_activity_tokens   one row per person and Code bot job: the Live Activity's APNs push token (the app registers it), its APNs
--                          environment, whether the app speaks Hinglish (the server's fill-in lines), and a signature of the state last
--                          pushed. Deleted when the job ends or Apple says it is gone.
--
-- Written by the server with the service key only. No policy: a person's own token can neither read nor write either table.
-- Rows go with the account.

create table if not exists public.widget_glance (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.widget_glance enable row level security;

create table if not exists public.widget_activity_tokens (
  user_id     uuid not null references auth.users (id) on delete cascade,
  job_id      text not null check (job_id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  token       text not null check (token ~ '^[0-9a-f]{32,512}$'),
  env         text not null default 'production' check (env in ('production', 'sandbox')),
  hg          boolean not null default false,
  sent        text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table public.widget_activity_tokens enable row level security;
