-- X0 Bot — a space's admin has no automatic access to anything of anyone's (docs/social.md §4).
--
-- Nothing is dropped and no column is removed: this migration only takes back access that the app no longer explains.
--
-- space_grants  the rows the ADMIN made of a MEMBER's thing (by_id set, and not the owner's own id) are deleted. Members did
--               agree to the line that allowed them ("The space's admin can see and share your work and messages here."), so
--               they were not improper — but that line is gone, nothing in the app would now tell the owner such a share
--               exists, and live access nobody can see or stop is worse than access withdrawn. Their cards go with them, or
--               the feed would keep an Open that leads nowhere.
--
-- space_members.consent_ms / consent_v and space_join_requests.consent_ms / consent_v STAY, and nothing reads them, exactly as
-- the old perms columns and space_roles do: that is what makes this reversible. Put the server's old code back and every one of
-- those rows still says what it always said.
--
-- Run in your Supabase SQL editor after 0111. It can be run again (the second run finds nothing to do).

-- The cards first, while the grants still say which messages they are.
delete from public.thread_messages
where id in (select message_id from public.space_grants where by_id is not null and by_id <> owner_id and message_id is not null);

-- Then the notes left on a thing that only such a share ever reached: its owner never saw them, and nobody can reach the thing
-- now. A note on a thing somebody also shared themselves is left alone.
delete from public.space_work_notes n
where exists (
  select 1 from public.space_grants g
  where g.space_id = n.space_id and g.owner_id = n.owner_id and g.bot = n.bot and g.item_id = n.item_id
    and g.by_id is not null and g.by_id <> g.owner_id
) and not exists (
  select 1 from public.space_grants g
  where g.space_id = n.space_id and g.owner_id = n.owner_id and g.bot = n.bot and g.item_id = n.item_id
    and (g.by_id is null or g.by_id = g.owner_id)
);

delete from public.space_grants where by_id is not null and by_id <> owner_id;
