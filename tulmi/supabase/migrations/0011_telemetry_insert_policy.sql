-- Let the keyboard actually write its counters.
--
-- 0006 said: "The backend writes with the service-role key (bypasses RLS), so
-- no insert policy is needed." That was the intent and not the code.
-- recordKeyboardTelemetry writes with dataClientFor(user) — the user's own
-- JWT — which RLS very much applies to. With a read policy and no insert
-- policy, every write was refused.
--
-- It failed quietly, which is why it went unnoticed: the insert error is
-- logged and swallowed on purpose (a keyboard must never break because a
-- counter did not save), and the endpoint answers 200 either way. The only
-- symptom was this line, once per telemetry post, in the server log:
--
--   [telemetry] insert failed: new row violates row-level security policy
--
-- TWO WAYS TO FIX IT, and this is the smaller one. The other is to write with
-- the service-role key, matching what 0006 assumed. A policy is better here:
-- it does not hand a background counter more privilege than it needs, and it
-- keeps every row attributable to the user who produced it rather than to the
-- server. RLS then guarantees what the code already intended — a client can
-- only ever write its own rows, whatever it claims.
drop policy if exists "users write own telemetry" on public.keyboard_telemetry;
create policy "users write own telemetry"
  on public.keyboard_telemetry
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Insert only. There is deliberately no update or delete policy: this table is
-- an append-only log of counters, and a client that could rewrite its own
-- history could rewrite the answer to "is this experiment better?".
