import asyncio
import asyncpg
from app.core.config import settings

_pool = None

SCHEMA = """
create table if not exists profiles (
  id text primary key,
  email text,
  full_name text,
  persona text,
  updated_at timestamptz default now()
);
create table if not exists conversations (
  id text primary key,
  user_id text not null,
  title text,
  system text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists messages (
  id bigserial primary key,
  conversation_id text not null,
  user_id text not null,
  role text not null,
  content text not null,
  mode text,
  created_at timestamptz default now()
);
create index if not exists conversations_user_idx on conversations (user_id, updated_at desc);
create index if not exists messages_convo_idx on messages (conversation_id, created_at);
create index if not exists messages_user_idx on messages (user_id, created_at desc);
-- The user's chosen divination system (vedic/western/chinese) is the single
-- source of truth for their whole experience. `system_token` is the client-minted
-- binding token mirrored from the device. Idempotent: profiles already exists in
-- Supabase with the onboarding columns; these just add the new fields if missing.
alter table profiles add column if not exists system text;
alter table profiles add column if not exists system_token text;
-- PRESENCE — when this person was last in the app, and from what.
alter table profiles add column if not exists first_seen_at timestamptz;
alter table profiles add column if not exists last_seen_at timestamptz;
alter table profiles add column if not exists last_platform text;
alter table profiles add column if not exists last_app_version text;
create index if not exists profiles_last_seen_idx on profiles (last_seen_at desc);
-- ORACLE MEMORY — the per-user, topic-sharded portraits that used to live only on
-- the server filesystem. DB-backed so it's account-durable (keyed on the verified
-- user id), survives server migrations, and is shared by chat AND feature readings.
-- user_key = "uid:<supabase id>" when authenticated, else "bh:<birth hash>".
create table if not exists oracle_memory (
  user_key text not null,
  system text not null,
  topic text not null,
  portrait text not null,
  message_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_key, system, topic)
);
create index if not exists oracle_memory_key_idx on oracle_memory (user_key, system);
-- COMPATIBILITY RECORDS — every partner compatibility check a user runs, WITH the
-- other person's full birth/kundli input, kept for our records (admin-only access).
-- partner_data holds whatever chart data was submitted for the other person.
create table if not exists compatibility_records (
  id bigserial primary key,
  user_id text not null,
  partner_name text,
  partner_data jsonb,
  system text,
  score int,
  summary text,
  mode text,
  created_at timestamptz default now()
);
create index if not exists compat_records_user_idx on compatibility_records (user_id, created_at desc);
create index if not exists compat_records_time_idx on compatibility_records (created_at desc);
-- PAYMENTS — the entitlement row both webhooks write and both readers read. Every
-- column any writer has ever used is here, because a missing one makes PostgREST
-- reject the whole upsert and a writer goes silent for good.
create table if not exists payments (
  user_id text primary key,
  is_pro boolean,
  is_active boolean,
  product_id text,
  plan text,
  last_event text,
  event_type text,
  expires_at timestamptz,
  expires_at_ms bigint,
  source text,
  updated_at timestamptz default now()
);
alter table payments add column if not exists is_pro boolean;
alter table payments add column if not exists is_active boolean;
alter table payments add column if not exists product_id text;
alter table payments add column if not exists plan text;
alter table payments add column if not exists last_event text;
alter table payments add column if not exists event_type text;
alter table payments add column if not exists expires_at timestamptz;
alter table payments add column if not exists expires_at_ms bigint;
alter table payments add column if not exists source text;
alter table payments add column if not exists updated_at timestamptz default now();
-- The subscription's own facts, so the row answers "what is this person's plan
-- and when does it run out" without anyone having to know the entitlement rule.
alter table payments add column if not exists status text;
alter table payments add column if not exists auto_renew boolean;
alter table payments add column if not exists period_type text;
alter table payments add column if not exists entitlement text;
alter table payments add column if not exists store text;
alter table payments add column if not exists environment text;
alter table payments add column if not exists price numeric;
alter table payments add column if not exists currency text;
alter table payments add column if not exists started_at timestamptz;
alter table payments add column if not exists renewed_at timestamptz;
alter table payments add column if not exists cancelled_at timestamptz;
alter table payments add column if not exists cancel_reason text;
alter table payments add column if not exists original_transaction_id text;
create index if not exists payments_expires_idx on payments (expires_at);
-- SUBSCRIPTION EVENTS — append-only history, one row per webhook, verbatim.
create table if not exists subscription_events (
  id bigserial primary key,
  user_id text not null,
  source text,
  event_type text,
  product_id text,
  status text,
  store text,
  environment text,
  period_type text,
  expires_at timestamptz,
  price numeric,
  currency text,
  raw jsonb,
  received_at timestamptz default now()
);
create index if not exists subscription_events_user_idx on subscription_events (user_id, received_at desc);
-- LOCK THE DOOR. Supabase grants the anon role SELECT on new public tables by
-- default, and these two hold who pays what. Row-level security with NO policies
-- means the anon and authenticated roles read nothing; the service role — which
-- is what the backend uses — bypasses RLS and is unaffected.
alter table payments enable row level security;
alter table subscription_events enable row level security;
-- PostgREST caches the schema. Columns added here are invisible to the REST API
-- until it reloads, and an upsert naming one of them fails with "column not found
-- in schema cache" — the exact silent failure this table has already suffered
-- once. Ask it to reload every time the schema runs.
notify pgrst, 'reload schema';
"""

_init_lock = asyncio.Lock()


async def init_db():
    global _pool
    async with _init_lock:              # two first callers must not each create a pool
        if _pool:
            return
        dsn = settings.DATABASE_URL
        if not dsn:
            raise RuntimeError("DATABASE_URL not set")
        pool_ = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=10)
        async with pool_.acquire() as con:
            await con.execute(SCHEMA)
        _pool = pool_

async def pool():
    if _pool is None:
        await init_db()
    return _pool
