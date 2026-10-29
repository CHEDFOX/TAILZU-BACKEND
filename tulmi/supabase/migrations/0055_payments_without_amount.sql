-- Tailzu — payment requests in a space without an amount (src/botsBots/payments.ts, screens/spaces.ts): the app shows no money, so a request
-- is what it's for, who asks and who it pays; the approver's UPI app opens on the payee and they type the amount there. A request asked
-- before this keeps its amount on record (never shown).
--
-- Run in your Supabase SQL editor after 0054_own_calendar.sql. It can be run again.

alter table public.space_payments drop constraint if exists space_payments_amount_paise_check;
alter table public.space_payments
  add constraint space_payments_amount_paise_check check (amount_paise >= 0 and amount_paise <= 10000000);
alter table public.space_payments alter column amount_paise set default 0;
