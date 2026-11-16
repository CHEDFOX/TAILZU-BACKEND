-- THE ASSET BIBLE: a place is kept the way a person already is.
--
-- A character the person keeps comes back into the next film with the same face, the same clothes and the same reference sheet
-- (plan.ts keepCast). A place did not: the stall in the second film was a different stall, which is the thing that stops a run of
-- films feeling like one world. The kept rows now say which kind of thing they are, and places sit beside people in the same table.
alter table cinema_cast add column if not exists kind text not null default 'person';
create index if not exists cinema_cast_user_kind_idx on cinema_cast (user_id, kind);
