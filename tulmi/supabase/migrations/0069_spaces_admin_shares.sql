-- Tailzu — the space's admin shares any member's thing (src/botsBots/{grants,spaceFeed,work,spaces,spaceJoin}.ts; docs/spaces.md).
--
-- space_grants        + by_id (who shared it, when it isn't its owner: the space's admin. Null: its owner shared it, as before). Only
--                     the admin stops a share the admin made; its owner is not told of it.
-- space_members       + consent_v (which line about the admin they agreed to: 2 is "The space's admin can see and share your work and
--                     messages here."; null or 1 the line before it, "can see", so they are asked once more before they write)
-- space_join_requests + consent_v (the same, for someone who asked to join: the line their screen showed when they asked)
--
-- Run in your Supabase SQL editor. It needs 0068 and can be run again. Older server code ignores these columns.

alter table public.space_grants add column if not exists by_id uuid references auth.users (id) on delete cascade;

alter table public.space_members add column if not exists consent_v smallint;
alter table public.space_join_requests add column if not exists consent_v smallint;
