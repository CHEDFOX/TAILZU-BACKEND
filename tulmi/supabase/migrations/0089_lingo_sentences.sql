-- Tailzu — Lingo's sentence bank (src/lingo/sentences.ts; docs/lingo.md).
-- Sentence pairs that EVERYONE shares, so a session can show a real sentence written by a person instead of one made
-- up on the spot. Nobody owns these rows: there is no user_id and nothing here is anybody's data. Poured in from a
-- public corpus by scripts/lingo-seed.ts, and safe to pour in again.
--
-- The licence and the author are kept PER ROW, because they differ per row: a corpus is thousands of people's
-- writing under whatever each of them chose. Without them the bank could not be credited and could not be filtered
-- down to the rows a paid product may use. `licence` is the SPDX-ish tag as the corpus gives it ("CC0-1.0",
-- "CC-BY-2.0-FR"); `author` is who to credit, empty where the licence asks for nobody.
create table if not exists public.lingo_sentences (
  id         bigserial primary key,
  lang       text not null,                     -- the language of `text`, BCP-47
  text       text not null,
  gloss_lang text not null,                     -- the language of `gloss`
  gloss      text not null,
  -- `text` folded the way src/lingo/grade.ts folds it: lower case, no punctuation, marks a writer leaves off taken
  -- away. Looking a word up means looking in here, so the lookup matches the marking and never disagrees with it.
  folded     text not null,
  words      smallint not null default 1,       -- how many words, for picking something the right size for a level
  licence    text not null,
  author     text not null default '',
  source     text not null default '',          -- which corpus, and the row's id in it, so a row can be traced back
  created_ms bigint not null
);
do $$ begin
  alter table public.lingo_sentences add constraint lingo_sentences_size
    check (char_length(text) between 1 and 400 and char_length(gloss) between 1 and 400);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.lingo_sentences add constraint lingo_sentences_langs
    check (char_length(lang) between 2 and 16 and char_length(gloss_lang) between 2 and 16 and lang <> gloss_lang);
exception when duplicate_object then null; end $$;
-- The same sentence from the same corpus is never poured in twice.
create unique index if not exists lingo_sentences_once on public.lingo_sentences (lang, gloss_lang, text, gloss);
-- What a session asks for: this pair, of about this length.
create index if not exists lingo_sentences_pair_idx on public.lingo_sentences (lang, gloss_lang, words);
-- Finding the sentences that use a word. `folded` is searched with LIKE, which works in EVERY script: a language
-- that puts no spaces between its words cannot be searched word by word, and a trigram index is not always there.
create index if not exists lingo_sentences_folded_idx on public.lingo_sentences (lang, gloss_lang, folded text_pattern_ops);

alter table public.lingo_sentences enable row level security;
do $$ begin
  -- Anybody signed in may read the bank: it is public material, the same for everyone. Only the server writes.
  create policy lingo_sentences_read on public.lingo_sentences for select using (true);
exception when duplicate_object then null; end $$;
-- Run in your Supabase SQL editor. It needs 0087 and can be run again.
