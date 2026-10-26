-- Tailzu — GitHub's free computers for the Code bot's jobs (src/code/jobs/githubActions.ts).
--
-- Run in your Supabase SQL editor after 0023, before turning on GitHub's free
-- computers (the App needs Workflows: write and Actions: read: docs/github-app.md,
-- section 9). Without it the router cannot read or write the one flag below, so
-- it keeps choosing GitHub for a person whose free minutes are used up (a step
-- that never ran is still moved after three minutes, but the next one tries
-- GitHub again).
--
-- A step that runs on GitHub's free computers is a push of a throwaway
-- `tailzu-run/` branch in the person's own repo. When that push never starts a
-- run (three minutes), or a run ends without reporting back, the free minutes
-- are most likely used up (or Actions is off), and the router must stop sending
-- that person's steps to GitHub for the rest of the month:
--
-- code_compute_usage.github_exhausted  true for a person and month (UTC) once
--                        that has happened. Read and written on its own by the
--                        server (it is not part of the usage figures). The month
--                        turning over gives GitHub back: the flag belongs to a
--                        month, so there is nothing to reset.
--
-- Written by the server with the service key only; a person's own token can
-- read their own rows, as before (the policy from 0023 covers the new column).

alter table public.code_compute_usage
  add column if not exists github_exhausted boolean not null default false;
