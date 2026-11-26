-- Tailzu — a person's taste, worked out from their orders on a site, and the new places found for it
-- (src/sites/history/taste, docs/site-portrait.md §2b and §2c).
--
-- site_history.taste     the profile (taste/profile.ts Taste): their palate, motives, moods and what they might love, each
--                        claim with the orders it rests on. Made again when the orders change (its own `hash`).
-- site_history.picks     places found on the web for it (taste/discover.ts Pick), each with a reviewer's words checked on
--                        the page they came from. Looked for at most once a day.
-- site_history.picks_at  when they were looked for.
--
-- Forgetting a site's history deletes the row, and these with it. Run after 0114. It can be run again.

alter table public.site_history add column if not exists taste    jsonb;
alter table public.site_history add column if not exists picks    jsonb;
alter table public.site_history add column if not exists picks_at timestamptz;
