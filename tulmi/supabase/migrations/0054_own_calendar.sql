-- Tailzu — each person's own calendar and to-dos (src/calendar, routes/botsCalendar.ts): what the Plan bot, Today, Tasks, Spaces, meeting
-- notes and every bot given "calendar" or "tasks" read and write. Tailzu no longer reads Google Calendar or Google Tasks for these.
--
-- Run in your Supabase SQL editor after 0051_spaces_sharing.sql. It can be run again. Without it these rows live in memory and a restart
-- forgets them.
--
-- calendar_events  an event: what, when (start_ms / end_ms; an all-day one is its date at UTC midnight, for whole days), the offset it
--                  was made in (tz_min: a repeating time stays on the person's clock), place, notes, how it repeats (daily, weekdays,
--                  weekly, monthly, yearly; until; the days taken out of it), the reminder (minutes before) and when the next one is due
-- calendar_tasks   a to-do: what, notes, a list, the day it's due and the time (when one was said), done, the reminder and when it's due
--
-- source           where it came from: the person ({ kind: "me" }), a bot ({ kind: "bot", name }), someone in a space
--                  ({ kind: "space", spaceId, taskId, by, name, space }: theirs to change; the person ticks it or says they can't), or a
--                  meeting's to-do ({ kind: "note", noteId, todoId, title })
-- source_key       the one row a space's task or plan ("space:<task id>") or a meeting's to-do ("note:<note id>:<to-do id>") makes for a
--                  person: made once, brought up to date after
--
-- Written by the server with the service key only. A person's own token can READ their own rows. Times are epoch milliseconds.

create table if not exists public.calendar_events (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  notes          text not null default '' check (char_length(notes) <= 1000),
  place          text not null default '' check (char_length(place) <= 160),
  start_ms       bigint not null,
  end_ms         bigint not null check (end_ms >= start_ms),
  all_day        boolean not null default false,
  tz_min         integer not null default 330 check (tz_min between -720 and 840),
  repeat         text not null default '' check (repeat in ('', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  repeat_until   bigint,
  skips          jsonb not null default '[]'::jsonb check (jsonb_typeof(skips) = 'array' and jsonb_array_length(skips) <= 400),
  remind_min     integer check (remind_min is null or remind_min between 0 and 10080),
  next_remind_ms bigint,
  source         jsonb not null default '{"kind":"me"}'::jsonb check (jsonb_typeof(source) = 'object'),
  source_key     text check (source_key is null or char_length(source_key) between 1 and 200),
  created_ms     bigint not null,
  updated_ms     bigint not null
);
create index if not exists calendar_events_user_start_idx on public.calendar_events (user_id, start_ms);
create index if not exists calendar_events_series_idx on public.calendar_events (user_id, start_ms) where repeat <> '';
create index if not exists calendar_events_remind_idx on public.calendar_events (next_remind_ms) where next_remind_ms is not null;
create unique index if not exists calendar_events_source_key on public.calendar_events (user_id, source_key);
create index if not exists calendar_events_source_idx on public.calendar_events (source_key) where source_key is not null;

create table if not exists public.calendar_tasks (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  notes          text not null default '' check (char_length(notes) <= 1000),
  list           text not null default '' check (char_length(list) <= 40),
  due_day        text check (due_day is null or due_day ~ '^\d{4}-\d{2}-\d{2}$'),
  due_ms         bigint,
  tz_min         integer not null default 330 check (tz_min between -720 and 840),
  done           boolean not null default false,
  done_ms        bigint,
  remind_min     integer check (remind_min is null or remind_min between 0 and 10080),
  next_remind_ms bigint,
  source         jsonb not null default '{"kind":"me"}'::jsonb check (jsonb_typeof(source) = 'object'),
  source_key     text check (source_key is null or char_length(source_key) between 1 and 200),
  created_ms     bigint not null,
  updated_ms     bigint not null
);
create index if not exists calendar_tasks_user_due_idx on public.calendar_tasks (user_id, due_day);
create index if not exists calendar_tasks_open_idx on public.calendar_tasks (user_id, created_ms) where not done;
create index if not exists calendar_tasks_remind_idx on public.calendar_tasks (next_remind_ms) where next_remind_ms is not null;
create unique index if not exists calendar_tasks_source_key on public.calendar_tasks (user_id, source_key);
create index if not exists calendar_tasks_source_idx on public.calendar_tasks (source_key) where source_key is not null;

alter table public.calendar_events enable row level security;
drop policy if exists "users read own calendar events" on public.calendar_events;
create policy "users read own calendar events" on public.calendar_events for select using (auth.uid() = user_id);

alter table public.calendar_tasks enable row level security;
drop policy if exists "users read own calendar tasks" on public.calendar_tasks;
create policy "users read own calendar tasks" on public.calendar_tasks for select using (auth.uid() = user_id);

-- What spaces gave people before this: each open plan and task, on the days of each person it's for who hasn't said they can't
-- (a plan as an event, reminded 15 minutes before; a task as a to-do, ticked when they said done). Times are read in India's offset,
-- as the app's are when it doesn't know better. A second run adds nothing: one row a person a task.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'space_tasks') then
    insert into public.calendar_events (id, user_id, title, notes, place, start_ms, end_ms, all_day, tz_min, remind_min, next_remind_ms, source, source_key, created_ms, updated_ms)
    select gen_random_uuid(), a.uid::uuid, t.title, t.notes, t.place, t.at_ms, greatest(coalesce(t.end_ms, t.at_ms + 3600000), t.at_ms), false, 330, 15,
           case when t.at_ms - 900000 > (extract(epoch from now()) * 1000)::bigint then t.at_ms - 900000 end,
           jsonb_build_object('kind', 'space', 'spaceId', t.space_id, 'taskId', t.id, 'by', t.set_by, 'name', case when t.set_by::text = a.uid then 'You' else t.set_name end, 'space', s.name),
           'space:' || t.id, t.created_ms, t.updated_ms
      from public.space_tasks t
      join public.spaces s on s.id = t.space_id
      cross join lateral jsonb_array_elements_text(t.assignees) as a(uid)
     where t.kind = 'plan' and t.at_ms is not null and coalesce(t.states -> a.uid ->> 'status', 'todo') <> 'cant'
       and exists (select 1 from auth.users u where u.id::text = a.uid)
    on conflict (user_id, source_key) do nothing;

    insert into public.calendar_tasks (id, user_id, title, notes, due_day, due_ms, tz_min, done, done_ms, remind_min, next_remind_ms, source, source_key, created_ms, updated_ms)
    select gen_random_uuid(), a.uid::uuid, t.title, t.notes,
           case when t.at_ms is null then null else to_char(to_timestamp((t.at_ms + 330 * 60000) / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') end,
           case when t.at_ms is not null and not t.all_day then t.at_ms end, 330,
           coalesce(t.states -> a.uid ->> 'status', 'todo') = 'done',
           case when coalesce(t.states -> a.uid ->> 'status', 'todo') = 'done' then t.updated_ms end,
           case when t.at_ms is not null and not t.all_day then 0 end,
           case when t.at_ms is not null and not t.all_day and coalesce(t.states -> a.uid ->> 'status', 'todo') <> 'done'
                 and t.at_ms > (extract(epoch from now()) * 1000)::bigint then t.at_ms end,
           jsonb_build_object('kind', 'space', 'spaceId', t.space_id, 'taskId', t.id, 'by', t.set_by, 'name', case when t.set_by::text = a.uid then 'You' else t.set_name end, 'space', s.name),
           'space:' || t.id, t.created_ms, t.updated_ms
      from public.space_tasks t
      join public.spaces s on s.id = t.space_id
      cross join lateral jsonb_array_elements_text(t.assignees) as a(uid)
     where t.kind = 'task' and coalesce(t.states -> a.uid ->> 'status', 'todo') <> 'cant'
       and exists (select 1 from auth.users u where u.id::text = a.uid)
    on conflict (user_id, source_key) do nothing;
  end if;
end $$;
