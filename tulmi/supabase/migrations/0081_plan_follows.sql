-- Tailzu — Plan Ease follow-through (src/botsBots/planFollow.ts, planFollowStore.ts; docs/plan-ease.md "Follow-through").
--
-- Every must-not-miss item, and every item with someone else on it, becomes a job that is not finished until someone says it's done:
-- a push at its time, then for a must item a louder push, "X0 is calling", a real phone call for someone who turned that on for their
-- own number, and telling the next person. Everyone on an item has X0 and is someone the asker is connected with in X0, by exactly the
-- rules messaging uses (a space they share in which the asker may message, no block either way, Spaces on): checked when the item is
-- saved and again before every reach. Nobody without X0 is ever messaged or called.
--
-- calendar_tasks / calendar_events, two new columns
--   importance         null (the rules decide: medicine, a pickup, a bill due today, a flight) | normal | must (the person said)
--   people             who does it, in order: [{ k: "u", id }] (X0 users); the first is Who, the rest "if they can't"; empty means the
--                      person themselves
--
-- plan_numbers         the number an asker keeps for someone on their items, sealed: only the asker's own Call button (tel: from the
--                      asker's phone). X0 never messages or dials it. Gone with the asker's account, and with the account of the person
--                      it is for (member_id references auth.users on delete cascade)
--
-- plan_follows         one followed occurrence
--   item, source_key   the item ("pt:<id>", "pe:<ref>:<day>", "stask:<space>:<task>") and the occurrence ("<item>@<due day or start>"):
--                      unique per asker, so a second server or a second tick never follows it twice
--   kind, title, place the item as it was armed (the raw title is the server's only: never in a push as it is)
--   importance, why    normal | must as decided when armed; medicine | pickup | bill_today | flight | set (the person said)
--   due_ms, day, tz_min   the item's own time, its day, the offset its words are written in
--   people, holder, holder_key   who is on it, as armed ([{ k: "u", id, name }]), and who holds it now
--   cant, told, answers   who said can't (or was skipped: not in the asker's X0 people now), who was told, every answer [{ by, verb, via,
--                      at, n }] (20 at most)
--   state              open | snoozed | told | nobody | done | missed | dropped
--   rung, n, laters    the last rung taken (line | push | loud | call | phone | tell), the climb (+1 on each Later, hand-over or take)
--   base_ms, climb_ms  when this climb started, and when its louder steps start (a bill: 6 pm)
--   next_ms            when the sweep acts next; null when nothing is due
--   done_by, done_via, done_ms   who said done, how (app | call | ring | item), when
--
-- plan_follow_steps    what was sent to whom, one row per (follow, n, rung, person): never the same reminder twice, and the asker's view
--   channel            push | ring (X0 is calling, in the app) | phone (a real phone call)
--   state, why         sent | failed | skipped | opened | answered | no_answer, and why a step was skipped
--   ext                the push_log id, plan_calls id or the phone call's id its later news comes back with
--
-- plan_reach_caps      the day's louder pings and calls per person, real calls per person, per asker and for the server, shared by every
--                      server
-- plan_phones          a person's own number for real phone calls, which they turned on themselves in What pings you (off by default):
--                      sealed, a keyed hash to find it, when it was proved theirs, and when they said stop. The proving call types the
--                      short code the setup screen shows (pending_code, sealed), so one call proves exactly one account; a proved
--                      number is on one account only (a fresh proof moves it, plan_phones_hash_one)
-- plan_phone_stops     numbers whose owner pressed 9 (keyed hash): no real call to them from any account, adding them again never lifts
--                      it, only a fresh proving call from that number does
-- plan_calls.source    gains 'follow': "X0 is calling" may ring for a followed item too
--
-- Clean-up (the follow sweep, hourly): closed follows not updated for 90 days (their steps go with them), caps older than 3 days.
-- Written by the server with the service key only.
--
-- Run in your Supabase SQL editor. It needs 0054, 0074 and 0079 and can be run again.

