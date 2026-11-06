-- Tailzu — Plan Ease step 4: waiting on someone (src/botsBots/planWaits.ts, planWaitWords.ts; docs/plan-ease-people.md).
--
-- A wait is a to-do of kind 'wait' (0070), so Today, Tasks, ticks and the Plan Ease chat's tools see it with no new plumbing. It is made
-- from the one box ("Rahul will send the numbers by Thursday", "Plumber said Tuesday") or a meeting's to-do whose "who" is a real name.
--
-- calendar_tasks + who_name   who it waits on: "Rahul", "the plumber" (from the person's own words or the meeting; never from contacts)
--                + who_reach  a phone number or an email found in those same words, where Send goes; never from contacts
--                + draft      the follow-up, ready to send ("Hi Rahul, just checking on the numbers..."): a fixed template
--                + check_ms   when to check back next: the job claims a row by moving this on, so two servers never send twice
--                + checks     check-backs sent, 3 at most; then it stays quietly on the list
--                + asked_ms   when the last check-back went: the Needs-you card shows from then
--                + sent_ms    when they last pressed Send: the card goes until the next check-back, 2 days on
--                + came       a visit or a delivery ("Plumber said Tuesday"): it asks "Did the plumber come?" instead
--
-- Sorted waits are deleted 30 days after (the job's daily clean-up), and every wait goes with the account (calendar_tasks cascades).
-- Run in your Supabase SQL editor. It needs 0054 and 0070 and can be run again. Older server code ignores these columns.

alter table public.calendar_tasks add column if not exists who_name text;
alter table public.calendar_tasks add column if not exists who_reach text;
alter table public.calendar_tasks add column if not exists draft text;
alter table public.calendar_tasks add column if not exists check_ms bigint;
alter table public.calendar_tasks add column if not exists checks smallint not null default 0;
alter table public.calendar_tasks add column if not exists asked_ms bigint;
alter table public.calendar_tasks add column if not exists sent_ms bigint;
alter table public.calendar_tasks add column if not exists came boolean not null default false;

do $$ begin
  alter table public.calendar_tasks add constraint calendar_tasks_wait_words check (
    (who_name is null or char_length(who_name) between 1 and 60)
    and (who_reach is null or char_length(who_reach) between 3 and 254)
    and (draft is null or char_length(draft) <= 600));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.calendar_tasks add constraint calendar_tasks_wait_checks check (checks between 0 and 20);
exception when duplicate_object then null; end $$;

-- The check-back job: open waits whose check is due, soonest first. The page: one person's open waits.
create index if not exists calendar_tasks_wait_due_idx on public.calendar_tasks (check_ms) where kind = 'wait' and not done and check_ms is not null;
create index if not exists calendar_tasks_wait_user_idx on public.calendar_tasks (user_id) where kind = 'wait' and not done;
-- The clean-up: sorted waits past their 30 days.
create index if not exists calendar_tasks_wait_done_idx on public.calendar_tasks (done_ms) where kind = 'wait' and done;
