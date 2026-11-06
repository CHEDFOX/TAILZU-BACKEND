-- Tailzu — Plan Ease, the simpler one, steps 0 and 1 (src/botsBots/plan*.ts, src/calendar; docs/plan-ease.md).
--
-- calendar_tasks + kind     what a to-do is: 'todo' (as every one was), 'due' (a bill, step 3) or 'wait' (waiting on someone, step 4).
--                           One store: everything that reads to-dos sees the other two with no new plumbing
--                + snoozes  how many times its reminder was put off with Later (at most 3: then it stays quietly in the app)
-- plan_prefs     + tz_min        the person's offset as their apps last said it (was kept only in one server's memory)
--                + evening_min   when the evening note goes, minutes after their midnight (8:30 pm; it moves towards when they
--                                usually open the app in the evening, kept between 7 pm and 10 pm)
--                + morning_min   when the morning note goes, when it goes (7:30 am)
--                + notes         which notes: both | evening ("no morning notes") | morning (after 5 unopened evening notes, or
--                                "no evening notes") | off (after 5 unopened morning notes too, or "no notes")
--                + unopened      evening notes in a row never opened or acted on
--                + next_note_ms  when the next note is due: the job claims a row by moving this on, so two servers never send twice
--                + note          the notes' memory: which was sent when, whether it was opened, what tomorrow looked like then
--                                (ids and times only, never titles), the one-time lines said
--                + shown         the Move card last shown, with the travel it would save (was kept only in one server's memory)
--                + opens         when they opened Plan Ease in the evening, the last 21 days (minutes after midnight)
--                + leaves        today's and tomorrow's leave-by times worked out (event id, start, when to leave, minutes, mode, where:
--                                the place's first part only), and whether its reminder went
--                + next_leave_ms when the next leave-by reminder is due
--                + sent          how many Plan Ease pushes went today (at most 6 besides the day note and their own timed reminders)
--
-- Every person with something on their calendar gets a plan_prefs row (their notes go to them as the owner decided: on, and they
-- stop by themselves after 5 unopened), with their next note at their next 8:30 pm.
--
-- Run in your Supabase SQL editor. It needs 0052 and 0054 and can be run again. Older server code ignores these columns.

alter table public.calendar_tasks add column if not exists kind text not null default 'todo';
alter table public.calendar_tasks add column if not exists snoozes smallint not null default 0;
do $$ begin
  alter table public.calendar_tasks add constraint calendar_tasks_kind check (kind in ('todo', 'due', 'wait'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.calendar_tasks add constraint calendar_tasks_snoozes check (snoozes between 0 and 20);
exception when duplicate_object then null; end $$;

alter table public.plan_prefs add column if not exists tz_min integer;
alter table public.plan_prefs add column if not exists evening_min integer not null default 1230;
alter table public.plan_prefs add column if not exists morning_min integer not null default 450;
alter table public.plan_prefs add column if not exists notes text not null default 'both';
alter table public.plan_prefs add column if not exists unopened smallint not null default 0;
alter table public.plan_prefs add column if not exists next_note_ms bigint;
alter table public.plan_prefs add column if not exists note jsonb not null default '{}'::jsonb;
alter table public.plan_prefs add column if not exists shown jsonb;
alter table public.plan_prefs add column if not exists opens jsonb not null default '[]'::jsonb;
alter table public.plan_prefs add column if not exists leaves jsonb not null default '[]'::jsonb;
alter table public.plan_prefs add column if not exists next_leave_ms bigint;
alter table public.plan_prefs add column if not exists sent jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.plan_prefs add constraint plan_prefs_tz check (tz_min is null or tz_min between -720 and 840);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_prefs add constraint plan_prefs_note_minutes check (evening_min between 0 and 1439 and morning_min between 0 and 1439);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_prefs add constraint plan_prefs_notes check (notes in ('both', 'evening', 'morning', 'off'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_prefs add constraint plan_prefs_shapes check (
    jsonb_typeof(note) = 'object' and jsonb_typeof(sent) = 'object'
    and jsonb_typeof(opens) = 'array' and jsonb_array_length(opens) <= 30
    and jsonb_typeof(leaves) = 'array' and jsonb_array_length(leaves) <= 24
    and (shown is null or jsonb_typeof(shown) = 'object'));
exception when duplicate_object then null; end $$;

create index if not exists plan_prefs_note_due_idx on public.plan_prefs (next_note_ms) where next_note_ms is not null;
create index if not exists plan_prefs_leave_due_idx on public.plan_prefs (next_leave_ms) where next_leave_ms is not null;

-- Everyone with calendar rows: a row, their offset (the newest row's), and their next 8:30 pm. A row already there keeps what it has,
-- and is given an offset and a note time only where it has none.
with now_ms as (select (extract(epoch from now()) * 1000)::bigint as t),
people as (
  select user_id, (array_agg(tz_min order by updated_ms desc))[1] as tz
  from (
    select user_id, tz_min, updated_ms from public.calendar_events
    union all
    select user_id, tz_min, updated_ms from public.calendar_tasks
  ) rows
  group by user_id
),
next_note as (
  select p.user_id, p.tz,
    (floor((n.t + p.tz * 60000)::numeric / 86400000) * 86400000 - p.tz * 60000 + 1230 * 60000)::bigint as at,
    n.t
  from people p cross join now_ms n
)
insert into public.plan_prefs (user_id, home, saves, updated_ms, tz_min, next_note_ms)
select user_id, '', '[]'::jsonb, t, tz, case when at > t then at else at + 86400000 end
from next_note
on conflict (user_id) do update
  set tz_min = coalesce(public.plan_prefs.tz_min, excluded.tz_min),
      next_note_ms = coalesce(public.plan_prefs.next_note_ms, excluded.next_note_ms);
