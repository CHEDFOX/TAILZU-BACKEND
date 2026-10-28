-- Tailzu — Spaces for family and friends (src/botsBots/{spaces,spacePerms,shared,payments,threads,mail}.ts, routes/botsSpaces.ts):
-- what each person may do in a space, invites by link or email, the space's own roles and activity, shared things, payment requests,
-- messaging between people who share a space, and the email outbox.
--
-- Run in your Supabase SQL editor after 0042_bots_area.sql. It can be run again. Without it these rows live in memory and a restart forgets them.
--
-- space_members   + perms (what they may do, a jsonb list of names: invite, remove, manage, share, bots, addBots, tasks, plan, approve, askPay,
--                   message, groups, activity, rename) and role ("family", "kid", "guest", one of space_roles' ids, or null: just for them). The
--                   space's maker (spaces.owner_id) is its admin and may do everything, whatever the row says. can_approve follows perms.
-- space_invites   + email (an invite bound to one address: only an account signed in with it can accept, once), perms and role (what
--                   joining gives), used_by / used_ms (who accepted an email invite). A link invite has no email and works for anyone with it.
-- space_roles     a space's own named roles, made by its admin
-- space_activity  who joined, left, shared, asked, approved and paid (kept to the last 200 a space)
-- space_items     a thing shared to a space (space_id) or to one person (thread_id: their chat): kind, title, a snapshot (data), view or edit
-- space_payments  a request to pay someone by UPI, and its answer. Nothing here pays: an approver pays in their own UPI app.
-- space_tasks     a task given to one or more members (due day and time, place), or something put on their day ("plan for others", shown
--                 on their Plan as "From <name>"); states holds each person's done / can't do it (with a note)
-- threads         a chat: one to one (direct_key = the two user ids, sorted), a group made from a space's people, or a space's own chat
-- thread_members  who is in a chat, their unread count, muted, and when they left (a group)
-- thread_messages words, files (refs to the sender's own files: media_items ids; served only by a signed link to someone in the chat)
--                 and a shared thing's card
-- mail_outbox     emails waiting to go (an invite); sent by the server's mail job once a provider is plugged in (src/botsBots/mail.ts)
--
-- Written and read by the server with the service key only: row-level security is on with no policies, so no person reads these
-- directly (every permission is checked by the server). Times are epoch milliseconds.

-- The first run adds the columns and gives members from before permissions Family, and approving where they could (the maker may do
-- everything anyway). A later run changes no one: a member who was given nothing keeps nothing.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'space_members' and column_name = 'perms') then
    alter table public.space_members add column perms jsonb not null default '[]'::jsonb;
    alter table public.space_members add column role text;
    update public.space_members
       set perms = '["invite","share","bots","addBots","tasks","plan","askPay","message","groups","activity"]'::jsonb
                   || case when can_approve then '["approve"]'::jsonb else '[]'::jsonb end,
           role  = case when can_approve then null else 'family' end;
  end if;
end $$;
do $$ begin
  alter table public.space_members add constraint space_members_perms_list check (jsonb_typeof(perms) = 'array' and jsonb_array_length(perms) <= 24);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.space_members add constraint space_members_role_len check (role is null or char_length(role) between 1 and 40);
exception when duplicate_object then null; end $$;
create index if not exists space_members_role_idx on public.space_members (space_id, role) where role is not null;

-- The same for invites: those from before permissions gave Family.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'space_invites' and column_name = 'perms') then
    alter table public.space_invites add column email   text;
    alter table public.space_invites add column perms   jsonb not null default '[]'::jsonb;
    alter table public.space_invites add column role    text;
    alter table public.space_invites add column used_by uuid references auth.users (id) on delete set null;
    alter table public.space_invites add column used_ms bigint;
    update public.space_invites set role = 'family';
  end if;
end $$;
do $$ begin
  alter table public.space_invites add constraint space_invites_email_ok check (email is null or (char_length(email) between 3 and 254 and email = lower(email)));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.space_invites add constraint space_invites_perms_list check (jsonb_typeof(perms) = 'array' and jsonb_array_length(perms) <= 24);
exception when duplicate_object then null; end $$;
create index if not exists space_invites_creator_idx on public.space_invites (created_by, created_ms desc);

create table if not exists public.space_roles (
  id         uuid primary key,
  space_id   uuid not null references public.spaces (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  perms      jsonb not null default '[]'::jsonb check (jsonb_typeof(perms) = 'array' and jsonb_array_length(perms) <= 24),
  created_ms bigint not null
);
create index if not exists space_roles_space_idx on public.space_roles (space_id, created_ms);

create table if not exists public.space_activity (
  id       uuid primary key,
  space_id uuid not null references public.spaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind     text not null check (char_length(kind) between 1 and 32),
  text     text not null check (char_length(text) <= 300),
  at_ms    bigint not null
);
create index if not exists space_activity_space_idx on public.space_activity (space_id, at_ms desc);

create table if not exists public.threads (
  id         uuid primary key,
  kind       text not null check (kind in ('direct', 'group', 'space')),
  space_id   uuid references public.spaces (id) on delete cascade,
  name       text not null default '' check (char_length(name) <= 40),
  direct_key text unique check (direct_key is null or char_length(direct_key) <= 80),
  created_by uuid references auth.users (id) on delete set null,
  created_ms bigint not null,
  last_ms    bigint not null,
  last_text  text not null default '' check (char_length(last_text) <= 140),
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind = 'direct' or space_id is not null)
);
create unique index if not exists threads_one_space_chat on public.threads (space_id) where kind = 'space';
create index if not exists threads_space_idx on public.threads (space_id);

