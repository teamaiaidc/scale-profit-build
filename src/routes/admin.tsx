import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import {
  Lock,
  Save,
  Check,
  Loader2,
  Plus,
  Trash2,
  CalendarClock,
  FlaskConical,
  RefreshCw,
  Users,
  CalendarDays,
  Ticket,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listEvents, verifyAdminPassword } from "@/lib/events.functions";
import {
  listSeminarPurchasers,
  getPurchaserDetail,
  type SeminarPurchaser,
  type PurchaserDetail,
} from "@/lib/ghl.functions";
import { getTodayISO, splitEvents, type EventRow } from "@/lib/events";
import { loadStoredEvents, saveStoredEvents } from "@/lib/events.store";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin — Scale & Profit" }, { name: "robots", content: "noindex, nofollow" }],
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

  // Purchases / attendees tab (loaded lazily from GHL on first view).
  const purchasersFn = useServerFn(listSeminarPurchasers);
  const [purchasers, setPurchasers] = useState<SeminarPurchaser[] | null>(null);
  const [loadingPurchasers, setLoadingPurchasers] = useState(false);
  const [purchasersError, setPurchasersError] = useState<string | null>(null);

  const loadPurchasers = useCallback(async () => {
    setLoadingPurchasers(true);
    setPurchasersError(null);
    try {
      const res = await purchasersFn({ data: { password } });
      setPurchasers(res.purchasers);
      if (res.error) setPurchasersError(res.error);
    } catch (err) {
      setPurchasersError(err instanceof Error ? err.message : "Failed to load purchasers.");
      setPurchasers([]);
    } finally {
      setLoadingPurchasers(false);
    }
  }, [purchasersFn, password]);

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
    setEvents((prev) => prev.map((ev) => (ev.slug === slug ? { ...ev, [key]: value } : ev)));
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
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Scale &amp; Profit Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage events and review who has purchased tickets.
            </p>
          </div>
          <a href="/" className="text-sm text-primary hover:underline">
            View site →
          </a>
        </div>

        <Tabs
          defaultValue="events"
          onValueChange={(v) => {
            if (v === "purchases" && purchasers === null && !loadingPurchasers) {
              loadPurchasers();
            }
          }}
        >
          <TabsList className="mb-8">
            <TabsTrigger value="events">
              <CalendarDays className="mr-1.5 h-4 w-4" /> Events
            </TabsTrigger>
            <TabsTrigger value="purchases">
              <Users className="mr-1.5 h-4 w-4" /> Attendees
            </TabsTrigger>
          </TabsList>

          <TabsContent value="events">
            <div className="mb-6 flex justify-end">
              <Button variant="outline" size="sm" onClick={loadTestData}>
                <FlaskConical className="mr-1.5 h-4 w-4" /> Load test data
              </Button>
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
          </TabsContent>

          <TabsContent value="purchases">
            <PurchasesView
              purchasers={purchasers}
              events={events}
              loading={loadingPurchasers}
              error={purchasersError}
              onRefresh={loadPurchasers}
              password={password}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ===== Attendees / purchases tab =====

type EventGroup = {
  slug: string;
  name: string;
  rows: SeminarPurchaser[];
  revenue: number;
};

function groupByEvent(purchasers: SeminarPurchaser[], events: EventRow[]): EventGroup[] {
  const nameBySlug = new Map(events.map((e) => [e.slug, e.city || e.slug]));
  const order = events.map((e) => e.slug);
  const buckets = new Map<string, SeminarPurchaser[]>();
  for (const p of purchasers) {
    const slug = p.eventSlug || "unknown";
    const list = buckets.get(slug) ?? [];
    list.push(p);
    buckets.set(slug, list);
  }
  return [...buckets.keys()]
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map((slug) => {
      const rows = buckets.get(slug)!;
      return {
        slug,
        name:
          nameBySlug.get(slug) ??
          (slug === "unknown" ? "Unassigned" : slug.replace(/\b\w/g, (c) => c.toUpperCase())),
        rows,
        revenue: rows.reduce((n, r) => n + r.amount, 0),
      };
    });
}

