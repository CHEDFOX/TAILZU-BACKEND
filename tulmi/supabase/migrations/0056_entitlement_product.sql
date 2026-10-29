-- X0 Bot — which product granted a paid plan (src/billing/entitlements.ts): Lite and Elite are both monthly and unlock the
-- same entitlement, so the product is what gives Elite its own allowance (src/you/usage.ts planOf).
--
-- Run in your Supabase SQL editor after 0055_payments_without_amount.sql. It can be run again. Until it is run, purchases
-- are still recorded and everyone paying gets Lite's allowance.

alter table public.entitlements add column if not exists product text;
