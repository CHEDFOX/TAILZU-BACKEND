-- Tailzu — the Plan and Travel bots' outside data (src/botsBots/planTravel.ts, trips.ts, tripExtras.ts; src/places).
--
-- Run in your Supabase SQL editor after 0042_bots_area.sql. It can be run again. Without it a trip's main places and stays, and the
-- Plan bot's "where your day starts", cannot be kept (creating and changing a trip as before still works); the rest lives in memory.
--
-- trips.spots      the trip's main places as the person wrote them ({ text }), at most 6; the first is what stays are measured against
-- trips.stays      places to stay, compared on the trip: name, area, link (https) and its host, price a night in paise, rating and its
--                  scale, reviews, who added it (you / chat / web), the person's pick. At most 8. Nothing here is a booking.
-- plan_prefs       one row a person: where their day starts (home, as they wrote it: it is geocoded when used, never stored as a point)
--                  and the travel minutes each move they said yes to saved ({ key, min, at }), the last 60
--
-- Written by the server with the service key only. A person's own token can READ their own rows. Times are epoch milliseconds.

alter table public.trips add column if not exists spots jsonb not null default '[]'::jsonb;
alter table public.trips add column if not exists stays jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.trips add constraint trips_spots_shape check (jsonb_typeof(spots) = 'array' and jsonb_array_length(spots) <= 6);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.trips add constraint trips_stays_shape check (jsonb_typeof(stays) = 'array' and jsonb_array_length(stays) <= 8);
exception when duplicate_object then null; end $$;

create table if not exists public.plan_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  home       text not null default '' check (char_length(home) <= 120),
  saves      jsonb not null default '[]'::jsonb check (jsonb_typeof(saves) = 'array' and jsonb_array_length(saves) <= 60),
  updated_ms bigint not null
);

alter table public.plan_prefs enable row level security;
drop policy if exists "users read own plan prefs" on public.plan_prefs;
create policy "users read own plan prefs" on public.plan_prefs for select using (auth.uid() = user_id);