function PurchasesView({
  purchasers,
  events,
  loading,
  error,
  onRefresh,
  password,
}: {
  purchasers: SeminarPurchaser[] | null;
  events: EventRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  password: string;
}) {
  const [selected, setSelected] = useState<SeminarPurchaser | null>(null);
  const groups = purchasers ? groupByEvent(purchasers, events) : [];
  const totalPeople = purchasers?.length ?? 0;
  const totalRevenue = groups.reduce((n, g) => n + g.revenue, 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <Stat icon={<Users className="h-4 w-4" />} label="People" value={String(totalPeople)} />
          <Stat
            icon={<CalendarDays className="h-4 w-4" />}
            label="Events"
            value={String(groups.length)}
          />
          {totalRevenue > 0 && (
            <Stat
              icon={<Ticket className="h-4 w-4" />}
              label="Indicative revenue"
              value={`$${totalRevenue.toLocaleString()}`}
            />
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && purchasers === null && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading purchasers from GHL…
        </div>
      )}

      {!loading && purchasers !== null && groups.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No purchasers found yet. Once people buy tickets they’ll appear here, grouped by event.
        </p>
      )}

      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.slug}>
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-bold capitalize">{group.name}</h2>
              <p className="text-sm text-muted-foreground">
                {group.rows.length} {group.rows.length === 1 ? "person" : "people"}
                {group.revenue > 0 && <> · ${group.revenue.toLocaleString()}</>}
              </p>
            </div>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Tags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((p) => (
                    <TableRow
                      key={p.id || p.email}
                      className="cursor-pointer"
                      onClick={() => setSelected(p)}
                    >
                      <TableCell className="font-medium">
                        {p.name || "—"}
                        {p.isAttendee && (
                          <Badge variant="secondary" className="ml-2 align-middle text-[10px]">
                            attendee
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.email || "—"}</TableCell>
                      <TableCell>{p.tier || "—"}</TableCell>
                      <TableCell className="text-right">
                        {p.amount > 0 ? `$${p.amount.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[260px] flex-wrap gap-1">
                          {p.tags.slice(0, 3).map((t) => (
                            <Badge key={t} variant="outline" className="text-[10px]">
                              {t}
                            </Badge>
                          ))}
                          {p.tags.length > 3 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{p.tags.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        ))}
      </div>

      <PurchaserDialog purchaser={selected} password={password} onClose={() => setSelected(null)} />
    </div>
  );
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      {icon && <span className="text-primary">{icon}</span>}
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function PurchaserDialog({
  purchaser,
  password,
  onClose,
}: {
  purchaser: SeminarPurchaser | null;
  password: string;
  onClose: () => void;
}) {
  const p = purchaser;
  const detailFn = useServerFn(getPurchaserDetail);
  const [detail, setDetail] = useState<PurchaserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch the contact's custom fields when a row is opened (GHL's search
  // endpoint omits them, so this needs a per-contact call).
  useEffect(() => {
    if (!p?.id) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setDetailError(null);
    detailFn({ data: { password, contactId: p.id } })
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled)
          setDetailError(err instanceof Error ? err.message : "Failed to load details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [p?.id, password, detailFn]);

  const answerRows = detail
    ? [
        { label: "Which state is your agency in?", value: detail.answers.agencyState },
        { label: "Do you have a MOA?", value: detail.answers.hasMoa },
        {
          label: "Attended a Scale + Profit seminar before?",
          value: detail.answers.attendedBefore,
        },
        { label: "Shirt size", value: detail.answers.shirtSize },
      ].filter((r) => r.value)
    : [];
  const ticketQty = detail && detail.ticketQuantity > 0 ? detail.ticketQuantity : null;

  return (
    <Dialog open={p !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {p && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {p.name || p.email || "Attendee"}
                {p.tier && <Badge variant="secondary">{p.tier}</Badge>}
                {p.isAttendee && <Badge variant="outline">attendee</Badge>}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 text-sm">
              {/* Contact */}
              <div className="space-y-1.5">
                <InfoRow icon={<Mail className="h-4 w-4" />} value={p.email || "—"} />
                <InfoRow icon={<Phone className="h-4 w-4" />} value={p.phone || "—"} />
                {p.state && <InfoRow icon={<MapPin className="h-4 w-4" />} value={p.state} />}
              </div>

              {/* Order summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Tickets purchased</p>
                  <p className="text-xl font-bold">{loading ? "…" : (ticketQty ?? "—")}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="text-xl font-bold">
                    {p.amount > 0 ? `$${p.amount.toLocaleString()}` : "—"}
                  </p>
                </div>
              </div>

              {/* Tags */}
              {p.tags.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <Badge key={t} variant="outline" className="text-[11px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Checkout form answers */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Checkout form answers
                </p>
                {loading && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </p>
                )}
                {!loading && detailError && <p className="text-destructive">{detailError}</p>}
                {!loading && !detailError && answerRows.length === 0 && (
                  <p className="text-muted-foreground">No form answers on this contact.</p>
                )}
                {!loading && answerRows.length > 0 && (
                  <dl className="space-y-2">
                    {answerRows.map((r) => (
                      <div key={r.label} className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">{r.label}</dt>
                        <dd className="text-right font-medium">{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              {/* All other custom fields */}
              {detail && detail.customFields.length > 0 && (
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    All custom fields ({detail.customFields.length})
                  </summary>
                  <dl className="mt-2 space-y-2">
                    {detail.customFields.map((f) => (
                      <div key={f.id} className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">{f.label}</dt>
                        <dd className="text-right font-medium">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span>{value}</span>
    </div>
  );
}
