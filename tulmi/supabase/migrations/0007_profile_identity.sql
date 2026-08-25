-- Tulmi — persist what the name + gender card collects.
--
-- The card has always PUT full_name + gender to /v1/profile, and the route has
-- always dropped them: there was nowhere to put them. The only record that the
-- card had been filled in was a flag in the phone's own storage, so a reinstall
-- or a second device asked the same user for their name again — and the name
-- they typed the first time was never saved anywhere at all.
--
-- Run in your Supabase SQL editor after 0003.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists gender    text;

-- Keep the values sane without hard-coding a taxonomy the app might extend:
-- a bounded string, and a gender the app actually offers.
alter table public.profiles
  drop constraint if exists profiles_full_name_len;
alter table public.profiles
  add constraint profiles_full_name_len
  check (full_name is null or char_length(full_name) <= 120);

alter table public.profiles
  drop constraint if exists profiles_gender_known;
alter table public.profiles
  add constraint profiles_gender_known
  check (gender is null or gender in ('female', 'male', 'other'));
