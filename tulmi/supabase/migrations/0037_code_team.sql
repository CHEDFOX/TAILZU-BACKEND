-- Tailzu — lead and helpers mode (src/code/team; docs/code-team.md): the person's choice, per project, of whether a big goal becomes a team's work.
--
-- Run in your Supabase SQL editor after 0036 (it needs 0034, code_project_settings). It can be run again. Until it is run the other settings are still kept, every
-- project is "auto", and an attempt to set the team to "on" or "off" says so instead of pretending.
--
-- code_project_settings.team   'auto' (the default: a plan over 12 files or 3 features, or a goal over several projects, is split into parts that helpers build in
--                              parallel), 'on' (always) or 'off' (never: a job is always one job)
--
-- A lead's team itself (its parts, their statuses and money) is in the lead job's checkpoint (code_jobs.checkpoint -> agent -> team), and what the person said to
-- it (stop a part, run it again) in code_jobs.checkpoint -> teamCommands: no new table. A helper is an ordinary row of code_jobs.

alter table public.code_project_settings add column if not exists team text not null default 'auto';
alter table public.code_project_settings drop constraint if exists code_project_settings_team_check;
alter table public.code_project_settings add constraint code_project_settings_team_check check (team in ('auto', 'on', 'off'));
