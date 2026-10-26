-- Tailzu — the page reader's cache (src/web/cache.ts, docs/web-reader.md).
--
-- Run in your Supabase SQL editor after 0025. Optional: without it the reader
-- keeps read pages in memory (500 of them, gone when the server restarts) and
-- nothing else depends on it.
--
-- When Tailzu reads a web page for the Code bot's search tools, or for a person,
-- what comes out of it (the page as markdown, its headings and its links; never
-- the raw HTML) is kept here so the next read of the same address costs nothing.
-- One row per address:
--
-- web_pages  url_hash    sha256 of the address, normalised (lower-case host, no
--                        #fragment, sorted query), as hex. The key
--            url         that normalised address
--            final_url   where the page really was, after redirects
--            title       the page's title ('' when it has none)
--            lang        the language it says it is in ('' when it does not)
--            body        jsonb: text, headings, links, codeBlocks, contentType,
--                        bytes, truncated
--            via         how it was read: 'fetch' or 'browser'
--            fetched_at  when it was read
--            expires_at  when it stops being served: WEB_CACHE_TTL_MIN after it
--                        was read (6 hours unless set), a day or more for
--                        documentation hosts. The server deletes expired rows
--                        as it writes new ones
--
-- Nothing in a row belongs to a person: the reader sends no cookie and no login,
-- so everyone gets the same page, and an address whose query holds a token, key
-- or signature is never kept at all. Written by the server with the service key
-- only. Row-level security is on and there are NO policies, so no person's own
-- token can read or write any of it.

create table if not exists public.web_pages (
  url_hash   text primary key check (char_length(url_hash) = 64),
  url        text not null check (char_length(url) between 1 and 2048),
  final_url  text not null check (char_length(final_url) between 1 and 2048),
  title      text not null default '',
  lang       text not null default '',
  body       jsonb not null,
  via        text not null check (via in ('fetch', 'browser')),
  fetched_at timestamptz not null,
  expires_at timestamptz not null
);

-- The sweep of expired rows, and the read that skips them.
create index if not exists web_pages_expires_at_idx on public.web_pages (expires_at);

alter table public.web_pages enable row level security;
