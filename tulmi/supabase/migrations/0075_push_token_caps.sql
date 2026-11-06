-- Tailzu — what a phone's binary can do with a push (src/push/tokens.ts; docs/plan-ease.md "Push kinds").
--
-- push_tokens + caps   what the app said with its token at its last launch (POST /v1/push/register `caps`), e.g. {PushTimeSensitive}:
--                      the iOS Time Sensitive entitlement is signed into this binary, so a leave-by or a bill due today may break
--                      through Focus (push/engine.ts sends interruptionLevel "time-sensitive" only to such a token). Every launch
--                      sends it again, so a phone updated from the store says so on its first launch. Empty: as before.
--
-- Run in your Supabase SQL editor. It needs 0005 and can be run again. Older server code ignores the column, and newer code reads
-- push_tokens without it until it is there (it then sends no time-sensitive push).

alter table public.push_tokens add column if not exists caps text[] not null default '{}';

do $$ begin
  alter table public.push_tokens add constraint push_tokens_caps_small check (cardinality(caps) <= 16);
exception when duplicate_object then null; end $$;
