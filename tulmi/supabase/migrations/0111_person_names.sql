-- X0 Bot — the name you give someone (src/botsBots/personNames.ts, docs/social.md §2).
--
-- person_names  one row a pair: the name OWNER gave SUBJECT. Nobody else ever reads it. A username is how a person is
--               reached; this is what they are called, and it is per reader, the way a phone's contacts are — so the same
--               account is "Mom" to one person and "Aanya" to another, and neither sees the other's name for her.
--
-- Everywhere a name is stored today (space_members.name, thread_members.name, thread_messages.sender_name) keeps being
-- written exactly as it was. Those are the FALLBACK, and one of them is load-bearing: a deleted account takes its
-- thread_members row with it, so a one-to-one chat reads its name back off that person's own messages (sender_name, by
-- migration 0051). This table resolves on top of them, only while the subject still has an account — which is why
-- subject_id cascades: the account going takes these names with it and the fallback takes over, as it already does.
--
-- Row-level security is on with no policy, as the neighbouring tables do: the service key reaches it and nothing else.
-- Run in your Supabase SQL editor after 0110. It can be run again.

create table if not exists public.person_names (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  set_ms     bigint not null,
  primary key (owner_id, subject_id)
);
-- The read is always "every name this person gave", resolved in one go for a list: the primary key's own order serves it.
create index if not exists person_names_owner_idx on public.person_names (owner_id);

alter table public.person_names enable row level security;

-- threads + last_by: WHOSE the chat's last line is. last_text is written as "Mom: Dinner at 8?" — the sender's name baked in at
-- write time — so without this a chats list would show the row titled by the name its reader gave ("Amma") over a line still
-- reading "Mom:". The name in last_text stays exactly as it was, so a build that reads it knows nothing of this; the server
-- swaps the part before the first ": " for the reader's own name when it has one, and only then.
alter table public.threads add column if not exists last_by uuid;

-- Nobody can name themselves: their own name is their own, and the screens draw "You".
do $$ begin
  alter table public.person_names add constraint person_names_not_self check (owner_id <> subject_id);
exception when duplicate_object then null; end $$;
