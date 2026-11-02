-- Sign in with Apple, ended when the account is (src/auth/appleSignIn.ts): the refresh token Apple gives for the one-time code the phone
-- got at sign-in, kept only to revoke the sign-in at Apple when the person deletes their account. Encrypted (AES-256-GCM, "v1.<base64url>",
-- under CONNECTOR_TOKEN_KEY); gone with the account.
create table if not exists public.apple_sign_in (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  refresh_enc  text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Only the server (service role) reads or writes it.
alter table public.apple_sign_in enable row level security;
