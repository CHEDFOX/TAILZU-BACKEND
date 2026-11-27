-- Tailzu — a 3D creation built from a picture of the idea (src/cinema/scene, docs/cinema-3d.md §2a).
--
-- cinema_scenes.ref_key  the media key of the picture it was built from (one of the person's own cinema pictures), so the creation's
--                        page can show the idea beside the 3D. Null for one built from words alone.
--
-- The extra angles of a still ride in `kept` as `views` (a list of media keys). Run after 0117. It can be run again.

alter table public.cinema_scenes add column if not exists ref_key text;
