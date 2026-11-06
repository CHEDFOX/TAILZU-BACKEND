-- Tailzu — Plan Ease step 5: family asks, repeats and turns in a space (src/botsBots/planAsks.ts, planAskWords.ts, spaceTasks.ts;
-- docs/plan-ease-people.md).
--
-- An ask is a space task of a third kind, 'ask': "Who picks Kabir up Wednesday?". While it is open the existing `assignees` (0051) holds
-- who may take it (everyone in the space but the asker, or the people named). The first "I'll do it" wins: `assignees` becomes the one
-- who took it, and it lands on their day like any task, so their Done answers as today. An open ask lands on nobody's day.
--
-- space_tasks + kind 'ask'   the check widens to ('task', 'plan', 'ask')
--             + asked_ms     when it went to the family; null while it is only the asker's preview (nothing goes out until they tap Ask)
--             + take_by_ms   if nobody took it by then, the asker is told (6 pm the day before; asked later: 2 h on, 1 h before at most)
--             + nudged_ms    the one quiet nudge to the family, halfway to take_by_ms
--             + taken_by     who took it (or whose turn it is), taken_ms when
--             + repeat       { every: "week", days: [0..6] } when it repeats ("every Sunday"), else null
--             + turns        { order: [user ids], next: index } when people take turns ("Arjun and Rohan take turns..."), else null
--             + told_ms      when the asker was told nobody took it (once an occurrence)
--             + next_ms      when the job next looks at it (the nudge, the take-by, the turn's evening-before push, the next week): the
--                            job claims a row by moving this on, so two servers never send twice
--             + ask          what the words were made into: the question, its batch (two days asked at once are two asks, sent by
--                            one tap), the occurrence's can't-do list, who did it last. Ids and short words only
--
-- Written and read by the server with the service key only (row-level security on, no policies, as 0051). Safe to run again, and
-- older server code ignores these columns. But older server code does NOT know the 'ask' kind: its space task list has no kind
-- filter, so it would show an unsent preview or an open ask to every member as a task. So turn asks on (PLAN_V2_ASKS=true) only
-- once every server runs the code that came with this migration; while servers are mixed, keep PLAN_V2_ASKS=false.

alter table public.space_tasks drop constraint if exists space_tasks_kind_check;
alter table public.space_tasks add constraint space_tasks_kind_check check (kind in ('task', 'plan', 'ask'));

alter table public.space_tasks add column if not exists asked_ms bigint;
alter table public.space_tasks add column if not exists take_by_ms bigint;
alter table public.space_tasks add column if not exists nudged_ms bigint;
alter table public.space_tasks add column if not exists taken_by uuid references auth.users (id) on delete set null;
alter table public.space_tasks add column if not exists taken_ms bigint;
alter table public.space_tasks add column if not exists repeat jsonb;
alter table public.space_tasks add column if not exists turns jsonb;
alter table public.space_tasks add column if not exists told_ms bigint;
alter table public.space_tasks add column if not exists next_ms bigint;
alter table public.space_tasks add column if not exists ask jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.space_tasks add constraint space_tasks_ask_shapes check (
    jsonb_typeof(ask) = 'object' and pg_column_size(ask) <= 4000
    and (repeat is null or jsonb_typeof(repeat) = 'object')
    and (turns is null or (jsonb_typeof(turns) = 'object' and jsonb_typeof(turns -> 'order') = 'array' and jsonb_array_length(turns -> 'order') <= 20)));
exception when duplicate_object then null; end $$;

-- The asks job: rows whose next look is due. The page: a space's asks.
create index if not exists space_tasks_ask_next_idx on public.space_tasks (next_ms) where kind = 'ask' and next_ms is not null;
create index if not exists space_tasks_ask_space_idx on public.space_tasks (space_id) where kind = 'ask';
