-- Events table: seminar dates, locations and details editable from the /admin page.
create extension if not exists "pgcrypto";

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  city text not null,
  date text not null,
  end_date date,
  venue text not null,
  address text not null,
  "time" text not null default '9:00 AM – 4:00 PM',
  details text not null default '',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.events enable row level security;

-- Public read access (anon + authenticated). The site reads events with the publishable key.
drop policy if exists "events_public_read" on public.events;
create policy "events_public_read" on public.events for select using (true);

-- No public insert/update/delete policy on purpose: writes happen server-side
-- with the service-role key (which bypasses RLS) after the /admin password check.

-- Seed with the current three events. Re-running the migration won't duplicate them.
insert into public.events (slug, city, date, end_date, venue, address, "time", details, sort_order) values
  ('boston',    'Boston',     'June 2nd & 3rd, 2026',      '2026-06-03', 'Aloft Boston Seaport District', '401-403 D Street, Boston, MA 02210', '9:00 AM – 4:00 PM', 'Networking Cocktail Hour Day 1', 1),
  ('nashville', 'Nashville',  'August 5th–6th, 2026',      '2026-08-06', 'W Nashville Hotel',             '300 12th Ave S, Nashville, TN 37203', '9:00 AM – 4:00 PM', '', 2),
  ('california','California',  'December 8th–9th, 2026',    '2026-12-09', 'Venue TBA',                     'California',                          '9:00 AM – 4:00 PM', '', 3)
on conflict (slug) do nothing;
