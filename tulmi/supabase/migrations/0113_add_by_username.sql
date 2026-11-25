-- X0 Bot — adding someone by username, and the two-person space (docs/social.md §3, docs/username.md).
--
-- space_invites.user_id  an invite to an ACCOUNT, found by its username (profile/username.ts idFor), where `email` is the
--                        address of someone not on the app yet. Exactly one of the two is set on a new row; an old row has
--                        neither (a build's "link") or the email. The person who invited never learns the account's email:
--                        the row names the account, and the invite shows them the username they typed.
--                        Cascades with the account, as created_by already does.
-- spaces.pair            a friendship: a space of exactly two people, made by "Add a person". It is hidden from the spaces
--                        list and named for each viewer by the other person, so grants, the chat, blocks, moderation and looks
--                        all keep working with no new rule set. False for every space that exists.
--
-- Both columns are additive and default to what every existing row already means, so older server code reads past them.
-- Run in your Supabase SQL editor after 0112. It can be run again.

alter table public.space_invites add column if not exists user_id uuid references auth.users (id) on delete cascade;
-- The read is "the open invites to this account", on every Spaces screen: by person, newest first.
create index if not exists space_invites_user_idx on public.space_invites (user_id, created_ms desc) where user_id is not null;

alter table public.spaces add column if not exists pair boolean not null default false;
