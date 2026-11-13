-- Tailzu — the mail bot in Spaces (src/mail/access.ts, docs/mail.md, docs/spaces.md): whose each business is, and the addresses its owner
-- gave members of their spaces to answer.
--
-- mail_businesses   one row a business on the mail bot: its id (the mail worker's, unique across every account) and the person who owns
--                   it. Kept when they make it, and filled in for an older business whenever its owner's list is read. Through it a space's
--                   admin reaches a member's businesses (everything, read and write), and every call for a business is made inside its
--                   owner's account, whoever asks
-- mail_handlers     one row an address its owner gave a member of their spaces to answer ("Ravi answers support@"): the business, its
--                   owner, the address (its id at the mail worker and its email) and the member, who then sees and answers only that
--                   address's mail. A row does nothing while that person is not a member of a space the owner is the admin of (they
--                   left, a block, Spaces off): it works again once they are. It goes when the owner takes the address back, removes the
--                   address or the business (routes/bots/mail.ts), or either account goes (on delete cascade)
--
-- Written and read by the server with the service key only: row level security is on and there is no policy, so no token reads or writes
-- them.
--
-- Run in your Supabase SQL editor after 0083. It can be run again. A server with no Supabase keeps these in memory, and a restart forgets
-- them; one with Supabase and without this migration reaches only each person's own businesses (nobody else's, as before) until it is run.

create table if not exists public.mail_businesses (
  business_id text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz default now()
);

create index if not exists mail_businesses_user_idx on public.mail_businesses (user_id);

alter table public.mail_businesses enable row level security;

create table if not exists public.mail_handlers (
  id            bigserial primary key,
  business_id   text not null,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  address_id    integer not null,
  address_email text not null,
  member_id     uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (business_id, address_id, member_id)
);

create index if not exists mail_handlers_member_idx on public.mail_handlers (member_id);

alter table public.mail_handlers enable row level security;
