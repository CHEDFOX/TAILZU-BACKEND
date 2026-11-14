-- Abuse and fraud prevention (docs/trust.md): the KIND of network a request comes from, how many accounts come from it, and
-- what Apple and Google answer about the app. Not tracking, not ads, not analytics, and never a device or person id built
-- from device or network traits.
--
-- NO RAW ADDRESS IS STORED ANYWHERE. A network is held as HMAC-SHA256(TRUST_HASH_KEY, "n1|" + address) cut to 16 bytes: the
-- whole address for IPv4, the /64 for IPv6. The same keyed hash makes the email and install keys. Be honest about what that
-- is: it is pseudonymous, not anonymous — IPv4 has only 2^32 values, so whoever holds the key could test an address against a
-- row. So the key lives only in the server's .env, these rows are treated as personal data (30 days, deleted with the
-- account, named in the privacy policy), and the policy says "keyed hash", never "anonymous".
--
-- COUNTED, NEVER JOINED. These tables are read for COUNTS and for the one account being looked at. Nothing in the server can
-- list the other accounts behind a network key, an install key or an email hash, no action on one account spreads to the
-- accounts that shared a key with it, and the admin route answers counts only.
--
-- A sweeper (src/trust/sweeper.ts) drops everything older than 30 days, whether or not anyone opens the app. Row level
-- security is on with NO policy on every table, so only the service key reaches them: no client, signed in or not, can read
-- a row. Deleting the account takes its rows with it (every user_id cascades); the tombstones hold no user id at all.

-- One row a (network, account, day): which kind of network, which operator, how many requests, first and last seen.
create table if not exists public.trust_net_seen (
  net_key    bytea not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  asn        integer,
  net_class  text not null default 'unknown'
             check (net_class in ('home', 'mobile', 'hosting', 'vpn', 'tor', 'relay', 'unknown')),
  -- Whether this account was NEW (under a week old) when it was seen here. The counts count only these rows, because the
  -- signal is "accounts are being MADE on this line" — counting every account on it would score a shared home, an office
  -- or a mobile operator for being busy, and the honest new sign-up in that house for its neighbours.
  new_acct   boolean not null default false,
  hits       integer not null default 1 check (hits >= 0),
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (net_key, user_id, day)
);

-- The sweeper's read, and the "this account's own rows" read.
create index if not exists trust_net_seen_day_idx on public.trust_net_seen (day);
create index if not exists trust_net_seen_user_idx on public.trust_net_seen (user_id);

-- The install number the app made at first launch (docs/trust.md 8.4), hashed. A random v4 UUID with no input from the
-- device, which resets on reinstall; written only while the `trust.installId` flag is on.
create table if not exists public.trust_device_seen (
  device_key bytea not null,
  kind       text not null check (kind in ('install')),
  user_id    uuid not null references auth.users (id) on delete cascade,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  primary key (device_key, kind, user_id)
);

create index if not exists trust_device_seen_last_idx on public.trust_device_seen (last_at);
create index if not exists trust_device_seen_user_idx on public.trust_device_seen (user_id);

-- What a deleted account leaves for 30 days, so deleting and signing up again does not reset the free plan: a one-way hash
-- of its email address, and of that install number. NO USER ID, and nothing else. Nothing attestation-derived is ever
-- tombstoned (docs/trust.md §tombstones).
create table if not exists public.trust_tombstones (
  key        bytea not null,
  kind       text not null check (kind in ('email', 'install')),
  deleted_at timestamptz not null default now(),
  primary key (key, kind)
);

create index if not exists trust_tombstones_deleted_idx on public.trust_tombstones (deleted_at);

-- App Attest's keys: one per account per install, made in the phone's Secure Enclave. The public key and the counter it
-- signs with, never the attestation itself and never a device id (Apple's licence forbids deriving one).
create table if not exists public.trust_attest_keys (
  key_id       text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  public_key   bytea not null,
  sign_count   bigint not null default 0 check (sign_count >= 0),
  env          text not null default 'production' check (env in ('production', 'development')),
  receipt      bytea,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists trust_attest_keys_user_idx on public.trust_attest_keys (user_id);
create index if not exists trust_attest_keys_used_idx on public.trust_attest_keys (last_used_at);

-- The latest score for one account, the reasons it is made of, the action it reached, and the verdict SUMMARIES: never a
-- device token, an integrity token or anything that could be turned into an id.
--   verdicts: { "appAttest": "ok" | "fail" | "none",
--               "deviceCheck": { "bit0": bool, "bit1": bool, "month": "2026-11", "setByUs": bool },
--               "integrity": { "app": "...", "device": ["..."], "licence": "..." },
--               "at": { "appAttest": ms, "deviceCheck": ms, "integrity": ms },
--               "deviceReset": bool }
--
-- The row lives as long as the account and is worked out again on every launch, but the ANSWERS on it do not: the policy
-- says Apple's and Google's answers are kept 30 days, so each is stamped in `at` and the sweeper drops it when it is due.
-- `verdicts_at` is the oldest of those stamps, so the sweeper can find the rows that need it without reading every one;
-- `updated_at` cannot do that job, because every launch refreshes it. `deviceReset` is not an answer but an instruction:
-- an admin cleared this account for a second-hand phone, so Apple's own two bits are cleared at the next pass.
create table if not exists public.trust_scores (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  score       smallint not null default 0,
  reasons     text[] not null default '{}',
  action      text not null default 'none' check (action in ('none', 'log', 'slow', 'hold', 'ask')),
  verdicts    jsonb not null default '{}'::jsonb check (jsonb_typeof(verdicts) = 'object'),
  verdicts_at timestamptz,
  updated_at  timestamptz not null default now()
);

create index if not exists trust_scores_verdicts_at_idx on public.trust_scores (verdicts_at);

alter table public.trust_net_seen     enable row level security;   -- no policy: service key only
alter table public.trust_device_seen  enable row level security;   -- no policy: service key only
alter table public.trust_tombstones   enable row level security;   -- no policy: service key only
alter table public.trust_attest_keys  enable row level security;   -- no policy: service key only
alter table public.trust_scores       enable row level security;   -- no policy: service key only
