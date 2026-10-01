-- Tulmi — a Razorpay subscription on the entitlement row.
--
-- Run in your Supabase SQL editor after 0014.
--
-- RevenueCat carries the phones and keeps its own ids. Razorpay, which sells
-- on the web and the desktop, does not go through RevenueCat, so the row has
-- to remember which Razorpay subscription it is about: to ask Razorpay when a
-- renewal's webhook went missing, and to cancel it from the manage page.
-- Null for every row a phone purchase wrote.

alter table public.entitlements
  add column if not exists subscription_id text;
