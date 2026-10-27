-- Tailzu — the month's GitHub Actions minutes, for the live session (src/code/live, docs/cloudflare-jobs.md section 10).
--
-- Run in your Supabase SQL editor after 0030, before turning on the live session on the jobs Worker
-- (CODE_JOBS_MODE=cloudflare). Needs 0023 (code_compute_usage). It can be run again.
--
-- GitHub gives a free plan 2,000 Actions minutes a month (CODE_ACTIONS_MONTHLY_MIN), shared with everything else the
-- person runs there. A live session keeps one runner open for a whole job, so Tailzu counts the minutes it uses and
-- draws two lines:
--
--   at 80%  the person is told, ONCE for the month (push: code_minutes_low)
--   at 95%  Tailzu stops choosing GitHub's computers for them until the month turns over (the router falls through
--           to the next place: their own computer, paid compute by their rule, or waiting)
--
-- A public repo's minutes are not metered by GitHub, so they are never added here.
--
-- code_runner_minutes.actions_minutes  the minutes used so far this month, rounded up per job
-- code_runner_minutes.notified_80      the 80% notification has gone out for this month
-- code_add_runner_minutes              adds minutes AND flips notified_80 in one function call, and says whether THIS call
--                                      was the one that took the month past the line: so two results arriving together
--                                      tell the person once, and a month that is already past it never tells them again
--
-- One row per person ("owner account") and month ('YYYY-MM', UTC). Written by the server with the service key only; a
-- person's own token can READ their own row (the policy below) and nothing else.

create table if not exists public.code_runner_minutes (
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- "YYYY-MM", UTC.
  month           text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  actions_minutes integer not null default 0 check (actions_minutes >= 0),
  notified_80     boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (user_id, month)
);

create or replace function public.code_add_runner_minutes(p_user uuid, p_month text, p_minutes integer, p_notify_at integer)
returns table (total_minutes integer, crossed boolean)
language plpgsql
as $$
declare
  total   integer;
  flipped integer;
begin
  insert into public.code_runner_minutes as r (user_id, month, actions_minutes)
  values (p_user, p_month, greatest(p_minutes, 0))
  on conflict (user_id, month) do update
    set actions_minutes = r.actions_minutes + excluded.actions_minutes,
        updated_at      = now()
  returning r.actions_minutes into total;

  -- Only the call whose update changes the row sees it change: that is the call that tells the person.
  update public.code_runner_minutes r
     set notified_80 = true
   where r.user_id = p_user
     and r.month = p_month
     and r.actions_minutes >= p_notify_at
     and not r.notified_80;
  get diagnostics flipped = row_count;

  return query select total, flipped > 0;
end;
$$;

-- Only the server (the service key) may add to anyone's minutes.
revoke all on function public.code_add_runner_minutes(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.code_add_runner_minutes(uuid, text, integer, integer) to service_role;

alter table public.code_runner_minutes enable row level security;

drop policy if exists "users read own code runner minutes" on public.code_runner_minutes;
create policy "users read own code runner minutes"
  on public.code_runner_minutes for select
  using (auth.uid() = user_id);
