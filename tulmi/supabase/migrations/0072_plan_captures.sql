-- Tailzu — Plan Ease step 3: getting things in, and bills due (src/botsBots/planCapture.ts, planDue.ts; docs/plan-ease.md "Getting
-- things in", "Bills due").
--
-- plan_captures        what one share, drop or paste was read into: one card ("4 things from the school circular", Add all)
--   source             share | photo | pdf | text: how it came in
--   label              what it is, in a few words ("school circular", "electricity bill"): the card's title says "from the {label}"
--   file_id            the shared file (media, migration 0035). Deleted when the card is answered, and after 7 days at most, so a
--                      shared prescription or lab report is never kept longer than that
--   in_hash            what came in, hashed: the same share opened again shows the same card, not a second one
--   words              pasted or shared words (no file), kept only until the card is answered or its week is up, like a file
--   items              what was found: [{ id, kind: event|todo|due, title, day, time, end, place, before: { title, day },
--                      amount_paise, payee, pay_link, who, sure, tick, dupe }] (8 at most). Words found in what was shared, never
--                      sent anywhere else
--   state              reading | waiting (read after midnight, when today's reading is spent) | consent (waiting for the person's yes
--                      to AI) | ready | added | dismissed | failed
--   added              what Add all made ({ events: [], tasks: [], space: [] }), so Undo and "Take out all 4" take out the lot
--   paise              what reading it cost (Plan Ease's day, and the person's usage meter)
--   seen_ms            when the card was last on their screen (a card read after they left becomes a Needs-you card and one push)
--   told_ms            when that push went, or the evening note carried it; expires_ms: when it goes (7 days)
-- calendar_tasks  + amount_paise, payee, pay_link   a bill (kind 'due'): its amount (shown only in the app, on the person's own row),
--                                                   who it's paid to, and a pay link found word for word in what was shared (kept
--                                                   only for upi://pay links and known billers' pages: the Pay button)
--                 + repeat                          '' | 'monthly': a bill that comes each month (the next one is made when this one
--                                                   is paid or its day has gone, with no amount until its own bill comes)
--                 + prep_for                        a "before" step: the event or to-do it gets ready for
--                 + capture_id                      the capture that added it (Undo, "Take out all 4 from the circular")
-- calendar_events + capture_id                      the same, for an event
-- plan_prefs      + capture_day, capture_paise      what reading shares cost today (capped at ₹5, so the Plan Ease chat keeps the rest
--                                                   of its ₹8): kept here because the bot's own day meter lives in one server's memory
--
-- Everything is deleted with the account (on delete cascade). Run in your Supabase SQL editor after 0071_calendar_links.sql. It can be
-- run again. Older server code ignores these columns. Written by the server with the service key only.

create table if not exists public.plan_captures (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      text not null default 'share' check (source in ('share', 'photo', 'pdf', 'text')),
  label       text not null default '' check (char_length(label) <= 60),
  file_id     text check (file_id is null or char_length(file_id) <= 80),
  in_hash     text not null default '' check (char_length(in_hash) <= 64),
  words       text check (words is null or char_length(words) <= 40000),
  items       jsonb not null default '[]'::jsonb,
  state       text not null default 'reading' check (state in ('reading', 'waiting', 'consent', 'ready', 'added', 'dismissed', 'failed')),
  added       jsonb not null default '{}'::jsonb,
  paise       integer not null default 0 check (paise between 0 and 100000),
  seen_ms     bigint,
  told_ms     bigint,
  created_ms  bigint not null,
  updated_ms  bigint not null,
  expires_ms  bigint not null
);
do $$ begin
  alter table public.plan_captures add constraint plan_captures_shapes check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 8 and jsonb_typeof(added) = 'object');
exception when duplicate_object then null; end $$;
create index if not exists plan_captures_user_idx on public.plan_captures (user_id, created_ms desc);
create index if not exists plan_captures_expires_idx on public.plan_captures (expires_ms);

alter table public.calendar_tasks add column if not exists amount_paise bigint;
alter table public.calendar_tasks add column if not exists payee text;
alter table public.calendar_tasks add column if not exists pay_link text;
alter table public.calendar_tasks add column if not exists repeat text not null default '';
alter table public.calendar_tasks add column if not exists prep_for uuid;
alter table public.calendar_tasks add column if not exists capture_id uuid;
alter table public.calendar_events add column if not exists capture_id uuid;
do $$ begin
  alter table public.calendar_tasks add constraint calendar_tasks_due_shape check (
    (amount_paise is null or amount_paise between 0 and 10000000000)
    and (payee is null or char_length(payee) <= 80)
    and (pay_link is null or (char_length(pay_link) <= 600 and (pay_link like 'upi://pay?%' or pay_link like 'https://%')))
    and repeat in ('', 'monthly'));
exception when duplicate_object then null; end $$;
create index if not exists calendar_tasks_capture_idx on public.calendar_tasks (capture_id) where capture_id is not null;
create index if not exists calendar_events_capture_idx on public.calendar_events (capture_id) where capture_id is not null;

alter table public.plan_prefs add column if not exists capture_day text;
alter table public.plan_prefs add column if not exists capture_paise integer not null default 0;
do $$ begin
  alter table public.plan_prefs add constraint plan_prefs_capture check (capture_paise between 0 and 100000);
exception when duplicate_object then null; end $$;

alter table public.plan_captures enable row level security;
-- No policies: only the server (the service key) reads or writes these.
