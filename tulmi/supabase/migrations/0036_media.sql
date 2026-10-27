-- Tailzu — media and files ingestion: what is known of every file a person attached, and its text in searchable pieces (src/media, docs/media.md).
--
-- Run in your Supabase SQL editor before turning MEDIA_INGEST on. It needs nothing from the other migrations. It can be run again. Without it the
-- media feature keeps its rows in memory and a restart forgets them (the bytes in R2 stay, but nothing knows what they are).
--
-- media_items   one row for each file a person has had read: whose, the SHA-256 of the file as it came (a file is READ ONCE: the same bytes for the same person
--               are never read again), what it is (kind and format, found from its bytes and never from its name), its size, the text taken out of it, what
--               else is known (pages, duration, width and height, the sheets' rows, a zip's entries, a video's key frames, notes said to the person), the
--               key of its bytes in the R2 bucket, whether the person keeps it, and when it expires. Thirty days unless kept: the server deletes the expired
--               rows and their bytes. A password-protected file, a bomb or a kind we do not read never gets a row.
-- media_chunks  the text cut into pieces of about 900 characters, with the heading each sits under and the page it came from. `tsv` is generated (the
--               'simple' text-search configuration: no stemming and no stop words, so English, Hindi and Hinglish are treated alike) and has a GIN
--               index. A question about a file reads only the chunks media_search ranks highest for its words, never the whole text.
-- media_search  (user, item, words, limit) -> the best chunks. Each word matches itself and any word that starts with it (three letters or more),
--               ranked with ts_rank_cd. Words are quoted, so a question cannot inject query syntax.
--
-- Text that looked like it held a secret (the policy's scanner) is replaced by a marker before it is stored: it is never in the database.
--
-- Written by the server with the service key only. OWNER-ONLY: a person's own token can READ their own rows and nothing else; there is no policy
-- that lets a token write. Rows go with the account (on delete cascade); the bytes in R2 are deleted by the server when an account is deleted.

create table if not exists public.media_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  kind        text not null check (kind in ('image', 'pdf', 'document', 'presentation', 'spreadsheet', 'data', 'text', 'code', 'audio', 'video', 'archive')),
  format      text not null check (char_length(format) between 1 and 20),
  mime        text not null check (char_length(mime) between 1 and 100),
  name        text not null check (char_length(name) between 1 and 200),
  bytes       bigint not null check (bytes >= 0),
  text        text not null default '' check (char_length(text) <= 450000),
  text_chars  integer not null default 0 check (text_chars >= 0),
  meta        jsonb not null default '{}'::jsonb,
  blob_key    text check (blob_key is null or char_length(blob_key) <= 200),
  keep        boolean not null default false,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (user_id, sha256)
);

-- A person's files, newest first; and the sweep's question: what has run out and is not kept.
create index if not exists media_items_user_idx   on public.media_items (user_id, created_at desc);
create index if not exists media_items_expiry_idx on public.media_items (expires_at) where not keep;

create table if not exists public.media_chunks (
  id       bigint generated always as identity primary key,
  item_id  uuid not null references public.media_items (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  seq      integer not null check (seq >= 0),
  text     text not null check (char_length(text) <= 4000),
  heading  text check (heading is null or char_length(heading) <= 200),
  page     integer check (page is null or page >= 0),
  tsv      tsvector generated always as (to_tsvector('simple', coalesce(heading, '') || ' ' || text)) stored,
  unique (item_id, seq)
);

create index if not exists media_chunks_tsv_idx  on public.media_chunks using gin (tsv);
create index if not exists media_chunks_user_idx on public.media_chunks (user_id);

create or replace function public.media_search(p_user uuid, p_item uuid, p_terms text[], p_limit integer default 6)
returns table (seq integer, text text, heading text, page integer, score real)
language sql
stable
as $$
  with terms as (
    select distinct lower(w) as t
    from unnest(coalesce(p_terms, '{}'::text[])) as w
    where w is not null and char_length(w) between 1 and 40 and w !~ '[''\\:&|!()<>*]'
    limit 16
  ),
  q as (
    select to_tsquery('simple', string_agg(case when char_length(t) >= 3 then quote_literal(t) || ':*' else quote_literal(t) end, ' | ')) as query
    from terms
  )
  select c.seq, c.text, c.heading, c.page, ts_rank_cd(c.tsv, q.query, 32)::real as score
  from public.media_chunks c, q
  where c.user_id = p_user and c.item_id = p_item and q.query is not null and c.tsv @@ q.query
  order by score desc, c.seq
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

alter table public.media_items  enable row level security;
alter table public.media_chunks enable row level security;

drop policy if exists "users read own media items" on public.media_items;
create policy "users read own media items"
  on public.media_items for select
  using (auth.uid() = user_id);

drop policy if exists "users read own media chunks" on public.media_chunks;
create policy "users read own media chunks"
  on public.media_chunks for select
  using (auth.uid() = user_id);