create table if not exists public.thread_members (
  thread_id    uuid not null references public.threads (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null default '' check (char_length(name) <= 40),
  joined_ms    bigint not null,
  last_read_ms bigint not null default 0,
  unread       integer not null default 0 check (unread >= 0),
  muted        boolean not null default false,
  left_ms      bigint,
  primary key (thread_id, user_id)
);
create index if not exists thread_members_user_idx on public.thread_members (user_id);

create table if not exists public.thread_messages (
  id          uuid primary key,
  thread_id   uuid not null references public.threads (id) on delete cascade,
  sender_id   uuid references auth.users (id) on delete set null,
  sender_name text not null default '' check (char_length(sender_name) <= 40),
  text        text not null default '' check (char_length(text) <= 4000),
  files       jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 6),
  item        jsonb check (item is null or jsonb_typeof(item) = 'object'),
  at_ms       bigint not null
);
create index if not exists thread_messages_thread_idx on public.thread_messages (thread_id, at_ms desc);

create table if not exists public.space_items (
  id          uuid primary key,
  space_id    uuid references public.spaces (id) on delete cascade,
  thread_id   uuid references public.threads (id) on delete cascade,
  kind        text not null check (kind in ('list', 'trip', 'plan', 'note', 'file', 'link', 'answer', 'preview', 'text')),
  title       text not null check (char_length(title) between 1 and 120),
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  access      text not null check (access in ('view', 'edit')),
  shared_by   uuid not null references auth.users (id) on delete cascade,
  shared_name text not null default '' check (char_length(shared_name) <= 40),
  created_ms  bigint not null,
  updated_ms  bigint not null,
  updated_by  uuid references auth.users (id) on delete set null,
  check (space_id is not null or thread_id is not null)
);
create index if not exists space_items_space_idx on public.space_items (space_id, updated_ms desc);
create index if not exists space_items_thread_idx on public.space_items (thread_id);

create table if not exists public.space_payments (
  id           uuid primary key,
  space_id     uuid not null references public.spaces (id) on delete cascade,
  asked_by     uuid not null references auth.users (id) on delete cascade,
  asked_name   text not null default '' check (char_length(asked_name) <= 40),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 10000000),
  payee_name   text not null check (char_length(payee_name) between 1 and 80),
  payee_vpa    text not null check (char_length(payee_vpa) between 3 and 320),
  note         text not null default '' check (char_length(note) <= 120),
  status       text not null check (status in ('waiting', 'approved', 'declined', 'paid', 'cancelled')),
  decided_by   uuid references auth.users (id) on delete set null,
  decided_name text not null default '' check (char_length(decided_name) <= 40),
  decided_ms   bigint,
  paid_ms      bigint,
  created_ms   bigint not null
);
create index if not exists space_payments_space_idx on public.space_payments (space_id, created_ms desc);
create index if not exists space_payments_waiting_idx on public.space_payments (space_id) where status = 'waiting';

create table if not exists public.space_tasks (
  id         uuid primary key,
  space_id   uuid not null references public.spaces (id) on delete cascade,
  kind       text not null check (kind in ('task', 'plan')),
  title      text not null check (char_length(title) between 1 and 120),
  notes      text not null default '' check (char_length(notes) <= 1000),
  assignees  jsonb not null check (jsonb_typeof(assignees) = 'array' and jsonb_array_length(assignees) between 1 and 20),
  states     jsonb not null default '{}'::jsonb check (jsonb_typeof(states) = 'object'),
  set_by     uuid not null references auth.users (id) on delete cascade,
  set_name   text not null default '' check (char_length(set_name) <= 40),
  at_ms      bigint,
  end_ms     bigint,
  all_day    boolean not null default false,
  place      text not null default '' check (char_length(place) <= 80),
  created_ms bigint not null,
  updated_ms bigint not null
);
create index if not exists space_tasks_space_idx on public.space_tasks (space_id, created_ms desc);

create table if not exists public.mail_outbox (
  id         uuid primary key,
  to_email   text not null check (char_length(to_email) between 3 and 254),
  subject    text not null check (char_length(subject) <= 200),
  body_text  text not null check (char_length(body_text) <= 20000),
  body_html  text check (body_html is null or char_length(body_html) <= 60000),
  kind       text not null check (char_length(kind) between 1 and 40),
  ref        text not null default '' check (char_length(ref) <= 80),
  status     text not null check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts   integer not null default 0 check (attempts >= 0),
  last_error text not null default '' check (char_length(last_error) <= 300),
  created_ms bigint not null,
  next_ms    bigint not null,
  sent_ms    bigint
);
create index if not exists mail_outbox_due_idx on public.mail_outbox (status, next_ms) where status = 'queued';
create index if not exists mail_outbox_ref_idx on public.mail_outbox (kind, ref);

alter table public.space_roles     enable row level security;
alter table public.space_activity  enable row level security;
alter table public.threads         enable row level security;
alter table public.thread_members  enable row level security;
alter table public.thread_messages enable row level security;
alter table public.space_items     enable row level security;
alter table public.space_payments  enable row level security;
alter table public.space_tasks     enable row level security;
alter table public.mail_outbox     enable row level security;
