-- Tailzu — web search: the cache of finished searches and our own coding index
-- (src/web/search/index.ts, docs/web-search.md).
--
-- Run in your Supabase SQL editor after 0026. Optional: without it search keeps
-- its cache and its index in memory (300 searches, 2,000 pages, gone when the
-- server restarts) and nothing else depends on it.
--
-- Two tables. Neither holds anything about a person: a search is cached by what
-- was asked, not by who asked, and the index holds documentation pages that are
-- public by design.
--
-- web_search_cache  key_hash    sha256 of the normalised plan: its intent, queries
--                               (lower case, sorted), sources, site and freshness,
--                               as hex. The key
--                   plan        jsonb: the plan that was searched
--                   results     jsonb: the ranked results, each with its score and
--                               the reasons for it
--                   expires_at  when it stops being served: 6 hours after the
--                               search, 24 for a package lookup. The server deletes
--                               expired rows as it writes new ones
--
-- web_index         id          one row per chunk of a page
--                   url_hash    sha256 of the page's normalised address (the same
--                               hash the page cache, 0026, uses)
--                   url         that address
--                   title       the page's title
--                   heading     the heading the chunk is under ('' before the first)
--                   chunk_no    0, 1, 2 ... in page order
--                   body        the chunk's text, about 1,500 characters of markdown
--                   lang        the page's language ('' when it does not say)
--                   source      what put it here: 'read' (a page the bot read) or
--                               'seed:<site>' (scripts/seed-web-index.ts)
--                   fetched_at  when the page was read. Rows older than 120 days
--                               are deleted by the server
--                   tsv         generated: the full text search document
--                               (title, heading and body, the 'simple' configuration:
--                               no stemming, no stop words, so code identifiers stay
--                               as written), with a GIN index. Never written to
--
-- A page's chunks are replaced together: the server writes the new ones over the
-- old by (url_hash, chunk_no) and then deletes any beyond them. Only pages from
-- documentation and public reference sites are ever indexed (the host list is in
-- src/web/search/catalog.ts), never an address whose query looks like a secret.
--
-- Written by the server with the service key only. Row-level security is on and
-- there are NO policies, so no person's own token can read or write any of it.

create table if not exists public.web_search_cache (
  key_hash   text primary key check (char_length(key_hash) = 64),
  plan       jsonb not null,
  results    jsonb not null,
  expires_at timestamptz not null
);

-- The sweep of expired rows, and the read that skips them.
create index if not exists web_search_cache_expires_at_idx on public.web_search_cache (expires_at);

alter table public.web_search_cache enable row level security;

create table if not exists public.web_index (
  id         bigint generated always as identity primary key,
  url_hash   text not null check (char_length(url_hash) = 64),
  url        text not null check (char_length(url) between 1 and 2048),
  title      text not null default '',
  heading    text not null default '',
  chunk_no   integer not null check (chunk_no >= 0),
  body       text not null check (char_length(body) between 1 and 4000),
  lang       text not null default '',
  source     text not null default 'read',
  fetched_at timestamptz not null default now(),
  tsv        tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(heading, '') || ' ' || body)
  ) stored,
  unique (url_hash, chunk_no)
);

create index if not exists web_index_tsv_idx on public.web_index using gin (tsv);
-- The sweep of old pages.
create index if not exists web_index_fetched_at_idx on public.web_index (fetched_at);

alter table public.web_index enable row level security;
