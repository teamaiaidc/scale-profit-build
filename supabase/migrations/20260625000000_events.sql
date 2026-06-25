-- Events (cohorts) for the Scale & Profit site.
-- Public-readable; writes happen only via the service-role key inside the
-- admin-gated server functions (no public write policy).

create table if not exists public.events (
  slug        text primary key,
  city        text not null default '',
  date        text not null default '',
  end_date    text not null default '',
  venue       text not null default '',
  address     text not null default '',
  time        text not null default '9:00 AM – 4:00 PM',
  details     text not null default '',
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.events enable row level security;

drop policy if exists "events public read" on public.events;
create policy "events public read" on public.events
  for select using (true);

-- Seed the current events (safe to re-run).
insert into public.events (slug, city, date, end_date, venue, address, time, details, sort_order)
values
  ('boston', 'Boston', 'June 2nd & 3rd, 2026', '2026-06-03',
   'Aloft Boston Seaport District', '401-403 D Street, Boston, MA 02210',
   '9:00 AM – 4:00 PM', 'Networking Cocktail Hour Day 1', 1),
  ('nashville', 'Nashville', 'August 5th–6th, 2026', '2026-08-06',
   'W Nashville Hotel', '300 12th Ave S, Nashville, TN 37203',
   '9:00 AM – 4:00 PM', '', 2),
  ('california', 'California', 'December 8th–9th, 2026', '2026-12-09',
   'Venue TBD', 'California', '9:00 AM – 4:00 PM', '', 3)
on conflict (slug) do nothing;
