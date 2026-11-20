-- X0 Bot — the username: one name a person is reached by, everywhere (src/profile/username.ts, docs/username.md).
--
-- profiles    + username (their own, lower case, 3-20 of a-z 0-9 _ -, never two the same) and username_ms (when it was
--             last changed, which paces changes). Assigned the moment the account is made, by the trigger below, so no
--             account anywhere is ever without one: adding someone by username can then rely on everyone having one.
-- usernames   the ledger every name goes through, and the one place uniqueness is decided. 'held' is in use, 'reserved'
--             is ours (x0, support, admin...), and 'freed' is a name someone gave up: IT IS NEVER GIVEN TO ANYONE ELSE.
--             A connection keeps working across a change because it holds a user id, but a name typed into a message a
--             year ago does not, so a freed name must never come to mean a different person.
--
-- The name a person SEES for someone else is not here: that is theirs to give (person_names, a later migration). This
-- is only the name they are reached by.
--
-- Row-level security is on with no policy, as the neighbouring tables do: the service key reaches it and nothing else.
-- Run in your Supabase SQL editor after 0109. It can be run again.

alter table public.profiles add column if not exists username    text;
alter table public.profiles add column if not exists username_ms bigint;

do $$ begin
  alter table public.profiles add constraint profiles_username_ok
    check (username is null or username ~ '^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$');
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_username_idx on public.profiles (username) where username is not null;

create table if not exists public.usernames (
  name       text primary key check (name ~ '^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$'),
  -- Null for 'reserved', and for 'freed' once the account itself is gone.
  user_id    uuid references auth.users (id) on delete set null,
  kind       text not null check (kind in ('held', 'reserved', 'freed')),
  created_ms bigint not null
);
create index if not exists usernames_user_idx on public.usernames (user_id) where kind = 'held';
alter table public.usernames enable row level security;

-- Ours, and the ones that would read as ours. Never handed out.
insert into public.usernames (name, user_id, kind, created_ms)
select w, null, 'reserved', (extract(epoch from now()) * 1000)::bigint
from unnest(array[
  -- Three characters at least, as the check above demands: 'x0' and 'me' could never be claimed anyway.
  'x0bot', 'tailzu', 'tulmi', 'blip', 'keybot', 'xode', 'oracle',
  'admin', 'support', 'help', 'root', 'system', 'staff', 'team', 'official',
  'everyone', 'here', 'all', 'you', 'null', 'undefined', 'anonymous', 'someone'
]) as w
on conflict (name) do nothing;

-- A name nobody has had: speakable, and never a running number (which would say how many accounts there are, and let
-- anyone walk them). Tries words first, then falls back to a longer tail, so it cannot loop for ever.
create or replace function public.make_username()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  adjectives text[] := array['swift','quiet','bright','clever','sunny','calm','brave','kind','tidy','warm','lucky','merry','nimble','steady','jolly','keen'];
  nouns      text[] := array['otter','heron','maple','comet','pebble','willow','falcon','cedar','ember','sparrow','harbour','meadow','lantern','walnut','badger','thistle'];
  tried      text;
  n          int;
begin
  for n in 1..40 loop
    tried := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
          || '-' || nouns[1 + floor(random() * array_length(nouns, 1))::int]
          || '-' || lpad(floor(random() * 1000)::int::text, 3, '0');
    if not exists (select 1 from public.usernames where name = tried) then
      return tried;
    end if;
  end loop;
  -- Every word pair was taken: a plain random tail, which the loop above makes vanishingly unlikely to be needed.
  loop
    tried := 'x0-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
    exit when not exists (select 1 from public.usernames where name = tried);
  end loop;
  return tried;
end;
$$;

-- Claim a name for someone: the one place a name is taken. Returns false when it is held, reserved or freed.
create or replace function public.claim_username(who uuid, want text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  at_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  had   text;
begin
  -- The server only ever sends a name it has already checked (profile/username.ts checkShape), but this is the one door a name
  -- comes through: a shape it would refuse is refused here too, rather than raising on the table's own check.
  if who is null or want is null or want !~ '^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$' then return false; end if;
  select username into had from public.profiles where user_id = who;
  if had = want then return true; end if;

  begin
    insert into public.usernames (name, user_id, kind, created_ms) values (want, who, 'held', at_ms);
  exception when unique_violation then
    return false;
  end;

  -- The one they had is given up for good, so it never comes to mean someone else.
  if had is not null then
    update public.usernames set kind = 'freed', user_id = null where name = had;
  end if;
  -- Upsert, not update: an account whose profile row never got made (one from before 0003's trigger) would otherwise take the
  -- name in the ledger and have nothing to show for it.
  insert into public.profiles (user_id, username, username_ms) values (who, want, at_ms)
  on conflict (user_id) do update set username = excluded.username, username_ms = excluded.username_ms;
  return true;
end;
$$;

-- Every new account gets its profile AND its username in the same breath.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  name text := public.make_username();
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  -- A name the gap between making it and claiming it gave away: try again, once.
  begin
    insert into public.usernames (name, user_id, kind, created_ms)
    values (name, new.id, 'held', (extract(epoch from now()) * 1000)::bigint);
  exception when unique_violation then
    name := public.make_username();
    insert into public.usernames (name, user_id, kind, created_ms)
    values (name, new.id, 'held', (extract(epoch from now()) * 1000)::bigint);
  end;
  update public.profiles set username = name, username_ms = (extract(epoch from now()) * 1000)::bigint
  where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Everyone who signed in before this migration. Safe to run again: it only touches rows with no username.
do $$
declare
  r     record;
  name  text;
  at_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  for r in select user_id from public.profiles where username is null loop
    name := public.make_username();
    begin
      insert into public.usernames (name, user_id, kind, created_ms) values (name, r.user_id, 'held', at_ms);
      update public.profiles set username = name, username_ms = at_ms where user_id = r.user_id;
    exception when unique_violation then
      null;  -- the next run picks it up
    end;
  end loop;
end $$;

-- An account that signed in before 0003's trigger existed has no profile row at all: give it one, with a username.
insert into public.profiles (user_id) select u.id from auth.users u
left join public.profiles p on p.user_id = u.id where p.user_id is null
on conflict (user_id) do nothing;
