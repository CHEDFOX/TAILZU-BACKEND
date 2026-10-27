-- Tailzu — the front door's decision log: one row for every message it answered, and what became of it (src/front, docs/front-door.md).
--
-- Run in your Supabase SQL editor before turning FRONT_DOOR on, if you want the log kept (without it the front door keeps the log in
-- memory, and a restart forgets it, and what it learns from it). It needs nothing from the other migrations. It can be run again.
--
-- front_decisions  user_id      whose message it was (the row goes with the account)
--                  at           when it was decided
--                  intent       what the message was taken for: chat, answer, code_question, code_task, design, research, plan, file_question, unclear
--                  route        where it went: reply, file, code_answer, code_job, artifact, research, plan
--                  tier         the model tier of the road: tiny, cheap, code, strong, review, vision, indic
--                  visual       the kind of visual that came with the answer (table, diagram, chart, component, page), or null
--                  confidence   how sure the front door was of the intent, 0 to 1
--                  cost_paise   what the message cost in all, in paise
--                  latency_ms   how long it took
--                  outcome      ok (nothing happened to it after), rephrased (the person sent a similar message within 60 seconds), visual_closed
--                               or visual_kept (what they did with the visual), thumbs_up, thumbs_down
--                  via          rules (decided by the free rules alone) or model (the small model was asked)
--
-- NOTHING THEY SAID OR WERE ANSWERED IS HERE: no message, no reply, no file name. Categories and numbers only, which is what lets the
-- front door learn from it (a person's habit with visuals, how far each rule is trusted) without anyone reading anyone's words.
--
-- Written by the server with the service key only. A person's own token can READ their own rows and nothing else (owner-read RLS); there is no
-- policy that lets a token write. Rows older than 90 days are of no use to the learning (it reads the last 30 days) and can be deleted:
--   delete from public.front_decisions where at < now() - interval '90 days';

create table if not exists public.front_decisions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  at          timestamptz not null default now(),
  intent      text not null check (intent in ('chat', 'answer', 'code_question', 'code_task', 'design', 'research', 'plan', 'file_question', 'unclear')),
  route       text not null check (route in ('reply', 'file', 'code_answer', 'code_job', 'artifact', 'research', 'plan')),
  tier        text not null check (tier in ('tiny', 'cheap', 'code', 'strong', 'review', 'vision', 'indic')),
  visual      text check (visual is null or visual in ('table', 'diagram', 'chart', 'component', 'page')),
  confidence  real not null check (confidence >= 0 and confidence <= 1),
  cost_paise  integer not null default 0 check (cost_paise >= 0),
  latency_ms  integer not null default 0 check (latency_ms >= 0),
  outcome     text not null default 'ok' check (outcome in ('ok', 'rephrased', 'visual_closed', 'visual_kept', 'thumbs_up', 'thumbs_down')),
  via         text not null default 'rules' check (via in ('rules', 'model'))
);

-- A person's latest rows: what the learning reads, and what their own token lists.
create index if not exists front_decisions_user_at_idx on public.front_decisions (user_id, at desc);

alter table public.front_decisions enable row level security;

drop policy if exists "users read own front decisions" on public.front_decisions;
create policy "users read own front decisions"
  on public.front_decisions for select
  using (auth.uid() = user_id);
