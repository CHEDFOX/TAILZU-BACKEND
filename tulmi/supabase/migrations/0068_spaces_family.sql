-- Tailzu — Spaces, the family redesign (src/botsBots/{spaces,spaceJoin,spaceFeed,grants,work}.ts, routes/bots/{botsSpaces,work}.ts):
-- one standing code per space, drafts while Call Your People runs, invitations waiting for the invited email, join requests the
-- admin lets in, the line every member saw about the admin, messages to one person, things shared from a bot, and notes on them.
--
-- spaces              + join_code (the space's own code: 6 letters and digits, shown 7KQ-29D; the server makes it the first time it is
--                     asked for), draft_ms (set while its maker is still calling their people: shown to nobody else), named (false
--                     while a draft has no name of its own yet)
-- space_members       + consent_ms (when they saw "The space's admin can see your work and messages there."; null: not yet, so the
--                     admin sees only what they share)
-- space_invites       + dismissed_ms (the invited person said no), and an index on email (their invitations)
-- space_join_requests someone with the code, on an account whose email wasn't invited: the admin lets them in, or not (code: what
--                     they typed, which their waiting line shows instead of the space's name)
-- thread_messages     + to_id / to_name (a message to one person: only they, its sender and the space's admin see it). No foreign key
--                     on to_id on purpose: "on delete set null" would turn a private message into one for everyone.
-- threads             + last_public_ms (when last_text, a line for everyone, was written: what lists show)
-- space_grants        one thing from a person's bot (plan, notes, travel, code), shared with one person (to_id) or everyone (null)
-- space_work_notes    a note someone who may work on a thing added to it (only_owner: added through a share to one person, so only
--                     the owner, its writer and the space's admin read it)
-- mail_outbox         + sent_by (who an invite mail went out for: the 30-a-day cap counts these rows, which outlive a deleted draft)
--
-- Roles are gone from the app; their columns and space_roles stay (nothing reads them) so this can be rolled back. Written and read
-- by the server with the service key only: row-level security on, no policies. Times are epoch milliseconds. Safe to run again.

alter table public.spaces add column if not exists join_code text;
alter table public.spaces add column if not exists draft_ms bigint;
alter table public.spaces add column if not exists named boolean not null default true;
do $$ begin
  alter table public.spaces add constraint spaces_join_code_ok check (join_code is null or join_code ~ '^[A-Z0-9]{6}$');
exception when duplicate_object then null; end $$;
create unique index if not exists spaces_join_code_idx on public.spaces (join_code) where join_code is not null;
create index if not exists spaces_draft_idx on public.spaces (owner_id) where draft_ms is not null;

alter table public.space_members add column if not exists consent_ms bigint;

alter table public.space_invites add column if not exists dismissed_ms bigint;
-- Only "email is not null" in the predicate: the invitations read asks "email = x" alone (used ones are dropped after), and an index
-- that also required "used_by is null" could not serve that read.
create index if not exists space_invites_email_idx on public.space_invites (email) where email is not null;

create table if not exists public.space_join_requests (
  id         uuid primary key,
  space_id   uuid not null references public.spaces (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  consent_ms bigint,
  status     text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  created_ms bigint not null,
  decided_ms bigint,
  decided_by uuid references auth.users (id) on delete set null,
  code       text not null default '' check (char_length(code) <= 16)
);
alter table public.space_join_requests add column if not exists code text not null default '';
create unique index if not exists space_join_requests_open on public.space_join_requests (space_id, user_id) where status = 'open';
create index if not exists space_join_requests_space on public.space_join_requests (space_id, status);
create index if not exists space_join_requests_user on public.space_join_requests (user_id, created_ms desc);
alter table public.space_join_requests enable row level security;

alter table public.thread_messages add column if not exists to_id uuid;
alter table public.thread_messages add column if not exists to_name text not null default '';
do $$ begin
  alter table public.thread_messages add constraint thread_messages_to_name_len check (char_length(to_name) <= 40);
exception when duplicate_object then null; end $$;
create index if not exists thread_messages_to_idx on public.thread_messages (thread_id, to_id) where to_id is not null;

-- threads.last_public_ms: when threads.last_text was written. last_ms stays the messages' own clock (a message to one person moves
-- it too); lists show last_public_ms, so a message to one person never moves anyone else's chat. Null on rows from before: read
-- last_ms then.
alter table public.threads add column if not exists last_public_ms bigint;

create table if not exists public.space_grants (
  id         uuid primary key,
  space_id   uuid not null references public.spaces (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  bot        text not null check (bot in ('plan', 'notes', 'travel', 'code')),
  item_id    text not null check (char_length(item_id) between 1 and 200),
  title      text not null check (char_length(title) between 1 and 120),
  line       text not null default '' check (char_length(line) <= 120),
  to_id      uuid references auth.users (id) on delete cascade,
  message_id uuid,
  created_ms bigint not null
);
create index if not exists space_grants_space on public.space_grants (space_id, bot);
create index if not exists space_grants_owner on public.space_grants (owner_id, bot);
create index if not exists space_grants_to on public.space_grants (to_id) where to_id is not null;
alter table public.space_grants enable row level security;

create table if not exists public.space_work_notes (
  id       uuid primary key,
  space_id uuid not null references public.spaces (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  bot      text not null check (bot in ('plan', 'notes', 'travel', 'code')),
  item_id  text not null check (char_length(item_id) between 1 and 200),
  by_id    uuid references auth.users (id) on delete set null,
  by_name  text not null check (char_length(by_name) between 1 and 40),
  text     text not null check (char_length(text) between 1 and 1000),
  at_ms    bigint not null,
  only_owner boolean not null default false
);
alter table public.space_work_notes add column if not exists only_owner boolean not null default false;
create index if not exists space_work_notes_item on public.space_work_notes (owner_id, bot, item_id, at_ms desc);
create index if not exists space_work_notes_space on public.space_work_notes (space_id);
alter table public.space_work_notes enable row level security;

-- Invite mails, by who they went out for. No foreign key: the count must outlive anything, and nothing else reads it.
alter table public.mail_outbox add column if not exists sent_by uuid;
create index if not exists mail_outbox_sent_by_idx on public.mail_outbox (kind, sent_by, created_ms desc) where sent_by is not null;
