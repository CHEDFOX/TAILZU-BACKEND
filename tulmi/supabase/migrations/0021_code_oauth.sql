-- Tailzu — the Code bot's other way in: "Sign in with GitHub" (src/code/oauth.ts, CODE_GITHUB_OAUTH).
--
-- Run in your Supabase SQL editor after 0020, before switching CODE_GITHUB_OAUTH on.
--
-- code_oauth_links  one row per person who signed in with GitHub: who they are
--                   there (id and login), the scopes the token has, and THE
--                   TOKEN ITSELF, encrypted by the server with CONNECTOR_TOKEN_KEY
--                   (AES-256-GCM, like every other stored token). It is the only
--                   place a GitHub token is kept at all, and the most powerful
--                   thing in this schema: a classic OAuth token reaches all of
--                   a person's repos. So:
--                     - NO POLICY. Not even "a person reads their own row":
--                       a person's own token could then select token_enc.
--                       Only the server's service key reads or writes this table;
--                     - the server revokes the token at GitHub when the person
--                       disconnects, when their account is deleted, and when it
--                       has gone 30 days unused, and then drops it (token_enc is
--                       set to null; status 'needs_signin' says they must sign in
--                       again);
--                     - last_used_at is the last use, to the hour.
-- code_projects.link_kind
--                   which link a project goes through: 'app' (a GitHub App
--                   install, installation_id) or 'oauth' (the person's sign-in;
--                   installation_id is 0, there is no install).
--
-- Written by the server with the service key only.

create table if not exists public.code_oauth_links (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  github_user_id bigint not null,
  github_login   text not null check (char_length(github_login) between 1 and 100),
  -- AES-256-GCM, "v1.<base64url>". Null once revoked or found dead.
  token_enc      text,
  -- As GitHub said them: "repo, read:user".
  scope          text not null default '',
  status         text not null default 'active' check (status in ('active', 'needs_signin')),
  last_used_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The expiry sweep and the kill switch read the links that still hold a token.
create index if not exists code_oauth_links_token_idx on public.code_oauth_links (user_id) where token_enc is not null;

alter table public.code_oauth_links enable row level security;
-- (no policies: see above)

alter table public.code_projects
  add column if not exists link_kind text not null default 'app' check (link_kind in ('app', 'oauth'));
