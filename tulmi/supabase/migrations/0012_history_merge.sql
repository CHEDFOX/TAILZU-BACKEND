-- Let the server merge a dictation into the entry before it.
--
-- 0004 installed a guard that refuses any edit to a history row's payload, on
-- the principle that history is a record and records are not rewritten. That
-- is still right for everyone typing on a phone.
--
-- But the server later learned to MERGE: two dictations a few seconds apart
-- are one thought, not two entries, so the second one rewrites `output` and
-- `words_out` on the first rather than adding a row. The guard refuses that
-- update, the write falls back to an insert, and the merge produces exactly
-- the duplicate it exists to prevent — silently, because the fallback
-- succeeds. It shows up only as a line in the log:
--
--   [history] merge failed for <user>, inserting instead:
--     cleanup_history.output is immutable
--
-- Neither half was wrong. They were written at different times and never
-- introduced to each other.
--
-- So the guard learns who is asking. The service role — the backend, and
-- nothing else, because that key never leaves the server — may rewrite the
-- two columns a merge touches. Everything else stays immutable for everyone,
-- including the service role: what was SAID and when it was said are not ours
-- to edit, and a merge has no business changing them.
create or replace function public.cleanup_history_no_edit()
returns trigger
language plpgsql
as $$
declare
  -- PostgREST does SET ROLE from the key's JWT, so this is the honest
  -- question: is this the server, or is it somebody's phone?
  is_server boolean := current_user = 'service_role';
begin
  -- Never editable, whoever is asking.
  if new.user_id    is distinct from old.user_id    then raise exception 'cleanup_history.user_id is immutable'; end if;
  if new.created_at is distinct from old.created_at then raise exception 'cleanup_history.created_at is immutable'; end if;
  if new.kind       is distinct from old.kind       then raise exception 'cleanup_history.kind is immutable'; end if;
  if new.input      is distinct from old.input      then raise exception 'cleanup_history.input is immutable'; end if;

  -- What a merge rewrites. The server may; a user may not.
  if not is_server then
    if new.output    is distinct from old.output    then raise exception 'cleanup_history.output is immutable'; end if;
    if new.words_out is distinct from old.words_out then raise exception 'cleanup_history.words_out is immutable'; end if;
  end if;

  return new;
end;
$$;

-- The trigger itself is unchanged; 0004's definition still binds this
-- function. Re-created anyway so applying this file to a database that
-- somehow lost it leaves a working guard rather than none at all.
drop trigger if exists cleanup_history_no_edit_trg on public.cleanup_history;
create trigger cleanup_history_no_edit_trg
  before update on public.cleanup_history
  for each row execute function public.cleanup_history_no_edit();
