-- Tailzu — the names each file refers to, for the project brain's repo map (src/code/project/repomap.ts; docs/code-project-brain.md).
--
-- Run in your Supabase SQL editor after 0034, before (or together with) deploying the tree-sitter build. Needs 0028 (code_brain_files). It can be run again.
-- Until it is run the brain still builds: the store notices that the column is missing, says so once, and keeps everything else (the repo map
-- then has no references to rank by, and locate falls back to its other signals).
--
-- code_brain_files.refs   [[name, count], ...] for each file a parser read: the calls, instantiations, types, JSX tags and base classes it
--                         mentions, the most telling first, at most 120. Names, not files: which file a name means is decided when the map is made,
--                         against the definitions the repo has by then.

alter table public.code_brain_files add column if not exists refs jsonb not null default '[]'::jsonb;
