-- Tulmi — usage rows for Ask, the on-screen agent.
--
-- Run in your Supabase SQL editor after 0015.
--
-- Every step of an Ask run is metered with source 'agent' (POST /v1/agent), so
-- its calls can be told apart from dictation's. 0001 allowed only 'rest' and
-- 'stream', and a row the check refuses is not an error anyone sees: the
-- insert fails, the server logs it and carries on, and the step goes
-- unmetered. The check is replaced, not dropped, so a typo in a new source
-- still fails loudly.
alter table public.usage_events drop constraint if exists usage_events_source_check;
alter table public.usage_events
  add constraint usage_events_source_check check (source in ('rest', 'stream', 'agent'));
