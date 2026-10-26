-- Tailzu — what the Code bot's router learns about its models (src/code/brain/stats.ts, docs/code-brain.md).
--
-- Run in your Supabase SQL editor after 0024. Optional: without it the router
-- keeps its default order and logs that an outcome was not recorded; nothing else
-- depends on it.
--
-- After each step the brain says how it went, and one row per (task type, step,
-- model) keeps the running totals. Once a model has been tried at least 20 times
-- at a kind of step and worked at least 85 times in 100, the router puts the
-- CHEAPEST such model first on that step's ladder.
--
-- code_route_stats  task_type    what the classifier called the request
--                                (question, bug_fix, feature, ...)
--                   step         what the brain was doing (plan, write_code, review, ...)
--                   model        the OpenRouter slug that did it
--                   successes    steps that worked, failures those that did not
--                   paise_total  what those steps cost, added up, in paise
--                   ms_total     how long they took, added up, in milliseconds
--                   updated_at   the last time a step was added
--
-- Nothing about who asked or what was asked is kept here: only these counts, the
-- same for everyone. Written by the server with the service key only. Row-level
-- security is on and there are NO policies, so no person's own token can read
-- or write any of it.

create table if not exists public.code_route_stats (
  task_type   text not null check (char_length(task_type) between 1 and 40),
  step        text not null check (char_length(step) between 1 and 40),
  model       text not null check (char_length(model) between 1 and 200),
  successes   integer not null default 0 check (successes >= 0),
  failures    integer not null default 0 check (failures >= 0),
  paise_total bigint not null default 0 check (paise_total >= 0),
  ms_total    bigint not null default 0 check (ms_total >= 0),
  updated_at  timestamptz not null default now(),
  primary key (task_type, step, model)
);

alter table public.code_route_stats enable row level security;

-- Adds one outcome to its row in one statement, so two steps ending together both count.
create or replace function public.code_record_route_outcome(
  p_task_type text, p_step text, p_model text, p_success boolean, p_paise integer, p_ms integer
)
returns void
language sql
as $$
  insert into public.code_route_stats as s (task_type, step, model, successes, failures, paise_total, ms_total, updated_at)
  values (
    p_task_type, p_step, p_model,
    case when p_success then 1 else 0 end,
    case when p_success then 0 else 1 end,
    greatest(p_paise, 0), greatest(p_ms, 0), now()
  )
  on conflict (task_type, step, model) do update
    set successes   = s.successes   + excluded.successes,
        failures    = s.failures    + excluded.failures,
        paise_total = s.paise_total + excluded.paise_total,
        ms_total    = s.ms_total    + excluded.ms_total,
        updated_at  = now();
$$;

-- Only the server (the service key) may add to the record: a person's own token must not be able to call this.
revoke all on function public.code_record_route_outcome(text, text, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.code_record_route_outcome(text, text, text, boolean, integer, integer) to service_role;
