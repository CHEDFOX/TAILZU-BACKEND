-- Tailzu — the pictures on a site's cards (src/sites/history/pictures.ts, docs/site-portrait.md §4c).
--
-- site_orders.image  the restaurant's or shop's picture as the orders page showed it, from the site's own image servers.
--                    A dish's or product's own picture rides in `items` beside its name.
-- site_did.image     the picture of what was done (the dish in the cart filled).
--
-- Run after 0116. It can be run again.

alter table public.site_orders add column if not exists image text;
alter table public.site_did    add column if not exists image text;
