// Shared event types + defaults. The defaults are used as a fallback whenever the
// stored data can't be read, so the public pages never break.

export type EventRow = {
  slug: string;
  city: string;
  date: string; // display label, e.g. "August 5th–6th, 2026"
  end_date: string; // ISO YYYY-MM-DD — drives the past vs. upcoming logic
  venue: string;
  address: string;
  time: string;
  details: string;
  sort_order: number;
};

export const DEFAULT_EVENTS: EventRow[] = [
  {
    slug: "boston",
    city: "Boston",
    date: "June 2nd & 3rd, 2026",
    end_date: "2026-06-03",
    venue: "Aloft Boston Seaport District",
    address: "401-403 D Street, Boston, MA 02210",
    time: "9:00 AM – 4:00 PM",
    details: "Networking Cocktail Hour Day 1",
    sort_order: 1,
  },
  {
    slug: "nashville",
    city: "Nashville",
    date: "August 5th–6th, 2026",
    end_date: "2026-08-06",
    venue: "W Nashville Hotel",
    address: "300 12th Ave S, Nashville, TN 37203",
    time: "9:00 AM – 4:00 PM",
    details: "",
    sort_order: 2,
  },
  {
    slug: "california",
    city: "California",
    date: "December 8th–9th, 2026",
    end_date: "2026-12-09",
    venue: "Venue TBA",
    address: "California",
    time: "9:00 AM – 4:00 PM",
    details: "",
    sort_order: 3,
  },
];

// Local date as YYYY-MM-DD, for comparing against an event's end_date.
export function getTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// An event is "past" once the day after its end_date arrives. Events with no
// end_date are treated as upcoming (so partially-filled rows never disappear).
export function isPastEvent(e: EventRow, todayISO: string): boolean {
  return Boolean(e.end_date) && e.end_date < todayISO;
}

// Soonest first; rows without an end_date fall back to sort_order.
export function sortByDate(events: EventRow[]): EventRow[] {
  return [...events].sort((a, b) => {
    if (a.end_date && b.end_date) return a.end_date.localeCompare(b.end_date);
    if (a.end_date) return -1;
    if (b.end_date) return 1;
    return a.sort_order - b.sort_order;
  });
}

export function splitEvents(
  events: EventRow[],
  todayISO: string,
): { upcoming: EventRow[]; past: EventRow[] } {
  const sorted = sortByDate(events);
  return {
    upcoming: sorted.filter((e) => !isPastEvent(e, todayISO)),
    // most-recently-ended first
    past: sorted.filter((e) => isPastEvent(e, todayISO)).reverse(),
  };
}
