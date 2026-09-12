-- Tulmi — where an entitlement came from.
--
-- Run in your Supabase SQL editor after 0008.
--
-- Two columns, neither of which gates anything by itself. They exist because
-- the questions they answer arrive at the worst possible time: a customer says
-- they paid and the app disagrees, or a row grants access nobody can explain.
--
--   environment — SANDBOX or PRODUCTION. A TestFlight, Xcode or Play
--     internal-track purchase costs nothing and RevenueCat says so on every
--     event. Whether a sandbox purchase grants access is a config decision
--     (REVENUECAT_ALLOW_SANDBOX); recording which kind it was is not, because
--     without it a free test subscription and a paid one look identical here.
--
--   app_id — which RevenueCat app the event came from. One project can hold
--     the iOS app and the Android app, and a refund dispute starts with
--     knowing which store to open.

alter table public.entitlements
  add column if not exists environment text,
  add column if not exists app_id      text;

-- Find the free ones instantly at launch, when the question is "who is on this
-- because they paid, and who is on it because they were testing".
create index if not exists entitlements_environment_idx
  on public.entitlements (environment)
  where active;
