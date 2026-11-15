-- Tailzu — SHARING A PLAN (src/billing/planShare.ts, docs/plan-share.md).
--
-- A plan is a month's allowance of spend on ONE account. Sharing it means other accounts draw on that same allowance: one shared
-- pot, no per-seat price and no seat count, because the allowance itself is the ceiling. Sharing with thirty people cannot cost
-- more than sharing with one; it only empties sooner. Nothing else is shared — not chats, not bots, not things.
--
--   plan_shares       who is on whose plan. One row per person on it. A person may be on at most ONE plan: the single-plan rule
--                     is enforced in the service (billing/planShare.ts), because the key here can only stop the same pair twice
--   plan_share_asks   someone asking to be put on a plan. `promised` is the whole of "they have to buy and then can share": the
--                     owner said yes with no plan of their own, and the ask becomes a real share the moment one is granted
--                     (billing/entitlements.ts, billing/razorpay.ts)
--
-- Written and read by the server with the service key only: row level security is on and there is no policy, so no token reads or
-- writes either table (the same as plan_busy and reminders_gone in 0094, and rooms in 0091). Rows go with the account
-- (on delete cascade), from both ends: deleting an owner takes everyone off their plan, deleting a member takes them off it.
--
-- Run in your Supabase SQL editor after 0095. It can be run again. Without it PLAN_SHARE can stay off and nothing changes;
-- with the switch on and no tables, every share route answers politely and `payerFor` answers "themselves".

-- ---------------------------------------------------------------- who is on whose plan
create table if not exists public.plan_shares (
  owner_id   uuid not null references auth.users(id) on delete cascade,
  member_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id)
);

-- "Whose plan am I on?", asked on every metered request through a short in-process cache (billing/planShare.ts payerFor).
create index if not exists plan_shares_member_idx on public.plan_shares (member_id);

alter table public.plan_shares enable row level security;   -- no policy: service key only

-- ---------------------------------------------------------------- someone asking to be put on a plan
create table if not exists public.plan_share_asks (
  id          uuid primary key default gen_random_uuid(),
  asker_id    uuid not null references auth.users(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  about       text,          -- "Diwali party": the second line of the card. Never required.
  state       text not null default 'waiting',
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
-- waiting   they have not answered
-- promised  they said yes but have no plan yet; it becomes `shared` the moment they buy one
-- shared | declined | withdrawn   finished

-- One open ask between the same two people at a time: asking again while one waits changes nothing.
create unique index if not exists plan_share_asks_open_idx
  on public.plan_share_asks (asker_id, owner_id) where state in ('waiting', 'promised');
-- The owner's own list ("waiting for my answer"), and the promised ones a grant turns into shares.
create index if not exists plan_share_asks_owner_idx on public.plan_share_asks (owner_id, state);

alter table public.plan_share_asks enable row level security;   -- no policy: service key only

comment on table public.plan_shares is
  'Who draws on whose month (billing/planShare.ts). The member''s own live entitlement always wins; only someone with none draws '
  'on another''s. A row whose owner''s plan has lapsed simply stops resolving, so renewing brings everyone back without asking again.';

-- ---------------------------------------------------------------- who on a shared plan a spend row was
--
-- The spend of everyone on a plan is written against the OWNER's account (you/limits.ts `record` keys on `payerFor`), because the
-- owner's month is the one allowance and one pot cannot be added up from thirty places on every request. That alone would lose who
-- did what, and the owner's own screen says "Rahul · Used 12% this month" — so the row carries the person it was really for when
-- that is not the account it is written against. Null on every row that is the account's own, which is every row that exists today.
--
-- Nothing about it is shown to the member: it is the owner's own list of who on their plan used what, and it says a share of the
-- month, never an amount. It goes with the account like every other row here; when the person is deleted, what they spent stays on
-- the owner's month with nobody's name on it.
alter table public.you_spend add column if not exists by uuid references auth.users (id) on delete set null;
create index if not exists you_spend_by_idx on public.you_spend (user_id, by, at desc) where by is not null;
