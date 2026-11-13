-- Tailzu — the call judge (src/botsBots/planCallJudge.ts, planCallJudgeWords.ts; docs/plan-call-judge.md).
-- One row per item a person has on their Plan, while the judge works for them (their AI yes, their Calls on). It keeps the AI's verdict,
-- never the item: what was judged is only a hash. Deleted when the person takes back their AI yes (the seam's onAiConsentOff), with the
-- account (cascade), and 30 days after the item went (the fill's clean-up). Written by the server with the service key only.
create table if not exists public.plan_call_judgements (
  user_id      uuid not null references auth.users (id) on delete cascade,
  item         text not null,                     -- "e:<event row id>" (a series once) | "t:<task id>"
  sig          text not null,                     -- what was judged: 16 hex of sha256 over the judged fields
  state        text not null default 'judging',   -- judging | set | off | failed | done | gone | past
  call         boolean not null default false,
  at           text,                              -- leave_by | due | before:<5..1440>
  why          text not null default '',          -- the model's one-line reason: the call's bot reads it; never a push or a log
  usd          numeric(12,6) not null default 0,  -- what judging this item has cost, every judgement together (a record, never a limit)
  tries        smallint not null default 0,       -- failed judgements of this sig (3 at most)
  next_ring_ms bigint,                            -- the next judged ring; null when none is due
  ring_key     text,                              -- the occurrence next_ring_ms is for, then the one it rang: plan_calls.source_key
  changed_ms   bigint not null,                   -- when the item last changed
  judged_ms    bigint,
  updated_ms   bigint not null,                   -- every write after the insert is a compare-and-swap on it
  primary key (user_id, item)
);
do $$ begin
  alter table public.plan_call_judgements add constraint plan_call_judgements_state
    check (state in ('judging', 'set', 'off', 'failed', 'done', 'gone', 'past'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_call_judgements add constraint plan_call_judgements_at
    check (at is null or at in ('leave_by', 'due') or at ~ '^before:[0-9]{1,4}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.plan_call_judgements add constraint plan_call_judgements_why check (char_length(why) <= 160);
exception when duplicate_object then null; end $$;
create index if not exists plan_call_judgements_ring_idx on public.plan_call_judgements (next_ring_ms) where next_ring_ms is not null;
create index if not exists plan_call_judgements_state_idx on public.plan_call_judgements (state, updated_ms);
alter table public.plan_call_judgements enable row level security;
-- No policies: only the server (the service key) reads or writes these.
-- Run in your Supabase SQL editor. It needs 0081 and can be run again.
