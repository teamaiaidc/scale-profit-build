import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Lock, Save, Check, Loader2, Plus, Trash2, CalendarClock, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listEvents, verifyAdminPassword } from "@/lib/events.functions";
import { getTodayISO, splitEvents, type EventRow } from "@/lib/events";
import { loadStoredEvents, saveStoredEvents } from "@/lib/events.store";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Scale & Profit" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: async () => ({ events: await listEvents() }),
  component: AdminPage,
});

type SaveState = "idle" | "saved";

const EMPTY_EVENT: EventRow = {
  slug: "",
  city: "",
  date: "",
  end_date: "",
  venue: "",
  address: "",
  time: "9:00 AM – 4:00 PM",
  details: "",
  sort_order: 0,
};

// Sample events for quick testing: 2 past, 4 upcoming (relative to mid-2026).
const TEST_EVENTS: EventRow[] = [
  {
    slug: "boston",
    city: "Boston",
    date: "March 10th–11th, 2026",
    end_date: "2026-03-11",
    venue: "Aloft Boston Seaport District",
    address: "401-403 D Street, Boston, MA 02210",
    time: "9:00 AM – 4:00 PM",
    details: "Networking Cocktail Hour Day 1",
    sort_order: 1,
  },
  {
    slug: "phoenix",
    city: "Phoenix",
    date: "May 5th–6th, 2026",
    end_date: "2026-05-06",
    venue: "The Camby, Autograph Collection",
    address: "2401 E Camelback Rd, Phoenix, AZ 85016",
    time: "9:00 AM – 4:00 PM",
    details: "",
    sort_order: 2,
  },
  {
    slug: "dallas",
    city: "Dallas",
    date: "July 14th–15th, 2026",
    end_date: "2026-07-15",
    venue: "The Statler Dallas",
    address: "1914 Commerce St, Dallas, TX 75201",
    time: "9:00 AM – 4:00 PM",
    details: "Networking Cocktail Hour Day 1",
    sort_order: 3,
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
    sort_order: 4,
  },
  {
    slug: "chicago",
    city: "Chicago",
    date: "October 20th–21st, 2026",
    end_date: "2026-10-21",
    venue: "The Langham Chicago",
    address: "330 N Wabash Ave, Chicago, IL 60611",
    time: "9:00 AM – 4:00 PM",
    details: "VIP Dinner Day 1",
    sort_order: 5,
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
    sort_order: 6,
  },
];

const TEXT_FIELDS: { key: keyof EventRow; label: string; placeholder?: string }[] = [
  { key: "city", label: "City / Event Name" },
  { key: "date", label: "Date (display text)", placeholder: "e.g. August 5th–6th, 2026" },
  { key: "venue", label: "Venue (Location)" },
  { key: "address", label: "Address" },
  { key: "time", label: "Time" },
];

