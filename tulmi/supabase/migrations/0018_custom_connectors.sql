-- Tailzu — apps a person adds themselves, by link (src/connectors, CUSTOM_CONNECTORS).
--
-- Run in your Supabase SQL editor after 0017, before switching CUSTOM_CONNECTORS on.
--
-- connector_custom  one row per app a person added: its name, its MCP server
--                   (https), whether that server asked for a sign-in, and the
--                   person's own OAuth client if they gave one (the secret
--                   encrypted by the server with CONNECTOR_TOKEN_KEY, like a
--                   token). Its id, "c_" and a UUID, is the connector id the
--                   app goes by in connector_connections, assistant_tasks and
--                   assistant_audit, so those tables need nothing new to hold it.
--
-- mcp_directory     More apps: the remote MCP servers in the official MCP
--                   Registry that an app added by link could connect to,
--                   synced by the server every 12 hours (src/connectors/registry.ts).
--                   Public data, nobody's own; read and written by the server only.
-- mcp_directory_sync  one row: when the last sync that finished had started,
--                   so the next one asks only for what changed since.
--
-- And three columns on connector_connections, used by those apps only:
--   tool_policy    {"tool name": "allow" | "ask" | "off"}: the person's choice
--                  per tool. A tool not named here starts where the server's
--                  code puts it (ask, unless plainly read-only).
--   tools_pin      {"list": sha256, "tools": {"tool name": sha256}}: the tools
--                  as the person approved them. Null until first listed.
--   tools_changed  tools new or changed since that pin: kept from the
--                  assistant until the person looks and accepts.
--
-- Written by the server with the service key only. A person's own token can
-- READ their rows (the policy below) and nothing else.

create table if not exists public.connector_custom (
  id                 text primary key
                     default ('c_' || gen_random_uuid()::text)
                     check (id ~ '^c_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  user_id            uuid not null references auth.users (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 40),
  url                text not null check (url ~ '^https://' and char_length(url) <= 2048),
  -- oauth: the server answered 401, so it is signed in to.  none: it answered without asking.
  auth               text not null default 'oauth' check (auth in ('oauth', 'none')),
  -- The person's own OAuth client, when they gave one. An id is not a secret.
  client_id          text check (client_id is null or char_length(client_id) <= 512),
  -- AES-256-GCM, "v1.<base64url>". Null when there is no secret.
  client_secret_enc  text,
  -- The auth server that client is tied to, from its first sign-in on; never shown to another.
  client_issuer      text,
  -- The MCP Registry entry it was added from, if any ("io.github.someone/server").
  registry_name      text,
  -- Where its last sign-in sent the person ("auth.example.com"): said before the
  -- browser opens, and a sign-in that would go anywhere else is stopped first.
  sign_in_host       text check (sign_in_host is null or char_length(sign_in_host) <= 255),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists connector_custom_user_idx on public.connector_custom (user_id, created_at);

alter table public.connector_connections
  add column if not exists tool_policy   jsonb  not null default '{}'::jsonb,
  add column if not exists tools_pin     jsonb,
  add column if not exists tools_changed text[] not null default '{}';

alter table public.connector_custom enable row level security;

drop policy if exists "users read own custom connectors" on public.connector_custom;
create policy "users read own custom connectors"
  on public.connector_custom for select
  using (auth.uid() = user_id);

create table if not exists public.mcp_directory (
  -- The registry's name ("com.example/mcp"): what an app added from it records.
  name             text primary key check (char_length(name) between 1 and 200),
  title            text not null,
  description      text not null default '',
  -- Its Streamable HTTP address. Checked again, DNS and all, when someone adds it.
  url              text not null check (url ~ '^https://' and char_length(url) <= 2048),
  host             text not null,
  website          text,
  -- As the registry gave it. Never fetched by the server.
  icon             text,
  -- The reverse-DNS name is the remote's own domain: shown first, trusted no more.
  verified_domain  boolean not null default false,
  -- When the registry last changed it.
  updated_at       timestamptz not null
);

-- Search reads title, name and description with ilike: a scan of some 30,000
-- short rows, fine at this size. The order of a page:
create index if not exists mcp_directory_rank_idx on public.mcp_directory (verified_domain desc, title, name);

create table if not exists public.mcp_directory_sync (
  id           smallint primary key default 1 check (id = 1),
  synced_from  timestamptz not null
);

-- No policies: only the server's service key reads or writes these.
alter table public.mcp_directory enable row level security;
alter table public.mcp_directory_sync enable row level security;