-- ---------------------------------------------------------------- the item's own parts
alter table public.calendar_tasks  add column if not exists importance text;
alter table public.calendar_tasks  add column if not exists people jsonb not null default '[]'::jsonb;
alter table public.calendar_events add column if not exists importance text;
alter table public.calendar_events add column if not exists people jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.calendar_tasks add constraint calendar_tasks_importance check (importance is null or importance in ('normal', 'must'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.calendar_events add constraint calendar_events_importance check (importance is null or importance in ('normal', 'must'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- the asker's numbers for their Call button
create table if not exists public.plan_numbers (
  user_id     uuid not null references auth.users (id) on delete cascade,   -- the asker
  member_id   uuid not null,          -- the X0 user it is for (someone in the asker's X0 people when it was saved); see the key below
  seal        text not null,          -- the number the asker typed, sealed: only for the asker's own Call button
  updated_ms  bigint not null,
  primary key (user_id, member_id)
);
-- The person it is for deleting their account takes every number others kept for them. Rows for an account already gone go first, so
-- the key can be added; added once (a second run finds it).
delete from public.plan_numbers n where not exists (select 1 from auth.users u where u.id = n.member_id);
do $$ begin
  alter table public.plan_numbers add constraint plan_numbers_member_fk foreign key (member_id) references auth.users (id) on delete cascade;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- one followed occurrence
create table if not exists public.plan_follows (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,  -- the asker: whose item it is
  item        text not null,            -- "pt:<id>", "pe:<ref>:<day>", "stask:<space>:<task>"
  source_key  text not null,            -- the occurrence: "<item>@<due day or start ms>"; unique per asker
  kind        text not null,            -- todo | due | event | ask
  title       text not null,            -- the raw title (server only: never in a push as it is)
  place       text not null default '',
  importance  text not null,            -- normal | must, as decided when armed
  why         text,                     -- medicine | pickup | bill_today | flight | set (the person said) | null
  due_ms      bigint,                   -- the item's own time, when it has one
  day         text not null,            -- YYYY-MM-DD of the occurrence
  tz_min      smallint not null,
  people      jsonb not null,           -- [{ k, id, name, s? }] in order, as armed
  holder      smallint not null default 0,
  holder_key  text not null,            -- "u:<id>" of people[holder]
  cant        jsonb not null default '[]'::jsonb,   -- person keys who said can't, or were skipped (not in the asker's X0 people now)
  told        jsonb not null default '[]'::jsonb,   -- person keys told
  answers     jsonb not null default '[]'::jsonb,   -- [{ by, verb, via, at, n }], 20 at most
  state       text not null,            -- open | snoozed | told | nobody | done | missed | dropped
  rung        text not null,            -- line | push | loud | call | phone | tell: the last one taken
  n           smallint not null default 1,          -- the climb: +1 on each Later, hand-over or take
  laters      smallint not null default 0,
  base_ms     bigint not null,          -- when this climb started
  climb_ms    bigint not null,          -- when its loud steps start (a bill: 6 pm)
  next_ms     bigint,                   -- when the sweep acts next; null when nothing is due
  done_by     jsonb,
  done_via    text,
  done_ms     bigint,
  created_ms  bigint not null,
  updated_ms  bigint not null
);
do $$ begin
  alter table public.plan_follows add constraint plan_follows_source_key unique (user_id, source_key);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_follows add constraint plan_follows_state check (state in ('open', 'snoozed', 'told', 'nobody', 'done', 'missed', 'dropped'));
exception when duplicate_object then null; end $$;
-- Dropped and added again, so a run of an earlier draft of this file (without 'phone') is put right.
alter table public.plan_follows drop constraint if exists plan_follows_rung;
alter table public.plan_follows add constraint plan_follows_rung check (rung in ('line', 'push', 'loud', 'call', 'phone', 'tell'));
do $$ begin
  alter table public.plan_follows add constraint plan_follows_importance check (importance in ('normal', 'must'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_follows add constraint plan_follows_kind check (kind in ('todo', 'due', 'event', 'ask'));
exception when duplicate_object then null; end $$;
create index if not exists plan_follows_due_idx    on public.plan_follows (next_ms) where state in ('open', 'snoozed', 'told', 'nobody') and next_ms is not null;
create index if not exists plan_follows_holder_idx on public.plan_follows (holder_key) where state in ('open', 'snoozed', 'told');
create index if not exists plan_follows_user_idx   on public.plan_follows (user_id, updated_ms desc);
create index if not exists plan_follows_item_idx   on public.plan_follows (user_id, item, created_ms desc);

-- ---------------------------------------------------------------- what was sent, for "never twice" and the asker's view
create table if not exists public.plan_follow_steps (
  id         uuid primary key,
  follow_id  uuid not null references public.plan_follows (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  n          smallint not null,
  rung       text not null,     -- push | loud | call | phone | tell
  person     text not null,     -- "u:<id>"
  channel    text not null,     -- push | ring | phone
  state      text not null,     -- sent | failed | skipped | opened | answered | no_answer
  why        text,              -- skipped or failed: gone | muted | quiet | cap | off | no_phone | no_number | no_optin | late | busy |
                                -- not_sent | abroad | day_max | too_soon | desk | called | stopped | leave_by
  ext        text,              -- push_log id | plan_calls id | the phone call's id
  at_ms      bigint not null,
  seen_ms    bigint
);
do $$ begin
  alter table public.plan_follow_steps add constraint plan_follow_steps_once unique (follow_id, n, rung, person);
exception when duplicate_object then null; end $$;
create index if not exists plan_follow_steps_follow_idx on public.plan_follow_steps (follow_id, at_ms);
create index if not exists plan_follow_steps_ext_idx    on public.plan_follow_steps (ext) where ext is not null;

-- ---------------------------------------------------------------- the day's louder pings and calls, across servers
create table if not exists public.plan_reach_caps (
  person  text not null,   -- "u:<id>" an app user's loud pings, X0 calls and real calls; "p:<id>" their real calls; "ap:<asker id>" real
                           -- calls for one asker's items; "all:p" the server's real calls
  day     text not null,   -- YYYY-MM-DD in the follow's offset ("all:p": UTC)
  n       integer not null default 0,
  primary key (person, day)
);

-- ---------------------------------------------------------------- a person's own number for real phone calls (their own yes)
create table if not exists public.plan_phones (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  seal              text,           -- the number, sealed
  hash              text,           -- keyed hash of it: never the number
  verified_ms       bigint,         -- when it was proved theirs (a call from it); null: not yet
  pending_hash      text,           -- the number waiting to be proved, keyed hash: an inbound call is matched on this, nothing is opened
  pending_until_ms  bigint,
  stopped_ms        bigint,         -- they pressed 9 on a call: no more real calls until they turn it on again
  consent           jsonb not null default '[]'::jsonb,   -- [{ v, at, how }]: when they turned it on and how the number was proved
  created_ms        bigint not null,
  updated_ms        bigint not null
);
alter table public.plan_phones add column if not exists pending_code text;   -- the setup screen's short code, sealed, while it waits
create index if not exists plan_phones_hash_idx    on public.plan_phones (hash) where hash is not null;
create index if not exists plan_phones_pending_idx on public.plan_phones (pending_hash) where pending_hash is not null;
-- One account per proved number. A run of an earlier draft (one call proved every account waiting) may have left a number on several:
-- only the latest proof keeps it, then the unique index.
update public.plan_phones p set hash = null, verified_ms = null
  where p.hash is not null and exists (
    select 1 from public.plan_phones q
    where q.hash = p.hash and q.user_id <> p.user_id and (coalesce(q.verified_ms, 0), q.user_id) > (coalesce(p.verified_ms, 0), p.user_id)
  );
create unique index if not exists plan_phones_hash_one on public.plan_phones (hash) where hash is not null;

-- ---------------------------------------------------------------- numbers whose owner pressed 9
create table if not exists public.plan_phone_stops (
  hash        text primary key,       -- the number's keyed hash: never the number
  stopped_ms  bigint not null
);

-- ---------------------------------------------------------------- "X0 is calling" may ring for a followed item too
alter table public.plan_calls drop constraint if exists plan_calls_source;
alter table public.plan_calls add constraint plan_calls_source check (source in ('leave', 'due', 'follow'));

alter table public.plan_numbers      enable row level security;
alter table public.plan_follows      enable row level security;
alter table public.plan_follow_steps enable row level security;
alter table public.plan_reach_caps   enable row level security;
alter table public.plan_phones       enable row level security;
alter table public.plan_phone_stops  enable row level security;
-- No policies: only the server (the service key) reads or writes these.