/** Shared field group used by both the edit cards and the add-new form. */
function EventFields({
  value,
  onChange,
  withSlug = false,
  idPrefix,
}: {
  value: EventRow;
  onChange: (key: keyof EventRow, v: string) => void;
  withSlug?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {withSlug && (
        <div>
          <Label htmlFor={`${idPrefix}-slug`}>Slug (URL id, e.g. "dallas")</Label>
          <Input
            id={`${idPrefix}-slug`}
            value={value.slug}
            onChange={(e) => onChange("slug", e.target.value)}
            placeholder="lowercase-with-hyphens"
            className="mt-1.5"
          />
        </div>
      )}
      {TEXT_FIELDS.map((f) => (
        <div key={f.key}>
          <Label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</Label>
          <Input
            id={`${idPrefix}-${f.key}`}
            value={String(value[f.key] ?? "")}
            placeholder={f.placeholder}
            onChange={(e) => onChange(f.key, e.target.value)}
            className="mt-1.5"
          />
        </div>
      ))}
      <div>
        <Label htmlFor={`${idPrefix}-end_date`}>End date (drives scheduling)</Label>
        <Input
          id={`${idPrefix}-end_date`}
          type="date"
          value={value.end_date}
          onChange={(e) => onChange("end_date", e.target.value)}
          className="mt-1.5"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          After this date the event moves to “Past”.
        </p>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-details`}>Details / Extras</Label>
        <textarea
          id={`${idPrefix}-details`}
          value={value.details}
          onChange={(e) => onChange("details", e.target.value)}
          rows={2}
          className="mt-1.5 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}

function AdminPage() {
  const { events: initialEvents } = Route.useLoaderData();
  const verifyFn = useServerFn(verifyAdminPassword);

  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState("");
  const [checking, setChecking] = useState(false);

  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});

  const [newEvent, setNewEvent] = useState<EventRow>(EMPTY_EVENT);
  const [addState, setAddState] = useState<SaveState>("idle");
  const [addError, setAddError] = useState("");

  // Hydrate from this browser's saved edits once mounted.
  useEffect(() => {
    setEvents(loadStoredEvents(initialEvents));
  }, [initialEvents]);

  const today = getTodayISO();
  const { upcoming, past } = splitEvents(events, today);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setAuthError("");
    try {
      await verifyFn({ data: { password } });
      setUnlocked(true);
    } catch {
      setAuthError("Incorrect password.");
    } finally {
      setChecking(false);
    }
  }

  function persist(next: EventRow[]) {
    setEvents(next);
    saveStoredEvents(next);
  }

  function editField(slug: string, key: keyof EventRow, value: string) {
    setEvents((prev) =>
      prev.map((ev) => (ev.slug === slug ? { ...ev, [key]: value } : ev)),
    );
    setSaveState((s) => ({ ...s, [slug]: "idle" }));
  }

  function save(ev: EventRow) {
    saveStoredEvents(events);
    setSaveState((s) => ({ ...s, [ev.slug]: "saved" }));
  }

  function addEvent() {
    setAddError("");
    const slug = newEvent.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setAddError("Slug may only contain lowercase letters, numbers and hyphens.");
      return;
    }
    if (events.some((e) => e.slug === slug)) {
      setAddError(`An event with slug "${slug}" already exists.`);
      return;
    }
    if (!newEvent.city || !newEvent.date || !/^\d{4}-\d{2}-\d{2}$/.test(newEvent.end_date)) {
      setAddError("Please fill in at least City, Date and a valid End date.");
      return;
    }
    const maxOrder = events.reduce((m, e) => Math.max(m, e.sort_order), 0);
    persist([...events, { ...newEvent, slug, sort_order: maxOrder + 1 }]);
    setNewEvent(EMPTY_EVENT);
    setAddState("saved");
  }

  function remove(slug: string) {
    persist(events.filter((e) => e.slug !== slug));
  }

  function loadTestData() {
    persist(TEST_EVENTS.map((e) => ({ ...e })));
    setSaveState({});
  }

  if (!unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <Card className="w-full max-w-sm p-8">
          <div className="mb-6 flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Admin Access</h1>
          </div>
          <form onSubmit={unlock} className="space-y-4">
            <div>
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5"
              />
            </div>
            {authError && <p className="text-sm text-destructive">{authError}</p>}
            <Button type="submit" className="w-full" disabled={checking || !password}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Event Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The public site shows only <strong>upcoming</strong> events, soonest first.
              Once an event’s end date passes it drops into “Past”. Edits are saved in this
              browser.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <Button variant="outline" size="sm" onClick={loadTestData}>
              <FlaskConical className="mr-1.5 h-4 w-4" /> Load test data
            </Button>
            <a href="/" className="text-sm text-primary hover:underline">
              View site →
            </a>
          </div>
        </div>

        {/* Past events */}
        {past.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-muted-foreground">
              <CalendarClock className="h-5 w-5" /> Past Events
            </h2>
            <div className="space-y-3">
              {past.map((ev) => (
                <Card
                  key={ev.slug}
                  className="flex items-center justify-between gap-4 border-dashed p-4 opacity-80"
                >
                  <div>
                    <p className="font-semibold capitalize">{ev.city || ev.slug}</p>
                    <p className="text-sm text-muted-foreground">
                      {ev.date} — ended {ev.end_date}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(ev.slug)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Upcoming events */}
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-bold">Upcoming Events</h2>
          {upcoming.length === 0 && (
            <p className="mb-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No upcoming events. Add one below so the site has something to show.
            </p>
          )}
          <div className="space-y-6">
            {upcoming.map((ev) => {
              const state = saveState[ev.slug] ?? "idle";
              return (
                <Card key={ev.slug} className="p-6">
                  <h3 className="mb-4 text-xl font-bold capitalize">{ev.city || ev.slug}</h3>
                  <EventFields
                    value={ev}
                    idPrefix={ev.slug}
                    onChange={(key, v) => editField(ev.slug, key, v)}
                  />
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Button onClick={() => save(ev)}>
                      {state === "saved" ? (
                        <Check className="mr-2 h-4 w-4" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {state === "saved" ? "Saved" : "Save changes"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => remove(ev.slug)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Add new event */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Plus className="h-5 w-5 text-primary" /> Add Upcoming Event
          </h2>
          <Card className="p-6">
            <EventFields
              value={newEvent}
              idPrefix="new"
              withSlug
              onChange={(key, v) => {
                setNewEvent((prev) => ({ ...prev, [key]: v }));
                setAddState("idle");
              }}
            />
            {addError && <p className="mt-3 text-sm text-destructive">{addError}</p>}
            <div className="mt-4">
              <Button onClick={addEvent}>
                {addState === "saved" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {addState === "saved" ? "Added" : "Add event"}
              </Button>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
